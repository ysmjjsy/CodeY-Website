use crate::db::{params, OptionalExtension, Transaction, TransactionBehavior};
use chrono::{DateTime, Datelike as _, Duration, Utc};

use super::store::{insert_grant, insert_grant_available, parse_time, stored_i64, stored_u64};
use super::{
    natural_month_period_end, prorated_credits, prorated_money, CloudStore, CloudStoreError,
    CreatePlanOrderRequest, CreditGrantSource, PaymentCheckout, PaymentCheckoutAction,
    PaymentOrder, PaymentOrderPurpose, PaymentOrderStatus, PaymentProvider,
    SchedulePlanChangeRequest, SubscriptionSnapshot, SubscriptionStatus,
};

const ORDER_TTL_MINUTES: i64 = 60;

#[derive(Debug)]
struct OfferQuote {
    offer_id: String,
    plan_id: String,
    plan_version_id: String,
    tier_rank: u32,
    is_default: bool,
    monthly_credit_micros: u64,
    provider: PaymentProvider,
    amount_minor: u64,
    region: String,
    currency: String,
}

impl CloudStore {
    pub fn create_plan_order(
        &self,
        user_id: &str,
        request: &CreatePlanOrderRequest,
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, CloudStoreError> {
        validate_idempotency_key(&request.idempotency_key)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        reconcile_subscription(&transaction, user_id, now)?;
        if let Some(existing) =
            payment_order_by_idempotency(&transaction, user_id, &request.idempotency_key)?
        {
            if existing.offer_id != request.offer_id {
                return Err(CloudStoreError::IdempotencyConflict);
            }
            transaction.commit()?;
            return Ok(existing);
        }

        let target = offer_quote(&transaction, &request.offer_id)?;
        if target.is_default {
            return Err(CloudStoreError::InvalidPlanOrder(
                "the default plan does not require payment".into(),
            ));
        }
        let subscription = super::store::subscription(&transaction, user_id)?
            .ok_or(CloudStoreError::SubscriptionIntegrity)?;
        let current = current_plan(&transaction, &subscription.plan_version_id)?;
        let (purpose, amount_minor, credit_micros, source_period_id, starts_at, ends_at) =
            if subscription.status == SubscriptionStatus::Expired || current.is_default {
                (
                    PaymentOrderPurpose::PlanPurchase,
                    target.amount_minor,
                    target.monthly_credit_micros,
                    Some(subscription.current_period_id.clone()),
                    None,
                    None,
                )
            } else if target.plan_id == subscription.plan_id {
                renewal_quote(&subscription, &target)?
            } else if target.tier_rank > current.tier_rank {
                let billing = period_billing(&transaction, &subscription.current_period_id)?;
                if billing.provider != target.provider
                    || billing.region != target.region
                    || billing.currency != target.currency
                {
                    return Err(CloudStoreError::PlanUpgradeOfferMismatch);
                }
                let current_amount = billing.amount_minor;
                let money_difference = target.amount_minor.saturating_sub(current_amount);
                let credit_difference = target
                    .monthly_credit_micros
                    .saturating_sub(current.monthly_credit_micros);
                (
                    PaymentOrderPurpose::PlanUpgrade,
                    prorated_money(
                        money_difference,
                        now,
                        subscription.current_period_start,
                        subscription.current_period_end,
                    )?,
                    prorated_credits(
                        credit_difference,
                        now,
                        subscription.current_period_start,
                        subscription.current_period_end,
                    )?,
                    Some(subscription.current_period_id.clone()),
                    Some(now),
                    Some(subscription.current_period_end),
                )
            } else if subscription.scheduled_plan_id.as_deref() == Some(&target.plan_id) {
                renewal_quote(&subscription, &target)?
            } else {
                return Err(CloudStoreError::PlanDowngradeMustBeScheduled);
            };

        if matches!(
            purpose,
            PaymentOrderPurpose::EarlyRenewal | PaymentOrderPurpose::PlanUpgrade
        ) && pending_period(&transaction, user_id)?.is_some()
        {
            return Err(CloudStoreError::PendingRenewalExists);
        }
        let order_id = ulid::Ulid::new().to_string();
        transaction.execute(
            "INSERT INTO cloud_payment_order(
                order_id, user_id, idempotency_key, purpose, status, provider,
                provider_order_id, offer_id, plan_id, plan_version_id, source_period_id,
                amount_minor, region, currency, credit_micros, period_starts_at,
                period_ends_at, created_at, expires_at, paid_at, fulfilled_at, failure_reason
             ) VALUES (
                ?1, ?2, ?3, ?4, 'pending', ?5, NULL, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, NULL, NULL, NULL
             )",
            params![
                order_id,
                user_id,
                request.idempotency_key,
                purpose.as_str(),
                target.provider.as_str(),
                target.offer_id,
                target.plan_id,
                target.plan_version_id,
                source_period_id,
                stored_i64(amount_minor)?,
                target.region,
                target.currency,
                stored_i64(credit_micros)?,
                starts_at.map(|value| value.to_rfc3339()),
                ends_at.map(|value| value.to_rfc3339()),
                now.to_rfc3339(),
                (now + Duration::minutes(ORDER_TTL_MINUTES)).to_rfc3339(),
            ],
        )?;
        let order = payment_order_by_id(&transaction, &order_id)?
            .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
        transaction.commit()?;
        Ok(order)
    }

    pub fn schedule_plan_change(
        &self,
        user_id: &str,
        request: &SchedulePlanChangeRequest,
        now: DateTime<Utc>,
    ) -> Result<SubscriptionSnapshot, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        reconcile_subscription(&transaction, user_id, now)?;
        let snapshot = super::store::subscription(&transaction, user_id)?
            .ok_or(CloudStoreError::SubscriptionIntegrity)?;
        if snapshot.status != SubscriptionStatus::Active
            || snapshot.current_period_id != request.expected_period_id
        {
            return Err(CloudStoreError::SubscriptionConflict);
        }
        if pending_period(&transaction, user_id)?.is_some() {
            return Err(CloudStoreError::PendingRenewalExists);
        }
        let current = current_plan(&transaction, &snapshot.plan_version_id)?;
        let target = latest_plan(&transaction, &request.plan_id)?;
        if target.is_default || target.tier_rank >= current.tier_rank {
            return Err(CloudStoreError::InvalidScheduledPlan);
        }
        transaction.execute(
            "UPDATE cloud_subscription SET scheduled_plan_id=?1, updated_at=?2
             WHERE user_id=?3 AND current_period_id=?4",
            params![
                target.plan_id,
                now.to_rfc3339(),
                user_id,
                request.expected_period_id,
            ],
        )?;
        let snapshot = super::store::subscription(&transaction, user_id)?
            .ok_or(CloudStoreError::SubscriptionIntegrity)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn fulfill_payment_order(
        &self,
        order_id: &str,
        provider_order_id: &str,
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let order = payment_order_by_id(&transaction, order_id)?
            .ok_or(CloudStoreError::PaymentOrderNotFound)?;
        if order.status == PaymentOrderStatus::Fulfilled {
            if order.provider_order_id.as_deref() != Some(provider_order_id) {
                return Err(CloudStoreError::IdempotencyConflict);
            }
            transaction.commit()?;
            return Ok(order);
        }
        if !matches!(
            order.status,
            PaymentOrderStatus::Pending | PaymentOrderStatus::ActionRequired
        ) {
            return Err(CloudStoreError::InvalidPaymentOrderState);
        }
        transaction.execute(
            "UPDATE cloud_payment_order SET provider_order_id=?1, paid_at=?2,
                    failure_reason=NULL WHERE order_id=?3",
            params![provider_order_id, now.to_rfc3339(), order_id],
        )?;
        if let Err(error) = fulfill_order(&transaction, &order, now) {
            transaction.execute(
                "UPDATE cloud_payment_order SET status='action_required', failure_reason=?1
                 WHERE order_id=?2",
                params![error.to_string(), order_id],
            )?;
            let result = payment_order_by_id(&transaction, order_id)?
                .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
            transaction.commit()?;
            return Ok(result);
        }
        transaction.execute(
            "UPDATE cloud_payment_order SET status='fulfilled', fulfilled_at=?1
             WHERE order_id=?2",
            params![now.to_rfc3339(), order_id],
        )?;
        let result = payment_order_by_id(&transaction, order_id)?
            .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn payment_order(
        &self,
        user_id: &str,
        order_id: &str,
    ) -> Result<Option<PaymentOrder>, CloudStoreError> {
        let connection = self.connection()?;
        let order = payment_order_by_id(&connection, order_id)?;
        Ok(order.filter(|order| order.user_id == user_id))
    }

    pub fn payment_order_by_order_id(
        &self,
        order_id: &str,
    ) -> Result<Option<PaymentOrder>, CloudStoreError> {
        let connection = self.connection()?;
        payment_order_by_id(&connection, order_id)
    }

    pub fn attach_provider_order(
        &self,
        order_id: &str,
        provider_order_id: &str,
    ) -> Result<PaymentOrder, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let order = payment_order_by_id(&transaction, order_id)?
            .ok_or(CloudStoreError::PaymentOrderNotFound)?;
        if order.status != PaymentOrderStatus::Pending {
            return Err(CloudStoreError::InvalidPaymentOrderState);
        }
        if let Some(existing) = order.provider_order_id.as_deref() {
            if existing != provider_order_id {
                return Err(CloudStoreError::IdempotencyConflict);
            }
            transaction.commit()?;
            return Ok(order);
        }
        transaction.execute(
            "UPDATE cloud_payment_order SET provider_order_id=?1 WHERE order_id=?2",
            params![provider_order_id, order_id],
        )?;
        let order = payment_order_by_id(&transaction, order_id)?
            .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
        transaction.commit()?;
        Ok(order)
    }

    pub fn attach_provider_checkout(
        &self,
        order_id: &str,
        provider_order_id: &str,
        action: &PaymentCheckoutAction,
    ) -> Result<PaymentCheckout, CloudStoreError> {
        let action_json = serde_json::to_string(action)
            .map_err(|error| CloudStoreError::Json(error.to_string()))?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let order = payment_order_by_id(&transaction, order_id)?
            .ok_or(CloudStoreError::PaymentOrderNotFound)?;
        if order.status != PaymentOrderStatus::Pending {
            return Err(CloudStoreError::InvalidPaymentOrderState);
        }
        let existing = transaction.query_row(
            "SELECT provider_order_id, checkout_action_json FROM cloud_payment_order
                 WHERE order_id=?1",
            [order_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )?;
        if let Some(existing_provider_id) = existing.0 {
            if existing_provider_id != provider_order_id
                || existing.1.as_deref() != Some(action_json.as_str())
            {
                return Err(CloudStoreError::IdempotencyConflict);
            }
        } else {
            transaction.execute(
                "UPDATE cloud_payment_order SET provider_order_id=?1, checkout_action_json=?2
                 WHERE order_id=?3",
                params![provider_order_id, action_json, order_id],
            )?;
        }
        let order = payment_order_by_id(&transaction, order_id)?
            .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
        transaction.commit()?;
        Ok(PaymentCheckout {
            order,
            action: action.clone(),
        })
    }

    pub fn payment_checkout(
        &self,
        order_id: &str,
    ) -> Result<Option<PaymentCheckout>, CloudStoreError> {
        let connection = self.connection()?;
        let Some(order) = payment_order_by_id(&connection, order_id)? else {
            return Ok(None);
        };
        let action = connection
            .query_row(
                "SELECT checkout_action_json FROM cloud_payment_order WHERE order_id=?1",
                [order_id],
                |row| row.get::<_, Option<String>>(0),
            )?
            .map(|value| {
                serde_json::from_str::<PaymentCheckoutAction>(&value)
                    .map_err(|error| CloudStoreError::Json(error.to_string()))
            })
            .transpose()?;
        Ok(action.map(|action| PaymentCheckout { order, action }))
    }

    pub fn process_verified_payment_event(
        &self,
        provider: PaymentProvider,
        event_id: &str,
        payload_hash: &str,
        order_id: &str,
        provider_order_id: &str,
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, CloudStoreError> {
        {
            let mut connection = self.connection()?;
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let existing = transaction
                .query_row(
                    "SELECT payload_hash, order_id, processed_at FROM cloud_payment_event
                     WHERE provider=?1 AND event_id=?2",
                    params![provider.as_str(), event_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((stored_hash, stored_order, processed_at)) = existing {
                if stored_hash != payload_hash || stored_order != order_id {
                    return Err(CloudStoreError::IdempotencyConflict);
                }
                if processed_at.is_some() {
                    let order = payment_order_by_id(&transaction, order_id)?
                        .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
                    transaction.commit()?;
                    return Ok(order);
                }
            } else {
                transaction.execute(
                    "INSERT INTO cloud_payment_event(
                        provider, event_id, payload_hash, order_id, received_at, processed_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
                    params![
                        provider.as_str(),
                        event_id,
                        payload_hash,
                        order_id,
                        now.to_rfc3339(),
                    ],
                )?;
            }
            transaction.commit()?;
        }
        let order = self
            .payment_order_by_order_id(order_id)?
            .ok_or(CloudStoreError::PaymentOrderNotFound)?;
        if order.provider != provider {
            return Err(CloudStoreError::PaymentProviderMismatch);
        }
        let order = self.fulfill_payment_order(order_id, provider_order_id, now)?;
        if order.status != PaymentOrderStatus::Fulfilled {
            return Err(CloudStoreError::PaymentFulfillmentConflict);
        }
        let connection = self.connection()?;
        connection.execute(
            "UPDATE cloud_payment_event SET processed_at=?1
             WHERE provider=?2 AND event_id=?3 AND processed_at IS NULL",
            params![now.to_rfc3339(), provider.as_str(), event_id],
        )?;
        Ok(order)
    }

    pub fn reconcile_subscription(
        &self,
        user_id: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<SubscriptionSnapshot>, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        reconcile_subscription(&transaction, user_id, now)?;
        let result = super::store::subscription(&transaction, user_id)?;
        transaction.commit()?;
        Ok(result)
    }
}

fn renewal_quote(
    subscription: &SubscriptionSnapshot,
    target: &OfferQuote,
) -> Result<
    (
        PaymentOrderPurpose,
        u64,
        u64,
        Option<String>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
    ),
    CloudStoreError,
> {
    let starts_at = subscription.current_period_end;
    let ends_at = natural_month_period_end(
        starts_at,
        &subscription.billing_timezone,
        subscription.billing_anchor_day,
    )?;
    Ok((
        PaymentOrderPurpose::EarlyRenewal,
        target.amount_minor,
        target.monthly_credit_micros,
        Some(subscription.current_period_id.clone()),
        Some(starts_at),
        Some(ends_at),
    ))
}

fn fulfill_order(
    transaction: &Transaction<'_>,
    order: &PaymentOrder,
    now: DateTime<Utc>,
) -> Result<(), CloudStoreError> {
    let plan = order
        .plan_id
        .as_deref()
        .zip(order.plan_version_id.as_deref());
    let snapshot = if order.purpose == PaymentOrderPurpose::TopUp {
        None
    } else {
        Some(
            super::store::subscription(transaction, &order.user_id)?
                .ok_or(CloudStoreError::SubscriptionIntegrity)?,
        )
    };
    match order.purpose {
        PaymentOrderPurpose::PlanPurchase => {
            let (plan_id, plan_version_id) = plan.ok_or(CloudStoreError::PaymentOrderIntegrity)?;
            let snapshot = snapshot
                .as_ref()
                .ok_or(CloudStoreError::SubscriptionIntegrity)?;
            if order.source_period_id.as_deref() != Some(&snapshot.current_period_id) {
                return Err(CloudStoreError::PaymentFulfillmentConflict);
            }
            if snapshot.status == SubscriptionStatus::Active {
                transaction.execute(
                    "UPDATE cloud_subscription_period SET status='expired', ends_at=?1
                     WHERE period_id=?2 AND status='active'",
                    params![now.to_rfc3339(), snapshot.current_period_id],
                )?;
            }
            let timezone = snapshot.billing_timezone.clone();
            let anchor_day = now
                .with_timezone(
                    &timezone
                        .parse::<chrono_tz::Tz>()
                        .map_err(|_| CloudStoreError::InvalidBillingTimezone(timezone.clone()))?,
                )
                .day();
            let ends_at = natural_month_period_end(now, &timezone, anchor_day)?;
            let period_id = insert_period(
                transaction,
                &order.user_id,
                plan_id,
                plan_version_id,
                now,
                ends_at,
                "active",
                Some(&PeriodBillingRef {
                    provider: order.provider,
                    region: &order.region,
                    currency: &order.currency,
                    amount_minor: order.amount_minor,
                }),
                now,
            )?;
            transaction.execute(
                "UPDATE cloud_subscription SET plan_id=?1, plan_version_id=?2,
                    status='active', billing_anchor_day=?3, current_period_id=?4,
                    scheduled_plan_id=NULL, updated_at=?5 WHERE user_id=?6",
                params![
                    plan_id,
                    plan_version_id,
                    anchor_day,
                    period_id,
                    now.to_rfc3339(),
                    order.user_id,
                ],
            )?;
            if order.credit_micros > 0 {
                insert_grant(
                    transaction,
                    &order.user_id,
                    CreditGrantSource::Subscription,
                    &period_id,
                    order.credit_micros,
                    Some(ends_at),
                    now,
                )?;
            }
        }
        PaymentOrderPurpose::PlanUpgrade => {
            let (plan_id, plan_version_id) = plan.ok_or(CloudStoreError::PaymentOrderIntegrity)?;
            let snapshot = snapshot
                .as_ref()
                .ok_or(CloudStoreError::SubscriptionIntegrity)?;
            if snapshot.status != SubscriptionStatus::Active
                || order.source_period_id.as_deref() != Some(&snapshot.current_period_id)
                || now >= snapshot.current_period_end
                || stale_upgrade_exists(transaction, order)?
            {
                return Err(CloudStoreError::PaymentFulfillmentConflict);
            }
            let target_billing = locked_offer_billing(transaction, &order.offer_id)?;
            if target_billing.provider != order.provider
                || target_billing.region != order.region
                || target_billing.currency != order.currency
            {
                return Err(CloudStoreError::PaymentOrderIntegrity);
            }
            transaction.execute(
                "UPDATE cloud_subscription_period SET plan_id=?1, plan_version_id=?2,
                    billing_provider=?3, billing_region=?4, billing_currency=?5,
                    billing_amount_minor=?6
                 WHERE period_id=?7",
                params![
                    plan_id,
                    plan_version_id,
                    target_billing.provider.as_str(),
                    target_billing.region,
                    target_billing.currency,
                    stored_i64(target_billing.amount_minor)?,
                    snapshot.current_period_id,
                ],
            )?;
            transaction.execute(
                "UPDATE cloud_subscription SET plan_id=?1, plan_version_id=?2, updated_at=?3
                 WHERE user_id=?4",
                params![plan_id, plan_version_id, now.to_rfc3339(), order.user_id,],
            )?;
            if order.credit_micros > 0 {
                insert_grant(
                    transaction,
                    &order.user_id,
                    CreditGrantSource::Subscription,
                    &order.order_id,
                    order.credit_micros,
                    Some(snapshot.current_period_end),
                    now,
                )?;
            }
        }
        PaymentOrderPurpose::EarlyRenewal => {
            let (plan_id, plan_version_id) = plan.ok_or(CloudStoreError::PaymentOrderIntegrity)?;
            let snapshot = snapshot
                .as_ref()
                .ok_or(CloudStoreError::SubscriptionIntegrity)?;
            if order.source_period_id.as_deref() != Some(&snapshot.current_period_id)
                || pending_period(transaction, &order.user_id)?.is_some()
            {
                return Err(CloudStoreError::PaymentFulfillmentConflict);
            }
            let starts_at = order
                .period_starts_at
                .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
            let ends_at = order
                .period_ends_at
                .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
            let status = if starts_at <= now {
                "active"
            } else {
                "pending"
            };
            if status == "active" {
                transaction.execute(
                    "UPDATE cloud_subscription_period SET status='expired'
                     WHERE period_id=?1 AND status='active'",
                    [snapshot.current_period_id.as_str()],
                )?;
            }
            let period_id = insert_period(
                transaction,
                &order.user_id,
                plan_id,
                plan_version_id,
                starts_at,
                ends_at,
                status,
                Some(&PeriodBillingRef {
                    provider: order.provider,
                    region: &order.region,
                    currency: &order.currency,
                    amount_minor: order.amount_minor,
                }),
                now,
            )?;
            if order.credit_micros > 0 {
                insert_grant_available(
                    transaction,
                    &order.user_id,
                    CreditGrantSource::Subscription,
                    &period_id,
                    order.credit_micros,
                    starts_at,
                    Some(ends_at),
                    now,
                )?;
            }
            if status == "active" {
                activate_period(transaction, &order.user_id, &period_id, now)?;
            }
        }
        PaymentOrderPurpose::TopUp => {
            if order.top_up_version_id.is_none() || order.credit_micros == 0 {
                return Err(CloudStoreError::PaymentOrderIntegrity);
            }
            insert_grant(
                transaction,
                &order.user_id,
                CreditGrantSource::TopUp,
                &order.order_id,
                order.credit_micros,
                None,
                now,
            )?;
        }
    }
    Ok(())
}

fn stale_upgrade_exists(
    transaction: &Transaction<'_>,
    order: &PaymentOrder,
) -> Result<bool, CloudStoreError> {
    let source_period_id = order
        .source_period_id
        .as_deref()
        .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
    Ok(transaction.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM cloud_payment_order
            WHERE user_id=?1 AND purpose='plan_upgrade' AND status='fulfilled'
              AND source_period_id=?2 AND order_id!=?3
              AND fulfilled_at>=?4
         )",
        params![
            order.user_id,
            source_period_id,
            order.order_id,
            order.created_at.to_rfc3339(),
        ],
        |row| row.get::<_, bool>(0),
    )?)
}

fn reconcile_subscription(
    transaction: &Transaction<'_>,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<(), CloudStoreError> {
    let Some(snapshot) = super::store::subscription(transaction, user_id)? else {
        return Ok(());
    };
    if snapshot.status == SubscriptionStatus::Active && snapshot.current_period_end <= now {
        transaction.execute(
            "UPDATE cloud_subscription_period SET status='expired' WHERE period_id=?1",
            [snapshot.current_period_id.as_str()],
        )?;
        transaction.execute(
            "UPDATE cloud_subscription SET status='expired', updated_at=?1 WHERE user_id=?2",
            params![now.to_rfc3339(), user_id],
        )?;
    }
    if let Some(period_id) = due_pending_period(transaction, user_id, now)? {
        activate_period(transaction, user_id, &period_id, now)?;
    }
    Ok(())
}

fn activate_period(
    transaction: &Transaction<'_>,
    user_id: &str,
    period_id: &str,
    now: DateTime<Utc>,
) -> Result<(), CloudStoreError> {
    let (plan_id, plan_version_id) = transaction.query_row(
        "SELECT plan_id, plan_version_id FROM cloud_subscription_period
         WHERE period_id=?1 AND user_id=?2",
        params![period_id, user_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    transaction.execute(
        "UPDATE cloud_subscription_period SET status='active' WHERE period_id=?1",
        [period_id],
    )?;
    transaction.execute(
        "UPDATE cloud_subscription SET plan_id=?1, plan_version_id=?2, status='active',
            current_period_id=?3,
            scheduled_plan_id=NULL,
            updated_at=?4 WHERE user_id=?5",
        params![
            plan_id,
            plan_version_id,
            period_id,
            now.to_rfc3339(),
            user_id,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_period(
    transaction: &Transaction<'_>,
    user_id: &str,
    plan_id: &str,
    plan_version_id: &str,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    status: &str,
    billing: Option<&PeriodBillingRef<'_>>,
    now: DateTime<Utc>,
) -> Result<String, CloudStoreError> {
    let subscription_id = transaction.query_row(
        "SELECT subscription_id FROM cloud_subscription WHERE user_id=?1",
        [user_id],
        |row| row.get::<_, String>(0),
    )?;
    let period_id = ulid::Ulid::new().to_string();
    let billing_amount_minor = billing
        .map(|billing| stored_i64(billing.amount_minor))
        .transpose()?;
    let billing_provider = billing.map(|billing| billing.provider.as_str());
    let billing_region = billing.map(|billing| billing.region);
    let billing_currency = billing.map(|billing| billing.currency);
    transaction.execute(
        "INSERT INTO cloud_subscription_period(
            period_id, subscription_id, user_id, plan_id, plan_version_id,
            starts_at, ends_at, status, billing_provider, billing_region,
            billing_currency, billing_amount_minor, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            period_id,
            subscription_id,
            user_id,
            plan_id,
            plan_version_id,
            starts_at.to_rfc3339(),
            ends_at.to_rfc3339(),
            status,
            billing_provider,
            billing_region,
            billing_currency,
            billing_amount_minor,
            now.to_rfc3339(),
        ],
    )?;
    Ok(period_id)
}

#[derive(Debug)]
struct PeriodBillingRef<'a> {
    provider: PaymentProvider,
    region: &'a str,
    currency: &'a str,
    amount_minor: u64,
}

#[derive(Debug)]
struct PeriodBilling {
    provider: PaymentProvider,
    region: String,
    currency: String,
    amount_minor: u64,
}

fn offer_quote(
    transaction: &Transaction<'_>,
    offer_id: &str,
) -> Result<OfferQuote, CloudStoreError> {
    let row = transaction
        .query_row(
            "SELECT o.offer_id, p.plan_id, v.plan_version_id, p.tier_rank, p.is_default,
                    v.monthly_credit_micros, o.payment_provider, o.amount_minor,
                    o.region, o.currency
             FROM cloud_plan_offer o
             JOIN cloud_plan_version v ON v.plan_version_id=o.plan_version_id
             JOIN cloud_plan p ON p.plan_id=v.plan_id
             WHERE o.offer_id=?1 AND o.active=1 AND p.active=1
               AND v.version=(SELECT MAX(latest.version) FROM cloud_plan_version latest
                              WHERE latest.plan_id=p.plan_id)",
            [offer_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?
        .ok_or(CloudStoreError::PlanOfferNotFound)?;
    Ok(OfferQuote {
        offer_id: row.0,
        plan_id: row.1,
        plan_version_id: row.2,
        tier_rank: u32::try_from(row.3).map_err(|_| CloudStoreError::CatalogIntegrity)?,
        is_default: row.4 != 0,
        monthly_credit_micros: stored_u64(row.5)?,
        provider: PaymentProvider::parse(&row.6)
            .ok_or(CloudStoreError::InvalidPaymentProvider(row.6))?,
        amount_minor: stored_u64(row.7)?,
        region: row.8,
        currency: row.9,
    })
}

fn current_plan(
    transaction: &Transaction<'_>,
    plan_version_id: &str,
) -> Result<OfferQuote, CloudStoreError> {
    transaction
        .query_row(
            "SELECT p.plan_id, v.plan_version_id, p.tier_rank, p.is_default,
                    v.monthly_credit_micros
             FROM cloud_plan_version v JOIN cloud_plan p ON p.plan_id=v.plan_id
             WHERE v.plan_version_id=?1",
            [plan_version_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .map_err(CloudStoreError::from)
        .and_then(|row| {
            Ok(OfferQuote {
                offer_id: String::new(),
                plan_id: row.0,
                plan_version_id: row.1,
                tier_rank: u32::try_from(row.2).map_err(|_| CloudStoreError::CatalogIntegrity)?,
                is_default: row.3 != 0,
                monthly_credit_micros: stored_u64(row.4)?,
                provider: PaymentProvider::Test,
                amount_minor: 0,
                region: String::new(),
                currency: String::new(),
            })
        })
}

fn latest_plan(
    transaction: &Transaction<'_>,
    plan_id: &str,
) -> Result<OfferQuote, CloudStoreError> {
    let version_id = transaction
        .query_row(
            "SELECT v.plan_version_id FROM cloud_plan p
             JOIN cloud_plan_version v ON v.plan_id=p.plan_id
             WHERE p.plan_id=?1 AND p.active=1 ORDER BY v.version DESC LIMIT 1",
            [plan_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or(CloudStoreError::InvalidScheduledPlan)?;
    current_plan(transaction, &version_id)
}

fn period_billing(
    transaction: &Transaction<'_>,
    period_id: &str,
) -> Result<PeriodBilling, CloudStoreError> {
    let row = transaction
        .query_row(
            "SELECT billing_provider, billing_region, billing_currency, billing_amount_minor
             FROM cloud_subscription_period WHERE period_id=?1",
            [period_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or(CloudStoreError::SubscriptionIntegrity)?;
    let (Some(provider), Some(region), Some(currency), Some(amount_minor)) = row else {
        return Err(CloudStoreError::PlanUpgradeOfferMismatch);
    };
    Ok(PeriodBilling {
        provider: PaymentProvider::parse(&provider)
            .ok_or(CloudStoreError::SubscriptionIntegrity)?,
        region,
        currency,
        amount_minor: stored_u64(amount_minor)?,
    })
}

fn locked_offer_billing(
    transaction: &Transaction<'_>,
    offer_id: &str,
) -> Result<PeriodBilling, CloudStoreError> {
    let row = transaction
        .query_row(
            "SELECT payment_provider, region, currency, amount_minor
             FROM cloud_plan_offer WHERE offer_id=?1",
            [offer_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
    Ok(PeriodBilling {
        provider: PaymentProvider::parse(&row.0).ok_or(CloudStoreError::PaymentOrderIntegrity)?,
        region: row.1,
        currency: row.2,
        amount_minor: stored_u64(row.3)?,
    })
}

fn pending_period(
    transaction: &Transaction<'_>,
    user_id: &str,
) -> Result<Option<String>, CloudStoreError> {
    Ok(transaction
        .query_row(
            "SELECT period_id FROM cloud_subscription_period
             WHERE user_id=?1 AND status='pending' ORDER BY starts_at LIMIT 1",
            [user_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

fn due_pending_period(
    transaction: &Transaction<'_>,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<Option<String>, CloudStoreError> {
    Ok(transaction
        .query_row(
            "SELECT period_id FROM cloud_subscription_period
             WHERE user_id=?1 AND status='pending' AND starts_at<=?2
             ORDER BY starts_at LIMIT 1",
            params![user_id, now.to_rfc3339()],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

fn payment_order_by_idempotency(
    transaction: &Transaction<'_>,
    user_id: &str,
    idempotency_key: &str,
) -> Result<Option<PaymentOrder>, CloudStoreError> {
    payment_order_query(
        transaction,
        "WHERE user_id=?1 AND idempotency_key=?2",
        params![user_id, idempotency_key],
    )
}

pub(super) fn payment_order_by_id(
    connection: &crate::db::Connection,
    order_id: &str,
) -> Result<Option<PaymentOrder>, CloudStoreError> {
    payment_order_query(connection, "WHERE order_id=?1", [order_id])
}

fn payment_order_query(
    connection: &crate::db::Connection,
    predicate: &str,
    parameters: impl crate::db::Params,
) -> Result<Option<PaymentOrder>, CloudStoreError> {
    let row = connection
        .query_row(
            &format!(
                "SELECT order_id, user_id, purpose, status, provider, provider_order_id,
                        offer_id, plan_id, plan_version_id, top_up_product_id,
                        top_up_version_id, source_period_id, amount_minor, region, currency,
                        credit_micros, period_starts_at, period_ends_at, created_at,
                        expires_at, fulfilled_at
                 FROM cloud_payment_order {predicate}"
            ),
            parameters,
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, i64>(15)?,
                    row.get::<_, Option<String>>(16)?,
                    row.get::<_, Option<String>>(17)?,
                    row.get::<_, String>(18)?,
                    row.get::<_, String>(19)?,
                    row.get::<_, Option<String>>(20)?,
                ))
            },
        )
        .optional()?;
    row.map(|row| {
        Ok(PaymentOrder {
            order_id: row.0,
            user_id: row.1,
            purpose: PaymentOrderPurpose::parse(&row.2)
                .ok_or(CloudStoreError::PaymentOrderIntegrity)?,
            status: PaymentOrderStatus::parse(&row.3)
                .ok_or(CloudStoreError::PaymentOrderIntegrity)?,
            provider: PaymentProvider::parse(&row.4)
                .ok_or(CloudStoreError::InvalidPaymentProvider(row.4))?,
            provider_order_id: row.5,
            offer_id: row.6,
            plan_id: row.7,
            plan_version_id: row.8,
            top_up_product_id: row.9,
            top_up_version_id: row.10,
            source_period_id: row.11,
            amount_minor: stored_u64(row.12)?,
            region: row.13,
            currency: row.14,
            credit_micros: stored_u64(row.15)?,
            period_starts_at: row.16.as_deref().map(parse_time).transpose()?,
            period_ends_at: row.17.as_deref().map(parse_time).transpose()?,
            created_at: parse_time(&row.18)?,
            expires_at: parse_time(&row.19)?,
            fulfilled_at: row.20.as_deref().map(parse_time).transpose()?,
        })
    })
    .transpose()
}

fn validate_idempotency_key(value: &str) -> Result<(), CloudStoreError> {
    if (8..=100).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        Ok(())
    } else {
        Err(CloudStoreError::InvalidIdempotencyKey)
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone as _, Utc};
    use tempfile::TempDir;

    use super::*;
    use crate::cloud::{
        PlanBenefitInput, PlanOfferInput, PublishPlanRequest, CREDIT_MICROS_PER_POINT,
    };

    fn store() -> (TempDir, CloudStore) {
        let root = TempDir::new().unwrap();
        let store = CloudStore::open(root.path(), "").unwrap();
        (root, store)
    }

    fn publish_plan(
        store: &CloudStore,
        slug: &str,
        rank: u32,
        price: u64,
        credits: u64,
        expected_revision: u64,
        now: DateTime<Utc>,
    ) -> String {
        let catalog = store
            .publish_plan(
                &PublishPlanRequest {
                    plan_id: None,
                    slug: slug.into(),
                    display_name: slug.into(),
                    description: slug.into(),
                    display_name_i18n: Default::default(),
                    description_i18n: Default::default(),
                    tier_rank: rank,
                    is_default: false,
                    monthly_credit_micros: credits,
                    offers: vec![PlanOfferInput {
                        region: "CN".into(),
                        currency: "CNY".into(),
                        payment_provider: PaymentProvider::Test,
                        amount_minor: price,
                    }],
                    benefits: Vec::<PlanBenefitInput>::new(),
                    expected_revision,
                },
                now,
            )
            .unwrap();
        catalog
            .plans
            .into_iter()
            .find(|plan| plan.slug == slug)
            .unwrap()
            .offers[0]
            .offer_id
            .clone()
    }

    #[allow(clippy::too_many_arguments)]
    fn publish_plan_offer(
        store: &CloudStore,
        slug: &str,
        rank: u32,
        price: u64,
        credits: u64,
        provider: PaymentProvider,
        region: &str,
        currency: &str,
        expected_revision: u64,
        now: DateTime<Utc>,
    ) -> String {
        let catalog = store
            .publish_plan(
                &PublishPlanRequest {
                    plan_id: None,
                    slug: slug.into(),
                    display_name: slug.into(),
                    description: slug.into(),
                    display_name_i18n: Default::default(),
                    description_i18n: Default::default(),
                    tier_rank: rank,
                    is_default: false,
                    monthly_credit_micros: credits,
                    offers: vec![PlanOfferInput {
                        region: region.into(),
                        currency: currency.into(),
                        payment_provider: provider,
                        amount_minor: price,
                    }],
                    benefits: Vec::<PlanBenefitInput>::new(),
                    expected_revision,
                },
                now,
            )
            .unwrap();
        catalog
            .plans
            .into_iter()
            .find(|plan| plan.slug == slug)
            .unwrap()
            .offers[0]
            .offer_id
            .clone()
    }

    #[test]
    fn purchase_upgrade_downgrade_and_early_renewal_follow_period_rules() {
        let (_root, store) = store();
        let start = Utc.with_ymd_and_hms(2025, 1, 31, 8, 0, 0).unwrap();
        let pro_offer = publish_plan(
            &store,
            "pro",
            10,
            3_000,
            100 * CREDIT_MICROS_PER_POINT,
            0,
            start,
        );
        let max_offer = publish_plan(
            &store,
            "max",
            20,
            6_000,
            300 * CREDIT_MICROS_PER_POINT,
            1,
            start,
        );
        let free = store
            .ensure_default_subscription("user-1", "Asia/Shanghai", start)
            .unwrap();
        let purchase = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: pro_offer.clone(),
                    idempotency_key: "purchase-pro-1".into(),
                },
                start,
            )
            .unwrap();
        assert_eq!(purchase.purpose, PaymentOrderPurpose::PlanPurchase);
        let purchase = store
            .fulfill_payment_order(&purchase.order_id, "provider-purchase-1", start)
            .unwrap();
        assert_eq!(purchase.status, PaymentOrderStatus::Fulfilled);
        let pro = store.subscription("user-1").unwrap().unwrap();
        assert_ne!(pro.current_period_id, free.current_period_id);
        assert_eq!(
            pro.current_period_end,
            Utc.with_ymd_and_hms(2025, 2, 28, 8, 0, 0).unwrap()
        );

        let halfway = Utc.with_ymd_and_hms(2025, 2, 14, 8, 0, 0).unwrap();
        let upgrade = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: max_offer,
                    idempotency_key: "upgrade-max-1".into(),
                },
                halfway,
            )
            .unwrap();
        assert_eq!(upgrade.purpose, PaymentOrderPurpose::PlanUpgrade);
        assert_eq!(upgrade.amount_minor, 1_500);
        assert_eq!(upgrade.credit_micros, 100 * CREDIT_MICROS_PER_POINT);
        store
            .fulfill_payment_order(&upgrade.order_id, "provider-upgrade-1", halfway)
            .unwrap();
        let max = store.subscription("user-1").unwrap().unwrap();
        assert_eq!(max.current_period_id, pro.current_period_id);

        let pro_plan_id = store
            .plan_catalog(halfway)
            .unwrap()
            .plans
            .into_iter()
            .find(|plan| plan.slug == "pro")
            .unwrap()
            .plan_id;
        let scheduled = store
            .schedule_plan_change(
                "user-1",
                &SchedulePlanChangeRequest {
                    plan_id: pro_plan_id,
                    expected_period_id: max.current_period_id.clone(),
                },
                halfway,
            )
            .unwrap();
        assert!(scheduled.scheduled_plan_id.is_some());
        let renewal = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: pro_offer,
                    idempotency_key: "renew-pro-1".into(),
                },
                halfway,
            )
            .unwrap();
        assert_eq!(renewal.purpose, PaymentOrderPurpose::EarlyRenewal);
        store
            .fulfill_payment_order(&renewal.order_id, "provider-renew-1", halfway)
            .unwrap();

        let before = store.wallet_summary("user-1", halfway).unwrap();
        assert_eq!(
            before.available_credit_micros,
            200 * CREDIT_MICROS_PER_POINT
        );
        let next_start = max.current_period_end;
        let renewed = store
            .reconcile_subscription("user-1", next_start)
            .unwrap()
            .unwrap();
        assert_eq!(renewed.current_period_start, next_start);
        assert_eq!(renewed.scheduled_plan_id, None);
        assert_eq!(
            renewed.current_period_end,
            Utc.with_ymd_and_hms(2025, 3, 31, 8, 0, 0).unwrap()
        );
        let after = store.wallet_summary("user-1", next_start).unwrap();
        assert_eq!(after.available_credit_micros, 100 * CREDIT_MICROS_PER_POINT);
    }

    #[test]
    fn verified_payment_event_is_idempotent() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 4, 1, 0, 0, 0).unwrap();
        let offer = publish_plan(&store, "pro", 10, 3_000, 100_000_000, 0, now);
        store
            .ensure_default_subscription("user-1", "UTC", now)
            .unwrap();
        let order = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: offer,
                    idempotency_key: "verified-event-order".into(),
                },
                now,
            )
            .unwrap();
        store
            .attach_provider_order(&order.order_id, "provider-order-1")
            .unwrap();
        for _ in 0..2 {
            let fulfilled = store
                .process_verified_payment_event(
                    PaymentProvider::Test,
                    "event-1",
                    "payload-hash-1",
                    &order.order_id,
                    "provider-order-1",
                    now,
                )
                .unwrap();
            assert_eq!(fulfilled.status, PaymentOrderStatus::Fulfilled);
        }
        assert_eq!(
            store
                .wallet_summary("user-1", now)
                .unwrap()
                .expiring_credit_micros,
            100_000_000
        );
    }

    #[test]
    fn upgrade_requires_matching_provider_region_and_currency() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 4, 1, 0, 0, 0).unwrap();
        let pro = store
            .publish_plan(
                &PublishPlanRequest {
                    plan_id: None,
                    slug: "pro".into(),
                    display_name: "pro".into(),
                    description: "pro".into(),
                    display_name_i18n: Default::default(),
                    description_i18n: Default::default(),
                    tier_rank: 10,
                    is_default: false,
                    monthly_credit_micros: 100_000_000,
                    offers: vec![
                        PlanOfferInput {
                            region: "CN".into(),
                            currency: "CNY".into(),
                            payment_provider: PaymentProvider::Test,
                            amount_minor: 3_000,
                        },
                        PlanOfferInput {
                            region: "US".into(),
                            currency: "USD".into(),
                            payment_provider: PaymentProvider::Stripe,
                            amount_minor: 1_000,
                        },
                    ],
                    benefits: Vec::new(),
                    expected_revision: 0,
                },
                now,
            )
            .unwrap();
        let pro_offer = pro
            .plans
            .into_iter()
            .find(|plan| plan.slug == "pro")
            .unwrap()
            .offers
            .into_iter()
            .find(|offer| offer.payment_provider == PaymentProvider::Test)
            .unwrap()
            .offer_id;
        let max_offer = publish_plan_offer(
            &store,
            "max",
            20,
            1_000,
            300_000_000,
            PaymentProvider::Stripe,
            "US",
            "USD",
            1,
            now,
        );
        store
            .ensure_default_subscription("user-1", "UTC", now)
            .unwrap();
        let purchase = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: pro_offer,
                    idempotency_key: "purchase-pro-mismatch".into(),
                },
                now,
            )
            .unwrap();
        store
            .fulfill_payment_order(&purchase.order_id, "provider-purchase", now)
            .unwrap();

        let result = store.create_plan_order(
            "user-1",
            &CreatePlanOrderRequest {
                offer_id: max_offer,
                idempotency_key: "upgrade-provider-mismatch".into(),
            },
            now + Duration::days(1),
        );
        assert!(matches!(
            result,
            Err(CloudStoreError::PlanUpgradeOfferMismatch)
        ));
    }

    #[test]
    fn only_one_concurrently_quoted_upgrade_can_be_fulfilled() {
        let (_root, store) = store();
        let start = Utc.with_ymd_and_hms(2025, 4, 1, 0, 0, 0).unwrap();
        let pro_offer = publish_plan(&store, "pro", 10, 3_000, 100_000_000, 0, start);
        let max_offer = publish_plan(&store, "max", 20, 6_000, 300_000_000, 1, start);
        let ultra_offer = publish_plan(&store, "ultra", 30, 9_000, 600_000_000, 2, start);
        store
            .ensure_default_subscription("user-1", "UTC", start)
            .unwrap();
        let purchase = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: pro_offer,
                    idempotency_key: "purchase-before-race".into(),
                },
                start,
            )
            .unwrap();
        store
            .fulfill_payment_order(&purchase.order_id, "provider-purchase", start)
            .unwrap();

        let quote_time = start + Duration::days(1);
        let max_order = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: max_offer,
                    idempotency_key: "upgrade-max-race".into(),
                },
                quote_time,
            )
            .unwrap();
        let ultra_order = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: ultra_offer,
                    idempotency_key: "upgrade-ultra-race".into(),
                },
                quote_time,
            )
            .unwrap();
        let fulfilled = store
            .fulfill_payment_order(&max_order.order_id, "provider-max", quote_time)
            .unwrap();
        assert_eq!(fulfilled.status, PaymentOrderStatus::Fulfilled);
        let rejected = store
            .fulfill_payment_order(&ultra_order.order_id, "provider-ultra", quote_time)
            .unwrap();
        assert_eq!(rejected.status, PaymentOrderStatus::ActionRequired);
        assert_eq!(
            store.subscription("user-1").unwrap().unwrap().plan_id,
            max_order.plan_id.unwrap()
        );
    }

    #[test]
    fn paid_next_period_choice_clears_an_unused_scheduled_downgrade() {
        let (_root, store) = store();
        let start = Utc.with_ymd_and_hms(2025, 4, 1, 0, 0, 0).unwrap();
        let _pro_offer = publish_plan(&store, "pro", 10, 3_000, 100_000_000, 0, start);
        let max_offer = publish_plan(&store, "max", 20, 6_000, 300_000_000, 1, start);
        store
            .ensure_default_subscription("user-1", "UTC", start)
            .unwrap();
        let purchase = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: max_offer.clone(),
                    idempotency_key: "purchase-max-before-renewal".into(),
                },
                start,
            )
            .unwrap();
        store
            .fulfill_payment_order(&purchase.order_id, "provider-purchase", start)
            .unwrap();
        let active = store.subscription("user-1").unwrap().unwrap();
        let pro_plan_id = store
            .plan_catalog(start)
            .unwrap()
            .plans
            .into_iter()
            .find(|plan| plan.slug == "pro")
            .unwrap()
            .plan_id;
        store
            .schedule_plan_change(
                "user-1",
                &SchedulePlanChangeRequest {
                    plan_id: pro_plan_id,
                    expected_period_id: active.current_period_id.clone(),
                },
                start + Duration::days(1),
            )
            .unwrap();
        let renewal = store
            .create_plan_order(
                "user-1",
                &CreatePlanOrderRequest {
                    offer_id: max_offer,
                    idempotency_key: "renew-max-instead-of-downgrade".into(),
                },
                start + Duration::days(1),
            )
            .unwrap();
        store
            .fulfill_payment_order(
                &renewal.order_id,
                "provider-renewal",
                start + Duration::days(1),
            )
            .unwrap();
        assert!(matches!(
            store.schedule_plan_change(
                "user-1",
                &SchedulePlanChangeRequest {
                    plan_id: store
                        .plan_catalog(start)
                        .unwrap()
                        .plans
                        .into_iter()
                        .find(|plan| plan.slug == "pro")
                        .unwrap()
                        .plan_id,
                    expected_period_id: active.current_period_id,
                },
                start + Duration::days(2),
            ),
            Err(CloudStoreError::PendingRenewalExists)
        ));
        let renewed = store
            .reconcile_subscription("user-1", active.current_period_end)
            .unwrap()
            .unwrap();
        assert_eq!(renewed.plan_id, renewal.plan_id.unwrap());
        assert_eq!(renewed.scheduled_plan_id, None);
    }
}

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

use super::store::{stored_i64, stored_u64};
use super::{
    CloudStore, CloudStoreError, CreateTopUpOrderRequest, PaymentOrder, PaymentProvider, PlanOffer,
    PublishTopUpProductRequest, TopUpCatalog, TopUpProductSummary,
};

const ORDER_TTL_MINUTES: i64 = 60;

impl CloudStore {
    pub fn top_up_catalog(&self, now: DateTime<Utc>) -> Result<TopUpCatalog, CloudStoreError> {
        let connection = self.connection()?;
        catalog(&connection, now)
    }

    pub fn publish_top_up_product(
        &self,
        request: &PublishTopUpProductRequest,
        now: DateTime<Utc>,
    ) -> Result<TopUpCatalog, CloudStoreError> {
        validate_product(request)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let revision = revision(&transaction)?;
        if revision != request.expected_revision {
            return Err(CloudStoreError::RevisionConflict {
                expected: request.expected_revision,
                actual: revision,
            });
        }
        let product_id = request
            .product_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| ulid::Ulid::new().to_string());
        let existing = transaction
            .query_row(
                "SELECT product_id FROM cloud_top_up_product WHERE slug=?1",
                [request.slug.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if existing
            .as_deref()
            .is_some_and(|existing| existing != product_id)
        {
            return Err(CloudStoreError::TopUpSlugConflict(request.slug.clone()));
        }
        transaction.execute(
            "INSERT INTO cloud_top_up_product(
                product_id, slug, display_name, description, active, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
             ON CONFLICT(product_id) DO UPDATE SET slug=excluded.slug,
                display_name=excluded.display_name, description=excluded.description,
                active=1, updated_at=excluded.updated_at",
            params![
                product_id,
                request.slug,
                request.display_name,
                request.description,
                now.to_rfc3339(),
            ],
        )?;
        let version = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0)+1 FROM cloud_top_up_product_version
             WHERE product_id=?1",
            [product_id.as_str()],
            |row| row.get::<_, i64>(0),
        )?;
        let product_version_id = ulid::Ulid::new().to_string();
        transaction.execute(
            "INSERT INTO cloud_top_up_product_version(
                product_version_id, product_id, version, credit_micros, published_at, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                product_version_id,
                product_id,
                version,
                stored_i64(request.credit_micros)?,
                now.to_rfc3339(),
            ],
        )?;
        for offer in &request.offers {
            transaction.execute(
                "INSERT INTO cloud_top_up_offer(
                    offer_id, product_version_id, region, currency, payment_provider,
                    amount_minor, active, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
                params![
                    ulid::Ulid::new().to_string(),
                    product_version_id,
                    offer.region,
                    offer.currency,
                    offer.payment_provider.as_str(),
                    stored_i64(offer.amount_minor)?,
                    now.to_rfc3339(),
                ],
            )?;
        }
        transaction.execute(
            "UPDATE cloud_config_revision SET revision=revision+1 WHERE domain='topups'",
            [],
        )?;
        let result = catalog(&transaction, now)?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn create_top_up_order(
        &self,
        user_id: &str,
        request: &CreateTopUpOrderRequest,
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, CloudStoreError> {
        validate_idempotency_key(&request.idempotency_key)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = transaction
            .query_row(
                "SELECT order_id, offer_id FROM cloud_payment_order
                 WHERE user_id=?1 AND idempotency_key=?2",
                params![user_id, request.idempotency_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
        {
            if existing.1 != request.offer_id {
                return Err(CloudStoreError::IdempotencyConflict);
            }
            let order = super::billing::payment_order_by_id(&transaction, &existing.0)?
                .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
            transaction.commit()?;
            return Ok(order);
        }
        let quote = transaction
            .query_row(
                "SELECT o.offer_id, p.product_id, v.product_version_id, v.credit_micros,
                        o.payment_provider, o.amount_minor, o.region, o.currency
                 FROM cloud_top_up_offer o
                 JOIN cloud_top_up_product_version v ON v.product_version_id=o.product_version_id
                 JOIN cloud_top_up_product p ON p.product_id=v.product_id
                 WHERE o.offer_id=?1 AND o.active=1 AND p.active=1
                   AND v.version=(SELECT MAX(latest.version)
                                  FROM cloud_top_up_product_version latest
                                  WHERE latest.product_id=p.product_id)",
                [request.offer_id.as_str()],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CloudStoreError::TopUpOfferNotFound)?;
        let provider = PaymentProvider::parse(&quote.4)
            .ok_or_else(|| CloudStoreError::InvalidPaymentProvider(quote.4.clone()))?;
        let order_id = ulid::Ulid::new().to_string();
        transaction.execute(
            "INSERT INTO cloud_payment_order(
                order_id, user_id, idempotency_key, purpose, status, provider,
                provider_order_id, offer_id, plan_id, plan_version_id,
                top_up_product_id, top_up_version_id, source_period_id,
                amount_minor, region, currency, credit_micros, period_starts_at,
                period_ends_at, created_at, expires_at, paid_at, fulfilled_at, failure_reason
             ) VALUES (
                ?1, ?2, ?3, 'top_up', 'pending', ?4, NULL, ?5, NULL, NULL,
                ?6, ?7, NULL, ?8, ?9, ?10, ?11, NULL, NULL, ?12, ?13,
                NULL, NULL, NULL
             )",
            params![
                order_id,
                user_id,
                request.idempotency_key,
                provider.as_str(),
                quote.0,
                quote.1,
                quote.2,
                quote.5,
                quote.6,
                quote.7,
                quote.3,
                now.to_rfc3339(),
                (now + Duration::minutes(ORDER_TTL_MINUTES)).to_rfc3339(),
            ],
        )?;
        let order = super::billing::payment_order_by_id(&transaction, &order_id)?
            .ok_or(CloudStoreError::PaymentOrderIntegrity)?;
        transaction.commit()?;
        Ok(order)
    }
}

fn catalog(
    connection: &rusqlite::Connection,
    now: DateTime<Utc>,
) -> Result<TopUpCatalog, CloudStoreError> {
    let mut statement = connection.prepare(
        "SELECT p.product_id, v.product_version_id, v.version, p.slug, p.display_name,
                p.description, v.credit_micros, v.published_at
         FROM cloud_top_up_product p
         JOIN cloud_top_up_product_version v ON v.product_id=p.product_id
         WHERE p.active=1 AND v.version=(SELECT MAX(latest.version)
              FROM cloud_top_up_product_version latest WHERE latest.product_id=p.product_id)
         ORDER BY v.credit_micros, p.product_id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut products = Vec::with_capacity(rows.len());
    for row in rows {
        products.push(TopUpProductSummary {
            product_id: row.0,
            product_version_id: row.1.clone(),
            version: u32::try_from(row.2).map_err(|_| CloudStoreError::TopUpCatalogIntegrity)?,
            slug: row.3,
            display_name: row.4,
            description: row.5,
            credit_micros: stored_u64(row.6)?,
            offers: offers(connection, &row.1)?,
            published_at: super::store::parse_time(&row.7)?,
        });
    }
    Ok(TopUpCatalog {
        revision: revision(connection)?,
        products,
        generated_at: now,
    })
}

fn offers(
    connection: &rusqlite::Connection,
    version_id: &str,
) -> Result<Vec<PlanOffer>, CloudStoreError> {
    let mut statement = connection.prepare(
        "SELECT offer_id, region, currency, payment_provider, amount_minor
         FROM cloud_top_up_offer WHERE product_version_id=?1 AND active=1
         ORDER BY region, currency, payment_provider",
    )?;
    let offers = statement
        .query_map([version_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .map(|row| -> Result<PlanOffer, CloudStoreError> {
            let row = row?;
            Ok(PlanOffer {
                offer_id: row.0,
                region: row.1,
                currency: row.2,
                payment_provider: PaymentProvider::parse(&row.3)
                    .ok_or(CloudStoreError::InvalidPaymentProvider(row.3))?,
                amount_minor: stored_u64(row.4)?,
            })
        })
        .collect();
    offers
}

fn revision(connection: &rusqlite::Connection) -> Result<u64, CloudStoreError> {
    let value = connection.query_row(
        "SELECT revision FROM cloud_config_revision WHERE domain='topups'",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    stored_u64(value)
}

fn validate_product(request: &PublishTopUpProductRequest) -> Result<(), CloudStoreError> {
    let slug_valid = (2..=64).contains(&request.slug.len())
        && request.slug.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        });
    if !slug_valid
        || request.display_name.trim().is_empty()
        || request.display_name.chars().count() > 100
        || request.description.chars().count() > 500
        || request.credit_micros == 0
        || request.offers.is_empty()
        || request.offers.iter().any(|offer| {
            offer.region.trim().is_empty() || offer.currency.len() != 3 || offer.amount_minor == 0
        })
    {
        return Err(CloudStoreError::InvalidTopUpProduct);
    }
    Ok(())
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
    use crate::cloud::{PaymentOrderStatus, PlanOfferInput};

    #[test]
    fn top_up_order_grants_permanent_credits_once() {
        let root = TempDir::new().unwrap();
        let store = CloudStore::open(root.path()).unwrap();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        store
            .ensure_default_subscription("user-1", "UTC", now)
            .unwrap();
        let catalog = store
            .publish_top_up_product(
                &PublishTopUpProductRequest {
                    product_id: None,
                    slug: "credits-100".into(),
                    display_name: "100 credits".into(),
                    description: "Permanent credits".into(),
                    credit_micros: 100_000_000,
                    offers: vec![PlanOfferInput {
                        region: "GLOBAL".into(),
                        currency: "USD".into(),
                        payment_provider: PaymentProvider::Test,
                        amount_minor: 999,
                    }],
                    expected_revision: 0,
                },
                now,
            )
            .unwrap();
        let order = store
            .create_top_up_order(
                "user-1",
                &CreateTopUpOrderRequest {
                    offer_id: catalog.products[0].offers[0].offer_id.clone(),
                    idempotency_key: "topup-order-1".into(),
                },
                now,
            )
            .unwrap();
        let fulfilled = store
            .fulfill_payment_order(&order.order_id, "provider-topup-1", now)
            .unwrap();
        assert_eq!(fulfilled.status, PaymentOrderStatus::Fulfilled);
        store
            .fulfill_payment_order(&order.order_id, "provider-topup-1", now)
            .unwrap();
        let wallet = store.wallet_summary("user-1", now).unwrap();
        assert_eq!(wallet.permanent_credit_micros, 100_000_000);
        assert_eq!(wallet.expiring_credit_micros, 0);
    }
}

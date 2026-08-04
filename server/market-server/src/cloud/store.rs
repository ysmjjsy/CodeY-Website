use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use crate::db::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use chrono::{DateTime, Duration, Utc};
use thiserror::Error;

use super::contracts::{
    CreditGrantSource, CreditReservation, CreditReservationStatus, OAuthDeviceSession,
    OAuthTokenPair, SubscriptionSnapshot, SubscriptionStatus, WalletSummary,
};
use super::natural_month_period_end;

pub(super) const DEFAULT_PLAN_ID: &str = "plan-free";
const DEFAULT_PLAN_VERSION_ID: &str = "plan-free-v1";
const ACCESS_TOKEN_TTL_MINUTES: i64 = 15;
const REFRESH_TOKEN_TTL_DAYS: i64 = 30;

#[derive(Clone)]
pub struct CloudStore {
    pub(super) connection: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for CloudStore {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("CloudStore").finish_non_exhaustive()
    }
}

impl CloudStore {
    pub fn open(root: impl Into<PathBuf>, database_url: &str) -> Result<Self, CloudStoreError> {
        let root = root.into();
        std::fs::create_dir_all(&root)?;
        let connection = crate::db::connect(root.join("marketplace.sqlite3"), database_url)?;
        migrate(&connection)?;
        seed_default_plan(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn ensure_default_subscription(
        &self,
        user_id: &str,
        billing_timezone: &str,
        now: DateTime<Utc>,
    ) -> Result<SubscriptionSnapshot, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_wallet(&transaction, user_id, now)?;
        if let Some(snapshot) = subscription(&transaction, user_id)? {
            transaction.commit()?;
            return Ok(snapshot);
        }
        let anchor_day = now
            .with_timezone(
                &billing_timezone.parse::<chrono_tz::Tz>().map_err(|_| {
                    CloudStoreError::InvalidBillingTimezone(billing_timezone.into())
                })?,
            )
            .day();
        let period_end = natural_month_period_end(now, billing_timezone, anchor_day)?;
        let (plan_id, plan_version_id, monthly_credit_micros) = default_plan(&transaction)?;
        let subscription_id = ulid::Ulid::new().to_string();
        let period_id = ulid::Ulid::new().to_string();
        transaction.execute(
            "INSERT INTO cloud_subscription(
                subscription_id, user_id, plan_id, plan_version_id, status,
                billing_timezone, billing_anchor_day, current_period_id, scheduled_plan_id,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6, ?7, NULL, ?8, ?8)",
            params![
                subscription_id,
                user_id,
                plan_id,
                plan_version_id,
                billing_timezone,
                anchor_day,
                period_id,
                now.to_rfc3339(),
            ],
        )?;
        transaction.execute(
            "INSERT INTO cloud_subscription_period(
                period_id, subscription_id, user_id, plan_id, plan_version_id,
                starts_at, ends_at, status, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?6)",
            params![
                period_id,
                subscription_id,
                user_id,
                plan_id,
                plan_version_id,
                now.to_rfc3339(),
                period_end.to_rfc3339(),
            ],
        )?;
        if monthly_credit_micros > 0 {
            insert_grant(
                &transaction,
                user_id,
                CreditGrantSource::Subscription,
                &period_id,
                monthly_credit_micros,
                Some(period_end),
                now,
            )?;
        }
        let snapshot =
            subscription(&transaction, user_id)?.ok_or(CloudStoreError::SubscriptionIntegrity)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    pub fn subscription(
        &self,
        user_id: &str,
    ) -> Result<Option<SubscriptionSnapshot>, CloudStoreError> {
        let connection = self.connection()?;
        subscription(&connection, user_id)
    }

    pub fn grant_credits(
        &self,
        user_id: &str,
        source: CreditGrantSource,
        source_id: &str,
        amount_credit_micros: u64,
        expires_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<String, CloudStoreError> {
        if amount_credit_micros == 0 {
            return Err(CloudStoreError::ZeroCreditAmount);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_wallet(&transaction, user_id, now)?;
        let grant_id = insert_grant(
            &transaction,
            user_id,
            source,
            source_id,
            amount_credit_micros,
            expires_at,
            now,
        )?;
        transaction.commit()?;
        Ok(grant_id)
    }

    pub fn wallet_summary(
        &self,
        user_id: &str,
        now: DateTime<Utc>,
    ) -> Result<WalletSummary, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        release_expired_reservations(&transaction, user_id, now)?;
        expire_grants(&transaction, user_id, now)?;
        let mut statement = transaction.prepare(
            "SELECT remaining_credit_micros, reserved_credit_micros, expires_at
             FROM cloud_credit_grant
             WHERE user_id=?1 AND available_at<=?2 AND (expires_at IS NULL OR expires_at>?2)",
        )?;
        let rows = statement.query_map(params![user_id, now.to_rfc3339()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        let mut available = 0_u64;
        let mut reserved = 0_u64;
        let mut expiring = 0_u64;
        let mut permanent = 0_u64;
        for row in rows {
            let (remaining, held, expires_at) = row?;
            let remaining = stored_u64(remaining)?;
            let held = stored_u64(held)?;
            let usable = remaining
                .checked_sub(held)
                .ok_or(CloudStoreError::WalletIntegrity)?;
            available = available
                .checked_add(usable)
                .ok_or(CloudStoreError::CreditOverflow)?;
            reserved = reserved
                .checked_add(held)
                .ok_or(CloudStoreError::CreditOverflow)?;
            if expires_at.is_some() {
                expiring = expiring
                    .checked_add(usable)
                    .ok_or(CloudStoreError::CreditOverflow)?;
            } else {
                permanent = permanent
                    .checked_add(usable)
                    .ok_or(CloudStoreError::CreditOverflow)?;
            }
        }
        drop(statement);
        transaction.commit()?;
        Ok(WalletSummary {
            user_id: user_id.to_owned(),
            available_credit_micros: available,
            reserved_credit_micros: reserved,
            expiring_credit_micros: expiring,
            permanent_credit_micros: permanent,
            generated_at: now,
        })
    }

    pub fn reserve_credits(
        &self,
        user_id: &str,
        request_id: &str,
        amount_credit_micros: u64,
        now: DateTime<Utc>,
        ttl: Duration,
    ) -> Result<CreditReservation, CloudStoreError> {
        if amount_credit_micros == 0 || ttl <= Duration::zero() {
            return Err(CloudStoreError::InvalidReservation);
        }
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        release_expired_reservations(&transaction, user_id, now)?;
        expire_grants(&transaction, user_id, now)?;
        if let Some(existing) = reservation_by_request(&transaction, user_id, request_id)? {
            if existing.requested_credit_micros != amount_credit_micros {
                return Err(CloudStoreError::IdempotencyConflict);
            }
            transaction.commit()?;
            return Ok(existing);
        }
        let amount = stored_i64(amount_credit_micros)?;
        let mut statement = transaction.prepare(
            "SELECT grant_id, remaining_credit_micros, reserved_credit_micros
             FROM cloud_credit_grant
             WHERE user_id=?1
               AND available_at<=?2
               AND (expires_at IS NULL OR expires_at>?2)
               AND remaining_credit_micros>reserved_credit_micros
             ORDER BY expires_at IS NULL ASC, expires_at ASC, created_at ASC, grant_id ASC",
        )?;
        let grants = statement
            .query_map(params![user_id, now.to_rfc3339()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let available = grants
            .iter()
            .try_fold(0_i64, |total, (_, remaining, held)| {
                total
                    .checked_add(remaining - held)
                    .ok_or(CloudStoreError::CreditOverflow)
            })?;
        if available < amount {
            return Err(CloudStoreError::InsufficientCredits {
                required: amount_credit_micros,
                available: stored_u64(available)?,
            });
        }
        let reservation_id = ulid::Ulid::new().to_string();
        let expires_at = now + ttl;
        transaction.execute(
            "INSERT INTO cloud_credit_reservation(
                reservation_id, request_id, user_id, status, requested_credit_micros,
                settled_credit_micros, created_at, expires_at, updated_at
             ) VALUES (?1, ?2, ?3, 'reserved', ?4, 0, ?5, ?6, ?5)",
            params![
                reservation_id,
                request_id,
                user_id,
                amount,
                now.to_rfc3339(),
                expires_at.to_rfc3339(),
            ],
        )?;
        let mut remaining_to_reserve = amount;
        for (grant_id, remaining, held) in grants {
            if remaining_to_reserve == 0 {
                break;
            }
            let allocation = (remaining - held).min(remaining_to_reserve);
            transaction.execute(
                "UPDATE cloud_credit_grant
                 SET reserved_credit_micros=reserved_credit_micros+?1, updated_at=?2
                 WHERE grant_id=?3",
                params![allocation, now.to_rfc3339(), grant_id],
            )?;
            transaction.execute(
                "INSERT INTO cloud_credit_reservation_allocation(
                    reservation_id, grant_id, reserved_credit_micros, settled_credit_micros
                 ) VALUES (?1, ?2, ?3, 0)",
                params![reservation_id, grant_id, allocation],
            )?;
            remaining_to_reserve -= allocation;
        }
        ledger(
            &transaction,
            user_id,
            "reserve",
            0,
            Some(&reservation_id),
            None,
            now,
        )?;
        let reservation = reservation_by_id(&transaction, &reservation_id)?
            .ok_or(CloudStoreError::ReservationIntegrity)?;
        transaction.commit()?;
        Ok(reservation)
    }

    pub fn settle_reservation(
        &self,
        user_id: &str,
        request_id: &str,
        actual_credit_micros: u64,
        now: DateTime<Utc>,
    ) -> Result<CreditReservation, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = reservation_by_request(&transaction, user_id, request_id)?
            .ok_or(CloudStoreError::ReservationNotFound)?;
        if existing.status != CreditReservationStatus::Reserved {
            if existing.settled_credit_micros == actual_credit_micros {
                transaction.commit()?;
                return Ok(existing);
            }
            return Err(CloudStoreError::IdempotencyConflict);
        }
        if actual_credit_micros > existing.requested_credit_micros {
            return Err(CloudStoreError::SettlementExceedsReservation);
        }
        let actual = stored_i64(actual_credit_micros)?;
        let mut statement = transaction.prepare(
            "SELECT a.grant_id, a.reserved_credit_micros, g.expires_at
             FROM cloud_credit_reservation_allocation a
             JOIN cloud_credit_grant g ON g.grant_id=a.grant_id
             WHERE a.reservation_id=?1
             ORDER BY g.expires_at IS NULL ASC, g.expires_at ASC, g.created_at ASC, g.grant_id ASC",
        )?;
        let allocations = statement
            .query_map([existing.reservation_id.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let mut remaining_to_settle = actual;
        let mut released = 0_i64;
        for (grant_id, reserved, expires_at) in allocations {
            let settled = reserved.min(remaining_to_settle);
            let release = reserved - settled;
            let expired = expires_at
                .as_deref()
                .map(parse_time)
                .transpose()?
                .is_some_and(|expires_at| expires_at <= now);
            let remaining_decrement = if expired { settled + release } else { settled };
            transaction.execute(
                "UPDATE cloud_credit_grant
                 SET remaining_credit_micros=remaining_credit_micros-?1,
                     reserved_credit_micros=reserved_credit_micros-?2,
                     updated_at=?3
                 WHERE grant_id=?4",
                params![remaining_decrement, reserved, now.to_rfc3339(), grant_id],
            )?;
            transaction.execute(
                "UPDATE cloud_credit_reservation_allocation
                 SET settled_credit_micros=?1
                 WHERE reservation_id=?2 AND grant_id=?3",
                params![settled, existing.reservation_id, grant_id],
            )?;
            if expired && release > 0 {
                ledger(
                    &transaction,
                    user_id,
                    "expire",
                    -release,
                    Some(&existing.reservation_id),
                    Some(&grant_id),
                    now,
                )?;
            }
            remaining_to_settle -= settled;
            released += release;
        }
        if remaining_to_settle != 0 {
            return Err(CloudStoreError::ReservationIntegrity);
        }
        let status = if actual == 0 {
            CreditReservationStatus::Released
        } else {
            CreditReservationStatus::Settled
        };
        transaction.execute(
            "UPDATE cloud_credit_reservation
             SET status=?1, settled_credit_micros=?2, updated_at=?3
             WHERE reservation_id=?4",
            params![
                status.as_str(),
                actual,
                now.to_rfc3339(),
                existing.reservation_id,
            ],
        )?;
        if actual > 0 {
            ledger(
                &transaction,
                user_id,
                "settle",
                -actual,
                Some(&existing.reservation_id),
                None,
                now,
            )?;
        }
        if released > 0 {
            ledger(
                &transaction,
                user_id,
                "release",
                0,
                Some(&existing.reservation_id),
                None,
                now,
            )?;
        }
        let reservation = reservation_by_id(&transaction, &existing.reservation_id)?
            .ok_or(CloudStoreError::ReservationIntegrity)?;
        transaction.commit()?;
        Ok(reservation)
    }

    pub fn create_oauth_authorization_code(
        &self,
        user_id: &str,
        client_id: &str,
        redirect_uri: &str,
        code_challenge: &str,
        scope: &str,
        now: DateTime<Utc>,
    ) -> Result<String, CloudStoreError> {
        let code = crate::auth::random_token(32)?;
        let code_hash = crate::auth::token_hash(&code);
        self.connection()?.execute(
            "INSERT INTO cloud_oauth_authorization_code(
                code_hash, user_id, client_id, redirect_uri, code_challenge, scope,
                created_at, expires_at, consumed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            params![
                code_hash,
                user_id,
                client_id,
                redirect_uri,
                code_challenge,
                scope,
                now.to_rfc3339(),
                (now + Duration::minutes(5)).to_rfc3339(),
            ],
        )?;
        Ok(code)
    }

    pub fn exchange_oauth_authorization_code(
        &self,
        code: &str,
        code_verifier: &str,
        client_id: &str,
        redirect_uri: &str,
        device_name: &str,
        now: DateTime<Utc>,
    ) -> Result<OAuthTokenPair, CloudStoreError> {
        let code_hash = crate::auth::token_hash(code);
        let challenge = crate::auth::pkce_challenge(code_verifier);
        let access_token = crate::auth::random_token(32)?;
        let refresh_token = crate::auth::random_token(48)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let record = transaction
            .query_row(
                "SELECT user_id, client_id, redirect_uri, code_challenge, scope, expires_at,
                        consumed_at
                 FROM cloud_oauth_authorization_code WHERE code_hash=?1",
                [&code_hash],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Option<String>>(6)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CloudStoreError::InvalidOAuthGrant)?;
        let (user_id, stored_client, stored_redirect, stored_challenge, scope, expires, consumed) =
            record;
        if stored_client != client_id
            || stored_redirect != redirect_uri
            || stored_challenge != challenge
            || consumed.is_some()
            || parse_time(&expires)? <= now
        {
            return Err(CloudStoreError::InvalidOAuthGrant);
        }
        transaction.execute(
            "UPDATE cloud_oauth_authorization_code SET consumed_at=?1 WHERE code_hash=?2",
            params![now.to_rfc3339(), code_hash],
        )?;
        let device_id = ulid::Ulid::new().to_string();
        let family_id = ulid::Ulid::new().to_string();
        insert_oauth_tokens(
            &transaction,
            &OAuthTokenIssue {
                user_id: &user_id,
                client_id,
                device_id: &device_id,
                device_name,
                family_id: &family_id,
                scope: &scope,
                access_token: &access_token,
                refresh_token: &refresh_token,
                now,
            },
        )?;
        transaction.commit()?;
        Ok(OAuthTokenPair {
            access_token,
            refresh_token,
            token_type: "Bearer".into(),
            expires_in: u64::try_from(Duration::minutes(ACCESS_TOKEN_TTL_MINUTES).num_seconds())
                .expect("positive access token TTL"),
            scope,
        })
    }

    pub fn refresh_oauth_tokens(
        &self,
        refresh_token: &str,
        client_id: &str,
        now: DateTime<Utc>,
    ) -> Result<OAuthTokenPair, CloudStoreError> {
        let refresh_hash = crate::auth::token_hash(refresh_token);
        let access_token = crate::auth::random_token(32)?;
        let next_refresh_token = crate::auth::random_token(48)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let record = transaction
            .query_row(
                "SELECT user_id, client_id, device_id, device_name, family_id, scope,
                        expires_at, used_at, revoked_at
                 FROM cloud_oauth_refresh_token WHERE token_hash=?1",
                [&refresh_hash],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .optional()?
            .ok_or(CloudStoreError::InvalidOAuthGrant)?;
        let (
            user_id,
            stored_client,
            device_id,
            device_name,
            family_id,
            scope,
            expires_at,
            used_at,
            revoked_at,
        ) = record;
        if used_at.is_some() {
            transaction.execute(
                "UPDATE cloud_oauth_refresh_token SET revoked_at=?1
                 WHERE family_id=?2 AND revoked_at IS NULL",
                params![now.to_rfc3339(), family_id],
            )?;
            transaction.execute(
                "UPDATE cloud_oauth_access_token SET revoked_at=?1
                 WHERE device_id=?2 AND revoked_at IS NULL",
                params![now.to_rfc3339(), device_id],
            )?;
            transaction.commit()?;
            return Err(CloudStoreError::OAuthRefreshReuse);
        }
        if stored_client != client_id || revoked_at.is_some() || parse_time(&expires_at)? <= now {
            return Err(CloudStoreError::InvalidOAuthGrant);
        }
        let next_refresh_hash = crate::auth::token_hash(&next_refresh_token);
        transaction.execute(
            "UPDATE cloud_oauth_refresh_token
             SET used_at=?1, replaced_by_hash=?2 WHERE token_hash=?3",
            params![now.to_rfc3339(), next_refresh_hash, refresh_hash],
        )?;
        insert_oauth_tokens(
            &transaction,
            &OAuthTokenIssue {
                user_id: &user_id,
                client_id,
                device_id: &device_id,
                device_name: &device_name,
                family_id: &family_id,
                scope: &scope,
                access_token: &access_token,
                refresh_token: &next_refresh_token,
                now,
            },
        )?;
        transaction.commit()?;
        Ok(OAuthTokenPair {
            access_token,
            refresh_token: next_refresh_token,
            token_type: "Bearer".into(),
            expires_in: u64::try_from(Duration::minutes(ACCESS_TOKEN_TTL_MINUTES).num_seconds())
                .expect("positive access token TTL"),
            scope,
        })
    }

    pub fn oauth_access_token_user(
        &self,
        access_token: &str,
        required_scope: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<String>, CloudStoreError> {
        let token_hash = crate::auth::token_hash(access_token);
        let row = self
            .connection()?
            .query_row(
                "SELECT user_id, scope FROM cloud_oauth_access_token
                 WHERE token_hash=?1 AND expires_at>?2 AND revoked_at IS NULL",
                params![token_hash, now.to_rfc3339()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        Ok(row
            .and_then(|(user_id, scope)| scope_contains(&scope, required_scope).then_some(user_id)))
    }

    pub fn oauth_device_sessions(
        &self,
        user_id: &str,
    ) -> Result<Vec<OAuthDeviceSession>, CloudStoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT device_id, device_name, client_id, scope, MIN(created_at), MAX(last_used_at),
                    MAX(expires_at)
             FROM cloud_oauth_refresh_token
             WHERE user_id=?1 AND revoked_at IS NULL
             GROUP BY device_id, device_name, client_id, scope
             ORDER BY MAX(last_used_at) DESC",
        )?;
        let sessions = statement
            .query_map([user_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?
            .map(|row| -> Result<OAuthDeviceSession, CloudStoreError> {
                let (device_id, device_name, client_id, scope, created, used, expires) = row?;
                Ok(OAuthDeviceSession {
                    device_id,
                    device_name,
                    client_id,
                    scope,
                    created_at: parse_time(&created)?,
                    last_used_at: parse_time(&used)?,
                    expires_at: parse_time(&expires)?,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn revoke_oauth_refresh_token(
        &self,
        refresh_token: &str,
        client_id: &str,
        now: DateTime<Utc>,
    ) -> Result<(), CloudStoreError> {
        let token_hash = crate::auth::token_hash(refresh_token);
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let device = transaction
            .query_row(
                "SELECT user_id, device_id FROM cloud_oauth_refresh_token
                 WHERE token_hash=?1 AND client_id=?2",
                params![token_hash, client_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((user_id, device_id)) = device {
            transaction.execute(
                "UPDATE cloud_oauth_refresh_token SET revoked_at=?1
                 WHERE user_id=?2 AND device_id=?3 AND revoked_at IS NULL",
                params![now.to_rfc3339(), user_id, device_id],
            )?;
            transaction.execute(
                "UPDATE cloud_oauth_access_token SET revoked_at=?1
                 WHERE user_id=?2 AND device_id=?3 AND revoked_at IS NULL",
                params![now.to_rfc3339(), user_id, device_id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn revoke_oauth_device(
        &self,
        user_id: &str,
        device_id: &str,
        now: DateTime<Utc>,
    ) -> Result<bool, CloudStoreError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let refresh = transaction.execute(
            "UPDATE cloud_oauth_refresh_token SET revoked_at=?1
             WHERE user_id=?2 AND device_id=?3 AND revoked_at IS NULL",
            params![now.to_rfc3339(), user_id, device_id],
        )?;
        transaction.execute(
            "UPDATE cloud_oauth_access_token SET revoked_at=?1
             WHERE user_id=?2 AND device_id=?3 AND revoked_at IS NULL",
            params![now.to_rfc3339(), user_id, device_id],
        )?;
        transaction.commit()?;
        Ok(refresh > 0)
    }

    pub(super) fn connection(&self) -> Result<MutexGuard<'_, Connection>, CloudStoreError> {
        self.connection
            .lock()
            .map_err(|_| CloudStoreError::Poisoned)
    }
}

fn migrate(connection: &Connection) -> Result<(), CloudStoreError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS cloud_plan (
            plan_id TEXT PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            description TEXT NOT NULL,
            display_name_i18n_json TEXT NOT NULL DEFAULT '{}',
            description_i18n_json TEXT NOT NULL DEFAULT '{}',
            tier_rank INTEGER NOT NULL,
            is_default INTEGER NOT NULL CHECK(is_default IN (0, 1)),
            active INTEGER NOT NULL CHECK(active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_plan_default
            ON cloud_plan(is_default) WHERE is_default=1;
        CREATE TABLE IF NOT EXISTS cloud_config_revision (
            domain TEXT PRIMARY KEY,
            revision INTEGER NOT NULL CHECK(revision>=0)
        );
        CREATE TABLE IF NOT EXISTS cloud_plan_version (
            plan_version_id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            monthly_credit_micros INTEGER NOT NULL CHECK(monthly_credit_micros>=0),
            published_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(plan_id, version),
            FOREIGN KEY(plan_id) REFERENCES cloud_plan(plan_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_plan_offer (
            offer_id TEXT PRIMARY KEY,
            plan_version_id TEXT NOT NULL,
            region TEXT NOT NULL,
            currency TEXT NOT NULL,
            payment_provider TEXT NOT NULL,
            amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
            active INTEGER NOT NULL CHECK(active IN (0, 1)),
            created_at TEXT NOT NULL,
            UNIQUE(plan_version_id, region, currency, payment_provider),
            FOREIGN KEY(plan_version_id) REFERENCES cloud_plan_version(plan_version_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_benefit_definition (
            benefit_id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            resource_type TEXT NOT NULL,
            resource_id TEXT,
            action TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cloud_plan_benefit (
            plan_version_id TEXT NOT NULL,
            benefit_id TEXT NOT NULL,
            limit_json TEXT NOT NULL,
            PRIMARY KEY(plan_version_id, benefit_id),
            FOREIGN KEY(plan_version_id) REFERENCES cloud_plan_version(plan_version_id),
            FOREIGN KEY(benefit_id) REFERENCES cloud_benefit_definition(benefit_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_top_up_product (
            product_id TEXT PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            description TEXT NOT NULL,
            display_name_i18n_json TEXT NOT NULL DEFAULT '{}',
            description_i18n_json TEXT NOT NULL DEFAULT '{}',
            active INTEGER NOT NULL CHECK(active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cloud_top_up_product_version (
            product_version_id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            credit_micros INTEGER NOT NULL CHECK(credit_micros>0),
            published_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(product_id, version),
            FOREIGN KEY(product_id) REFERENCES cloud_top_up_product(product_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_top_up_offer (
            offer_id TEXT PRIMARY KEY,
            product_version_id TEXT NOT NULL,
            region TEXT NOT NULL,
            currency TEXT NOT NULL,
            payment_provider TEXT NOT NULL,
            amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
            active INTEGER NOT NULL CHECK(active IN (0, 1)),
            created_at TEXT NOT NULL,
            UNIQUE(product_version_id, region, currency, payment_provider),
            FOREIGN KEY(product_version_id) REFERENCES cloud_top_up_product_version(product_version_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_upstream_provider (
            provider_id TEXT PRIMARY KEY,
            provider_preset_id TEXT NOT NULL DEFAULT 'custom',
            slug TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            provider_kind TEXT NOT NULL CHECK(provider_kind IN (
                'openai_compatible', 'anthropic', 'gemini'
            )),
            base_url TEXT NOT NULL,
            api_key_ciphertext TEXT NOT NULL,
            available_models_json TEXT NOT NULL DEFAULT '[]',
            models_refreshed_at TEXT,
            last_test_latency_ms INTEGER CHECK(last_test_latency_ms>=0),
            active INTEGER NOT NULL CHECK(active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cloud_official_model (
            model_id TEXT PRIMARY KEY,
            public_model_id TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            upstream_provider_id TEXT NOT NULL,
            upstream_model_id TEXT NOT NULL,
            protocol TEXT NOT NULL CHECK(protocol IN (
                'chat_completions', 'responses', 'messages', 'generate_content',
                'image_generation', 'image_edit', 'video_generation',
                'speech_synthesis', 'music_generation'
            )),
            capability_json TEXT NOT NULL,
            last_test_latency_ms INTEGER CHECK(last_test_latency_ms>=0),
            active INTEGER NOT NULL CHECK(active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(upstream_provider_id) REFERENCES cloud_upstream_provider(provider_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_model_pricing (
            pricing_id TEXT PRIMARY KEY,
            model_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            input_credit_micros_per_million INTEGER NOT NULL CHECK(input_credit_micros_per_million>=0),
            output_credit_micros_per_million INTEGER NOT NULL CHECK(output_credit_micros_per_million>=0),
            cache_read_credit_micros_per_million INTEGER NOT NULL CHECK(cache_read_credit_micros_per_million>=0),
            cache_write_credit_micros_per_million INTEGER NOT NULL CHECK(cache_write_credit_micros_per_million>=0),
            fixed_credit_micros_per_request INTEGER NOT NULL CHECK(fixed_credit_micros_per_request>=0),
            published_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(model_id, version),
            FOREIGN KEY(model_id) REFERENCES cloud_official_model(model_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_model_invocation (
            invocation_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            pricing_id TEXT NOT NULL,
            reservation_request_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN (
                'reserved', 'streaming', 'completed', 'failed'
            )),
            estimated_credit_micros INTEGER NOT NULL CHECK(estimated_credit_micros>=0),
            actual_credit_micros INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            cache_read_tokens INTEGER,
            cache_write_tokens INTEGER,
            upstream_request_id TEXT,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            error_code TEXT,
            reconciliation_required INTEGER NOT NULL DEFAULT 0
                CHECK(reconciliation_required IN (0, 1)),
            UNIQUE(user_id, request_id),
            FOREIGN KEY(model_id) REFERENCES cloud_official_model(model_id),
            FOREIGN KEY(pricing_id) REFERENCES cloud_model_pricing(pricing_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_subscription (
            subscription_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL UNIQUE,
            plan_id TEXT NOT NULL,
            plan_version_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'expired')),
            billing_timezone TEXT NOT NULL,
            billing_anchor_day INTEGER NOT NULL CHECK(billing_anchor_day BETWEEN 1 AND 31),
            current_period_id TEXT NOT NULL,
            scheduled_plan_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(plan_id) REFERENCES cloud_plan(plan_id),
            FOREIGN KEY(plan_version_id) REFERENCES cloud_plan_version(plan_version_id),
            FOREIGN KEY(scheduled_plan_id) REFERENCES cloud_plan(plan_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_subscription_period (
            period_id TEXT PRIMARY KEY,
            subscription_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            plan_version_id TEXT NOT NULL,
            starts_at TEXT NOT NULL,
            ends_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'expired')),
            billing_provider TEXT,
            billing_region TEXT,
            billing_currency TEXT,
            billing_amount_minor INTEGER CHECK(billing_amount_minor>=0),
            created_at TEXT NOT NULL,
            FOREIGN KEY(subscription_id) REFERENCES cloud_subscription(subscription_id),
            FOREIGN KEY(plan_id) REFERENCES cloud_plan(plan_id),
            FOREIGN KEY(plan_version_id) REFERENCES cloud_plan_version(plan_version_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_active_period
            ON cloud_subscription_period(user_id) WHERE status='active';
        CREATE TABLE IF NOT EXISTS cloud_wallet_account (
            wallet_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cloud_credit_grant (
            grant_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            granted_credit_micros INTEGER NOT NULL CHECK(granted_credit_micros>0),
            remaining_credit_micros INTEGER NOT NULL CHECK(remaining_credit_micros>=0),
            reserved_credit_micros INTEGER NOT NULL CHECK(reserved_credit_micros>=0),
            available_at TEXT NOT NULL,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, source_type, source_id),
            CHECK(reserved_credit_micros<=remaining_credit_micros)
        );
        CREATE INDEX IF NOT EXISTS idx_cloud_credit_grant_spend
            ON cloud_credit_grant(user_id, expires_at, created_at);
        CREATE TABLE IF NOT EXISTS cloud_credit_reservation (
            reservation_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('reserved', 'settled', 'released')),
            requested_credit_micros INTEGER NOT NULL CHECK(requested_credit_micros>0),
            settled_credit_micros INTEGER NOT NULL CHECK(settled_credit_micros>=0),
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, request_id),
            CHECK(settled_credit_micros<=requested_credit_micros)
        );
        CREATE TABLE IF NOT EXISTS cloud_credit_reservation_allocation (
            reservation_id TEXT NOT NULL,
            grant_id TEXT NOT NULL,
            reserved_credit_micros INTEGER NOT NULL CHECK(reserved_credit_micros>0),
            settled_credit_micros INTEGER NOT NULL CHECK(settled_credit_micros>=0),
            PRIMARY KEY(reservation_id, grant_id),
            FOREIGN KEY(reservation_id) REFERENCES cloud_credit_reservation(reservation_id),
            FOREIGN KEY(grant_id) REFERENCES cloud_credit_grant(grant_id),
            CHECK(settled_credit_micros<=reserved_credit_micros)
        );
        CREATE TABLE IF NOT EXISTS cloud_ledger_entry (
            entry_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            entry_type TEXT NOT NULL,
            amount_credit_micros INTEGER NOT NULL,
            reservation_id TEXT,
            grant_id TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cloud_payment_order (
            order_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            purpose TEXT NOT NULL CHECK(purpose IN (
                'plan_purchase', 'plan_upgrade', 'early_renewal', 'top_up'
            )),
            status TEXT NOT NULL CHECK(status IN (
                'pending', 'fulfilled', 'action_required', 'cancelled', 'refunded'
            )),
            provider TEXT NOT NULL,
            provider_order_id TEXT,
            offer_id TEXT NOT NULL,
            plan_id TEXT,
            plan_version_id TEXT,
            top_up_product_id TEXT,
            top_up_version_id TEXT,
            source_period_id TEXT,
            amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
            region TEXT NOT NULL,
            currency TEXT NOT NULL,
            credit_micros INTEGER NOT NULL CHECK(credit_micros>=0),
            period_starts_at TEXT,
            period_ends_at TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            paid_at TEXT,
            fulfilled_at TEXT,
            failure_reason TEXT,
            checkout_action_json TEXT,
            UNIQUE(user_id, idempotency_key),
            UNIQUE(provider, provider_order_id),
            FOREIGN KEY(plan_id) REFERENCES cloud_plan(plan_id),
            FOREIGN KEY(plan_version_id) REFERENCES cloud_plan_version(plan_version_id),
            FOREIGN KEY(top_up_product_id) REFERENCES cloud_top_up_product(product_id),
            FOREIGN KEY(top_up_version_id) REFERENCES cloud_top_up_product_version(product_version_id),
            FOREIGN KEY(source_period_id) REFERENCES cloud_subscription_period(period_id)
        );
        CREATE INDEX IF NOT EXISTS idx_cloud_payment_order_user
            ON cloud_payment_order(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS cloud_payment_event (
            provider TEXT NOT NULL,
            event_id TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            order_id TEXT NOT NULL,
            received_at TEXT NOT NULL,
            processed_at TEXT,
            PRIMARY KEY(provider, event_id),
            FOREIGN KEY(order_id) REFERENCES cloud_payment_order(order_id)
        );
        CREATE TABLE IF NOT EXISTS cloud_oauth_authorization_code (
            code_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            client_id TEXT NOT NULL,
            redirect_uri TEXT NOT NULL,
            code_challenge TEXT NOT NULL,
            scope TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            consumed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS cloud_oauth_access_token (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            client_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            scope TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cloud_oauth_access_device
            ON cloud_oauth_access_token(user_id, device_id);
        CREATE TABLE IF NOT EXISTS cloud_oauth_refresh_token (
            token_hash TEXT PRIMARY KEY,
            family_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            client_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            device_name TEXT NOT NULL,
            scope TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            revoked_at TEXT,
            replaced_by_hash TEXT
        );",
    )?;
    if !cloud_column_exists(
        connection,
        "cloud_model_invocation",
        "reconciliation_required",
    )? {
        connection.execute(
            "ALTER TABLE cloud_model_invocation ADD COLUMN
                reconciliation_required INTEGER NOT NULL DEFAULT 0
                CHECK(reconciliation_required IN (0, 1))",
            params![],
        )?;
    }
    for (column, definition) in [
        ("billing_provider", "TEXT"),
        ("billing_region", "TEXT"),
        ("billing_currency", "TEXT"),
        (
            "billing_amount_minor",
            "INTEGER CHECK(billing_amount_minor>=0)",
        ),
    ] {
        if !cloud_column_exists(connection, "cloud_subscription_period", column)? {
            connection.execute(
                &format!("ALTER TABLE cloud_subscription_period ADD COLUMN {column} {definition}"),
                params![],
            )?;
        }
    }
    for (table, column) in [
        ("cloud_plan", "display_name_i18n_json"),
        ("cloud_plan", "description_i18n_json"),
        ("cloud_top_up_product", "display_name_i18n_json"),
        ("cloud_top_up_product", "description_i18n_json"),
    ] {
        if !cloud_column_exists(connection, table, column)? {
            connection.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} TEXT NOT NULL DEFAULT '{{}}'"),
                params![],
            )?;
        }
    }
    if !cloud_column_exists(connection, "cloud_upstream_provider", "provider_preset_id")? {
        connection.execute(
            "ALTER TABLE cloud_upstream_provider ADD COLUMN
                provider_preset_id TEXT NOT NULL DEFAULT 'custom'",
            params![],
        )?;
    }
    if !cloud_column_exists(
        connection,
        "cloud_upstream_provider",
        "available_models_json",
    )? {
        connection.execute(
            "ALTER TABLE cloud_upstream_provider ADD COLUMN
                available_models_json TEXT NOT NULL DEFAULT '[]'",
            params![],
        )?;
    }
    if !cloud_column_exists(connection, "cloud_upstream_provider", "models_refreshed_at")? {
        connection.execute(
            "ALTER TABLE cloud_upstream_provider ADD COLUMN models_refreshed_at TEXT",
            params![],
        )?;
    }
    for table in ["cloud_upstream_provider", "cloud_official_model"] {
        if !cloud_column_exists(connection, table, "last_test_latency_ms")? {
            connection.execute(
                &format!(
                    "ALTER TABLE {table} ADD COLUMN last_test_latency_ms INTEGER CHECK(last_test_latency_ms>=0)"
                ),
                params![],
            )?;
        }
    }
    ensure_cloud_model_protocol_constraint(connection)?;
    Ok(())
}

#[cfg(test)]
fn ensure_cloud_model_protocol_constraint(_connection: &Connection) -> Result<(), CloudStoreError> {
    Ok(())
}

#[cfg(not(test))]
fn ensure_cloud_model_protocol_constraint(connection: &Connection) -> Result<(), CloudStoreError> {
    let supports_media = connection
        .query_row(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint
             WHERE conrelid='cloud_official_model'::regclass
               AND conname='cloud_official_model_protocol_check'",
            params![],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .is_some_and(|definition| definition.contains("image_generation"));
    if supports_media {
        return Ok(());
    }
    connection.execute_batch(
        "ALTER TABLE cloud_official_model
            DROP CONSTRAINT IF EXISTS cloud_official_model_protocol_check;
         ALTER TABLE cloud_official_model
            ADD CONSTRAINT cloud_official_model_protocol_check CHECK(protocol IN (
                'chat_completions', 'responses', 'messages', 'generate_content',
                'image_generation', 'image_edit', 'video_generation',
                'speech_synthesis', 'music_generation'
            ));",
    )?;
    Ok(())
}

#[cfg(test)]
fn cloud_column_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, CloudStoreError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement
        .query_map(params![], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(names.iter().any(|name| name == column))
}

#[cfg(not(test))]
fn cloud_column_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, CloudStoreError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM information_schema.columns
                WHERE table_schema=current_schema() AND table_name=?1 AND column_name=?2
            )",
            params![table, column],
            |row| row.get::<_, bool>(0),
        )
        .map_err(CloudStoreError::from)
}

struct OAuthTokenIssue<'a> {
    user_id: &'a str,
    client_id: &'a str,
    device_id: &'a str,
    device_name: &'a str,
    family_id: &'a str,
    scope: &'a str,
    access_token: &'a str,
    refresh_token: &'a str,
    now: DateTime<Utc>,
}

fn insert_oauth_tokens(
    transaction: &Transaction<'_>,
    issue: &OAuthTokenIssue<'_>,
) -> Result<(), CloudStoreError> {
    transaction.execute(
        "INSERT INTO cloud_oauth_access_token(
            token_hash, user_id, client_id, device_id, scope, created_at, expires_at, revoked_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
        params![
            crate::auth::token_hash(issue.access_token),
            issue.user_id,
            issue.client_id,
            issue.device_id,
            issue.scope,
            issue.now.to_rfc3339(),
            (issue.now + Duration::minutes(ACCESS_TOKEN_TTL_MINUTES)).to_rfc3339(),
        ],
    )?;
    transaction.execute(
        "INSERT INTO cloud_oauth_refresh_token(
            token_hash, family_id, user_id, client_id, device_id, device_name, scope,
            created_at, last_used_at, expires_at, used_at, revoked_at, replaced_by_hash
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, NULL, NULL, NULL)",
        params![
            crate::auth::token_hash(issue.refresh_token),
            issue.family_id,
            issue.user_id,
            issue.client_id,
            issue.device_id,
            issue.device_name,
            issue.scope,
            issue.now.to_rfc3339(),
            (issue.now + Duration::days(REFRESH_TOKEN_TTL_DAYS)).to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn scope_contains(scope: &str, required: &str) -> bool {
    scope
        .split_ascii_whitespace()
        .any(|value| value == required)
}

fn seed_default_plan(connection: &Connection) -> Result<(), CloudStoreError> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "INSERT INTO cloud_plan(
            plan_id, slug, display_name, description, display_name_i18n_json,
            description_i18n_json, tier_rank, is_default, active, created_at, updated_at
         ) VALUES (?1, 'free', 'Free', 'Default CodeY plan', ?2, ?3, 0, 1, 1, ?4, ?4)
         ON CONFLICT(plan_id) DO NOTHING",
        params![
            DEFAULT_PLAN_ID,
            r#"{"en":"Free","zh-CN":"免费版"}"#,
            r#"{"en":"Default CodeY plan","zh-CN":"CodeY 默认套餐"}"#,
            now,
        ],
    )?;
    connection.execute(
        "UPDATE cloud_plan SET
            display_name_i18n_json=CASE WHEN display_name_i18n_json='{}' THEN ?2 ELSE display_name_i18n_json END,
            description_i18n_json=CASE WHEN description_i18n_json='{}' THEN ?3 ELSE description_i18n_json END
         WHERE plan_id=?1",
        params![
            DEFAULT_PLAN_ID,
            r#"{"en":"Free","zh-CN":"免费版"}"#,
            r#"{"en":"Default CodeY plan","zh-CN":"CodeY 默认套餐"}"#,
        ],
    )?;
    connection.execute(
        "INSERT INTO cloud_plan_version(
            plan_version_id, plan_id, version, monthly_credit_micros, published_at, created_at
         ) VALUES (?1, ?2, 1, 0, ?3, ?3)
         ON CONFLICT(plan_version_id) DO NOTHING",
        params![DEFAULT_PLAN_VERSION_ID, DEFAULT_PLAN_ID, now],
    )?;
    connection.execute(
        "INSERT INTO cloud_config_revision(domain, revision) VALUES ('plans', 0)
         ON CONFLICT(domain) DO NOTHING",
        params![],
    )?;
    connection.execute(
        "INSERT INTO cloud_config_revision(domain, revision) VALUES ('topups', 0)
         ON CONFLICT(domain) DO NOTHING",
        params![],
    )?;
    connection.execute(
        "INSERT INTO cloud_config_revision(domain, revision) VALUES ('models', 0)
         ON CONFLICT(domain) DO NOTHING",
        params![],
    )?;
    Ok(())
}

fn ensure_wallet(
    transaction: &Transaction<'_>,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<(), CloudStoreError> {
    transaction.execute(
        "INSERT INTO cloud_wallet_account(wallet_id, user_id, created_at)
         VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO NOTHING",
        params![ulid::Ulid::new().to_string(), user_id, now.to_rfc3339()],
    )?;
    Ok(())
}

pub(super) fn insert_grant(
    transaction: &Transaction<'_>,
    user_id: &str,
    source: CreditGrantSource,
    source_id: &str,
    amount_credit_micros: u64,
    expires_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Result<String, CloudStoreError> {
    insert_grant_available(
        transaction,
        user_id,
        source,
        source_id,
        amount_credit_micros,
        now,
        expires_at,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn insert_grant_available(
    transaction: &Transaction<'_>,
    user_id: &str,
    source: CreditGrantSource,
    source_id: &str,
    amount_credit_micros: u64,
    available_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Result<String, CloudStoreError> {
    let amount = stored_i64(amount_credit_micros)?;
    let existing = transaction
        .query_row(
            "SELECT grant_id, granted_credit_micros, available_at, expires_at
             FROM cloud_credit_grant
             WHERE user_id=?1 AND source_type=?2 AND source_id=?3",
            params![user_id, source.as_str(), source_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    if let Some((grant_id, stored_amount, stored_available, stored_expiry)) = existing {
        if stored_amount == amount
            && stored_available == available_at.to_rfc3339()
            && stored_expiry == expires_at.map(|value| value.to_rfc3339())
        {
            return Ok(grant_id);
        }
        return Err(CloudStoreError::IdempotencyConflict);
    }
    let grant_id = ulid::Ulid::new().to_string();
    transaction.execute(
        "INSERT INTO cloud_credit_grant(
            grant_id, user_id, source_type, source_id, granted_credit_micros,
            remaining_credit_micros, reserved_credit_micros, available_at, expires_at,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, ?6, ?7, ?8, ?8)",
        params![
            grant_id,
            user_id,
            source.as_str(),
            source_id,
            amount,
            available_at.to_rfc3339(),
            expires_at.map(|value| value.to_rfc3339()),
            now.to_rfc3339(),
        ],
    )?;
    ledger(
        transaction,
        user_id,
        "grant",
        amount,
        None,
        Some(&grant_id),
        now,
    )?;
    Ok(grant_id)
}

fn expire_grants(
    transaction: &Transaction<'_>,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<(), CloudStoreError> {
    let mut statement = transaction.prepare(
        "SELECT grant_id, remaining_credit_micros, reserved_credit_micros
         FROM cloud_credit_grant
         WHERE user_id=?1 AND expires_at IS NOT NULL AND expires_at<=?2
           AND remaining_credit_micros>reserved_credit_micros",
    )?;
    let expired = statement
        .query_map(params![user_id, now.to_rfc3339()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for (grant_id, remaining, reserved) in expired {
        let amount = remaining - reserved;
        transaction.execute(
            "UPDATE cloud_credit_grant
             SET remaining_credit_micros=reserved_credit_micros, updated_at=?1
             WHERE grant_id=?2",
            params![now.to_rfc3339(), grant_id],
        )?;
        ledger(
            transaction,
            user_id,
            "expire",
            -amount,
            None,
            Some(&grant_id),
            now,
        )?;
    }
    Ok(())
}

fn release_expired_reservations(
    transaction: &Transaction<'_>,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<(), CloudStoreError> {
    let mut statement = transaction.prepare(
        "SELECT reservation_id FROM cloud_credit_reservation
         WHERE user_id=?1 AND status='reserved' AND expires_at<=?2
         ORDER BY expires_at, reservation_id",
    )?;
    let reservations = statement
        .query_map(params![user_id, now.to_rfc3339()], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for reservation_id in reservations {
        let mut allocation_statement = transaction.prepare(
            "SELECT a.grant_id, a.reserved_credit_micros, g.expires_at
             FROM cloud_credit_reservation_allocation a
             JOIN cloud_credit_grant g ON g.grant_id=a.grant_id
             WHERE a.reservation_id=?1",
        )?;
        let allocations = allocation_statement
            .query_map([reservation_id.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(allocation_statement);
        for (grant_id, reserved, expires_at) in allocations {
            let grant_expired = expires_at
                .as_deref()
                .map(parse_time)
                .transpose()?
                .is_some_and(|expires_at| expires_at <= now);
            transaction.execute(
                "UPDATE cloud_credit_grant SET
                    remaining_credit_micros=remaining_credit_micros-?1,
                    reserved_credit_micros=reserved_credit_micros-?2,
                    updated_at=?3
                 WHERE grant_id=?4",
                params![
                    if grant_expired { reserved } else { 0 },
                    reserved,
                    now.to_rfc3339(),
                    grant_id,
                ],
            )?;
            if grant_expired && reserved > 0 {
                ledger(
                    transaction,
                    user_id,
                    "expire",
                    -reserved,
                    Some(&reservation_id),
                    Some(&grant_id),
                    now,
                )?;
            }
        }
        transaction.execute(
            "UPDATE cloud_credit_reservation SET status='released', updated_at=?1
             WHERE reservation_id=?2 AND status='reserved'",
            params![now.to_rfc3339(), reservation_id],
        )?;
        ledger(
            transaction,
            user_id,
            "release",
            0,
            Some(&reservation_id),
            None,
            now,
        )?;
    }
    Ok(())
}

fn ledger(
    transaction: &Transaction<'_>,
    user_id: &str,
    entry_type: &str,
    amount: i64,
    reservation_id: Option<&str>,
    grant_id: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), CloudStoreError> {
    transaction.execute(
        "INSERT INTO cloud_ledger_entry(
            entry_id, user_id, entry_type, amount_credit_micros,
            reservation_id, grant_id, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            ulid::Ulid::new().to_string(),
            user_id,
            entry_type,
            amount,
            reservation_id,
            grant_id,
            now.to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub(super) fn subscription(
    connection: &Connection,
    user_id: &str,
) -> Result<Option<SubscriptionSnapshot>, CloudStoreError> {
    connection
        .query_row(
            "SELECT s.subscription_id, s.plan_id, s.plan_version_id, s.status,
                    s.current_period_id, p.starts_at, p.ends_at, s.billing_timezone,
                    s.billing_anchor_day, s.scheduled_plan_id
             FROM cloud_subscription s
             JOIN cloud_subscription_period p ON p.period_id=s.current_period_id
             WHERE s.user_id=?1",
            [user_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, Option<String>>(9)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                subscription_id,
                plan_id,
                plan_version_id,
                status,
                period_id,
                starts_at,
                ends_at,
                timezone,
                anchor_day,
                scheduled_plan_id,
            )| {
                Ok(SubscriptionSnapshot {
                    subscription_id,
                    user_id: user_id.to_owned(),
                    plan_id,
                    plan_version_id,
                    status: SubscriptionStatus::parse(&status)
                        .ok_or(CloudStoreError::SubscriptionIntegrity)?,
                    current_period_id: period_id,
                    current_period_start: parse_time(&starts_at)?,
                    current_period_end: parse_time(&ends_at)?,
                    billing_timezone: timezone,
                    billing_anchor_day: u32::try_from(anchor_day)
                        .map_err(|_| CloudStoreError::SubscriptionIntegrity)?,
                    scheduled_plan_id,
                })
            },
        )
        .transpose()
}

fn default_plan(transaction: &Transaction<'_>) -> Result<(String, String, u64), CloudStoreError> {
    let (plan_id, plan_version_id, credits) = transaction.query_row(
        "SELECT p.plan_id, v.plan_version_id, v.monthly_credit_micros
         FROM cloud_plan p
         JOIN cloud_plan_version v ON v.plan_id=p.plan_id
         WHERE p.is_default=1 AND p.active=1
         ORDER BY v.version DESC LIMIT 1",
        params![],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    Ok((plan_id, plan_version_id, stored_u64(credits)?))
}

fn reservation_by_request(
    connection: &Connection,
    user_id: &str,
    request_id: &str,
) -> Result<Option<CreditReservation>, CloudStoreError> {
    reservation_query(
        connection,
        "WHERE user_id=?1 AND request_id=?2",
        params![user_id, request_id],
    )
}

fn reservation_by_id(
    connection: &Connection,
    reservation_id: &str,
) -> Result<Option<CreditReservation>, CloudStoreError> {
    reservation_query(
        connection,
        "WHERE reservation_id=?1",
        params![reservation_id],
    )
}

fn reservation_query(
    connection: &Connection,
    predicate: &str,
    parameters: impl crate::db::Params,
) -> Result<Option<CreditReservation>, CloudStoreError> {
    connection
        .query_row(
            &format!(
                "SELECT reservation_id, request_id, user_id, status,
                        requested_credit_micros, settled_credit_micros, created_at, expires_at
                 FROM cloud_credit_reservation {predicate}"
            ),
            parameters,
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()?
        .map(
            |(id, request, user, status, requested, settled, created, expires)| {
                Ok(CreditReservation {
                    reservation_id: id,
                    request_id: request,
                    user_id: user,
                    status: CreditReservationStatus::parse(&status)
                        .ok_or(CloudStoreError::ReservationIntegrity)?,
                    requested_credit_micros: stored_u64(requested)?,
                    settled_credit_micros: stored_u64(settled)?,
                    created_at: parse_time(&created)?,
                    expires_at: parse_time(&expires)?,
                })
            },
        )
        .transpose()
}

pub(super) fn stored_i64(value: u64) -> Result<i64, CloudStoreError> {
    i64::try_from(value).map_err(|_| CloudStoreError::CreditOverflow)
}

pub(super) fn stored_u64(value: i64) -> Result<u64, CloudStoreError> {
    u64::try_from(value).map_err(|_| CloudStoreError::WalletIntegrity)
}

pub(super) fn parse_time(value: &str) -> Result<DateTime<Utc>, CloudStoreError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| CloudStoreError::InvalidStoredTime(value.to_owned()))
}

use chrono::Datelike as _;

#[derive(Debug, Error)]
pub enum CloudStoreError {
    #[error("cloud database failed: {0}")]
    Sql(#[from] crate::db::Error),
    #[error("cloud storage failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("cloud database lock is poisoned")]
    Poisoned,
    #[error("invalid billing timezone: {0}")]
    InvalidBillingTimezone(String),
    #[error("invalid billing anchor day: {0}")]
    InvalidBillingAnchorDay(u32),
    #[error("invalid period date {year}-{month}-{day}")]
    InvalidPeriodDate { year: i32, month: u32, day: u32 },
    #[error("invalid period local time")]
    InvalidPeriodTime,
    #[error("invalid proration window")]
    InvalidProrationWindow,
    #[error("proration overflow")]
    ProrationOverflow,
    #[error("credit amount overflow")]
    CreditOverflow,
    #[error("credit amount must be positive")]
    ZeroCreditAmount,
    #[error("wallet data is inconsistent")]
    WalletIntegrity,
    #[error("subscription data is inconsistent")]
    SubscriptionIntegrity,
    #[error("reservation data is inconsistent")]
    ReservationIntegrity,
    #[error("credit reservation is invalid")]
    InvalidReservation,
    #[error("credit reservation was not found")]
    ReservationNotFound,
    #[error("settlement exceeds reserved credits")]
    SettlementExceedsReservation,
    #[error("idempotency key conflicts with an existing operation")]
    IdempotencyConflict,
    #[error("insufficient credits: required {required}, available {available}")]
    InsufficientCredits { required: u64, available: u64 },
    #[error("stored timestamp is invalid: {0}")]
    InvalidStoredTime(String),
    #[error("OAuth grant is invalid or expired")]
    InvalidOAuthGrant,
    #[error("OAuth refresh token reuse revoked the device session")]
    OAuthRefreshReuse,
    #[error(transparent)]
    Auth(#[from] crate::auth::MarketplaceAuthError),
    #[error("cloud configuration revision conflict: expected {expected}, actual {actual}")]
    RevisionConflict { expected: u64, actual: u64 },
    #[error("plan is invalid")]
    InvalidPlan,
    #[error("plan slug already belongs to another plan: {0}")]
    PlanSlugConflict(String),
    #[error("plan catalog data is inconsistent")]
    CatalogIntegrity,
    #[error("stored payment provider is invalid: {0}")]
    InvalidPaymentProvider(String),
    #[error("cloud JSON data is invalid: {0}")]
    Json(String),
    #[error("plan order is invalid: {0}")]
    InvalidPlanOrder(String),
    #[error("plan offer was not found")]
    PlanOfferNotFound,
    #[error(
        "the current and target plans do not share the same payment provider, region, and currency"
    )]
    PlanUpgradeOfferMismatch,
    #[error("a lower plan must be scheduled before renewal")]
    PlanDowngradeMustBeScheduled,
    #[error("the scheduled plan is invalid")]
    InvalidScheduledPlan,
    #[error("the subscription changed while the request was being processed")]
    SubscriptionConflict,
    #[error("a paid renewal period already exists")]
    PendingRenewalExists,
    #[error("payment order was not found")]
    PaymentOrderNotFound,
    #[error("payment order data is inconsistent")]
    PaymentOrderIntegrity,
    #[error("payment order state does not allow this operation")]
    InvalidPaymentOrderState,
    #[error("paid order needs manual reconciliation because subscription state changed")]
    PaymentFulfillmentConflict,
    #[error("idempotency key is invalid")]
    InvalidIdempotencyKey,
    #[error("top-up product is invalid")]
    InvalidTopUpProduct,
    #[error("top-up product slug already belongs to another product: {0}")]
    TopUpSlugConflict(String),
    #[error("top-up catalog data is inconsistent")]
    TopUpCatalogIntegrity,
    #[error("top-up offer was not found")]
    TopUpOfferNotFound,
    #[error("payment provider does not match the order")]
    PaymentProviderMismatch,
    #[error("CODEY_CLOUD_SECRET_KEY must be base64 for exactly 32 bytes")]
    InvalidSecretKey,
    #[error("cloud secret encryption failed")]
    SecretEncryption,
    #[error("cloud secret decryption failed")]
    SecretDecryption,
    #[error("upstream model provider is invalid")]
    InvalidUpstreamProvider,
    #[error("upstream provider slug already belongs to another provider: {0}")]
    UpstreamProviderSlugConflict(String),
    #[error("an API key is required when creating an upstream provider")]
    UpstreamCredentialRequired,
    #[error("upstream model provider was not found or is inactive")]
    UpstreamProviderNotFound,
    #[error("official model is invalid")]
    InvalidOfficialModel,
    #[error("official model ID already belongs to another model: {0}")]
    OfficialModelIdConflict(String),
    #[error("model protocol does not match its upstream provider")]
    ModelProtocolMismatch,
    #[error("official model catalog data is inconsistent")]
    ModelCatalogIntegrity,
    #[error("official model was not found")]
    OfficialModelNotFound,
    #[error("the active plan does not allow this official model")]
    ModelNotEntitled,
    #[error("model request ID was already used")]
    DuplicateModelRequest,
    #[error("model usage exceeded its reserved credit estimate")]
    ModelEstimateExceeded,
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone as _, Utc};
    use tempfile::TempDir;

    use super::*;

    fn store() -> (TempDir, CloudStore) {
        let root = TempDir::new().unwrap();
        let store = CloudStore::open(root.path(), "").unwrap();
        (root, store)
    }

    #[test]
    fn default_subscription_is_idempotent_and_uses_natural_month() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 1, 31, 0, 30, 0).unwrap();
        let first = store
            .ensure_default_subscription("user-1", "Asia/Shanghai", now)
            .unwrap();
        let second = store
            .ensure_default_subscription("user-1", "Asia/Shanghai", now)
            .unwrap();
        assert_eq!(first, second);
        assert_eq!(first.billing_anchor_day, 31);
        assert_eq!(
            first.current_period_end,
            Utc.with_ymd_and_hms(2025, 2, 28, 0, 30, 0).unwrap()
        );
    }

    #[test]
    fn existing_subscription_period_schema_receives_billing_snapshot_columns() {
        let root = TempDir::new().unwrap();
        let database = root.path().join("marketplace.sqlite3");
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE cloud_subscription_period (
                    period_id TEXT PRIMARY KEY,
                    subscription_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    plan_version_id TEXT NOT NULL,
                    starts_at TEXT NOT NULL,
                    ends_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                 );",
            )
            .unwrap();
        drop(connection);

        let store = CloudStore::open(root.path(), "").unwrap();
        let connection = store.connection().unwrap();
        for column in [
            "billing_provider",
            "billing_region",
            "billing_currency",
            "billing_amount_minor",
        ] {
            assert!(cloud_column_exists(&connection, "cloud_subscription_period", column).unwrap());
        }
    }

    #[test]
    fn reservation_spends_expiring_credits_before_permanent_credits() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        store
            .grant_credits(
                "user-1",
                CreditGrantSource::TopUp,
                "topup-1",
                100,
                None,
                now,
            )
            .unwrap();
        store
            .grant_credits(
                "user-1",
                CreditGrantSource::Subscription,
                "period-1",
                40,
                Some(now + Duration::days(30)),
                now,
            )
            .unwrap();
        store
            .reserve_credits("user-1", "request-1", 60, now, Duration::minutes(10))
            .unwrap();
        store
            .settle_reservation("user-1", "request-1", 50, now)
            .unwrap();
        let summary = store.wallet_summary("user-1", now).unwrap();
        assert_eq!(summary.expiring_credit_micros, 0);
        assert_eq!(summary.permanent_credit_micros, 90);
        assert_eq!(summary.available_credit_micros, 90);
        assert_eq!(summary.reserved_credit_micros, 0);
    }

    #[test]
    fn expired_reservation_releases_held_credits() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        store
            .grant_credits(
                "user-1",
                CreditGrantSource::TopUp,
                "topup-1",
                100,
                None,
                now,
            )
            .unwrap();
        store
            .reserve_credits("user-1", "request-1", 60, now, Duration::minutes(10))
            .unwrap();
        let summary = store
            .wallet_summary("user-1", now + Duration::minutes(11))
            .unwrap();
        assert_eq!(summary.available_credit_micros, 100);
        assert_eq!(summary.reserved_credit_micros, 0);
        assert_eq!(
            reservation_by_request(&store.connection().unwrap(), "user-1", "request-1")
                .unwrap()
                .unwrap()
                .status,
            CreditReservationStatus::Released
        );
    }

    #[test]
    fn expired_grants_release_no_credit_after_late_settlement() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        store
            .grant_credits(
                "user-1",
                CreditGrantSource::Subscription,
                "period-1",
                100,
                Some(now + Duration::minutes(1)),
                now,
            )
            .unwrap();
        store
            .reserve_credits("user-1", "request-1", 80, now, Duration::minutes(10))
            .unwrap();
        let after_expiry = now + Duration::minutes(2);
        store
            .settle_reservation("user-1", "request-1", 50, after_expiry)
            .unwrap();
        let summary = store.wallet_summary("user-1", after_expiry).unwrap();
        assert_eq!(summary.available_credit_micros, 0);
        assert_eq!(summary.reserved_credit_micros, 0);
    }

    #[test]
    fn reservation_request_id_is_idempotent() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        store
            .grant_credits(
                "user-1",
                CreditGrantSource::TopUp,
                "topup-1",
                100,
                None,
                now,
            )
            .unwrap();
        let first = store
            .reserve_credits("user-1", "request-1", 60, now, Duration::minutes(10))
            .unwrap();
        let second = store
            .reserve_credits("user-1", "request-1", 60, now, Duration::minutes(10))
            .unwrap();
        assert_eq!(first, second);
        assert!(matches!(
            store.reserve_credits("user-1", "request-1", 50, now, Duration::minutes(10)),
            Err(CloudStoreError::IdempotencyConflict)
        ));
    }

    #[test]
    fn oauth_code_uses_pkce_and_refresh_rotation_detects_reuse() {
        let (_root, store) = store();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let verifier = crate::auth::random_token(32).unwrap();
        let challenge = crate::auth::pkce_challenge(&verifier);
        let code = store
            .create_oauth_authorization_code(
                "user-1",
                "codey-desktop",
                "http://127.0.0.1:45678/oauth/callback",
                &challenge,
                "profile:read model:invoke",
                now,
            )
            .unwrap();
        let tokens = store
            .exchange_oauth_authorization_code(
                &code,
                &verifier,
                "codey-desktop",
                "http://127.0.0.1:45678/oauth/callback",
                "Test Mac",
                now,
            )
            .unwrap();
        assert_eq!(
            store
                .oauth_access_token_user(&tokens.access_token, "model:invoke", now)
                .unwrap(),
            Some("user-1".into())
        );
        let rotated = store
            .refresh_oauth_tokens(&tokens.refresh_token, "codey-desktop", now)
            .unwrap();
        assert_ne!(tokens.refresh_token, rotated.refresh_token);
        assert!(matches!(
            store.refresh_oauth_tokens(&tokens.refresh_token, "codey-desktop", now),
            Err(CloudStoreError::OAuthRefreshReuse)
        ));
        assert_eq!(
            store
                .oauth_access_token_user(&rotated.access_token, "model:invoke", now)
                .unwrap(),
            None
        );
    }
}

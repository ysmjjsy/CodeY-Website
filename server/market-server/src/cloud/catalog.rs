use std::collections::{BTreeMap, HashSet};

use crate::db::{params, OptionalExtension, TransactionBehavior};
use chrono::{DateTime, Utc};

use super::store::DEFAULT_PLAN_ID;
use super::{
    CloudStore, CloudStoreError, PaymentProvider, PlanBenefit, PlanCatalog, PlanOffer, PlanSummary,
    PublishPlanRequest,
};

impl CloudStore {
    pub fn plan_catalog(&self, now: DateTime<Utc>) -> Result<PlanCatalog, CloudStoreError> {
        let connection = self.connection()?;
        catalog(&connection, now)
    }

    pub fn publish_plan(
        &self,
        request: &PublishPlanRequest,
        now: DateTime<Utc>,
    ) -> Result<PlanCatalog, CloudStoreError> {
        validate_publish_plan(request)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let revision = config_revision(&transaction, "plans")?;
        if revision != request.expected_revision {
            return Err(CloudStoreError::RevisionConflict {
                expected: request.expected_revision,
                actual: revision,
            });
        }
        let plan_id = request
            .plan_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| ulid::Ulid::new().to_string());
        let existing_plan_id = transaction
            .query_row(
                "SELECT plan_id FROM cloud_plan WHERE slug=?1",
                [request.slug.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if existing_plan_id
            .as_deref()
            .is_some_and(|existing| existing != plan_id)
        {
            return Err(CloudStoreError::PlanSlugConflict(request.slug.clone()));
        }
        if request.is_default {
            transaction.execute(
                "UPDATE cloud_plan SET is_default=0 WHERE is_default=1",
                params![],
            )?;
        }
        transaction.execute(
            "INSERT INTO cloud_plan(
                plan_id, slug, display_name, description, display_name_i18n_json,
                description_i18n_json, tier_rank, is_default, active, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)
             ON CONFLICT(plan_id) DO UPDATE SET
                slug=excluded.slug,
                display_name=excluded.display_name,
                description=excluded.description,
                display_name_i18n_json=excluded.display_name_i18n_json,
                description_i18n_json=excluded.description_i18n_json,
                tier_rank=excluded.tier_rank,
                is_default=excluded.is_default,
                active=1,
                updated_at=excluded.updated_at",
            params![
                plan_id,
                request.slug,
                request.display_name,
                request.description,
                localized_json(&request.display_name_i18n)?,
                localized_json(&request.description_i18n)?,
                i64::from(request.tier_rank),
                i64::from(request.is_default),
                now.to_rfc3339(),
            ],
        )?;
        let next_version = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0)+1 FROM cloud_plan_version WHERE plan_id=?1",
            [plan_id.as_str()],
            |row| row.get::<_, i64>(0),
        )?;
        let plan_version_id = ulid::Ulid::new().to_string();
        transaction.execute(
            "INSERT INTO cloud_plan_version(
                plan_version_id, plan_id, version, monthly_credit_micros, published_at, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                plan_version_id,
                plan_id,
                next_version,
                stored_i64(request.monthly_credit_micros)?,
                now.to_rfc3339(),
            ],
        )?;
        for offer in &request.offers {
            transaction.execute(
                "INSERT INTO cloud_plan_offer(
                    offer_id, plan_version_id, region, currency, payment_provider,
                    amount_minor, active, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
                params![
                    ulid::Ulid::new().to_string(),
                    plan_version_id,
                    offer.region,
                    offer.currency,
                    offer.payment_provider.as_str(),
                    stored_i64(offer.amount_minor)?,
                    now.to_rfc3339(),
                ],
            )?;
        }
        for benefit in &request.benefits {
            let benefit_id = transaction
                .query_row(
                    "SELECT benefit_id FROM cloud_benefit_definition WHERE code=?1",
                    [benefit.code.as_str()],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .unwrap_or_else(|| ulid::Ulid::new().to_string());
            transaction.execute(
                "INSERT INTO cloud_benefit_definition(
                    benefit_id, code, resource_type, resource_id, action, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(code) DO UPDATE SET
                    resource_type=excluded.resource_type,
                    resource_id=excluded.resource_id,
                    action=excluded.action",
                params![
                    benefit_id,
                    benefit.code,
                    benefit.resource_type,
                    benefit.resource_id,
                    benefit.action,
                    now.to_rfc3339(),
                ],
            )?;
            transaction.execute(
                "INSERT INTO cloud_plan_benefit(plan_version_id, benefit_id, limit_json)
                 VALUES (?1, ?2, ?3)",
                params![
                    plan_version_id,
                    benefit_id,
                    serde_json::to_string(&benefit.limit)
                        .map_err(|error| CloudStoreError::Json(error.to_string()))?,
                ],
            )?;
        }
        transaction.execute(
            "UPDATE cloud_config_revision SET revision=revision+1 WHERE domain='plans'",
            params![],
        )?;
        let result = catalog(&transaction, now)?;
        transaction.commit()?;
        Ok(result)
    }
}

fn catalog(
    connection: &crate::db::Connection,
    now: DateTime<Utc>,
) -> Result<PlanCatalog, CloudStoreError> {
    let revision = config_revision(connection, "plans")?;
    let mut statement = connection.prepare(
        "SELECT p.plan_id, v.plan_version_id, v.version, p.slug, p.display_name,
                p.description, p.display_name_i18n_json, p.description_i18n_json,
                p.tier_rank, p.is_default, v.monthly_credit_micros, v.published_at
         FROM cloud_plan p
         JOIN cloud_plan_version v ON v.plan_id=p.plan_id
         WHERE p.active=1
           AND v.version=(SELECT MAX(latest.version) FROM cloud_plan_version latest WHERE latest.plan_id=p.plan_id)
         ORDER BY p.tier_rank ASC, p.plan_id ASC",
    )?;
    let rows = statement
        .query_map(params![], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, String>(11)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut plans = Vec::with_capacity(rows.len());
    for (
        plan_id,
        version_id,
        version,
        slug,
        display_name,
        description,
        display_name_i18n,
        description_i18n,
        tier_rank,
        is_default,
        monthly_credit_micros,
        published_at,
    ) in rows
    {
        plans.push(PlanSummary {
            offers: offers(connection, &version_id)?,
            benefits: benefits(connection, &version_id)?,
            plan_id,
            plan_version_id: version_id,
            version: stored_u32(version)?,
            slug,
            display_name,
            description,
            display_name_i18n: parse_localized_json(&display_name_i18n)?,
            description_i18n: parse_localized_json(&description_i18n)?,
            tier_rank: stored_u32(tier_rank)?,
            is_default: is_default != 0,
            monthly_credit_micros: stored_u64(monthly_credit_micros)?,
            published_at: parse_time(&published_at)?,
        });
    }
    Ok(PlanCatalog {
        revision,
        plans,
        generated_at: now,
    })
}

fn offers(
    connection: &crate::db::Connection,
    plan_version_id: &str,
) -> Result<Vec<PlanOffer>, CloudStoreError> {
    let mut statement = connection.prepare(
        "SELECT offer_id, region, currency, payment_provider, amount_minor
         FROM cloud_plan_offer WHERE plan_version_id=?1 AND active=1
         ORDER BY region, currency, payment_provider",
    )?;
    let rows = statement
        .query_map([plan_version_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(offer_id, region, currency, provider, amount)| {
            Ok(PlanOffer {
                offer_id,
                region,
                currency,
                payment_provider: PaymentProvider::parse(&provider)
                    .ok_or(CloudStoreError::InvalidPaymentProvider(provider))?,
                amount_minor: stored_u64(amount)?,
            })
        })
        .collect()
}

fn benefits(
    connection: &crate::db::Connection,
    plan_version_id: &str,
) -> Result<Vec<PlanBenefit>, CloudStoreError> {
    let mut statement = connection.prepare(
        "SELECT d.code, d.resource_type, d.resource_id, d.action, b.limit_json
         FROM cloud_plan_benefit b
         JOIN cloud_benefit_definition d ON d.benefit_id=b.benefit_id
         WHERE b.plan_version_id=?1 ORDER BY d.code",
    )?;
    let rows = statement
        .query_map([plan_version_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(code, resource_type, resource_id, action, limit)| {
            Ok(PlanBenefit {
                code,
                resource_type,
                resource_id,
                action,
                limit: serde_json::from_str(&limit)
                    .map_err(|error| CloudStoreError::Json(error.to_string()))?,
            })
        })
        .collect()
}

fn config_revision(
    connection: &crate::db::Connection,
    domain: &str,
) -> Result<u64, CloudStoreError> {
    stored_u64(connection.query_row(
        "SELECT revision FROM cloud_config_revision WHERE domain=?1",
        [domain],
        |row| row.get::<_, i64>(0),
    )?)
}

fn validate_publish_plan(request: &PublishPlanRequest) -> Result<(), CloudStoreError> {
    let is_default_identity = request.plan_id.as_deref() == Some(DEFAULT_PLAN_ID);
    let distinct_offers = request
        .offers
        .iter()
        .map(|offer| {
            (
                offer.region.as_str(),
                offer.currency.as_str(),
                offer.payment_provider.as_str(),
            )
        })
        .collect::<HashSet<_>>()
        .len();
    if request.is_default != is_default_identity
        || (request.is_default && !request.offers.is_empty())
        || distinct_offers != request.offers.len()
        || request.slug.is_empty()
        || request.slug.len() > 80
        || !request
            .slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || request.display_name.trim().is_empty()
        || request.display_name.chars().count() > 100
        || request.description.chars().count() > 1000
        || !validate_localized_texts(&request.display_name_i18n, &request.description_i18n, 1000)
        || request.offers.len() > 24
        || request.benefits.len() > 100
    {
        return Err(CloudStoreError::InvalidPlan);
    }
    for offer in &request.offers {
        if offer.region.trim().is_empty()
            || offer.region.len() > 16
            || offer.currency.len() != 3
            || !offer.currency.bytes().all(|byte| byte.is_ascii_uppercase())
        {
            return Err(CloudStoreError::InvalidPlan);
        }
    }
    for benefit in &request.benefits {
        if benefit.code.trim().is_empty()
            || benefit.code.len() > 120
            || benefit.resource_type.trim().is_empty()
            || benefit.resource_type.len() > 80
            || benefit.action.trim().is_empty()
            || benefit.action.len() > 80
            || benefit
                .resource_id
                .as_ref()
                .is_some_and(|value| value.len() > 160)
            || !benefit.limit.is_object()
        {
            return Err(CloudStoreError::InvalidPlan);
        }
    }
    Ok(())
}

pub(super) fn validate_localized_texts(
    display_names: &BTreeMap<String, String>,
    descriptions: &BTreeMap<String, String>,
    description_limit: usize,
) -> bool {
    if display_names.is_empty() && descriptions.is_empty() {
        return true;
    }
    let supported = |values: &BTreeMap<String, String>, limit: usize| {
        values.len() == 2
            && ["zh-CN", "en"].iter().all(|locale| {
                values
                    .get(*locale)
                    .is_some_and(|value| !value.trim().is_empty() && value.chars().count() <= limit)
            })
    };
    supported(display_names, 100) && supported(descriptions, description_limit)
}

fn localized_json(values: &BTreeMap<String, String>) -> Result<String, CloudStoreError> {
    serde_json::to_string(values).map_err(|error| CloudStoreError::Json(error.to_string()))
}

fn parse_localized_json(value: &str) -> Result<BTreeMap<String, String>, CloudStoreError> {
    serde_json::from_str(value).map_err(|error| CloudStoreError::Json(error.to_string()))
}

fn stored_i64(value: u64) -> Result<i64, CloudStoreError> {
    i64::try_from(value).map_err(|_| CloudStoreError::CreditOverflow)
}

fn stored_u64(value: i64) -> Result<u64, CloudStoreError> {
    u64::try_from(value).map_err(|_| CloudStoreError::CatalogIntegrity)
}

fn stored_u32(value: i64) -> Result<u32, CloudStoreError> {
    u32::try_from(value).map_err(|_| CloudStoreError::CatalogIntegrity)
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, CloudStoreError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| CloudStoreError::InvalidStoredTime(value.to_owned()))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone as _, Utc};
    use tempfile::TempDir;

    use super::*;
    use crate::cloud::{PlanBenefitInput, PlanOfferInput};

    #[test]
    fn published_plan_is_versioned_and_revision_checked() {
        let root = TempDir::new().unwrap();
        let store = CloudStore::open(root.path(), "").unwrap();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let request = PublishPlanRequest {
            plan_id: None,
            slug: "pro".into(),
            display_name: "Pro".into(),
            description: "Pro plan".into(),
            display_name_i18n: std::collections::BTreeMap::from([
                ("zh-CN".into(), "专业版".into()),
                ("en".into(), "Pro".into()),
            ]),
            description_i18n: std::collections::BTreeMap::from([
                ("zh-CN".into(), "专业套餐".into()),
                ("en".into(), "Pro plan".into()),
            ]),
            tier_rank: 10,
            is_default: false,
            monthly_credit_micros: 100_000_000,
            offers: vec![PlanOfferInput {
                region: "CN".into(),
                currency: "CNY".into(),
                payment_provider: PaymentProvider::Alipay,
                amount_minor: 9900,
            }],
            benefits: vec![PlanBenefitInput {
                code: "model.codey-pro.infer".into(),
                resource_type: "model".into(),
                resource_id: Some("codey-pro".into()),
                action: "infer".into(),
                limit: serde_json::json!({"concurrency": 2}),
            }],
            expected_revision: 0,
        };
        let catalog = store.publish_plan(&request, now).unwrap();
        assert_eq!(catalog.revision, 1);
        assert_eq!(catalog.plans.len(), 2);
        let pro = catalog
            .plans
            .iter()
            .find(|plan| plan.slug == "pro")
            .unwrap();
        assert_eq!(pro.version, 1);
        assert_eq!(pro.display_name_i18n["zh-CN"], "专业版");
        assert_eq!(pro.description_i18n["en"], "Pro plan");
        assert_eq!(pro.benefits[0].resource_id.as_deref(), Some("codey-pro"));
        assert!(matches!(
            store.publish_plan(&request, now),
            Err(CloudStoreError::RevisionConflict { .. })
        ));
    }

    #[test]
    fn default_plan_identity_cannot_be_removed_or_duplicated() {
        let root = TempDir::new().unwrap();
        let store = CloudStore::open(root.path(), "").unwrap();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let mut request = PublishPlanRequest {
            plan_id: None,
            slug: "other-free".into(),
            display_name: "Other free".into(),
            description: String::new(),
            display_name_i18n: Default::default(),
            description_i18n: Default::default(),
            tier_rank: 0,
            is_default: true,
            monthly_credit_micros: 0,
            offers: Vec::new(),
            benefits: Vec::new(),
            expected_revision: 0,
        };
        assert!(matches!(
            store.publish_plan(&request, now),
            Err(CloudStoreError::InvalidPlan)
        ));
        request.plan_id = Some(DEFAULT_PLAN_ID.into());
        request.slug = "free".into();
        request.is_default = false;
        request.offers.push(PlanOfferInput {
            region: "GLOBAL".into(),
            currency: "USD".into(),
            payment_provider: PaymentProvider::Stripe,
            amount_minor: 100,
        });
        assert!(matches!(
            store.publish_plan(&request, now),
            Err(CloudStoreError::InvalidPlan)
        ));
    }
}

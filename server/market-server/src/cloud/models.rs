use base64::Engine as _;
use chrono::{DateTime, Utc};
use ring::{aead, rand as ring_rand};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::Value;

use super::store::{parse_time, stored_i64, stored_u64};
use super::{
    AdminModelCatalog, AdminOfficialModelSummary, CloudStore, CloudStoreError, ModelPricing,
    OfficialModelCatalog, OfficialModelProtocol, OfficialModelSummary, PublishOfficialModelRequest,
    UpsertUpstreamProviderRequest, UpstreamProviderKind, UpstreamProviderSummary,
};

const OFFICIAL_CONNECTION_ID: &str = "codey-official";
const OFFICIAL_PROVIDER_ID: &str = "codey-official";
const OFFICIAL_DISPLAY_NAME: &str = "CodeY 官方";

#[derive(Clone)]
pub struct CloudSecretCipher {
    key: [u8; 32],
}

impl std::fmt::Debug for CloudSecretCipher {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CloudSecretCipher")
            .finish_non_exhaustive()
    }
}

impl CloudSecretCipher {
    pub fn from_environment() -> Result<Option<Self>, CloudStoreError> {
        let Some(value) = std::env::var("CODEY_CLOUD_SECRET_KEY")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
        else {
            return Ok(None);
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(value)
            .map_err(|_| CloudStoreError::InvalidSecretKey)?;
        let key = bytes
            .try_into()
            .map_err(|_| CloudStoreError::InvalidSecretKey)?;
        Ok(Some(Self { key }))
    }

    #[cfg(test)]
    pub(super) fn for_test() -> Self {
        Self { key: [7; 32] }
    }

    pub(crate) fn encrypt(&self, plaintext: &str) -> Result<String, CloudStoreError> {
        let random = ring_rand::SystemRandom::new();
        let mut nonce_bytes = [0_u8; 12];
        ring_rand::SecureRandom::fill(&random, &mut nonce_bytes)
            .map_err(|_| CloudStoreError::SecretEncryption)?;
        let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
        let key = aead::LessSafeKey::new(
            aead::UnboundKey::new(&aead::AES_256_GCM, &self.key)
                .map_err(|_| CloudStoreError::SecretEncryption)?,
        );
        let mut ciphertext = plaintext.as_bytes().to_vec();
        key.seal_in_place_append_tag(nonce, aead::Aad::empty(), &mut ciphertext)
            .map_err(|_| CloudStoreError::SecretEncryption)?;
        let mut stored = nonce_bytes.to_vec();
        stored.extend(ciphertext);
        Ok(base64::engine::general_purpose::STANDARD.encode(stored))
    }

    pub(crate) fn decrypt(&self, stored: &str) -> Result<String, CloudStoreError> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(stored)
            .map_err(|_| CloudStoreError::SecretDecryption)?;
        if bytes.len() < 12 + aead::AES_256_GCM.tag_len() {
            return Err(CloudStoreError::SecretDecryption);
        }
        let (nonce_bytes, encrypted) = bytes.split_at(12);
        let nonce = aead::Nonce::try_assume_unique_for_key(nonce_bytes)
            .map_err(|_| CloudStoreError::SecretDecryption)?;
        let key = aead::LessSafeKey::new(
            aead::UnboundKey::new(&aead::AES_256_GCM, &self.key)
                .map_err(|_| CloudStoreError::SecretDecryption)?,
        );
        let mut encrypted = encrypted.to_vec();
        let plaintext = key
            .open_in_place(nonce, aead::Aad::empty(), &mut encrypted)
            .map_err(|_| CloudStoreError::SecretDecryption)?;
        String::from_utf8(plaintext.to_vec()).map_err(|_| CloudStoreError::SecretDecryption)
    }
}

#[derive(Debug, Clone)]
pub(super) struct GatewayModelConfig {
    pub model_id: String,
    pub upstream_model_id: String,
    pub protocol: OfficialModelProtocol,
    pub provider_kind: UpstreamProviderKind,
    pub base_url: String,
    pub api_key_ciphertext: String,
    pub pricing: ModelPricing,
    pub capability: Value,
}

impl CloudStore {
    pub fn admin_model_catalog(
        &self,
        now: DateTime<Utc>,
    ) -> Result<AdminModelCatalog, CloudStoreError> {
        let connection = self.connection()?;
        Ok(AdminModelCatalog {
            revision: model_revision(&connection)?,
            providers: upstream_providers(&connection)?,
            models: admin_models(&connection)?,
            generated_at: now,
        })
    }

    pub fn upsert_upstream_provider(
        &self,
        request: &UpsertUpstreamProviderRequest,
        cipher: &CloudSecretCipher,
        now: DateTime<Utc>,
    ) -> Result<AdminModelCatalog, CloudStoreError> {
        validate_provider(request)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_model_revision(&transaction, request.expected_revision)?;
        let provider_id = request
            .provider_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| ulid::Ulid::new().to_string());
        let existing = transaction
            .query_row(
                "SELECT provider_id, api_key_ciphertext FROM cloud_upstream_provider
                 WHERE slug=?1 OR provider_id=?2 ORDER BY provider_id=?2 DESC LIMIT 1",
                params![request.slug, provider_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if existing
            .as_ref()
            .is_some_and(|(existing_id, _)| existing_id != &provider_id)
        {
            return Err(CloudStoreError::UpstreamProviderSlugConflict(
                request.slug.clone(),
            ));
        }
        let encrypted_key = match request.api_key.as_deref().map(str::trim) {
            Some(value) if !value.is_empty() => cipher.encrypt(value)?,
            _ => existing
                .map(|(_, ciphertext)| ciphertext)
                .ok_or(CloudStoreError::UpstreamCredentialRequired)?,
        };
        transaction.execute(
            "INSERT INTO cloud_upstream_provider(
                provider_id, slug, display_name, provider_kind, base_url,
                api_key_ciphertext, active, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(provider_id) DO UPDATE SET slug=excluded.slug,
                display_name=excluded.display_name, provider_kind=excluded.provider_kind,
                base_url=excluded.base_url, api_key_ciphertext=excluded.api_key_ciphertext,
                active=excluded.active, updated_at=excluded.updated_at",
            params![
                provider_id,
                request.slug,
                request.display_name,
                request.provider_kind.as_str(),
                request.base_url.trim_end_matches('/'),
                encrypted_key,
                i64::from(request.active),
                now.to_rfc3339(),
            ],
        )?;
        increment_model_revision(&transaction)?;
        let result = AdminModelCatalog {
            revision: model_revision(&transaction)?,
            providers: upstream_providers(&transaction)?,
            models: admin_models(&transaction)?,
            generated_at: now,
        };
        transaction.commit()?;
        Ok(result)
    }

    pub fn publish_official_model(
        &self,
        request: &PublishOfficialModelRequest,
        now: DateTime<Utc>,
    ) -> Result<AdminModelCatalog, CloudStoreError> {
        validate_model(request)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_model_revision(&transaction, request.expected_revision)?;
        let provider_kind = transaction
            .query_row(
                "SELECT provider_kind FROM cloud_upstream_provider
                 WHERE provider_id=?1 AND active=1",
                [request.upstream_provider_id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| UpstreamProviderKind::parse(&value))
            .ok_or(CloudStoreError::UpstreamProviderNotFound)?;
        if !protocol_matches_provider(request.protocol, provider_kind) {
            return Err(CloudStoreError::ModelProtocolMismatch);
        }
        let model_id = request
            .model_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| ulid::Ulid::new().to_string());
        let existing = transaction
            .query_row(
                "SELECT model_id FROM cloud_official_model
                 WHERE public_model_id=?1 OR model_id=?2 ORDER BY model_id=?2 DESC LIMIT 1",
                params![request.public_model_id, model_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if existing
            .as_deref()
            .is_some_and(|existing| existing != model_id)
        {
            return Err(CloudStoreError::OfficialModelIdConflict(
                request.public_model_id.clone(),
            ));
        }
        transaction.execute(
            "INSERT INTO cloud_official_model(
                model_id, public_model_id, display_name, upstream_provider_id,
                upstream_model_id, protocol, capability_json, active, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(model_id) DO UPDATE SET public_model_id=excluded.public_model_id,
                display_name=excluded.display_name,
                upstream_provider_id=excluded.upstream_provider_id,
                upstream_model_id=excluded.upstream_model_id, protocol=excluded.protocol,
                capability_json=excluded.capability_json, active=excluded.active,
                updated_at=excluded.updated_at",
            params![
                model_id,
                request.public_model_id,
                request.display_name,
                request.upstream_provider_id,
                request.upstream_model_id,
                request.protocol.as_str(),
                serde_json::to_string(&request.capability)
                    .map_err(|error| CloudStoreError::Json(error.to_string()))?,
                i64::from(request.active),
                now.to_rfc3339(),
            ],
        )?;
        let version = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0)+1 FROM cloud_model_pricing WHERE model_id=?1",
            [model_id.as_str()],
            |row| row.get::<_, i64>(0),
        )?;
        transaction.execute(
            "INSERT INTO cloud_model_pricing(
                pricing_id, model_id, version, input_credit_micros_per_million,
                output_credit_micros_per_million, cache_read_credit_micros_per_million,
                cache_write_credit_micros_per_million, fixed_credit_micros_per_request,
                published_at, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                ulid::Ulid::new().to_string(),
                model_id,
                version,
                stored_i64(request.pricing.input_credit_micros_per_million)?,
                stored_i64(request.pricing.output_credit_micros_per_million)?,
                stored_i64(request.pricing.cache_read_credit_micros_per_million)?,
                stored_i64(request.pricing.cache_write_credit_micros_per_million)?,
                stored_i64(request.pricing.fixed_credit_micros_per_request)?,
                now.to_rfc3339(),
            ],
        )?;
        increment_model_revision(&transaction)?;
        let result = AdminModelCatalog {
            revision: model_revision(&transaction)?,
            providers: upstream_providers(&transaction)?,
            models: admin_models(&transaction)?,
            generated_at: now,
        };
        transaction.commit()?;
        Ok(result)
    }

    pub fn official_model_catalog(
        &self,
        user_id: &str,
        gateway_base_url: &str,
        now: DateTime<Utc>,
    ) -> Result<OfficialModelCatalog, CloudStoreError> {
        let connection = self.connection()?;
        let mut models = Vec::new();
        for model in gateway_models(&connection, true)? {
            if model_entitled(&connection, user_id, &model, now)? {
                models.push(OfficialModelSummary {
                    model_id: model.model_id,
                    public_model_id: model.public_model_id,
                    display_name: model.display_name,
                    protocol: model.protocol,
                    capability: model.capability,
                    pricing: model.pricing,
                });
            }
        }
        Ok(OfficialModelCatalog {
            revision: model_revision(&connection)?,
            connection_id: OFFICIAL_CONNECTION_ID.into(),
            provider_id: OFFICIAL_PROVIDER_ID.into(),
            display_name: OFFICIAL_DISPLAY_NAME.into(),
            base_url: gateway_base_url.trim_end_matches('/').to_owned(),
            models,
            generated_at: now,
        })
    }

    pub(super) fn gateway_model(
        &self,
        user_id: &str,
        public_model_id: &str,
        now: DateTime<Utc>,
    ) -> Result<GatewayModelConfig, CloudStoreError> {
        let connection = self.connection()?;
        let model = gateway_models(&connection, true)?
            .into_iter()
            .find(|model| model.public_model_id == public_model_id)
            .ok_or(CloudStoreError::OfficialModelNotFound)?;
        if !model_entitled(&connection, user_id, &model, now)? {
            return Err(CloudStoreError::ModelNotEntitled);
        }
        Ok(model.into())
    }
}

#[derive(Debug)]
struct StoredGatewayModel {
    model_id: String,
    public_model_id: String,
    display_name: String,
    upstream_model_id: String,
    protocol: OfficialModelProtocol,
    provider_kind: UpstreamProviderKind,
    base_url: String,
    api_key_ciphertext: String,
    capability: Value,
    pricing: ModelPricing,
}

impl From<StoredGatewayModel> for GatewayModelConfig {
    fn from(value: StoredGatewayModel) -> Self {
        Self {
            model_id: value.model_id,
            upstream_model_id: value.upstream_model_id,
            protocol: value.protocol,
            provider_kind: value.provider_kind,
            base_url: value.base_url,
            api_key_ciphertext: value.api_key_ciphertext,
            pricing: value.pricing,
            capability: value.capability,
        }
    }
}

fn gateway_models(
    connection: &rusqlite::Connection,
    active_only: bool,
) -> Result<Vec<StoredGatewayModel>, CloudStoreError> {
    let predicate = if active_only {
        "WHERE m.active=1 AND p.active=1"
    } else {
        ""
    };
    let mut statement = connection.prepare(&format!(
        "SELECT m.model_id, m.public_model_id, m.display_name, m.upstream_model_id,
                m.protocol, m.capability_json, p.provider_kind, p.base_url,
                p.api_key_ciphertext, pr.pricing_id, pr.version,
                pr.input_credit_micros_per_million,
                pr.output_credit_micros_per_million,
                pr.cache_read_credit_micros_per_million,
                pr.cache_write_credit_micros_per_million,
                pr.fixed_credit_micros_per_request, pr.published_at
         FROM cloud_official_model m
         JOIN cloud_upstream_provider p ON p.provider_id=m.upstream_provider_id
         JOIN cloud_model_pricing pr ON pr.model_id=m.model_id
         {predicate}
           {and_where} pr.version=(SELECT MAX(latest.version) FROM cloud_model_pricing latest
                                   WHERE latest.model_id=m.model_id)
         ORDER BY m.public_model_id",
        and_where = if active_only { "AND" } else { "WHERE" },
    ))?;
    let models = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, i64>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, i64>(13)?,
                row.get::<_, i64>(14)?,
                row.get::<_, i64>(15)?,
                row.get::<_, String>(16)?,
            ))
        })?
        .map(|row| -> Result<StoredGatewayModel, CloudStoreError> {
            let row = row?;
            Ok(StoredGatewayModel {
                model_id: row.0,
                public_model_id: row.1,
                display_name: row.2,
                upstream_model_id: row.3,
                protocol: OfficialModelProtocol::parse(&row.4)
                    .ok_or(CloudStoreError::ModelCatalogIntegrity)?,
                capability: serde_json::from_str(&row.5)
                    .map_err(|error| CloudStoreError::Json(error.to_string()))?,
                provider_kind: UpstreamProviderKind::parse(&row.6)
                    .ok_or(CloudStoreError::ModelCatalogIntegrity)?,
                base_url: row.7,
                api_key_ciphertext: row.8,
                pricing: ModelPricing {
                    pricing_id: row.9,
                    version: u32::try_from(row.10)
                        .map_err(|_| CloudStoreError::ModelCatalogIntegrity)?,
                    input_credit_micros_per_million: stored_u64(row.11)?,
                    output_credit_micros_per_million: stored_u64(row.12)?,
                    cache_read_credit_micros_per_million: stored_u64(row.13)?,
                    cache_write_credit_micros_per_million: stored_u64(row.14)?,
                    fixed_credit_micros_per_request: stored_u64(row.15)?,
                    published_at: parse_time(&row.16)?,
                },
            })
        })
        .collect();
    models
}

fn upstream_providers(
    connection: &rusqlite::Connection,
) -> Result<Vec<UpstreamProviderSummary>, CloudStoreError> {
    let mut statement = connection.prepare(
        "SELECT provider_id, slug, display_name, provider_kind, base_url,
                api_key_ciphertext, active, updated_at
         FROM cloud_upstream_provider ORDER BY slug",
    )?;
    let providers = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?
        .map(|row| -> Result<UpstreamProviderSummary, CloudStoreError> {
            let row = row?;
            Ok(UpstreamProviderSummary {
                provider_id: row.0,
                slug: row.1,
                display_name: row.2,
                provider_kind: UpstreamProviderKind::parse(&row.3)
                    .ok_or(CloudStoreError::ModelCatalogIntegrity)?,
                base_url: row.4,
                credential_configured: !row.5.is_empty(),
                active: row.6 != 0,
                updated_at: parse_time(&row.7)?,
            })
        })
        .collect();
    providers
}

fn admin_models(
    connection: &rusqlite::Connection,
) -> Result<Vec<AdminOfficialModelSummary>, CloudStoreError> {
    let active = connection
        .prepare("SELECT model_id, active, upstream_provider_id FROM cloud_official_model")?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    gateway_models(connection, false)?
        .into_iter()
        .map(|model| {
            let (_, enabled, upstream_provider_id) = active
                .iter()
                .find(|(model_id, _, _)| model_id == &model.model_id)
                .ok_or(CloudStoreError::ModelCatalogIntegrity)?;
            Ok(AdminOfficialModelSummary {
                model_id: model.model_id,
                public_model_id: model.public_model_id,
                display_name: model.display_name,
                upstream_provider_id: upstream_provider_id.clone(),
                upstream_model_id: model.upstream_model_id,
                protocol: model.protocol,
                capability: model.capability,
                pricing: model.pricing,
                active: *enabled != 0,
            })
        })
        .collect()
}

fn model_entitled(
    connection: &rusqlite::Connection,
    user_id: &str,
    model: &StoredGatewayModel,
    now: DateTime<Utc>,
) -> Result<bool, CloudStoreError> {
    let entitled = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM cloud_subscription s
            JOIN cloud_subscription_period period ON period.period_id=s.current_period_id
            JOIN cloud_plan_benefit pb ON pb.plan_version_id=s.plan_version_id
            JOIN cloud_benefit_definition benefit ON benefit.benefit_id=pb.benefit_id
            WHERE s.user_id=?1 AND s.status='active' AND period.ends_at>?2
              AND benefit.resource_type='model' AND benefit.action='invoke'
              AND (benefit.resource_id IS NULL OR benefit.resource_id=?3 OR benefit.resource_id=?4)
         )",
        params![
            user_id,
            now.to_rfc3339(),
            model.model_id,
            model.public_model_id,
        ],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(entitled != 0)
}

fn model_revision(connection: &rusqlite::Connection) -> Result<u64, CloudStoreError> {
    stored_u64(connection.query_row(
        "SELECT revision FROM cloud_config_revision WHERE domain='models'",
        [],
        |row| row.get::<_, i64>(0),
    )?)
}

fn require_model_revision(
    connection: &rusqlite::Connection,
    expected: u64,
) -> Result<(), CloudStoreError> {
    let actual = model_revision(connection)?;
    if actual == expected {
        Ok(())
    } else {
        Err(CloudStoreError::RevisionConflict { expected, actual })
    }
}

fn increment_model_revision(connection: &rusqlite::Connection) -> Result<(), CloudStoreError> {
    connection.execute(
        "UPDATE cloud_config_revision SET revision=revision+1 WHERE domain='models'",
        [],
    )?;
    Ok(())
}

fn protocol_matches_provider(
    protocol: OfficialModelProtocol,
    provider: UpstreamProviderKind,
) -> bool {
    matches!(
        (protocol, provider),
        (
            OfficialModelProtocol::ChatCompletions | OfficialModelProtocol::Responses,
            UpstreamProviderKind::OpenaiCompatible
        ) | (
            OfficialModelProtocol::Messages,
            UpstreamProviderKind::Anthropic
        ) | (
            OfficialModelProtocol::GenerateContent,
            UpstreamProviderKind::Gemini
        )
    )
}

fn validate_provider(request: &UpsertUpstreamProviderRequest) -> Result<(), CloudStoreError> {
    if !valid_slug(&request.slug)
        || request.display_name.trim().is_empty()
        || request.display_name.chars().count() > 100
    {
        return Err(CloudStoreError::InvalidUpstreamProvider);
    }
    let url =
        url::Url::parse(&request.base_url).map_err(|_| CloudStoreError::InvalidUpstreamProvider)?;
    let loopback = url
        .host_str()
        .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1"));
    if (!loopback && url.scheme() != "https") || url.host_str().is_none() {
        return Err(CloudStoreError::InvalidUpstreamProvider);
    }
    Ok(())
}

fn validate_model(request: &PublishOfficialModelRequest) -> Result<(), CloudStoreError> {
    if !valid_slug(&request.public_model_id)
        || request.display_name.trim().is_empty()
        || request.display_name.chars().count() > 100
        || request.upstream_provider_id.trim().is_empty()
        || request.upstream_model_id.trim().is_empty()
        || !request.capability.is_object()
        || (request.pricing.input_credit_micros_per_million == 0
            && request.pricing.output_credit_micros_per_million == 0
            && request.pricing.fixed_credit_micros_per_request == 0)
    {
        return Err(CloudStoreError::InvalidOfficialModel);
    }
    Ok(())
}

fn valid_slug(value: &str) -> bool {
    (2..=100).contains(&value.len())
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_' | b'.')
        })
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone as _, Utc};
    use tempfile::TempDir;

    use super::*;
    use crate::cloud::{ModelPricingInput, PlanBenefitInput, PublishPlanRequest};

    #[test]
    fn model_credentials_are_encrypted_and_catalog_is_entitlement_filtered() {
        let root = TempDir::new().unwrap();
        let store = CloudStore::open(root.path()).unwrap();
        let cipher = CloudSecretCipher::for_test();
        let now = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let admin = store
            .upsert_upstream_provider(
                &UpsertUpstreamProviderRequest {
                    provider_id: None,
                    slug: "openai-main".into(),
                    display_name: "OpenAI".into(),
                    provider_kind: UpstreamProviderKind::OpenaiCompatible,
                    base_url: "https://api.openai.com".into(),
                    api_key: Some("secret-upstream-key".into()),
                    active: true,
                    expected_revision: 0,
                },
                &cipher,
                now,
            )
            .unwrap();
        let provider_id = admin.providers[0].provider_id.clone();
        let admin = store
            .publish_official_model(
                &PublishOfficialModelRequest {
                    model_id: None,
                    public_model_id: "gpt-official".into(),
                    display_name: "GPT Official".into(),
                    upstream_provider_id: provider_id,
                    upstream_model_id: "gpt-upstream".into(),
                    protocol: OfficialModelProtocol::Responses,
                    capability: serde_json::json!({"contextWindow": 128_000}),
                    pricing: ModelPricingInput {
                        input_credit_micros_per_million: 1_000_000,
                        output_credit_micros_per_million: 2_000_000,
                        cache_read_credit_micros_per_million: 500_000,
                        cache_write_credit_micros_per_million: 1_000_000,
                        fixed_credit_micros_per_request: 0,
                    },
                    active: true,
                    expected_revision: admin.revision,
                },
                now,
            )
            .unwrap();
        let model_id = admin.models[0].model_id.clone();
        let catalog = store
            .publish_plan(
                &PublishPlanRequest {
                    plan_id: Some("plan-free".into()),
                    slug: "free".into(),
                    display_name: "Pro".into(),
                    description: "Pro".into(),
                    tier_rank: 10,
                    is_default: true,
                    monthly_credit_micros: 100_000_000,
                    offers: Vec::new(),
                    benefits: vec![PlanBenefitInput {
                        code: "official-model".into(),
                        resource_type: "model".into(),
                        resource_id: Some(model_id),
                        action: "invoke".into(),
                        limit: serde_json::json!({}),
                    }],
                    expected_revision: 0,
                },
                now,
            )
            .unwrap();
        assert_eq!(catalog.revision, 1);
        store
            .ensure_default_subscription("user-1", "UTC", now)
            .unwrap();
        let catalog = store
            .official_model_catalog("user-1", "https://cloud.example/gateway", now)
            .unwrap();
        assert_eq!(catalog.connection_id, OFFICIAL_CONNECTION_ID);
        assert_eq!(catalog.models.len(), 1);
        let gateway = store.gateway_model("user-1", "gpt-official", now).unwrap();
        assert_eq!(
            cipher.decrypt(&gateway.api_key_ciphertext).unwrap(),
            "secret-upstream-key"
        );
        let database = std::fs::read(root.path().join("marketplace.sqlite3")).unwrap();
        assert!(!database
            .windows("secret-upstream-key".len())
            .any(|window| window == b"secret-upstream-key"));
    }
}

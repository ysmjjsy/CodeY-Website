use std::fs::OpenOptions;
use std::path::Path;
use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::{DateTime, Duration, NaiveDate, TimeZone as _, Utc};
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair as _};
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

use super::{OfficialModelCatalog, OfficialModelProtocol, SubscriptionSnapshot};

const ENTITLEMENT_SCHEMA_VERSION: u32 = 1;
const ENTITLEMENT_KEY_FILE: &str = "cloud-entitlement-ed25519.pk8";
const DEFAULT_KEY_ID: &str = "codey-cloud-v1";
const DEFAULT_CONTEXT_WINDOW: u32 = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 8_192;

#[derive(Clone)]
pub struct CloudEntitlementSigner {
    key_id: String,
    key_pair: Arc<Ed25519KeyPair>,
    not_before: DateTime<Utc>,
    not_after: DateTime<Utc>,
}

impl std::fmt::Debug for CloudEntitlementSigner {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CloudEntitlementSigner")
            .field("key_id", &self.key_id)
            .field("not_before", &self.not_before)
            .field("not_after", &self.not_after)
            .finish_non_exhaustive()
    }
}

impl CloudEntitlementSigner {
    pub fn load_or_create(data_root: &Path) -> Result<Self, CloudEntitlementError> {
        let key_id = std::env::var("CODEY_CLOUD_ENTITLEMENT_KEY_ID")
            .unwrap_or_else(|_| DEFAULT_KEY_ID.to_owned());
        if key_id.trim().is_empty()
            || key_id.len() > 128
            || !key_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err(CloudEntitlementError::InvalidKeyId);
        }
        let key_bytes = match std::env::var("CODEY_CLOUD_ENTITLEMENT_SIGNING_KEY") {
            Ok(value) if !value.trim().is_empty() => URL_SAFE_NO_PAD
                .decode(value.trim())
                .map_err(|_| CloudEntitlementError::InvalidPrivateKey)?,
            _ => persistent_key(data_root)?,
        };
        let key_pair = Ed25519KeyPair::from_pkcs8(&key_bytes)
            .map_err(|_| CloudEntitlementError::InvalidPrivateKey)?;
        Ok(Self {
            key_id,
            key_pair: Arc::new(key_pair),
            not_before: Utc
                .timestamp_opt(0, 0)
                .single()
                .ok_or(CloudEntitlementError::InvalidValidity)?,
            not_after: Utc
                .with_ymd_and_hms(2100, 1, 1, 0, 0, 0)
                .single()
                .ok_or(CloudEntitlementError::InvalidValidity)?,
        })
    }

    #[must_use]
    pub fn verification_key(&self) -> CloudEntitlementVerificationKey {
        CloudEntitlementVerificationKey {
            key_id: self.key_id.clone(),
            algorithm: CloudEntitlementSignatureAlgorithm::Ed25519,
            public_key: URL_SAFE_NO_PAD.encode(self.key_pair.public_key().as_ref()),
            not_before: self.not_before,
            not_after: self.not_after,
        }
    }

    pub fn issue(
        &self,
        account_id: &str,
        subscription: &SubscriptionSnapshot,
        catalog: &OfficialModelCatalog,
        now: DateTime<Utc>,
    ) -> Result<CloudOfficialEntitlementEnvelope, CloudEntitlementError> {
        let revision = catalog.revision.max(1);
        let entitlement_id = format!(
            "codey-official:{}:{}",
            account_id, subscription.subscription_id
        );
        let source_url = format!(
            "{}/entitlements/models",
            catalog.base_url.trim_end_matches("/gateway")
        );
        let models = catalog
            .models
            .iter()
            .filter_map(|model| {
                entitled_model(
                    model,
                    &entitlement_id,
                    revision,
                    &source_url,
                    now.date_naive(),
                )
            })
            .collect::<Vec<_>>();
        let expires_at = std::cmp::min(now + Duration::hours(12), subscription.current_period_end);
        if expires_at <= now {
            return Err(CloudEntitlementError::SubscriptionExpired);
        }
        let payload = serde_json::json!({
            "schemaVersion": ENTITLEMENT_SCHEMA_VERSION,
            "entitlementId": entitlement_id,
            "accountId": account_id,
            "subscriptionId": subscription.subscription_id,
            "region": "global",
            "issuedAt": now,
            "expiresAt": expires_at,
            "revision": revision,
            "connectionId": catalog.connection_id,
            "providerId": catalog.provider_id,
            "displayName": catalog.display_name,
            "baseUrl": catalog.base_url,
            "models": models,
        });
        let payload_bytes = serde_json::to_vec(&payload)?;
        let signature = self.key_pair.sign(&payload_bytes);
        Ok(CloudOfficialEntitlementEnvelope {
            schema_version: ENTITLEMENT_SCHEMA_VERSION,
            key_id: self.key_id.clone(),
            algorithm: CloudEntitlementSignatureAlgorithm::Ed25519,
            payload: URL_SAFE_NO_PAD.encode(payload_bytes),
            signature: URL_SAFE_NO_PAD.encode(signature.as_ref()),
        })
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CloudEntitlementSignatureAlgorithm {
    Ed25519,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudEntitlementVerificationKey {
    pub key_id: String,
    pub algorithm: CloudEntitlementSignatureAlgorithm,
    pub public_key: String,
    pub not_before: DateTime<Utc>,
    pub not_after: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudOfficialEntitlementEnvelope {
    pub schema_version: u32,
    pub key_id: String,
    pub algorithm: CloudEntitlementSignatureAlgorithm,
    pub payload: String,
    pub signature: String,
}

fn entitled_model(
    model: &super::OfficialModelSummary,
    entitlement_id: &str,
    revision: u64,
    source_url: &str,
    verified_at: NaiveDate,
) -> Option<Value> {
    let protocol = desktop_protocol(model.protocol)?;
    let input_modalities = modalities(&model.capability, "input_modalities", "inputModalities");
    let output_modalities = modalities(&model.capability, "output_modalities", "outputModalities");
    let context_window = capability_u32(
        &model.capability,
        "context_window",
        "contextWindow",
        DEFAULT_CONTEXT_WINDOW,
    );
    let max_output_tokens = capability_u32(
        &model.capability,
        "max_output_tokens",
        "maxOutputTokens",
        DEFAULT_MAX_OUTPUT_TOKENS,
    );
    let streaming = capability_bool(&model.capability, "streaming", "streaming", true);
    let tool_calling = capability_bool(&model.capability, "tool_calling", "toolCalling", true);
    let reasoning = capability_bool(&model.capability, "reasoning", "reasoning", false);
    let prompt_cache = capability_bool(&model.capability, "prompt_cache", "promptCache", false);
    let structured_output = capability_bool(
        &model.capability,
        "structured_output",
        "structuredOutput",
        false,
    );
    let hosted_tool_search = capability_bool(
        &model.capability,
        "hosted_tool_search",
        "hostedToolSearch",
        false,
    );
    let tool_observation_protocol = capability_value(
        &model.capability,
        "tool_observation_protocol",
        "toolObservationProtocol",
    )
    .and_then(Value::as_str)
    .filter(|value| {
        matches!(
            *value,
            "open_ai_responses_output"
                | "anthropic_tool_result"
                | "gemini_function_response"
                | "multimodal_followup"
        )
    });
    let mut supported_parameters = Vec::new();
    if tool_calling {
        supported_parameters.push("tools".to_owned());
    }
    if structured_output {
        supported_parameters.push("response_format".to_owned());
    }
    let input_price = model.pricing.input_credit_micros_per_million.to_string();
    let output_price = model.pricing.output_credit_micros_per_million.to_string();
    let cache_read_price = model
        .pricing
        .cache_read_credit_micros_per_million
        .to_string();
    let cache_write_price = model
        .pricing
        .cache_write_credit_micros_per_million
        .to_string();
    let fixed_price = model.pricing.fixed_credit_micros_per_request.to_string();
    Some(serde_json::json!({
        "model": {
            "providerId": "codey-official",
            "modelId": model.public_model_id,
            "displayName": model.display_name,
            "version": { "kind": "canonical", "canonicalModelId": model.public_model_id },
            "providerProtocol": protocol,
            "protocol": protocol,
            "executionKind": "conversation",
            "providerDeclaredCapability": {
                "inputModalities": input_modalities,
                "outputModalities": output_modalities,
                "contextWindow": context_window,
                "maxOutputTokens": max_output_tokens,
                "streaming": streaming,
                "toolCalling": tool_calling,
                "reasoning": reasoning,
                "promptCache": prompt_cache,
                "structuredOutput": structured_output,
                "hostedToolSearch": hosted_tool_search,
            },
            "conversationCapability": {
                "input_modalities": input_modalities,
                "output_modalities": output_modalities,
                "context_window": context_window,
                "max_output_tokens": max_output_tokens,
                "streaming": streaming,
                "tool_calling": tool_calling,
                "reasoning": reasoning,
                "prompt_cache": prompt_cache,
                "structured_output": structured_output,
                "hosted_tool_search": hosted_tool_search,
                "tool_observation_protocol": tool_observation_protocol,
            },
            "services": [],
            "supportedParameters": supported_parameters,
            "runtimeSemanticsKey": protocol,
            "runtimeOptions": {},
            "pricing": {
                "pricingId": model.pricing.pricing_id,
                "pricingVersion": model.pricing.version,
                "currency": "CREDIT",
                "inputPerMillion": input_price,
                "outputPerMillion": output_price,
                "cacheCreationPerMillion": cache_write_price,
                "cacheReadPerMillion": cache_read_price,
                "imagePerImage": null,
                "lastUpdated": model.pricing.published_at,
                "source": source_url,
                "billingMode": { "kind": "standard" },
            },
            "lifecycle": { "status": "stable" },
            "sourceKind": "gateway_entitlement",
            "availabilityScope": "gateway",
            "scopeId": entitlement_id,
            "sourceUrl": source_url,
            "sourceRevision": revision.to_string(),
            "verifiedAt": verified_at,
            "adapterBindings": [{
                "key": format!("conversation.codey-official.{protocol}"),
                "version": "1",
            }],
            "capabilityRestrictions": [],
        },
        "pricing": {
            "pricingId": model.pricing.pricing_id,
            "inputCreditMicrosPerMillion": input_price,
            "outputCreditMicrosPerMillion": output_price,
            "cacheReadCreditMicrosPerMillion": cache_read_price,
            "cacheWriteCreditMicrosPerMillion": cache_write_price,
            "fixedCreditMicrosPerRequest": fixed_price,
        },
    }))
}

fn desktop_protocol(protocol: OfficialModelProtocol) -> Option<&'static str> {
    match protocol {
        OfficialModelProtocol::ChatCompletions => Some("chat_completions"),
        OfficialModelProtocol::Responses => Some("responses"),
        OfficialModelProtocol::Messages => Some("messages"),
        OfficialModelProtocol::GenerateContent => Some("generate_content"),
        OfficialModelProtocol::ImageGeneration
        | OfficialModelProtocol::ImageEdit
        | OfficialModelProtocol::VideoGeneration
        | OfficialModelProtocol::SpeechSynthesis
        | OfficialModelProtocol::MusicGeneration => None,
    }
}

fn modalities(value: &Value, snake_case: &str, camel_case: &str) -> Vec<String> {
    let modalities = capability_value(value, snake_case, camel_case)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|modality| {
            matches!(
                *modality,
                "text" | "image" | "audio" | "video" | "file" | "embedding"
            )
        })
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if modalities.is_empty() {
        vec!["text".to_owned()]
    } else {
        modalities
    }
}

fn capability_u32(value: &Value, snake_case: &str, camel_case: &str, default: u32) -> u32 {
    capability_value(value, snake_case, camel_case)
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
        .filter(|number| *number > 0)
        .unwrap_or(default)
}

fn capability_bool(value: &Value, snake_case: &str, camel_case: &str, default: bool) -> bool {
    capability_value(value, snake_case, camel_case)
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

fn capability_value<'a>(value: &'a Value, snake_case: &str, camel_case: &str) -> Option<&'a Value> {
    value.get(snake_case).or_else(|| value.get(camel_case))
}

fn persistent_key(data_root: &Path) -> Result<Vec<u8>, CloudEntitlementError> {
    std::fs::create_dir_all(data_root)?;
    let path = data_root.join(ENTITLEMENT_KEY_FILE);
    match std::fs::read(&path) {
        Ok(bytes) => return Ok(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let document = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
        .map_err(|_| CloudEntitlementError::KeyGeneration)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut file) => {
            use std::io::Write as _;
            file.write_all(document.as_ref())?;
            file.sync_all()?;
            Ok(document.as_ref().to_vec())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(std::fs::read(path)?),
        Err(error) => Err(error.into()),
    }
}

#[derive(Debug, Error)]
pub enum CloudEntitlementError {
    #[error("CodeY Cloud entitlement signing key ID is invalid")]
    InvalidKeyId,
    #[error("CodeY Cloud entitlement signing key is invalid")]
    InvalidPrivateKey,
    #[error("CodeY Cloud entitlement signing key generation failed")]
    KeyGeneration,
    #[error("CodeY Cloud entitlement signing key validity is invalid")]
    InvalidValidity,
    #[error("CodeY Cloud subscription has expired")]
    SubscriptionExpired,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use base64::Engine as _;
    use ring::signature;
    use serde_json::json;

    use super::*;
    use crate::cloud::{ModelPricing, OfficialModelSummary, SubscriptionStatus};

    #[test]
    fn issued_entitlement_has_a_verifiable_desktop_shape() {
        let root = tempfile::tempdir().unwrap();
        let signer = CloudEntitlementSigner::load_or_create(root.path()).unwrap();
        let now = Utc::now();
        let subscription = SubscriptionSnapshot {
            subscription_id: "subscription-1".into(),
            user_id: "user-1".into(),
            plan_id: "plan-pro".into(),
            plan_version_id: "plan-pro-v1".into(),
            status: SubscriptionStatus::Active,
            current_period_id: "period-1".into(),
            current_period_start: now - Duration::days(1),
            current_period_end: now + Duration::days(20),
            billing_timezone: "UTC".into(),
            billing_anchor_day: 1,
            scheduled_plan_id: None,
        };
        let catalog = OfficialModelCatalog {
            revision: 4,
            connection_id: "codey-official".into(),
            provider_id: "codey-official".into(),
            display_name: "CodeY Official".into(),
            base_url: "https://cloud.example/api/cloud/v1/gateway".into(),
            models: vec![OfficialModelSummary {
                model_id: "internal-model-1".into(),
                public_model_id: "official-gpt".into(),
                display_name: "Official GPT".into(),
                protocol: OfficialModelProtocol::Responses,
                capability: json!({
                    "input_modalities": ["text", "image"],
                    "output_modalities": ["text"],
                    "context_window": 128_000,
                    "max_output_tokens": 8192,
                    "streaming": true,
                    "tool_calling": true,
                    "reasoning": true,
                    "prompt_cache": true,
                    "structured_output": true
                }),
                pricing: ModelPricing {
                    pricing_id: "pricing-1".into(),
                    version: 1,
                    input_credit_micros_per_million: 1_000_000,
                    output_credit_micros_per_million: 5_000_000,
                    cache_read_credit_micros_per_million: 100_000,
                    cache_write_credit_micros_per_million: 0,
                    fixed_credit_micros_per_request: 0,
                    published_at: now,
                },
            }],
            generated_at: now,
        };

        let envelope = signer
            .issue("user-1", &subscription, &catalog, now)
            .unwrap();
        let payload = URL_SAFE_NO_PAD.decode(&envelope.payload).unwrap();
        let signature = URL_SAFE_NO_PAD.decode(&envelope.signature).unwrap();
        let public_key = URL_SAFE_NO_PAD
            .decode(signer.verification_key().public_key)
            .unwrap();
        signature::UnparsedPublicKey::new(&signature::ED25519, public_key)
            .verify(&payload, &signature)
            .unwrap();
        let payload: Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(payload["schemaVersion"], 1);
        assert_eq!(payload["accountId"], "user-1");
        assert_eq!(payload["subscriptionId"], "subscription-1");
        assert_eq!(payload["baseUrl"], catalog.base_url);
        assert_eq!(payload["models"][0]["model"]["modelId"], "official-gpt");
        assert_eq!(
            payload["models"][0]["model"]["adapterBindings"][0]["key"],
            "conversation.codey-official.responses"
        );
        assert_eq!(
            payload["models"][0]["pricing"]["inputCreditMicrosPerMillion"],
            "1000000"
        );
    }
}

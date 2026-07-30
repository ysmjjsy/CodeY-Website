use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CREDIT_MICROS_PER_POINT: u64 = 1_000_000;

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct OAuthTokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: u64,
    pub scope: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthDeviceSession {
    pub device_id: String,
    pub device_name: String,
    pub client_id: String,
    pub scope: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentProvider {
    WechatPay,
    Alipay,
    Stripe,
    Test,
}

impl PaymentProvider {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::WechatPay => "wechat_pay",
            Self::Alipay => "alipay",
            Self::Stripe => "stripe",
            Self::Test => "test",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "wechat_pay" => Some(Self::WechatPay),
            "alipay" => Some(Self::Alipay),
            "stripe" => Some(Self::Stripe),
            "test" => Some(Self::Test),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanOfferInput {
    pub region: String,
    pub currency: String,
    pub payment_provider: PaymentProvider,
    pub amount_minor: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanBenefitInput {
    pub code: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub action: String,
    #[serde(default = "empty_object")]
    pub limit: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishPlanRequest {
    pub plan_id: Option<String>,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    #[serde(default)]
    pub display_name_i18n: BTreeMap<String, String>,
    #[serde(default)]
    pub description_i18n: BTreeMap<String, String>,
    pub tier_rank: u32,
    #[serde(default)]
    pub is_default: bool,
    pub monthly_credit_micros: u64,
    #[serde(default)]
    pub offers: Vec<PlanOfferInput>,
    #[serde(default)]
    pub benefits: Vec<PlanBenefitInput>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanOffer {
    pub offer_id: String,
    pub region: String,
    pub currency: String,
    pub payment_provider: PaymentProvider,
    pub amount_minor: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanBenefit {
    pub code: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub action: String,
    pub limit: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummary {
    pub plan_id: String,
    pub plan_version_id: String,
    pub version: u32,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub display_name_i18n: BTreeMap<String, String>,
    pub description_i18n: BTreeMap<String, String>,
    pub tier_rank: u32,
    pub is_default: bool,
    pub monthly_credit_micros: u64,
    pub offers: Vec<PlanOffer>,
    pub benefits: Vec<PlanBenefit>,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCatalog {
    pub revision: u64,
    pub plans: Vec<PlanSummary>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishTopUpProductRequest {
    pub product_id: Option<String>,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    #[serde(default)]
    pub display_name_i18n: BTreeMap<String, String>,
    #[serde(default)]
    pub description_i18n: BTreeMap<String, String>,
    pub credit_micros: u64,
    #[serde(default)]
    pub offers: Vec<PlanOfferInput>,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopUpProductSummary {
    pub product_id: String,
    pub product_version_id: String,
    pub version: u32,
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub display_name_i18n: BTreeMap<String, String>,
    pub description_i18n: BTreeMap<String, String>,
    pub credit_micros: u64,
    pub offers: Vec<PlanOffer>,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopUpCatalog {
    pub revision: u64,
    pub products: Vec<TopUpProductSummary>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentOrderPurpose {
    PlanPurchase,
    PlanUpgrade,
    EarlyRenewal,
    TopUp,
}

impl PaymentOrderPurpose {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::PlanPurchase => "plan_purchase",
            Self::PlanUpgrade => "plan_upgrade",
            Self::EarlyRenewal => "early_renewal",
            Self::TopUp => "top_up",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "plan_purchase" => Some(Self::PlanPurchase),
            "plan_upgrade" => Some(Self::PlanUpgrade),
            "early_renewal" => Some(Self::EarlyRenewal),
            "top_up" => Some(Self::TopUp),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentOrderStatus {
    Pending,
    Fulfilled,
    ActionRequired,
    Cancelled,
    Refunded,
}

impl PaymentOrderStatus {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "fulfilled" => Some(Self::Fulfilled),
            "action_required" => Some(Self::ActionRequired),
            "cancelled" => Some(Self::Cancelled),
            "refunded" => Some(Self::Refunded),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePlanOrderRequest {
    pub offer_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateTopUpOrderRequest {
    pub offer_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchedulePlanChangeRequest {
    pub plan_id: String,
    pub expected_period_id: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentOrder {
    pub order_id: String,
    pub user_id: String,
    pub purpose: PaymentOrderPurpose,
    pub status: PaymentOrderStatus,
    pub provider: PaymentProvider,
    pub provider_order_id: Option<String>,
    pub offer_id: String,
    pub plan_id: Option<String>,
    pub plan_version_id: Option<String>,
    pub top_up_product_id: Option<String>,
    pub top_up_version_id: Option<String>,
    pub source_period_id: Option<String>,
    pub amount_minor: u64,
    pub region: String,
    pub currency: String,
    pub credit_micros: u64,
    pub period_starts_at: Option<DateTime<Utc>>,
    pub period_ends_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub fulfilled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PaymentCheckoutAction {
    Redirect {
        url: String,
    },
    QrCode {
        code_url: String,
        image_data_url: String,
    },
    Form {
        method: String,
        action: String,
        fields: BTreeMap<String, String>,
    },
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentCheckout {
    pub order: PaymentOrder,
    pub action: PaymentCheckoutAction,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAvailability {
    pub providers: Vec<PaymentProvider>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpstreamProviderKind {
    OpenaiCompatible,
    Anthropic,
    Gemini,
}

impl UpstreamProviderKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::OpenaiCompatible => "openai_compatible",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "openai_compatible" => Some(Self::OpenaiCompatible),
            "anthropic" => Some(Self::Anthropic),
            "gemini" => Some(Self::Gemini),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OfficialModelProtocol {
    ChatCompletions,
    Responses,
    Messages,
    GenerateContent,
    ImageGeneration,
    ImageEdit,
    VideoGeneration,
    SpeechSynthesis,
    MusicGeneration,
}

impl OfficialModelProtocol {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::ChatCompletions => "chat_completions",
            Self::Responses => "responses",
            Self::Messages => "messages",
            Self::GenerateContent => "generate_content",
            Self::ImageGeneration => "image_generation",
            Self::ImageEdit => "image_edit",
            Self::VideoGeneration => "video_generation",
            Self::SpeechSynthesis => "speech_synthesis",
            Self::MusicGeneration => "music_generation",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "chat_completions" => Some(Self::ChatCompletions),
            "responses" => Some(Self::Responses),
            "messages" => Some(Self::Messages),
            "generate_content" => Some(Self::GenerateContent),
            "image_generation" => Some(Self::ImageGeneration),
            "image_edit" => Some(Self::ImageEdit),
            "video_generation" => Some(Self::VideoGeneration),
            "speech_synthesis" => Some(Self::SpeechSynthesis),
            "music_generation" => Some(Self::MusicGeneration),
            _ => None,
        }
    }

    pub const fn is_media_service(self) -> bool {
        matches!(
            self,
            Self::ImageGeneration
                | Self::ImageEdit
                | Self::VideoGeneration
                | Self::SpeechSynthesis
                | Self::MusicGeneration
        )
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpsertUpstreamProviderRequest {
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_preset_id: Option<String>,
    pub slug: String,
    pub display_name: String,
    pub provider_kind: UpstreamProviderKind,
    pub base_url: String,
    pub api_key: Option<String>,
    #[serde(default)]
    pub available_models: Option<Vec<UpstreamAvailableModel>>,
    #[serde(default)]
    pub last_test_latency_ms: Option<u64>,
    #[serde(default)]
    pub active: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoverUpstreamModelsRequest {
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_preset_id: Option<String>,
    pub provider_kind: UpstreamProviderKind,
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpstreamAvailableModel {
    pub upstream_model_id: String,
    pub display_name: String,
    #[serde(default = "default_available_model_protocol")]
    pub protocol: OfficialModelProtocol,
    #[serde(default = "default_text_modalities")]
    pub input_modalities: Vec<String>,
    #[serde(default = "default_text_modalities")]
    pub output_modalities: Vec<String>,
    #[serde(default)]
    pub asynchronous: bool,
}

const fn default_available_model_protocol() -> OfficialModelProtocol {
    OfficialModelProtocol::ChatCompletions
}

fn default_text_modalities() -> Vec<String> {
    vec!["text".to_owned()]
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamModelDiscovery {
    pub models: Vec<UpstreamAvailableModel>,
    pub fetched_at: DateTime<Utc>,
    pub latency_ms: u64,
    pub source: UpstreamModelDiscoverySource,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpstreamModelDiscoverySource {
    Upstream,
    ProviderPreset,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestOfficialModelRequest {
    #[serde(default)]
    pub model_id: Option<String>,
    pub upstream_provider_id: String,
    pub upstream_model_id: String,
    pub protocol: OfficialModelProtocol,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialModelTestResult {
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamProviderSummary {
    pub provider_id: String,
    pub provider_preset_id: String,
    pub slug: String,
    pub display_name: String,
    pub provider_kind: UpstreamProviderKind,
    pub base_url: String,
    pub credential_configured: bool,
    pub available_models: Vec<UpstreamAvailableModel>,
    pub models_refreshed_at: Option<DateTime<Utc>>,
    pub last_test_latency_ms: Option<u64>,
    pub active: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelPricingInput {
    pub input_credit_micros_per_million: u64,
    pub output_credit_micros_per_million: u64,
    #[serde(default)]
    pub cache_read_credit_micros_per_million: u64,
    #[serde(default)]
    pub cache_write_credit_micros_per_million: u64,
    #[serde(default)]
    pub fixed_credit_micros_per_request: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishOfficialModelRequest {
    pub model_id: Option<String>,
    pub public_model_id: String,
    pub display_name: String,
    pub upstream_provider_id: String,
    pub upstream_model_id: String,
    pub protocol: OfficialModelProtocol,
    #[serde(default = "empty_object")]
    pub capability: Value,
    pub pricing: ModelPricingInput,
    #[serde(default)]
    pub active: bool,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    pub pricing_id: String,
    pub version: u32,
    pub input_credit_micros_per_million: u64,
    pub output_credit_micros_per_million: u64,
    pub cache_read_credit_micros_per_million: u64,
    pub cache_write_credit_micros_per_million: u64,
    pub fixed_credit_micros_per_request: u64,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialModelSummary {
    pub model_id: String,
    pub public_model_id: String,
    pub display_name: String,
    pub protocol: OfficialModelProtocol,
    pub capability: Value,
    pub pricing: ModelPricing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicOfficialModelSummary {
    pub model_id: String,
    pub public_model_id: String,
    pub display_name: String,
    pub provider_display_name: String,
    pub provider_kind: UpstreamProviderKind,
    pub protocol: OfficialModelProtocol,
    pub capability: Value,
    pub pricing: ModelPricing,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicOfficialModelCatalog {
    pub revision: u64,
    pub models: Vec<PublicOfficialModelSummary>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOfficialModelSummary {
    pub model_id: String,
    pub public_model_id: String,
    pub display_name: String,
    pub upstream_provider_id: String,
    pub upstream_model_id: String,
    pub protocol: OfficialModelProtocol,
    pub capability: Value,
    pub pricing: ModelPricing,
    pub last_test_latency_ms: Option<u64>,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialModelCatalog {
    pub revision: u64,
    pub connection_id: String,
    pub provider_id: String,
    pub display_name: String,
    pub base_url: String,
    pub models: Vec<OfficialModelSummary>,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminModelCatalog {
    pub revision: u64,
    pub providers: Vec<UpstreamProviderSummary>,
    pub models: Vec<AdminOfficialModelSummary>,
    pub generated_at: DateTime<Utc>,
}

fn empty_object() -> Value {
    Value::Object(serde_json::Map::default())
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionStatus {
    Active,
    Expired,
}

impl SubscriptionStatus {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "expired" => Some(Self::Expired),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreditGrantSource {
    Subscription,
    TopUp,
    Refund,
    Admin,
}

impl CreditGrantSource {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Subscription => "subscription",
            Self::TopUp => "top_up",
            Self::Refund => "refund",
            Self::Admin => "admin",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreditReservationStatus {
    Reserved,
    Settled,
    Released,
}

impl CreditReservationStatus {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Settled => "settled",
            Self::Released => "released",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "reserved" => Some(Self::Reserved),
            "settled" => Some(Self::Settled),
            "released" => Some(Self::Released),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletSummary {
    pub user_id: String,
    pub available_credit_micros: u64,
    pub reserved_credit_micros: u64,
    pub expiring_credit_micros: u64,
    pub permanent_credit_micros: u64,
    pub generated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditReservation {
    pub reservation_id: String,
    pub request_id: String,
    pub user_id: String,
    pub status: CreditReservationStatus,
    pub requested_credit_micros: u64,
    pub settled_credit_micros: u64,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionSnapshot {
    pub user_id: String,
    pub plan_id: String,
    pub plan_version_id: String,
    pub status: SubscriptionStatus,
    pub current_period_id: String,
    pub current_period_start: DateTime<Utc>,
    pub current_period_end: DateTime<Utc>,
    pub billing_timezone: String,
    pub billing_anchor_day: u32,
    pub scheduled_plan_id: Option<String>,
}

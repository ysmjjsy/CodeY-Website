#![forbid(unsafe_code)]

mod archive;
mod auth;
pub mod cloud;
mod contracts;
mod db;
mod package_format;
mod store;
#[cfg(test)]
mod tests;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use crate::contracts::{
    MarketplaceCatalogResponse, MarketplaceDiscovery, MarketplaceListingDetail,
    MarketplaceListingKind, MarketplaceReleaseDetail, MarketplaceReleaseSummary,
    MarketplaceUploadPreview, PublishMarketplaceUploadRequest, MARKETPLACE_SCHEMA_VERSION,
    MAX_PACKAGE_BYTES,
};
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, AUTHORIZATION, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE,
    ETAG, ORIGIN,
};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, options, post};
use axum::{Form, Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use archive::{inspect_archive, ArchiveInspectionError, InspectedArchive};
pub use auth::{MarketplaceAdminUser, MarketplaceUser, MarketplaceUserRole};
pub use store::{
    DownloadArtifact, MarketplaceStore, MarketplaceStoreError, MarketplaceSubmission,
    MarketplaceSubmissionStatus, StoredUpload,
};

use auth::{
    clear_oauth_state_cookie, clear_session_cookie, hash_password, oauth_state_cookie,
    oauth_state_token, pkce_challenge, random_token, session_cookie, session_token,
    set_session_cookie, token_hash, validate_display_name, validate_email, validate_password,
    validate_username, verify_password, GitHubIdentity, MarketplaceAuthError,
};
use cloud::{
    discover_upstream_models, AdminModelCatalog, CloudPaymentConfig, CloudSecretCipher, CloudStore,
    CloudStoreError, CreatePlanOrderRequest, CreateTopUpOrderRequest,
    DiscoverUpstreamModelsRequest, GatewayError, GatewayManager, OfficialModelCatalog,
    OfficialModelProtocol, OfficialModelTestResult, PaymentAvailability, PaymentCheckout,
    PaymentError, PaymentManager, PaymentOrder, PlanCatalog, PublicOfficialModelCatalog,
    PublishOfficialModelRequest, PublishPlanRequest, PublishTopUpProductRequest,
    SchedulePlanChangeRequest, SubscriptionSnapshot, TestOfficialModelRequest, TopUpCatalog,
    UpsertUpstreamProviderRequest, UpstreamDiscoveryError, UpstreamModelDiscovery, WalletSummary,
};
use cloud::{normalize_provider_preset_id, provider_credential_required, provider_preset};

const PACKAGE_FIELD: &str = "archive";
const UPLOAD_TTL_MINUTES: i64 = 30;
const SESSION_TTL_DAYS: i64 = 30;
const OAUTH_STATE_TTL_MINUTES: i64 = 10;
const DEFAULT_ADMIN_USERNAME: &str = "admin";
const DEFAULT_ADMIN_PASSWORD: &str = "a773949603";

#[derive(Debug, Clone)]
pub struct MarketplaceServerConfig {
    pub data_root: PathBuf,
    pub database_url: String,
    pub web_base_url: String,
    pub api_base_url: String,
    pub cloud_api_base_url: String,
    pub cloud_default_timezone: String,
    pub cors_origin: String,
    pub max_package_bytes: usize,
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub admin_github_logins: BTreeSet<String>,
    pub admin_username: String,
    pub admin_password: String,
    pub payments: CloudPaymentConfig,
    pub cloud_secret_cipher: Option<CloudSecretCipher>,
}

impl MarketplaceServerConfig {
    pub fn from_environment() -> Result<Self, MarketplaceServerError> {
        let data_root = std::env::var_os("CODEY_MARKET_DATA_ROOT")
            .map_or_else(|| PathBuf::from(".codey-market"), PathBuf::from);
        let database_url = std::env::var("CODEY_DATABASE_URL").map_err(|_| {
            MarketplaceServerError::InvalidConfiguration(
                "CODEY_DATABASE_URL must contain a PostgreSQL connection URL".into(),
            )
        })?;
        if !database_url.starts_with("postgres://") && !database_url.starts_with("postgresql://") {
            return Err(MarketplaceServerError::InvalidConfiguration(
                "CODEY_DATABASE_URL must use postgres:// or postgresql://".into(),
            ));
        }
        let web_base_url = std::env::var("CODEY_MARKET_WEB_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:4321/market".into());
        let api_base_url = std::env::var("CODEY_MARKET_API_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8787/api/market/v1".into());
        let cloud_api_base_url = std::env::var("CODEY_CLOUD_API_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8787/api/cloud/v1".into());
        let cloud_default_timezone =
            std::env::var("CODEY_CLOUD_DEFAULT_TIMEZONE").unwrap_or_else(|_| "UTC".into());
        cloud_default_timezone
            .parse::<chrono_tz::Tz>()
            .map_err(|_| {
                MarketplaceServerError::InvalidConfiguration(
                    "CODEY_CLOUD_DEFAULT_TIMEZONE must be an IANA timezone".into(),
                )
            })?;
        let cors_origin = std::env::var("CODEY_MARKET_CORS_ORIGIN")
            .unwrap_or_else(|_| "http://127.0.0.1:4321".into());
        let github_client_id = environment_value("CODEY_MARKET_GITHUB_CLIENT_ID");
        let github_client_secret = environment_value("CODEY_MARKET_GITHUB_CLIENT_SECRET");
        if github_client_id.is_some() != github_client_secret.is_some() {
            return Err(MarketplaceServerError::InvalidConfiguration(
                "GitHub client ID and secret must be configured together".into(),
            ));
        }
        let admin_github_logins = std::env::var("CODEY_MARKET_ADMIN_GITHUB_LOGINS")
            .unwrap_or_default()
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_ascii_lowercase)
            .collect();
        let admin_username = validate_username(
            &std::env::var("CODEY_MARKET_ADMIN_USERNAME")
                .unwrap_or_else(|_| DEFAULT_ADMIN_USERNAME.into()),
        )
        .map_err(|_| {
            MarketplaceServerError::InvalidConfiguration(
                "CODEY_MARKET_ADMIN_USERNAME must contain 3-32 ASCII letters, digits, hyphens, or underscores"
                    .into(),
            )
        })?;
        let admin_password = std::env::var("CODEY_MARKET_ADMIN_PASSWORD")
            .unwrap_or_else(|_| DEFAULT_ADMIN_PASSWORD.into());
        validate_password(&admin_password).map_err(|_| {
            MarketplaceServerError::InvalidConfiguration(
                "CODEY_MARKET_ADMIN_PASSWORD must contain 10-128 bytes".into(),
            )
        })?;
        let web_base_url = trim_url(&web_base_url)?;
        let api_base_url = trim_url(&api_base_url)?;
        let cloud_api_base_url = trim_url(&cloud_api_base_url)?;
        let cors_origin = trim_url(&cors_origin)?;
        let payments = CloudPaymentConfig::from_environment(&cloud_api_base_url, &cors_origin)
            .map_err(|error| MarketplaceServerError::InvalidConfiguration(error.to_string()))?;
        let cloud_secret_cipher = CloudSecretCipher::from_environment()
            .map_err(|error| MarketplaceServerError::InvalidConfiguration(error.to_string()))?;
        let config = Self {
            data_root,
            database_url,
            web_base_url,
            api_base_url,
            cloud_api_base_url,
            cloud_default_timezone,
            cors_origin,
            max_package_bytes: MAX_PACKAGE_BYTES,
            github_client_id,
            github_client_secret,
            admin_github_logins,
            admin_username,
            admin_password,
            payments,
            cloud_secret_cipher,
        };
        if config.cors_origin.is_empty() {
            return Err(MarketplaceServerError::InvalidConfiguration(
                "CORS origin cannot be empty".into(),
            ));
        }
        Ok(config)
    }
}

#[derive(Debug, Clone)]
struct AppState {
    store: MarketplaceStore,
    cloud: CloudStore,
    config: MarketplaceServerConfig,
    http: reqwest::Client,
    payments: PaymentManager,
    gateway: GatewayManager,
}

pub fn build_router(config: MarketplaceServerConfig) -> Result<Router, MarketplaceServerError> {
    if config.max_package_bytes == 0 || config.max_package_bytes > MAX_PACKAGE_BYTES {
        return Err(MarketplaceServerError::InvalidConfiguration(format!(
            "max package bytes must be between 1 and {MAX_PACKAGE_BYTES}"
        )));
    }
    let store = MarketplaceStore::open(&config.data_root, &config.database_url)?;
    let admin_password_hash =
        hash_password(&config.admin_password).map_err(MarketplaceStoreError::from)?;
    store.upsert_local_admin(&config.admin_username, &admin_password_hash)?;
    let cloud = CloudStore::open(&config.data_root, &config.database_url)?;
    for path in store.expired_upload_paths()? {
        let _ = std::fs::remove_file(path);
    }
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| MarketplaceServerError::InvalidConfiguration(error.to_string()))?;
    let payments = PaymentManager::new(config.payments.clone(), http.clone());
    let gateway = GatewayManager::new(config.cloud_secret_cipher.clone(), http.clone());
    let state = Arc::new(AppState {
        store,
        cloud,
        config,
        http,
        payments,
        gateway,
    });
    let max_body = state.config.max_package_bytes.saturating_add(512 * 1024);
    Ok(Router::new()
        .route("/.well-known/codey-market.json", get(discovery))
        .route("/.well-known/codey-cloud.json", get(cloud_discovery))
        .route("/api/cloud/v1/me", get(cloud_me))
        .route("/api/cloud/v1/plans", get(cloud_plans))
        .route("/api/cloud/v1/top-ups", get(cloud_top_ups))
        .route("/api/cloud/v1/public-models", get(cloud_public_models))
        .route("/api/cloud/v1/models", get(cloud_official_models))
        .route(
            "/api/cloud/v1/gateway/v1/chat/completions",
            post(official_chat_completions),
        )
        .route(
            "/api/cloud/v1/gateway/v1/responses",
            post(official_responses),
        )
        .route(
            "/api/cloud/v1/gateway/v1/images/generations",
            post(official_image_generation),
        )
        .route(
            "/api/cloud/v1/gateway/v1/images/edits",
            post(official_image_edit),
        )
        .route(
            "/api/cloud/v1/gateway/v1/videos/generations",
            post(official_video_generation),
        )
        .route(
            "/api/cloud/v1/gateway/v1/videos/generations/{task_id}",
            get(official_video_generation_status),
        )
        .route(
            "/api/cloud/v1/gateway/v1/audio/speech",
            post(official_speech_synthesis),
        )
        .route(
            "/api/cloud/v1/gateway/v1/audio/music",
            post(official_music_generation),
        )
        .route("/api/cloud/v1/gateway/v1/messages", post(official_messages))
        .route(
            "/api/cloud/v1/gateway/v1beta/models/{*model_action}",
            post(official_generate_content),
        )
        .route(
            "/api/cloud/v1/payments/availability",
            get(cloud_payment_availability),
        )
        .route("/api/cloud/v1/orders/plans", post(cloud_create_plan_order))
        .route(
            "/api/cloud/v1/orders/top-ups",
            post(cloud_create_top_up_order),
        )
        .route("/api/cloud/v1/orders/{order_id}", get(cloud_payment_order))
        .route(
            "/api/cloud/v1/payments/webhooks/stripe",
            post(stripe_payment_webhook),
        )
        .route(
            "/api/cloud/v1/payments/webhooks/wechat-pay",
            post(wechat_payment_webhook),
        )
        .route(
            "/api/cloud/v1/payments/webhooks/alipay",
            post(alipay_payment_webhook),
        )
        .route(
            "/api/cloud/v1/payments/test/{order_id}/complete",
            post(complete_test_payment),
        )
        .route(
            "/api/cloud/v1/subscription/scheduled-plan",
            post(cloud_schedule_plan_change),
        )
        .route("/api/cloud/v1/admin/plans", post(cloud_publish_plan))
        .route(
            "/api/cloud/v1/admin/model-catalog",
            get(cloud_admin_model_catalog),
        )
        .route(
            "/api/cloud/v1/admin/model-providers",
            post(cloud_upsert_model_provider),
        )
        .route(
            "/api/cloud/v1/admin/model-providers/discover",
            post(cloud_discover_model_provider),
        )
        .route(
            "/api/cloud/v1/admin/models",
            post(cloud_publish_official_model),
        )
        .route(
            "/api/cloud/v1/admin/models/test",
            post(cloud_test_official_model),
        )
        .route("/api/cloud/v1/admin/top-ups", post(cloud_publish_top_up))
        .route("/api/cloud/v1/oauth/authorize", get(oauth_authorize))
        .route("/api/cloud/v1/oauth/token", post(oauth_token))
        .route("/api/cloud/v1/oauth/revoke", post(oauth_revoke))
        .route("/api/cloud/v1/devices", get(cloud_devices))
        .route(
            "/api/cloud/v1/devices/{device_id}/revoke",
            post(cloud_revoke_device),
        )
        .route("/api/market/v1/listings", get(listings))
        .route("/api/market/v1/listings/{listing_id}", get(listing))
        .route(
            "/api/market/v1/listings/{listing_id}/releases",
            get(listing_releases),
        )
        .route("/api/market/v1/releases/{release_id}", get(release))
        .route(
            "/api/market/v1/releases/{release_id}/artifact",
            get(download_release),
        )
        .route("/api/market/v1/auth/register", post(register))
        .route("/api/market/v1/auth/login", post(login))
        .route("/api/market/v1/auth/logout", post(logout))
        .route("/api/market/v1/auth/me", get(auth_me))
        .route("/api/market/v1/auth/github", get(github_start))
        .route("/api/market/v1/auth/github/callback", get(github_callback))
        .route("/api/market/v1/account/profile", post(update_profile))
        .route("/api/market/v1/uploads", post(upload))
        .route("/api/market/v1/uploads/{upload_id}/publish", post(publish))
        .route("/api/market/v1/submissions/mine", get(my_submissions))
        .route("/api/market/v1/admin/submissions", get(admin_submissions))
        .route("/api/market/v1/admin/reviews", get(admin_reviews))
        .route("/api/market/v1/admin/users", get(admin_users))
        .route(
            "/api/market/v1/admin/users/{user_id}/role",
            post(update_admin_user_role),
        )
        .route(
            "/api/market/v1/admin/users/{user_id}/active",
            post(update_admin_user_active),
        )
        .route(
            "/api/market/v1/admin/submissions/{submission_id}/approve",
            post(approve_submission),
        )
        .route(
            "/api/market/v1/admin/submissions/{submission_id}/reject",
            post(reject_submission),
        )
        .route("/api/market/v1/{*path}", options(preflight))
        .route("/api/cloud/v1/{*path}", options(preflight))
        .layer(DefaultBodyLimit::max(max_body))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            cors_headers,
        ))
        .with_state(state))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudDiscovery {
    schema_version: u16,
    api_base_url: String,
    web_base_url: String,
}

async fn cloud_discovery(State(state): State<Arc<AppState>>) -> Json<CloudDiscovery> {
    Json(CloudDiscovery {
        schema_version: 1,
        api_base_url: state.config.cloud_api_base_url.clone(),
        web_base_url: state.config.cors_origin.clone(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudMeResponse {
    user: MarketplaceUser,
    subscription: SubscriptionSnapshot,
    wallet: WalletSummary,
}

async fn cloud_me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<CloudMeResponse>> {
    let user = require_cloud_user(&state, &headers, "profile:read")?;
    let now = Utc::now();
    state.cloud.ensure_default_subscription(
        &user.user_id,
        &state.config.cloud_default_timezone,
        now,
    )?;
    let subscription = state
        .cloud
        .reconcile_subscription(&user.user_id, now)?
        .ok_or(CloudStoreError::SubscriptionIntegrity)?;
    let wallet = state.cloud.wallet_summary(&user.user_id, now)?;
    Ok(Json(CloudMeResponse {
        user,
        subscription,
        wallet,
    }))
}

async fn cloud_plans(State(state): State<Arc<AppState>>) -> ApiResult<Json<PlanCatalog>> {
    Ok(Json(state.cloud.plan_catalog(Utc::now())?))
}

async fn cloud_top_ups(State(state): State<Arc<AppState>>) -> ApiResult<Json<TopUpCatalog>> {
    Ok(Json(state.cloud.top_up_catalog(Utc::now())?))
}

async fn cloud_public_models(
    State(state): State<Arc<AppState>>,
) -> ApiResult<Json<PublicOfficialModelCatalog>> {
    Ok(Json(state.cloud.public_model_catalog(Utc::now())?))
}

async fn cloud_official_models(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<OfficialModelCatalog>> {
    let user = require_cloud_user(&state, &headers, "model:list")?;
    let now = Utc::now();
    state.cloud.ensure_default_subscription(
        &user.user_id,
        &state.config.cloud_default_timezone,
        now,
    )?;
    state.cloud.reconcile_subscription(&user.user_id, now)?;
    Ok(Json(state.cloud.official_model_catalog(
        &user.user_id,
        &format!("{}/gateway", state.config.cloud_api_base_url),
        now,
    )?))
}

async fn official_chat_completions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::ChatCompletions,
        None,
        None,
    )
    .await
}

async fn official_responses(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::Responses,
        None,
        None,
    )
    .await
}

async fn official_image_generation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::ImageGeneration,
        None,
        Some(false),
    )
    .await
}

async fn official_image_edit(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::ImageEdit,
        None,
        Some(false),
    )
    .await
}

async fn official_video_generation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::VideoGeneration,
        None,
        Some(false),
    )
    .await
}

async fn official_video_generation_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(task_id): Path<String>,
) -> ApiResult<Response> {
    let user = require_gateway_user(&state, &headers)?;
    Ok(state
        .gateway
        .query_video_task(&state.cloud, &user.user_id, &task_id, Utc::now())
        .await?)
}

async fn official_speech_synthesis(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::SpeechSynthesis,
        None,
        Some(false),
    )
    .await
}

async fn official_music_generation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::MusicGeneration,
        None,
        Some(false),
    )
    .await
}

async fn official_messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::Messages,
        None,
        None,
    )
    .await
}

async fn official_generate_content(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(model_action): Path<String>,
    body: Bytes,
) -> ApiResult<Response> {
    let (model, stream) = if let Some(model) = model_action.strip_suffix(":streamGenerateContent") {
        (model, true)
    } else if let Some(model) = model_action.strip_suffix(":generateContent") {
        (model, false)
    } else {
        return Err(ApiError::not_found(
            "gateway_operation_not_found",
            "Gateway operation was not found",
        ));
    };
    official_gateway_request(
        &state,
        &headers,
        body,
        OfficialModelProtocol::GenerateContent,
        Some(model),
        Some(stream),
    )
    .await
}

async fn official_gateway_request(
    state: &AppState,
    headers: &HeaderMap,
    body: Bytes,
    protocol: OfficialModelProtocol,
    model_from_path: Option<&str>,
    stream_override: Option<bool>,
) -> ApiResult<Response> {
    let user = require_gateway_user(state, headers)?;
    let request_id = headers
        .get("x-codey-request-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::bad_request("gateway_request_id", "X-CodeY-Request-Id is required")
        })?;
    state
        .cloud
        .reconcile_subscription(&user.user_id, Utc::now())?;
    Ok(state
        .gateway
        .invoke(
            &state.cloud,
            &user.user_id,
            request_id,
            protocol,
            model_from_path,
            stream_override,
            headers,
            body,
            Utc::now(),
        )
        .await?)
}

async fn cloud_payment_availability(
    State(state): State<Arc<AppState>>,
) -> Json<PaymentAvailability> {
    Json(state.payments.availability())
}

async fn cloud_publish_plan(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PublishPlanRequest>,
) -> ApiResult<Json<PlanCatalog>> {
    require_same_origin(&state, &headers)?;
    require_admin(&state, &headers)?;
    Ok(Json(state.cloud.publish_plan(&request, Utc::now())?))
}

async fn cloud_publish_top_up(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PublishTopUpProductRequest>,
) -> ApiResult<Json<TopUpCatalog>> {
    require_same_origin(&state, &headers)?;
    require_admin(&state, &headers)?;
    Ok(Json(
        state.cloud.publish_top_up_product(&request, Utc::now())?,
    ))
}

async fn cloud_admin_model_catalog(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<AdminModelCatalog>> {
    require_admin(&state, &headers)?;
    Ok(Json(state.cloud.admin_model_catalog(Utc::now())?))
}

async fn cloud_upsert_model_provider(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UpsertUpstreamProviderRequest>,
) -> ApiResult<Json<AdminModelCatalog>> {
    require_same_origin(&state, &headers)?;
    require_admin(&state, &headers)?;
    let provider_preset_id = normalize_provider_preset_id(request.provider_preset_id.as_deref())
        .ok_or_else(|| {
            ApiError::bad_request("cloud_invalid_request", "provider preset is invalid")
        })?;
    let stores_credential = request
        .api_key
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    if (provider_credential_required(provider_preset_id) || stores_credential)
        && state.config.cloud_secret_cipher.is_none()
    {
        return Err(ApiError::service_unavailable(
            "cloud_secret_key_required",
            "CODEY_CLOUD_SECRET_KEY is required before model credentials can be stored",
        ));
    }
    Ok(Json(state.cloud.upsert_upstream_provider(
        &request,
        state.config.cloud_secret_cipher.as_ref(),
        Utc::now(),
    )?))
}

async fn cloud_discover_model_provider(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<DiscoverUpstreamModelsRequest>,
) -> ApiResult<Json<UpstreamModelDiscovery>> {
    require_same_origin(&state, &headers)?;
    require_admin(&state, &headers)?;
    validate_upstream_discovery_url(&request.base_url)?;
    let provider_preset_id = normalize_provider_preset_id(request.provider_preset_id.as_deref())
        .ok_or_else(|| {
            ApiError::bad_request("cloud_invalid_request", "provider preset is invalid")
        })?;
    if provider_preset(provider_preset_id)
        .is_some_and(|preset| preset.provider_kind != request.provider_kind)
    {
        return Err(ApiError::bad_request(
            "cloud_invalid_request",
            "provider preset does not match its protocol",
        ));
    }
    let api_key = if provider_credential_required(provider_preset_id) {
        if let Some(api_key) = request
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            api_key.to_owned()
        } else {
            let cipher = state.config.cloud_secret_cipher.as_ref().ok_or_else(|| {
                ApiError::service_unavailable(
                    "cloud_secret_key_required",
                    "CODEY_CLOUD_SECRET_KEY is required before model credentials can be tested",
                )
            })?;
            let provider_id = request
                .provider_id
                .as_deref()
                .ok_or(CloudStoreError::UpstreamCredentialRequired)?;
            let stored = state
                .cloud
                .upstream_provider_api_key_ciphertext(provider_id)?
                .ok_or(CloudStoreError::UpstreamCredentialRequired)?;
            cipher.decrypt(&stored)?
        }
    } else {
        String::new()
    };
    let started = Instant::now();
    let (models, source) = discover_upstream_models(
        &state.http,
        provider_preset_id,
        request.provider_kind,
        &request.base_url,
        &api_key,
    )
    .await?;
    let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(Json(UpstreamModelDiscovery {
        models,
        fetched_at: Utc::now(),
        latency_ms,
        source,
    }))
}

fn validate_upstream_discovery_url(base_url: &str) -> ApiResult<()> {
    let url = url::Url::parse(base_url)
        .map_err(|_| ApiError::bad_request("cloud_invalid_request", "provider URL is invalid"))?;
    let loopback = url
        .host_str()
        .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1"));
    if (!loopback && url.scheme() != "https") || url.host_str().is_none() {
        return Err(ApiError::bad_request(
            "cloud_invalid_request",
            "provider URL must use HTTPS unless it targets localhost",
        ));
    }
    Ok(())
}

async fn cloud_publish_official_model(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<PublishOfficialModelRequest>,
) -> ApiResult<Json<AdminModelCatalog>> {
    require_same_origin(&state, &headers)?;
    require_admin(&state, &headers)?;
    Ok(Json(
        state.cloud.publish_official_model(&request, Utc::now())?,
    ))
}

async fn cloud_test_official_model(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<TestOfficialModelRequest>,
) -> ApiResult<Json<OfficialModelTestResult>> {
    require_same_origin(&state, &headers)?;
    require_admin(&state, &headers)?;
    Ok(Json(
        state
            .gateway
            .test_model(&state.cloud, &request, Utc::now())
            .await?,
    ))
}

async fn cloud_create_plan_order(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreatePlanOrderRequest>,
) -> ApiResult<(StatusCode, Json<PaymentCheckout>)> {
    require_same_origin(&state, &headers)?;
    let user = require_user(&state, &headers)?;
    let now = Utc::now();
    state.cloud.ensure_default_subscription(
        &user.user_id,
        &state.config.cloud_default_timezone,
        now,
    )?;
    let order = state
        .cloud
        .create_plan_order(&user.user_id, &request, now)?;
    Ok((
        StatusCode::CREATED,
        Json(state.payments.create_checkout(&state.cloud, order).await?),
    ))
}

async fn cloud_create_top_up_order(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<CreateTopUpOrderRequest>,
) -> ApiResult<(StatusCode, Json<PaymentCheckout>)> {
    require_same_origin(&state, &headers)?;
    let user = require_user(&state, &headers)?;
    let now = Utc::now();
    state.cloud.ensure_default_subscription(
        &user.user_id,
        &state.config.cloud_default_timezone,
        now,
    )?;
    let order = state
        .cloud
        .create_top_up_order(&user.user_id, &request, now)?;
    Ok((
        StatusCode::CREATED,
        Json(state.payments.create_checkout(&state.cloud, order).await?),
    ))
}

async fn cloud_payment_order(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(order_id): Path<String>,
) -> ApiResult<Json<PaymentOrder>> {
    let user = require_user(&state, &headers)?;
    state
        .cloud
        .payment_order(&user.user_id, &order_id)?
        .map(Json)
        .ok_or_else(|| {
            ApiError::not_found("payment_order_not_found", "Payment order was not found")
        })
}

async fn cloud_schedule_plan_change(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<SchedulePlanChangeRequest>,
) -> ApiResult<Json<SubscriptionSnapshot>> {
    require_same_origin(&state, &headers)?;
    let user = require_user(&state, &headers)?;
    Ok(Json(state.cloud.schedule_plan_change(
        &user.user_id,
        &request,
        Utc::now(),
    )?))
}

async fn stripe_payment_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<StatusCode> {
    let signature = headers
        .get("Stripe-Signature")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::unauthorized("payment_signature", "Payment signature is missing")
        })?;
    match state
        .payments
        .process_stripe_webhook(&state.cloud, signature, &body, Utc::now())
    {
        Ok(_) | Err(PaymentError::IgnoredEvent) => Ok(StatusCode::NO_CONTENT),
        Err(error) => Err(error.into()),
    }
}

async fn wechat_payment_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<serde_json::Value>> {
    match state
        .payments
        .process_wechat_webhook(&state.cloud, &headers, &body, Utc::now())
    {
        Ok(_) | Err(PaymentError::IgnoredEvent) => Ok(Json(
            serde_json::json!({"code": "SUCCESS", "message": "成功"}),
        )),
        Err(error) => Err(error.into()),
    }
}

async fn alipay_payment_webhook(
    State(state): State<Arc<AppState>>,
    Form(fields): Form<std::collections::BTreeMap<String, String>>,
) -> ApiResult<&'static str> {
    match state
        .payments
        .process_alipay_webhook(&state.cloud, &fields, Utc::now())
    {
        Ok(_) | Err(PaymentError::IgnoredEvent) => Ok("success"),
        Err(error) => Err(error.into()),
    }
}

async fn complete_test_payment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(order_id): Path<String>,
) -> ApiResult<Json<PaymentOrder>> {
    require_same_origin(&state, &headers)?;
    let user = require_user(&state, &headers)?;
    Ok(Json(state.payments.complete_test_payment(
        &state.cloud,
        &user.user_id,
        &order_id,
        Utc::now(),
    )?))
}

const DESKTOP_OAUTH_CLIENT_ID: &str = "codey-desktop";
const DESKTOP_OAUTH_DEFAULT_SCOPE: &str =
    "entitlement:read model:invoke model:list profile:read wallet:read";
const DESKTOP_OAUTH_ALLOWED_SCOPES: &[&str] = &[
    "entitlement:read",
    "model:invoke",
    "model:list",
    "profile:read",
    "wallet:read",
];

#[derive(Debug, Deserialize)]
struct OAuthAuthorizeQuery {
    response_type: String,
    client_id: String,
    redirect_uri: String,
    code_challenge: String,
    code_challenge_method: String,
    state: String,
    scope: Option<String>,
}

async fn oauth_authorize(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OAuthAuthorizeQuery>,
) -> ApiResult<Response> {
    validate_oauth_authorization_request(&query)?;
    let scope = normalize_oauth_scope(query.scope.as_deref())?;
    let Some(user) = current_user(&state, &headers)? else {
        let authorize_url = oauth_authorize_url(&state, &query, &scope)?;
        let mut login_url = url::Url::parse(&state.config.web_base_url)
            .map_err(|error| ApiError::internal("oauth_login_url", error.to_string()))?;
        login_url
            .query_pairs_mut()
            .append_pair("auth", "desktop")
            .append_pair("continue", &authorize_url);
        return Ok(Redirect::temporary(login_url.as_str()).into_response());
    };
    let code = state.cloud.create_oauth_authorization_code(
        &user.user_id,
        &query.client_id,
        &query.redirect_uri,
        &query.code_challenge,
        &scope,
        Utc::now(),
    )?;
    let mut redirect = url::Url::parse(&query.redirect_uri)
        .map_err(|error| ApiError::bad_request("invalid_redirect_uri", error.to_string()))?;
    redirect
        .query_pairs_mut()
        .append_pair("code", &code)
        .append_pair("state", &query.state);
    Ok(Redirect::temporary(redirect.as_str()).into_response())
}

#[derive(Debug, Deserialize)]
struct OAuthTokenRequest {
    grant_type: String,
    client_id: String,
    code: Option<String>,
    code_verifier: Option<String>,
    redirect_uri: Option<String>,
    refresh_token: Option<String>,
    device_name: Option<String>,
}

async fn oauth_token(
    State(state): State<Arc<AppState>>,
    Form(request): Form<OAuthTokenRequest>,
) -> ApiResult<Json<cloud::OAuthTokenPair>> {
    if request.client_id != DESKTOP_OAUTH_CLIENT_ID {
        return Err(ApiError::unauthorized(
            "invalid_client",
            "OAuth client is not registered",
        ));
    }
    let tokens = match request.grant_type.as_str() {
        "authorization_code" => {
            let code = required_oauth_field(request.code, "code")?;
            let verifier = required_oauth_field(request.code_verifier, "code_verifier")?;
            let redirect_uri = required_oauth_field(request.redirect_uri, "redirect_uri")?;
            validate_desktop_redirect_uri(&redirect_uri)?;
            let device_name = request
                .device_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("CodeY Desktop");
            if device_name.chars().count() > 100 {
                return Err(ApiError::bad_request(
                    "invalid_device_name",
                    "Device name must not exceed 100 characters",
                ));
            }
            state.cloud.exchange_oauth_authorization_code(
                &code,
                &verifier,
                &request.client_id,
                &redirect_uri,
                device_name,
                Utc::now(),
            )?
        }
        "refresh_token" => state.cloud.refresh_oauth_tokens(
            &required_oauth_field(request.refresh_token, "refresh_token")?,
            &request.client_id,
            Utc::now(),
        )?,
        _ => {
            return Err(ApiError::bad_request(
                "unsupported_grant_type",
                "OAuth grant type is not supported",
            ));
        }
    };
    Ok(Json(tokens))
}

#[derive(Debug, Deserialize)]
struct OAuthRevokeRequest {
    client_id: String,
    token: String,
}

async fn oauth_revoke(
    State(state): State<Arc<AppState>>,
    Form(request): Form<OAuthRevokeRequest>,
) -> ApiResult<StatusCode> {
    if request.client_id == DESKTOP_OAUTH_CLIENT_ID {
        state
            .cloud
            .revoke_oauth_refresh_token(&request.token, &request.client_id, Utc::now())?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn cloud_devices(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<cloud::OAuthDeviceSession>>> {
    let user = require_cloud_user(&state, &headers, "profile:read")?;
    Ok(Json(state.cloud.oauth_device_sessions(&user.user_id)?))
}

async fn cloud_revoke_device(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
) -> ApiResult<StatusCode> {
    require_same_origin(&state, &headers)?;
    let user = require_user(&state, &headers)?;
    if !state
        .cloud
        .revoke_oauth_device(&user.user_id, &device_id, Utc::now())?
    {
        return Err(ApiError::not_found(
            "device_not_found",
            "Device session was not found",
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn validate_oauth_authorization_request(query: &OAuthAuthorizeQuery) -> ApiResult<()> {
    if query.response_type != "code" || query.client_id != DESKTOP_OAUTH_CLIENT_ID {
        return Err(ApiError::bad_request(
            "invalid_oauth_request",
            "OAuth response type or client is invalid",
        ));
    }
    validate_desktop_redirect_uri(&query.redirect_uri)?;
    if query.code_challenge_method != "S256"
        || query.code_challenge.len() != 43
        || !query
            .code_challenge
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || query.state.len() < 16
        || query.state.len() > 512
    {
        return Err(ApiError::bad_request(
            "invalid_oauth_request",
            "OAuth PKCE challenge or state is invalid",
        ));
    }
    Ok(())
}

fn validate_desktop_redirect_uri(value: &str) -> ApiResult<()> {
    let redirect = url::Url::parse(value)
        .map_err(|error| ApiError::bad_request("invalid_redirect_uri", error.to_string()))?;
    let custom_scheme = redirect.scheme() == "codey"
        && redirect.host_str() == Some("oauth")
        && redirect.path() == "/callback";
    let loopback = redirect.scheme() == "http"
        && matches!(redirect.host_str(), Some("127.0.0.1" | "localhost"))
        && redirect.port().is_some()
        && redirect.path() == "/oauth/callback";
    if !custom_scheme && !loopback || redirect.query().is_some() || redirect.fragment().is_some() {
        return Err(ApiError::bad_request(
            "invalid_redirect_uri",
            "Desktop redirect URI is not allowed",
        ));
    }
    Ok(())
}

fn validate_cloud_continue_url(state: &AppState, value: &str) -> ApiResult<String> {
    let continuation = url::Url::parse(value)
        .map_err(|error| ApiError::bad_request("invalid_continue_url", error.to_string()))?;
    let cloud = url::Url::parse(&state.config.cloud_api_base_url)
        .map_err(|error| ApiError::internal("cloud_api_url", error.to_string()))?;
    if continuation.origin() != cloud.origin()
        || continuation.path() != "/api/cloud/v1/oauth/authorize"
    {
        return Err(ApiError::bad_request(
            "invalid_continue_url",
            "OAuth continuation URL is not allowed",
        ));
    }
    Ok(continuation.to_string())
}

fn normalize_oauth_scope(value: Option<&str>) -> ApiResult<String> {
    let requested = value.unwrap_or(DESKTOP_OAUTH_DEFAULT_SCOPE);
    let mut scopes = requested
        .split_ascii_whitespace()
        .filter(|scope| !scope.is_empty())
        .collect::<Vec<_>>();
    scopes.sort_unstable();
    scopes.dedup();
    if scopes.is_empty()
        || scopes
            .iter()
            .any(|scope| !DESKTOP_OAUTH_ALLOWED_SCOPES.contains(scope))
    {
        return Err(ApiError::bad_request(
            "invalid_scope",
            "OAuth scope is not allowed",
        ));
    }
    Ok(scopes.join(" "))
}

fn oauth_authorize_url(
    state: &AppState,
    query: &OAuthAuthorizeQuery,
    scope: &str,
) -> ApiResult<String> {
    let mut url = url::Url::parse(&format!(
        "{}/oauth/authorize",
        state.config.cloud_api_base_url
    ))
    .map_err(|error| ApiError::internal("oauth_authorize_url", error.to_string()))?;
    url.query_pairs_mut()
        .append_pair("response_type", &query.response_type)
        .append_pair("client_id", &query.client_id)
        .append_pair("redirect_uri", &query.redirect_uri)
        .append_pair("code_challenge", &query.code_challenge)
        .append_pair("code_challenge_method", &query.code_challenge_method)
        .append_pair("state", &query.state)
        .append_pair("scope", scope);
    Ok(url.to_string())
}

fn required_oauth_field(value: Option<String>, name: &str) -> ApiResult<String> {
    value.filter(|value| !value.is_empty()).ok_or_else(|| {
        ApiError::bad_request("invalid_oauth_request", format!("{name} is required"))
    })
}

fn require_cloud_user(
    state: &AppState,
    headers: &HeaderMap,
    required_scope: &str,
) -> ApiResult<MarketplaceUser> {
    if let Some(user) = current_user(state, headers)? {
        return Ok(user);
    }
    let bearer = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::unauthorized("authentication_required", "Sign in to continue"))?;
    let user_id = state
        .cloud
        .oauth_access_token_user(bearer, required_scope, Utc::now())?
        .ok_or_else(|| ApiError::unauthorized("invalid_access_token", "Access token is invalid"))?;
    state
        .store
        .user_by_id(&user_id)?
        .and_then(|record| record.active.then_some(record.user))
        .ok_or_else(|| ApiError::unauthorized("invalid_access_token", "Access token is invalid"))
}

fn require_gateway_user(state: &AppState, headers: &HeaderMap) -> ApiResult<MarketplaceUser> {
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get("x-api-key")
                .and_then(|value| value.to_str().ok())
        })
        .or_else(|| {
            headers
                .get("x-goog-api-key")
                .and_then(|value| value.to_str().ok())
        })
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ApiError::unauthorized("authentication_required", "Cloud access token is required")
        })?;
    let user_id = state
        .cloud
        .oauth_access_token_user(token, "model:invoke", Utc::now())?
        .ok_or_else(|| {
            ApiError::unauthorized("invalid_access_token", "Cloud access token is invalid")
        })?;
    state
        .store
        .user_by_id(&user_id)?
        .and_then(|record| record.active.then_some(record.user))
        .ok_or_else(|| {
            ApiError::unauthorized("invalid_access_token", "Cloud access token is invalid")
        })
}

async fn discovery(State(state): State<Arc<AppState>>) -> Json<MarketplaceDiscovery> {
    Json(MarketplaceDiscovery {
        schema_version: MARKETPLACE_SCHEMA_VERSION,
        web_base_url: state.config.web_base_url.clone(),
        api_base_url: state.config.api_base_url.clone(),
        max_package_bytes: u64::try_from(state.config.max_package_bytes).unwrap_or(u64::MAX),
        upload_enabled: true,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegisterRequest {
    username: String,
    email: String,
    display_name: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LoginRequest {
    identifier: String,
    password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    user: Option<MarketplaceUser>,
    github_enabled: bool,
}

async fn register(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<RegisterRequest>,
) -> ApiResult<Response> {
    require_same_origin(&state, &headers)?;
    let username = validate_username(&request.username)?;
    let email = validate_email(&request.email)?;
    let display_name = validate_display_name(&request.display_name)?;
    validate_password(&request.password)?;
    let password_hash = hash_password(&request.password)?;
    let user = state.store.create_local_user(
        &username,
        &email,
        &display_name,
        &password_hash,
        MarketplaceUserRole::User,
    )?;
    authenticated_response(&state, user)
}

async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> ApiResult<Response> {
    require_same_origin(&state, &headers)?;
    let identifier = request.identifier.trim();
    if identifier.is_empty() || identifier.len() > 254 || request.password.len() > 128 {
        return Err(ApiError::unauthorized(
            "invalid_credentials",
            "Username, email, or password is incorrect",
        ));
    }
    let record = state.store.user_by_identifier(identifier)?;
    let valid = record.as_ref().is_some_and(|record| {
        record
            .password_hash
            .as_deref()
            .is_some_and(|hash| verify_password(&request.password, hash))
    });
    if !valid {
        return Err(ApiError::unauthorized(
            "invalid_credentials",
            "Username, email, or password is incorrect",
        ));
    }
    let record = record.expect("valid credentials require a stored user");
    if !record.active {
        return Err(account_disabled());
    }
    authenticated_response(&state, record.user)
}

async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult<Response> {
    require_same_origin(&state, &headers)?;
    if let Some(token) = session_token(&headers) {
        state.store.delete_session(&token_hash(&token))?;
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    set_session_cookie(
        response.headers_mut(),
        clear_session_cookie(session_cookie_secure(&state)),
    );
    Ok(response)
}

async fn auth_me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<AuthResponse>> {
    Ok(Json(AuthResponse {
        user: current_user(&state, &headers)?,
        github_enabled: github_enabled(&state),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateProfileRequest {
    display_name: String,
    #[serde(default)]
    email: Option<String>,
}

async fn update_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<UpdateProfileRequest>,
) -> ApiResult<Json<MarketplaceUser>> {
    require_same_origin(&state, &headers)?;
    let current = require_user(&state, &headers)?;
    let display_name = validate_display_name(&request.display_name)?;
    let email = request
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(validate_email)
        .transpose()?;
    state
        .store
        .update_user_profile(&current.user_id, &display_name, email.as_deref())?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("user_not_found", "User account was not found"))
}

#[derive(Debug, Deserialize)]
struct GitHubStartQuery {
    #[serde(rename = "continue")]
    return_url: Option<String>,
}

async fn github_start(
    State(state): State<Arc<AppState>>,
    Query(query): Query<GitHubStartQuery>,
) -> ApiResult<Response> {
    let client_id = state.config.github_client_id.as_deref().ok_or_else(|| {
        ApiError::service_unavailable("github_disabled", "GitHub login is not configured")
    })?;
    let oauth_state = random_token(32)?;
    let verifier = random_token(32)?;
    let return_url = query
        .return_url
        .as_deref()
        .map(|value| validate_cloud_continue_url(&state, value))
        .transpose()?;
    state.store.save_oauth_state(
        &token_hash(&oauth_state),
        &verifier,
        return_url.as_deref(),
        Utc::now() + Duration::minutes(OAUTH_STATE_TTL_MINUTES),
    )?;
    let mut url = url::Url::parse("https://github.com/login/oauth/authorize")
        .map_err(|error| ApiError::internal("github_url", error.to_string()))?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &github_callback_url(&state))
        .append_pair("scope", "read:user user:email")
        .append_pair("state", &oauth_state)
        .append_pair("code_challenge", &pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256");
    let mut response = Redirect::temporary(url.as_str()).into_response();
    set_session_cookie(
        response.headers_mut(),
        oauth_state_cookie(
            &oauth_state,
            Duration::minutes(OAUTH_STATE_TTL_MINUTES).num_seconds(),
            session_cookie_secure(&state),
        ),
    );
    Ok(response)
}

#[derive(Debug, Deserialize)]
struct GitHubCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn github_callback(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<GitHubCallbackQuery>,
) -> ApiResult<Response> {
    if let Some(error) = query.error {
        return Err(ApiError::bad_request("github_denied", error));
    }
    let code = query
        .code
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("github_code_required", "GitHub code is missing"))?;
    let oauth_state = query
        .state
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::bad_request("github_state_required", "OAuth state is missing"))?;
    if oauth_state_token(&headers).as_deref() != Some(oauth_state.as_str()) {
        return Err(ApiError::bad_request(
            "github_state_invalid",
            "OAuth state does not match this browser",
        ));
    }
    let stored_state = state
        .store
        .consume_oauth_state(&token_hash(&oauth_state))?
        .ok_or_else(|| ApiError::bad_request("github_state_invalid", "OAuth state is invalid"))?;
    let identity = fetch_github_identity(&state, &code, &stored_state.code_verifier).await?;
    let role = if state
        .config
        .admin_github_logins
        .contains(&identity.login.to_ascii_lowercase())
    {
        MarketplaceUserRole::Admin
    } else {
        MarketplaceUserRole::User
    };
    let user = state.store.upsert_github_user(&identity, role)?;
    if !state
        .store
        .user_by_id(&user.user_id)?
        .is_some_and(|record| record.active)
    {
        return Err(account_disabled());
    }
    state.cloud.ensure_default_subscription(
        &user.user_id,
        &state.config.cloud_default_timezone,
        Utc::now(),
    )?;
    let (token, expires_at) = create_session(&state, &user)?;
    let destination = stored_state
        .return_url
        .unwrap_or_else(|| format!("{}?auth=github", state.config.web_base_url));
    let mut response = Redirect::to(&destination).into_response();
    set_session_cookie(
        response.headers_mut(),
        session_cookie(
            &token,
            (expires_at - Utc::now()).num_seconds(),
            session_cookie_secure(&state),
        ),
    );
    set_session_cookie(
        response.headers_mut(),
        clear_oauth_state_cookie(session_cookie_secure(&state)),
    );
    Ok(response)
}

#[derive(Debug, Deserialize)]
struct GitHubTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUserResponse {
    id: u64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubEmailResponse {
    email: String,
    primary: bool,
    verified: bool,
}

async fn fetch_github_identity(
    state: &AppState,
    code: &str,
    code_verifier: &str,
) -> ApiResult<GitHubIdentity> {
    let client_id = state.config.github_client_id.as_deref().ok_or_else(|| {
        ApiError::service_unavailable("github_disabled", "GitHub login is not configured")
    })?;
    let client_secret = state
        .config
        .github_client_secret
        .as_deref()
        .ok_or_else(|| {
            ApiError::service_unavailable("github_disabled", "GitHub login is not configured")
        })?;
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", client_id)
        .append_pair("client_secret", client_secret)
        .append_pair("code", code)
        .append_pair("redirect_uri", &github_callback_url(state))
        .append_pair("code_verifier", code_verifier)
        .finish();
    let token_response = state
        .http
        .post("https://github.com/login/oauth/access_token")
        .header(reqwest::header::ACCEPT, "application/json")
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|error| github_transport_error(&error))?;
    if !token_response.status().is_success() {
        return Err(ApiError::bad_gateway(
            "github_token_exchange",
            "GitHub token exchange failed",
        ));
    }
    let token = token_response
        .json::<GitHubTokenResponse>()
        .await
        .map_err(|error| github_transport_error(&error))?;
    let access_token = token.access_token.ok_or_else(|| {
        ApiError::bad_gateway(
            "github_token_exchange",
            token
                .error
                .unwrap_or_else(|| "GitHub did not return an access token".into()),
        )
    })?;
    let user = github_api_request(state, &access_token, "https://api.github.com/user")
        .await?
        .json::<GitHubUserResponse>()
        .await
        .map_err(|error| github_transport_error(&error))?;
    let emails = github_api_request(state, &access_token, "https://api.github.com/user/emails")
        .await?
        .json::<Vec<GitHubEmailResponse>>()
        .await
        .map_err(|error| github_transport_error(&error))?;
    let email = emails
        .iter()
        .find(|email| email.primary && email.verified)
        .or_else(|| emails.iter().find(|email| email.verified))
        .map(|email| email.email.to_ascii_lowercase());
    Ok(GitHubIdentity {
        github_id: user.id,
        display_name: user.name.unwrap_or_else(|| user.login.clone()),
        login: user.login,
        email,
        avatar_url: user.avatar_url,
    })
}

async fn github_api_request(
    state: &AppState,
    access_token: &str,
    url: &str,
) -> ApiResult<reqwest::Response> {
    let response = state
        .http
        .get(url)
        .bearer_auth(access_token)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "CodeY-Marketplace")
        .send()
        .await
        .map_err(|error| github_transport_error(&error))?;
    if !response.status().is_success() {
        return Err(ApiError::bad_gateway(
            "github_identity",
            "GitHub identity request failed",
        ));
    }
    Ok(response)
}

fn authenticated_response(state: &AppState, user: MarketplaceUser) -> ApiResult<Response> {
    state.cloud.ensure_default_subscription(
        &user.user_id,
        &state.config.cloud_default_timezone,
        Utc::now(),
    )?;
    let (token, expires_at) = create_session(state, &user)?;
    let mut response = (
        StatusCode::OK,
        Json(AuthResponse {
            user: Some(user),
            github_enabled: github_enabled(state),
        }),
    )
        .into_response();
    set_session_cookie(
        response.headers_mut(),
        session_cookie(
            &token,
            (expires_at - Utc::now()).num_seconds(),
            session_cookie_secure(state),
        ),
    );
    Ok(response)
}

fn create_session(
    state: &AppState,
    user: &MarketplaceUser,
) -> ApiResult<(String, chrono::DateTime<Utc>)> {
    let token = random_token(32)?;
    let expires_at = Utc::now() + Duration::days(SESSION_TTL_DAYS);
    state
        .store
        .create_session(&token_hash(&token), &user.user_id, expires_at)?;
    Ok((token, expires_at))
}

fn current_user(state: &AppState, headers: &HeaderMap) -> ApiResult<Option<MarketplaceUser>> {
    let Some(token) = session_token(headers) else {
        return Ok(None);
    };
    Ok(state.store.user_for_session(&token_hash(&token))?)
}

fn require_user(state: &AppState, headers: &HeaderMap) -> ApiResult<MarketplaceUser> {
    current_user(state, headers)?
        .ok_or_else(|| ApiError::unauthorized("authentication_required", "Sign in to continue"))
}

fn require_admin(state: &AppState, headers: &HeaderMap) -> ApiResult<MarketplaceUser> {
    let user = require_user(state, headers)?;
    if !user.is_admin() {
        return Err(ApiError::forbidden(
            "administrator_required",
            "Administrator access is required",
        ));
    }
    Ok(user)
}

fn account_disabled() -> ApiError {
    ApiError::forbidden("account_disabled", "This account has been disabled")
}

fn require_same_origin(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let origin = headers
        .get(ORIGIN)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::forbidden("origin_required", "Request origin is required"))?;
    if origin != state.config.cors_origin {
        return Err(ApiError::forbidden(
            "origin_mismatch",
            "Request origin is not allowed",
        ));
    }
    Ok(())
}

fn github_enabled(state: &AppState) -> bool {
    state.config.github_client_id.is_some() && state.config.github_client_secret.is_some()
}

fn github_callback_url(state: &AppState) -> String {
    format!("{}/auth/github/callback", state.config.api_base_url)
}

fn session_cookie_secure(state: &AppState) -> bool {
    state.config.api_base_url.starts_with("https://")
}

fn github_transport_error(error: &reqwest::Error) -> ApiError {
    ApiError::bad_gateway("github_transport", error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogQuery {
    q: Option<String>,
    kind: Option<MarketplaceListingKind>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn listings(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CatalogQuery>,
) -> ApiResult<Json<MarketplaceCatalogResponse>> {
    let limit = query.limit.unwrap_or(24).clamp(1, 100);
    Ok(Json(state.store.catalog(
        query.q.as_deref(),
        query.kind,
        query.cursor.as_deref(),
        limit,
    )?))
}

async fn listing(
    State(state): State<Arc<AppState>>,
    Path(listing_id): Path<String>,
) -> ApiResult<Json<MarketplaceListingDetail>> {
    state
        .store
        .listing(&listing_id)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("listing_not_found", "Marketplace listing not found"))
}

async fn listing_releases(
    State(state): State<Arc<AppState>>,
    Path(listing_id): Path<String>,
) -> ApiResult<Json<Vec<MarketplaceReleaseSummary>>> {
    state
        .store
        .listing(&listing_id)?
        .map(|detail| Json(detail.releases))
        .ok_or_else(|| ApiError::not_found("listing_not_found", "Marketplace listing not found"))
}

async fn release(
    State(state): State<Arc<AppState>>,
    Path(release_id): Path<String>,
) -> ApiResult<Json<MarketplaceReleaseDetail>> {
    state
        .store
        .release(&release_id)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("release_not_found", "Marketplace release not found"))
}

async fn upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> ApiResult<(StatusCode, Json<MarketplaceUploadPreview>)> {
    require_same_origin(&state, &headers)?;
    let user = require_user(&state, &headers)?;
    let mut archive_bytes = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::bad_request("invalid_multipart", error.to_string()))?
    {
        if field.name() != Some(PACKAGE_FIELD) {
            continue;
        }
        let bytes = field
            .bytes()
            .await
            .map_err(|error| ApiError::bad_request("invalid_archive", error.to_string()))?;
        if bytes.is_empty() || bytes.len() > state.config.max_package_bytes {
            return Err(ApiError::payload_too_large());
        }
        archive_bytes = Some(bytes.to_vec());
        break;
    }
    let bytes = archive_bytes.ok_or_else(|| {
        ApiError::bad_request(
            "archive_required",
            format!("multipart field `{PACKAGE_FIELD}` is required"),
        )
    })?;
    let upload_id = ulid::Ulid::new().to_string();
    let expires_at = Utc::now() + Duration::minutes(UPLOAD_TTL_MINUTES);
    let inspected = inspect_archive(upload_id.clone(), expires_at, &bytes)?;
    let path = state.store.upload_path(&upload_id);
    tokio::fs::write(&path, &bytes).await?;
    state
        .store
        .save_upload(&inspected.preview, &path, &user.user_id)?;
    Ok((StatusCode::CREATED, Json(inspected.preview)))
}

async fn publish(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(upload_id): Path<String>,
    Json(request): Json<PublishMarketplaceUploadRequest>,
) -> ApiResult<(StatusCode, Json<MarketplaceSubmission>)> {
    require_same_origin(&state, &headers)?;
    let user = require_user(&state, &headers)?;
    let upload = state.store.upload(&upload_id)?.ok_or_else(|| {
        ApiError::not_found("upload_not_found", "Upload does not exist or has expired")
    })?;
    if upload.owner_user_id != user.user_id {
        return Err(ApiError::forbidden(
            "upload_owner_mismatch",
            "The staged upload belongs to another user",
        ));
    }
    if request != upload.preview.publication {
        return Err(ApiError::bad_request(
            "package_metadata_mismatch",
            "Publication metadata must match the inspected package",
        ));
    }
    validate_publish_request(&request)?;
    if !upload
        .preview
        .available_primary_resources
        .iter()
        .any(|resource| resource.resource == request.primary_resource)
    {
        return Err(ApiError::bad_request(
            "invalid_primary_resource",
            "Selected primary resource is not present in the uploaded package",
        ));
    }
    let bytes = tokio::fs::read(&upload.archive_path).await?;
    if blake3::hash(&bytes).to_hex().as_str() != upload.preview.archive_hash {
        return Err(ApiError::conflict(
            "upload_integrity",
            "Staged upload no longer matches its preview",
        ));
    }
    let artifact_path = state.store.artifact_path(&upload.preview.archive_hash);
    if tokio::fs::try_exists(&artifact_path).await? {
        let existing = tokio::fs::read(&artifact_path).await?;
        if existing != bytes {
            return Err(ApiError::conflict(
                "artifact_integrity",
                "Stored artifact does not match its content address",
            ));
        }
    } else {
        let temporary = artifact_path.with_extension(format!("tmp-{}", ulid::Ulid::new()));
        tokio::fs::write(&temporary, &bytes).await?;
        tokio::fs::rename(&temporary, &artifact_path).await?;
    }
    let submission =
        state
            .store
            .create_submission(&user, &upload.preview, &request, &artifact_path)?;
    state.store.remove_upload(&upload_id)?;
    let _ = tokio::fs::remove_file(upload.archive_path).await;
    Ok((StatusCode::ACCEPTED, Json(submission)))
}

async fn my_submissions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<MarketplaceSubmission>>> {
    let user = require_user(&state, &headers)?;
    Ok(Json(state.store.submissions_for_user(&user.user_id)?))
}

async fn admin_submissions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<MarketplaceSubmission>>> {
    require_admin(&state, &headers)?;
    Ok(Json(state.store.pending_submissions()?))
}

async fn admin_reviews(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<MarketplaceSubmission>>> {
    require_admin(&state, &headers)?;
    Ok(Json(state.store.reviewed_submissions()?))
}

async fn admin_users(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<MarketplaceAdminUser>>> {
    require_admin(&state, &headers)?;
    Ok(Json(state.store.users()?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateUserRoleRequest {
    role: MarketplaceUserRole,
}

async fn update_admin_user_role(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(request): Json<UpdateUserRoleRequest>,
) -> ApiResult<Json<MarketplaceUser>> {
    require_same_origin(&state, &headers)?;
    let admin = require_admin(&state, &headers)?;
    if admin.user_id == user_id && request.role != MarketplaceUserRole::Admin {
        return Err(ApiError::conflict(
            "cannot_demote_current_user",
            "The current administrator cannot change their own role",
        ));
    }
    state
        .store
        .update_user_role(&user_id, request.role)?
        .map(Json)
        .ok_or_else(|| ApiError::not_found("user_not_found", "User account was not found"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateUserActiveRequest {
    active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateUserActiveResponse {
    user_id: String,
    active: bool,
}

async fn update_admin_user_active(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    Json(request): Json<UpdateUserActiveRequest>,
) -> ApiResult<Json<UpdateUserActiveResponse>> {
    require_same_origin(&state, &headers)?;
    let admin = require_admin(&state, &headers)?;
    if admin.user_id == user_id && !request.active {
        return Err(ApiError::conflict(
            "cannot_disable_current_user",
            "The current administrator cannot disable their own account",
        ));
    }
    if !state.store.update_user_active(&user_id, request.active)? {
        return Err(ApiError::not_found(
            "user_not_found",
            "User account was not found",
        ));
    }
    Ok(Json(UpdateUserActiveResponse {
        user_id,
        active: request.active,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReviewRequest {
    #[serde(default)]
    note: Option<String>,
}

async fn approve_submission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(submission_id): Path<String>,
    Json(request): Json<ReviewRequest>,
) -> ApiResult<Json<MarketplaceSubmission>> {
    require_same_origin(&state, &headers)?;
    let admin = require_admin(&state, &headers)?;
    validate_review_note(request.note.as_deref())?;
    let submission = pending_submission(&state, &submission_id)?;
    let release = state.store.publish(
        &submission.preview,
        &submission.request,
        &submission.artifact_path,
        &submission.owner.user_id,
        &submission.owner.display_name,
    )?;
    Ok(Json(state.store.finish_submission(
        &submission_id,
        &admin,
        MarketplaceSubmissionStatus::Approved,
        request.note.as_deref(),
        Some(&release),
    )?))
}

async fn reject_submission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(submission_id): Path<String>,
    Json(request): Json<ReviewRequest>,
) -> ApiResult<Json<MarketplaceSubmission>> {
    require_same_origin(&state, &headers)?;
    let admin = require_admin(&state, &headers)?;
    validate_review_note(request.note.as_deref())?;
    pending_submission(&state, &submission_id)?;
    Ok(Json(state.store.finish_submission(
        &submission_id,
        &admin,
        MarketplaceSubmissionStatus::Rejected,
        request.note.as_deref(),
        None,
    )?))
}

fn pending_submission(state: &AppState, submission_id: &str) -> ApiResult<MarketplaceSubmission> {
    let submission = state.store.submission(submission_id)?.ok_or_else(|| {
        ApiError::not_found("submission_not_found", "Review submission was not found")
    })?;
    if submission.status != MarketplaceSubmissionStatus::Pending {
        return Err(ApiError::conflict(
            "submission_already_reviewed",
            "Review submission is no longer pending",
        ));
    }
    Ok(submission)
}

fn validate_review_note(note: Option<&str>) -> ApiResult<()> {
    if note.is_some_and(|value| value.chars().count() > 1000) {
        return Err(ApiError::bad_request(
            "review_note_too_long",
            "Review note must not exceed 1000 characters",
        ));
    }
    Ok(())
}

async fn download_release(
    State(state): State<Arc<AppState>>,
    Path(release_id): Path<String>,
) -> ApiResult<Response> {
    let artifact = state
        .store
        .download(&release_id)?
        .ok_or_else(|| ApiError::not_found("release_not_found", "Marketplace release not found"))?;
    let bytes = tokio::fs::read(&artifact.archive_path).await?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) != artifact.release.summary.archive_length
        || blake3::hash(&bytes).to_hex().as_str() != artifact.release.summary.archive_hash
    {
        return Err(ApiError::conflict(
            "artifact_integrity",
            "Marketplace artifact failed its integrity check",
        ));
    }
    state.store.record_download(&artifact.release.listing_id)?;
    let file_name = format!(
        "{}-{}.codeypkg",
        artifact.release.package_id.replace(['/', '\\'], "-"),
        artifact.release.summary.version
    );
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        CONTENT_TYPE,
        HeaderValue::from_static(package_format::PACKAGE_ARCHIVE_MEDIA_TYPE),
    );
    response.headers_mut().insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{file_name}\""))
            .map_err(|_| ApiError::internal("response_header", "Invalid artifact filename"))?,
    );
    response.headers_mut().insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&artifact.release.summary.archive_length.to_string())
            .map_err(|_| ApiError::internal("response_header", "Invalid artifact length"))?,
    );
    response.headers_mut().insert(
        ETAG,
        HeaderValue::from_str(&format!("\"{}\"", artifact.release.summary.archive_hash))
            .map_err(|_| ApiError::internal("response_header", "Invalid artifact hash"))?,
    );
    response.headers_mut().insert(
        "x-codey-package-hash",
        HeaderValue::from_str(&artifact.release.summary.package_content_hash)
            .map_err(|_| ApiError::internal("response_header", "Invalid package hash"))?,
    );
    Ok(response)
}

async fn preflight() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn cors_headers(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    if let Ok(origin) = HeaderValue::from_str(&state.config.cors_origin) {
        response
            .headers_mut()
            .insert(ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    response.headers_mut().insert(
        ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    response.headers_mut().insert(
        ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    response.headers_mut().insert(
        ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    response
}

fn validate_publish_request(request: &PublishMarketplaceUploadRequest) -> ApiResult<()> {
    if request.title.trim().is_empty()
        || request.title.len() > 160
        || request.summary.trim().is_empty()
        || request.summary.len() > 500
        || request.readme_markdown.len() > 256 * 1024
        || request.changelog.len() > 64 * 1024
        || request.tags.len() > 16
        || request.tags.iter().any(|tag| tag.len() > 48)
    {
        return Err(ApiError::bad_request(
            "invalid_listing_metadata",
            "Listing title, summary, tags, README, or changelog exceeds its limit",
        ));
    }
    if request.primary_resource.listing_kind().is_none() {
        return Err(ApiError::bad_request(
            "invalid_primary_resource",
            "Primary resource must be an Agent, Team, Skill, or MCP",
        ));
    }
    Ok(())
}

fn trim_url(value: &str) -> Result<String, MarketplaceServerError> {
    let value = value.trim().trim_end_matches('/');
    let parsed = url::Url::parse(value)
        .map_err(|error| MarketplaceServerError::InvalidConfiguration(error.to_string()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(MarketplaceServerError::InvalidConfiguration(
            "marketplace URL must use HTTP or HTTPS and include a host".into(),
        ));
    }
    Ok(value.to_owned())
}

fn environment_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: String,
    message: String,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: String,
    message: String,
}

impl ApiError {
    fn bad_request(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }

    fn not_found(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }

    fn unauthorized(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, code, message)
    }

    fn forbidden(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, code, message)
    }

    fn conflict(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }

    fn service_unavailable(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, code, message)
    }

    fn bad_gateway(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, code, message)
    }

    fn payload_too_large() -> Self {
        Self::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "archive_too_large",
            format!("Package archive must not exceed {MAX_PACKAGE_BYTES} bytes"),
        )
    }

    fn internal(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, code, message)
    }

    fn new(status: StatusCode, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorEnvelope {
                error: ErrorBody {
                    code: self.code,
                    message: self.message,
                },
            }),
        )
            .into_response()
    }
}

impl From<ArchiveInspectionError> for ApiError {
    fn from(error: ArchiveInspectionError) -> Self {
        Self::bad_request("invalid_archive", error.to_string())
    }
}

impl From<MarketplaceStoreError> for ApiError {
    fn from(error: MarketplaceStoreError) -> Self {
        match error {
            MarketplaceStoreError::VersionConflict => {
                Self::conflict("version_conflict", error.to_string())
            }
            MarketplaceStoreError::PublisherConflict => {
                Self::conflict("publisher_conflict", error.to_string())
            }
            MarketplaceStoreError::IdentityAlreadyExists => {
                Self::conflict("identity_exists", error.to_string())
            }
            MarketplaceStoreError::SubmissionAlreadyPending => {
                Self::conflict("submission_pending", error.to_string())
            }
            MarketplaceStoreError::InvalidSubmissionTransition => {
                Self::conflict("submission_transition", error.to_string())
            }
            MarketplaceStoreError::InvalidPrimaryResource => {
                Self::bad_request("invalid_primary_resource", error.to_string())
            }
            _ => Self::internal("marketplace_store", error.to_string()),
        }
    }
}

impl From<MarketplaceAuthError> for ApiError {
    fn from(error: MarketplaceAuthError) -> Self {
        match error {
            MarketplaceAuthError::InvalidUsername
            | MarketplaceAuthError::InvalidEmail
            | MarketplaceAuthError::InvalidPassword
            | MarketplaceAuthError::InvalidDisplayName => {
                Self::bad_request("invalid_account", error.to_string())
            }
            _ => Self::internal("marketplace_auth", error.to_string()),
        }
    }
}

impl From<PaymentError> for ApiError {
    fn from(error: PaymentError) -> Self {
        match error {
            PaymentError::ProviderNotConfigured(_) => {
                Self::service_unavailable("payment_not_configured", error.to_string())
            }
            PaymentError::InvalidOrder
            | PaymentError::UnsupportedCurrency
            | PaymentError::InvalidProviderResponse
            | PaymentError::OrderMismatch
            | PaymentError::IgnoredEvent => {
                Self::bad_request("payment_invalid_request", error.to_string())
            }
            PaymentError::InvalidSignature
            | PaymentError::ExpiredSignature
            | PaymentError::UnknownWechatKey(_)
            | PaymentError::InvalidEncryptedPayload => {
                Self::unauthorized("payment_signature", error.to_string())
            }
            PaymentError::ProviderResponse { .. } | PaymentError::Transport(_) => {
                Self::bad_gateway("payment_provider", error.to_string())
            }
            PaymentError::Store(error) => error.into(),
            _ => Self::internal("payment", error.to_string()),
        }
    }
}

impl From<GatewayError> for ApiError {
    fn from(error: GatewayError) -> Self {
        match error {
            GatewayError::GatewayNotConfigured => {
                Self::service_unavailable("gateway_not_configured", error.to_string())
            }
            GatewayError::InvalidRequestId
            | GatewayError::InvalidRequest(_)
            | GatewayError::ProtocolMismatch
            | GatewayError::InvalidUpstreamUrl => {
                Self::bad_request("gateway_invalid_request", error.to_string())
            }
            GatewayError::Transport(_) | GatewayError::UpstreamRejected { .. } => {
                Self::bad_gateway("gateway_upstream", error.to_string())
            }
            GatewayError::Store(error) => error.into(),
            _ => Self::internal("gateway", error.to_string()),
        }
    }
}

impl From<UpstreamDiscoveryError> for ApiError {
    fn from(error: UpstreamDiscoveryError) -> Self {
        match error {
            UpstreamDiscoveryError::InvalidEndpoint => {
                Self::bad_request("provider_discovery_invalid", error.to_string())
            }
            UpstreamDiscoveryError::Upstream { .. }
            | UpstreamDiscoveryError::Transport(_)
            | UpstreamDiscoveryError::InvalidResponse
            | UpstreamDiscoveryError::EmptyCatalog
            | UpstreamDiscoveryError::ResponseTooLarge => {
                Self::bad_gateway("provider_discovery_failed", error.to_string())
            }
        }
    }
}

impl From<CloudStoreError> for ApiError {
    fn from(error: CloudStoreError) -> Self {
        match error {
            CloudStoreError::InvalidBillingTimezone(_)
            | CloudStoreError::InvalidBillingAnchorDay(_)
            | CloudStoreError::InvalidProrationWindow
            | CloudStoreError::ZeroCreditAmount
            | CloudStoreError::InvalidReservation
            | CloudStoreError::InvalidPlan
            | CloudStoreError::InvalidPaymentProvider(_)
            | CloudStoreError::InvalidPlanOrder(_)
            | CloudStoreError::PlanUpgradeOfferMismatch
            | CloudStoreError::InvalidScheduledPlan
            | CloudStoreError::InvalidIdempotencyKey
            | CloudStoreError::InvalidTopUpProduct
            | CloudStoreError::InvalidUpstreamProvider
            | CloudStoreError::InvalidOfficialModel
            | CloudStoreError::ModelProtocolMismatch => {
                Self::bad_request("cloud_invalid_request", error.to_string())
            }
            CloudStoreError::InsufficientCredits { .. } => {
                Self::conflict("insufficient_credits", error.to_string())
            }
            CloudStoreError::IdempotencyConflict => {
                Self::conflict("idempotency_conflict", error.to_string())
            }
            CloudStoreError::RevisionConflict { .. } => {
                Self::conflict("revision_conflict", error.to_string())
            }
            CloudStoreError::PlanSlugConflict(_) => {
                Self::conflict("plan_slug_conflict", error.to_string())
            }
            CloudStoreError::TopUpSlugConflict(_) => {
                Self::conflict("top_up_slug_conflict", error.to_string())
            }
            CloudStoreError::UpstreamProviderSlugConflict(_)
            | CloudStoreError::OfficialModelIdConflict(_) => {
                Self::conflict("model_catalog_conflict", error.to_string())
            }
            CloudStoreError::PlanDowngradeMustBeScheduled
            | CloudStoreError::SubscriptionConflict
            | CloudStoreError::PendingRenewalExists
            | CloudStoreError::InvalidPaymentOrderState
            | CloudStoreError::PaymentFulfillmentConflict => {
                Self::conflict("cloud_state_conflict", error.to_string())
            }
            CloudStoreError::DuplicateModelRequest => {
                Self::conflict("duplicate_model_request", error.to_string())
            }
            CloudStoreError::PaymentProviderMismatch => {
                Self::conflict("payment_provider_mismatch", error.to_string())
            }
            CloudStoreError::PlanOfferNotFound | CloudStoreError::TopUpOfferNotFound => {
                Self::not_found("offer_not_found", error.to_string())
            }
            CloudStoreError::PaymentOrderNotFound => {
                Self::not_found("payment_order_not_found", error.to_string())
            }
            CloudStoreError::UpstreamProviderNotFound | CloudStoreError::OfficialModelNotFound => {
                Self::not_found("official_model_not_found", error.to_string())
            }
            CloudStoreError::ModelNotEntitled => {
                Self::forbidden("model_not_entitled", error.to_string())
            }
            CloudStoreError::UpstreamCredentialRequired => {
                Self::bad_request("upstream_credential_required", error.to_string())
            }
            CloudStoreError::ReservationNotFound => {
                Self::not_found("reservation_not_found", error.to_string())
            }
            CloudStoreError::InvalidOAuthGrant | CloudStoreError::OAuthRefreshReuse => {
                Self::unauthorized("invalid_grant", error.to_string())
            }
            _ => Self::internal("cloud_store", error.to_string()),
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(error: std::io::Error) -> Self {
        Self::internal("marketplace_io", error.to_string())
    }
}

#[derive(Debug, Error)]
pub enum MarketplaceServerError {
    #[error("marketplace server configuration is invalid: {0}")]
    InvalidConfiguration(String),
    #[error(transparent)]
    Store(#[from] MarketplaceStoreError),
    #[error(transparent)]
    CloudStore(#[from] CloudStoreError),
}

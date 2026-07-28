#![forbid(unsafe_code)]

mod archive;
mod auth;
mod contracts;
mod store;
#[cfg(test)]
mod tests;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;

use crate::contracts::{
    MarketplaceCatalogResponse, MarketplaceDiscovery, MarketplaceListingDetail,
    MarketplaceListingKind, MarketplaceReleaseDetail, MarketplaceReleaseSummary,
    MarketplaceUploadPreview, PublishMarketplaceUploadRequest, MARKETPLACE_SCHEMA_VERSION,
    MAX_PACKAGE_BYTES,
};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State};
use axum::http::header::{
    ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, ETAG, ORIGIN,
};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, options, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use archive::{inspect_archive, ArchiveInspectionError, InspectedArchive};
pub use auth::{MarketplaceUser, MarketplaceUserRole};
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

const PACKAGE_FIELD: &str = "archive";
const UPLOAD_TTL_MINUTES: i64 = 30;
const SESSION_TTL_DAYS: i64 = 30;
const OAUTH_STATE_TTL_MINUTES: i64 = 10;

#[derive(Debug, Clone)]
pub struct MarketplaceServerConfig {
    pub data_root: PathBuf,
    pub web_base_url: String,
    pub api_base_url: String,
    pub cors_origin: String,
    pub max_package_bytes: usize,
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub admin_github_logins: BTreeSet<String>,
}

impl MarketplaceServerConfig {
    pub fn from_environment() -> Result<Self, MarketplaceServerError> {
        let data_root = std::env::var_os("CODEY_MARKET_DATA_ROOT")
            .map_or_else(|| PathBuf::from(".codey-market"), PathBuf::from);
        let web_base_url = std::env::var("CODEY_MARKET_WEB_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:4321/market".into());
        let api_base_url = std::env::var("CODEY_MARKET_API_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8787/api/market/v1".into());
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
        let config = Self {
            data_root,
            web_base_url: trim_url(&web_base_url)?,
            api_base_url: trim_url(&api_base_url)?,
            cors_origin: cors_origin.trim().to_owned(),
            max_package_bytes: MAX_PACKAGE_BYTES,
            github_client_id,
            github_client_secret,
            admin_github_logins,
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
    config: MarketplaceServerConfig,
    http: reqwest::Client,
}

pub fn build_router(config: MarketplaceServerConfig) -> Result<Router, MarketplaceServerError> {
    if config.max_package_bytes == 0 || config.max_package_bytes > MAX_PACKAGE_BYTES {
        return Err(MarketplaceServerError::InvalidConfiguration(format!(
            "max package bytes must be between 1 and {MAX_PACKAGE_BYTES}"
        )));
    }
    let store = MarketplaceStore::open(&config.data_root)?;
    for path in store.expired_upload_paths()? {
        let _ = std::fs::remove_file(path);
    }
    let state = Arc::new(AppState {
        store,
        config,
        http: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| MarketplaceServerError::InvalidConfiguration(error.to_string()))?,
    });
    let max_body = state.config.max_package_bytes.saturating_add(512 * 1024);
    Ok(Router::new()
        .route("/.well-known/codey-market.json", get(discovery))
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
        .route("/api/market/v1/uploads", post(upload))
        .route("/api/market/v1/uploads/{upload_id}/publish", post(publish))
        .route("/api/market/v1/submissions/mine", get(my_submissions))
        .route("/api/market/v1/admin/submissions", get(admin_submissions))
        .route(
            "/api/market/v1/admin/submissions/{submission_id}/approve",
            post(approve_submission),
        )
        .route(
            "/api/market/v1/admin/submissions/{submission_id}/reject",
            post(reject_submission),
        )
        .route("/api/market/v1/{*path}", options(preflight))
        .layer(DefaultBodyLimit::max(max_body))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&state),
            cors_headers,
        ))
        .with_state(state))
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
    authenticated_response(
        &state,
        record
            .expect("valid credentials require a stored user")
            .user,
    )
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

async fn github_start(State(state): State<Arc<AppState>>) -> ApiResult<Response> {
    let client_id = state.config.github_client_id.as_deref().ok_or_else(|| {
        ApiError::service_unavailable("github_disabled", "GitHub login is not configured")
    })?;
    let oauth_state = random_token(32)?;
    let verifier = random_token(32)?;
    state.store.save_oauth_state(
        &token_hash(&oauth_state),
        &verifier,
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
    let (token, expires_at) = create_session(&state, &user)?;
    let mut response =
        Redirect::to(&format!("{}?auth=github", state.config.web_base_url)).into_response();
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
    validate_publish_request(&request)?;
    let upload = state.store.upload(&upload_id)?.ok_or_else(|| {
        ApiError::not_found("upload_not_found", "Upload does not exist or has expired")
    })?;
    if upload.owner_user_id != user.user_id {
        return Err(ApiError::forbidden(
            "upload_owner_mismatch",
            "The staged upload belongs to another user",
        ));
    }
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
        &admin.user_id,
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
        &admin.user_id,
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
        HeaderValue::from_static(codey_package_format::AGENT_PACKAGE_ARCHIVE_MEDIA_TYPE),
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
}

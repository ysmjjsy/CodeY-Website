use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use ring::{digest, rand};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SESSION_COOKIE: &str = "codey_market_session";
pub const OAUTH_STATE_COOKIE: &str = "codey_market_oauth_state";

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketplaceUserRole {
    User,
    Admin,
}

impl MarketplaceUserRole {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Admin => "admin",
        }
    }

    pub fn parse(value: &str) -> Result<Self, MarketplaceAuthError> {
        match value {
            "user" => Ok(Self::User),
            "admin" => Ok(Self::Admin),
            _ => Err(MarketplaceAuthError::InvalidStoredRole(value.to_owned())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceUser {
    pub user_id: String,
    pub username: String,
    pub email: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub github_login: Option<String>,
    pub role: MarketplaceUserRole,
    pub created_at: DateTime<Utc>,
}

impl MarketplaceUser {
    #[must_use]
    pub const fn is_admin(&self) -> bool {
        matches!(self.role, MarketplaceUserRole::Admin)
    }
}

#[derive(Debug, Clone)]
pub struct StoredUser {
    pub user: MarketplaceUser,
    pub password_hash: Option<String>,
    pub github_id: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct GitHubIdentity {
    pub github_id: u64,
    pub login: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OAuthState {
    pub code_verifier: String,
}

pub fn validate_username(value: &str) -> Result<String, MarketplaceAuthError> {
    let value = value.trim();
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || !value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
    {
        return Err(MarketplaceAuthError::InvalidUsername);
    }
    Ok(value.to_ascii_lowercase())
}

pub fn validate_email(value: &str) -> Result<String, MarketplaceAuthError> {
    let value = value.trim().to_ascii_lowercase();
    let mut parts = value.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if value.len() > 254
        || local.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || parts.next().is_some()
        || value.chars().any(char::is_whitespace)
    {
        return Err(MarketplaceAuthError::InvalidEmail);
    }
    Ok(value)
}

pub fn validate_password(value: &str) -> Result<(), MarketplaceAuthError> {
    if value.len() < 10 || value.len() > 128 {
        return Err(MarketplaceAuthError::InvalidPassword);
    }
    Ok(())
}

pub fn validate_display_name(value: &str) -> Result<String, MarketplaceAuthError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 {
        return Err(MarketplaceAuthError::InvalidDisplayName);
    }
    Ok(value.to_owned())
}

pub fn hash_password(password: &str) -> Result<String, MarketplaceAuthError> {
    validate_password(password)?;
    let salt = SaltString::encode_b64(&random_bytes(16)?)
        .map_err(|error| MarketplaceAuthError::PasswordHash(error.to_string()))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| MarketplaceAuthError::PasswordHash(error.to_string()))
}

pub fn verify_password(password: &str, encoded: &str) -> bool {
    PasswordHash::new(encoded).is_ok_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}

pub fn random_token(bytes: usize) -> Result<String, MarketplaceAuthError> {
    Ok(URL_SAFE_NO_PAD.encode(random_bytes(bytes)?))
}

pub fn token_hash(token: &str) -> String {
    blake3::hash(token.as_bytes()).to_hex().to_string()
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref())
}

pub fn session_token(headers: &HeaderMap) -> Option<String> {
    cookie_value(headers, SESSION_COOKIE)
}

pub fn oauth_state_token(headers: &HeaderMap) -> Option<String> {
    cookie_value(headers, OAUTH_STATE_COOKIE)
}

fn cookie_value(headers: &HeaderMap, expected_name: &str) -> Option<String> {
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find_map(|(name, value)| (name == expected_name).then(|| value.to_owned()))
}

pub fn session_cookie(token: &str, max_age_seconds: i64, secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_seconds}{secure}"
    ))
    .expect("session token and cookie attributes are static-safe")
}

pub fn clear_session_cookie(secure: bool) -> HeaderValue {
    session_cookie("", 0, secure)
}

pub fn oauth_state_cookie(token: &str, max_age_seconds: i64, secure: bool) -> HeaderValue {
    let secure = if secure { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{OAUTH_STATE_COOKIE}={token}; Path=/api/market/v1/auth/github; HttpOnly; SameSite=Lax; Max-Age={max_age_seconds}{secure}"
    ))
    .expect("OAuth state token and cookie attributes are static-safe")
}

pub fn clear_oauth_state_cookie(secure: bool) -> HeaderValue {
    oauth_state_cookie("", 0, secure)
}

pub fn set_session_cookie(headers: &mut HeaderMap, value: HeaderValue) {
    headers.append(SET_COOKIE, value);
}

fn random_bytes(length: usize) -> Result<Vec<u8>, MarketplaceAuthError> {
    let random = rand::SystemRandom::new();
    let mut bytes = vec![0_u8; length];
    rand::SecureRandom::fill(&random, &mut bytes)
        .map_err(|_| MarketplaceAuthError::RandomUnavailable)?;
    Ok(bytes)
}

#[derive(Debug, Error)]
pub enum MarketplaceAuthError {
    #[error("username must be 3-32 ASCII letters, digits, hyphens, or underscores")]
    InvalidUsername,
    #[error("email address is invalid")]
    InvalidEmail,
    #[error("password must contain 10-128 bytes")]
    InvalidPassword,
    #[error("display name must contain 1-80 characters")]
    InvalidDisplayName,
    #[error("password hashing failed: {0}")]
    PasswordHash(String),
    #[error("secure random generation is unavailable")]
    RandomUnavailable,
    #[error("stored user role is invalid: {0}")]
    InvalidStoredRole(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_credentials_are_normalized_and_argon2_verified() {
        assert_eq!(validate_username("CodeY_User").unwrap(), "codey_user");
        assert_eq!(
            validate_email(" USER@Example.COM ").unwrap(),
            "user@example.com"
        );
        let hash = hash_password("correct-horse-battery-staple").unwrap();
        assert!(hash.starts_with("$argon2"));
        assert!(verify_password("correct-horse-battery-staple", &hash));
        assert!(!verify_password("incorrect-password", &hash));
    }
}

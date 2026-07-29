use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, HeaderValue, Response, StatusCode};
use chrono::{DateTime, Duration, Utc};
use futures_util::StreamExt as _;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::io;
use thiserror::Error;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use super::models::GatewayModelConfig;
use super::{
    CloudSecretCipher, CloudStore, CloudStoreError, CreditReservationStatus, ModelPricing,
    OfficialModelProtocol, UpstreamProviderKind,
};

const RESERVATION_TTL_MINUTES: i64 = 30;
const CREDIT_RATE_DENOMINATOR: u128 = 1_000_000;

#[derive(Clone)]
pub struct GatewayManager {
    cipher: Option<CloudSecretCipher>,
    http: reqwest::Client,
}

impl std::fmt::Debug for GatewayManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GatewayManager")
            .field("configured", &self.cipher.is_some())
            .finish_non_exhaustive()
    }
}

impl GatewayManager {
    #[must_use]
    pub fn new(cipher: Option<CloudSecretCipher>, http: reqwest::Client) -> Self {
        Self { cipher, http }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn invoke(
        &self,
        store: &CloudStore,
        user_id: &str,
        request_id: &str,
        expected_protocol: OfficialModelProtocol,
        public_model_from_path: Option<&str>,
        stream_override: Option<bool>,
        incoming_headers: &HeaderMap,
        body: Bytes,
        now: DateTime<Utc>,
    ) -> Result<Response<Body>, GatewayError> {
        validate_request_id(request_id)?;
        let mut request_json: Value = serde_json::from_slice(&body)?;
        let public_model_id = public_model_from_path
            .or_else(|| request_json.get("model").and_then(Value::as_str))
            .ok_or(GatewayError::InvalidRequest("model is required".into()))?
            .to_owned();
        let model = store.gateway_model(user_id, &public_model_id, now)?;
        if model.protocol != expected_protocol {
            return Err(GatewayError::ProtocolMismatch);
        }
        let cipher = self
            .cipher
            .as_ref()
            .ok_or(GatewayError::GatewayNotConfigured)?;
        let api_key = cipher.decrypt(&model.api_key_ciphertext)?;
        let stream = stream_override.unwrap_or_else(|| {
            request_streaming(expected_protocol, &request_json, public_model_from_path)
        });
        rewrite_request(&mut request_json, &model, stream)?;
        let request_bytes = serde_json::to_vec(&request_json)?;
        let estimate = estimate_credits(&model, &request_json, request_bytes.len())?;
        let invocation =
            store.begin_model_invocation(user_id, request_id, &model, estimate, now)?;
        let upstream_url = upstream_url(&model, stream)?;
        let mut request = self
            .http
            .post(upstream_url)
            .header("Content-Type", "application/json")
            .header(
                "Accept",
                if stream {
                    "text/event-stream"
                } else {
                    "application/json"
                },
            )
            .body(request_bytes);
        request = match model.provider_kind {
            UpstreamProviderKind::OpenaiCompatible => request.bearer_auth(api_key),
            UpstreamProviderKind::Anthropic => {
                let version = incoming_headers
                    .get("anthropic-version")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or("2023-06-01");
                let mut request = request
                    .header("x-api-key", api_key)
                    .header("anthropic-version", version);
                if let Some(beta) = incoming_headers
                    .get("anthropic-beta")
                    .and_then(|value| value.to_str().ok())
                {
                    request = request.header("anthropic-beta", beta);
                }
                request
            }
            UpstreamProviderKind::Gemini => request.header("x-goog-api-key", api_key),
        };
        let upstream = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                store.mark_model_invocation_reconciliation_required(
                    &invocation,
                    "transport_unknown",
                    Utc::now(),
                )?;
                return Err(GatewayError::Transport(error));
            }
        };
        let status = upstream.status();
        let content_type = upstream
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let upstream_request_id = upstream
            .headers()
            .get("x-request-id")
            .or_else(|| upstream.headers().get("request-id"))
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        if !status.is_success() {
            let bytes = match upstream.bytes().await {
                Ok(bytes) => bytes,
                Err(error) => {
                    store.fail_model_invocation(&invocation, "upstream", Utc::now())?;
                    return Err(GatewayError::Transport(error));
                }
            };
            store.fail_model_invocation(&invocation, "upstream", Utc::now())?;
            return response_with_body(status, content_type.as_deref(), bytes);
        }
        store.mark_model_invocation_streaming(
            &invocation.invocation_id,
            upstream_request_id.as_deref(),
        )?;
        if !stream {
            let bytes = match upstream.bytes().await {
                Ok(bytes) => bytes,
                Err(error) => {
                    store.mark_model_invocation_reconciliation_required(
                        &invocation,
                        "response_unknown",
                        Utc::now(),
                    )?;
                    return Err(GatewayError::Transport(error));
                }
            };
            let value: Value = match serde_json::from_slice(&bytes) {
                Ok(value) => value,
                Err(error) => {
                    store.mark_model_invocation_reconciliation_required(
                        &invocation,
                        "response_invalid",
                        Utc::now(),
                    )?;
                    return Err(GatewayError::Json(error));
                }
            };
            let usage = Usage::from_json(&value);
            if !usage.observed {
                store.mark_model_invocation_reconciliation_required(
                    &invocation,
                    "usage_missing",
                    Utc::now(),
                )?;
                return Err(GatewayError::UsageUnavailable);
            }
            let actual = match calculate_credits(&model.pricing, usage) {
                Ok(actual) => actual,
                Err(error) => {
                    store.mark_model_invocation_reconciliation_required(
                        &invocation,
                        "usage_accounting",
                        Utc::now(),
                    )?;
                    return Err(error);
                }
            };
            store.complete_model_invocation(&invocation, usage, actual, Utc::now())?;
            return response_with_body(status, content_type.as_deref(), bytes);
        }

        let (sender, receiver) = mpsc::channel::<Result<Bytes, io::Error>>(16);
        let store = store.clone();
        let pricing = model.pricing;
        tokio::spawn(async move {
            let mut upstream = upstream.bytes_stream();
            let mut parser = StreamUsageParser::default();
            let mut receiver_open = true;
            let mut stream_failed = false;
            while let Some(chunk) = upstream.next().await {
                match chunk {
                    Ok(bytes) => {
                        parser.push(&bytes);
                        if receiver_open && sender.send(Ok(bytes)).await.is_err() {
                            receiver_open = false;
                        }
                    }
                    Err(error) => {
                        stream_failed = true;
                        if receiver_open {
                            let _ = sender.send(Err(io::Error::other(error.to_string()))).await;
                        }
                        break;
                    }
                }
            }
            if stream_failed {
                let _ = store.mark_model_invocation_reconciliation_required(
                    &invocation,
                    "stream_unknown",
                    Utc::now(),
                );
            } else {
                parser.finish();
                let usage = parser.usage;
                if usage.observed {
                    match calculate_credits(&pricing, usage) {
                        Ok(actual) => {
                            let _ = store.complete_model_invocation(
                                &invocation,
                                usage,
                                actual,
                                Utc::now(),
                            );
                        }
                        Err(_) => {
                            let _ = store.mark_model_invocation_reconciliation_required(
                                &invocation,
                                "usage_accounting",
                                Utc::now(),
                            );
                        }
                    }
                } else {
                    let _ = store.mark_model_invocation_reconciliation_required(
                        &invocation,
                        "usage_missing",
                        Utc::now(),
                    );
                }
            }
        });
        let stream = ReceiverStream::new(receiver);
        let mut response = Response::builder().status(status);
        response = response.header(
            "content-type",
            content_type.unwrap_or_else(|| "text/event-stream".into()),
        );
        response
            .header("cache-control", "no-cache")
            .body(Body::from_stream(stream))
            .map_err(|error| GatewayError::Response(error.to_string()))
    }
}

#[derive(Debug, Clone)]
pub(super) struct ModelInvocation {
    invocation_id: String,
    user_id: String,
    reservation_request_id: String,
    estimated_credit_micros: u64,
}

impl CloudStore {
    pub(super) fn begin_model_invocation(
        &self,
        user_id: &str,
        request_id: &str,
        model: &GatewayModelConfig,
        estimated_credit_micros: u64,
        now: DateTime<Utc>,
    ) -> Result<ModelInvocation, CloudStoreError> {
        let invocation_id = ulid::Ulid::new().to_string();
        let reservation_request_id = format!("model:{request_id}");
        {
            let mut connection = self.connection()?;
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            if transaction
                .query_row(
                    "SELECT 1 FROM cloud_model_invocation WHERE user_id=?1 AND request_id=?2",
                    params![user_id, request_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some()
            {
                return Err(CloudStoreError::DuplicateModelRequest);
            }
            transaction.execute(
                "INSERT INTO cloud_model_invocation(
                    invocation_id, request_id, user_id, model_id, pricing_id,
                    reservation_request_id, status, estimated_credit_micros,
                    actual_credit_micros, input_tokens, output_tokens, cache_read_tokens,
                    cache_write_tokens, upstream_request_id, started_at, completed_at, error_code
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'reserved', ?7,
                    NULL, NULL, NULL, NULL, NULL, NULL, ?8, NULL, NULL)",
                params![
                    invocation_id,
                    request_id,
                    user_id,
                    model.model_id,
                    model.pricing.pricing_id,
                    reservation_request_id,
                    super::store::stored_i64(estimated_credit_micros)?,
                    now.to_rfc3339(),
                ],
            )?;
            transaction.commit()?;
        }
        let reservation = self.reserve_credits(
            user_id,
            &reservation_request_id,
            estimated_credit_micros,
            now,
            Duration::minutes(RESERVATION_TTL_MINUTES),
        );
        match reservation {
            Ok(reservation) if reservation.status == CreditReservationStatus::Reserved => {
                Ok(ModelInvocation {
                    invocation_id,
                    user_id: user_id.into(),
                    reservation_request_id,
                    estimated_credit_micros,
                })
            }
            Ok(_) => {
                self.set_invocation_failed(&invocation_id, "reservation_state", now)?;
                Err(CloudStoreError::DuplicateModelRequest)
            }
            Err(error) => {
                self.set_invocation_failed(&invocation_id, "reservation", now)?;
                Err(error)
            }
        }
    }

    pub(super) fn mark_model_invocation_streaming(
        &self,
        invocation_id: &str,
        upstream_request_id: Option<&str>,
    ) -> Result<(), CloudStoreError> {
        self.connection()?.execute(
            "UPDATE cloud_model_invocation SET status='streaming', upstream_request_id=?1
             WHERE invocation_id=?2 AND status='reserved'",
            params![upstream_request_id, invocation_id],
        )?;
        Ok(())
    }

    pub(super) fn complete_model_invocation(
        &self,
        invocation: &ModelInvocation,
        usage: Usage,
        actual_credit_micros: u64,
        now: DateTime<Utc>,
    ) -> Result<(), CloudStoreError> {
        if actual_credit_micros > invocation.estimated_credit_micros {
            self.settle_reservation(
                &invocation.user_id,
                &invocation.reservation_request_id,
                invocation.estimated_credit_micros,
                now,
            )?;
            self.set_invocation_failed(&invocation.invocation_id, "estimate_exceeded", now)?;
            return Err(CloudStoreError::ModelEstimateExceeded);
        }
        self.settle_reservation(
            &invocation.user_id,
            &invocation.reservation_request_id,
            actual_credit_micros,
            now,
        )?;
        self.connection()?.execute(
            "UPDATE cloud_model_invocation SET status='completed', actual_credit_micros=?1,
                input_tokens=?2, output_tokens=?3, cache_read_tokens=?4,
                cache_write_tokens=?5, completed_at=?6, error_code=NULL
             WHERE invocation_id=?7",
            params![
                super::store::stored_i64(actual_credit_micros)?,
                super::store::stored_i64(usage.input_tokens)?,
                super::store::stored_i64(usage.output_tokens)?,
                super::store::stored_i64(usage.cache_read_tokens)?,
                super::store::stored_i64(usage.cache_write_tokens)?,
                now.to_rfc3339(),
                invocation.invocation_id,
            ],
        )?;
        Ok(())
    }

    pub(super) fn fail_model_invocation(
        &self,
        invocation: &ModelInvocation,
        error_code: &str,
        now: DateTime<Utc>,
    ) -> Result<(), CloudStoreError> {
        let _ = self.settle_reservation(
            &invocation.user_id,
            &invocation.reservation_request_id,
            0,
            now,
        );
        self.set_invocation_failed(&invocation.invocation_id, error_code, now)
    }

    pub(super) fn mark_model_invocation_reconciliation_required(
        &self,
        invocation: &ModelInvocation,
        error_code: &str,
        now: DateTime<Utc>,
    ) -> Result<(), CloudStoreError> {
        self.connection()?.execute(
            "UPDATE cloud_model_invocation SET reconciliation_required=1,
                error_code=?1, completed_at=?2
             WHERE invocation_id=?3 AND status!='completed'",
            params![error_code, now.to_rfc3339(), invocation.invocation_id],
        )?;
        Ok(())
    }

    fn set_invocation_failed(
        &self,
        invocation_id: &str,
        error_code: &str,
        now: DateTime<Utc>,
    ) -> Result<(), CloudStoreError> {
        self.connection()?.execute(
            "UPDATE cloud_model_invocation SET status='failed', completed_at=?1, error_code=?2
             WHERE invocation_id=?3 AND status!='completed'",
            params![now.to_rfc3339(), error_code, invocation_id],
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct Usage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    observed: bool,
}

impl Usage {
    fn from_json(value: &Value) -> Self {
        let roots = [
            value.get("usage"),
            value.pointer("/response/usage"),
            value.get("usageMetadata"),
            value.pointer("/message/usage"),
        ];
        let mut usage = Self::default();
        for root in roots.into_iter().flatten() {
            usage.observed = true;
            usage.input_tokens = usage.input_tokens.max(first_u64(
                root,
                &[
                    "input_tokens",
                    "prompt_tokens",
                    "inputTokens",
                    "promptTokenCount",
                ],
            ));
            usage.output_tokens = usage.output_tokens.max(first_u64(
                root,
                &[
                    "output_tokens",
                    "completion_tokens",
                    "outputTokens",
                    "candidatesTokenCount",
                ],
            ));
            usage.cache_read_tokens = usage.cache_read_tokens.max(first_u64(
                root,
                &[
                    "cache_read_input_tokens",
                    "cached_tokens",
                    "cachedContentTokenCount",
                ],
            ));
            usage.cache_write_tokens = usage.cache_write_tokens.max(first_u64(
                root,
                &["cache_creation_input_tokens", "cache_write_input_tokens"],
            ));
            usage.cache_read_tokens = usage.cache_read_tokens.max(
                root.pointer("/input_tokens_details/cached_tokens")
                    .or_else(|| root.pointer("/prompt_tokens_details/cached_tokens"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            );
        }
        usage
    }

    fn merge(&mut self, next: Self) {
        self.input_tokens = self.input_tokens.max(next.input_tokens);
        self.output_tokens = self.output_tokens.max(next.output_tokens);
        self.cache_read_tokens = self.cache_read_tokens.max(next.cache_read_tokens);
        self.cache_write_tokens = self.cache_write_tokens.max(next.cache_write_tokens);
        self.observed |= next.observed;
    }
}

#[derive(Default)]
struct StreamUsageParser {
    buffer: Vec<u8>,
    usage: Usage,
}

impl StreamUsageParser {
    fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
        while let Some(end) = find_event_boundary(&self.buffer) {
            let event = self.buffer.drain(..end).collect::<Vec<_>>();
            self.consume_event(&event);
        }
    }

    fn finish(&mut self) {
        if !self.buffer.is_empty() {
            let tail = std::mem::take(&mut self.buffer);
            self.consume_event(&tail);
        }
    }

    fn consume_event(&mut self, event: &[u8]) {
        for line in event.split(|byte| *byte == b'\n') {
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let data = line
                .strip_prefix(b"data:")
                .map(|value| value.strip_prefix(b" ").unwrap_or(value));
            let Some(data) = data else { continue };
            if data == b"[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_slice::<Value>(data) {
                self.usage.merge(Usage::from_json(&value));
            }
        }
    }
}

fn find_event_boundary(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| index + 2)
        .or_else(|| {
            buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| index + 4)
        })
}

fn rewrite_request(
    body: &mut Value,
    model: &GatewayModelConfig,
    stream: bool,
) -> Result<(), GatewayError> {
    let object = body
        .as_object_mut()
        .ok_or_else(|| GatewayError::InvalidRequest("request body must be an object".into()))?;
    if model.protocol != OfficialModelProtocol::GenerateContent {
        object.insert(
            "model".into(),
            Value::String(model.upstream_model_id.clone()),
        );
    }
    if model.protocol == OfficialModelProtocol::ChatCompletions && stream {
        let options = object.entry("stream_options").or_insert_with(|| json!({}));
        let options = options.as_object_mut().ok_or_else(|| {
            GatewayError::InvalidRequest("stream_options must be an object".into())
        })?;
        options.insert("include_usage".into(), Value::Bool(true));
    }
    Ok(())
}

fn request_streaming(
    protocol: OfficialModelProtocol,
    body: &Value,
    model_from_path: Option<&str>,
) -> bool {
    if protocol == OfficialModelProtocol::GenerateContent {
        return model_from_path.is_some();
    }
    body.get("stream").and_then(Value::as_bool).unwrap_or(false)
}

fn upstream_url(model: &GatewayModelConfig, stream: bool) -> Result<String, GatewayError> {
    let base = model.base_url.trim_end_matches('/');
    let path = match model.protocol {
        OfficialModelProtocol::ChatCompletions => "/v1/chat/completions".into(),
        OfficialModelProtocol::Responses => "/v1/responses".into(),
        OfficialModelProtocol::Messages => "/v1/messages".into(),
        OfficialModelProtocol::GenerateContent => {
            let encoded = url::form_urlencoded::byte_serialize(model.upstream_model_id.as_bytes())
                .collect::<String>();
            if stream {
                format!("/v1beta/models/{encoded}:streamGenerateContent?alt=sse")
            } else {
                format!("/v1beta/models/{encoded}:generateContent")
            }
        }
    };
    let url = format!("{base}{path}");
    url::Url::parse(&url).map_err(|_| GatewayError::InvalidUpstreamUrl)?;
    Ok(url)
}

fn estimate_credits(
    model: &GatewayModelConfig,
    body: &Value,
    encoded_bytes: usize,
) -> Result<u64, GatewayError> {
    let input_tokens = u64::try_from(encoded_bytes).map_err(|_| GatewayError::CreditOverflow)?;
    let configured_max = body
        .get("max_output_tokens")
        .or_else(|| body.get("max_tokens"))
        .or_else(|| body.pointer("/generationConfig/maxOutputTokens"))
        .and_then(Value::as_u64);
    let capability_max = model
        .capability
        .get("maxOutputTokens")
        .or_else(|| model.capability.get("max_output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(8_192);
    let output_tokens = configured_max.unwrap_or(capability_max);
    if output_tokens > capability_max {
        return Err(GatewayError::InvalidRequest(
            "max output tokens exceed the configured model capability".into(),
        ));
    }
    let input_rate = model
        .pricing
        .input_credit_micros_per_million
        .max(model.pricing.cache_read_credit_micros_per_million)
        .max(model.pricing.cache_write_credit_micros_per_million);
    let estimate = u128::from(model.pricing.fixed_credit_micros_per_request)
        .checked_add(token_cost(input_tokens, input_rate)?)
        .and_then(|value| {
            token_cost(
                output_tokens,
                model.pricing.output_credit_micros_per_million,
            )
            .ok()
            .and_then(|output| value.checked_add(output))
        })
        .ok_or(GatewayError::CreditOverflow)?;
    u64::try_from(estimate.max(1)).map_err(|_| GatewayError::CreditOverflow)
}

fn calculate_credits(pricing: &ModelPricing, usage: Usage) -> Result<u64, GatewayError> {
    let cached = usage
        .cache_read_tokens
        .saturating_add(usage.cache_write_tokens)
        .min(usage.input_tokens);
    let uncached = usage.input_tokens.saturating_sub(cached);
    let rated = [
        (uncached, pricing.input_credit_micros_per_million),
        (
            usage.cache_read_tokens,
            pricing.cache_read_credit_micros_per_million,
        ),
        (
            usage.cache_write_tokens,
            pricing.cache_write_credit_micros_per_million,
        ),
        (
            usage.output_tokens,
            pricing.output_credit_micros_per_million,
        ),
    ]
    .into_iter()
    .try_fold(0_u128, |total, (tokens, rate)| {
        u128::from(tokens)
            .checked_mul(u128::from(rate))
            .and_then(|value| total.checked_add(value))
            .ok_or(GatewayError::CreditOverflow)
    })?;
    let token_credits = rated
        .checked_add(CREDIT_RATE_DENOMINATOR - 1)
        .ok_or(GatewayError::CreditOverflow)?
        / CREDIT_RATE_DENOMINATOR;
    let total = u128::from(pricing.fixed_credit_micros_per_request)
        .checked_add(token_credits)
        .ok_or(GatewayError::CreditOverflow)?;
    u64::try_from(total).map_err(|_| GatewayError::CreditOverflow)
}

fn token_cost(tokens: u64, rate: u64) -> Result<u128, GatewayError> {
    let numerator = u128::from(tokens)
        .checked_mul(u128::from(rate))
        .ok_or(GatewayError::CreditOverflow)?;
    Ok(numerator
        .checked_add(CREDIT_RATE_DENOMINATOR - 1)
        .ok_or(GatewayError::CreditOverflow)?
        / CREDIT_RATE_DENOMINATOR)
}

fn first_u64(value: &Value, names: &[&str]) -> u64 {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_u64))
        .unwrap_or(0)
}

fn response_with_body(
    status: reqwest::StatusCode,
    content_type: Option<&str>,
    body: Bytes,
) -> Result<Response<Body>, GatewayError> {
    let mut builder = Response::builder().status(
        StatusCode::from_u16(status.as_u16())
            .map_err(|error| GatewayError::Response(error.to_string()))?,
    );
    if let Some(content_type) = content_type {
        builder = builder.header(
            "content-type",
            HeaderValue::from_str(content_type)
                .map_err(|error| GatewayError::Response(error.to_string()))?,
        );
    }
    builder
        .body(Body::from(body))
        .map_err(|error| GatewayError::Response(error.to_string()))
}

fn validate_request_id(value: &str) -> Result<(), GatewayError> {
    if (8..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        Ok(())
    } else {
        Err(GatewayError::InvalidRequestId)
    }
}

#[derive(Debug, Error)]
pub enum GatewayError {
    #[error("official model gateway is not configured")]
    GatewayNotConfigured,
    #[error("gateway request ID is invalid")]
    InvalidRequestId,
    #[error("gateway request is invalid: {0}")]
    InvalidRequest(String),
    #[error("gateway protocol does not match the selected model")]
    ProtocolMismatch,
    #[error("upstream model URL is invalid")]
    InvalidUpstreamUrl,
    #[error("model credit calculation overflowed")]
    CreditOverflow,
    #[error("upstream model response did not include billable usage")]
    UsageUnavailable,
    #[error("gateway transport failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("gateway JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("gateway response failed: {0}")]
    Response(String),
    #[error(transparent)]
    Store(#[from] CloudStoreError),
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{extract::State, routing::post, Json, Router};
    use tempfile::TempDir;

    use super::*;
    use crate::cloud::{
        CloudSecretCipher, ModelPricingInput, PlanBenefitInput, PublishOfficialModelRequest,
        PublishPlanRequest, UpsertUpstreamProviderRequest,
    };

    fn pricing() -> ModelPricing {
        ModelPricing {
            pricing_id: "price-1".into(),
            version: 1,
            input_credit_micros_per_million: 1_000_000,
            output_credit_micros_per_million: 2_000_000,
            cache_read_credit_micros_per_million: 100_000,
            cache_write_credit_micros_per_million: 1_250_000,
            fixed_credit_micros_per_request: 5,
            published_at: Utc::now(),
        }
    }

    #[test]
    fn usage_pricing_uses_uncached_and_cache_rates() {
        let actual = calculate_credits(
            &pricing(),
            Usage {
                input_tokens: 1_000_000,
                output_tokens: 500_000,
                cache_read_tokens: 200_000,
                cache_write_tokens: 100_000,
                observed: true,
            },
        )
        .unwrap();
        assert_eq!(actual, 1_845_005);
    }

    #[test]
    fn usage_pricing_rounds_the_combined_token_cost_once() {
        let mut pricing = pricing();
        pricing.fixed_credit_micros_per_request = 0;
        pricing.input_credit_micros_per_million = 1;
        pricing.output_credit_micros_per_million = 1;
        pricing.cache_read_credit_micros_per_million = 0;
        pricing.cache_write_credit_micros_per_million = 0;
        let actual = calculate_credits(
            &pricing,
            Usage {
                input_tokens: 1,
                output_tokens: 1,
                observed: true,
                ..Usage::default()
            },
        )
        .unwrap();
        assert_eq!(actual, 1);
    }

    #[test]
    fn stream_parser_handles_split_sse_events() {
        let mut parser = StreamUsageParser::default();
        parser.push(
            b"event: response.completed\ndata: {\"response\":{\"usage\":{\"input_tokens\":12,",
        );
        parser.push(b"\"output_tokens\":3}}}\n\n");
        assert!(parser.usage.observed);
        assert_eq!(parser.usage.input_tokens, 12);
        assert_eq!(parser.usage.output_tokens, 3);
    }

    #[tokio::test]
    async fn gateway_rewrites_model_keeps_upstream_secret_server_side_and_settles_usage() {
        let captured = Arc::new(Mutex::new(None::<(String, Value)>));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let upstream = Router::new()
            .route(
                "/v1/responses",
                post(
                    |State(captured): State<Arc<Mutex<Option<(String, Value)>>>>,
                     headers: HeaderMap,
                     Json(body): Json<Value>| async move {
                        let authorization = headers
                            .get("authorization")
                            .unwrap()
                            .to_str()
                            .unwrap()
                            .to_owned();
                        *captured.lock().unwrap() = Some((authorization, body));
                        Json(json!({
                            "id": "resp_1",
                            "output": [],
                            "usage": {"input_tokens": 100, "output_tokens": 50}
                        }))
                    },
                ),
            )
            .with_state(Arc::clone(&captured));
        let server = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });

        let root = TempDir::new().unwrap();
        let store = CloudStore::open(root.path()).unwrap();
        let cipher = CloudSecretCipher::for_test();
        let now = Utc::now();
        let admin = store
            .upsert_upstream_provider(
                &UpsertUpstreamProviderRequest {
                    provider_id: None,
                    slug: "local-openai".into(),
                    display_name: "Local upstream".into(),
                    provider_kind: UpstreamProviderKind::OpenaiCompatible,
                    base_url: format!("http://{address}"),
                    api_key: Some("upstream-secret".into()),
                    active: true,
                    expected_revision: 0,
                },
                &cipher,
                now,
            )
            .unwrap();
        let admin = store
            .publish_official_model(
                &PublishOfficialModelRequest {
                    model_id: None,
                    public_model_id: "official-gpt".into(),
                    display_name: "Official GPT".into(),
                    upstream_provider_id: admin.providers[0].provider_id.clone(),
                    upstream_model_id: "upstream-gpt".into(),
                    protocol: OfficialModelProtocol::Responses,
                    capability: json!({"maxOutputTokens": 1000}),
                    pricing: ModelPricingInput {
                        input_credit_micros_per_million: 1_000_000,
                        output_credit_micros_per_million: 2_000_000,
                        cache_read_credit_micros_per_million: 0,
                        cache_write_credit_micros_per_million: 0,
                        fixed_credit_micros_per_request: 0,
                    },
                    active: true,
                    expected_revision: admin.revision,
                },
                now,
            )
            .unwrap();
        let model_id = admin.models[0].model_id.clone();
        store
            .publish_plan(
                &PublishPlanRequest {
                    plan_id: Some("plan-free".into()),
                    slug: "free".into(),
                    display_name: "Official".into(),
                    description: "Official".into(),
                    tier_rank: 1,
                    is_default: true,
                    monthly_credit_micros: 100_000_000,
                    offers: Vec::new(),
                    benefits: vec![PlanBenefitInput {
                        code: "official-model-test".into(),
                        resource_type: "model".into(),
                        resource_id: Some(model_id),
                        action: "invoke".into(),
                        limit: json!({}),
                    }],
                    expected_revision: 0,
                },
                now,
            )
            .unwrap();
        store
            .ensure_default_subscription("user-1", "UTC", now)
            .unwrap();
        let manager = GatewayManager::new(Some(cipher), reqwest::Client::new());
        let response = manager
            .invoke(
                &store,
                "user-1",
                "gateway-request-1",
                OfficialModelProtocol::Responses,
                None,
                None,
                &HeaderMap::new(),
                Bytes::from_static(
                    br#"{"model":"official-gpt","input":"hello","max_output_tokens":100}"#,
                ),
                now,
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let captured = captured.lock().unwrap().clone().unwrap();
        assert_eq!(captured.0, "Bearer upstream-secret");
        assert_eq!(captured.1["model"], "upstream-gpt");
        let wallet = store.wallet_summary("user-1", Utc::now()).unwrap();
        assert_eq!(wallet.available_credit_micros, 99_999_800);
        server.abort();
    }
}

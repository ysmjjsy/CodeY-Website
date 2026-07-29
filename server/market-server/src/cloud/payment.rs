use std::collections::BTreeMap;
use std::path::Path;

use axum::http::HeaderMap;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use qrcode::{render::svg, QrCode};
use ring::{aead, hmac};
use rsa::pkcs1::{DecodeRsaPrivateKey as _, DecodeRsaPublicKey as _};
use rsa::pkcs1v15::{Signature, SigningKey, VerifyingKey};
use rsa::pkcs8::{DecodePrivateKey as _, DecodePublicKey as _};
use rsa::signature::{SignatureEncoding as _, Signer as _, Verifier as _};
use rsa::{RsaPrivateKey, RsaPublicKey};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use thiserror::Error;

use super::{
    CloudStore, CloudStoreError, PaymentAvailability, PaymentCheckout, PaymentCheckoutAction,
    PaymentOrder, PaymentOrderStatus, PaymentProvider,
};

const STRIPE_API_BASE: &str = "https://api.stripe.com";
const WECHAT_API_BASE: &str = "https://api.mch.weixin.qq.com";
const ALIPAY_GATEWAY: &str = "https://openapi.alipay.com/gateway.do";
const WEBHOOK_TOLERANCE_SECONDS: i64 = 300;

#[derive(Clone, Default)]
pub struct CloudPaymentConfig {
    stripe: Option<StripeConfig>,
    wechat: Option<WechatConfig>,
    alipay: Option<AlipayConfig>,
    test_enabled: bool,
}

impl std::fmt::Debug for CloudPaymentConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CloudPaymentConfig")
            .field("stripe", &self.stripe.is_some())
            .field("wechat", &self.wechat.is_some())
            .field("alipay", &self.alipay.is_some())
            .field("test_enabled", &self.test_enabled)
            .finish()
    }
}

#[derive(Clone)]
struct StripeConfig {
    secret_key: String,
    webhook_secret: String,
    success_url: String,
    cancel_url: String,
}

#[derive(Clone)]
struct WechatConfig {
    app_id: String,
    merchant_id: String,
    merchant_serial: String,
    merchant_private_key: RsaPrivateKey,
    api_v3_key: [u8; 32],
    platform_public_key_id: String,
    platform_public_key: RsaPublicKey,
    notify_url: String,
}

#[derive(Clone)]
struct AlipayConfig {
    app_id: String,
    seller_id: Option<String>,
    merchant_private_key: RsaPrivateKey,
    alipay_public_key: RsaPublicKey,
    notify_url: String,
    return_url: String,
}

impl CloudPaymentConfig {
    pub fn from_environment(
        cloud_api_base_url: &str,
        web_base_url: &str,
    ) -> Result<Self, PaymentError> {
        let success_url = environment_value("CODEY_CLOUD_PAYMENT_SUCCESS_URL")
            .unwrap_or_else(|| format!("{web_base_url}/account/?payment=success"));
        let cancel_url = environment_value("CODEY_CLOUD_PAYMENT_CANCEL_URL")
            .unwrap_or_else(|| format!("{web_base_url}/account/?payment=cancelled"));
        let stripe = optional_group(
            &["CODEY_STRIPE_SECRET_KEY", "CODEY_STRIPE_WEBHOOK_SECRET"],
            || {
                Ok(StripeConfig {
                    secret_key: required_environment("CODEY_STRIPE_SECRET_KEY")?,
                    webhook_secret: required_environment("CODEY_STRIPE_WEBHOOK_SECRET")?,
                    success_url: success_url.clone(),
                    cancel_url: cancel_url.clone(),
                })
            },
        )?;
        let wechat = optional_group(
            &[
                "CODEY_WECHAT_PAY_APP_ID",
                "CODEY_WECHAT_PAY_MERCHANT_ID",
                "CODEY_WECHAT_PAY_MERCHANT_SERIAL",
                "CODEY_WECHAT_PAY_PRIVATE_KEY_FILE",
                "CODEY_WECHAT_PAY_API_V3_KEY",
                "CODEY_WECHAT_PAY_PUBLIC_KEY_ID",
                "CODEY_WECHAT_PAY_PUBLIC_KEY_FILE",
            ],
            || {
                let api_v3 = required_environment("CODEY_WECHAT_PAY_API_V3_KEY")?;
                let api_v3_key: [u8; 32] = api_v3.as_bytes().try_into().map_err(|_| {
                    PaymentError::InvalidConfiguration(
                        "CODEY_WECHAT_PAY_API_V3_KEY must be exactly 32 bytes".into(),
                    )
                })?;
                Ok(WechatConfig {
                    app_id: required_environment("CODEY_WECHAT_PAY_APP_ID")?,
                    merchant_id: required_environment("CODEY_WECHAT_PAY_MERCHANT_ID")?,
                    merchant_serial: required_environment("CODEY_WECHAT_PAY_MERCHANT_SERIAL")?,
                    merchant_private_key: read_private_key(&required_environment(
                        "CODEY_WECHAT_PAY_PRIVATE_KEY_FILE",
                    )?)?,
                    api_v3_key,
                    platform_public_key_id: required_environment("CODEY_WECHAT_PAY_PUBLIC_KEY_ID")?,
                    platform_public_key: read_public_key(&required_environment(
                        "CODEY_WECHAT_PAY_PUBLIC_KEY_FILE",
                    )?)?,
                    notify_url: environment_value("CODEY_WECHAT_PAY_NOTIFY_URL").unwrap_or_else(
                        || format!("{cloud_api_base_url}/payments/webhooks/wechat-pay"),
                    ),
                })
            },
        )?;
        let alipay = optional_group(
            &[
                "CODEY_ALIPAY_APP_ID",
                "CODEY_ALIPAY_PRIVATE_KEY_FILE",
                "CODEY_ALIPAY_PUBLIC_KEY_FILE",
            ],
            || {
                Ok(AlipayConfig {
                    app_id: required_environment("CODEY_ALIPAY_APP_ID")?,
                    seller_id: environment_value("CODEY_ALIPAY_SELLER_ID"),
                    merchant_private_key: read_private_key(&required_environment(
                        "CODEY_ALIPAY_PRIVATE_KEY_FILE",
                    )?)?,
                    alipay_public_key: read_public_key(&required_environment(
                        "CODEY_ALIPAY_PUBLIC_KEY_FILE",
                    )?)?,
                    notify_url: environment_value("CODEY_ALIPAY_NOTIFY_URL").unwrap_or_else(|| {
                        format!("{cloud_api_base_url}/payments/webhooks/alipay")
                    }),
                    return_url: environment_value("CODEY_ALIPAY_RETURN_URL")
                        .unwrap_or_else(|| success_url.clone()),
                })
            },
        )?;
        Ok(Self {
            stripe,
            wechat,
            alipay,
            test_enabled: environment_value("CODEY_CLOUD_ENABLE_TEST_PAYMENTS")
                .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true")),
        })
    }
}

#[derive(Clone)]
pub struct PaymentManager {
    config: CloudPaymentConfig,
    http: reqwest::Client,
}

impl std::fmt::Debug for PaymentManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PaymentManager")
            .field("config", &self.config)
            .finish_non_exhaustive()
    }
}

impl PaymentManager {
    #[must_use]
    pub fn new(config: CloudPaymentConfig, http: reqwest::Client) -> Self {
        Self { config, http }
    }

    #[must_use]
    pub fn availability(&self) -> PaymentAvailability {
        let mut providers = Vec::new();
        if self.config.wechat.is_some() {
            providers.push(PaymentProvider::WechatPay);
        }
        if self.config.alipay.is_some() {
            providers.push(PaymentProvider::Alipay);
        }
        if self.config.stripe.is_some() {
            providers.push(PaymentProvider::Stripe);
        }
        if self.config.test_enabled {
            providers.push(PaymentProvider::Test);
        }
        PaymentAvailability { providers }
    }

    pub async fn create_checkout(
        &self,
        store: &CloudStore,
        order: PaymentOrder,
    ) -> Result<PaymentCheckout, PaymentError> {
        if order.status != PaymentOrderStatus::Pending {
            return Err(PaymentError::InvalidOrder);
        }
        if order.provider_order_id.is_some() {
            return store
                .payment_checkout(&order.order_id)?
                .ok_or(PaymentError::InvalidOrder);
        }
        if order.amount_minor == 0 {
            let order = store.fulfill_payment_order(
                &order.order_id,
                &format!("no-payment-{}", order.order_id),
                Utc::now(),
            )?;
            return Ok(PaymentCheckout {
                order,
                action: PaymentCheckoutAction::Redirect {
                    url: self.config.stripe.as_ref().map_or_else(
                        || "/account?payment=success".into(),
                        |value| value.success_url.clone(),
                    ),
                },
            });
        }
        match order.provider {
            PaymentProvider::Stripe => self.stripe_checkout(store, order).await,
            PaymentProvider::WechatPay => self.wechat_checkout(store, order).await,
            PaymentProvider::Alipay => self.alipay_checkout(store, &order),
            PaymentProvider::Test if self.config.test_enabled => {
                let provider_id = format!("test-{}", order.order_id);
                let action = PaymentCheckoutAction::Redirect {
                    url: format!("/api/cloud/v1/payments/test/{}/complete", order.order_id),
                };
                Ok(store.attach_provider_checkout(&order.order_id, &provider_id, &action)?)
            }
            PaymentProvider::Test => Err(PaymentError::ProviderNotConfigured("test")),
        }
    }

    async fn stripe_checkout(
        &self,
        store: &CloudStore,
        order: PaymentOrder,
    ) -> Result<PaymentCheckout, PaymentError> {
        let config = self
            .config
            .stripe
            .as_ref()
            .ok_or(PaymentError::ProviderNotConfigured("stripe"))?;
        let form = vec![
            ("mode", "payment".to_owned()),
            ("success_url", config.success_url.clone()),
            ("cancel_url", config.cancel_url.clone()),
            ("client_reference_id", order.order_id.clone()),
            ("metadata[order_id]", order.order_id.clone()),
            ("line_items[0][quantity]", "1".into()),
            (
                "line_items[0][price_data][currency]",
                order.currency.to_ascii_lowercase(),
            ),
            (
                "line_items[0][price_data][unit_amount]",
                order.amount_minor.to_string(),
            ),
            (
                "line_items[0][price_data][product_data][name]",
                "CodeY credits and plan".into(),
            ),
            ("expires_at", order.expires_at.timestamp().to_string()),
        ];
        let response = self
            .http
            .post(format!("{STRIPE_API_BASE}/v1/checkout/sessions"))
            .bearer_auth(&config.secret_key)
            .header("Idempotency-Key", &order.order_id)
            .form(&form)
            .send()
            .await?;
        let status = response.status();
        let body = response.bytes().await?;
        if !status.is_success() {
            return Err(PaymentError::ProviderResponse {
                provider: "stripe",
                status: status.as_u16(),
                body: safe_body(&body),
            });
        }
        let session: StripeCheckoutSession = serde_json::from_slice(&body)?;
        let url = session.url.ok_or(PaymentError::InvalidProviderResponse)?;
        let action = PaymentCheckoutAction::Redirect { url };
        Ok(store.attach_provider_checkout(&order.order_id, &session.id, &action)?)
    }

    async fn wechat_checkout(
        &self,
        store: &CloudStore,
        order: PaymentOrder,
    ) -> Result<PaymentCheckout, PaymentError> {
        let config = self
            .config
            .wechat
            .as_ref()
            .ok_or(PaymentError::ProviderNotConfigured("wechat_pay"))?;
        if order.currency != "CNY" {
            return Err(PaymentError::UnsupportedCurrency);
        }
        let path = "/v3/pay/transactions/native";
        let body = serde_json::to_string(&json!({
            "appid": config.app_id,
            "mchid": config.merchant_id,
            "description": "CodeY credits and plan",
            "out_trade_no": order.order_id,
            "notify_url": config.notify_url,
            "time_expire": order.expires_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            "amount": {"total": order.amount_minor, "currency": order.currency},
        }))?;
        let timestamp = Utc::now().timestamp();
        let nonce = ulid::Ulid::new().to_string();
        let message = format!("POST\n{path}\n{timestamp}\n{nonce}\n{body}\n");
        let signature = rsa_sign(&config.merchant_private_key, message.as_bytes());
        let authorization = format!(
            "WECHATPAY2-SHA256-RSA2048 mchid=\"{}\",nonce_str=\"{}\",signature=\"{}\",timestamp=\"{}\",serial_no=\"{}\"",
            config.merchant_id, nonce, signature, timestamp, config.merchant_serial
        );
        let response = self
            .http
            .post(format!("{WECHAT_API_BASE}{path}"))
            .header("Authorization", authorization)
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await?;
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.bytes().await?;
        if !status.is_success() {
            return Err(PaymentError::ProviderResponse {
                provider: "wechat_pay",
                status: status.as_u16(),
                body: safe_body(&body),
            });
        }
        verify_wechat_signature(config, &headers, &body, Utc::now())?;
        let response: WechatNativeResponse = serde_json::from_slice(&body)?;
        let image_data_url = qr_image_data_url(&response.code_url)?;
        let action = PaymentCheckoutAction::QrCode {
            code_url: response.code_url,
            image_data_url,
        };
        Ok(store.attach_provider_checkout(&order.order_id, &order.order_id, &action)?)
    }

    fn alipay_checkout(
        &self,
        store: &CloudStore,
        order: &PaymentOrder,
    ) -> Result<PaymentCheckout, PaymentError> {
        let config = self
            .config
            .alipay
            .as_ref()
            .ok_or(PaymentError::ProviderNotConfigured("alipay"))?;
        if order.currency != "CNY" {
            return Err(PaymentError::UnsupportedCurrency);
        }
        let timestamp = Utc::now()
            .with_timezone(&chrono_tz::Asia::Shanghai)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let biz_content = serde_json::to_string(&json!({
            "out_trade_no": order.order_id,
            "product_code": "FAST_INSTANT_TRADE_PAY",
            "total_amount": minor_to_decimal(order.amount_minor),
            "subject": "CodeY credits and plan",
            "timeout_express": "60m",
        }))?;
        let mut fields = BTreeMap::from([
            ("app_id".into(), config.app_id.clone()),
            ("biz_content".into(), biz_content),
            ("charset".into(), "utf-8".into()),
            ("format".into(), "JSON".into()),
            ("method".into(), "alipay.trade.page.pay".into()),
            ("notify_url".into(), config.notify_url.clone()),
            ("return_url".into(), config.return_url.clone()),
            ("sign_type".into(), "RSA2".into()),
            ("timestamp".into(), timestamp),
            ("version".into(), "1.0".into()),
        ]);
        let canonical = canonical_parameters(&fields);
        fields.insert(
            "sign".into(),
            rsa_sign(&config.merchant_private_key, canonical.as_bytes()),
        );
        let action = PaymentCheckoutAction::Form {
            method: "POST".into(),
            action: ALIPAY_GATEWAY.into(),
            fields,
        };
        Ok(store.attach_provider_checkout(&order.order_id, &order.order_id, &action)?)
    }

    pub fn process_stripe_webhook(
        &self,
        store: &CloudStore,
        signature: &str,
        body: &[u8],
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, PaymentError> {
        let config = self
            .config
            .stripe
            .as_ref()
            .ok_or(PaymentError::ProviderNotConfigured("stripe"))?;
        verify_stripe_signature(&config.webhook_secret, signature, body, now)?;
        let event: Value = serde_json::from_slice(body)?;
        let event_type = json_string(&event, "/type")?;
        if !matches!(
            event_type,
            "checkout.session.completed" | "checkout.session.async_payment_succeeded"
        ) {
            return Err(PaymentError::IgnoredEvent);
        }
        let session = event
            .pointer("/data/object")
            .ok_or(PaymentError::InvalidProviderResponse)?;
        let payment_status = json_string(session, "/payment_status")?;
        if !matches!(payment_status, "paid" | "no_payment_required") {
            return Err(PaymentError::IgnoredEvent);
        }
        let event_id = json_string(&event, "/id")?;
        let provider_order_id = json_string(session, "/id")?;
        let order_id = session
            .pointer("/client_reference_id")
            .and_then(Value::as_str)
            .or_else(|| {
                session
                    .pointer("/metadata/order_id")
                    .and_then(Value::as_str)
            })
            .ok_or(PaymentError::InvalidProviderResponse)?;
        let amount = session
            .pointer("/amount_total")
            .and_then(Value::as_u64)
            .ok_or(PaymentError::InvalidProviderResponse)?;
        let currency = json_string(session, "/currency")?.to_ascii_uppercase();
        Self::process_verified(
            store,
            PaymentProvider::Stripe,
            event_id,
            body,
            order_id,
            provider_order_id,
            amount,
            &currency,
            now,
        )
    }

    pub fn process_wechat_webhook(
        &self,
        store: &CloudStore,
        headers: &HeaderMap,
        body: &[u8],
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, PaymentError> {
        let config = self
            .config
            .wechat
            .as_ref()
            .ok_or(PaymentError::ProviderNotConfigured("wechat_pay"))?;
        verify_wechat_signature(config, headers, body, now)?;
        let event: WechatEvent = serde_json::from_slice(body)?;
        if event.event_type != "TRANSACTION.SUCCESS"
            || event.resource.algorithm != "AEAD_AES_256_GCM"
        {
            return Err(PaymentError::IgnoredEvent);
        }
        let decrypted = decrypt_wechat_resource(config, &event.resource)?;
        let transaction: Value = serde_json::from_slice(&decrypted)?;
        if json_string(&transaction, "/trade_state")? != "SUCCESS"
            || json_string(&transaction, "/mchid")? != config.merchant_id
            || json_string(&transaction, "/appid")? != config.app_id
        {
            return Err(PaymentError::InvalidProviderResponse);
        }
        let order_id = json_string(&transaction, "/out_trade_no")?;
        let amount = transaction
            .pointer("/amount/total")
            .and_then(Value::as_u64)
            .ok_or(PaymentError::InvalidProviderResponse)?;
        let currency = json_string(&transaction, "/amount/currency")?;
        Self::process_verified(
            store,
            PaymentProvider::WechatPay,
            &event.id,
            body,
            order_id,
            order_id,
            amount,
            currency,
            now,
        )
    }

    pub fn process_alipay_webhook(
        &self,
        store: &CloudStore,
        fields: &BTreeMap<String, String>,
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, PaymentError> {
        let config = self
            .config
            .alipay
            .as_ref()
            .ok_or(PaymentError::ProviderNotConfigured("alipay"))?;
        verify_alipay_signature(config, fields)?;
        if fields.get("app_id") != Some(&config.app_id)
            || config
                .seller_id
                .as_ref()
                .is_some_and(|seller| fields.get("seller_id") != Some(seller))
        {
            return Err(PaymentError::InvalidProviderResponse);
        }
        let status = required_map(fields, "trade_status")?;
        if !matches!(status, "TRADE_SUCCESS" | "TRADE_FINISHED") {
            return Err(PaymentError::IgnoredEvent);
        }
        let order_id = required_map(fields, "out_trade_no")?;
        let amount = decimal_to_minor(required_map(fields, "total_amount")?)?;
        let event_id = fields
            .get("notify_id")
            .or_else(|| fields.get("trade_no"))
            .ok_or(PaymentError::InvalidProviderResponse)?;
        let payload = canonical_parameters(fields);
        Self::process_verified(
            store,
            PaymentProvider::Alipay,
            event_id,
            payload.as_bytes(),
            order_id,
            order_id,
            amount,
            "CNY",
            now,
        )
    }

    pub fn complete_test_payment(
        &self,
        store: &CloudStore,
        user_id: &str,
        order_id: &str,
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, PaymentError> {
        if !self.config.test_enabled {
            return Err(PaymentError::ProviderNotConfigured("test"));
        }
        let order = store
            .payment_order(user_id, order_id)?
            .ok_or(CloudStoreError::PaymentOrderNotFound)?;
        if order.provider != PaymentProvider::Test {
            return Err(PaymentError::OrderMismatch);
        }
        let provider_order_id = order
            .provider_order_id
            .as_deref()
            .ok_or(PaymentError::InvalidOrder)?;
        Self::process_verified(
            store,
            PaymentProvider::Test,
            &format!("test-event-{order_id}"),
            order_id.as_bytes(),
            order_id,
            provider_order_id,
            order.amount_minor,
            &order.currency,
            now,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn process_verified(
        store: &CloudStore,
        provider: PaymentProvider,
        event_id: &str,
        payload: &[u8],
        order_id: &str,
        provider_order_id: &str,
        amount_minor: u64,
        currency: &str,
        now: DateTime<Utc>,
    ) -> Result<PaymentOrder, PaymentError> {
        let order = store
            .payment_order_by_order_id(order_id)?
            .ok_or(CloudStoreError::PaymentOrderNotFound)?;
        if order.provider != provider
            || order.amount_minor != amount_minor
            || !order.currency.eq_ignore_ascii_case(currency)
            || order
                .provider_order_id
                .as_deref()
                .is_some_and(|existing| existing != provider_order_id)
        {
            return Err(PaymentError::OrderMismatch);
        }
        Ok(store.process_verified_payment_event(
            provider,
            event_id,
            blake3::hash(payload).to_hex().as_str(),
            order_id,
            provider_order_id,
            now,
        )?)
    }
}

#[derive(Debug, Deserialize)]
struct StripeCheckoutSession {
    id: String,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WechatNativeResponse {
    code_url: String,
}

#[derive(Debug, Deserialize)]
struct WechatEvent {
    id: String,
    event_type: String,
    resource: WechatResource,
}

#[derive(Debug, Deserialize)]
struct WechatResource {
    algorithm: String,
    ciphertext: String,
    #[serde(default)]
    associated_data: String,
    nonce: String,
}

fn verify_stripe_signature(
    secret: &str,
    header: &str,
    body: &[u8],
    now: DateTime<Utc>,
) -> Result<(), PaymentError> {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in header.split(',') {
        let Some((key, value)) = part.trim().split_once('=') else {
            continue;
        };
        match key {
            "t" => timestamp = value.parse::<i64>().ok(),
            "v1" => signatures.push(decode_hex(value)?),
            _ => {}
        }
    }
    let timestamp = timestamp.ok_or(PaymentError::InvalidSignature)?;
    if (now.timestamp() - timestamp).abs() > WEBHOOK_TOLERANCE_SECONDS {
        return Err(PaymentError::ExpiredSignature);
    }
    let mut signed = timestamp.to_string().into_bytes();
    signed.push(b'.');
    signed.extend_from_slice(body);
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    if signatures
        .iter()
        .any(|signature| hmac::verify(&key, &signed, signature).is_ok())
    {
        Ok(())
    } else {
        Err(PaymentError::InvalidSignature)
    }
}

fn verify_wechat_signature(
    config: &WechatConfig,
    headers: &HeaderMap,
    body: &[u8],
    now: DateTime<Utc>,
) -> Result<(), PaymentError> {
    let timestamp = required_header(headers, "Wechatpay-Timestamp")?
        .parse::<i64>()
        .map_err(|_| PaymentError::InvalidSignature)?;
    if (now.timestamp() - timestamp).abs() > WEBHOOK_TOLERANCE_SECONDS {
        return Err(PaymentError::ExpiredSignature);
    }
    let nonce = required_header(headers, "Wechatpay-Nonce")?;
    let serial = required_header(headers, "Wechatpay-Serial")?;
    if serial != config.platform_public_key_id {
        return Err(PaymentError::UnknownWechatKey(serial.into()));
    }
    let signature = base64::engine::general_purpose::STANDARD
        .decode(required_header(headers, "Wechatpay-Signature")?)
        .map_err(|_| PaymentError::InvalidSignature)?;
    let signature =
        Signature::try_from(signature.as_slice()).map_err(|_| PaymentError::InvalidSignature)?;
    let mut message = format!("{timestamp}\n{nonce}\n").into_bytes();
    message.extend_from_slice(body);
    message.push(b'\n');
    VerifyingKey::<Sha256>::new(config.platform_public_key.clone())
        .verify(&message, &signature)
        .map_err(|_| PaymentError::InvalidSignature)
}

fn decrypt_wechat_resource(
    config: &WechatConfig,
    resource: &WechatResource,
) -> Result<Vec<u8>, PaymentError> {
    let mut ciphertext = base64::engine::general_purpose::STANDARD
        .decode(&resource.ciphertext)
        .map_err(|_| PaymentError::InvalidEncryptedPayload)?;
    let nonce = aead::Nonce::try_assume_unique_for_key(resource.nonce.as_bytes())
        .map_err(|_| PaymentError::InvalidEncryptedPayload)?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &config.api_v3_key)
            .map_err(|_| PaymentError::InvalidEncryptedPayload)?,
    );
    let plain = key
        .open_in_place(
            nonce,
            aead::Aad::from(resource.associated_data.as_bytes()),
            &mut ciphertext,
        )
        .map_err(|_| PaymentError::InvalidEncryptedPayload)?;
    Ok(plain.to_vec())
}

fn verify_alipay_signature(
    config: &AlipayConfig,
    fields: &BTreeMap<String, String>,
) -> Result<(), PaymentError> {
    if fields.get("sign_type").is_some_and(|value| value != "RSA2") {
        return Err(PaymentError::InvalidSignature);
    }
    let encoded = required_map(fields, "sign")?;
    let signature = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| PaymentError::InvalidSignature)?;
    let signature =
        Signature::try_from(signature.as_slice()).map_err(|_| PaymentError::InvalidSignature)?;
    let unsigned = fields
        .iter()
        .filter(|(key, _)| key.as_str() != "sign" && key.as_str() != "sign_type")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<BTreeMap<_, _>>();
    VerifyingKey::<Sha256>::new(config.alipay_public_key.clone())
        .verify(canonical_parameters(&unsigned).as_bytes(), &signature)
        .map_err(|_| PaymentError::InvalidSignature)
}

fn rsa_sign(key: &RsaPrivateKey, message: &[u8]) -> String {
    let signature = SigningKey::<Sha256>::new(key.clone()).sign(message);
    base64::engine::general_purpose::STANDARD.encode(signature.to_bytes())
}

fn canonical_parameters(fields: &BTreeMap<String, String>) -> String {
    fields
        .iter()
        .filter(|(_, value)| !value.is_empty())
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn qr_image_data_url(value: &str) -> Result<String, PaymentError> {
    let code = QrCode::new(value.as_bytes()).map_err(|_| PaymentError::InvalidProviderResponse)?;
    let image = code
        .render::<svg::Color<'_>>()
        .min_dimensions(280, 280)
        .dark_color(svg::Color("#111827"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image.as_bytes())
    ))
}

fn minor_to_decimal(amount: u64) -> String {
    format!("{}.{:02}", amount / 100, amount % 100)
}

fn decimal_to_minor(value: &str) -> Result<u64, PaymentError> {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.len() > 2
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(PaymentError::InvalidProviderResponse);
    }
    let whole = whole
        .parse::<u64>()
        .map_err(|_| PaymentError::InvalidProviderResponse)?;
    let fraction = match fraction.len() {
        0 => 0,
        1 => {
            fraction
                .parse::<u64>()
                .map_err(|_| PaymentError::InvalidProviderResponse)?
                * 10
        }
        _ => fraction
            .parse::<u64>()
            .map_err(|_| PaymentError::InvalidProviderResponse)?,
    };
    whole
        .checked_mul(100)
        .and_then(|value| value.checked_add(fraction))
        .ok_or(PaymentError::InvalidProviderResponse)
}

fn read_private_key(path: &str) -> Result<RsaPrivateKey, PaymentError> {
    let pem = std::fs::read_to_string(Path::new(path))?;
    RsaPrivateKey::from_pkcs8_pem(&pem)
        .or_else(|_| RsaPrivateKey::from_pkcs1_pem(&pem))
        .map_err(|error| PaymentError::InvalidKey(error.to_string()))
}

fn read_public_key(path: &str) -> Result<RsaPublicKey, PaymentError> {
    let mut pem = std::fs::read_to_string(Path::new(path))?;
    if !pem.contains("BEGIN") {
        pem = format!(
            "-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----",
            pem.trim()
        );
    }
    RsaPublicKey::from_public_key_pem(&pem)
        .or_else(|_| RsaPublicKey::from_pkcs1_pem(&pem))
        .map_err(|error| PaymentError::InvalidKey(error.to_string()))
}

fn optional_group<T>(
    names: &[&str],
    build: impl FnOnce() -> Result<T, PaymentError>,
) -> Result<Option<T>, PaymentError> {
    let present = names
        .iter()
        .filter(|name| environment_value(name).is_some())
        .count();
    if present == 0 {
        Ok(None)
    } else if present == names.len() {
        build().map(Some)
    } else {
        Err(PaymentError::InvalidConfiguration(format!(
            "payment configuration group is incomplete: {}",
            names.join(", ")
        )))
    }
}

fn environment_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn required_environment(name: &str) -> Result<String, PaymentError> {
    environment_value(name).ok_or_else(|| {
        PaymentError::InvalidConfiguration(format!("environment variable is required: {name}"))
    })
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, PaymentError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or(PaymentError::InvalidSignature)
}

fn required_map<'a>(
    fields: &'a BTreeMap<String, String>,
    name: &str,
) -> Result<&'a str, PaymentError> {
    fields
        .get(name)
        .map(String::as_str)
        .ok_or(PaymentError::InvalidProviderResponse)
}

fn json_string<'a>(value: &'a Value, pointer: &str) -> Result<&'a str, PaymentError> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .ok_or(PaymentError::InvalidProviderResponse)
}

fn decode_hex(value: &str) -> Result<Vec<u8>, PaymentError> {
    if !value.len().is_multiple_of(2) {
        return Err(PaymentError::InvalidSignature);
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = hex_digit(pair[0])?;
            let low = hex_digit(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_digit(value: u8) -> Result<u8, PaymentError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(PaymentError::InvalidSignature),
    }
}

fn safe_body(body: &[u8]) -> String {
    String::from_utf8_lossy(&body[..body.len().min(1_000)]).into_owned()
}

#[derive(Debug, Error)]
pub enum PaymentError {
    #[error("payment configuration is invalid: {0}")]
    InvalidConfiguration(String),
    #[error("payment provider is not configured: {0}")]
    ProviderNotConfigured(&'static str),
    #[error("payment order is invalid")]
    InvalidOrder,
    #[error("payment currency is not supported by this provider")]
    UnsupportedCurrency,
    #[error("payment provider returned HTTP {status} for {provider}: {body}")]
    ProviderResponse {
        provider: &'static str,
        status: u16,
        body: String,
    },
    #[error("payment provider response is invalid")]
    InvalidProviderResponse,
    #[error("payment webhook signature is invalid")]
    InvalidSignature,
    #[error("payment webhook signature is outside the accepted time window")]
    ExpiredSignature,
    #[error("unknown WeChat Pay public key: {0}")]
    UnknownWechatKey(String),
    #[error("encrypted WeChat Pay payload is invalid")]
    InvalidEncryptedPayload,
    #[error("payment webhook does not represent a successful payment")]
    IgnoredEvent,
    #[error("verified payment does not match the locked order")]
    OrderMismatch,
    #[error("payment transport failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("payment JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("payment key file failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("payment key is invalid: {0}")]
    InvalidKey(String),
    #[error(transparent)]
    Store(#[from] CloudStoreError),
}

#[cfg(test)]
mod tests {
    use std::fmt::Write as _;

    use super::*;
    use chrono::TimeZone as _;

    #[test]
    fn stripe_signature_checks_payload_and_timestamp() {
        let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let body = br#"{"id":"evt_1"}"#;
        let signed = [now.timestamp().to_string().as_bytes(), b".", body].concat();
        let signature = hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, b"secret"), &signed);
        let encoded = signature
            .as_ref()
            .iter()
            .fold(String::new(), |mut output, byte| {
                write!(&mut output, "{byte:02x}").unwrap();
                output
            });
        let header = format!("t={},v1={encoded}", now.timestamp());
        verify_stripe_signature("secret", &header, body, now).unwrap();
        assert!(matches!(
            verify_stripe_signature("secret", &header, b"changed", now),
            Err(PaymentError::InvalidSignature)
        ));
    }

    #[test]
    fn alipay_amount_parser_is_exact() {
        assert_eq!(decimal_to_minor("29.90").unwrap(), 2_990);
        assert_eq!(decimal_to_minor("29.9").unwrap(), 2_990);
        assert!(decimal_to_minor("29.901").is_err());
    }

    #[test]
    fn wechat_checkout_qr_is_embedded_as_svg_data_url() {
        let data_url = qr_image_data_url("weixin://wxpay/example").unwrap();
        assert!(data_url.starts_with("data:image/svg+xml;base64,"));
    }
}

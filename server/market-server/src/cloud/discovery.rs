use std::collections::BTreeMap;

use reqwest::StatusCode;
use serde_json::Value;
use thiserror::Error;
use url::Url;

use super::{
    provider_credential_required, provider_discovery_mode, provider_preset_models,
    ProviderDiscoveryMode, UpstreamAvailableModel, UpstreamModelDiscoverySource,
    UpstreamProviderKind,
};

const MAX_CATALOG_BYTES: usize = 2 * 1024 * 1024;
const MAX_MODELS: usize = 2_000;

#[derive(Debug, Error)]
pub enum UpstreamDiscoveryError {
    #[error("upstream model discovery URL is invalid")]
    InvalidEndpoint,
    #[error("upstream model discovery request failed: {0}")]
    Transport(String),
    #[error("upstream model discovery returned HTTP {status}: {message}")]
    Upstream { status: u16, message: String },
    #[error("upstream model discovery response is invalid")]
    InvalidResponse,
    #[error("upstream model discovery returned no callable models")]
    EmptyCatalog,
    #[error("upstream model discovery response is too large")]
    ResponseTooLarge,
}

pub async fn discover_upstream_models(
    http: &reqwest::Client,
    provider_preset_id: &str,
    provider_kind: UpstreamProviderKind,
    base_url: &str,
    api_key: &str,
) -> Result<(Vec<UpstreamAvailableModel>, UpstreamModelDiscoverySource), UpstreamDiscoveryError> {
    let discovery_mode = provider_discovery_mode(provider_preset_id);
    let endpoint = match discovery_mode {
        ProviderDiscoveryMode::Ollama => ollama_discovery_endpoint(base_url)?,
        ProviderDiscoveryMode::Standard | ProviderDiscoveryMode::StandardWithPresetFallback => {
            discovery_endpoint(provider_kind, base_url)?
        }
    };
    let mut request = http
        .get(endpoint)
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15));
    if provider_credential_required(provider_preset_id) {
        request = match provider_kind {
            UpstreamProviderKind::OpenaiCompatible => request.bearer_auth(api_key),
            UpstreamProviderKind::Anthropic => request
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01"),
            UpstreamProviderKind::Gemini => request.header("x-goog-api-key", api_key),
        };
    }
    let response = request
        .send()
        .await
        .map_err(|error| UpstreamDiscoveryError::Transport(error.to_string()))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| UpstreamDiscoveryError::Transport(error.to_string()))?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(UpstreamDiscoveryError::ResponseTooLarge);
    }
    if !status.is_success() {
        if discovery_mode == ProviderDiscoveryMode::StandardWithPresetFallback
            && matches!(
                status,
                StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
            )
        {
            let models = provider_preset_models(provider_preset_id);
            if !models.is_empty() {
                return Ok((models, UpstreamModelDiscoverySource::ProviderPreset));
            }
        }
        return Err(UpstreamDiscoveryError::Upstream {
            status: status.as_u16(),
            message: upstream_error_message(&bytes, status),
        });
    }
    let parsed = match discovery_mode {
        ProviderDiscoveryMode::Ollama => parse_ollama_models(&bytes),
        ProviderDiscoveryMode::Standard | ProviderDiscoveryMode::StandardWithPresetFallback => {
            parse_discovered_models(provider_kind, &bytes)
        }
    };
    match parsed {
        Ok(models) => Ok((
            merge_preset_service_models(provider_preset_id, models),
            UpstreamModelDiscoverySource::Upstream,
        )),
        Err(UpstreamDiscoveryError::InvalidResponse | UpstreamDiscoveryError::EmptyCatalog)
            if discovery_mode == ProviderDiscoveryMode::StandardWithPresetFallback =>
        {
            let models = provider_preset_models(provider_preset_id);
            if models.is_empty() {
                Err(UpstreamDiscoveryError::EmptyCatalog)
            } else {
                Ok((models, UpstreamModelDiscoverySource::ProviderPreset))
            }
        }
        Err(error) => Err(error),
    }
}

fn merge_preset_service_models(
    provider_preset_id: &str,
    models: Vec<UpstreamAvailableModel>,
) -> Vec<UpstreamAvailableModel> {
    let mut merged = models
        .into_iter()
        .map(|model| ((model.upstream_model_id.clone(), model.protocol), model))
        .collect::<BTreeMap<_, _>>();
    for model in provider_preset_models(provider_preset_id) {
        if model.protocol != super::OfficialModelProtocol::ChatCompletions {
            merged
                .entry((model.upstream_model_id.clone(), model.protocol))
                .or_insert(model);
        }
    }
    merged.into_values().collect()
}

fn ollama_discovery_endpoint(base_url: &str) -> Result<Url, UpstreamDiscoveryError> {
    let mut url = Url::parse(base_url).map_err(|_| UpstreamDiscoveryError::InvalidEndpoint)?;
    let base_path = url.path().trim_end_matches('/');
    let base_path = base_path.strip_suffix("/v1").unwrap_or(base_path);
    url.set_path(&format!("{base_path}/api/tags"));
    url.set_query(None);
    Ok(url)
}

fn discovery_endpoint(
    provider_kind: UpstreamProviderKind,
    base_url: &str,
) -> Result<Url, UpstreamDiscoveryError> {
    let mut url = Url::parse(base_url).map_err(|_| UpstreamDiscoveryError::InvalidEndpoint)?;
    let (version, resource) = match provider_kind {
        UpstreamProviderKind::OpenaiCompatible | UpstreamProviderKind::Anthropic => {
            ("v1", "models")
        }
        UpstreamProviderKind::Gemini => ("v1beta", "models"),
    };
    let base_path = url.path().trim_end_matches('/');
    let version_suffix = format!("/{version}");
    let path = if base_path.ends_with(&version_suffix) || has_api_version_suffix(base_path) {
        format!("{base_path}/{resource}")
    } else {
        format!("{base_path}/{version}/{resource}")
    };
    url.set_path(&path);
    url.set_query(None);
    if provider_kind == UpstreamProviderKind::Anthropic {
        url.query_pairs_mut().append_pair("limit", "1000");
    }
    if provider_kind == UpstreamProviderKind::Gemini {
        url.query_pairs_mut().append_pair("pageSize", "1000");
    }
    Ok(url)
}

fn has_api_version_suffix(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .and_then(|segment| segment.strip_prefix('v'))
        .and_then(|version| version.chars().next())
        .is_some_and(|character| character.is_ascii_digit())
}

fn parse_discovered_models(
    provider_kind: UpstreamProviderKind,
    bytes: &[u8],
) -> Result<Vec<UpstreamAvailableModel>, UpstreamDiscoveryError> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| UpstreamDiscoveryError::InvalidResponse)?;
    let items = match provider_kind {
        UpstreamProviderKind::OpenaiCompatible | UpstreamProviderKind::Anthropic => value
            .get("data")
            .and_then(Value::as_array)
            .ok_or(UpstreamDiscoveryError::InvalidResponse)?,
        UpstreamProviderKind::Gemini => value
            .get("models")
            .and_then(Value::as_array)
            .ok_or(UpstreamDiscoveryError::InvalidResponse)?,
    };
    let mut models = BTreeMap::new();
    for item in items.iter().take(MAX_MODELS) {
        if provider_kind == UpstreamProviderKind::Gemini && !supports_generate_content(item) {
            continue;
        }
        let raw_id = item.get("id").and_then(Value::as_str).or_else(|| {
            item.get("name")
                .and_then(Value::as_str)
                .map(|name| name.strip_prefix("models/").unwrap_or(name))
        });
        let Some(upstream_model_id) = raw_id.map(str::trim).filter(|id| !id.is_empty()) else {
            continue;
        };
        if upstream_model_id.chars().count() > 200 {
            continue;
        }
        let display_name = item
            .get("display_name")
            .or_else(|| item.get("displayName"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(upstream_model_id);
        models
            .entry(upstream_model_id.to_owned())
            .or_insert_with(|| UpstreamAvailableModel {
                upstream_model_id: upstream_model_id.to_owned(),
                display_name: display_name.chars().take(200).collect(),
                protocol: match provider_kind {
                    UpstreamProviderKind::OpenaiCompatible => {
                        super::OfficialModelProtocol::ChatCompletions
                    }
                    UpstreamProviderKind::Anthropic => super::OfficialModelProtocol::Messages,
                    UpstreamProviderKind::Gemini => super::OfficialModelProtocol::GenerateContent,
                },
                input_modalities: vec!["text".to_owned()],
                output_modalities: vec!["text".to_owned()],
                asynchronous: false,
            });
    }
    let models = models.into_values().collect::<Vec<_>>();
    if models.is_empty() {
        return Err(UpstreamDiscoveryError::EmptyCatalog);
    }
    Ok(models)
}

fn parse_ollama_models(
    bytes: &[u8],
) -> Result<Vec<UpstreamAvailableModel>, UpstreamDiscoveryError> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| UpstreamDiscoveryError::InvalidResponse)?;
    let items = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or(UpstreamDiscoveryError::InvalidResponse)?;
    let mut models = BTreeMap::new();
    for item in items.iter().take(MAX_MODELS) {
        let Some(model_id) = item
            .get("name")
            .or_else(|| item.get("model"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        models
            .entry(model_id.to_owned())
            .or_insert_with(|| UpstreamAvailableModel {
                upstream_model_id: model_id.to_owned(),
                display_name: model_id.to_owned(),
                protocol: super::OfficialModelProtocol::ChatCompletions,
                input_modalities: vec!["text".to_owned()],
                output_modalities: vec!["text".to_owned()],
                asynchronous: false,
            });
    }
    let models = models.into_values().collect::<Vec<_>>();
    if models.is_empty() {
        return Err(UpstreamDiscoveryError::EmptyCatalog);
    }
    Ok(models)
}

fn supports_generate_content(model: &Value) -> bool {
    let methods = model
        .get("supportedGenerationMethods")
        .or_else(|| model.get("supportedActions"))
        .and_then(Value::as_array);
    methods.is_none_or(|methods| {
        methods.iter().any(|method| {
            method
                .as_str()
                .is_some_and(|method| method.eq_ignore_ascii_case("generateContent"))
        })
    })
}

fn upstream_error_message(bytes: &[u8], status: StatusCode) -> String {
    let message = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("message"))
                .or_else(|| value.pointer("/error/type"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| {
            status
                .canonical_reason()
                .unwrap_or("upstream error")
                .to_owned()
        });
    message.chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_urls_preserve_provider_prefixes_and_avoid_duplicate_versions() {
        assert_eq!(
            discovery_endpoint(
                UpstreamProviderKind::Anthropic,
                "https://api.minimax.io/anthropic"
            )
            .unwrap()
            .as_str(),
            "https://api.minimax.io/anthropic/v1/models?limit=1000"
        );
        assert_eq!(
            discovery_endpoint(
                UpstreamProviderKind::OpenaiCompatible,
                "https://api.openai.com/v1"
            )
            .unwrap()
            .as_str(),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            discovery_endpoint(
                UpstreamProviderKind::OpenaiCompatible,
                "https://ark.cn-beijing.volces.com/api/v3"
            )
            .unwrap()
            .as_str(),
            "https://ark.cn-beijing.volces.com/api/v3/models"
        );
        assert_eq!(
            discovery_endpoint(
                UpstreamProviderKind::OpenaiCompatible,
                "https://open.bigmodel.cn/api/paas/v4"
            )
            .unwrap()
            .as_str(),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );
    }

    #[test]
    fn parses_openai_anthropic_and_gemini_catalogs() {
        let openai = parse_discovered_models(
            UpstreamProviderKind::OpenaiCompatible,
            br#"{"data":[{"id":"gpt-4.1"},{"id":"gpt-4.1-mini"}]}"#,
        )
        .unwrap();
        assert_eq!(openai[0].upstream_model_id, "gpt-4.1");

        let anthropic = parse_discovered_models(
            UpstreamProviderKind::Anthropic,
            br#"{"data":[{"id":"MiniMax-M2.7","display_name":"MiniMax M2.7"}]}"#,
        )
        .unwrap();
        assert_eq!(anthropic[0].display_name, "MiniMax M2.7");

        let gemini = parse_discovered_models(
            UpstreamProviderKind::Gemini,
            br#"{"models":[{"name":"models/gemini-flash","displayName":"Gemini Flash","supportedGenerationMethods":["generateContent"]},{"name":"models/embed","supportedGenerationMethods":["embedContent"]}]}"#,
        )
        .unwrap();
        assert_eq!(gemini.len(), 1);
        assert_eq!(gemini[0].upstream_model_id, "gemini-flash");

        let minimax = merge_preset_service_models("minimax", anthropic);
        assert!(minimax.iter().any(|model| {
            model.upstream_model_id == "MiniMax-M2.7"
                && model.protocol == super::super::OfficialModelProtocol::Messages
        }));
        assert!(minimax.iter().any(|model| {
            model.upstream_model_id == "image-01"
                && model.protocol == super::super::OfficialModelProtocol::ImageGeneration
        }));
    }

    #[test]
    fn parses_ollama_catalog_and_normalizes_its_endpoint() {
        assert_eq!(
            ollama_discovery_endpoint("http://127.0.0.1:11434/v1")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:11434/api/tags"
        );
        let models =
            parse_ollama_models(br#"{"models":[{"name":"llama3.1:8b"},{"model":"qwen3:8b"}]}"#)
                .unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].upstream_model_id, "llama3.1:8b");
    }
}

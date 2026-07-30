use super::OfficialModelProtocol;
use super::{UpstreamAvailableModel, UpstreamProviderKind};

pub const CUSTOM_PROVIDER_PRESET_ID: &str = "custom";

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ProviderDiscoveryMode {
    Standard,
    StandardWithPresetFallback,
    Ollama,
}

#[derive(Debug, Clone, Copy)]
pub struct ProviderPreset {
    pub id: &'static str,
    pub display_name: &'static str,
    pub provider_kind: UpstreamProviderKind,
    pub default_base_url: &'static str,
    pub credential_required: bool,
    pub discovery_mode: ProviderDiscoveryMode,
    fallback_models: &'static [ProviderModelPreset],
}

#[derive(Debug, Clone, Copy)]
struct ProviderModelPreset {
    id: &'static str,
    display_name: &'static str,
    protocol: OfficialModelProtocol,
    input_modalities: &'static [&'static str],
    output_modalities: &'static [&'static str],
    asynchronous: bool,
}

const fn chat(id: &'static str, display_name: &'static str) -> ProviderModelPreset {
    ProviderModelPreset {
        id,
        display_name,
        protocol: OfficialModelProtocol::ChatCompletions,
        input_modalities: &["text"],
        output_modalities: &["text"],
        asynchronous: false,
    }
}

const fn service(
    id: &'static str,
    display_name: &'static str,
    protocol: OfficialModelProtocol,
    input_modalities: &'static [&'static str],
    output_modalities: &'static [&'static str],
    asynchronous: bool,
) -> ProviderModelPreset {
    ProviderModelPreset {
        id,
        display_name,
        protocol,
        input_modalities,
        output_modalities,
        asynchronous,
    }
}

const DOUBAO_MODELS: &[ProviderModelPreset] = &[
    chat("doubao-seed-evolving", "Doubao Seed Evolving"),
    chat("doubao-seed-2-1-pro-260628", "Doubao Seed 2.1 Pro"),
    chat("doubao-seed-2-1-turbo-260628", "Doubao Seed 2.1 Turbo"),
    chat(
        "doubao-seed-2-0-code-preview-260215",
        "Doubao Seed 2.0 Code Preview",
    ),
];
const MINIMAX_MODELS: &[ProviderModelPreset] = &[
    chat("MiniMax-M3", "MiniMax M3"),
    chat("MiniMax-M2.7", "MiniMax M2.7"),
    chat("MiniMax-M2.7-highspeed", "MiniMax M2.7 Highspeed"),
    service(
        "image-01",
        "Image 01",
        OfficialModelProtocol::ImageGeneration,
        &["text"],
        &["image"],
        false,
    ),
    service(
        "image-01-live",
        "Image 01 Live",
        OfficialModelProtocol::ImageEdit,
        &["text", "image"],
        &["image"],
        false,
    ),
    service(
        "MiniMax-Hailuo-2.3",
        "MiniMax Hailuo 2.3",
        OfficialModelProtocol::VideoGeneration,
        &["text", "image"],
        &["video"],
        true,
    ),
    service(
        "MiniMax-Hailuo-2.3-Fast",
        "MiniMax Hailuo 2.3 Fast",
        OfficialModelProtocol::VideoGeneration,
        &["text", "image"],
        &["video"],
        true,
    ),
    service(
        "MiniMax-Hailuo-02",
        "MiniMax Hailuo 02",
        OfficialModelProtocol::VideoGeneration,
        &["text", "image"],
        &["video"],
        true,
    ),
    service(
        "speech-2.8-hd",
        "Speech 2.8 HD",
        OfficialModelProtocol::SpeechSynthesis,
        &["text"],
        &["audio"],
        false,
    ),
    service(
        "speech-2.8-turbo",
        "Speech 2.8 Turbo",
        OfficialModelProtocol::SpeechSynthesis,
        &["text"],
        &["audio"],
        false,
    ),
    service(
        "speech-2.6-hd",
        "Speech 2.6 HD",
        OfficialModelProtocol::SpeechSynthesis,
        &["text"],
        &["audio"],
        false,
    ),
    service(
        "speech-2.6-turbo",
        "Speech 2.6 Turbo",
        OfficialModelProtocol::SpeechSynthesis,
        &["text"],
        &["audio"],
        false,
    ),
    service(
        "music-2.6",
        "Music 2.6",
        OfficialModelProtocol::MusicGeneration,
        &["text"],
        &["audio"],
        false,
    ),
    service(
        "music-2.6-free",
        "Music 2.6 Free",
        OfficialModelProtocol::MusicGeneration,
        &["text"],
        &["audio"],
        false,
    ),
    service(
        "music-cover",
        "Music Cover",
        OfficialModelProtocol::MusicGeneration,
        &["text", "audio"],
        &["audio"],
        false,
    ),
    service(
        "music-cover-free",
        "Music Cover Free",
        OfficialModelProtocol::MusicGeneration,
        &["text", "audio"],
        &["audio"],
        false,
    ),
];
const QWEN_MODELS: &[ProviderModelPreset] = &[
    chat("qwen3.7-max", "Qwen3.7 Max"),
    chat("qwen3.7-max-preview", "Qwen3.7 Max Preview"),
    chat("qwen3-max", "Qwen3 Max"),
];
const ZHIPU_MODELS: &[ProviderModelPreset] = &[
    chat("glm-5.2", "GLM-5.2"),
    chat("glm-5.1", "GLM-5.1"),
    chat("glm-5-turbo", "GLM-5 Turbo"),
];

pub const PROVIDER_PRESETS: &[ProviderPreset] = &[
    ProviderPreset {
        id: "anthropic",
        display_name: "Anthropic",
        provider_kind: UpstreamProviderKind::Anthropic,
        default_base_url: "https://api.anthropic.com",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "bedrock",
        display_name: "Amazon Bedrock",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://bedrock-mantle.us-east-1.api.aws/v1",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "codex",
        display_name: "Codex",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://api.openai.com",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "deepseek",
        display_name: "DeepSeek",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://api.deepseek.com",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "doubao",
        display_name: "Doubao",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://ark.cn-beijing.volces.com/api/v3",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::StandardWithPresetFallback,
        fallback_models: DOUBAO_MODELS,
    },
    ProviderPreset {
        id: "gemini",
        display_name: "Gemini",
        provider_kind: UpstreamProviderKind::Gemini,
        default_base_url: "https://generativelanguage.googleapis.com",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "km",
        display_name: "Kimi",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://api.moonshot.cn",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "local-llama",
        display_name: "Local Llama",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "http://127.0.0.1:11434",
        credential_required: false,
        discovery_mode: ProviderDiscoveryMode::Ollama,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "minimax",
        display_name: "MiniMax",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://api.minimaxi.com",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::StandardWithPresetFallback,
        fallback_models: MINIMAX_MODELS,
    },
    ProviderPreset {
        id: "openai",
        display_name: "OpenAI",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://api.openai.com",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "openrouter",
        display_name: "OpenRouter",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://openrouter.ai/api",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::Standard,
        fallback_models: &[],
    },
    ProviderPreset {
        id: "qwen",
        display_name: "Qwen",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::StandardWithPresetFallback,
        fallback_models: QWEN_MODELS,
    },
    ProviderPreset {
        id: "zhipu",
        display_name: "Zhipu",
        provider_kind: UpstreamProviderKind::OpenaiCompatible,
        default_base_url: "https://open.bigmodel.cn/api/paas/v4",
        credential_required: true,
        discovery_mode: ProviderDiscoveryMode::StandardWithPresetFallback,
        fallback_models: ZHIPU_MODELS,
    },
];

pub fn provider_preset(id: &str) -> Option<&'static ProviderPreset> {
    PROVIDER_PRESETS.iter().find(|preset| preset.id == id)
}

pub fn normalize_provider_preset_id(value: Option<&str>) -> Option<&'static str> {
    let value = value.map(str::trim).filter(|value| !value.is_empty());
    match value {
        None | Some(CUSTOM_PROVIDER_PRESET_ID) => Some(CUSTOM_PROVIDER_PRESET_ID),
        Some(value) => provider_preset(value).map(|preset| preset.id),
    }
}

pub fn provider_credential_required(provider_preset_id: &str) -> bool {
    provider_preset(provider_preset_id).is_none_or(|preset| preset.credential_required)
}

pub fn provider_discovery_mode(provider_preset_id: &str) -> ProviderDiscoveryMode {
    provider_preset(provider_preset_id).map_or(ProviderDiscoveryMode::Standard, |preset| {
        preset.discovery_mode
    })
}

pub fn provider_preset_models(provider_preset_id: &str) -> Vec<UpstreamAvailableModel> {
    provider_preset(provider_preset_id)
        .map(|preset| {
            preset
                .fallback_models
                .iter()
                .map(|model| UpstreamAvailableModel {
                    upstream_model_id: model.id.to_owned(),
                    display_name: model.display_name.to_owned(),
                    protocol: model.protocol,
                    input_modalities: model
                        .input_modalities
                        .iter()
                        .map(|value| (*value).to_owned())
                        .collect(),
                    output_modalities: model
                        .output_modalities
                        .iter()
                        .map(|value| (*value).to_owned())
                        .collect(),
                    asynchronous: model.asynchronous,
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_contains_supported_provider_integrations() {
        assert_eq!(
            PROVIDER_PRESETS
                .iter()
                .map(|preset| preset.id)
                .collect::<Vec<_>>(),
            vec![
                "anthropic",
                "bedrock",
                "codex",
                "deepseek",
                "doubao",
                "gemini",
                "km",
                "local-llama",
                "minimax",
                "openai",
                "openrouter",
                "qwen",
                "zhipu",
            ]
        );
        assert!(!provider_credential_required("local-llama"));
        let minimax = provider_preset_models("minimax");
        assert!(minimax.iter().any(|model| {
            model.upstream_model_id == "image-01"
                && model.protocol == OfficialModelProtocol::ImageGeneration
                && model.output_modalities == ["image"]
        }));
        assert!(minimax.iter().any(|model| {
            model.upstream_model_id == "MiniMax-Hailuo-2.3"
                && model.protocol == OfficialModelProtocol::VideoGeneration
                && model.asynchronous
        }));
        assert!(minimax.iter().any(|model| {
            model.upstream_model_id == "speech-2.8-hd"
                && model.protocol == OfficialModelProtocol::SpeechSynthesis
        }));
    }
}

export type ProviderPreset = {
  id: string
  displayName: string
  providerKind: 'openai_compatible' | 'anthropic' | 'gemini'
  baseUrl: string
  credentialRequired: boolean
  protocols: Array<'chat_completions' | 'responses' | 'messages' | 'generate_content' | 'image_generation' | 'image_edit' | 'video_generation' | 'speech_synthesis' | 'music_generation'>
}

export const providerPresets: ProviderPreset[] = [
  { id: 'anthropic', displayName: 'Anthropic', providerKind: 'anthropic', baseUrl: 'https://api.anthropic.com', credentialRequired: true, protocols: ['messages'] },
  { id: 'bedrock', displayName: 'Amazon Bedrock', providerKind: 'openai_compatible', baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1', credentialRequired: true, protocols: ['responses', 'chat_completions'] },
  { id: 'codex', displayName: 'Codex', providerKind: 'openai_compatible', baseUrl: 'https://api.openai.com', credentialRequired: true, protocols: ['responses'] },
  { id: 'deepseek', displayName: 'DeepSeek', providerKind: 'openai_compatible', baseUrl: 'https://api.deepseek.com', credentialRequired: true, protocols: ['chat_completions'] },
  { id: 'doubao', displayName: 'Doubao', providerKind: 'openai_compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', credentialRequired: true, protocols: ['responses', 'chat_completions'] },
  { id: 'gemini', displayName: 'Gemini', providerKind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', credentialRequired: true, protocols: ['generate_content'] },
  { id: 'km', displayName: 'Kimi', providerKind: 'openai_compatible', baseUrl: 'https://api.moonshot.cn', credentialRequired: true, protocols: ['chat_completions'] },
  { id: 'local-llama', displayName: 'Local Llama', providerKind: 'openai_compatible', baseUrl: 'http://127.0.0.1:11434', credentialRequired: false, protocols: ['chat_completions'] },
  { id: 'minimax', displayName: 'MiniMax', providerKind: 'openai_compatible', baseUrl: 'https://api.minimaxi.com', credentialRequired: true, protocols: ['chat_completions', 'responses', 'image_generation', 'image_edit', 'video_generation', 'speech_synthesis', 'music_generation'] },
  { id: 'openai', displayName: 'OpenAI', providerKind: 'openai_compatible', baseUrl: 'https://api.openai.com', credentialRequired: true, protocols: ['responses', 'chat_completions'] },
  { id: 'openrouter', displayName: 'OpenRouter', providerKind: 'openai_compatible', baseUrl: 'https://openrouter.ai/api', credentialRequired: true, protocols: ['chat_completions'] },
  { id: 'qwen', displayName: 'Qwen', providerKind: 'openai_compatible', baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', credentialRequired: true, protocols: ['responses', 'chat_completions'] },
  { id: 'zhipu', displayName: 'Zhipu', providerKind: 'openai_compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', credentialRequired: true, protocols: ['chat_completions'] },
]

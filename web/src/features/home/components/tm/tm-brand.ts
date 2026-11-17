/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import { getLobeIcon } from '@/lib/lobe-icon'

/**
 * Resolve the lobe icon id for a market model. `icon`/`vendor_icon` are only
 * populated when the deployment configures them, so fall back to matching the
 * vendor or model name against the known lobe catalogue; `.Color` prefers the
 * brand-colored variant and falls back to mono inside getLobeIcon.
 */
interface IconCarrier {
  icon?: string
  vendor_icon?: string
  vendor_name?: string
  model_name?: string
}

const VENDOR_ICONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/claude|anthropic|devin/i, 'Claude'],
  [/openai|gpt|sora|o[1-9]/i, 'OpenAI'],
  [/deepseek/i, 'DeepSeek'],
  [/glm|chatglm|zhipu|智谱|清言/i, 'ChatGLM'],
  [/hunyuan|混元|tencent|腾讯/i, 'Hunyuan'],
  [/qwen|通义|千问|tongyi|alibaba|阿里/i, 'Qwen'],
  [/gemini|google|bard|vertex/i, 'Gemini'],
  [/doubao|豆包|volcano|火山|字节|bytedance/i, 'Doubao'],
  [/kimi|moonshot|月之暗面/i, 'Kimi'],
  [/baichuan|百川/i, 'Baichuan'],
  [/spark|讯飞|iflytek/i, 'Spark'],
  [/minimax|海螺|abab/i, 'Minimax'],
  [/wenxin|文心|ernie|baidu|百度/i, 'Wenxin'],
  [/mistral|mixtral|codestral/i, 'Mistral'],
  [/llama|llama-?\d|meta/i, 'MetaAI'],
  [/grok|xai|x\.ai/i, 'Grok'],
  [/yi[-\s]|零一|01\.ai/i, 'ZeroOne'],
  [/step|阶跃/i, 'Stepfun'],
  [/nova|amazon|aws|bedrock/i, 'Nova'],
]

export function modelIconName(m: IconCarrier): string | undefined {
  const named = m.icon || m.vendor_icon
  if (named && named.trim()) return named

  const haystack = `${m.vendor_name ?? ''} ${m.model_name ?? ''}`
  for (const [pattern, icon] of VENDOR_ICONS) {
    if (pattern.test(haystack)) return icon
  }
  return undefined
}

export function modelIcon(m: IconCarrier, size: number) {
  const name = modelIconName(m)
  // `.Color` prefers the brand-colored variant; getLobeIcon falls back to
  // the mono variant for ids without one (OpenAI, Grok, XAI, ...). Unknown
  // vendors render getLobeIcon's letter-avatar fallback like before.
  return getLobeIcon(name ? `${name}.Color` : (m.model_name ?? ''), size)
}

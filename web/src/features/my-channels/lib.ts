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
import { z } from 'zod'

import {
  CHANNEL_STATUS,
  CHANNEL_TYPE_TASK_PLUGIN,
  CHANNEL_TYPES,
  ERROR_MESSAGES,
} from '@/features/channels/constants'
import { MARKETPLACE_CHANNEL_TYPES } from '@/features/token-package/marketplace-channel-types'
import type { RequestPluginConfigDraft } from '@/features/task-plugins/lib/request-plugins'

export const MY_CHANNELS_QUERY_KEY = ['my-channels'] as const

export function channelTypeLabel(type: number) {
  return CHANNEL_TYPES[type as keyof typeof CHANNEL_TYPES] || String(type)
}

export function parseModelList(models: string[] | null | undefined) {
  return (models || []).map((model) => model.trim()).filter(Boolean)
}

export function isBoundChannel(channel: { bound_packages?: string[] | null }) {
  return (channel.bound_packages || []).length > 0
}

const MARKETPLACE_TYPE_SET = new Set<number>([
  ...MARKETPLACE_CHANNEL_TYPES,
  CHANNEL_TYPE_TASK_PLUGIN,
])

export type MyChannelFormValues = {
  name: string
  type: number
  base_url: string
  key: string
  openai_organization: string
  models: string
  model_mapping: string
  test_model: string
  other: string
  priority: number
  weight: number
  status: number
  task_plugin_key: string
  plugin_config: Record<string, unknown>
  plugin_config_draft: RequestPluginConfigDraft | null
  azure_responses_version: string
  vertex_key_type: 'json' | 'api_key'
  vertex_project_id: string
  vertex_api_version: 'v1' | 'v1beta1'
  openrouter_enterprise: boolean
  aws_key_type: 'ak_sk' | 'api_key'
  aws_api_type: 'invoke_model' | 'mantle'
}

export const MY_CHANNEL_FORM_DEFAULT_VALUES: MyChannelFormValues = {
  name: '',
  type: MARKETPLACE_CHANNEL_TYPES[0],
  base_url: '',
  key: '',
  openai_organization: '',
  models: '',
  model_mapping: '',
  test_model: '',
  other: '',
  priority: 0,
  weight: 0,
  status: CHANNEL_STATUS.ENABLED,
  task_plugin_key: '',
  plugin_config: {},
  plugin_config_draft: null,
  azure_responses_version: '',
  vertex_key_type: 'json',
  vertex_project_id: '',
  vertex_api_version: 'v1',
  openrouter_enterprise: false,
  aws_key_type: 'ak_sk',
  aws_api_type: 'invoke_model',
}

function isModelMapping(value: string): boolean {
  if (!value.trim()) return true
  try {
    const parsed = JSON.parse(value)
    return (
      Boolean(parsed) &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((target) => typeof target === 'string')
    )
  } catch {
    return false
  }
}

function isVertexRegion(value: string): boolean {
  if (!value.trim()) return false
  try {
    const parsed = JSON.parse(value)
    return (
      Boolean(parsed) &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).default === 'string'
    )
  } catch {
    return false
  }
}

function isVertexServiceAccount(value: string): boolean {
  if (!value.trim()) return true
  try {
    const parsed = JSON.parse(value)
    return (
      Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed)
    )
  } catch {
    return false
  }
}

export const MY_CHANNEL_BASE_URL_REQUIRED_TYPES = new Set([3, 8, 45, 59, 60])
export const MY_CHANNEL_OTHER_REQUIRED_TYPES = new Set([3, 39, 41])

export const myChannelFormSchema = z
  .object({
    name: z.string().trim().min(1, ERROR_MESSAGES.REQUIRED_NAME),
    type: z
      .number()
      .int()
      .refine((type) => MARKETPLACE_TYPE_SET.has(type), {
        message: 'Channel type is not allowed for marketplace channels',
      }),
    base_url: z.string(),
    key: z.string(),
    openai_organization: z.string(),
    models: z.string().trim().min(1, ERROR_MESSAGES.REQUIRED_MODELS),
    model_mapping: z
      .string()
      .refine(
        isModelMapping,
        'Model mapping must be a JSON object with string values'
      ),
    test_model: z.string(),
    other: z.string(),
    priority: z.number().int(),
    weight: z.number().int().min(0),
    status: z.number().int(),
    task_plugin_key: z.string(),
    plugin_config: z.record(z.string(), z.unknown()),
    plugin_config_draft: z.record(z.string(), z.unknown()).nullable(),
    azure_responses_version: z.string(),
    vertex_key_type: z.enum(['json', 'api_key']),
    vertex_project_id: z.string(),
    vertex_api_version: z.enum(['v1', 'v1beta1']),
    openrouter_enterprise: z.boolean(),
    aws_key_type: z.enum(['ak_sk', 'api_key']),
    aws_api_type: z.enum(['invoke_model', 'mantle']),
  })
  .superRefine((values, ctx) => {
    if (values.type === 61 && !values.task_plugin_key.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['task_plugin_key'],
        message: 'A plugin is required for this channel type',
      })
    }

    if (
      MY_CHANNEL_BASE_URL_REQUIRED_TYPES.has(values.type) &&
      !values.base_url.trim()
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['base_url'],
        message: 'Base URL is required for this channel type',
      })
    }

    if (
      MY_CHANNEL_OTHER_REQUIRED_TYPES.has(values.type) &&
      !values.other.trim()
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['other'],
        message: 'This channel type requires additional configuration',
      })
    }

    if (values.type === 41) {
      if (values.other.trim() && !isVertexRegion(values.other)) {
        ctx.addIssue({
          code: 'custom',
          path: ['other'],
          message: 'Deployment region must be valid JSON with a default field',
        })
      }
      if (
        values.vertex_key_type === 'json' &&
        values.key.trim() &&
        !isVertexServiceAccount(values.key)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['key'],
          message: 'Vertex AI service account key must be valid JSON',
        })
      }
    }
  })

export function parseMyChannelModelMapping(
  value: string
): Record<string, string> | null {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const entries = Object.entries(parsed)
    if (entries.some(([, target]) => typeof target !== 'string')) {
      return null
    }
    return Object.fromEntries(
      entries.map(([source, target]) => [source, String(target)])
    )
  } catch {
    return null
  }
}

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
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Eraser,
  FileText,
  Loader2,
  Puzzle,
  Route,
  Server,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type SubmitErrorHandler, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LearnMore } from '@/components/learn-more'
import { LoadingState } from '@/components/loading-state'
import { MultiSelect } from '@/components/multi-select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { PopoverDescription, PopoverTitle } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { TaskPluginOption } from '@/features/channels/api'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import { ConfigureModelsDialog } from '@/features/channels/components/dialogs/configure-models-dialog'
import { PluginLoginDialog } from '@/features/channels/components/dialogs/plugin-login-dialog'
import {
  ChannelConfiguration,
  ChannelConfigurationStatusIndicator,
} from '@/features/channels/components/drawers/channel-configuration'
import { channelConfigurationBlockClassName } from '@/features/channels/components/drawers/channel-configuration-block-class'
import { ChannelConfigurationSubHeading } from '@/features/channels/components/drawers/channel-configuration-blocks'
import { ChannelPluginConfigFields } from '@/features/channels/components/drawers/channel-plugin-config-fields'
import { ChannelProviderPicker } from '@/features/channels/components/drawers/channel-provider-picker'
import { PluginCredentialPanel } from '@/features/channels/components/drawers/plugin-credential-panel'
import {
  ChannelApiAccessSection,
  ChannelBasicSection,
  ChannelModelsSection,
} from '@/features/channels/components/drawers/sections'
import {
  ModelMappingBatchDialog,
  type ModelMappingBatchResult,
} from '@/features/channels/components/model-mapping-batch-dialog'
import {
  ModelMappingEditor,
  type ModelMappingDraftRequest,
} from '@/features/channels/components/model-mapping-editor'
import { UpstreamModelSelection } from '@/features/channels/components/upstream-model-selection'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_LABELS,
  CHANNEL_PROVIDER_PRESENTATION,
  CHANNEL_TYPE_TASK_PLUGIN,
  CHANNEL_TYPE_WARNINGS,
  ERROR_MESSAGES,
  FIELD_DESCRIPTIONS,
  FIELD_PLACEHOLDERS,
  MODEL_FETCHABLE_TYPES,
} from '@/features/channels/constants'
import {
  extractMappingSourceModels,
  extractRedirectModels,
  findExposedTargetModels,
  findMissingModelsInMapping,
  formatModelsArray,
  getChannelTypeHints,
  mergeModelMappingPairs,
  nextTaskPluginBaseUrl,
  parseModelsString,
  validateModelMappingJson,
} from '@/features/channels/lib'
import type {
  ChannelConfigurationSection,
  ChannelConfigurationStatus,
  ChannelProviderTarget,
} from '@/features/channels/lib/channel-configuration'
import { fromRequestPluginConfigDraft } from '@/features/task-plugins/lib/request-plugins'
import {
  createMyChannel,
  fetchChannelDefaultBaseURLs,
  fetchChannelModelCatalog,
  fetchUserChannelOptions,
  fetchUserChannelModels,
  updateMyChannel,
} from '@/features/token-package/api'
import { MARKETPLACE_CHANNEL_TYPES } from '@/features/token-package/marketplace-channel-types'
import type { UserChannel } from '@/features/token-package/types'
import {
  parseChannelConnectionInfo,
  type ChannelConnectionInfo,
} from '@/lib/channel-connection-info'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { handleServerError } from '@/lib/handle-server-error'
import { resolveLocalizedText } from '@/lib/localized-text'
import {
  createServerError,
  getServerErrorMessage,
  translateServerText,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  MY_CHANNELS_QUERY_KEY,
  MY_CHANNEL_BASE_URL_REQUIRED_TYPES,
  MY_CHANNEL_FORM_DEFAULT_VALUES,
  MY_CHANNEL_OTHER_REQUIRED_TYPES,
  channelTypeLabel,
  isBoundChannel,
  myChannelFormSchema,
  parseModelList,
  parseMyChannelModelMapping,
  type MyChannelFormValues,
} from '../lib'
import { useMyChannels } from './my-channels-provider'

type DiscoveryState = {
  status: 'idle' | 'loading' | 'success' | 'error' | 'stale'
  models: string[]
  error?: unknown
}

type MappingEntry = {
  source: string
  target: string
}

const MY_CHANNEL_SECTIONS: readonly ChannelConfigurationSection[] = [
  'connection',
  'routing',
]

function formFromChannel(channel: UserChannel): MyChannelFormValues {
  const settings = channel.settings || {}
  return {
    name: channel.name,
    type: channel.type,
    base_url: channel.base_url || '',
    key: '',
    openai_organization: channel.openai_organization || '',
    models: parseModelList(channel.models).join(','),
    model_mapping: channel.model_mapping || '',
    test_model: channel.test_model || '',
    other: channel.other || '',
    priority: channel.priority || 0,
    weight: channel.weight || 0,
    status: channel.status,
    task_plugin_key: channel.task_plugin_key || '',
    plugin_config: channel.plugin_config || {},
    plugin_config_draft: null,
    azure_responses_version: settings.azure_responses_version || '',
    vertex_key_type:
      settings.vertex_key_type === 'api_key' ? 'api_key' : 'json',
    vertex_project_id: settings.vertex_project_id || '',
    vertex_api_version:
      settings.vertex_api_version === 'v1beta1' ? 'v1beta1' : 'v1',
    openrouter_enterprise: settings.openrouter_enterprise === true,
    aws_key_type: settings.aws_key_type === 'api_key' ? 'api_key' : 'ak_sk',
    aws_api_type:
      settings.aws_api_type === 'mantle' ? 'mantle' : 'invoke_model',
  }
}

function parseMapping(value: string): {
  invalidJson: boolean
  entries: MappingEntry[]
} {
  if (!value.trim()) return { invalidJson: false, entries: [] }
  const validation = validateModelMappingJson(value)
  if (!validation.valid) return { invalidJson: true, entries: [] }
  try {
    const parsed = JSON.parse(value) as Record<string, string>
    return {
      invalidJson: false,
      entries: Object.entries(parsed).map(([source, target]) => ({
        source,
        target,
      })),
    }
  } catch {
    return { invalidJson: true, entries: [] }
  }
}

function formatModelNames(models: string[]): string {
  return models.map((model) => `"${model}"`).join(', ')
}

function sectionForField(field: string): ChannelConfigurationSection {
  if (
    field === 'model_mapping' ||
    field === 'priority' ||
    field === 'weight' ||
    field === 'test_model'
  ) {
    return 'routing'
  }
  return 'connection'
}

function providerTargetForChannel(
  type: number,
  pluginKey?: string | null
): ChannelProviderTarget {
  const key = pluginKey?.trim()
  if (type === CHANNEL_TYPE_TASK_PLUGIN && key) {
    return { kind: 'plugin', key }
  }
  return { kind: 'builtin', type }
}

export function MyChannelMutateDrawer() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { open, setOpen, currentRow } = useMyChannels()
  const isEditing = open === 'edit' && currentRow !== null
  const isOpen = open !== null
  const bound = isEditing && isBoundChannel(currentRow)
  const autoDisabled =
    isEditing && currentRow?.status === CHANNEL_STATUS.AUTO_DISABLED
  const [providerTarget, setProviderTarget] =
    useState<ChannelProviderTarget | null>(null)
  const [choosingProvider, setChoosingProvider] = useState(true)
  const [configurationSection, setConfigurationSection] =
    useState<ChannelConfigurationSection>('connection')
  const [pendingErrorFocus, setPendingErrorFocus] = useState<string | null>(
    null
  )
  const [discovery, setDiscovery] = useState<DiscoveryState>({
    status: 'idle',
    models: [],
  })
  const [configureModelsOpen, setConfigureModelsOpen] = useState(false)
  const [batchMappingOpen, setBatchMappingOpen] = useState(false)
  const [mappingDraftRequest, setMappingDraftRequest] =
    useState<ModelMappingDraftRequest | null>(null)
  const [clipboardConnectionInfo, setClipboardConnectionInfo] =
    useState<ChannelConnectionInfo | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [loginRequest, setLoginRequest] = useState<{
    channelId: number
    keyIndex: number | null
    add?: boolean
    plugin: TaskPluginOption
  } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const initialModelsRef = useRef<string[]>([])
  const mappingDraftTokenRef = useRef(0)
  const discoveryRequestRef = useRef(0)

  const form = useForm<MyChannelFormValues>({
    resolver: zodResolver(myChannelFormSchema),
    defaultValues: MY_CHANNEL_FORM_DEFAULT_VALUES,
  })
  const values = form.watch()
  const errors = form.formState.errors
  const currentType = values.type
  const currentModels = useMemo(
    () => parseModelsString(values.models),
    [values.models]
  )
  const mappingState = useMemo(
    () => parseMapping(values.model_mapping),
    [values.model_mapping]
  )
  const mappingCount = mappingState.entries.length
  const mappingPreviewPairs = mappingState.entries.slice(0, 4)
  const remainingMappingCount = Math.max(
    0,
    mappingState.entries.length - mappingPreviewPairs.length
  )
  const missingSourceModels = useMemo(
    () => findMissingModelsInMapping(values.model_mapping, currentModels),
    [currentModels, values.model_mapping]
  )
  const exposedTargetModels = useMemo(
    () => findExposedTargetModels(values.model_mapping, currentModels),
    [currentModels, values.model_mapping]
  )
  const upstreamAliases = useMemo(() => {
    const aliases: Record<string, string> = {}
    for (const entry of mappingState.entries) {
      aliases[entry.target] ??= entry.source
    }
    return aliases
  }, [mappingState.entries])
  const { data: modelCatalog } = useQuery({
    queryKey: ['my-channel-model-catalog'],
    queryFn: async () => {
      const response = await fetchChannelModelCatalog()
      return response.success ? (response.data ?? {}) : {}
    },
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
    meta: { errorToast: false },
  })
  const { data: defaultBaseURLs } = useQuery({
    queryKey: ['my-channel-default-base-urls'],
    queryFn: async () => {
      const response = await fetchChannelDefaultBaseURLs()
      return response.success ? (response.data ?? {}) : {}
    },
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
    meta: { errorToast: false },
  })
  const channelOptionsQuery = useQuery({
    queryKey: ['my-channel-options'],
    queryFn: async () => {
      const response = await fetchUserChannelOptions()
      if (!response.success || !response.data) {
        throw createServerError(response, t('Failed to load channel options'))
      }
      return response.data
    },
    enabled: isOpen,
    staleTime: 0,
    meta: { errorToast: false },
  })
  const availablePlugins = channelOptionsQuery.data?.plugins ?? []
  const allowedChannelTypes = [
    ...(channelOptionsQuery.data?.allowed_channel_types ??
      MARKETPLACE_CHANNEL_TYPES),
  ]
  const currentPluginKey = values.task_plugin_key.trim()
  const boundTaskPlugin =
    currentType === 61
      ? availablePlugins.find((plugin) => plugin.key === currentPluginKey)
      : undefined
  const pluginLogin = currentType === 61 && boundTaskPlugin?.login === true
  const allDefaultModels = useMemo(() => {
    const seen = new Set<string>()
    for (const models of Object.values(modelCatalog ?? {})) {
      if (!Array.isArray(models)) continue
      for (const model of models) {
        const trimmed = model.trim()
        if (trimmed) seen.add(trimmed)
      }
    }
    return [...seen]
  }, [modelCatalog])
  const defaultModels = useMemo(() => {
    const seen = new Set<string>()
    if (currentType === 61) {
      for (const model of boundTaskPlugin?.models ?? []) {
        const trimmed = model.trim()
        if (trimmed) seen.add(trimmed)
      }
      return [...seen]
    }
    const catalogModels = modelCatalog?.[String(currentType)]
    for (const model of Array.isArray(catalogModels) ? catalogModels : []) {
      const trimmed = model.trim()
      if (trimmed) seen.add(trimmed)
    }
    const models = [...seen]
    if (currentType === 1) {
      return models.filter(
        (model) =>
          model.startsWith('gpt-') ||
          model.startsWith('text-') ||
          model.startsWith('chatgpt-') ||
          /^o\d/.test(model)
      )
    }
    return models
  }, [boundTaskPlugin, currentType, modelCatalog])
  const defaultModelSet = useMemo(() => new Set(defaultModels), [defaultModels])
  const modelOptions = useMemo(() => {
    const targetBySource = new Map(
      mappingState.entries.map((entry) => [entry.source, entry.target])
    )
    const catalogModels = modelCatalog?.[String(currentType)]
    const typeDefaults = Array.isArray(catalogModels) ? catalogModels : []
    const allModels = new Set([
      ...typeDefaults,
      ...allDefaultModels,
      ...currentModels,
      ...discovery.models,
      ...mappingState.entries.flatMap((entry) => [entry.source, entry.target]),
    ])
    return [...allModels].map((model) => {
      const target = targetBySource.get(model)
      return {
        value: model,
        label: model,
        hint:
          (target
            ? t('Redirects to {{model}}', { model: target })
            : undefined) ??
          (defaultModelSet.has(model) ? t('Default model') : undefined),
      }
    })
  }, [
    allDefaultModels,
    currentModels,
    currentType,
    defaultModelSet,
    discovery.models,
    mappingState.entries,
    modelCatalog,
    t,
  ])
  const baseUrlChanged =
    isEditing &&
    currentRow !== null &&
    values.base_url.trim() !== (currentRow.base_url || '').trim()
  const canFetchModels =
    !bound &&
    (MODEL_FETCHABLE_TYPES.has(currentType) ||
      (currentType === 61 &&
        boundTaskPlugin?.provider === true &&
        (!pluginLogin || isEditing)))
  const effectiveProviderTarget: ChannelProviderTarget | null =
    providerTarget ??
    (isEditing && currentRow
      ? providerTargetForChannel(currentRow.type, currentPluginKey)
      : null)
  const showProviderPicker = !isEditing && choosingProvider
  const providerLabel =
    boundTaskPlugin?.name ||
    (currentType === 61 && currentPluginKey
      ? currentPluginKey
      : t(channelTypeLabel(currentType)))
  const providerPluginIcon =
    boundTaskPlugin ??
    (currentType === 61 && currentPluginKey
      ? { key: currentPluginKey, name: providerLabel }
      : undefined)
  const providerDescriptionKey =
    CHANNEL_PROVIDER_PRESENTATION[currentType]?.descriptionKey
  const pluginConfigSchema =
    boundTaskPlugin?.channelConfig &&
    Object.keys(boundTaskPlugin.channelConfig.properties ?? {}).length > 0
      ? boundTaskPlugin.channelConfig
      : undefined
  const pluginKeyHint = resolveLocalizedText(
    boundTaskPlugin?.keyHint,
    i18n.language
  )
  const defaultBaseURL =
    currentType === 61
      ? boundTaskPlugin?.baseUrl?.trim()
      : defaultBaseURLs?.[currentType]?.trim()
  const baseUrlRequired =
    MY_CHANNEL_BASE_URL_REQUIRED_TYPES.has(currentType) ||
    (currentType === 61 && !defaultBaseURL)
  const currentStatus = values.status
  const currentStatusLabel =
    CHANNEL_STATUS_LABELS[
      currentStatus as keyof typeof CHANNEL_STATUS_LABELS
    ] || 'Unknown'
  const typeHints = getChannelTypeHints(currentType)
  let baseUrlPlaceholder =
    defaultBaseURL || t(typeHints.baseUrl || FIELD_PLACEHOLDERS.BASE_URL)
  if (currentType === 3) {
    baseUrlPlaceholder = t('e.g., https://docs-test-001.openai.azure.com')
  } else if (currentType === 8) {
    baseUrlPlaceholder = t('e.g., https://api.openai.com/v1/chat/completions')
  } else if (currentType === 45) {
    baseUrlPlaceholder = t('https://ark.cn-beijing.volces.com')
  }
  let keyPlaceholder = t(typeHints.key || FIELD_PLACEHOLDERS.KEY)
  if (isEditing) {
    keyPlaceholder = t('Leave empty to keep existing key')
  } else if (pluginKeyHint) {
    keyPlaceholder = pluginKeyHint
  } else if (currentType === 33) {
    keyPlaceholder =
      values.aws_key_type === 'api_key'
        ? t('Enter API Key, format: APIKey|Region')
        : t('Enter key, format: AccessKey|SecretAccessKey|Region')
  } else if (currentType === 41) {
    keyPlaceholder =
      values.vertex_key_type === 'api_key'
        ? t('Enter API Key')
        : t('Service account JSON file(s)')
  }
  let otherPlaceholder = '{}'
  if (currentType === 3) {
    otherPlaceholder = t('e.g., 2025-04-01-preview')
  } else if (currentType === 39) {
    otherPlaceholder = t('e.g., d6b5da8hk1awo8nap34ube6gh')
  } else if (currentType === 41) {
    otherPlaceholder = t(
      'e.g., us-central1 or JSON format for model-specific regions'
    )
  }
  let baseUrlLabel = t('Base URL')
  if (currentType === 3) {
    baseUrlLabel = t('AZURE_OPENAI_ENDPOINT')
  } else if (currentType === 8) {
    baseUrlLabel = `${t('Full Base URL (supports')} {model} ${t('variable)')}`
  } else if (currentType === 45) {
    baseUrlLabel = t('API Base URL')
  }
  let baseUrlDescription: string = t(
    'Custom API base URL. For official channels, CodeGuys has built-in addresses. Only fill this for third-party proxy sites or special endpoints. Do not add /v1 or trailing slash.'
  )
  if (currentType === 3) {
    baseUrlDescription = t('Your Azure OpenAI endpoint URL')
  } else if (currentType === 8) {
    baseUrlDescription = `${t('Enter the complete URL, supports')} {model} ${t('variable')}`
  } else if (
    defaultBaseURL &&
    !MY_CHANNEL_BASE_URL_REQUIRED_TYPES.has(currentType)
  ) {
    baseUrlDescription = t(
      'Leave blank to use the built-in endpoint: {{url}}',
      { url: defaultBaseURL }
    )
  }
  let keyDescription = t(FIELD_DESCRIPTIONS.KEY)
  if (currentType === 61) {
    keyDescription = pluginKeyHint
      ? t('Enter the credential the plugin expects: {{format}}', {
          format: pluginKeyHint,
        })
      : t('Enter the credential required by this plugin')
  } else if (currentType === 41) {
    keyDescription =
      values.vertex_key_type === 'api_key'
        ? t('API Key mode (does not support batch creation)')
        : t('Vertex AI service account key must be valid JSON')
  } else if (currentType === 33) {
    keyDescription =
      values.aws_key_type === 'api_key'
        ? t('API Key mode: use APIKey|Region')
        : t('AK/SK mode: use AccessKey|SecretAccessKey|Region')
  } else if (isEditing) {
    keyDescription = t(
      'Enter new key to update, or leave empty to keep current key'
    )
  }

  useEffect(() => {
    if (!isOpen) {
      setProviderTarget(null)
      setChoosingProvider(true)
      setConfigurationSection('connection')
      setPendingErrorFocus(null)
      setDiscovery({ status: 'idle', models: [] })
      setConfigureModelsOpen(false)
      setBatchMappingOpen(false)
      setMappingDraftRequest(null)
      setClipboardConnectionInfo(null)
      setSubmitError('')
      initialModelsRef.current = []
      discoveryRequestRef.current += 1
      return
    }

    setLoginRequest(null)
    form.reset(
      isEditing && currentRow
        ? formFromChannel(currentRow)
        : MY_CHANNEL_FORM_DEFAULT_VALUES
    )
    setProviderTarget(
      isEditing && currentRow
        ? providerTargetForChannel(currentRow.type, currentRow.task_plugin_key)
        : null
    )
    setChoosingProvider(!isEditing)
    setConfigurationSection('connection')
    setPendingErrorFocus(null)
    setDiscovery({ status: 'idle', models: [] })
    setConfigureModelsOpen(false)
    setBatchMappingOpen(false)
    setMappingDraftRequest(null)
    setClipboardConnectionInfo(null)
    setSubmitError('')
    initialModelsRef.current =
      isEditing && currentRow ? parseModelList(currentRow.models) : []
    discoveryRequestRef.current += 1
  }, [currentRow, form, isEditing, isOpen])

  useEffect(() => {
    if (!isOpen) return
    discoveryRequestRef.current += 1
    setDiscovery((previous) => {
      if (previous.status === 'idle') return previous
      return { status: 'stale', models: previous.models }
    })
  }, [currentType, isOpen, values.base_url, values.key])

  useEffect(() => {
    if (!isOpen || isEditing || currentType !== 45) return
    if (form.getValues('base_url').trim()) return
    form.setValue('base_url', 'https://ark.cn-beijing.volces.com', {
      shouldDirty: false,
      shouldValidate: true,
    })
  }, [currentType, form, isEditing, isOpen])

  useEffect(() => {
    if (!isOpen || isEditing || choosingProvider) {
      setClipboardConnectionInfo(null)
      return
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      return
    }

    let cancelled = false
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (!cancelled) {
          setClipboardConnectionInfo(parseChannelConnectionInfo(text))
        }
      })
      .catch(() => {
        /* Clipboard detection is best-effort on drawer open. */
      })

    return () => {
      cancelled = true
    }
  }, [choosingProvider, isEditing, isOpen])

  useEffect(() => {
    if (!pendingErrorFocus || showProviderPicker) return
    const frame = window.requestAnimationFrame(() => {
      const panel = formRef.current?.querySelector(
        '[role="tabpanel"]:not([hidden])'
      )
      const invalid = panel?.querySelector<HTMLElement>('[aria-invalid="true"]')
      invalid?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      invalid?.focus({ preventScroll: true })
      setPendingErrorFocus(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [configurationSection, pendingErrorFocus, showProviderPicker])

  const updateModels = (models: string[]) => {
    form.setValue('models', formatModelsArray(models), {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const handleModelsChange = (models: string[]) => {
    updateModels(models)
  }

  const applyConnectionInfo = (connectionInfo: ChannelConnectionInfo) => {
    form.setValue('key', connectionInfo.key, {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.setValue('base_url', connectionInfo.url, {
      shouldDirty: true,
      shouldValidate: true,
    })
    setClipboardConnectionInfo(null)
    toast.success(t('Connection info filled in'))
  }

  const pasteConnectionInfoFromClipboard = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      toast.error(t('Unable to read clipboard'))
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      const parsed = parseChannelConnectionInfo(text)
      if (parsed) {
        applyConnectionInfo(parsed)
        return
      }
      toast.info(t('No connection info found in clipboard'))
    } catch {
      toast.error(t('Unable to read clipboard'))
    }
  }

  const selectProvider = (target: ChannelProviderTarget) => {
    const plugin =
      target.kind === 'plugin'
        ? availablePlugins.find((item) => item.key === target.key)
        : undefined
    if (target.kind === 'plugin' && !plugin) {
      return
    }
    if (
      target.kind === 'builtin' &&
      !allowedChannelTypes.includes(target.type)
    ) {
      return
    }
    const nextType =
      target.kind === 'plugin' ? CHANNEL_TYPE_TASK_PLUGIN : target.type
    if (
      (providerTarget?.kind === 'builtin' &&
        target.kind === 'builtin' &&
        providerTarget.type === target.type) ||
      (providerTarget?.kind === 'plugin' &&
        target.kind === 'plugin' &&
        providerTarget.key === target.key)
    ) {
      setChoosingProvider(false)
      return
    }
    const previousType = form.getValues('type')
    const previousPluginKey = form.getValues('task_plugin_key')
    const previousPlugin = availablePlugins.find(
      (item) => item.key === previousPluginKey
    )
    const providerChanged =
      previousType !== nextType ||
      (target.kind === 'plugin' && previousPluginKey !== target.key)
    if (!isEditing && providerChanged) {
      form.setValue('base_url', '', { shouldDirty: true })
      form.setValue('key', '', { shouldDirty: true })
      form.setValue('models', '', { shouldDirty: true })
      form.setValue('model_mapping', '', { shouldDirty: true })
      form.setValue('test_model', '', { shouldDirty: true })
    }
    form.setValue('type', nextType, {
      shouldDirty: true,
      shouldValidate: true,
    })
    form.setValue('task_plugin_key', plugin?.key ?? '', {
      shouldDirty: true,
    })
    form.setValue('plugin_config', {}, { shouldDirty: true })
    form.setValue('plugin_config_draft', null, { shouldDirty: true })
    form.setValue('other', '', { shouldDirty: true })
    form.setValue('openai_organization', '', { shouldDirty: true })
    form.setValue(
      'azure_responses_version',
      MY_CHANNEL_FORM_DEFAULT_VALUES.azure_responses_version,
      { shouldDirty: true }
    )
    form.setValue(
      'vertex_key_type',
      MY_CHANNEL_FORM_DEFAULT_VALUES.vertex_key_type,
      { shouldDirty: true }
    )
    form.setValue(
      'vertex_project_id',
      MY_CHANNEL_FORM_DEFAULT_VALUES.vertex_project_id,
      { shouldDirty: true }
    )
    form.setValue(
      'vertex_api_version',
      MY_CHANNEL_FORM_DEFAULT_VALUES.vertex_api_version,
      { shouldDirty: true }
    )
    form.setValue(
      'openrouter_enterprise',
      MY_CHANNEL_FORM_DEFAULT_VALUES.openrouter_enterprise,
      { shouldDirty: true }
    )
    form.setValue('aws_key_type', MY_CHANNEL_FORM_DEFAULT_VALUES.aws_key_type, {
      shouldDirty: true,
    })
    form.setValue('aws_api_type', MY_CHANNEL_FORM_DEFAULT_VALUES.aws_api_type, {
      shouldDirty: true,
    })
    if (plugin) {
      if (!isEditing) {
        const currentBaseURL = form.getValues('base_url')
        const nextBaseURL = nextTaskPluginBaseUrl(
          currentBaseURL,
          previousPlugin?.baseUrl,
          plugin.baseUrl
        )
        if (nextBaseURL !== null) {
          form.setValue('base_url', nextBaseURL, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
        if (plugin.models.length > 0) {
          form.setValue('models', formatModelsArray(plugin.models), {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
      }
    }
    if (!isEditing) {
      const name = form.getValues('name').trim()
      const previousName =
        previousPlugin?.name || t(channelTypeLabel(previousType))
      if (!name || name === previousName) {
        form.setValue('name', plugin?.name || t(channelTypeLabel(nextType)))
      }
    }
    setProviderTarget(target)
    setChoosingProvider(false)
    setConfigurationSection('connection')
  }

  const fetchModels = async () => {
    if (!canFetchModels) {
      toast.info(t('This channel type does not support fetching models'))
      return
    }
    if (!values.key.trim() && (!isEditing || baseUrlChanged)) {
      form.setError('key', {
        type: 'manual',
        message: t(ERROR_MESSAGES.REQUIRED_KEY),
      })
      setConfigurationSection('connection')
      setPendingErrorFocus('key')
      return
    }

    const requestId = ++discoveryRequestRef.current
    setDiscovery((previous) => ({
      status: 'loading',
      models: previous.models,
    }))
    try {
      let pluginConfig = values.plugin_config
      if (
        currentType === 61 &&
        pluginConfigSchema &&
        values.plugin_config_draft
      ) {
        const parsed = fromRequestPluginConfigDraft(
          pluginConfigSchema,
          values.plugin_config_draft
        )
        if (Object.keys(parsed.errors).length === 0) {
          pluginConfig = parsed.config
        }
      }
      const response = await fetchUserChannelModels({
        channelId: isEditing ? currentRow?.id : undefined,
        type: currentType,
        baseURL: values.base_url.trim(),
        key: values.key.trim(),
        taskPluginKey:
          currentType === 61 ? values.task_plugin_key.trim() : undefined,
        pluginConfig,
      })
      if (requestId !== discoveryRequestRef.current) return
      if (!response.success) {
        throw createServerError(response, t('Failed to fetch models'))
      }
      setDiscovery({
        status: 'success',
        models: response.data || [],
      })
    } catch (error) {
      if (requestId !== discoveryRequestRef.current) return
      setDiscovery({
        status: 'error',
        models: [],
        error,
      })
    }
  }

  const raiseMappingDraft = (
    from: string,
    to: string,
    focus?: 'from' | 'to'
  ) => {
    mappingDraftTokenRef.current += 1
    setMappingDraftRequest({
      from,
      to,
      focus,
      token: mappingDraftTokenRef.current,
    })
  }

  const requestMappingDraft = (model: string) => {
    setConfigurationSection('routing')
    raiseMappingDraft('', model, 'from')
  }

  const handleBatchMappingApply = (result: ModelMappingBatchResult) => {
    const current = form.getValues('model_mapping')
    const merged = mergeModelMappingPairs(current, result.pairs)
    if (merged === null) {
      form.setError('model_mapping', {
        type: 'manual',
        message: t('Model mapping must be a valid JSON object'),
      })
      return
    }
    form.setValue('model_mapping', merged, {
      shouldDirty: true,
      shouldValidate: true,
    })
    if (result.syncModels) {
      const requestNames = new Set(result.pairs.map((pair) => pair.from))
      const upstreamNames = new Set(result.pairs.map((pair) => pair.to))
      updateModels([
        ...currentModels.filter((model) => !upstreamNames.has(model)),
        ...requestNames,
      ])
    }
  }

  const copyModels = async () => {
    if (!values.models.trim()) {
      toast.info(t('No models to copy'))
      return
    }
    const copied = await copyToClipboard(values.models)
    if (copied) {
      toast.success(t('Copied'))
    } else {
      toast.error(t('Failed to copy'))
    }
  }

  const clearModels = () => {
    updateModels([])
    toast.success(t('Cleared all models'))
  }

  const fillRelatedModels = () => {
    if (!defaultModels.length) {
      toast.info(t('No related models available for this channel type'))
      return
    }
    updateModels(defaultModels)
    toast.success(
      t('Filled {{count}} related model(s)', {
        count: defaultModels.length,
      })
    )
  }

  const onInvalid: SubmitErrorHandler<MyChannelFormValues> = (formErrors) => {
    const field = Object.keys(formErrors)[0]
    if (field) {
      setConfigurationSection(sectionForField(field))
      setPendingErrorFocus(field)
    }
    toast.error(t('Please fix the highlighted fields before saving'))
  }

  const submit = async (data: MyChannelFormValues) => {
    setSubmitError('')
    if (!isEditing && !pluginLogin && !data.key.trim()) {
      form.setError('key', {
        type: 'manual',
        message: t(ERROR_MESSAGES.REQUIRED_KEY),
      })
      setConfigurationSection('connection')
      setPendingErrorFocus('key')
      return
    }
    if (baseUrlRequired && !data.base_url.trim()) {
      form.setError('base_url', {
        type: 'manual',
        message: t('Base URL is required for this channel type'),
      })
      setConfigurationSection('connection')
      setPendingErrorFocus('base_url')
      return
    }
    const mapping = parseMyChannelModelMapping(data.model_mapping)
    if (mapping === null) {
      form.setError('model_mapping', {
        type: 'manual',
        message: t('Model mapping must be a valid JSON object'),
      })
      setConfigurationSection('routing')
      setPendingErrorFocus('model_mapping')
      return
    }
    let pluginConfig = data.plugin_config
    if (data.type === 61 && pluginConfigSchema && data.plugin_config_draft) {
      const parsed = fromRequestPluginConfigDraft(
        pluginConfigSchema,
        data.plugin_config_draft
      )
      if (Object.keys(parsed.errors).length > 0) {
        setConfigurationSection('connection')
        toast.error(t('Please fix the highlighted fields before saving'))
        return
      }
      pluginConfig = parsed.config
    }

    const payload: Record<string, unknown> = {
      name: data.name.trim(),
      test_model: data.test_model.trim(),
      priority: Math.trunc(Number(data.priority) || 0),
      weight: Math.max(0, Math.trunc(Number(data.weight) || 0)),
    }
    if (!isEditing) {
      payload.type = data.type
    }
    if (!bound) {
      payload.base_url = data.base_url.trim()
      payload.openai_organization = data.openai_organization.trim()
      payload.models = parseModelsString(data.models)
      payload.model_mapping = mapping
      payload.other = data.other.trim()
      if (data.type === 61) {
        payload.task_plugin_key = data.task_plugin_key.trim()
        if (
          !isEditing ||
          form.formState.dirtyFields.plugin_config ||
          data.plugin_config_draft
        ) {
          payload.plugin_config = pluginConfig
        }
      }
      payload.settings = {
        azure_responses_version: data.azure_responses_version.trim(),
        vertex_key_type: data.vertex_key_type,
        vertex_project_id: data.vertex_project_id.trim(),
        vertex_api_version: data.vertex_api_version,
        openrouter_enterprise: data.openrouter_enterprise,
        aws_key_type: data.aws_key_type,
        aws_api_type: data.aws_api_type,
      }
    }
    if (!pluginLogin && data.key.trim()) {
      payload.key = data.key.trim()
    }
    if (isEditing && !autoDisabled) {
      payload.status =
        data.status === CHANNEL_STATUS.ENABLED
          ? CHANNEL_STATUS.ENABLED
          : CHANNEL_STATUS.MANUAL_DISABLED
    }

    setSubmitting(true)
    try {
      const response = isEditing
        ? await updateMyChannel(currentRow.id, payload)
        : await createMyChannel(payload)
      if (!response.success) {
        const error = createServerError(
          response,
          isEditing
            ? t('The channel could not be updated')
            : t('The channel could not be created')
        )
        setSubmitError(getServerErrorMessage(error))
        handleServerError(error)
        return
      }
      toast.success(
        isEditing
          ? t('Channel updated successfully')
          : t('Channel created successfully')
      )
      await queryClient.invalidateQueries({ queryKey: MY_CHANNELS_QUERY_KEY })
      if (!isEditing && pluginLogin && response.data && boundTaskPlugin) {
        setLoginRequest({
          channelId: response.data.id,
          keyIndex: null,
          plugin: boundTaskPlugin,
        })
      }
      setOpen(null)
    } catch (error) {
      setSubmitError(
        getServerErrorMessage(
          error,
          isEditing
            ? t('The channel could not be updated')
            : t('The channel could not be created')
        )
      )
      handleServerError(
        error,
        isEditing
          ? t('The channel could not be updated')
          : t('The channel could not be created')
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) {
      setOpen(null)
    }
  }

  let connectionStatus: ChannelConfigurationStatus = 'idle'
  if (
    errors.name ||
    errors.type ||
    errors.task_plugin_key ||
    errors.base_url ||
    errors.key ||
    errors.models ||
    (MY_CHANNEL_OTHER_REQUIRED_TYPES.has(currentType) && errors.other)
  ) {
    connectionStatus = 'error'
  } else if (
    values.name.trim() &&
    values.models.trim() &&
    (isEditing || pluginLogin || values.key.trim()) &&
    (currentType !== 61 || Boolean(values.task_plugin_key.trim())) &&
    (!baseUrlRequired || values.base_url.trim())
  ) {
    connectionStatus = 'ready'
  }
  let modelMappingStatus: ChannelConfigurationStatus = 'idle'
  if (errors.model_mapping) {
    modelMappingStatus = 'error'
  } else if (mappingCount > 0) {
    modelMappingStatus = 'configured'
  }
  let routingStrategyStatus: ChannelConfigurationStatus = 'idle'
  if (errors.priority || errors.weight || errors.test_model) {
    routingStrategyStatus = 'error'
  } else if (values.priority || values.weight || values.test_model.trim()) {
    routingStrategyStatus = 'configured'
  }
  let routingStatus: ChannelConfigurationStatus = 'idle'
  if (modelMappingStatus === 'error' || routingStrategyStatus === 'error') {
    routingStatus = 'error'
  } else if (
    modelMappingStatus === 'configured' ||
    routingStrategyStatus === 'configured'
  ) {
    routingStatus = 'configured'
  }
  const statuses: Record<
    ChannelConfigurationSection,
    ChannelConfigurationStatus
  > = {
    connection: connectionStatus,
    routing: routingStatus,
    request: 'idle',
    other: 'idle',
  }
  let drawerDescription = t(
    'Configure the connection and models, then create the channel.'
  )
  if (showProviderPicker && effectiveProviderTarget) {
    drawerDescription = `${t('Current:')} ${providerLabel}`
  } else if (boundTaskPlugin?.description) {
    drawerDescription = resolveLocalizedText(
      boundTaskPlugin.description,
      i18n.language
    )
  } else if (providerDescriptionKey) {
    drawerDescription = t(providerDescriptionKey)
  } else if (isEditing) {
    drawerDescription = t(
      "Update channel configuration and click save when you're done."
    )
  } else if (showProviderPicker) {
    drawerDescription = t('Choose a provider to configure your channel.')
  }
  let submitLabel = t('Create Channel')
  if (pluginLogin) {
    submitLabel = t('Save and log in')
  }
  if (isEditing) {
    submitLabel = t('Update Channel')
  }

  const basicSection = (
    <div className='scroll-mt-4'>
      <ChannelBasicSection>
        <div className='grid gap-4'>
          <FormField
            control={form.control}
            name='name'
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Name')}</FormLabel>
                <FormControl>
                  <Input placeholder={t(FIELD_PLACEHOLDERS.NAME)} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {currentType === 1 && (
            <FormField
              control={form.control}
              name='openai_organization'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('OpenAI Organization')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('org-...')} {...field} />
                  </FormControl>
                  <FormDescription>
                    {t(FIELD_DESCRIPTIONS.OPENAI_ORG)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {isEditing && (
          <FormField
            control={form.control}
            name='status'
            render={({ field }) => (
              <FormItem className={sideDrawerSwitchItemClassName()}>
                <div className='flex flex-col gap-0.5'>
                  <FormLabel>{t('Enabled')}</FormLabel>
                  <FormDescription className='text-xs'>
                    {autoDisabled
                      ? t(
                          'The channel was disabled automatically and cannot be enabled here'
                        )
                      : t('Enable or disable this channel')}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value === CHANNEL_STATUS.ENABLED}
                    disabled={autoDisabled || submitting}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? CHANNEL_STATUS.ENABLED
                          : CHANNEL_STATUS.MANUAL_DISABLED
                      )
                    }
                  />
                </FormControl>
              </FormItem>
            )}
          />
        )}
      </ChannelBasicSection>
    </div>
  )

  const connectionSection = (
    <div className='scroll-mt-4'>
      <ChannelApiAccessSection>
        {CHANNEL_TYPE_WARNINGS[currentType] && (
          <Alert>
            <AlertDescription>
              {t(CHANNEL_TYPE_WARNINGS[currentType])}
            </AlertDescription>
          </Alert>
        )}

        <div className='border-border/60 bg-muted/10 rounded-lg border p-4'>
          <fieldset
            disabled={bound || submitting}
            className='space-y-4 disabled:opacity-60'
          >
            {currentType === 3 && (
              <>
                <FormField
                  control={form.control}
                  name='base_url'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>
                        {t('AZURE_OPENAI_ENDPOINT')}
                      </FormLabel>
                      <FormControl>
                        <Input placeholder={baseUrlPlaceholder} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t('Your Azure OpenAI endpoint URL')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='other'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('Default API Version')}</FormLabel>
                      <FormControl>
                        <Input placeholder={otherPlaceholder} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t('Default API version for this channel')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='azure_responses_version'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Responses API Version')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('e.g., preview')} {...field} />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Default Responses API version, if empty, will use the API version above'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {currentType === 8 && (
              <FormField
                control={form.control}
                name='base_url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      {t('Full Base URL (supports')} {'{'}
                      {t('model')}
                      {'}'} {t('variable)')}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder={baseUrlPlaceholder} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('Enter the complete URL, supports')} {'{'}
                      {t('model')}
                      {'}'} {t('variable')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {currentType === 20 && (
              <FormField
                control={form.control}
                name='openrouter_enterprise'
                render={({ field }) => (
                  <FormItem className={sideDrawerSwitchItemClassName()}>
                    <div className='space-y-0.5'>
                      <FormLabel>{t('Enterprise Account')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Enable if this is an OpenRouter enterprise account with special response format'
                        )}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {currentType === 33 && (
              <>
                <FormField
                  control={form.control}
                  name='aws_api_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('AWS API')}</FormLabel>
                      <Select
                        items={[
                          {
                            value: 'invoke_model',
                            label: t('InvokeModel (legacy)'),
                          },
                          {
                            value: 'mantle',
                            label: t('Mantle (Messages API)'),
                          },
                        ]}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            <SelectItem value='invoke_model'>
                              {t('InvokeModel (legacy)')}
                            </SelectItem>
                            <SelectItem value='mantle'>
                              {t('Mantle (Messages API)')}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {t(
                          'Use Mantle for supported Claude models and automatic prompt caching. Keep InvokeModel for older models and Amazon Nova.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='aws_key_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('AWS Key Format')}</FormLabel>
                      <Select
                        items={[
                          {
                            value: 'ak_sk',
                            label: t('AccessKey / SecretAccessKey'),
                          },
                          { value: 'api_key', label: t('API Key') },
                        ]}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('Select key format')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            <SelectItem value='ak_sk'>
                              {t('AccessKey / SecretAccessKey')}
                            </SelectItem>
                            <SelectItem value='api_key'>
                              {t('API Key')}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {field.value === 'api_key'
                          ? t('API Key mode: use APIKey|Region')
                          : t(
                              'AK/SK mode: use AccessKey|SecretAccessKey|Region'
                            )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {currentType === 39 && (
              <FormField
                control={form.control}
                name='other'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('Account ID')}</FormLabel>
                    <FormControl>
                      <Input placeholder={otherPlaceholder} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('Your Cloudflare Account ID')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {currentType === 40 && (
              <Alert>
                <AlertDescription>
                  {t('Referral link:')}{' '}
                  <a
                    href='https://cloud.siliconflow.cn/i/hij0YNTZ'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='text-primary underline'
                  >
                    {t('https://cloud.siliconflow.cn/i/hij0YNTZ')}
                  </a>
                </AlertDescription>
              </Alert>
            )}

            {currentType === 41 && (
              <>
                <FormField
                  control={form.control}
                  name='vertex_key_type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Vertex AI Key Format')}</FormLabel>
                      <Select
                        items={[
                          { value: 'json', label: t('JSON') },
                          { value: 'api_key', label: t('API Key') },
                        ]}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            <SelectItem value='json'>{t('JSON')}</SelectItem>
                            <SelectItem value='api_key'>
                              {t('API Key')}
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {field.value === 'json'
                          ? t('JSON format supports service account JSON files')
                          : t('API Key mode (does not support batch creation)')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='vertex_api_version'
                  render={({ field }) => (
                    <FormItem className={sideDrawerSwitchItemClassName()}>
                      <div className='space-y-0.5'>
                        <FormLabel>
                          {t('Use Vertex AI v1beta1 endpoint')}
                        </FormLabel>
                        <FormDescription>
                          {t(
                            'Switches Gemini and Imagen requests on this Vertex channel from v1 to v1beta1. Some features require v1beta1; check the Vertex AI documentation.'
                          )}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value === 'v1beta1'}
                          onCheckedChange={(checked) =>
                            field.onChange(checked ? 'v1beta1' : 'v1')
                          }
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {values.vertex_key_type === 'api_key' && (
                  <FormField
                    control={form.control}
                    name='vertex_project_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Vertex AI Project ID')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('e.g., my-project-123')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Optional. Without it, Google picks the region; with it, requests go to the deployment region below.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name='other'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('Deployment Region')}</FormLabel>
                      <FormControl>
                        <Textarea
                          className='min-h-24 font-mono'
                          placeholder={otherPlaceholder}
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Enter deployment region or JSON mapping:')} {'{'}
                        {t(
                          '"default": "us-central1", "claude-3-5-sonnet-20240620": "europe-west1"'
                        )}
                        {'}'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {currentType === 45 && (
              <FormField
                control={form.control}
                name='base_url'
                render={({ field }) => {
                  const defaultBaseUrls = [
                    {
                      value: 'https://ark.cn-beijing.volces.com',
                      label: t('https://ark.cn-beijing.volces.com'),
                    },
                    {
                      value: 'https://ark.ap-southeast.bytepluses.com',
                      label: t('https://ark.ap-southeast.bytepluses.com'),
                    },
                  ]
                  const items =
                    field.value &&
                    !defaultBaseUrls.some((item) => item.value === field.value)
                      ? [
                          ...defaultBaseUrls,
                          { value: field.value, label: field.value },
                        ]
                      : defaultBaseUrls
                  return (
                    <FormItem>
                      <FormLabel required>{t('API Base URL')}</FormLabel>
                      <Select
                        items={items}
                        onValueChange={field.onChange}
                        value={
                          field.value || 'https://ark.cn-beijing.volces.com'
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {items.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {t('Select the API endpoint region')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
            )}

            {![3, 8, 45].includes(currentType) && (
              <FormField
                control={form.control}
                name='base_url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required={baseUrlRequired}>
                      {baseUrlLabel}
                    </FormLabel>
                    <FormControl>
                      <Input placeholder={baseUrlPlaceholder} {...field} />
                    </FormControl>
                    <FormDescription>{baseUrlDescription}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {pluginLogin ? (
              <PluginCredentialPanel
                channelId={isEditing ? (currentRow?.id ?? null) : null}
                multiKey={false}
                disabled={bound || submitting}
                scope='seller'
                onLogin={(keyIndex, add) => {
                  if (!isEditing || !currentRow || !boundTaskPlugin) return
                  setLoginRequest({
                    channelId: currentRow.id,
                    keyIndex,
                    add,
                    plugin: boundTaskPlugin,
                  })
                }}
              />
            ) : (
              <FormField
                control={form.control}
                name='key'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required={!isEditing}>{t('API Key')}</FormLabel>
                    <FormControl>
                      <Textarea
                        className='min-h-20 font-mono'
                        placeholder={keyPlaceholder}
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    {currentType === 41 &&
                      values.vertex_key_type === 'json' && (
                        <div className='mt-3 space-y-2'>
                          <Input
                            type='file'
                            accept='.json,application/json'
                            onChange={async (event) => {
                              const file = event.target.files?.[0]
                              event.target.value = ''
                              if (!file) return
                              try {
                                const parsed: unknown = JSON.parse(
                                  await file.text()
                                )
                                if (
                                  !parsed ||
                                  typeof parsed !== 'object' ||
                                  Array.isArray(parsed)
                                ) {
                                  throw new Error(
                                    'Invalid service account JSON'
                                  )
                                }
                                form.setValue('key', JSON.stringify(parsed), {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                                toast.success(
                                  t(
                                    'Parsed {{count}} service account file(s)',
                                    {
                                      count: 1,
                                    }
                                  )
                                )
                              } catch {
                                toast.error(
                                  t('Failed to parse JSON file: {{name}}', {
                                    name: file.name,
                                  })
                                )
                              }
                            }}
                          />
                          <FormDescription>
                            {t('Upload a single service account JSON file')}
                          </FormDescription>
                        </div>
                      )}
                    <FormDescription>{keyDescription}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {currentType === 61 &&
              pluginConfigSchema &&
              values.task_plugin_key && (
                <div
                  role='group'
                  aria-label={t('Plugin settings')}
                  className='space-y-3'
                >
                  <ChannelConfigurationSubHeading
                    title={t('Plugin settings')}
                    icon={<Puzzle />}
                    iconTone='info'
                  />
                  <ChannelPluginConfigFields
                    pluginKey={values.task_plugin_key}
                    schema={pluginConfigSchema}
                    models={currentModels}
                    disabled={bound || submitting}
                  />
                </div>
              )}
          </fieldset>
        </div>
      </ChannelApiAccessSection>
    </div>
  )

  const modelsSection = (
    <div className='scroll-mt-4'>
      <ChannelModelsSection
        title={t('Models')}
        description={t('Published models and model redirects.')}
      >
        <div className='space-y-5'>
          <div className='border-border/60 bg-muted/10 rounded-lg border p-4'>
            <FormField
              control={form.control}
              name='models'
              render={({ field }) => (
                <FormItem
                  role='group'
                  aria-label={t('Models')}
                  className='space-y-3'
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0 space-y-1'>
                      <FormLabel required>{t('Models')}</FormLabel>
                      <FormDescription>
                        {t(FIELD_DESCRIPTIONS.MODELS)}
                      </FormDescription>
                    </div>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => setConfigureModelsOpen(true)}
                      disabled={
                        bound || submitting || currentModels.length === 0
                      }
                    >
                      <Settings className='mr-2 h-4 w-4' aria-hidden='true' />
                      {t('Configure Models')}
                    </Button>
                  </div>
                  <FormControl>
                    <MultiSelect
                      options={modelOptions}
                      selected={field.value ? currentModels : []}
                      onChange={handleModelsChange}
                      placeholder={t('Select models or add custom ones')}
                      allowCreate
                      createLabel='Add custom model "{{value}}"'
                      maxVisibleChips={8}
                      disabled={bound || submitting}
                      copyChipOnClick
                    />
                  </FormControl>
                  <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                    <Route className='size-3.5 shrink-0' aria-hidden='true' />
                    {mappingCount > 0 && (
                      <span>
                        {t('{{count}} model(s) redirected', {
                          count: mappingCount,
                        })}
                      </span>
                    )}
                    <Button
                      type='button'
                      variant='link'
                      size='sm'
                      className='h-auto p-0 text-xs'
                      onClick={() => setConfigurationSection('routing')}
                    >
                      {mappingCount > 0
                        ? t('Edit mapping')
                        : t('Set up model redirects')}
                    </Button>
                  </div>
                  {exposedTargetModels.length > 0 && (
                    <Alert variant='warning'>
                      <AlertDescription className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                        <span>
                          {t('The mapped upstream model(s)')}{' '}
                          {formatModelNames(exposedTargetModels)}{' '}
                          {t(
                            'are also listed here. Remove them from Models to keep the `/v1/models` response user-friendly and hide vendor-specific names.'
                          )}
                        </span>
                        <div className='flex shrink-0 flex-wrap gap-2'>
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() =>
                              updateModels(
                                currentModels.filter(
                                  (model) =>
                                    !exposedTargetModels.includes(model)
                                )
                              )
                            }
                          >
                            {t('Remove mapped targets')}
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => setConfigurationSection('routing')}
                          >
                            {t('View mapping')}
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {canFetchModels && (
              <div aria-live='polite' className='mt-4 space-y-3'>
                {discovery.status === 'loading' && (
                  <LoadingState
                    className='min-h-0 py-4'
                    message={t('Fetching models...')}
                  />
                )}
                {discovery.status === 'error' && (
                  <ErrorState
                    className='min-h-0 p-3'
                    title={t('Failed to fetch models')}
                    description={getServerErrorMessage(
                      discovery.error,
                      t('Failed to fetch models')
                    )}
                    onRetry={() => {
                      void fetchModels()
                    }}
                  />
                )}
                {discovery.status === 'stale' && (
                  <Alert>
                    <AlertDescription className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                      <span>
                        {t(
                          'Connection settings changed. Fetch models again to refresh the list.'
                        )}
                      </span>
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() => void fetchModels()}
                      >
                        {t('Fetch Models')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {discovery.status === 'success' &&
                  discovery.models.length === 0 && (
                    <EmptyState
                      className='min-h-0 p-3'
                      title={t('No models returned by the upstream')}
                      description={t(
                        'You can add models manually or try fetching again.'
                      )}
                      action={
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => void fetchModels()}
                        >
                          {t('Retry')}
                        </Button>
                      }
                    />
                  )}
                {discovery.status === 'success' &&
                  discovery.models.length > 0 && (
                    <UpstreamModelSelection
                      models={discovery.models}
                      selected={currentModels}
                      existingModels={
                        isEditing ? initialModelsRef.current : currentModels
                      }
                      onChange={handleModelsChange}
                      showChanges={isEditing}
                      redirectModels={extractRedirectModels(
                        values.model_mapping
                      )}
                      redirectSourceModels={extractMappingSourceModels(
                        values.model_mapping
                      )}
                      onRedirectModel={requestMappingDraft}
                      aliases={upstreamAliases}
                    />
                  )}
              </div>
            )}

            <Separator className='my-4' />
            <div className='space-y-3'>
              <div>
                <p className='text-sm font-medium'>{t('Quick actions')}</p>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Use presets or upstream discovery to populate the model list faster.'
                  )}
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={fillRelatedModels}
                  disabled={bound || submitting || defaultModels.length === 0}
                >
                  <FileText className='mr-2 h-4 w-4' aria-hidden='true' />
                  {t('Fill Related Models')}
                </Button>
                {canFetchModels && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => void fetchModels()}
                    disabled={
                      bound || submitting || discovery.status === 'loading'
                    }
                  >
                    <Sparkles className='mr-2 h-4 w-4' aria-hidden='true' />
                    {t('Fetch from Upstream')}
                  </Button>
                )}
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => void copyModels()}
                  disabled={currentModels.length === 0}
                >
                  <Copy className='mr-2 h-4 w-4' aria-hidden='true' />
                  {t('Copy All')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={clearModels}
                  disabled={bound || currentModels.length === 0}
                >
                  <Eraser className='mr-2 h-4 w-4' aria-hidden='true' />
                  {t('Clear All')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </ChannelModelsSection>
    </div>
  )

  const routingSection = (
    <div className='space-y-5'>
      <div
        role='group'
        aria-label={t('Model Mapping')}
        className={channelConfigurationBlockClassName(modelMappingStatus)}
      >
        <FormField
          control={form.control}
          name='model_mapping'
          render={({ field }) => (
            <FormItem className='space-y-3'>
              <div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <FormLabel className='mb-0'>{t('Model Mapping')}</FormLabel>
                    <ChannelConfigurationStatusIndicator
                      status={modelMappingStatus}
                    />
                    <LearnMore
                      triggerProps={{
                        type: 'button',
                        'aria-label': t('How model mapping works'),
                        className: 'size-4 rounded-full',
                      }}
                      contentProps={{
                        collisionPadding: 16,
                        className:
                          'w-96 max-w-[calc(100vw-2rem)] gap-3 p-4 text-sm leading-6',
                      }}
                    >
                      <PopoverTitle className='text-foreground'>
                        {t('Request flow')}
                      </PopoverTitle>
                      <div className='space-y-2 font-mono'>
                        {mappingPreviewPairs.map((pair) => (
                          <div
                            key={`${pair.source}-${pair.target}`}
                            className='grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3'
                          >
                            <span className='min-w-0 wrap-anywhere'>
                              {pair.source}
                            </span>
                            <ArrowRight
                              className='mt-1 size-4 shrink-0'
                              aria-hidden='true'
                            />
                            <span className='min-w-0 wrap-anywhere'>
                              {pair.target}
                            </span>
                          </div>
                        ))}
                        {remainingMappingCount > 0 && (
                          <div>
                            {t('{{count}} more mapping(s)', {
                              count: remainingMappingCount,
                            })}
                          </div>
                        )}
                      </div>
                      <PopoverDescription className='leading-6'>
                        {t(
                          'Users call the model on the left. The platform forwards the request to the upstream model on the right.'
                        )}
                      </PopoverDescription>
                    </LearnMore>
                  </div>
                  <FormDescription>
                    {t(FIELD_DESCRIPTIONS.MODEL_MAPPING)}
                  </FormDescription>
                </div>
              </div>
              <FormControl>
                <ModelMappingEditor
                  value={field.value || ''}
                  onChange={field.onChange}
                  disabled={bound || submitting}
                  sourceModelOptions={currentModels}
                  targetModelOptions={modelOptions.map(
                    (option) => option.value
                  )}
                  onBatchAdd={
                    bound || submitting
                      ? undefined
                      : () => setBatchMappingOpen(true)
                  }
                  draftRequest={mappingDraftRequest}
                  onDraftRequestHandled={() => setMappingDraftRequest(null)}
                />
              </FormControl>
              {mappingState.invalidJson && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t('Model Mapping must be a JSON object like')}{' '}
                    <code className='font-mono'>
                      {'{"gpt-4":"Azure-GPT4"}'}
                    </code>
                    {t('. Please fix the JSON before saving.')}
                  </AlertDescription>
                </Alert>
              )}
              {missingSourceModels.length > 0 && (
                <Alert variant='warning'>
                  <AlertDescription className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                    <span>
                      {t('Add')} {formatModelNames(missingSourceModels)}{' '}
                      {t(
                        'to the Models list so users can use them before the mapping sends traffic upstream.'
                      )}
                    </span>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={bound || submitting}
                      onClick={() =>
                        updateModels([...currentModels, ...missingSourceModels])
                      }
                    >
                      {t('Add missing models')}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => setConfigurationSection('connection')}
                    >
                      {t('View models')}
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div
        role='group'
        aria-label={t('Routing Strategy')}
        className={channelConfigurationBlockClassName(
          routingStrategyStatus,
          'flex flex-col gap-4'
        )}
      >
        <ChannelConfigurationSubHeading
          title={t('Routing Strategy')}
          status={routingStrategyStatus}
          icon={<Route className='h-3.5 w-3.5' />}
          iconTone='info'
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='priority'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Priority')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    placeholder='0'
                    {...field}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(FIELD_DESCRIPTIONS.PRIORITY)}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='weight'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Weight')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    placeholder='0'
                    {...field}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(FIELD_DESCRIPTIONS.WEIGHT)}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div>
          <FormField
            control={form.control}
            name='test_model'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Test Model')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t(FIELD_PLACEHOLDERS.TEST_MODEL)}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(FIELD_DESCRIPTIONS.TEST_MODEL)}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  )

  return (
    <>
      <Sheet open={isOpen} onOpenChange={handleOpenChange}>
        <SheetContent
          side='right'
          className={sideDrawerContentClassName('sm:max-w-7xl')}
        >
          <SheetHeader className={sideDrawerHeaderClassName('pr-12 sm:pr-14')}>
            <div className='flex flex-col gap-2'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <div className='flex min-w-0 items-center gap-2 sm:gap-3'>
                  <SheetTitle className='flex shrink-0 items-center gap-2 sm:gap-3'>
                    <IconBadge tone='info' size='title'>
                      <Server className='size-5' />
                    </IconBadge>
                    <span>
                      {isEditing ? t('Edit Channel') : t('Create Channel')}
                    </span>
                  </SheetTitle>
                  {isEditing && effectiveProviderTarget && (
                    <div className='flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5'>
                      <ChannelTypeLogo
                        type={currentType}
                        plugin={providerPluginIcon}
                        size={18}
                      />
                      <span className='max-w-48 truncate text-sm'>
                        {providerLabel}
                      </span>
                    </div>
                  )}
                  {!isEditing &&
                    (!showProviderPicker || effectiveProviderTarget) && (
                      <Button
                        type='button'
                        variant='outline'
                        aria-label={
                          showProviderPicker
                            ? t('Back to configuration')
                            : t('Change provider')
                        }
                        aria-description={providerLabel}
                        title={providerLabel}
                        className='min-w-0 shrink gap-2 sm:max-w-md'
                        disabled={submitting}
                        onClick={() => setChoosingProvider(!showProviderPicker)}
                      >
                        {showProviderPicker ? (
                          <>
                            <ArrowLeft className='size-4' aria-hidden='true' />
                            <span className='shrink-0 sm:hidden'>
                              {t('Back')}
                            </span>
                            <span className='hidden shrink-0 sm:inline'>
                              {t('Back to configuration')}
                            </span>
                          </>
                        ) : (
                          <ChannelTypeLogo
                            type={currentType}
                            plugin={providerPluginIcon}
                            size={18}
                          />
                        )}
                        <span className='min-w-0 truncate'>
                          {providerLabel}
                        </span>
                        {!showProviderPicker && (
                          <>
                            <span className='hidden shrink-0 sm:inline'>
                              {t('Change provider')}
                            </span>
                            <ChevronDown
                              className='size-4'
                              aria-hidden='true'
                            />
                          </>
                        )}
                      </Button>
                    )}
                </div>
                {!isEditing && !showProviderPicker && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='shrink-0'
                    disabled={submitting}
                    onClick={() => void pasteConnectionInfoFromClipboard()}
                  >
                    <ClipboardPaste className='size-4' aria-hidden='true' />
                    <span>{t('Paste Connection Info')}</span>
                  </Button>
                )}
              </div>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <div className='flex min-w-0 flex-wrap items-center gap-2 sm:flex-1'>
                  {isEditing && (
                    <Badge variant='secondary' className='shrink-0'>
                      {t(currentStatusLabel)}
                    </Badge>
                  )}
                  <SheetDescription
                    className={cn(
                      showProviderPicker &&
                        effectiveProviderTarget &&
                        'truncate'
                    )}
                    title={
                      showProviderPicker && effectiveProviderTarget
                        ? drawerDescription
                        : undefined
                    }
                  >
                    {drawerDescription}
                  </SheetDescription>
                </div>
              </div>
            </div>
          </SheetHeader>

          {showProviderPicker && (
            <ChannelProviderPicker
              isCreating={!isEditing}
              plugins={availablePlugins}
              currentProvider={providerTarget}
              canBindPlugin={availablePlugins.length > 0}
              allowedTypes={
                availablePlugins.length > 0
                  ? [...allowedChannelTypes, CHANNEL_TYPE_TASK_PLUGIN]
                  : allowedChannelTypes
              }
              allowCustomTypeNumber={false}
              loading={channelOptionsQuery.isLoading}
              failed={channelOptionsQuery.isError}
              disabled={submitting}
              onRetry={() => void channelOptionsQuery.refetch()}
              onSelect={selectProvider}
            />
          )}

          {!isEditing && !showProviderPicker && clipboardConnectionInfo && (
            <Alert>
              <AlertDescription className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <span>{t('Connection info detected in clipboard')}</span>
                <span className='flex shrink-0 gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    onClick={() => applyConnectionInfo(clipboardConnectionInfo)}
                  >
                    {t('Fill in')}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => setClipboardConnectionInfo(null)}
                  >
                    {t('Ignore')}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form
              id='my-channel-form'
              ref={formRef}
              hidden={showProviderPicker}
              onSubmit={form.handleSubmit(submit, onInvalid)}
              className={sideDrawerFormClassName(
                showProviderPicker ? 'hidden' : 'gap-5 overflow-hidden'
              )}
            >
              {!showProviderPicker && effectiveProviderTarget && (
                <>
                  {bound && (
                    <Alert>
                      <AlertDescription>
                        {t(
                          'This channel is bound to a listed package. Its endpoint, models, model mapping, and other settings are locked.'
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  {submitError && (
                    <Alert variant='destructive'>
                      <AlertDescription>
                        {translateServerText(t, submitError)}
                      </AlertDescription>
                    </Alert>
                  )}
                  <ChannelConfiguration
                    section={configurationSection}
                    onSectionChange={setConfigurationSection}
                    sections={MY_CHANNEL_SECTIONS}
                    statuses={statuses}
                    badges={{
                      routing: {
                        count: mappingCount,
                        label: t('{{count}} model mapping(s)', {
                          count: mappingCount,
                        }),
                      },
                    }}
                    connection={
                      <>
                        {basicSection}
                        {connectionSection}
                      </>
                    }
                    models={modelsSection}
                    quickOptions={null}
                    routing={routingSection}
                  />
                </>
              )}
            </form>
          </Form>

          <SheetFooter className={sideDrawerFooterClassName()}>
            {showProviderPicker && effectiveProviderTarget ? (
              <Button
                type='button'
                variant='outline'
                disabled={submitting}
                onClick={() => setChoosingProvider(false)}
              >
                {t('Cancel')}
              </Button>
            ) : (
              <SheetClose
                render={<Button variant='outline' disabled={submitting} />}
              >
                {t('Cancel')}
              </SheetClose>
            )}
            {!showProviderPicker && (
              <Button
                form='my-channel-form'
                type='submit'
                disabled={submitting || !effectiveProviderTarget}
              >
                {submitting && <Loader2 className='mr-2 size-4 animate-spin' />}
                {submitLabel}
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ModelMappingBatchDialog
        open={batchMappingOpen}
        onOpenChange={setBatchMappingOpen}
        upstreamModels={discovery.models}
        channelModels={currentModels}
        initialSource={discovery.models.length > 0 ? 'upstream' : 'channel'}
        onApply={handleBatchMappingApply}
      />

      {configureModelsOpen && (
        <ConfigureModelsDialog
          open
          models={currentModels}
          onOpenChange={setConfigureModelsOpen}
          onApply={handleModelsChange}
          onRedirect={requestMappingDraft}
        />
      )}

      {loginRequest && (
        <PluginLoginDialog
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setLoginRequest(null)
          }}
          channelId={loginRequest.channelId}
          keyIndex={loginRequest.keyIndex}
          add={loginRequest.add}
          plugin={loginRequest.plugin}
          scope='seller'
          onDone={() => {
            void queryClient.invalidateQueries({
              queryKey: MY_CHANNELS_QUERY_KEY,
            })
          }}
        />
      )}
    </>
  )
}

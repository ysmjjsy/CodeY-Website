import { createPagination, type PaginationChange, pagedItems } from './pagination'
import { providerPresets } from './provider-presets'
import { toast } from './toast'

type Localized = Record<string, string>
type AvailableModel = {
  upstreamModelId: string
  displayName: string
  protocol: string
  inputModalities: string[]
  outputModalities: string[]
  asynchronous: boolean
}
type Provider = {
  providerId: string
  providerPresetId: string
  slug: string
  displayName: string
  providerKind: string
  baseUrl: string
  credentialConfigured: boolean
  availableModels: AvailableModel[]
  modelsRefreshedAt?: string | null
  lastTestLatencyMs?: number | null
  active: boolean
}
type ProviderDiscovery = {
  models: AvailableModel[]
  fetchedAt: string
  latencyMs: number
  source: 'upstream' | 'provider_preset'
}
type Pricing = {
  inputCreditMicrosPerMillion: number
  outputCreditMicrosPerMillion: number
  cacheReadCreditMicrosPerMillion: number
  cacheWriteCreditMicrosPerMillion: number
  fixedCreditMicrosPerRequest: number
}
type Model = {
  modelId: string
  publicModelId: string
  displayName: string
  upstreamProviderId: string
  upstreamModelId: string
  protocol: string
  capability: Record<string, unknown>
  pricing: Pricing
  lastTestLatencyMs?: number | null
  active: boolean
}
type ModelTestResult = { latencyMs: number }
type ModelCatalog = { revision: number; providers: Provider[]; models: Model[] }
type Offer = { region: string; currency: string; paymentProvider: string; amountMinor: number }
type Benefit = { resourceType: string; resourceId?: string | null; action: string }
type Plan = {
  planId: string
  slug: string
  displayName: string
  description: string
  displayNameI18n?: Localized
  descriptionI18n?: Localized
  tierRank: number
  isDefault: boolean
  monthlyCreditMicros: number
  offers: Offer[]
  benefits: Benefit[]
}
type PlanCatalog = { revision: number; plans: Plan[] }
type TopUp = {
  productId: string
  slug: string
  displayName: string
  description: string
  displayNameI18n?: Localized
  descriptionI18n?: Localized
  creditMicros: number
  offers: Offer[]
}
type TopUpCatalog = { revision: number; products: TopUp[] }

/**
 * Behaviour for the cloud admin console: providers, models, plans, and credit packs.
 *
 * Extracted verbatim from `CloudAdmin.astro`; the component only imports and calls it.
 */
export function initCloudAdmin(): void {
  const rootEl = document.querySelector<HTMLElement>('[data-cloud-admin]')
  if (!rootEl) return
  const root = rootEl
  const copy = JSON.parse(root.dataset.copy || '{}') as Record<string, string>
  const locale = root.dataset.locale === 'en' ? 'en' : 'zh-CN'
  const section = root.dataset.adminSection || 'models'
  const state = root.querySelector<HTMLElement>('[data-state]')!
  const content = root.querySelector<HTMLElement>('[data-content]')!
  const providerForm = root.querySelector<HTMLFormElement>('[data-provider-form]')!
  const modelForm = root.querySelector<HTMLFormElement>('[data-model-form]')!
  const planForm = root.querySelector<HTMLFormElement>('[data-plan-form]')!
  const topupForm = root.querySelector<HTMLFormElement>('[data-topup-form]')!
  const providerDialog = root.querySelector<HTMLDialogElement>('[data-provider-dialog]')!
  const modelDialog = root.querySelector<HTMLDialogElement>('[data-model-dialog]')!
  const planDialog = root.querySelector<HTMLDialogElement>('[data-plan-dialog]')!
  const topupDialog = root.querySelector<HTMLDialogElement>('[data-topup-dialog]')!
  const planOfferRows = root.querySelector<HTMLElement>('[data-plan-offer-rows]')!
  const topupOfferRows = root.querySelector<HTMLElement>('[data-topup-offer-rows]')!
  const providerDiscovery = root.querySelector<HTMLElement>('[data-provider-discovery]')!
  const providerDiscoveryText = root.querySelector<HTMLElement>('[data-provider-discovery-text]')!
  const providerModelPreview = root.querySelector<HTMLElement>('[data-provider-model-preview]')!
  const discoverProviderButton = root.querySelector<HTMLButtonElement>('[data-discover-provider]')!
  const saveProviderButton = root.querySelector<HTMLButtonElement>('[data-save-provider]')!
  const providerCredentialField = root.querySelector<HTMLElement>(
    '[data-provider-credential-field]',
  )!
  const testModelButton = root.querySelector<HTMLButtonElement>('[data-test-model]')!
  const providerModelPopover = root.querySelector<HTMLElement>('[data-provider-model-popover]')!
  const providerModelPopoverTitle = root.querySelector<HTMLElement>(
    '[data-provider-model-popover-title]',
  )!
  const providerModelPopoverList = root.querySelector<HTMLElement>(
    '[data-provider-model-popover-list]',
  )!
  const providerPaginationRoot = root.querySelector<HTMLElement>('[data-provider-pagination]')
  const modelPaginationRoot = root.querySelector<HTMLElement>('[data-model-pagination]')
  const planPaginationRoot = root.querySelector<HTMLElement>('[data-plan-pagination]')
  const topupPaginationRoot = root.querySelector<HTMLElement>('[data-topup-pagination]')
  const providerPagination = createPagination(providerPaginationRoot)
  const modelPagination = createPagination(modelPaginationRoot)
  const planPagination = createPagination(planPaginationRoot)
  const topupPagination = createPagination(topupPaginationRoot)
  let modelCatalog: ModelCatalog = { revision: 0, providers: [], models: [] }
  let planCatalog: PlanCatalog = { revision: 0, plans: [] }
  let topupCatalog: TopUpCatalog = { revision: 0, products: [] }
  let providerDiscoveryModels: AvailableModel[] | null = null
  let providerDiscoveryLatency: number | null = null
  let providerModelPopoverTrigger: HTMLButtonElement | null = null
  let providerModelPopoverPinned = false
  let providerPage = 1
  let providerPageSize = 10
  let modelPage = 1
  let modelPageSize = 10
  let planPage = 1
  let planPageSize = 10
  let topupPage = 1
  let topupPageSize = 10
  let providerModelPopoverTimer: number | undefined

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/cloud/v1${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('market-auth-required'))
      throw new Error(copy.signIn)
    }
    if (response.status === 403) throw new Error(copy.adminRequired)
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string
        error?: { message?: string }
      } | null
      throw new Error(payload?.error?.message || payload?.message || copy.unavailable)
    }
    return response.json() as Promise<T>
  }
  function field(
    form: HTMLFormElement,
    name: string,
  ): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    return form.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
  }
  function checked(form: HTMLFormElement, name: string): boolean {
    return (field(form, name) as HTMLInputElement).checked
  }
  function setChecked(form: HTMLFormElement, name: string, value: boolean): void {
    ;(field(form, name) as HTMLInputElement).checked = value
  }
  function toMicros(value: string): number {
    return Math.round(Number(value) * 1_000_000)
  }
  function fromMicros(value: number): string {
    return String(value / 1_000_000)
  }
  function capability<T>(model: Model, key: string, fallback: T): T {
    return (model.capability[key] as T | undefined) ?? fallback
  }
  function localized(values: Localized | undefined, fallback: string): string {
    return values?.[locale] || fallback
  }
  function title(dialog: HTMLDialogElement, value: string): void {
    dialog.querySelector<HTMLElement>('h2')!.textContent = value
  }
  function interpolate(template: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce(
      (result, [key, value]) => result.replace(`{${key}}`, String(value)),
      template,
    )
  }
  function setFormBusy(form: HTMLFormElement, busy: boolean): void {
    form.toggleAttribute('aria-busy', busy)
    form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = busy
    })
  }
  function announceSaved(): void {
    toast.success(copy.saved)
  }

  const protocolOptions: Record<string, Array<[string, string]>> = {
    openai_compatible: [
      ['chat_completions', 'OpenAI Chat Completions'],
      ['responses', 'OpenAI Responses'],
      ['image_generation', copy.imageGeneration],
      ['image_edit', copy.imageEdit],
      ['video_generation', copy.videoGeneration],
      ['speech_synthesis', copy.speechSynthesis],
      ['music_generation', copy.musicGeneration],
    ],
    anthropic: [['messages', 'Anthropic Messages']],
    gemini: [['generate_content', 'Gemini Generate Content']],
  }
  function providerPreset(id: string) {
    return providerPresets.find((preset) => preset.id === id)
  }
  function providerNeedsCredential(provider: Pick<Provider, 'providerPresetId'>): boolean {
    return providerPreset(provider.providerPresetId)?.credentialRequired ?? true
  }
  function providerKindLabel(kind: string): string {
    return kind === 'openai_compatible'
      ? copy.openaiCompatible
      : kind === 'anthropic'
        ? 'Anthropic'
        : kind === 'gemini'
          ? 'Gemini'
          : kind
  }
  function protocolLabel(protocol: string): string {
    return (
      Object.values(protocolOptions)
        .flat()
        .find(([value]) => value === protocol)?.[1] || protocol
    )
  }
  function selectModelTab(selected: 'providers' | 'models'): void {
    root.querySelectorAll<HTMLButtonElement>('[data-model-tab]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.modelTab === selected))
    })
    root.querySelectorAll<HTMLElement>('[data-model-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.modelPanel !== selected
    })
  }
  function syncProviderOptions(preferred?: string, preferredModel?: string): void {
    const select = field(modelForm, 'upstreamProviderId') as HTMLSelectElement
    const selected = preferred || select.value
    const providers = modelCatalog.providers.filter(
      (provider) =>
        (provider.active && provider.availableModels.length > 0) ||
        provider.providerId === selected,
    )
    select.replaceChildren(
      ...providers.map((provider) => {
        const option = new Option(provider.displayName, provider.providerId)
        option.disabled =
          (!provider.active || provider.availableModels.length === 0) &&
          provider.providerId !== selected
        return option
      }),
    )
    if (selected && providers.some((provider) => provider.providerId === selected))
      select.value = selected
    else select.value = providers[0]?.providerId || ''
    syncUpstreamModelOptions(preferredModel)
    syncProtocols()
  }
  function syncProtocols(preferred?: string): void {
    const providerId = field(modelForm, 'upstreamProviderId').value
    const provider = modelCatalog.providers.find((item) => item.providerId === providerId)
    const selectedModel = provider?.availableModels.find(
      (model) => model.upstreamModelId === field(modelForm, 'upstreamModelId').value,
    )
    const supported = providerPreset(provider?.providerPresetId || '')?.protocols as
      | readonly string[]
      | undefined
    const options = provider
      ? (protocolOptions[provider.providerKind] || []).filter(
          ([value]) =>
            (!supported || supported.includes(value)) &&
            (!selectedModel ||
              !isMediaProtocol(selectedModel.protocol) ||
              value === selectedModel.protocol),
        )
      : []
    const select = field(modelForm, 'protocol') as HTMLSelectElement
    select.replaceChildren(...options.map(([value, label]) => new Option(label, value)))
    const selected = preferred || selectedModel?.protocol
    if (selected && options.some(([value]) => value === selected)) select.value = selected
    syncModelFormMode()
  }
  function syncUpstreamModelOptions(preferred?: string): void {
    const provider = modelCatalog.providers.find(
      (item) => item.providerId === field(modelForm, 'upstreamProviderId').value,
    )
    const select = field(modelForm, 'upstreamModelId') as HTMLSelectElement
    const options = provider?.availableModels || []
    const nodes: HTMLOptionElement[] = [
      new Option(options.length ? copy.selectUpstreamModel : copy.noAvailableModels, ''),
    ]
    nodes[0].disabled = true
    nodes.push(
      ...options.map(
        (model) =>
          new Option(
            `${protocolLabel(model.protocol)} · ${model.displayName === model.upstreamModelId ? model.upstreamModelId : `${model.displayName} · ${model.upstreamModelId}`}`,
            model.upstreamModelId,
          ),
      ),
    )
    if (preferred && !options.some((model) => model.upstreamModelId === preferred))
      nodes.push(new Option(preferred, preferred))
    select.replaceChildren(...nodes)
    select.value = preferred && nodes.some((option) => option.value === preferred) ? preferred : ''
  }
  function modelSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 100)
  }
  function applySelectedModelDefaults(): void {
    const provider = modelCatalog.providers.find(
      (item) => item.providerId === field(modelForm, 'upstreamProviderId').value,
    )
    const selected = provider?.availableModels.find(
      (model) => model.upstreamModelId === field(modelForm, 'upstreamModelId').value,
    )
    if (!selected) return
    syncProtocols(selected.protocol)
    if (field(modelForm, 'modelId').value) return
    if (!field(modelForm, 'displayName').value.trim())
      field(modelForm, 'displayName').value = selected.displayName
    if (!field(modelForm, 'publicModelId').value.trim())
      field(modelForm, 'publicModelId').value = modelSlug(selected.upstreamModelId)
    if (isMediaProtocol(selected.protocol)) {
      for (const name of ['inputPrice', 'outputPrice', 'cacheReadPrice', 'cacheWritePrice'])
        field(modelForm, name).value = '0'
    }
  }
  function isMediaProtocol(protocol = field(modelForm, 'protocol').value): boolean {
    return [
      'image_generation',
      'image_edit',
      'video_generation',
      'speech_synthesis',
      'music_generation',
    ].includes(protocol)
  }
  function syncModelFormMode(): void {
    const media = isMediaProtocol()
    modelForm
      .querySelectorAll<HTMLElement>('[data-token-model-section], .token-pricing-field')
      .forEach((element) => {
        element.hidden = media
      })
  }
  function applyProviderPresetDefaults(resetValues: boolean, credentialConfigured = false): void {
    const presetId = field(providerForm, 'providerPresetId').value
    const preset = providerPreset(presetId)
    if (resetValues) {
      field(providerForm, 'displayName').value = preset?.displayName || ''
      field(providerForm, 'slug').value = preset?.id || ''
      field(providerForm, 'providerKind').value = preset?.providerKind || 'openai_compatible'
      field(providerForm, 'baseUrl').value = preset?.baseUrl || ''
      field(providerForm, 'apiKey').value = ''
    }
    const credentialRequired = preset?.credentialRequired ?? true
    providerCredentialField.hidden = !credentialRequired
    ;(field(providerForm, 'providerKind') as HTMLSelectElement).disabled = Boolean(preset)
    const apiKey = field(providerForm, 'apiKey') as HTMLInputElement
    apiKey.required = credentialRequired && !credentialConfigured
    apiKey.placeholder = credentialConfigured ? copy.apiKeyHint : copy.apiKeyCreateHint
  }
  function renderProviderDiscovery(message?: string): void {
    const models = providerDiscoveryModels || []
    const status =
      message || (models.length ? interpolate(copy.discoverySuccess, { count: models.length }) : '')
    providerDiscovery.hidden = !status && models.length === 0
    providerDiscoveryText.textContent = status
    providerModelPreview.hidden = models.length === 0
    providerModelPreview.replaceChildren(
      ...models.slice(0, 12).map((model) => textElement('span', '', model.displayName)),
    )
    if (models.length > 12)
      providerModelPreview.append(textElement('span', 'more', `+${models.length - 12}`))
    discoverProviderButton.querySelector('span')!.textContent = models.length
      ? copy.refreshModels
      : copy.testAndFetchModels
    saveProviderButton.disabled = models.length === 0
  }
  function invalidateProviderDiscovery(): void {
    providerDiscoveryModels = null
    providerDiscoveryLatency = null
    renderProviderDiscovery()
  }
  async function discoverProviderModels(): Promise<void> {
    if (!providerForm.reportValidity()) return
    providerDiscovery.hidden = false
    setFormBusy(providerForm, true)
    providerDiscoveryText.textContent = copy.testingConnection
    try {
      const result = await api<ProviderDiscovery>('/admin/model-providers/discover', {
        method: 'POST',
        body: JSON.stringify({
          providerId: field(providerForm, 'providerId').value || null,
          providerPresetId: field(providerForm, 'providerPresetId').value,
          providerKind: field(providerForm, 'providerKind').value,
          baseUrl: field(providerForm, 'baseUrl').value.trim(),
          apiKey: field(providerForm, 'apiKey').value || null,
        }),
      })
      providerDiscoveryModels = result.models
      providerDiscoveryLatency = result.latencyMs
      const success =
        result.source === 'provider_preset'
          ? interpolate(copy.presetModelsLoaded, { count: result.models.length })
          : interpolate(copy.discoverySuccess, { count: result.models.length })
      renderProviderDiscovery(result.models.length ? success : copy.discoveryEmpty)
    } catch (reason) {
      providerDiscoveryModels = null
      providerDiscoveryLatency = null
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
      renderProviderDiscovery(copy.discoveryRequired)
    } finally {
      setFormBusy(providerForm, false)
      renderProviderDiscovery(providerDiscoveryText.textContent || undefined)
    }
  }
  async function testModel(): Promise<void> {
    const controls = ['upstreamProviderId', 'upstreamModelId', 'protocol'].map((name) =>
      field(modelForm, name),
    )
    if (!controls.every((control) => control.reportValidity())) return
    setFormBusy(modelForm, true)
    testModelButton.querySelector('i')!.className = 'ph ph-circle-notch provider-action-spin'
    testModelButton.querySelector('span')!.textContent = copy.testingModel
    try {
      const result = await api<ModelTestResult>('/admin/models/test', {
        method: 'POST',
        body: JSON.stringify({
          modelId: null,
          upstreamProviderId: field(modelForm, 'upstreamProviderId').value,
          upstreamModelId: field(modelForm, 'upstreamModelId').value,
          protocol: field(modelForm, 'protocol').value,
        }),
      })
      toast.success(interpolate(copy.modelTestSuccess, { latency: result.latencyMs }))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
    } finally {
      setFormBusy(modelForm, false)
      testModelButton.querySelector('i')!.className = 'ph ph-play-circle'
      testModelButton.querySelector('span')!.textContent = copy.testModel
    }
  }

  function offerRow(offer: Offer, minimumAmount: number): HTMLElement {
    const row = document.createElement('div')
    row.className = 'offer-row'
    const makeLabel = (label: string, control: HTMLElement) => {
      const element = document.createElement('label')
      const span = document.createElement('span')
      span.textContent = label
      element.append(span, control)
      return element
    }
    const provider = document.createElement('select')
    provider.dataset.offerProvider = ''
    provider.required = true
    provider.replaceChildren(
      new Option('Stripe', 'stripe'),
      new Option(locale === 'en' ? 'WeChat Pay' : '微信支付', 'wechat_pay'),
      new Option(locale === 'en' ? 'Alipay' : '支付宝', 'alipay'),
      new Option('Test', 'test'),
    )
    provider.value = offer.paymentProvider
    const region = document.createElement('input')
    region.dataset.offerRegion = ''
    region.required = true
    region.maxLength = 16
    region.value = offer.region
    const currency = document.createElement('input')
    currency.dataset.offerCurrency = ''
    currency.required = true
    currency.minLength = 3
    currency.maxLength = 3
    currency.value = offer.currency
    const amount = document.createElement('input')
    amount.dataset.offerAmount = ''
    amount.type = 'number'
    amount.required = true
    amount.min = String(minimumAmount)
    amount.step = '0.01'
    amount.value = String(offer.amountMinor / 100)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-ghost'
    remove.textContent = copy.remove
    remove.onclick = () => {
      if (row.parentElement?.childElementCount !== 1) row.remove()
    }
    row.append(
      makeLabel(copy.paymentProvider, provider),
      makeLabel(copy.region, region),
      makeLabel(copy.currency, currency),
      makeLabel(copy.priceMajor, amount),
      remove,
    )
    return row
  }
  function defaultOffer(): Offer {
    return {
      paymentProvider: 'stripe',
      region: locale === 'en' ? 'GLOBAL' : 'CN',
      currency: locale === 'en' ? 'USD' : 'CNY',
      amountMinor: 0,
    }
  }
  function setOfferRows(container: HTMLElement, offers: Offer[], minimumAmount: number): void {
    container.replaceChildren(
      ...(offers.length ? offers : [defaultOffer()]).map((offer) => offerRow(offer, minimumAmount)),
    )
  }
  function collectOffers(container: HTMLElement): Offer[] {
    return [...container.querySelectorAll<HTMLElement>('.offer-row')].map((row) => ({
      paymentProvider: row.querySelector<HTMLSelectElement>('[data-offer-provider]')!.value,
      region: row
        .querySelector<HTMLInputElement>('[data-offer-region]')!
        .value.trim()
        .toUpperCase(),
      currency: row
        .querySelector<HTMLInputElement>('[data-offer-currency]')!
        .value.trim()
        .toUpperCase(),
      amountMinor: Math.round(
        Number(row.querySelector<HTMLInputElement>('[data-offer-amount]')!.value) * 100,
      ),
    }))
  }
  function syncPlanOffers(): void {
    const editor = root.querySelector<HTMLFieldSetElement>('[data-plan-offers]')!
    const disabled = checked(planForm, 'isDefault')
    editor.hidden = disabled
    editor
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
      .forEach((control) => {
        control.disabled = disabled
      })
  }

  function empty(text: string): HTMLElement {
    const value = document.createElement('p')
    value.className = 'record-empty'
    value.textContent = text
    return value
  }
  function record(
    titleText: string,
    meta: string,
    active: boolean,
    onEdit: () => void,
  ): HTMLElement {
    const element = document.createElement('article')
    element.className = 'record'
    const text = document.createElement('div')
    const heading = document.createElement('strong')
    heading.textContent = titleText
    const detail = document.createElement('span')
    detail.textContent = meta
    text.append(heading, detail)
    const status = document.createElement('span')
    status.className = `record-status ${active ? 'active' : ''}`
    status.textContent = active ? copy.active : copy.inactive
    const edit = editButton(`${copy.edit}: ${titleText}`, onEdit)
    element.append(text, status, edit)
    return element
  }
  function cell(...children: Array<Node | string>): HTMLTableCellElement {
    const value = document.createElement('td')
    value.append(...children)
    return value
  }
  function textElement(
    tag: 'span' | 'strong' | 'code' | 'i' | 'em',
    className: string,
    value: string,
  ): HTMLElement {
    const element = document.createElement(tag)
    element.className = className
    element.textContent = value
    return element
  }
  function setLatencyText(element: HTMLElement, latency: number | null | undefined): void {
    element.classList.toggle('untested', latency == null)
    element.textContent = latency == null ? copy.notTested : `${latency} ms`
  }
  function latencyElement(latency: number | null | undefined): HTMLElement {
    const element = textElement('span', 'latency-value', '')
    setLatencyText(element, latency)
    return element
  }
  function statusBadge(label: string, tone: 'active' | 'inactive' | 'warning'): HTMLElement {
    return textElement('span', `config-status ${tone}`, label)
  }
  function editButton(label: string, onEdit: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn-ghost list-action config-edit'
    button.setAttribute('aria-label', label)
    const icon = document.createElement('i')
    icon.className = 'ph ph-pencil-simple'
    icon.setAttribute('aria-hidden', 'true')
    const text = document.createElement('span')
    text.textContent = copy.edit
    button.append(icon, text)
    button.onclick = onEdit
    return button
  }
  function providerActionButton(
    label: string,
    iconName: string,
    onAction: (button: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn-ghost list-action provider-action'
    button.setAttribute('aria-label', label)
    const icon = document.createElement('i')
    icon.className = `ph ${iconName}`
    icon.setAttribute('aria-hidden', 'true')
    const text = document.createElement('span')
    text.textContent = label
    button.append(icon, text)
    button.onclick = () => onAction(button)
    return button
  }
  function cancelProviderModelPopoverClose(): void {
    if (providerModelPopoverTimer !== undefined) window.clearTimeout(providerModelPopoverTimer)
    providerModelPopoverTimer = undefined
  }
  function hideProviderModelPopover(force = false): void {
    cancelProviderModelPopoverClose()
    if (providerModelPopoverPinned && !force) return
    providerModelPopover.hidden = true
    providerModelPopoverTrigger?.setAttribute('aria-expanded', 'false')
    providerModelPopoverTrigger = null
    providerModelPopoverPinned = false
  }
  function scheduleProviderModelPopoverClose(): void {
    cancelProviderModelPopoverClose()
    providerModelPopoverTimer = window.setTimeout(() => hideProviderModelPopover(), 120)
  }
  function showProviderModelPopover(
    trigger: HTMLButtonElement,
    provider: Provider,
    pinned = false,
  ): void {
    cancelProviderModelPopoverClose()
    providerModelPopoverTrigger?.setAttribute('aria-expanded', 'false')
    providerModelPopoverTrigger = trigger
    providerModelPopoverPinned = pinned
    trigger.setAttribute('aria-expanded', 'true')
    providerModelPopoverTitle.textContent = interpolate(copy.providerModelsTitle, {
      provider: provider.displayName,
    })
    providerModelPopoverList.replaceChildren(
      ...(provider.availableModels.length
        ? provider.availableModels.map((model) => {
            const item = document.createElement('div')
            item.className = 'provider-model-popover-item'
            const heading = document.createElement('span')
            heading.className = 'provider-model-popover-heading'
            heading.append(
              textElement('strong', '', model.displayName),
              textElement('em', '', protocolLabel(model.protocol)),
            )
            item.append(heading, textElement('code', '', model.upstreamModelId))
            return item
          })
        : [textElement('span', 'provider-model-popover-empty', copy.providerModelsEmpty)]),
    )
    providerModelPopover.hidden = false
    const triggerRect = trigger.getBoundingClientRect()
    const safeTop = 80
    const roomAbove = Math.max(0, triggerRect.top - safeTop - 8)
    const roomBelow = Math.max(0, window.innerHeight - triggerRect.bottom - 12)
    const placeBelow = roomBelow >= 220 || roomBelow >= roomAbove
    providerModelPopover.style.maxHeight = `${Math.max(140, Math.min(380, placeBelow ? roomBelow : roomAbove))}px`
    const popoverRect = providerModelPopover.getBoundingClientRect()
    const left = Math.min(
      window.innerWidth - popoverRect.width - 12,
      Math.max(12, triggerRect.left),
    )
    const top = placeBelow
      ? triggerRect.bottom + 8
      : Math.max(safeTop, triggerRect.top - popoverRect.height - 8)
    providerModelPopover.style.left = `${left}px`
    providerModelPopover.style.top = `${top}px`
  }
  function providerModelTrigger(provider: Provider, publishedCount: number): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'provider-model-trigger'
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-expanded', 'false')
    button.append(
      textElement(
        'span',
        'config-count',
        interpolate(copy.providerModelCountLabel, {
          available: provider.availableModels.length,
          published: publishedCount,
        }),
      ),
      textElement('i', 'ph ph-caret-down', ''),
    )
    button.addEventListener('mouseenter', () => showProviderModelPopover(button, provider))
    button.addEventListener('mouseleave', scheduleProviderModelPopoverClose)
    button.addEventListener('focus', () => showProviderModelPopover(button, provider))
    button.addEventListener('blur', scheduleProviderModelPopoverClose)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const shouldClose = providerModelPopoverTrigger === button && providerModelPopoverPinned
      if (shouldClose) hideProviderModelPopover(true)
      else showProviderModelPopover(button, provider, true)
    })
    return button
  }
  function providerUpsertPayload(
    provider: Provider,
    active: boolean,
    availableModels?: AvailableModel[],
    lastTestLatencyMs?: number,
  ): Record<string, unknown> {
    return {
      providerId: provider.providerId,
      providerPresetId: provider.providerPresetId,
      slug: provider.slug,
      displayName: provider.displayName,
      providerKind: provider.providerKind,
      baseUrl: provider.baseUrl,
      apiKey: null,
      ...(availableModels ? { availableModels } : {}),
      ...(lastTestLatencyMs !== undefined ? { lastTestLatencyMs } : {}),
      active,
      expectedRevision: modelCatalog.revision,
    }
  }
  async function testProvider(provider: Provider, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    button.querySelector('i')!.className = 'ph ph-circle-notch provider-action-spin'
    button.querySelector('span')!.textContent = copy.testingProvider
    try {
      const result = await api<ProviderDiscovery>('/admin/model-providers/discover', {
        method: 'POST',
        body: JSON.stringify({
          providerId: provider.providerId,
          providerPresetId: provider.providerPresetId,
          providerKind: provider.providerKind,
          baseUrl: provider.baseUrl,
          apiKey: null,
        }),
      })
      modelCatalog = await api<ModelCatalog>('/admin/model-providers', {
        method: 'POST',
        body: JSON.stringify(
          providerUpsertPayload(provider, provider.active, result.models, result.latencyMs),
        ),
      })
      hideProviderModelPopover(true)
      render()
      toast.success(
        result.source === 'provider_preset'
          ? interpolate(copy.presetModelsLoaded, { count: result.models.length })
          : interpolate(copy.discoverySuccess, { count: result.models.length }),
      )
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
      if (button.isConnected) {
        button.disabled = false
        button.querySelector('i')!.className = 'ph ph-plugs-connected'
        button.querySelector('span')!.textContent = copy.testProvider
      }
    }
  }
  async function toggleProvider(provider: Provider, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    try {
      modelCatalog = await api<ModelCatalog>('/admin/model-providers', {
        method: 'POST',
        body: JSON.stringify(providerUpsertPayload(provider, !provider.active)),
      })
      hideProviderModelPopover(true)
      render()
      toast.success(provider.active ? copy.providerDisabled : copy.providerEnabled)
    } catch (reason) {
      button.disabled = false
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
    }
  }
  function inlineStatusToggle(
    active: boolean,
    label: string,
    ariaLabel: string,
    onToggle: (button: HTMLButtonElement) => void,
    tone = '',
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `inline-status-toggle ${tone}`.trim()
    button.setAttribute('role', 'switch')
    button.setAttribute('aria-checked', String(active))
    button.setAttribute('aria-label', ariaLabel)
    const track = document.createElement('span')
    track.className = 'inline-status-track'
    track.setAttribute('aria-hidden', 'true')
    track.append(document.createElement('span'))
    const text = document.createElement('span')
    text.className = 'inline-status-label'
    text.textContent = label
    button.append(track, text)
    button.onclick = () => onToggle(button)
    return button
  }
  function providerRow(provider: Provider): HTMLTableRowElement {
    const row = document.createElement('tr')
    const identity = document.createElement('div')
    identity.className = 'config-identity'
    identity.append(
      textElement('strong', '', provider.displayName),
      textElement('code', '', provider.slug),
    )
    const connection = document.createElement('div')
    connection.className = 'config-connection'
    connection.append(
      textElement('span', '', providerKindLabel(provider.providerKind)),
      textElement('code', '', provider.baseUrl),
    )
    const publishedCount = modelCatalog.models.filter(
      (model) => model.upstreamProviderId === provider.providerId,
    ).length
    const actions = document.createElement('div')
    actions.className = 'provider-actions'
    const test = providerActionButton(
      copy.testProvider,
      'ph-plugs-connected',
      (button) => void testProvider(provider, button),
    )
    test.disabled = providerNeedsCredential(provider) && !provider.credentialConfigured
    test.setAttribute('aria-label', `${copy.testProvider}: ${provider.displayName}`)
    actions.append(
      test,
      editButton(`${copy.edit}: ${provider.displayName}`, () => editProvider(provider)),
    )
    row.append(
      cell(identity),
      cell(connection),
      cell(providerModelTrigger(provider, publishedCount)),
      cell(
        statusBadge(
          !providerNeedsCredential(provider)
            ? copy.credentialNotRequired
            : provider.credentialConfigured
              ? copy.credentialSet
              : copy.noCredential,
          !providerNeedsCredential(provider) || provider.credentialConfigured
            ? 'active'
            : 'warning',
        ),
      ),
      cell(latencyElement(provider.lastTestLatencyMs)),
      cell(
        inlineStatusToggle(
          provider.active,
          provider.active ? copy.active : copy.inactive,
          `${provider.active ? copy.disableProvider : copy.enableProvider}: ${provider.displayName}`,
          (button) => void toggleProvider(provider, button),
        ),
      ),
      cell(actions),
    )
    return row
  }
  function modelCapabilities(model: Model): string[] {
    const outputs = capability(model, 'output_modalities', ['text']) as string[]
    return [
      outputs.includes('image') ? copy.imageOutput : '',
      outputs.includes('video') ? copy.videoOutput : '',
      outputs.includes('audio') ? copy.audioOutput : '',
      (capability(model, 'input_modalities', []) as string[]).includes('image') ? copy.vision : '',
      capability(model, 'tool_calling', false) ? copy.toolCalling : '',
      capability(model, 'reasoning', false) ? copy.reasoning : '',
      capability(model, 'prompt_cache', false) ? copy.promptCache : '',
      capability(model, 'structured_output', false) ? copy.structuredOutput : '',
    ].filter(Boolean)
  }
  function modelUpsertPayload(model: Model, active: boolean): Record<string, unknown> {
    return {
      modelId: model.modelId,
      publicModelId: model.publicModelId,
      displayName: model.displayName,
      upstreamProviderId: model.upstreamProviderId,
      upstreamModelId: model.upstreamModelId,
      protocol: model.protocol,
      capability: model.capability,
      pricing: {
        inputCreditMicrosPerMillion: model.pricing.inputCreditMicrosPerMillion,
        outputCreditMicrosPerMillion: model.pricing.outputCreditMicrosPerMillion,
        cacheReadCreditMicrosPerMillion: model.pricing.cacheReadCreditMicrosPerMillion,
        cacheWriteCreditMicrosPerMillion: model.pricing.cacheWriteCreditMicrosPerMillion,
        fixedCreditMicrosPerRequest: model.pricing.fixedCreditMicrosPerRequest,
      },
      active,
      expectedRevision: modelCatalog.revision,
    }
  }
  async function toggleModel(model: Model, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    try {
      modelCatalog = await api<ModelCatalog>('/admin/models', {
        method: 'POST',
        body: JSON.stringify(modelUpsertPayload(model, !model.active)),
      })
      render()
      toast.success(model.active ? copy.modelDisabled : copy.modelEnabled)
    } catch (reason) {
      button.disabled = false
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
    }
  }
  async function testModelFromList(model: Model, button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    button.querySelector('i')!.className = 'ph ph-circle-notch provider-action-spin'
    button.querySelector('span')!.textContent = copy.testingProvider
    try {
      const result = await api<ModelTestResult>('/admin/models/test', {
        method: 'POST',
        body: JSON.stringify({
          modelId: model.modelId,
          upstreamProviderId: model.upstreamProviderId,
          upstreamModelId: model.upstreamModelId,
          protocol: model.protocol,
        }),
      })
      model.lastTestLatencyMs = result.latencyMs
      render()
      toast.success(interpolate(copy.modelTestSuccess, { latency: result.latencyMs }))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
      if (button.isConnected) {
        button.disabled = false
        button.querySelector('i')!.className = 'ph ph-play-circle'
        button.querySelector('span')!.textContent = copy.testProvider
      }
    }
  }
  function modelRow(model: Model): HTMLTableRowElement {
    const row = document.createElement('tr')
    const provider = modelCatalog.providers.find(
      (candidate) => candidate.providerId === model.upstreamProviderId,
    )
    const identity = document.createElement('div')
    identity.className = 'config-identity'
    identity.append(
      textElement('strong', '', model.displayName),
      textElement('code', '', model.publicModelId),
    )
    const upstream = document.createElement('div')
    upstream.className = 'config-identity'
    upstream.append(
      textElement('span', '', provider?.displayName || '—'),
      textElement('code', '', model.upstreamModelId),
    )
    const capabilities = document.createElement('div')
    capabilities.className = 'capability-list'
    const capabilityLabels = modelCapabilities(model)
    capabilities.append(
      ...(capabilityLabels.length
        ? capabilityLabels.map((label) => textElement('span', '', label))
        : [textElement('span', 'empty', '—')]),
    )
    const pricing = document.createElement('div')
    pricing.className = 'pricing-summary'
    if (model.pricing.inputCreditMicrosPerMillion || model.pricing.outputCreditMicrosPerMillion)
      pricing.append(
        textElement(
          'span',
          '',
          interpolate(copy.inputOutputPrice, {
            input: fromMicros(model.pricing.inputCreditMicrosPerMillion),
            output: fromMicros(model.pricing.outputCreditMicrosPerMillion),
          }),
        ),
      )
    if (model.pricing.fixedCreditMicrosPerRequest)
      pricing.append(
        textElement(
          'span',
          '',
          interpolate(copy.fixedPriceSummary, {
            price: fromMicros(model.pricing.fixedCreditMicrosPerRequest),
          }),
        ),
      )
    if (!pricing.childElementCount) pricing.append(textElement('span', '', '—'))
    const enabled = model.active && Boolean(provider?.active)
    const status = enabled
      ? copy.active
      : model.active && provider && !provider.active
        ? copy.providerInactive
        : copy.inactive
    const actions = document.createElement('div')
    actions.className = 'provider-actions'
    const test = providerActionButton(
      copy.testProvider,
      'ph-play-circle',
      (button) => void testModelFromList(model, button),
    )
    test.disabled =
      !provider ||
      !provider.active ||
      (providerNeedsCredential(provider) && !provider.credentialConfigured)
    test.setAttribute('aria-label', `${copy.testModel}: ${model.displayName}`)
    actions.append(
      test,
      editButton(`${copy.edit}: ${model.displayName}`, () => editModel(model)),
    )
    row.append(
      cell(identity),
      cell(upstream),
      cell(textElement('span', 'protocol-badge', protocolLabel(model.protocol))),
      cell(capabilities),
      cell(pricing),
      cell(latencyElement(model.lastTestLatencyMs)),
      cell(
        inlineStatusToggle(
          model.active,
          status,
          `${model.active ? copy.disableModel : copy.enableModel}: ${model.displayName}`,
          (button) => void toggleModel(model, button),
          model.active && !provider?.active ? 'warning' : '',
        ),
      ),
      cell(actions),
    )
    return row
  }
  function planModelAccess(plan: Plan): string {
    const modelBenefits = plan.benefits.filter(
      (benefit) => benefit.resourceType === 'model' && benefit.action === 'invoke',
    )
    if (modelBenefits.some((benefit) => benefit.resourceId == null)) return copy.allModelsAllowed
    const count = new Set(modelBenefits.map((benefit) => benefit.resourceId).filter(Boolean)).size
    return count ? interpolate(copy.modelAccessCount, { count }) : copy.noModelAccess
  }
  function planOfferSummary(plan: Plan): HTMLElement {
    const summary = document.createElement('div')
    summary.className = 'plan-offer-summary'
    if (plan.isDefault) {
      summary.append(
        textElement('strong', '', copy.freePlan),
        textElement('span', '', copy.noPaymentRequired),
      )
      return summary
    }
    if (!plan.offers.length) {
      summary.append(textElement('span', 'plan-cell-empty', copy.noPaymentOffers))
      return summary
    }
    const first = plan.offers[0]
    let price = `${first.currency} ${first.amountMinor / 100}`
    try {
      price = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', {
        style: 'currency',
        currency: first.currency,
      }).format(first.amountMinor / 100)
    } catch {}
    summary.append(
      textElement('strong', '', price),
      textElement('span', '', interpolate(copy.paymentChannelCount, { count: plan.offers.length })),
    )
    return summary
  }
  function planRow(plan: Plan): HTMLTableRowElement {
    const row = document.createElement('tr')
    const name = localized(plan.displayNameI18n, plan.displayName)
    const identity = document.createElement('div')
    identity.className = 'config-identity'
    identity.append(textElement('strong', '', name), textElement('code', '', plan.slug))
    row.append(
      cell(identity),
      cell(textElement('strong', 'plan-credit-value', fromMicros(plan.monthlyCreditMicros))),
      cell(textElement('span', 'plan-tier-value', String(plan.tierRank))),
      cell(textElement('span', 'plan-access-value', planModelAccess(plan))),
      cell(planOfferSummary(plan)),
      cell(
        statusBadge(
          plan.isDefault ? copy.defaultPlanType : copy.standardPlanType,
          plan.isDefault ? 'active' : 'inactive',
        ),
      ),
      cell(editButton(`${copy.edit}: ${name}`, () => editPlan(plan))),
    )
    return row
  }
  function render(): void {
    hideProviderModelPopover(true)
    const providerTable = root.querySelector<HTMLTableElement>('[data-provider-table]')!
    const providerList = root.querySelector<HTMLTableSectionElement>('[data-provider-list]')!
    const providerEmpty = root.querySelector<HTMLElement>('[data-provider-empty]')!
    providerPage = Math.min(
      providerPage,
      Math.max(1, Math.ceil(modelCatalog.providers.length / providerPageSize)),
    )
    providerTable.hidden = modelCatalog.providers.length === 0
    providerEmpty.hidden = modelCatalog.providers.length > 0
    providerList.replaceChildren(
      ...pagedItems(modelCatalog.providers, providerPage, providerPageSize).map(providerRow),
    )
    providerPagination.set({
      page: providerPage,
      pageSize: providerPageSize,
      totalItems: modelCatalog.providers.length,
    })
    syncProviderOptions()
    const modelTable = root.querySelector<HTMLTableElement>('[data-model-table]')!
    const modelList = root.querySelector<HTMLTableSectionElement>('[data-model-list]')!
    const modelEmpty = root.querySelector<HTMLElement>('[data-model-empty]')!
    modelPage = Math.min(
      modelPage,
      Math.max(1, Math.ceil(modelCatalog.models.length / modelPageSize)),
    )
    modelTable.hidden = modelCatalog.models.length === 0
    modelEmpty.hidden = modelCatalog.models.length > 0
    modelList.replaceChildren(
      ...pagedItems(modelCatalog.models, modelPage, modelPageSize).map(modelRow),
    )
    modelPagination.set({
      page: modelPage,
      pageSize: modelPageSize,
      totalItems: modelCatalog.models.length,
    })
    const discoverableProviders = modelCatalog.providers.filter(
      (provider) => provider.active && provider.availableModels.length > 0,
    )
    root.querySelectorAll<HTMLButtonElement>('[data-new-model]').forEach((button) => {
      button.disabled = discoverableProviders.length === 0
      button.title = discoverableProviders.length === 0 ? copy.selectProviderFirst : ''
    })
    const modelAccess = root.querySelector<HTMLElement>('[data-plan-models]')!
    modelAccess.replaceChildren(
      ...(modelCatalog.models.length
        ? modelCatalog.models.map((model) => {
            const label = document.createElement('label')
            label.className = 'check'
            const input = document.createElement('input')
            input.type = 'checkbox'
            input.name = 'allowedModel'
            input.value = model.publicModelId
            const span = document.createElement('span')
            span.textContent = model.displayName
            label.append(input, span)
            return label
          })
        : [empty(copy.emptyModels)]),
    )
    const planTable = root.querySelector<HTMLTableElement>('[data-plan-table]')!
    const planList = root.querySelector<HTMLTableSectionElement>('[data-plan-list]')!
    const planEmpty = root.querySelector<HTMLElement>('[data-plan-empty]')!
    planPage = Math.min(planPage, Math.max(1, Math.ceil(planCatalog.plans.length / planPageSize)))
    planTable.hidden = planCatalog.plans.length === 0
    planEmpty.hidden = planCatalog.plans.length > 0
    planList.replaceChildren(...pagedItems(planCatalog.plans, planPage, planPageSize).map(planRow))
    planPagination.set({
      page: planPage,
      pageSize: planPageSize,
      totalItems: planCatalog.plans.length,
    })
    const topupList = root.querySelector<HTMLElement>('[data-topup-list]')!
    topupPage = Math.min(
      topupPage,
      Math.max(1, Math.ceil(topupCatalog.products.length / topupPageSize)),
    )
    topupList.replaceChildren(
      ...(topupCatalog.products.length
        ? pagedItems(topupCatalog.products, topupPage, topupPageSize).map((product) =>
            record(
              localized(product.displayNameI18n, product.displayName),
              `${fromMicros(product.creditMicros)} ${copy.permanentUnit}`,
              true,
              () => editTopUp(product),
            ),
          )
        : [empty(copy.emptyTopUps)]),
    )
    topupPagination.set({
      page: topupPage,
      pageSize: topupPageSize,
      totalItems: topupCatalog.products.length,
    })
  }

  function newProvider(): void {
    providerForm.reset()
    field(providerForm, 'providerId').value = ''
    field(providerForm, 'providerPresetId').value = 'openai'
    applyProviderPresetDefaults(true)
    providerDiscoveryModels = null
    providerDiscoveryLatency = null
    setChecked(providerForm, 'active', true)
    renderProviderDiscovery()
    title(providerDialog, copy.addProvider)
    providerDialog.showModal()
  }
  function editProvider(provider: Provider): void {
    providerForm.reset()
    for (const [name, value] of Object.entries({
      providerId: provider.providerId,
      providerPresetId: provider.providerPresetId || 'custom',
      slug: provider.slug,
      displayName: provider.displayName,
      providerKind: provider.providerKind,
      baseUrl: provider.baseUrl,
      apiKey: '',
    }))
      field(providerForm, name).value = value
    applyProviderPresetDefaults(false, provider.credentialConfigured)
    providerDiscoveryModels = provider.availableModels.length ? [...provider.availableModels] : null
    providerDiscoveryLatency = provider.lastTestLatencyMs ?? null
    setChecked(providerForm, 'active', provider.active)
    renderProviderDiscovery()
    title(providerDialog, copy.editProvider)
    providerDialog.showModal()
  }
  function newModel(): void {
    const provider = modelCatalog.providers.find(
      (candidate) => candidate.active && candidate.availableModels.length > 0,
    )
    if (!provider) {
      toast.warning(copy.selectProviderFirst)
      return
    }
    modelForm.reset()
    field(modelForm, 'modelId').value = ''
    field(modelForm, 'contextWindow').value = '128000'
    field(modelForm, 'maxOutputTokens').value = '8192'
    setChecked(modelForm, 'tools', true)
    setChecked(modelForm, 'active', true)
    syncProviderOptions(provider.providerId)
    ;(field(modelForm, 'inputPrice') as HTMLInputElement).setCustomValidity('')
    title(modelDialog, copy.addModel)
    modelDialog.showModal()
  }
  function editModel(model: Model): void {
    modelForm.reset()
    syncProviderOptions(model.upstreamProviderId, model.upstreamModelId)
    for (const [name, value] of Object.entries({
      modelId: model.modelId,
      publicModelId: model.publicModelId,
      displayName: model.displayName,
      upstreamProviderId: model.upstreamProviderId,
      upstreamModelId: model.upstreamModelId,
      contextWindow: capability(model, 'context_window', 128000),
      maxOutputTokens: capability(model, 'max_output_tokens', 8192),
      inputPrice: fromMicros(model.pricing.inputCreditMicrosPerMillion),
      outputPrice: fromMicros(model.pricing.outputCreditMicrosPerMillion),
      cacheReadPrice: fromMicros(model.pricing.cacheReadCreditMicrosPerMillion),
      cacheWritePrice: fromMicros(model.pricing.cacheWriteCreditMicrosPerMillion),
      fixedPrice: fromMicros(model.pricing.fixedCreditMicrosPerRequest),
    }))
      field(modelForm, name).value = String(value)
    syncProtocols(model.protocol)
    setChecked(
      modelForm,
      'vision',
      (capability(model, 'input_modalities', []) as string[]).includes('image'),
    )
    setChecked(modelForm, 'tools', Boolean(capability(model, 'tool_calling', true)))
    setChecked(modelForm, 'reasoning', Boolean(capability(model, 'reasoning', false)))
    setChecked(modelForm, 'promptCache', Boolean(capability(model, 'prompt_cache', false)))
    setChecked(
      modelForm,
      'structuredOutput',
      Boolean(capability(model, 'structured_output', false)),
    )
    setChecked(modelForm, 'active', model.active)
    ;(field(modelForm, 'inputPrice') as HTMLInputElement).setCustomValidity('')
    title(modelDialog, copy.editModel)
    modelDialog.showModal()
  }
  function newPlan(): void {
    planForm.reset()
    field(planForm, 'planId').value = ''
    setOfferRows(planOfferRows, [], 0)
    syncPlanOffers()
    root.querySelectorAll<HTMLInputElement>('[name="allowedModel"]').forEach((input) => {
      input.checked = false
    })
    title(planDialog, copy.addPlan)
    planDialog.showModal()
  }
  function editPlan(plan: Plan): void {
    const zhName = plan.displayNameI18n?.['zh-CN'] || plan.displayName
    const enName = plan.displayNameI18n?.en || plan.displayName
    const zhDescription = plan.descriptionI18n?.['zh-CN'] || plan.description
    const enDescription = plan.descriptionI18n?.en || plan.description
    for (const [name, value] of Object.entries({
      planId: plan.planId,
      slug: plan.slug,
      displayNameZh: zhName,
      displayNameEn: enName,
      descriptionZh: zhDescription,
      descriptionEn: enDescription,
      tierRank: plan.tierRank,
      monthlyCredits: fromMicros(plan.monthlyCreditMicros),
    }))
      field(planForm, name).value = String(value)
    setChecked(planForm, 'isDefault', plan.isDefault)
    setOfferRows(planOfferRows, plan.offers, 0)
    syncPlanOffers()
    const allowed = new Set(
      plan.benefits
        .filter((benefit) => benefit.resourceType === 'model' && benefit.action === 'invoke')
        .map((benefit) => benefit.resourceId),
    )
    root.querySelectorAll<HTMLInputElement>('[name="allowedModel"]').forEach((input) => {
      input.checked = allowed.has(input.value) || allowed.has(null)
    })
    title(planDialog, copy.editPlan)
    planDialog.showModal()
  }
  function newTopUp(): void {
    topupForm.reset()
    field(topupForm, 'productId').value = ''
    setOfferRows(topupOfferRows, [], 0.01)
    title(topupDialog, copy.addTopUp)
    topupDialog.showModal()
  }
  function editTopUp(product: TopUp): void {
    const zhName = product.displayNameI18n?.['zh-CN'] || product.displayName
    const enName = product.displayNameI18n?.en || product.displayName
    const zhDescription = product.descriptionI18n?.['zh-CN'] || product.description
    const enDescription = product.descriptionI18n?.en || product.description
    for (const [name, value] of Object.entries({
      productId: product.productId,
      slug: product.slug,
      displayNameZh: zhName,
      displayNameEn: enName,
      descriptionZh: zhDescription,
      descriptionEn: enDescription,
      credits: fromMicros(product.creditMicros),
    }))
      field(topupForm, name).value = String(value)
    setOfferRows(topupOfferRows, product.offers, 0.01)
    title(topupDialog, copy.editTopUp)
    topupDialog.showModal()
  }
  const pricingFields = ['inputPrice', 'outputPrice', 'fixedPrice'] as const
  function validateModelPricing(report = true): boolean {
    const requiredFields = isMediaProtocol() ? (['fixedPrice'] as const) : pricingFields
    const valid = requiredFields.some((name) => Number(field(modelForm, name).value) > 0)
    const input = field(
      modelForm,
      isMediaProtocol() ? 'fixedPrice' : 'inputPrice',
    ) as HTMLInputElement
    input.setCustomValidity(valid ? '' : copy.pricingRequired)
    if (!valid && report) input.reportValidity()
    return valid
  }
  async function load(): Promise<void> {
    state.hidden = false
    state.dataset.tone = 'neutral'
    state.textContent = copy.loading
    try {
      if (section === 'models') modelCatalog = await api<ModelCatalog>('/admin/model-catalog')
      if (section === 'plans')
        [modelCatalog, planCatalog] = await Promise.all([
          api<ModelCatalog>('/admin/model-catalog'),
          api<PlanCatalog>('/plans'),
        ])
      if (section === 'topups') topupCatalog = await api<TopUpCatalog>('/top-ups')
      render()
      content.hidden = false
      state.hidden = true
    } catch (reason) {
      content.hidden = true
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'btn btn-ghost'
      retry.textContent = copy.retry
      retry.onclick = () => void load()
      state.replaceChildren(retry)
    }
  }

  providerForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!providerDiscoveryModels?.length) {
      toast.warning(copy.discoveryRequired)
      return
    }
    setFormBusy(providerForm, true)
    try {
      modelCatalog = await api('/admin/model-providers', {
        method: 'POST',
        body: JSON.stringify({
          providerId: field(providerForm, 'providerId').value || null,
          providerPresetId: field(providerForm, 'providerPresetId').value,
          slug: field(providerForm, 'slug').value.trim(),
          displayName: field(providerForm, 'displayName').value.trim(),
          providerKind: field(providerForm, 'providerKind').value,
          baseUrl: field(providerForm, 'baseUrl').value.trim(),
          apiKey: field(providerForm, 'apiKey').value || null,
          availableModels: providerDiscoveryModels,
          lastTestLatencyMs: providerDiscoveryLatency,
          active: checked(providerForm, 'active'),
          expectedRevision: modelCatalog.revision,
        }),
      })
      providerDialog.close()
      render()
      announceSaved()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
    } finally {
      setFormBusy(providerForm, false)
      renderProviderDiscovery()
    }
  })
  modelForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!validateModelPricing()) return
    setFormBusy(modelForm, true)
    const provider = modelCatalog.providers.find(
      (item) => item.providerId === field(modelForm, 'upstreamProviderId').value,
    )
    const selected = provider?.availableModels.find(
      (model) => model.upstreamModelId === field(modelForm, 'upstreamModelId').value,
    )
    const inputModalities =
      selected?.inputModalities || (checked(modelForm, 'vision') ? ['text', 'image'] : ['text'])
    const outputModalities = selected?.outputModalities || ['text']
    try {
      modelCatalog = await api('/admin/models', {
        method: 'POST',
        body: JSON.stringify({
          modelId: field(modelForm, 'modelId').value || null,
          publicModelId: field(modelForm, 'publicModelId').value.trim(),
          displayName: field(modelForm, 'displayName').value.trim(),
          upstreamProviderId: field(modelForm, 'upstreamProviderId').value,
          upstreamModelId: field(modelForm, 'upstreamModelId').value.trim(),
          protocol: field(modelForm, 'protocol').value,
          capability: {
            input_modalities: inputModalities,
            output_modalities: outputModalities,
            asynchronous: selected?.asynchronous || false,
            context_window: Number(field(modelForm, 'contextWindow').value),
            max_output_tokens: Number(field(modelForm, 'maxOutputTokens').value),
            streaming: !isMediaProtocol(),
            tool_calling: !isMediaProtocol() && checked(modelForm, 'tools'),
            reasoning: !isMediaProtocol() && checked(modelForm, 'reasoning'),
            prompt_cache: !isMediaProtocol() && checked(modelForm, 'promptCache'),
            structured_output: !isMediaProtocol() && checked(modelForm, 'structuredOutput'),
            hosted_tool_search: false,
            tool_observation_protocol: null,
          },
          pricing: {
            inputCreditMicrosPerMillion: toMicros(field(modelForm, 'inputPrice').value),
            outputCreditMicrosPerMillion: toMicros(field(modelForm, 'outputPrice').value),
            cacheReadCreditMicrosPerMillion: toMicros(field(modelForm, 'cacheReadPrice').value),
            cacheWriteCreditMicrosPerMillion: toMicros(field(modelForm, 'cacheWritePrice').value),
            fixedCreditMicrosPerRequest: toMicros(field(modelForm, 'fixedPrice').value),
          },
          active: checked(modelForm, 'active'),
          expectedRevision: modelCatalog.revision,
        }),
      })
      modelDialog.close()
      render()
      announceSaved()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
    } finally {
      setFormBusy(modelForm, false)
    }
  })
  planForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    setFormBusy(planForm, true)
    const isDefault = checked(planForm, 'isDefault')
    const benefits = [
      ...root.querySelectorAll<HTMLInputElement>('[name="allowedModel"]:checked'),
    ].map((input) => ({
      code: `model:${input.value}:invoke`,
      resourceType: 'model',
      resourceId: input.value,
      action: 'invoke',
      limit: {},
    }))
    const zhName = field(planForm, 'displayNameZh').value.trim()
    const enName = field(planForm, 'displayNameEn').value.trim()
    const zhDescription = field(planForm, 'descriptionZh').value.trim()
    const enDescription = field(planForm, 'descriptionEn').value.trim()
    try {
      planCatalog = await api('/admin/plans', {
        method: 'POST',
        body: JSON.stringify({
          planId: field(planForm, 'planId').value || null,
          slug: field(planForm, 'slug').value,
          displayName: zhName,
          description: zhDescription,
          displayNameI18n: { 'zh-CN': zhName, en: enName },
          descriptionI18n: { 'zh-CN': zhDescription, en: enDescription },
          tierRank: Number(field(planForm, 'tierRank').value),
          isDefault,
          monthlyCreditMicros: toMicros(field(planForm, 'monthlyCredits').value),
          offers: isDefault ? [] : collectOffers(planOfferRows),
          benefits,
          expectedRevision: planCatalog.revision,
        }),
      })
      planDialog.close()
      render()
      announceSaved()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
    } finally {
      setFormBusy(planForm, false)
    }
  })
  topupForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    setFormBusy(topupForm, true)
    const zhName = field(topupForm, 'displayNameZh').value.trim()
    const enName = field(topupForm, 'displayNameEn').value.trim()
    const zhDescription = field(topupForm, 'descriptionZh').value.trim()
    const enDescription = field(topupForm, 'descriptionEn').value.trim()
    try {
      topupCatalog = await api('/admin/top-ups', {
        method: 'POST',
        body: JSON.stringify({
          productId: field(topupForm, 'productId').value || null,
          slug: field(topupForm, 'slug').value,
          displayName: zhName,
          description: zhDescription,
          displayNameI18n: { 'zh-CN': zhName, en: enName },
          descriptionI18n: { 'zh-CN': zhDescription, en: enDescription },
          creditMicros: toMicros(field(topupForm, 'credits').value),
          offers: collectOffers(topupOfferRows),
          expectedRevision: topupCatalog.revision,
        }),
      })
      topupDialog.close()
      render()
      announceSaved()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.unavailable)
    } finally {
      setFormBusy(topupForm, false)
    }
  })

  root.querySelectorAll('[data-new-provider]').forEach((button) => {
    button.addEventListener('click', newProvider)
  })
  root.querySelectorAll('[data-new-model]').forEach((button) => {
    button.addEventListener('click', newModel)
  })
  root.querySelector('[data-new-plan]')?.addEventListener('click', newPlan)
  root.querySelector('[data-new-topup]')?.addEventListener('click', newTopUp)
  root.querySelectorAll<HTMLButtonElement>('[data-model-tab]').forEach((button) => {
    button.addEventListener('click', () =>
      selectModelTab(button.dataset.modelTab === 'models' ? 'models' : 'providers'),
    )
  })
  discoverProviderButton.addEventListener('click', () => void discoverProviderModels())
  testModelButton.addEventListener('click', () => void testModel())
  field(providerForm, 'providerPresetId').addEventListener('change', () => {
    applyProviderPresetDefaults(true)
    invalidateProviderDiscovery()
  })
  for (const name of ['providerKind', 'baseUrl', 'apiKey'])
    field(providerForm, name).addEventListener(
      name === 'providerKind' ? 'change' : 'input',
      invalidateProviderDiscovery,
    )
  field(modelForm, 'upstreamProviderId').addEventListener('change', () => {
    syncProtocols()
    syncUpstreamModelOptions()
  })
  field(modelForm, 'upstreamModelId').addEventListener('change', applySelectedModelDefaults)
  field(modelForm, 'protocol').addEventListener('change', syncModelFormMode)
  pricingFields.forEach((name) => {
    field(modelForm, name).addEventListener('input', () => validateModelPricing(false))
  })
  field(planForm, 'isDefault').addEventListener('change', syncPlanOffers)
  root
    .querySelector('[data-add-plan-offer]')
    ?.addEventListener('click', () => planOfferRows.append(offerRow(defaultOffer(), 0)))
  root
    .querySelector('[data-add-topup-offer]')
    ?.addEventListener('click', () => topupOfferRows.append(offerRow(defaultOffer(), 0.01)))
  root.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest<HTMLDialogElement>('dialog')?.close())
  })
  providerPaginationRoot?.addEventListener('pagination:change', ((
    event: CustomEvent<PaginationChange>,
  ) => {
    providerPage = event.detail.page
    providerPageSize = event.detail.pageSize
    render()
  }) as EventListener)
  modelPaginationRoot?.addEventListener('pagination:change', ((
    event: CustomEvent<PaginationChange>,
  ) => {
    modelPage = event.detail.page
    modelPageSize = event.detail.pageSize
    render()
  }) as EventListener)
  planPaginationRoot?.addEventListener('pagination:change', ((
    event: CustomEvent<PaginationChange>,
  ) => {
    planPage = event.detail.page
    planPageSize = event.detail.pageSize
    render()
  }) as EventListener)
  topupPaginationRoot?.addEventListener('pagination:change', ((
    event: CustomEvent<PaginationChange>,
  ) => {
    topupPage = event.detail.page
    topupPageSize = event.detail.pageSize
    render()
  }) as EventListener)
  providerModelPopover.addEventListener('mouseenter', cancelProviderModelPopoverClose)
  providerModelPopover.addEventListener('mouseleave', scheduleProviderModelPopoverClose)
  document.addEventListener('click', (event) => {
    if (
      !providerModelPopover.contains(event.target as Node) &&
      event.target !== providerModelPopoverTrigger
    )
      hideProviderModelPopover(true)
  })
  window.addEventListener(
    'scroll',
    (event) => {
      if (event.target !== providerModelPopover) hideProviderModelPopover(true)
    },
    true,
  )
  window.addEventListener('resize', () => hideProviderModelPopover(true))
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideProviderModelPopover(true)
  })
  for (const dialog of [providerDialog, modelDialog, planDialog, topupDialog])
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })
  window.addEventListener('market-auth-changed', () => void load())
  void load()
}

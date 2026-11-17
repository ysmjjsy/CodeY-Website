const models = {
  claude: {
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic · 对话与推理',
    monogram: 'C/',
    input: 21.6,
    output: 108,
    description: '面向复杂推理、代码开发与长文本任务的模型报价演示。',
  },
  openai: {
    name: 'GPT-5.2',
    provider: 'OpenAI · 通用与推理',
    monogram: 'O/',
    input: 12.5,
    output: 100,
    description: '面向通用推理、工具调用与代码开发场景的模型报价演示。',
  },
  deepseek: {
    name: 'DeepSeek V3.2',
    provider: 'DeepSeek · 通用与代码',
    monogram: 'D/',
    input: 2,
    output: 3,
    description: '面向日常对话、内容处理与代码任务的模型报价演示。',
  },
  gemini: {
    name: 'Gemini 3 Pro',
    provider: 'Google · 多模态与推理',
    monogram: 'G/',
    input: 14.2,
    output: 85.2,
    description: '面向多模态理解、复杂推理与内容生成的模型报价演示。',
  },
}

const tokenPresets = [2000, 5000, 10000, 20000, 40000, 80000, 120000, 200000, 400000, 800000]
const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const tokens = new Intl.NumberFormat('zh-CN')
let currentModel = models.claude
let balance = 200
let selectedAmount = 100
let toastTimer

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
function updateMotionPreference() {
  if (reducedMotion.matches) document.querySelector('.signal-map').pauseAnimations()
  else document.querySelector('.signal-map').unpauseAnimations()
}
reducedMotion.addEventListener('change', updateMotionPreference)
updateMotionPreference()
function formatCompactTokens(value) {
  return value >= 1000 ? `${value / 1000}K` : String(value)
}

function formatCost(value) {
  return `¥ ${value.toFixed(3)}`
}

function updateEstimate() {
  const inputTokens = tokenPresets[Number(document.querySelector('#token-range').value) - 1]
  const outputTokens = inputTokens / 5
  const cost = (inputTokens * currentModel.input + outputTokens * currentModel.output) / 1000000
  document.querySelector('#token-output').textContent = `${formatCompactTokens(inputTokens)} 输入 · ${formatCompactTokens(outputTokens)} 输出`
  document.querySelector('#quote-total').textContent = formatCost(cost)
  document.querySelector('#scene-tokens').textContent = `${formatCompactTokens(inputTokens)} → ${formatCompactTokens(outputTokens)}`
  document.querySelector('#token-range').setAttribute('aria-valuetext', `${tokens.format(inputTokens)} 输入 Token，${tokens.format(outputTokens)} 输出 Token，预计 ${formatCost(cost)}`)
}

function selectModel(id) {
  const model = models[id]
  if (!model) return
  currentModel = model
  document.querySelector('#quote-name').textContent = model.name
  document.querySelector('#quote-provider').textContent = model.provider
  document.querySelector('#quote-monogram').textContent = model.monogram
  document.querySelector('#quote-input').textContent = `¥ ${money.format(model.input)}`
  document.querySelector('#quote-output').textContent = `¥ ${money.format(model.output)}`
  const activeRoute = document.querySelector(`#route-${id}`)
  if (activeRoute) {
    document.querySelectorAll('.signal-path:not(.output-path)').forEach((path) => {
      path.classList.toggle('is-active', path === activeRoute)
    })
    const packet = document.querySelector('#input-signal animateMotion')
    packet.setAttribute('path', activeRoute.getAttribute('d'))
    packet.beginElement()
    document.querySelector('#scene-model').textContent = `${model.name.toUpperCase()} / CONNECTED`
  }
  document.querySelectorAll('[data-model]').forEach((button) => {
    const active = button.dataset.model === id
    button.classList.toggle('is-selected', active)
    button.setAttribute('aria-pressed', String(active))
  })
  updateEstimate()
}

function showToast(message) {
  const toast = document.querySelector('.toast')
  document.querySelector('#toast-message').textContent = message
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.hidden = true }, 3600)
}

function openDialog(id) {
  const dialog = document.getElementById(id)
  if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal()
}

function closeDialog(button) {
  const dialog = button.closest('dialog')
  if (dialog) dialog.close()
  if (button.dataset.openNext) openDialog(button.dataset.openNext)
}

function filterModels() {
  const activeFilter = document.querySelector('[data-filter].is-active').dataset.filter
  const query = document.querySelector('#model-search').value.trim().toLowerCase()
  let visibleCount = 0
  document.querySelectorAll('#model-list tr').forEach((row) => {
    const inCategory = activeFilter === 'all' || row.dataset.tags.split(' ').includes(activeFilter)
    const matchesSearch = row.dataset.search.includes(query)
    row.hidden = !(inCategory && matchesSearch)
    if (!row.hidden) visibleCount += 1
  })
  document.querySelector('#market-empty').hidden = visibleCount > 0
}

const journeys = {
  connect: {
    label: '从已有能力开始',
    title: '把模型带到统一的调用入口。',
    description: '连接你的模型服务，填写接口和能力信息。发布前检查可用性，让用户能够稳定找到并调用它。',
    state: '接入配置', name: '你的模型', provider: '你的团队 · 模型提供方', listing: '用清晰的一句话，说明模型最擅长解决什么问题。', tags: '等待填写', price: '等待配置', status: '尚未发布',
  },
  describe: {
    label: '让选择变得简单',
    title: '说清楚模型适合什么任务。',
    description: '用具体的场景和能力标签帮助用户判断。与其堆叠技术名词，不如告诉他们这个模型能解决什么问题。',
    state: '能力介绍', name: '你的模型', provider: '你的团队 · 模型提供方', listing: '面向长文档理解与专业知识问答的模型服务。', tags: '文档 · 推理', price: '等待配置', status: '尚未发布',
  },
  price: {
    label: '价格先于调用',
    title: '让每一次调用的成本清楚可见。',
    description: '设置价格与计量单位，并在模型页清楚展示。不同计费模式的实际规则，以正式平台能力为准。',
    state: '计费配置', name: '你的模型', provider: '你的团队 · 模型提供方', listing: '面向长文档理解与专业知识问答的模型服务。', tags: '文档 · 推理', price: '按规则设置', status: '等待检查',
  },
  publish: {
    label: '从能力到服务',
    title: '发布给真正需要它的用户。',
    description: '确认接口、介绍和价格，将模型开放给市场用户。发布后查看调用与用量记录，持续完善模型服务。',
    state: '开放调用', name: '你的模型', provider: '你的团队 · 模型提供方', listing: '面向长文档理解与专业知识问答的模型服务。', tags: '文档 · 推理', price: '价格已公示', status: '开放调用',
  },
}

function selectJourney(id) {
  const journey = journeys[id]
  if (!journey) return
  document.querySelectorAll('[data-step]').forEach((button) => {
    const active = button.dataset.step === id
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  const fields = { 'journey-label': journey.label, 'journey-title': journey.title, 'journey-description': journey.description, 'listing-state': journey.state, 'listing-name': journey.name, 'listing-provider': journey.provider, 'listing-description': journey.listing, 'listing-tags': journey.tags, 'listing-price': journey.price, 'listing-status': journey.status }
  Object.entries(fields).forEach(([id, value]) => { document.getElementById(id).textContent = value })
}

document.querySelectorAll('[data-model]').forEach((button) => button.addEventListener('click', () => selectModel(button.dataset.model)))
document.querySelector('#token-range').addEventListener('input', updateEstimate)
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openDialog(button.dataset.open)))
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button)))
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return
  const bounds = dialog.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close()
}))
document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.scroll).scrollIntoView({ behavior: 'smooth' })))
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach((filter) => {
    const active = filter === button
    filter.classList.toggle('is-active', active)
    filter.setAttribute('aria-pressed', String(active))
  })
  filterModels()
}))
document.querySelector('#model-search').addEventListener('input', filterModels)
document.querySelector('#clear-search').addEventListener('click', () => {
  document.querySelector('#model-search').value = ''
  document.querySelector('[data-filter="all"]').click()
  document.querySelector('#model-search').focus()
})
document.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => selectJourney(button.dataset.step)))
document.querySelectorAll('[data-details]').forEach((button) => button.addEventListener('click', () => {
  const model = models[button.dataset.details]
  document.querySelector('#detail-title').textContent = model.name
  document.querySelector('#detail-description').textContent = model.description
  document.querySelector('#detail-input').textContent = `¥ ${money.format(model.input)}`
  document.querySelector('#detail-output').textContent = `¥ ${money.format(model.output)}`
  openDialog('model-dialog')
}))
document.querySelectorAll('[data-amount]').forEach((button) => button.addEventListener('click', () => {
  selectedAmount = Number(button.dataset.amount)
  document.querySelectorAll('[data-amount]').forEach((option) => {
    const active = option === button
    option.classList.toggle('is-selected', active)
    option.setAttribute('aria-pressed', String(active))
  })
  document.querySelector('#topup-credit').textContent = `¥ ${money.format(selectedAmount)} 调用额度`
}))
document.querySelector('#demo-payment').addEventListener('click', () => {
  balance += selectedAmount
  document.querySelector('.wallet-balance > strong').textContent = `¥ ${money.format(balance)}`
  document.querySelector('#modal-balance').textContent = `¥ ${money.format(balance)}`
  document.querySelector('#topup-dialog').close()
  showToast(`演示充值完成：余额增加 ¥ ${money.format(selectedAmount)}，未发起真实支付`)
})
document.querySelector('[data-copy="code"]').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector('#code-snippet').textContent)
    showToast('调用示例已复制，请替换示例地址与模型名')
  } catch {
    showToast('浏览器未允许复制，请选中代码手动复制')
  }
})
document.querySelectorAll('[data-action="signin"]').forEach((button) => button.addEventListener('click', () => showToast('原型不连接账号系统，正式页面将跳转至登录')))
document.querySelector('[data-action="all-models"]').addEventListener('click', () => showToast('正式页面将跳转至完整模型广场，此处仅展示筛选交互'))
document.querySelector('#codey').addEventListener('click', (event) => {
  event.preventDefault()
  showToast('CodeY 仅保留产品入口，完整介绍请前往对应产品页')
})
const menuButton = document.querySelector('.menu-button')
menuButton.addEventListener('click', () => {
  const navigation = document.querySelector('#mobile-nav')
  navigation.hidden = !navigation.hidden
  menuButton.setAttribute('aria-expanded', String(!navigation.hidden))
  menuButton.setAttribute('aria-label', navigation.hidden ? '打开导航' : '关闭导航')
})
document.querySelectorAll('#mobile-nav a').forEach((link) => link.addEventListener('click', () => {
  document.querySelector('#mobile-nav').hidden = true
  menuButton.setAttribute('aria-expanded', 'false')
  menuButton.setAttribute('aria-label', '打开导航')
}))
selectModel('claude')

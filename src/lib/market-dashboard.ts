import { localizedApiError } from '../i18n/api-errors'
import { createPagination, type PaginationChange, pagedItems } from './pagination'
import { toast } from './toast'

type User = {
  userId: string
  username: string
  displayName: string
  role: 'user' | 'admin'
}
type AuthResponse = { user?: User | null }
type SubmissionStatus = 'pending' | 'approved' | 'rejected'
type Submission = {
  submissionId: string
  owner: { displayName: string; username: string }
  preview: { packageId: string; version: string; requestedPermissions: string[] }
  request: { title: string; summary: string }
  status: SubmissionStatus
  reviewNote?: string | null
  submittedAt: string
  reviewedAt?: string | null
  reviewer?: { displayName: string; username: string } | null
  release?: { listingId: string } | null
}

export function initMarketDashboard(): void {
  const rootEl = document.querySelector<HTMLElement>('[data-market-dashboard]')
  if (!rootEl) return
  const root = rootEl
  const copy = JSON.parse(root.dataset.copy || '{}') as Record<string, string>
  const locale = root.dataset.locale === 'en' ? 'en' : 'zh-CN'
  const detailBase = root.dataset.detailBase || '/market/item/'
  const initialSection = root.dataset.initialSection === 'review' ? 'review' : 'templates'
  const access = root.querySelector<HTMLElement>('[data-dashboard-access]')!
  const section = root.querySelector<HTMLElement>(`[data-dashboard-section="${initialSection}"]`)
  const templateRows = root.querySelector<HTMLTableSectionElement>('[data-template-rows]')
  const templateState = root.querySelector<HTMLElement>('[data-template-state]')
  const templateResultCount = root.querySelector<HTMLElement>('[data-template-result-count]')
  const reviewHistoryRows = root.querySelector<HTMLTableSectionElement>(
    '[data-review-history-rows]',
  )
  const reviewHistoryState = root.querySelector<HTMLElement>('[data-review-history-state]')
  const reviewPendingRows = root.querySelector<HTMLTableSectionElement>(
    '[data-review-pending-rows]',
  )
  const reviewPendingState = root.querySelector<HTMLElement>('[data-review-pending-state]')
  const reviewCount = root.querySelector<HTMLElement>('[data-review-count]')
  const reviewHistoryCount = root.querySelector<HTMLElement>('[data-review-history-count]')
  const reviewDialog = root.querySelector<HTMLDialogElement>('[data-review-dialog]')
  const reviewNote = root.querySelector<HTMLTextAreaElement>('[data-review-note]')
  const templatePaginationRoot = root.querySelector<HTMLElement>('[data-template-pagination]')
  const reviewHistoryPaginationRoot = root.querySelector<HTMLElement>(
    '[data-review-history-pagination]',
  )
  const reviewPendingPaginationRoot = root.querySelector<HTMLElement>(
    '[data-review-pending-pagination]',
  )
  const templatePagination = createPagination(templatePaginationRoot)
  const reviewHistoryPagination = createPagination(reviewHistoryPaginationRoot)
  const reviewPendingPagination = createPagination(reviewPendingPaginationRoot)
  let currentUser: User | null = null
  let submissionsRequest: Promise<Submission[]> | null = null
  let reviewRequest: Promise<[Submission[], Submission[]]> | null = null
  let selectedSubmission: Submission | null = null
  let templateEntries: Array<{ latest: Submission; versions: number }> = []
  let reviewHistoryEntries: Submission[] = []
  let reviewPendingEntries: Submission[] = []
  let templatePage = 1
  let templatePageSize = 10
  let reviewHistoryPage = 1
  let reviewHistoryPageSize = 10
  let reviewPendingPage = 1
  let reviewPendingPageSize = 10

  function text(tag: string, value: string, className?: string): HTMLElement {
    const element = document.createElement(tag)
    element.textContent = value
    if (className) element.className = className
    return element
  }

  function icon(name: string): HTMLElement {
    const element = document.createElement('i')
    element.className = `ph ph-${name}`
    element.setAttribute('aria-hidden', 'true')
    return element
  }

  function retryButton(action: () => void): HTMLButtonElement {
    const button = text('button', copy.retry, 'btn btn-ghost') as HTMLButtonElement
    button.type = 'button'
    button.addEventListener('click', action)
    return button
  }

  function formatDate(value: string | null | undefined): string {
    if (!value) return copy.noReviewNote
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }

  function statusLabel(status: SubmissionStatus): string {
    return copy[status]
  }

  function statusBadge(status: SubmissionStatus): HTMLElement {
    return text('span', statusLabel(status), `dashboard-status is-${status}`)
  }

  function templateIdentity(submission: Submission): HTMLElement {
    const cell = document.createElement('div')
    cell.className = 'dashboard-template-cell'
    const mark = document.createElement('span')
    mark.className = 'dashboard-template-mark'
    mark.append(icon('stack'))
    const body = document.createElement('div')
    body.append(
      text('strong', submission.request.title),
      text('span', submission.request.summary, 'dashboard-template-summary'),
      text('code', submission.preview.packageId),
    )
    cell.append(mark, body)
    return cell
  }

  async function errorMessage(response: Response): Promise<string> {
    return localizedApiError(response, locale, copy.loadError)
  }

  function latestTemplates(
    submissions: Submission[],
  ): Array<{ latest: Submission; versions: number }> {
    const grouped = new Map<string, Submission[]>()
    submissions.forEach((submission) => {
      const entries = grouped.get(submission.preview.packageId) || []
      entries.push(submission)
      grouped.set(submission.preview.packageId, entries)
    })
    return Array.from(grouped.values())
      .map((entries) => ({
        latest: entries.sort(
          (left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt),
        )[0]!,
        versions: entries.length,
      }))
      .sort(
        (left, right) => Date.parse(right.latest.submittedAt) - Date.parse(left.latest.submittedAt),
      )
  }

  function renderTemplateSummary(templates: Array<{ latest: Submission; versions: number }>): void {
    const counts: Record<'total' | SubmissionStatus, number> = {
      total: templates.length,
      pending: 0,
      approved: 0,
      rejected: 0,
    }
    templates.forEach(({ latest }) => {
      counts[latest.status] += 1
    })
    Object.entries(counts).forEach(([name, count]) => {
      const value = root.querySelector<HTMLElement>(`[data-stat="${name}"]`)
      if (value) value.textContent = String(count)
    })
    if (templateResultCount)
      templateResultCount.textContent = `${templates.length} ${copy.templateCountSuffix}`
  }

  function renderTemplateRow(entry: { latest: Submission; versions: number }): HTMLTableRowElement {
    const { latest, versions } = entry
    const row = document.createElement('tr')
    const name = document.createElement('td')
    name.append(templateIdentity(latest))
    const version = document.createElement('td')
    version.append(
      text('strong', `v${latest.preview.version}`),
      text('span', `${versions} ${copy.versionCountSuffix}`),
    )
    const status = document.createElement('td')
    status.append(statusBadge(latest.status))
    const submitted = text('td', formatDate(latest.submittedAt))
    const actions = document.createElement('td')
    actions.className = 'dashboard-actions-cell'
    if (latest.status === 'approved' && latest.release?.listingId) {
      const link = text('a', copy.view, 'dashboard-row-action') as HTMLAnchorElement
      link.href = `${detailBase}?id=${encodeURIComponent(latest.release.listingId)}`
      link.append(icon('arrow-up-right'))
      actions.append(link)
    } else {
      actions.append(text('span', copy.noReviewNote))
    }
    row.append(name, version, status, submitted, actions)
    return row
  }

  function renderTemplatePage(): void {
    if (!templateRows || !templateState) return
    const pageCount = Math.max(1, Math.ceil(templateEntries.length / templatePageSize))
    templatePage = Math.min(templatePage, pageCount)
    templateRows.replaceChildren(
      ...pagedItems(templateEntries, templatePage, templatePageSize).map(renderTemplateRow),
    )
    templateState.textContent = copy.empty
    templateState.hidden = templateEntries.length > 0
    templatePagination.set({
      page: templatePage,
      pageSize: templatePageSize,
      totalItems: templateEntries.length,
    })
  }

  async function loadSubmissions(force = false): Promise<void> {
    if (!currentUser || !templateRows || !templateState) return
    if (force) submissionsRequest = null
    if (!submissionsRequest) {
      templateState.hidden = false
      templateState.textContent = copy.loading
      submissionsRequest = fetch('/api/market/v1/submissions/mine', {
        headers: { Accept: 'application/json' },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await errorMessage(response))
          return response.json() as Promise<Submission[]>
        })
        .catch((error) => {
          submissionsRequest = null
          throw error
        })
    }
    try {
      templateEntries = latestTemplates(await submissionsRequest)
      templatePage = 1
      renderTemplateSummary(templateEntries)
      renderTemplatePage()
    } catch {
      toast.error(copy.loadError)
      templateState.replaceChildren(retryButton(() => void loadSubmissions(true)))
      templateState.hidden = false
    }
  }

  function renderReviewHistoryRow(submission: Submission): HTMLTableRowElement {
    const row = document.createElement('tr')
    const name = document.createElement('td')
    name.append(templateIdentity(submission))
    const uploader = document.createElement('td')
    uploader.append(
      text('strong', submission.owner.displayName),
      text('span', `@${submission.owner.username}`),
    )
    const result = document.createElement('td')
    result.append(statusBadge(submission.status))
    const reviewer = document.createElement('td')
    if (submission.reviewer) {
      reviewer.append(
        text('strong', submission.reviewer.displayName),
        text('span', `@${submission.reviewer.username}`),
      )
    } else {
      reviewer.append(text('span', copy.noReviewNote))
    }
    const reviewed = text('td', formatDate(submission.reviewedAt))
    const note = text('td', submission.reviewNote || copy.noReviewNote)
    note.className = 'dashboard-review-note-cell'
    row.append(name, uploader, result, reviewer, reviewed, note)
    return row
  }

  function openReview(submission: Submission): void {
    if (!reviewDialog || !reviewNote) return
    selectedSubmission = submission
    const title = root.querySelector<HTMLElement>('[data-review-dialog-title]')!
    const summary = root.querySelector<HTMLElement>('[data-review-dialog-summary]')!
    const detail = root.querySelector<HTMLElement>('[data-review-detail]')!
    title.textContent = submission.request.title
    summary.textContent = submission.request.summary
    detail.replaceChildren()
    const fields = [
      [copy.uploader, `${submission.owner.displayName} (@${submission.owner.username})`],
      [copy.packageVersion, `${submission.preview.packageId} · ${submission.preview.version}`],
      [copy.submittedAt, formatDate(submission.submittedAt)],
      [copy.permissions, submission.preview.requestedPermissions.join(', ') || copy.noPermissions],
    ]
    fields.forEach(([label, value]) => {
      const item = document.createElement('div')
      item.append(text('dt', label), text('dd', value))
      detail.append(item)
    })
    reviewNote.value = ''
    reviewDialog.showModal()
  }

  function renderPendingRow(submission: Submission): HTMLTableRowElement {
    const row = document.createElement('tr')
    const name = document.createElement('td')
    name.append(templateIdentity(submission))
    const uploader = document.createElement('td')
    uploader.append(
      text('strong', submission.owner.displayName),
      text('span', `@${submission.owner.username}`),
    )
    const version = text('td', `${submission.preview.packageId} · ${submission.preview.version}`)
    version.className = 'dashboard-mono'
    const submitted = text('td', formatDate(submission.submittedAt))
    const actions = document.createElement('td')
    const review = text(
      'button',
      copy.reviewAction,
      'btn btn-ghost dashboard-review-button',
    ) as HTMLButtonElement
    review.type = 'button'
    review.prepend(icon('shield-check'))
    review.addEventListener('click', () => openReview(submission))
    actions.append(review)
    row.append(name, uploader, version, submitted, actions)
    return row
  }

  function renderReviewData(pending: Submission[], history: Submission[]): void {
    reviewPendingEntries = pending
    reviewHistoryEntries = history
    reviewPendingPage = 1
    reviewHistoryPage = 1
    if (reviewCount) reviewCount.textContent = String(pending.length)
    if (reviewHistoryCount)
      reviewHistoryCount.textContent = `${history.length} ${copy.reviewCountSuffix}`
    renderReviewPendingPage()
    renderReviewHistoryPage()
  }

  function renderReviewPendingPage(): void {
    const pageCount = Math.max(1, Math.ceil(reviewPendingEntries.length / reviewPendingPageSize))
    reviewPendingPage = Math.min(reviewPendingPage, pageCount)
    reviewPendingRows?.replaceChildren(
      ...pagedItems(reviewPendingEntries, reviewPendingPage, reviewPendingPageSize).map(
        renderPendingRow,
      ),
    )
    if (reviewPendingState) {
      reviewPendingState.textContent = copy.reviewEmpty
      reviewPendingState.hidden = reviewPendingEntries.length > 0
    }
    reviewPendingPagination.set({
      page: reviewPendingPage,
      pageSize: reviewPendingPageSize,
      totalItems: reviewPendingEntries.length,
    })
  }

  function renderReviewHistoryPage(): void {
    const pageCount = Math.max(1, Math.ceil(reviewHistoryEntries.length / reviewHistoryPageSize))
    reviewHistoryPage = Math.min(reviewHistoryPage, pageCount)
    reviewHistoryRows?.replaceChildren(
      ...pagedItems(reviewHistoryEntries, reviewHistoryPage, reviewHistoryPageSize).map(
        renderReviewHistoryRow,
      ),
    )
    if (reviewHistoryState) {
      reviewHistoryState.textContent = copy.reviewHistoryEmpty
      reviewHistoryState.hidden = reviewHistoryEntries.length > 0
    }
    reviewHistoryPagination.set({
      page: reviewHistoryPage,
      pageSize: reviewHistoryPageSize,
      totalItems: reviewHistoryEntries.length,
    })
  }

  async function loadReviewData(force = false): Promise<void> {
    if (!currentUser || currentUser.role !== 'admin' || !reviewPendingRows || !reviewHistoryRows)
      return
    if (force) reviewRequest = null
    if (!reviewRequest) {
      if (reviewPendingState) {
        reviewPendingState.hidden = false
        reviewPendingState.textContent = copy.reviewLoading
      }
      if (reviewHistoryState) {
        reviewHistoryState.hidden = false
        reviewHistoryState.textContent = copy.reviewHistoryLoading
      }
      reviewRequest = Promise.all([
        fetch('/api/market/v1/admin/submissions', { headers: { Accept: 'application/json' } }),
        fetch('/api/market/v1/admin/reviews', { headers: { Accept: 'application/json' } }),
      ])
        .then(async ([pendingResponse, historyResponse]) => {
          if (!pendingResponse.ok) throw new Error(await errorMessage(pendingResponse))
          if (!historyResponse.ok) throw new Error(await errorMessage(historyResponse))
          return Promise.all([
            pendingResponse.json() as Promise<Submission[]>,
            historyResponse.json() as Promise<Submission[]>,
          ]) as Promise<[Submission[], Submission[]]>
        })
        .catch((error) => {
          reviewRequest = null
          throw error
        })
    }
    try {
      const [pending, history] = await reviewRequest
      renderReviewData(pending, history)
    } catch {
      toast.error(copy.reviewLoadError)
      if (reviewPendingState)
        reviewPendingState.replaceChildren(retryButton(() => void loadReviewData(true)))
      if (reviewHistoryState)
        reviewHistoryState.replaceChildren(retryButton(() => void loadReviewData(true)))
    }
  }

  function selectReviewView(name: 'history' | 'pending'): void {
    root.querySelectorAll<HTMLButtonElement>('[data-review-view]').forEach((button) => {
      const active = button.dataset.reviewView === name
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
    })
    root.querySelectorAll<HTMLElement>('[data-review-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.reviewPanel !== name
    })
  }

  async function decide(decision: 'approve' | 'reject'): Promise<void> {
    if (!selectedSubmission || !reviewNote || !reviewDialog) return
    const buttons = Array.from(
      reviewDialog.querySelectorAll<HTMLButtonElement>('[data-review-decision]'),
    )
    buttons.forEach((button) => {
      button.disabled = true
    })
    const active = buttons.find((button) => button.dataset.reviewDecision === decision)
    if (active) active.textContent = decision === 'approve' ? copy.approving : copy.rejecting
    try {
      const response = await fetch(
        `/api/market/v1/admin/submissions/${encodeURIComponent(selectedSubmission.submissionId)}/${decision}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ note: reviewNote.value.trim() || null }),
        },
      )
      if (!response.ok) throw new Error(await errorMessage(response))
      reviewDialog.close()
      selectedSubmission = null
      await loadReviewData(true)
      toast.success(decision === 'approve' ? copy.approvedSuccess : copy.rejectedSuccess)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : copy.reviewLoadError)
    } finally {
      buttons.forEach((button) => {
        button.disabled = false
        button.textContent =
          button.dataset.reviewDecision === 'approve' ? copy.approve : copy.reject
      })
    }
  }

  function applyUser(user: User | null | undefined): void {
    currentUser = user || null
    access.hidden = Boolean(currentUser)
    if (!currentUser) {
      access.textContent = copy.signInRequired
      window.dispatchEvent(new CustomEvent('market-auth-required'))
      return
    }
    if (section) section.hidden = false
    if (initialSection === 'review') {
      if (currentUser.role === 'admin') void loadReviewData()
      else {
        if (reviewPendingState) reviewPendingState.textContent = copy.adminRequired
        if (reviewHistoryState) reviewHistoryState.textContent = copy.adminRequired
      }
    } else {
      void loadSubmissions()
    }
  }

  async function loadCurrentUser(): Promise<void> {
    try {
      const response = await fetch('/api/market/v1/auth/me', {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error()
      const payload = (await response.json()) as AuthResponse
      applyUser(payload.user)
    } catch {
      toast.error(copy.loadError)
      access.hidden = false
      access.replaceChildren(retryButton(() => void loadCurrentUser()))
    }
  }

  root.querySelectorAll<HTMLButtonElement>('[data-review-view]').forEach((button) => {
    button.addEventListener('click', () =>
      selectReviewView(button.dataset.reviewView === 'pending' ? 'pending' : 'history'),
    )
  })
  templatePaginationRoot?.addEventListener('pagination:change', ((
    event: CustomEvent<PaginationChange>,
  ) => {
    templatePage = event.detail.page
    templatePageSize = event.detail.pageSize
    renderTemplatePage()
  }) as EventListener)
  reviewHistoryPaginationRoot?.addEventListener('pagination:change', ((
    event: CustomEvent<PaginationChange>,
  ) => {
    reviewHistoryPage = event.detail.page
    reviewHistoryPageSize = event.detail.pageSize
    renderReviewHistoryPage()
  }) as EventListener)
  reviewPendingPaginationRoot?.addEventListener('pagination:change', ((
    event: CustomEvent<PaginationChange>,
  ) => {
    reviewPendingPage = event.detail.page
    reviewPendingPageSize = event.detail.pageSize
    renderReviewPendingPage()
  }) as EventListener)
  root
    .querySelector<HTMLElement>('[data-review-close]')
    ?.addEventListener('click', () => reviewDialog?.close())
  reviewDialog?.addEventListener('click', (event) => {
    if (event.target === reviewDialog) reviewDialog.close()
  })
  root.querySelectorAll<HTMLButtonElement>('[data-review-decision]').forEach((button) => {
    button.addEventListener(
      'click',
      () => void decide(button.dataset.reviewDecision === 'approve' ? 'approve' : 'reject'),
    )
  })
  window.addEventListener('market-auth-changed', ((event: CustomEvent<AuthResponse>) =>
    applyUser(event.detail.user)) as EventListener)
  window.addEventListener('market-submission-created', () => {
    if (initialSection === 'templates') void loadSubmissions(true)
  })
  void loadCurrentUser()
}

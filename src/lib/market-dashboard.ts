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
  const access = root.querySelector<HTMLElement>('[data-dashboard-access]')
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
  const reviewHistoryPaginationRoot = root.querySelector<HTMLElement>(
    '[data-review-history-pagination]',
  )
  const reviewPendingPaginationRoot = root.querySelector<HTMLElement>(
    '[data-review-pending-pagination]',
  )
  const reviewHistoryPagination = createPagination(reviewHistoryPaginationRoot)
  const reviewPendingPagination = createPagination(reviewPendingPaginationRoot)
  if (!access) return
  const dashboardAccess = access
  let currentUser: User | null = null
  let reviewRequest: Promise<[Submission[], Submission[]]> | null = null
  let selectedSubmission: Submission | null = null
  let reviewHistoryEntries: Submission[] = []
  let reviewPendingEntries: Submission[] = []
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

  function statusBadge(status: SubmissionStatus): HTMLElement {
    return text('span', copy[status], `dashboard-status is-${status}`)
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
    return localizedApiError(response, locale, copy.reviewLoadError)
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
    const title = root.querySelector<HTMLElement>('[data-review-dialog-title]')
    const summary = root.querySelector<HTMLElement>('[data-review-dialog-summary]')
    const detail = root.querySelector<HTMLElement>('[data-review-detail]')
    if (!title || !summary || !detail) return
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

  async function loadReviewData(force = false): Promise<void> {
    if (currentUser?.role !== 'admin' || !reviewPendingRows || !reviewHistoryRows) return
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
    dashboardAccess.hidden = Boolean(currentUser)
    if (!currentUser) {
      dashboardAccess.textContent = copy.signInRequired
      window.dispatchEvent(new CustomEvent('market-auth-required'))
      return
    }
    const section = root.querySelector<HTMLElement>('[data-dashboard-section="review"]')
    if (section) section.hidden = false
    if (currentUser.role === 'admin') void loadReviewData()
    else {
      if (reviewPendingState) reviewPendingState.textContent = copy.adminRequired
      if (reviewHistoryState) reviewHistoryState.textContent = copy.adminRequired
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
      toast.error(copy.reviewLoadError)
      dashboardAccess.hidden = false
      dashboardAccess.replaceChildren(retryButton(() => void loadCurrentUser()))
    }
  }

  root.querySelectorAll<HTMLButtonElement>('[data-review-view]').forEach((button) => {
    button.addEventListener('click', () =>
      selectReviewView(button.dataset.reviewView === 'pending' ? 'pending' : 'history'),
    )
  })
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
  void loadCurrentUser()
}

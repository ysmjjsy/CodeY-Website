export type PaginationChange = {
  page: number
  pageSize: number
}

export type PaginationState = {
  page: number
  pageSize?: number
  totalItems?: number
  hasNext?: boolean
}

type PaginationCopy = {
  page: string
  of: string
  items: string
}

export type PaginationController = {
  set: (state: PaginationState) => void
  reset: () => void
}

function pageRange(page: number, pageCount: number): Array<number | 'ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  const result: Array<number | 'ellipsis'> = []
  let previous = 0
  for (const value of [...pages].filter((item) => item > 0 && item <= pageCount).sort((a, b) => a - b)) {
    if (value - previous > 1) result.push('ellipsis')
    result.push(value)
    previous = value
  }
  return result
}

export function createPagination(root: HTMLElement | null): PaginationController {
  if (!root) {
    return { set: () => undefined, reset: () => undefined }
  }

  const copy = JSON.parse(root.dataset.copy || '{}') as PaginationCopy
  const locale = root.dataset.locale === 'en' ? 'en' : 'zh-CN'
  const summary = root.querySelector<HTMLElement>('[data-pagination-summary]')!
  const numbers = root.querySelector<HTMLElement>('[data-pagination-numbers]')!
  const previous = root.querySelector<HTMLButtonElement>('[data-pagination-previous]')!
  const next = root.querySelector<HTMLButtonElement>('[data-pagination-next]')!
  const size = root.querySelector<HTMLSelectElement>('[data-pagination-size]')!
  let current: Required<Pick<PaginationState, 'page' | 'pageSize'>> & Pick<PaginationState, 'totalItems' | 'hasNext'> = {
    page: 1,
    pageSize: Number(root.dataset.pageSize) || 10,
  }

  function emit(page: number, pageSize = current.pageSize): void {
    root.dispatchEvent(new CustomEvent<PaginationChange>('pagination:change', {
      bubbles: true,
      detail: { page, pageSize },
    }))
  }

  function pageButton(page: number): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = new Intl.NumberFormat(locale).format(page)
    button.setAttribute('aria-label', locale === 'en' ? `Page ${page}` : `第 ${page} 页`)
    button.setAttribute('aria-current', page === current.page ? 'page' : 'false')
    button.addEventListener('click', () => emit(page))
    return button
  }

  function render(): void {
    const hasTotal = typeof current.totalItems === 'number'
    const pageCount = hasTotal ? Math.max(1, Math.ceil(current.totalItems! / current.pageSize)) : undefined
    const hasItems = hasTotal ? current.totalItems! > 0 : current.page > 1 || Boolean(current.hasNext)
    root.hidden = !hasItems
    if (!hasItems) return

    if (hasTotal) {
      const start = Math.min((current.page - 1) * current.pageSize + 1, current.totalItems!)
      const end = Math.min(current.page * current.pageSize, current.totalItems!)
      summary.textContent = locale === 'en'
        ? `${start}–${end} ${copy.of} ${current.totalItems} ${copy.items}`
        : `${start}–${end} / ${copy.of} ${current.totalItems} ${copy.items}`
      numbers.replaceChildren(...pageRange(current.page, pageCount!).map((value) => {
        if (value !== 'ellipsis') return pageButton(value)
        const ellipsis = document.createElement('span')
        ellipsis.textContent = '…'
        ellipsis.setAttribute('aria-hidden', 'true')
        return ellipsis
      }))
      previous.disabled = current.page <= 1
      next.disabled = current.page >= pageCount!
    } else {
      summary.textContent = locale === 'en' ? `${copy.page} ${current.page}` : `${copy.page} ${current.page} 页`
      numbers.replaceChildren(pageButton(current.page))
      previous.disabled = current.page <= 1
      next.disabled = !current.hasNext
    }
    size.value = String(current.pageSize)
  }

  previous.addEventListener('click', () => emit(Math.max(1, current.page - 1)))
  next.addEventListener('click', () => emit(current.page + 1))
  size.addEventListener('change', () => emit(1, Number(size.value) || current.pageSize))

  return {
    set(state) {
      const pageSize = state.pageSize || current.pageSize
      const pageCount = typeof state.totalItems === 'number' ? Math.max(1, Math.ceil(state.totalItems / pageSize)) : undefined
      current = {
        page: Math.max(1, pageCount ? Math.min(state.page, pageCount) : state.page),
        pageSize,
        totalItems: state.totalItems,
        hasNext: state.hasNext,
      }
      render()
    },
    reset() {
      current.page = 1
      current.totalItems = 0
      current.hasNext = false
      render()
    },
  }
}

export function pagedItems<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize
  return items.slice(start, start + pageSize)
}

import { beforeEach, describe, expect, it } from 'vitest'

import { createPagination, type PaginationChange, pagedItems } from './pagination'

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Missing test element: ${selector}`)
  return element
}

function buildRoot(markup?: string): HTMLElement {
  document.body.innerHTML = `
    <nav data-test-pagination data-locale="en" data-page-size="10"
         data-copy='{"page":"Page","of":"of","items":"items"}'>
      <p data-pagination-summary></p>
      <select data-pagination-size></select>
      <button type="button" data-pagination-previous></button>
      <div data-pagination-numbers></div>
      <button type="button" data-pagination-next></button>
      ${markup ?? ''}
    </nav>
  `
  return query<HTMLElement>(document, '[data-test-pagination]')
}

describe('pagedItems', () => {
  it('slices by page and page size', () => {
    const items = [1, 2, 3, 4, 5]
    expect(pagedItems(items, 1, 2)).toEqual([1, 2])
    expect(pagedItems(items, 2, 2)).toEqual([3, 4])
    expect(pagedItems(items, 3, 2)).toEqual([5])
  })

  it('treats pages below one as the first page', () => {
    expect(pagedItems([1, 2, 3], 0, 2)).toEqual([1, 2])
    expect(pagedItems([1, 2, 3], -5, 2)).toEqual([1, 2])
  })
})

describe('createPagination', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns inert controllers when the root is missing', () => {
    const controller = createPagination(null)
    expect(() => {
      controller.set({ page: 2 })
      controller.reset()
    }).not.toThrow()
  })

  it('throws when the root is missing a required element', () => {
    document.body.innerHTML = '<nav data-test-pagination></nav>'
    const root = query<HTMLElement>(document, '[data-test-pagination]')
    expect(() => createPagination(root)).toThrow(/Pagination element not found/)
  })

  it('stays hidden when there is nothing to page', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 1, totalItems: 0 })
    expect(root.hidden).toBe(true)
  })

  it('renders a summary and disables previous on the first page', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 1, totalItems: 25, pageSize: 10 })

    expect(root.hidden).toBe(false)
    const summary = query<HTMLElement>(root, '[data-pagination-summary]')
    expect(summary.textContent).toContain('1–10')
    expect(summary.textContent).toContain('25')

    const previous = query<HTMLButtonElement>(root, '[data-pagination-previous]')
    const next = query<HTMLButtonElement>(root, '[data-pagination-next]')
    expect(previous.disabled).toBe(true)
    expect(next.disabled).toBe(false)
  })

  it('clamps the page to the last available page', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 99, totalItems: 25, pageSize: 10 })

    const summary = query<HTMLElement>(root, '[data-pagination-summary]')
    expect(summary.textContent).toContain('21–25')

    const next = query<HTMLButtonElement>(root, '[data-pagination-next]')
    expect(next.disabled).toBe(true)
  })

  it('marks the current page with aria-current', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 2, totalItems: 25, pageSize: 10 })

    const numbers = query<HTMLElement>(root, '[data-pagination-numbers]')
    const current = numbers.querySelector('[aria-current="page"]')
    expect(current?.textContent).toBe('2')
  })

  it('renders an ellipsis when there are many pages', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 10, totalItems: 500, pageSize: 10 })

    const numbers = query<HTMLElement>(root, '[data-pagination-numbers]')
    const ellipsis = [...numbers.querySelectorAll('span')].filter(
      (node) => node.textContent === '…',
    )
    expect(ellipsis.length).toBeGreaterThan(0)
  })

  it('emits pagination:change when navigating', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 2, totalItems: 25, pageSize: 10 })

    const events: PaginationChange[] = []
    root.addEventListener('pagination:change', (event) => {
      events.push((event as CustomEvent<PaginationChange>).detail)
    })

    query<HTMLButtonElement>(root, '[data-pagination-next]').click()
    expect(events).toEqual([{ page: 3, pageSize: 10 }])
  })

  it('resets back to the first page', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 3, totalItems: 100, pageSize: 10 })
    controller.reset()

    const summary = query<HTMLElement>(root, '[data-pagination-summary]')
    expect(summary.textContent).toContain('1–')
    expect(root.hidden).toBe(true)
  })

  it('supports the cursor mode without a total count', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 1, hasNext: true })

    expect(root.hidden).toBe(false)
    const next = query<HTMLButtonElement>(root, '[data-pagination-next]')
    expect(next.disabled).toBe(false)
    // Cursor mode keeps a page counter rather than an item range.
    const summary = query<HTMLElement>(root, '[data-pagination-summary]')
    expect(summary.textContent).toBe('Page 1')
  })

  it('hides itself in cursor mode when there is no next page on the first page', () => {
    const root = buildRoot()
    const controller = createPagination(root)
    controller.set({ page: 1, hasNext: false })

    expect(root.hidden).toBe(true)
  })
})

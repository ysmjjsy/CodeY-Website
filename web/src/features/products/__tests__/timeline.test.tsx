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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import { CodeyProduct } from '../codey'

/**
 * The product page shows one task the way the desktop app records it, and only
 * the step waiting for a decision stays open. The two ways out are the download
 * and the docs.
 */

describe('the CodeY product page', () => {
  it('records the task and leaves the last step waiting', async () => {
    const root = createRootRoute({ component: CodeyProduct })
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: '/docs/$section' }),
        createRoute({ getParentRoute: () => root, path: '/pricing' }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    // The page renders inside the public header, which reads the system config.
    useSystemConfigStore.getState().setLoading(false)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    await router.load()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    const timeline = await screen.findByRole('list')
    // The task plays in, so the assertion waits for the step that comes last.
    const waiting = await screen.findByText('Waiting for permission')
    const steps = timeline.querySelectorAll('li')
    expect(steps).toHaveLength(5)
    expect(steps[4]).toContainElement(waiting)

    // The finished steps carry the cyan mark. The one still waiting does not,
    // because nothing has been decided yet.
    const done = [...steps].filter((step) =>
      step.querySelector('.bg-brand-accent')
    )
    expect(done).toHaveLength(4)
    expect(steps[4]?.querySelector('.bg-brand-accent')).toBeNull()
    expect(timeline).toHaveTextContent('src/recovery.rs')
    expect(timeline).toHaveTextContent('5 passed')

    // The record stays inside the card. New steps scroll within it instead of
    // growing the page.
    expect(timeline.className).toContain('overflow-y-auto')
    expect(timeline.parentElement?.className).toContain('h-80')

    // The workspace list has to keep its own height. The shared tab list fixes
    // itself at 32px for a horizontal row, which would let the entries spill
    // into the section below.
    const workspace = screen.getByRole('tablist')
    expect(workspace.className).toContain('group-data-horizontal/tabs:h-auto')
    expect(workspace.querySelectorAll('[role="tab"]')).toHaveLength(6)

    // The first way out downloads CodeY; the second stays on the site, in the docs.
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'https://github.com/ysmjjsy/CodeY-Releases/releases/latest'
    )
    expect(
      screen.getByRole('link', { name: 'Read the CodeY docs' })
    ).toHaveAttribute('href', '/docs/codey')

    // The CodeY mark follows the name, and it is the vector mark rather than a
    // bitmap that would need inverting for the dark theme. The product menu in
    // the header repeats the name, so the page's own label is the uppercase one.
    const name = screen.getByText('CodeY', { selector: '.uppercase' })
    const mark = name.parentElement?.querySelector('img')
    expect(mark?.getAttribute('src')).toBe('/codey-mark.svg')
    expect(mark?.compareDocumentPosition(name)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING
    )
  })
})

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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CTA } from '../sections/cta'
import { Hero } from '../sections/hero'
import { Stats } from '../sections/stats'

/**
 * The homepage background is three layers: coordinate paper behind the hero
 * with two arcs over it, and a raised band behind the stats and the closing
 * call to action. The features, the steps, and the CodeY card stay on the
 * page background, and the arcs stay in the hero.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderWithRouter(node: React.ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router} />)
}

describe('the homepage background', () => {
  it('lays coordinate paper behind the hero and keeps it out of the way', async () => {
    class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)

    const { container } = renderWithRouter(<Hero />)
    const grid = await waitFor(() => {
      const found = container.querySelector('.hero-grid')
      expect(found).not.toBeNull()
      return found
    })
    expect(grid).toHaveAttribute('aria-hidden', 'true')
    expect(grid).toHaveClass('pointer-events-none')
    const section = grid?.parentElement
    expect(section?.className).toContain('overflow-hidden')

    // Two open arcs, centers off the page, drawn in the border color and
    // never filled. They live only in the hero.
    const arcs = section?.querySelectorAll('circle') ?? []
    expect(arcs).toHaveLength(2)
    for (const arc of arcs) {
      expect(arc.getAttribute('fill')).not.toBe('currentColor')
      expect(Number(arc.getAttribute('r'))).toBeGreaterThan(0)
      const cx = Number(arc.getAttribute('cx'))
      const cy = Number(arc.getAttribute('cy'))
      const inside = cx >= 0 && cx <= 1200 && cy >= 0 && cy <= 700
      expect(inside).toBe(false)
    }
    expect(section?.querySelector('svg')).toHaveClass('text-border')
  })

  it('raises the stats band off the page background', () => {
    const { container } = render(<Stats />)
    const band = container.firstElementChild

    expect(band).toHaveClass('bg-muted')
    expect(band).toHaveClass('dark:bg-card')
    expect(band).toHaveClass('border-y')
    expect(band?.querySelector('circle')).toBeNull()
  })

  it('raises the closing call to action the same way', async () => {
    const { container } = renderWithRouter(<CTA />)
    const band = await waitFor(() => {
      const found = container.querySelector('section')
      expect(found).not.toBeNull()
      return found
    })

    expect(band).toHaveClass('bg-muted')
    expect(band).toHaveClass('dark:bg-card')
  })

  it('hides the closing call once someone is signed in', async () => {
    const { container } = renderWithRouter(<CTA isAuthenticated />)

    expect(container.querySelector('section')).toBeNull()
  })
})

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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { GatewayRoutes } from '../gateway-routes'
import { RouteLine } from '../route-line'
import { Features } from '../sections/features'
import { HowItWorks } from '../sections/how-it-works'
import { Stats } from '../sections/stats'

vi.mock('@/features/pricing/hooks/use-pricing-data', () => ({
  usePricingData: vi.fn(),
}))

const usePricingDataMock = vi.mocked(usePricingData)

// Stats reads its numbers from the live pricing payload; tests pin a fixture.
function setMarketData(models: number, vendors: number, isLoading = false) {
  usePricingDataMock.mockReturnValue({
    models: Array.from({ length: models }, (_, i) => ({ id: i })),
    vendors: Array.from({ length: vendors }, (_, i) => ({ id: i })),
    isLoading,
  } as unknown as ReturnType<typeof usePricingData>)
}

/**
 * The homepage motion has one rule: reduced motion shows the finished frame.
 * Nothing travels, nothing counts up, and the marks the red line passes are
 * reached immediately. The test setup reports reduced motion for every query.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the route diagram', () => {
  it('draws every line at rest, with no highlight, when motion is reduced', () => {
    class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)

    const { container } = render(<GatewayRoutes />)

    expect(screen.getByRole('img', { name: 'CodeGuys' })).toBeInTheDocument()
    // CodeY keeps its cyan; every other name sits in the muted color.
    expect(screen.getByText('CodeY')).toHaveClass('gateway-route-name-cyan')
    expect(screen.getByText('OpenAI')).toHaveAttribute('data-reduced', 'true')
    // The finished frame: every line drawn, none lit, no box, no dot.
    const lines = container.querySelectorAll('.gateway-route-line')
    expect(lines).toHaveLength(10)
    expect(lines[0]).toHaveAttribute('data-reduced', 'true')
    expect(container.querySelector('.gateway-route-lit')).toBeNull()
    expect(container.querySelector('.gateway-route-box')).toHaveAttribute(
      'data-reduced',
      'true'
    )
    expect(container.querySelector('.gateway-route-dot')).toBeNull()
    expect(container.querySelector('animateMotion')).toBeNull()
  })

  it('crops the configured logo into the hexagon', () => {
    class Observer {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    useSystemConfigStore.getState().setConfig({ logo: '/custom-logo.png' })

    const { container } = render(<GatewayRoutes />)

    const logo = container.querySelector('image')
    expect(logo).toHaveAttribute('href', '/custom-logo.png')
    // The crop is a hexagon smaller than the stroked one, so the logo's own
    // outer hexagon never doubles up on the stroke drawn around it.
    const clip = container.querySelector('clipPath polygon')
    expect(clip?.getAttribute('transform')).toContain('scale(0.7)')
    expect(container.querySelector('[data-route-start]')).not.toBeNull()
  })

  it('sends one square to each endpoint, one at a time, when motion is allowed', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList
    )
    class Observer {
      constructor(private readonly notify: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.notify(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        )
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)

    const { container } = render(<GatewayRoutes />)

    const trips = [...container.querySelectorAll('animateMotion')]
    expect(trips).toHaveLength(10)
    const begins = trips.map((trip) =>
      Number.parseFloat(trip.getAttribute('begin') ?? '')
    )
    expect(begins).toEqual([
      0, 3.6, 7.2, 10.8, 14.4, 18, 21.6, 25.2, 28.8, 32.4,
    ])
    // Each square flies once per tour instead of looping on its own line.
    expect(trips[0].getAttribute('repeatDur')).toBe('36s')

    // The line, its two dots, and the name all light on the same clock: while
    // the square is at the endpoint, halfway through its own trip.
    const openAi = screen.getByText('OpenAI')
    expect(openAi).not.toHaveAttribute('data-reduced')
    expect(openAi.style.animationDuration).toBe('36s')
    expect(openAi.style.animationDelay).toBe('1.5s')
    expect(screen.getByText('CodeY').style.animationDelay).toBe('19.5s')

    const lit = container.querySelectorAll('.gateway-route-lit')
    expect(lit).toHaveLength(10)
    expect(lit[0]).toHaveStyle({ animationDelay: '1.5s' })
    expect(container.querySelector('.gateway-route-lit-cyan')).toHaveStyle({
      animationDelay: '19.5s',
    })
    const dots = container.querySelectorAll('.gateway-route-dot')
    expect(dots).toHaveLength(20)
    expect(dots[0]).toHaveStyle({ animationDelay: '1.5s' })
    expect(container.querySelector('.gateway-route-box')).toHaveStyle({
      animationDelay: '1.5s',
    })
  })
})

describe('the route line', () => {
  function layout() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const mark = this.getAttribute('data-route-mark')
        let top = 100
        if (this.hasAttribute('data-route-end')) top = 1400
        else if (mark !== null) top = 100 + Number(mark) * 200
        return {
          top,
          bottom: top + 20,
          height: 20,
          left: 0,
          right: 20,
          width: 20,
          x: 0,
          y: top,
          toJSON() {},
        } as DOMRect
      }
    )
  }

  it('reaches every mark at once when motion is reduced', () => {
    layout()
    render(
      <div>
        <svg>
          <polygon data-route-start />
        </svg>
        <span data-route-mark='0'>50+</span>
        <span data-route-mark='1'>01</span>
        <span data-route-mark='2'>02</span>
        <div data-route-end />
        <RouteLine />
      </div>
    )

    const line = document.querySelector('.route-line')
    expect(line).toHaveAttribute('data-reduced', 'true')
    expect(line?.getAttribute('style')).toContain('--route-line')
    expect(document.querySelectorAll('[data-reached]')).toHaveLength(3)
  })

  it('reaches only the marks the scroll tip has passed', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList
    )
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    })
    layout()
    render(
      <div>
        <svg>
          <polygon data-route-start />
        </svg>
        <span data-route-mark='0'>50+</span>
        <span data-route-mark='1'>01</span>
        <span data-route-mark='5'>03</span>
        <div data-route-end />
        <RouteLine />
      </div>
    )

    // The tip sits at half the viewport, 400px down a page scrolled to the top,
    // so it has passed the first two marks and not the last.
    expect(screen.getByText('50+')).toHaveAttribute('data-reached')
    expect(screen.getByText('01')).toHaveAttribute('data-reached')
    expect(screen.getByText('03')).not.toHaveAttribute('data-reached')
  })
})

describe('the numbers the line reaches', () => {
  it('shows the resolved market counts straight away when motion is reduced', () => {
    setMarketData(120, 40)
    render(<Stats />)

    expect(screen.getByText('40+')).toBeInTheDocument()
    expect(screen.getByText('120+')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.queryByText('0+')).not.toBeInTheDocument()
  })

  it('shows a placeholder until the market data resolves', () => {
    setMarketData(0, 0, true)
    render(<Stats />)

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('0+')).not.toBeInTheDocument()
  })

  it('holds a stat at zero until the line reaches it', () => {
    setMarketData(120, 40)
    vi.stubGlobal(
      'matchMedia',
      (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList
    )
    render(<Stats />)

    const stat = screen.getAllByText('0+')[0]
    expect(stat).toHaveAttribute('data-route-mark')
    expect(screen.queryByText('40+')).not.toBeInTheDocument()

    stat.setAttribute('data-reached', '')
    return screen.findByText('40+').then((counted) => {
      expect(counted).toBe(stat)
    })
  })

  it('marks the three step numbers so the line can turn them red', () => {
    render(<HowItWorks />)

    for (const step of ['01', '02', '03']) {
      expect(screen.getByText(step)).toHaveAttribute('data-route-mark')
      expect(screen.getByText(step)).toHaveClass('route-step')
    }
  })
})

describe('the feature grid', () => {
  it('draws the corner brackets straight away when motion is reduced', () => {
    render(<Features />)

    const grid = document.querySelector('[data-feature-grid]')
    expect(grid).toHaveClass('is-drawn')
    expect(grid?.querySelectorAll('.feature-cell')).toHaveLength(8)
  })

  it('waits until the grid is on screen before drawing the brackets', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList
    )
    let report: IntersectionObserverCallback = () => undefined
    class Observer {
      constructor(notify: IntersectionObserverCallback) {
        report = notify
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)

    render(<Features />)
    const grid = document.querySelector('[data-feature-grid]')
    expect(grid).not.toHaveClass('is-drawn')

    report(
      [{ isIntersecting: true, target: grid } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
    expect(grid).toHaveClass('is-drawn')
  })
})

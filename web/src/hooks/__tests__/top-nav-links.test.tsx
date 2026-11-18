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
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { useTopNavLinks } from '../use-top-nav-links'

/**
 * The public nav is the gateway's nav. Products is a menu with CodeY under it.
 * The console is not a nav item: a signed-in user reaches it from the account
 * menu, so it never appears here, whatever the module flag says.
 */

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
})

function renderNav(modules: Record<string, unknown>, signedIn: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    HeaderNavModules: JSON.stringify(modules),
    token_package_enabled: modules.token_package_enabled,
  })
  if (signedIn) {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  }

  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }

  return renderHook(() => useTopNavLinks(), { wrapper: Wrapper })
}

const ALL_ENABLED = {
  home: true,
  console: true,
  products: true,
  subscription: true,
  market: true,
  pricing: { enabled: true, requireAuth: false },
  rankings: { enabled: true, requireAuth: false },
  docs: true,
  about: true,
  token_package_enabled: true,
}

describe('public navigation', () => {
  it('lists the gateway pages and puts CodeY under a products menu', () => {
    const { result } = renderNav(ALL_ENABLED, false)

    expect(result.current.map((link) => link.href)).toEqual([
      '/',
      '/products/codey',
      '/pricing',
      '/subscription',
      '/market',
      '/rankings',
      '/docs/gateway',
      '/about',
    ])
    const products = result.current.find(
      (link) => link.href === '/products/codey'
    )
    expect(products?.children).toEqual([
      {
        title: 'CodeY',
        description: 'A local-first AI work partner',
        href: '/products/codey',
        accent: true,
      },
    ])
    // The docs menu names the two subjects. Their chapters stay in the docs
    // sidebar, so the menu never grows with the number of pages.
    const docs = result.current.find((link) => link.href === '/docs/gateway')
    expect(docs?.children?.map((child) => child.href)).toEqual([
      '/docs/gateway',
      '/docs/codey',
    ])
  })

  it('keeps the console out of the nav, signed in or not', () => {
    const signedOut = renderNav(ALL_ENABLED, false)
    expect(
      signedOut.result.current.some((link) => link.href === '/dashboard')
    ).toBe(false)

    const signedIn = renderNav(ALL_ENABLED, true)
    expect(
      signedIn.result.current.some((link) => link.href === '/dashboard')
    ).toBe(false)
  })

  it('hides the products menu when the module is switched off', () => {
    const { result } = renderNav({ ...ALL_ENABLED, products: false }, false)

    expect(result.current.some((link) => link.href === '/products/codey')).toBe(
      false
    )
  })

  it('shows subscription and market by default for older configurations', () => {
    const legacy = {
      home: true,
      console: true,
      products: true,
      pricing: { enabled: true, requireAuth: false },
      rankings: { enabled: true, requireAuth: false },
      docs: true,
      about: true,
      token_package_enabled: true,
    }
    const { result } = renderNav(legacy, false)

    expect(result.current.map((link) => link.href)).toContain('/subscription')
    expect(result.current.map((link) => link.href)).toContain('/market')
  })

  it('hides the token market when the token package feature is disabled', () => {
    const { result } = renderNav(
      { ...ALL_ENABLED, token_package_enabled: false },
      false
    )

    expect(result.current.some((link) => link.href === '/market')).toBe(false)
    expect(result.current.some((link) => link.href === '/subscription')).toBe(
      true
    )
  })

  it('hides the token market when its header module is switched off', () => {
    const { result } = renderNav({ ...ALL_ENABLED, market: false }, false)

    expect(result.current.some((link) => link.href === '/market')).toBe(false)
  })
})

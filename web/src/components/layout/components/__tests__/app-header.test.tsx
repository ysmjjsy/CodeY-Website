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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { SearchProvider } from '@/context/search-provider'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { AppHeader } from '../app-header'

/**
 * The console header keeps the light, dark, and system switch, and no longer
 * offers the theme settings drawer. That drawer set layout, direction, and
 * content width, which the site no longer exposes.
 */

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the console header', () => {
  it('switches the theme and does not open theme settings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(STATUS_QUERY_KEY, { system_name: 'CodeGuys' })
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <SearchProvider>
            <SidebarProvider>
              <AppHeader />
            </SidebarProvider>
          </SearchProvider>
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
    })
    await router.load()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByRole('button', { name: 'Toggle theme' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Open theme settings' })
    ).not.toBeInTheDocument()
  })
})

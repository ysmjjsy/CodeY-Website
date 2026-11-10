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
import { afterEach, describe, expect, it } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { STATUS_QUERY_KEY, mapStatusDataToConfig } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SystemBrand } from '../system-brand'

/**
 * The sidebar brand reads the same name as the header and the footer. A stored
 * name from before the CodeGuys rename shows as CodeGuys, and a name an
 * administrator set on purpose is kept.
 */

afterEach(() => {
  cleanup()
})

function renderBrand(systemName: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, { system_name: systemName })
  useSystemConfigStore
    .getState()
    .setConfig(mapStatusDataToConfig({ system_name: systemName }))
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <SidebarProvider>
          <SystemBrand />
        </SidebarProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
  })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('the sidebar brand', () => {
  it('shows CodeGuys for a name from before the rename', async () => {
    renderBrand('codeguys')

    expect(await screen.findByText('CodeGuys')).toBeInTheDocument()
    expect(screen.queryByText('codeguys')).not.toBeInTheDocument()
  })

  it('keeps a name that was set on purpose', async () => {
    renderBrand('My Gateway')

    expect(await screen.findByText('My Gateway')).toBeInTheDocument()
  })
})

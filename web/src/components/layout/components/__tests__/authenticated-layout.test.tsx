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
import { afterEach, expect, test, vi } from 'vitest'

import { AuthenticatedLayout } from '@/components/layout'
import { ROLE } from '@/lib/roles'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

afterEach(() => {
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

async function renderLayout(path: string) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'root',
    role: ROLE.USER,
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, { system_name: 'CodeGuys' })
  const root = createRootRoute({ component: AuthenticatedLayout })
  const account = createRoute({
    getParentRoute: () => root,
    path: '/account/$section',
    component: () => <p>Account page</p>,
  })
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: '/dashboard',
    component: () => <p>Console page</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([account, dashboard]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

test('the account page renders without the sidebar or its toggle', async () => {
  await renderLayout('/account/keys')

  expect(await screen.findByText('Account page')).toBeVisible()
  expect(document.querySelector('[data-slot="sidebar"]')).toBeNull()
  expect(document.querySelector('[data-slot="sidebar-trigger"]')).toBeNull()
})

test('console pages keep the sidebar and its toggle', async () => {
  await renderLayout('/dashboard')

  expect(await screen.findByText('Console page')).toBeVisible()
  expect(document.querySelector('[data-slot="sidebar"]')).not.toBeNull()
  expect(document.querySelector('[data-slot="sidebar-trigger"]')).not.toBeNull()
})

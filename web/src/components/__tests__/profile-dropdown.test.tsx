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
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { ROLE } from '@/lib/roles'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { ProfileDropdown } from '../profile-dropdown'

const menuLabels = new Set([
  'Account Information',
  'Console',
  'System Settings',
  'Sign out',
])

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
})

async function openMenu(role: number) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'root',
    display_name: 'Root User',
    role,
    group: 'default',
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {})
  const root = createRootRoute({ component: ProfileDropdown })
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
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  await userEvent.click(
    await screen.findByRole('button', { name: 'Account menu' })
  )
  return router
}

function menuOrder() {
  return screen
    .getAllByRole('menuitem')
    .map((item) => item.textContent)
    .filter((label) => menuLabels.has(label ?? ''))
}

test('the account menu leads with Account Information above Console', async () => {
  await openMenu(ROLE.USER)

  expect(menuOrder()).toEqual(['Account Information', 'Console', 'Sign out'])
  for (const removed of ['Profile', 'Security & Access', 'Wallet']) {
    expect(screen.queryByRole('menuitem', { name: removed })).toBeNull()
  }
})

test('super admins keep System Settings after Console', async () => {
  await openMenu(ROLE.SUPER_ADMIN)

  expect(menuOrder()).toEqual([
    'Account Information',
    'Console',
    'System Settings',
    'Sign out',
  ])
})

test('Account Information opens the account page', async () => {
  const router = await openMenu(ROLE.USER)

  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Account Information' })
  )

  expect(router.state.location.pathname).toBe('/account/profile')
})

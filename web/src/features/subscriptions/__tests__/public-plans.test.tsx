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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { PublicSubscriptionPlan } from '../types'
import { PublicSubscriptionPlans } from '../public-plans'

const starterPlan: PublicSubscriptionPlan = {
  id: 3,
  title: 'Starter',
  subtitle: 'For individual builders',
  price_amount: 10,
  currency: 'USD',
  duration_unit: 'month',
  duration_value: 1,
  custom_seconds: 0,
  total_amount: 5000000,
  quota_reset_period: 'monthly',
  quota_reset_custom_seconds: 0,
  max_purchase_per_user: 2,
}

async function renderSubscription(
  signedIn = false,
  plans: PublicSubscriptionPlan[] = [starterPlan]
) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/public/plans') {
      return { data: { success: true, data: plans } }
    }
    if (url === '/api/notice') {
      return { data: { success: true, data: '' } }
    }
    throw new Error(`unexpected request ${String(url)}`)
  })

  useSystemConfigStore.getState().setLoading(false)
  if (signedIn) {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'alice',
      role: 1,
    })
  }

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    system_name: 'CodeGuys',
    register_enabled: true,
    token_package_enabled: true,
    HeaderNavModules: JSON.stringify({ subscription: true }),
  })

  const root = createRootRoute()
  const subscription = createRoute({
    getParentRoute: () => root,
    path: '/subscription',
    component: PublicSubscriptionPlans,
  })
  const account = createRoute({
    getParentRoute: () => root,
    path: '/account/$section',
  })
  const router = createRouter({
    routeTree: root.addChildren([subscription, account]),
    history: createMemoryHistory({ initialEntries: ['/subscription'] }),
  })
  await router.load()

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  if (plans.length > 0) {
    await screen.findByText('Starter')
  }

  return { get, router }
}

afterEach(() => {
  vi.restoreAllMocks()
  useAuthDialogStore.getState().closeAuthDialog()
  useAuthStore.getState().auth.reset()
})

test('renders public plans without requesting the current subscription', async () => {
  const { get } = await renderSubscription()

  expect(screen.getByText('For individual builders')).toBeVisible()
  expect(screen.getAllByText('$10').length).toBeGreaterThan(0)
  expect(
    get.mock.calls.some(([url]) => url === '/api/subscription/self')
  ).toBe(false)
})

test('opens sign-in with the subscription redirect for anonymous visitors', async () => {
  await renderSubscription()

  await userEvent.click(screen.getByRole('button', { name: 'Get started' }))

  expect(useAuthDialogStore.getState().view).toBe('sign-in')
  expect(useAuthDialogStore.getState().redirectTo).toBe('/subscription')
})

test('sends a signed-in visitor to the wallet', async () => {
  const { router } = await renderSubscription(true)

  await userEvent.click(screen.getByRole('button', { name: 'Get started' }))

  await waitFor(() => {
    expect(router.state.location.pathname).toBe('/account/wallet')
  })
})

test('shows an empty state when no public plans are published', async () => {
  const { get } = await renderSubscription(false, [])

  expect(
    await screen.findByText('No subscription plans available')
  ).toBeVisible()
  expect(
    get.mock.calls.some(([url]) => url === '/api/subscription/self')
  ).toBe(false)
})

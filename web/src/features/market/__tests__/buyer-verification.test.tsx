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

import type {
  PublicTokenPackage,
  VerificationState,
} from '../../token-package/types'
import { Market } from '../index'

const listedPackage: PublicTokenPackage = {
  id: 7,
  seller_name: 'alice',
  title: 'Claude fast lane',
  subtitle: '',
  description: '',
  degraded: false,
  active_version: {
    models: [{ model: 'claude-sonnet-4', multiplier: 0.6 }],
    skus: [
      {
        sku_key: 'starter',
        title: 'Starter',
        price_quota: 500000,
        credit_quota: 2000000,
        valid_days: 30,
      },
    ],
  },
}

type RenderOptions = {
  signedIn?: boolean
  verification?: VerificationState
  purchaseRejectedAsUnverified?: boolean
}

async function renderMarket(options: RenderOptions = {}) {
  let verificationCalls = 0
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/verification') {
      verificationCalls += 1
      const status =
        options.purchaseRejectedAsUnverified && verificationCalls > 1
          ? 'unverified'
          : (options.verification ?? 'unverified')
      return { data: { success: true, data: { status } } }
    }
    if (url === '/api/market/public/packages') {
      return {
        data: {
          success: true,
          data: { items: [listedPackage], total: 1, page: 1, page_size: 12 },
        },
      }
    }
    if (url === '/api/notice') {
      return { data: { success: true, data: '' } }
    }
    throw new Error(`unexpected request ${String(url)}`)
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/market/packages/7/purchase') {
      return {
        data: options.purchaseRejectedAsUnverified
          ? {
              success: false,
              code: 'PACKAGE_BUYER_UNVERIFIED',
              message: 'Buyer verification is required',
            }
          : { success: true },
      }
    }
    throw new Error(`unexpected request ${String(url)}`)
  })

  useSystemConfigStore.getState().setLoading(false)
  if (options.signedIn) {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'alice',
      role: 1,
      quota: 5000000,
    })
  }

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    system_name: 'CodeGuys',
    register_enabled: true,
    token_package_enabled: true,
    HeaderNavModules: JSON.stringify({ market: true }),
  })

  const root = createRootRoute()
  const market = createRoute({
    getParentRoute: () => root,
    path: '/market',
    component: Market,
  })
  const account = createRoute({
    getParentRoute: () => root,
    path: '/account/$section',
  })
  const router = createRouter({
    routeTree: root.addChildren([market, account]),
    history: createMemoryHistory({ initialEntries: ['/market'] }),
  })
  await router.load()

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByText('Claude fast lane')

  return { get }
}

afterEach(() => {
  vi.restoreAllMocks()
  useAuthDialogStore.getState().closeAuthDialog()
  useAuthStore.getState().auth.reset()
})

test('lets anonymous visitors browse without requesting verification', async () => {
  const { get } = await renderMarket()

  expect(
    get.mock.calls.some(([url]) => url === '/api/user/verification')
  ).toBe(false)

  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Sign in to buy' })
  )

  expect(useAuthDialogStore.getState().view).toBe('sign-in')
  expect(useAuthDialogStore.getState().redirectTo).toBe('/market')
})

test('does not request verification when a signed-in buyer opens a package', async () => {
  const { get } = await renderMarket({
    signedIn: true,
    verification: 'unverified',
  })

  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  expect(await screen.findByRole('button', { name: 'Continue' })).toBeEnabled()
  expect(
    get.mock.calls.some(([url]) => url === '/api/user/verification')
  ).toBe(false)
})

test('checks verification only after the buyer clicks Continue', async () => {
  const { get } = await renderMarket({
    signedIn: true,
    verification: 'unverified',
  })

  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

  expect(
    await screen.findByText('Real-name verification is required to buy')
  ).toBeVisible()
  expect(
    get.mock.calls.some(([url]) => url === '/api/user/verification')
  ).toBe(true)
})

test('opens the purchase confirmation when Continue finds a verified buyer', async () => {
  await renderMarket({ signedIn: true, verification: 'verified' })

  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))

  expect(
    await screen.findByRole('alertdialog', { name: 'Confirm purchase' })
  ).toBeVisible()
  expect(
    screen.queryByText('Real-name verification is required to buy')
  ).not.toBeInTheDocument()
})

test('shows the verification dialog when the server rejects an unverified purchase', async () => {
  await renderMarket({
    signedIn: true,
    verification: 'verified',
    purchaseRejectedAsUnverified: true,
  })

  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  const checkboxes = await screen.findAllByRole('checkbox')
  await userEvent.click(checkboxes[0])
  await userEvent.click(checkboxes[1])
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm purchase' })
  )

  await waitFor(() => {
    expect(
      screen.getByText('Real-name verification is required to buy')
    ).toBeVisible()
  })
})

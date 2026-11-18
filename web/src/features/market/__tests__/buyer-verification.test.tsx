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
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import type { TokenPackage, VerificationState } from '../../token-package/types'
import { Market } from '../index'

const listedPackage: TokenPackage = {
  id: 7,
  seller_user_id: 2,
  seller_name: 'alice',
  billing_mode: 'quota',
  title: 'Claude fast lane',
  subtitle: '',
  description: '',
  status: 'listed',
  active_version_id: 3,
  degraded: false,
  active_version: {
    id: 3,
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
  } as unknown as TokenPackage['active_version'],
  created_at: 0,
  updated_at: 0,
}

async function renderMarket(status: VerificationState) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/verification') {
      return { data: { success: true, data: { status } } }
    }
    if (url === '/api/market/packages') {
      return {
        data: {
          success: true,
          data: { items: [listedPackage], total: 1, page: 1, page_size: 12 },
        },
      }
    }
    throw new Error(`unexpected request ${String(url)}`)
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByText('Claude fast lane')
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('an unverified buyer sees the verification guide and cannot continue to purchase', async () => {
  await renderMarket('unverified')

  // The guide is a link rendered through Button, so it is found by its text.
  const guide = await screen.findAllByText('Verify now')
  expect(guide[0].closest('a')).toHaveAttribute('href', '/account/verification')

  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled()
})

test('a buyer under review is told to wait and cannot continue to purchase', async () => {
  await renderMarket('pending')

  expect(
    await screen.findByText('Your real-name verification is under review')
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled()
})

test('a verified buyer sees no guide and can continue to purchase', async () => {
  await renderMarket('verified')

  await userEvent.click(screen.getByRole('button', { name: 'View and buy' }))
  expect(await screen.findByRole('button', { name: 'Continue' })).toBeEnabled()
  expect(screen.queryByText('Verify now')).not.toBeInTheDocument()
})

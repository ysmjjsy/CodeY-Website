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
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { Account } from '@/features/account'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  vi.restoreAllMocks()
})

async function renderAccount(
  section: string,
  responses: Record<string, unknown> = {}
) {
  useAuthStore.getState().auth.setUser({
    id: 7,
    username: 'root',
    display_name: 'Root User',
    role: ROLE.SUPER_ADMIN,
    group: 'default',
    email: 'root@example.com',
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url in responses) {
      const response = responses[url]
      return {
        data:
          typeof response === 'function'
            ? (response as () => unknown)()
            : response,
      }
    }
    if (url === '/api/user/self') {
      return {
        data: {
          success: true,
          data: {
            id: 7,
            username: 'root',
            display_name: 'Root User',
            role: ROLE.SUPER_ADMIN,
            email: 'root@example.com',
            group: 'default',
            quota: 0,
            used_quota: 0,
            request_count: 0,
            status: 1,
            aff_code: 'root',
            aff_count: 3,
            aff_quota: 120000,
            aff_history_quota: 500000,
            created_time: 0,
          },
        },
      }
    }
    if (url === '/api/user/access_tokens/catalog') {
      return {
        data: {
          success: true,
          data: { groups: [], max_tokens: 10, default_expiry_days: 30 },
        },
      }
    }
    if (url === '/api/user/access_tokens') {
      return {
        data: { success: true, data: { items: [], legacy: null } },
      }
    }
    if (url === '/api/user/sessions') {
      return { data: { success: true, data: [] } }
    }
    if (url === '/api/subscription/plans') {
      return { data: { success: true, data: [] } }
    }
    if (url === '/api/subscription/self') {
      return {
        data: {
          success: true,
          data: {
            billing_preference: 'subscription_first',
            subscriptions: [],
            all_subscriptions: [],
          },
        },
      }
    }
    if (url.startsWith('/api/token/')) {
      return {
        data: {
          success: true,
          data: { items: [], total: 0, page: 1, page_size: 20 },
        },
      }
    }
    return { data: { success: true, data: {} } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    SidebarModulesAdmin: '',
    checkin_enabled: false,
  })
  // The API keys table binds its URL state to the generated route id, so the
  // hand-built route has to carry the same id or that tab errors instead of
  // rendering.
  const root = createRootRoute({ component: Outlet })
  const account = createRoute({
    getParentRoute: () => root,
    path: '/account/$section',
    component: Account,
  })
  Object.assign(account.options, { id: '/_authenticated/account/$section' })
  const router = createRouter({
    routeTree: root.addChildren([account]),
    history: createMemoryHistory({ initialEntries: [`/account/${section}`] }),
  })
  await router.load()
  const rendered = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { ...rendered, router }
}

test('the account page shows a profile sidebar beside the tabs', async () => {
  await renderAccount('profile')

  const heading = await screen.findByRole('heading', { name: 'Root User' })
  expect(heading).toBeVisible()
  const aside = heading.closest('aside')
  expect(aside).not.toBeNull()
  expect(aside).toHaveAttribute('aria-label', 'Account Information')
  expect(aside).toHaveClass('lg:w-96', 'xl:w-[28rem]')
  expect(screen.getByText('root@example.com')).toBeVisible()
  expect(screen.getByText('Current Balance')).toBeVisible()
  expect(await screen.findByText('Subscription')).toBeVisible()
  expect(screen.getByText('Usage-based billing')).toBeVisible()
  expect(screen.getByText('Referral Program')).toBeVisible()
  expect(screen.getByText('Pending')).toBeVisible()
  expect(screen.getByText('Total Earned')).toBeVisible()
  expect(screen.getByText('Invites')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Copy referral link' })
  ).toBeVisible()

  const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
  expect(tabs).toEqual(['Profile', 'Wallet', 'Security & Access', 'API Keys'])
  expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(document.querySelector('[data-slot="sidebar"]')).toBeNull()

  const tablist = screen.getByRole('tablist')
  expect(aside?.contains(tablist)).toBe(false)
  expect(aside?.compareDocumentPosition(tablist)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  )
  expect(tablist.parentElement?.parentElement).toHaveClass('border-b')
  expect(aside?.parentElement).toHaveClass('lg:flex-row')
  expect(tablist.compareDocumentPosition(screen.getByText('Settings'))).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  )
})

test('the sidebar summarises the active subscription', async () => {
  const now = Math.floor(Date.now() / 1000)
  await renderAccount('profile', {
    '/api/subscription/plans': {
      success: true,
      data: [{ plan: { id: 2, title: 'Pro Plan' } }],
    },
    '/api/subscription/self': {
      success: true,
      data: {
        billing_preference: 'subscription_first',
        subscriptions: [
          {
            subscription: {
              id: 9,
              user_id: 7,
              plan_id: 2,
              status: 'active',
              start_time: now - 86400,
              end_time: now + 86400 * 10,
              amount_total: 100000,
              amount_used: 25000,
              next_reset_time: now + 86400 * 3,
            },
          },
        ],
        all_subscriptions: [],
      },
    },
  })

  expect(await screen.findByText('Pro Plan')).toBeVisible()
  expect(screen.getByText('Active')).toBeVisible()
  expect(screen.getByText('Remaining')).toBeVisible()
  expect(screen.getByText('Next reset')).toBeVisible()
  expect(screen.getByText('10 days remaining')).toBeVisible()
})

test('the subscription card links to the plans when none are active', async () => {
  await renderAccount('profile', {
    '/api/subscription/plans': {
      success: true,
      data: [{ plan: { id: 1, title: 'Basic' } }],
    },
  })

  expect(
    await screen.findByRole('button', { name: 'Subscription Plans' })
  ).toHaveAttribute('href', '/account/wallet')
})

test('returning from the wallet refreshes the sidebar overview', async () => {
  const now = Math.floor(Date.now() / 1000)
  let subscribed = false
  await renderAccount('profile', {
    '/api/subscription/plans': {
      success: true,
      data: [{ plan: { id: 2, title: 'Pro Plan' } }],
    },
    '/api/subscription/self': () => ({
      success: true,
      data: subscribed
        ? {
            billing_preference: 'subscription_first',
            subscriptions: [
              {
                subscription: {
                  id: 9,
                  user_id: 7,
                  plan_id: 2,
                  status: 'active',
                  start_time: now - 86400,
                  end_time: now + 86400 * 10,
                  amount_total: 100000,
                  amount_used: 0,
                  next_reset_time: now + 86400 * 3,
                },
              },
            ],
            all_subscriptions: [],
          }
        : {
            billing_preference: 'subscription_first',
            subscriptions: [],
            all_subscriptions: [],
          },
    }),
  })

  expect(await screen.findByText('Usage-based billing')).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Wallet' }))
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Wallet' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  )
  subscribed = true
  await userEvent.click(screen.getByRole('tab', { name: 'Profile' }))

  expect(await screen.findByText('Pro Plan')).toBeVisible()
})

test('display name edits inline and saves through the profile API', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  await renderAccount('profile')

  await user.click(
    await screen.findByRole('button', { name: 'Edit display name' })
  )
  const input = screen.getByRole('textbox', { name: 'Display Name' })
  await user.clear(input)
  await user.type(input, 'New Name')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      '/api/user/self',
      { display_name: 'New Name' },
      expect.anything()
    )
  )
  expect(await screen.findByRole('heading', { name: 'New Name' })).toBeVisible()
  expect(useAuthStore.getState().auth.user?.display_name).toBe('New Name')
})

test('avatar upload stores the returned URL on the signed-in user', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { avatar_url: '/api/avatar/abc.png' } },
  })
  const { container } = await renderAccount('profile')

  const fileInput = container.querySelector('input[type="file"]')
  expect(fileInput).not.toBeNull()
  const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', {
    type: 'image/png',
  })
  fireEvent.change(fileInput as HTMLInputElement, { target: { files: [file] } })

  await waitFor(() =>
    expect(useAuthStore.getState().auth.user?.avatar_url).toBe(
      '/api/avatar/abc.png'
    )
  )
  expect(api.post).toHaveBeenCalledWith(
    '/api/user/avatar',
    expect.any(FormData)
  )
})

test.each([
  ['wallet', 'Current Balance'],
  ['security', 'Login & Authentication'],
  ['keys', 'No API Keys Found'],
])(
  'the %s tab keeps its content inside the visible page',
  async (section, content) => {
    await renderAccount(section)

    expect(await screen.findByText(content)).toBeVisible()
  }
)

test('choosing a tab switches the account section', async () => {
  const { router } = await renderAccount('profile')

  await userEvent.click(
    await screen.findByRole('tab', { name: 'Security & Access' })
  )

  expect(router.state.location.pathname).toBe('/account/security')
  expect(
    screen.getByRole('tab', { name: 'Security & Access' })
  ).toHaveAttribute('aria-selected', 'true')
})

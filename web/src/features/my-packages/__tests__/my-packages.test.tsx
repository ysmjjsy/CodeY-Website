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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import type { PricingModel } from '@/features/pricing/types'
import { api } from '@/lib/api'

import type {
  PackageEntitlement,
  PackageVersion,
  TokenPackage,
  UserChannel,
} from '../../token-package/types'
import { MyPackages } from '../index'

vi.mock('@tanstack/react-router', async () => {
  const React = await import('react')
  type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string
  }
  return {
    Link: React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
      { to, children, ...props },
      ref
    ) {
      return React.createElement('a', { ...props, href: to, ref }, children)
    }),
  }
})

let queryClient: QueryClient | null = null

afterEach(() => {
  queryClient?.clear()
  queryClient = null
  vi.restoreAllMocks()
})

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MyPackages />
    </QueryClientProvider>
  )
}

function makeChannel(overrides: Partial<UserChannel> = {}): UserChannel {
  return {
    id: 7,
    name: 'OpenAI Pool',
    type: 1,
    base_url: 'https://api.openai.com',
    models: ['deepseek-chat'],
    model_mapping: '',
    test_model: 'deepseek-chat',
    other: '',
    priority: 0,
    weight: 1,
    status: 1,
    created_time: 0,
    ...overrides,
  }
}

function makePricingModel(): PricingModel {
  return {
    id: 1,
    model_name: 'deepseek-chat',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 2,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
  }
}

function makeVersion(overrides: Partial<PackageVersion> = {}): PackageVersion {
  return {
    id: 12,
    package_id: 41,
    version_no: 2,
    status: 'approved',
    models: [{ model: 'deepseek-chat', multiplier: 0.8 }],
    skus: [
      {
        sku_key: 'basic',
        title: 'Basic',
        price_quota: 10000,
        credit_quota: 200000,
        valid_days: 30,
      },
    ],
    channels: [
      {
        channel_id: 7,
        models: ['deepseek-chat'],
        priority: 0,
        weight: 1,
      },
    ],
    test_report: null,
    submitted_at: 0,
    reviewed_by: 0,
    reviewed_at: 0,
    review_note: '',
    created_at: 0,
    ...overrides,
  }
}

function makePackage(overrides: Partial<TokenPackage> = {}): TokenPackage {
  const activeVersion = makeVersion()
  return {
    id: 41,
    seller_user_id: 3,
    seller_name: 'seller',
    billing_mode: 'quota',
    title: 'Seller Starter',
    subtitle: 'A practical starter package',
    description: '',
    status: 'listed',
    active_version_id: activeVersion.id,
    degraded: false,
    active_version: activeVersion,
    latest_version: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

function makeEntitlement(): PackageEntitlement {
  return {
    id: 5,
    user_id: 8,
    package_id: 88,
    package_title: 'Purchased Starter',
    package_status: 'listed',
    version_id: 20,
    order_id: 9,
    billing_mode: 'quota',
    models_snapshot: [{ model: 'gpt-test', multiplier: 1 }],
    amount_total: 100000,
    amount_used: 25000,
    amount_remaining: 75000,
    paid_quota: 10000,
    start_time: 0,
    end_time: 0,
    extended_seconds: 0,
    status: 'active',
    refunded_quota: 0,
    created_at: 0,
  }
}

function mockLoad(options?: {
  channels?: UserChannel[]
  packages?: TokenPackage[]
  entitlements?: PackageEntitlement[]
}) {
  return vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/package-entitlements') {
      return {
        data: { success: true, data: options?.entitlements || [] },
      } as never
    }
    if (url === '/api/user/channels') {
      const channels = options?.channels || []
      return {
        data: {
          success: true,
          data: {
            items: channels,
            total: channels.length,
            page: 1,
            page_size: 100,
          },
        },
      } as never
    }
    if (url === '/api/seller/packages') {
      return {
        data: { success: true, data: options?.packages || [] },
      } as never
    }
    if (url === '/api/pricing') {
      return {
        data: {
          success: true,
          data: [makePricingModel()],
          vendors: [],
          group_ratio: { default: 1 },
          usable_group: {},
          supported_endpoint: {},
          auto_groups: [],
        },
      } as never
    }
    throw new Error(`unexpected request ${String(url)}`)
  })
}

async function fillNewPackage(
  dialog: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
  title = 'Starter Pack'
) {
  await user.type(within(dialog).getByLabelText(/Package title/), title)
  await user.type(within(dialog).getByLabelText(/Tier name/), 'Basic')
  await user.type(within(dialog).getByLabelText(/^Price \(/), '10')
  await user.type(within(dialog).getByLabelText(/^Credit \(/), '100')

  await user.click(
    within(dialog).getByRole('checkbox', { name: /OpenAI Pool/ })
  )
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Search models' })
  )
  await user.click(await screen.findByRole('option', { name: /deepseek-chat/ }))
  await user.keyboard('{Escape}')
}

test('shows the package editor structure before creation', async () => {
  const user = userEvent.setup()
  mockLoad({ channels: [makeChannel()] })

  renderPage()

  await user.click(
    await screen.findByRole('button', { name: 'Create a package' })
  )

  const dialog = screen.getByRole('dialog', { name: 'Create a package' })
  expect(within(dialog).getByText('Product information')).toBeVisible()
  expect(within(dialog).getAllByText('Package tiers').length).toBeGreaterThan(0)
  expect(within(dialog).getByText('Channels and models')).toBeVisible()
  expect(within(dialog).getByText('Supply channels')).toBeVisible()
  expect(within(dialog).getByText('Buyer preview')).toBeVisible()
  expect(within(dialog).getByText('Before you submit')).toBeVisible()
  expect(
    within(dialog).getByRole('combobox', { name: 'Search models' })
  ).toBeDisabled()
  expect(
    within(dialog).getByRole('button', { name: 'Start connection check' })
  ).toBeDisabled()
})

test('only offers models from the selected supply channels', async () => {
  const user = userEvent.setup()
  mockLoad({
    channels: [
      makeChannel(),
      makeChannel({
        id: 8,
        name: 'Backup Pool',
        models: ['gpt-other'],
      }),
    ],
  })

  renderPage()

  await user.click(
    await screen.findByRole('button', { name: 'Create a package' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Create a package' })
  const models = within(dialog).getByRole('combobox', {
    name: 'Search models',
  })

  await user.click(
    within(dialog).getByRole('checkbox', { name: /OpenAI Pool/ })
  )
  await user.click(models)
  expect(
    await screen.findByRole('option', { name: /deepseek-chat/ })
  ).toBeVisible()
  expect(
    screen.queryByRole('option', { name: /gpt-other/ })
  ).not.toBeInTheDocument()

  await user.keyboard('{Escape}')
  await user.click(
    within(dialog).getByRole('checkbox', { name: /Backup Pool/ })
  )
  await user.click(models)
  expect(await screen.findByRole('option', { name: /gpt-other/ })).toBeVisible()
})

test('creates the package and its first version from one dialog', async () => {
  const user = userEvent.setup()
  mockLoad({
    channels: [
      makeChannel(),
      makeChannel({
        id: 8,
        name: 'Backup Pool',
        models: ['gpt-other'],
      }),
    ],
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/seller/packages') {
      return {
        data: {
          success: true,
          data: {
            ...makePackage(),
            id: 99,
            title: 'Starter Pack',
            active_version_id: 0,
            active_version: null,
            latest_version: null,
          },
        },
      } as never
    }
    if (url === '/api/seller/packages/99/versions') {
      return { data: { success: true } } as never
    }
    throw new Error(`unexpected request ${String(url)}`)
  })

  renderPage()

  await user.click(
    await screen.findByRole('button', { name: 'Create a package' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Create a package' })
  await fillNewPackage(dialog, user)

  const submit = within(dialog).getByRole('button', {
    name: 'Start connection check',
  })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)

  await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  expect(post).toHaveBeenNthCalledWith(1, '/api/seller/packages', {
    title: 'Starter Pack',
    subtitle: '',
  })
  expect(post).toHaveBeenNthCalledWith(2, '/api/seller/packages/99/versions', {
    models: [{ model: 'deepseek-chat', multiplier: 1 }],
    skus: [
      {
        sku_key: expect.stringMatching(/^tier_/),
        title: 'Basic',
        price_quota: expect.any(Number),
        credit_quota: expect.any(Number),
        valid_days: 30,
      },
    ],
    channels: [
      {
        channel_id: 7,
        models: ['deepseek-chat'],
        priority: 0,
        weight: 1,
      },
    ],
  })
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Create a package' })
    ).not.toBeInTheDocument()
  )
})

test('keeps the created package when a version retry is needed', async () => {
  const user = userEvent.setup()
  mockLoad({ channels: [makeChannel()] })
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/seller/packages') {
      return {
        data: {
          success: true,
          data: {
            ...makePackage(),
            id: 99,
            title: 'Starter Pack',
            active_version_id: 0,
            active_version: null,
            latest_version: null,
          },
        },
      } as never
    }
    if (url === '/api/seller/packages/99/versions') {
      const attempt = post.mock.calls.filter(
        ([calledURL]) => calledURL === '/api/seller/packages/99/versions'
      ).length
      return {
        data: {
          success: attempt > 1,
          message: attempt > 1 ? '' : 'temporary failure',
        },
      } as never
    }
    throw new Error(`unexpected request ${String(url)}`)
  })

  renderPage()

  await user.click(
    await screen.findByRole('button', { name: 'Create a package' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Create a package' })
  await fillNewPackage(dialog, user)

  const submit = within(dialog).getByRole('button', {
    name: 'Start connection check',
  })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)

  expect(
    await within(dialog).findByText('The package has been created')
  ).toBeVisible()
  await waitFor(() =>
    expect(
      post.mock.calls.filter(
        ([url]) => url === '/api/seller/packages/99/versions'
      )
    ).toHaveLength(1)
  )

  await user.click(submit)
  await waitFor(() =>
    expect(
      post.mock.calls.filter(
        ([url]) => url === '/api/seller/packages/99/versions'
      )
    ).toHaveLength(2)
  )
  expect(
    post.mock.calls.filter(([url]) => url === '/api/seller/packages')
  ).toHaveLength(1)
})

test('prefills the new version editor from the current offer', async () => {
  const user = userEvent.setup()
  mockLoad({
    channels: [makeChannel()],
    packages: [makePackage()],
  })

  renderPage()

  await user.click(
    await screen.findByRole('button', { name: 'Adjust package' })
  )

  const dialog = screen.getByRole('dialog', {
    name: 'New version for Seller Starter',
  })
  expect(within(dialog).getByLabelText(/Tier name/)).toHaveValue('Basic')
  expect(
    within(dialog).getByRole('checkbox', { name: /OpenAI Pool/ })
  ).toBeChecked()
  expect(within(dialog).getAllByText('deepseek-chat')).not.toHaveLength(0)
  expect(
    within(dialog).queryByText('Product information')
  ).not.toBeInTheDocument()
})

test('keeps selected models when their last supply channel is removed', async () => {
  const user = userEvent.setup()
  mockLoad({ channels: [makeChannel()] })

  renderPage()

  await user.click(
    await screen.findByRole('button', { name: 'Create a package' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Create a package' })
  await fillNewPackage(dialog, user)

  await user.click(
    within(dialog).getByRole('checkbox', { name: /OpenAI Pool/ })
  )

  expect(
    await within(dialog).findByText(
      'Some selected models have no supply channel'
    )
  ).toBeVisible()
  expect(within(dialog).getAllByText('deepseek-chat')).not.toHaveLength(0)
  expect(
    within(dialog).getByRole('button', { name: 'Start connection check' })
  ).toBeDisabled()
})

test('renders created and purchased packages as cards', async () => {
  const user = userEvent.setup()
  mockLoad({
    channels: [makeChannel()],
    packages: [makePackage()],
    entitlements: [makeEntitlement()],
  })

  renderPage()

  const createdTitle = await screen.findByText('Seller Starter')
  expect(createdTitle.closest('[data-slot="card"]')).not.toBeNull()

  await user.click(screen.getByRole('tab', { name: 'Purchased by me' }))

  const purchasedTitle = await screen.findByText('Purchased Starter')
  expect(purchasedTitle.closest('[data-slot="card"]')).not.toBeNull()
  expect(screen.getByText('Credit remaining')).toBeVisible()
})

test('shows current and latest versions with the test report', async () => {
  const user = userEvent.setup()
  const latest = makeVersion({
    id: 13,
    version_no: 3,
    status: 'rejected',
    test_report: {
      checked_at: 0,
      passed: false,
      results: null,
      fail_reasons: ['Upstream returned 401'],
    },
    review_note: 'Please check the upstream credential.',
  })
  mockLoad({
    channels: [makeChannel()],
    packages: [makePackage({ latest_version: latest })],
  })

  renderPage()

  await user.click(await screen.findByRole('button', { name: 'Details' }))

  const drawer = screen.getByRole('dialog', { name: 'Seller Starter' })
  expect(within(drawer).getByText('Current version')).toBeVisible()
  expect(within(drawer).getByText('Latest version')).toBeVisible()
  expect(within(drawer).getByText('Connection check failed')).toBeVisible()
  expect(within(drawer).getByText('Upstream returned 401')).toBeVisible()
  expect(
    within(drawer).getByText('Please check the upstream credential.')
  ).toBeVisible()
})

test('updates product information from the details drawer', async () => {
  const user = userEvent.setup()
  mockLoad({
    channels: [makeChannel()],
    packages: [makePackage()],
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: makePackage({ title: 'Updated title' }) },
  } as never)

  renderPage()

  await user.click(await screen.findByRole('button', { name: 'Details' }))
  await user.click(
    within(screen.getByRole('dialog', { name: 'Seller Starter' })).getByRole(
      'button',
      { name: 'Edit product info' }
    )
  )

  const dialog = await screen.findByRole('dialog', {
    name: 'Edit product info',
  })
  const title = within(dialog).getByLabelText(/Package title/)
  await user.clear(title)
  await user.type(title, 'Updated title')
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/seller/packages/41', {
      title: 'Updated title',
      subtitle: 'A practical starter package',
      description: '',
    })
  )
})

test('terminated packages only offer details and cannot be edited', async () => {
  const user = userEvent.setup()
  mockLoad({
    channels: [makeChannel()],
    packages: [makePackage({ status: 'terminated' })],
  })

  renderPage()

  expect(await screen.findByRole('button', { name: 'Details' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Adjust package' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'More actions' })
  ).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Details' }))
  expect(
    screen.queryByRole('button', { name: 'Edit product info' })
  ).not.toBeInTheDocument()
})

test('shows an empty state with the next action in both tabs', async () => {
  const user = userEvent.setup()
  mockLoad({ channels: [makeChannel()] })

  renderPage()

  expect(
    await screen.findByRole('button', { name: 'Create a package' })
  ).toBeVisible()
  expect(screen.getByText('No packages yet')).toBeVisible()

  await user.click(screen.getByRole('tab', { name: 'Purchased by me' }))
  expect(
    await screen.findByRole('button', { name: 'Browse the market' })
  ).toBeVisible()
})

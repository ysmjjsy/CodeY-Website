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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { MarketplacePanel } from '../components/marketplace-panel'
import type { MarketplaceIndex, MarketplaceSource } from '../types'

const officialSource: MarketplaceSource = {
  name: 'Primary catalog',
  index_url: 'https://catalog.example/plugins/index.json',
  kind: 'official',
}
const customSource: MarketplaceSource = {
  name: 'Custom catalog',
  index_url: 'https://custom.example/index.json',
}
const communitySource: MarketplaceSource = {
  name: 'Configured community',
  index_url: 'https://community.example/catalog/index.json',
  kind: 'community',
}
const index: MarketplaceIndex = {
  indexVersion: 1,
  name: 'Configured plugins',
  plugins: [
    {
      key: 'example',
      name: 'Example plugin',
      latest: '1.0.0',
      versions: [
        { version: '1.0.0', path: 'plugin.js', sha256: 'a'.repeat(64) },
      ],
    },
  ],
}
const clients: QueryClient[] = []
function renderPanel(
  sources: MarketplaceSource[] = [],
  communityEnabled = false
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['task-plugin-marketplace-sources'], {
    sources,
    community_enabled: communityEnabled,
  })
  client.setQueryData(['task-plugins'], [])
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MarketplacePanel onKindChange={() => undefined} />
    </QueryClientProvider>
  )
  return client
}
function mockIndex() {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(index))
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('empty configured sources show setup and request no marketplace resources', async () => {
  const fetchMock = mockIndex()
  renderPanel()
  expect(
    await screen.findByText('No marketplace sources configured.')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Manage sources' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Community plugins' })).toBeNull()
  expect(screen.queryByLabelText('Plugin code')).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('an explicitly configured custom source loads directly with third-party warning', async () => {
  const fetchMock = mockIndex()
  renderPanel([customSource])
  expect(await screen.findByText('Example plugin')).toBeVisible()
  expect(screen.getByText('Third-party — use at your own risk')).toBeVisible()
  expect(fetchMock.mock.calls).toEqual([
    [customSource.index_url, { cache: 'no-cache' }],
  ])
})

test('only the selected configured source loads until the administrator switches sources', async () => {
  const fetchMock = mockIndex()
  const user = userEvent.setup()
  renderPanel([officialSource, customSource])
  await screen.findByText('Example plugin')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Marketplace source' }))
  await user.click(
    screen.getByRole('menuitemradio', { name: customSource.name })
  )
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  expect(fetchMock.mock.calls[1][0]).toBe(customSource.index_url)
})

test('a failed configured source displays an error without trying an alternate source', async () => {
  const fetchMock = vi.fn(async () => new Response('', { status: 503 }))
  vi.stubGlobal('fetch', fetchMock)
  renderPanel([officialSource, customSource])
  expect(await screen.findByText('Could not load this source')).toBeVisible()
  expect(fetchMock.mock.calls).toEqual([
    [officialSource.index_url, { cache: 'no-cache' }],
  ])
})

test('community disabled hides its controls and makes no community background requests', async () => {
  const fetchMock = mockIndex()
  renderPanel([communitySource])
  expect(
    await screen.findByText('No marketplace sources configured.')
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Community plugins' })).toBeNull()
  expect(screen.queryByLabelText('Plugin code')).toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})

test('community enabled shows configured plugins and resolves a code beside its configured index', async () => {
  const fetchMock = mockIndex()
  const user = userEvent.setup()
  renderPanel([communitySource], true)
  expect(await screen.findByText('Example plugin')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Community plugins' })
  ).toBeVisible()
  await user.type(screen.getByLabelText('Plugin code'), '12345678')
  await user.click(screen.getByRole('button', { name: 'Find' }))
  expect(
    await screen.findByText('Result for plugin code 12345678')
  ).toBeVisible()
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    communitySource.index_url,
    'https://community.example/catalog/resolve?code=12345678',
  ])
})

test('turning community off hides previously cached community results and stops requests', async () => {
  const fetchMock = mockIndex()
  const user = userEvent.setup()
  const client = renderPanel([communitySource], true)
  await screen.findByText('Example plugin')
  await user.type(screen.getByLabelText('Plugin code'), '12345678')
  await user.click(screen.getByRole('button', { name: 'Find' }))
  await screen.findByText('Result for plugin code 12345678')
  client.setQueryData(['task-plugin-marketplace-sources'], {
    sources: [communitySource],
    community_enabled: false,
  })
  expect(
    await screen.findByText('No marketplace sources configured.')
  ).toBeVisible()
  expect(screen.queryByText('Example plugin')).toBeNull()
  expect(screen.queryByText('Result for plugin code 12345678')).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('sources dialog saves source kinds and the explicit community setting', async () => {
  mockIndex()
  const user = userEvent.setup()
  const save = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: {
        sources: [{ ...customSource, kind: 'community' }],
        community_enabled: true,
      },
    },
  })
  renderPanel([customSource])
  await screen.findByText('Example plugin')
  await user.click(screen.getByRole('button', { name: 'Marketplace source' }))
  await user.click(screen.getByRole('menuitem', { name: 'Manage sources' }))
  const enabled = await screen.findByRole('switch', {
    name: 'Enable community plugins',
  })
  expect(enabled).not.toBeChecked()
  await user.click(enabled)
  await user.selectOptions(screen.getByLabelText('Source kind'), 'community')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      '/api/plugin/task/marketplace/sources',
      {
        sources: [{ ...customSource, kind: 'community' }],
        community_enabled: true,
      },
      expect.any(Object)
    )
  )
})

test.each(['official', 'community', 'third_party'] as const)(
  'recommendations are grouped only when the server explicitly configures the source as %s',
  async (kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...index,
          plugins: [
            { ...index.plugins[0], recommended: true },
            { ...index.plugins[0], key: 'other', name: 'Other plugin' },
          ],
        })
      )
    )
    renderPanel([{ ...customSource, kind }], true)
    await screen.findByText('Example plugin')
    if (kind === 'third_party') {
      expect(screen.queryByRole('heading', { name: 'Recommended' })).toBeNull()
      expect(
        screen.getByText('Third-party — use at your own risk')
      ).toBeVisible()
    } else {
      expect(screen.getByRole('heading', { name: 'Recommended' })).toBeVisible()
      expect(
        screen.getByRole('heading', { name: 'More plugins' })
      ).toBeVisible()
    }
  }
)

test('an official code lookup opens installation from its configured source while community is off', async () => {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL) =>
    Response.json({
      ...index,
      plugins: [{ ...index.plugins[0], code: '12345678' }],
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  const user = userEvent.setup()
  renderPanel([officialSource, communitySource])
  await screen.findByText('Example plugin')
  await user.type(screen.getByLabelText('Plugin code'), '12345678')
  await user.click(screen.getByRole('button', { name: 'Find' }))
  const result = (
    await screen.findByText('Result for plugin code 12345678')
  ).closest('section')
  if (!result) throw new Error('Plugin code result is missing')
  await user.click(within(result).getByRole('button', { name: 'Install' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Install Example plugin',
  })
  expect(dialog).toHaveTextContent('example · from Primary catalog')
  expect(
    fetchMock.mock.calls.every(
      ([url]) => !String(url).startsWith('https://community.example/')
    )
  ).toBe(true)
})

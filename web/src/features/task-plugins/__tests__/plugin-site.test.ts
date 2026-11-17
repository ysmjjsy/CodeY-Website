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
import { afterEach, expect, test, vi } from 'vitest'

import { fetchMarketplaceIndex } from '../lib/marketplace'
import { fetchPluginSourceText } from '../lib/plugin-url'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem('plugin-site')
})

test('legacy site preferences cannot rewrite a configured index or plugin address', async () => {
  localStorage.setItem(
    'plugin-site',
    JSON.stringify({ state: { site: 'pro' }, version: 1 })
  )
  const indexUrl = 'https://catalog.example/plugins/index.json'
  const sourceUrl = 'https://catalog.example/plugins/plugin.js'
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        url === indexUrl
          ? JSON.stringify({ indexVersion: 1, plugins: [] })
          : 'export const meta = {}'
      )
  )
  vi.stubGlobal('fetch', fetchMock)
  await fetchMarketplaceIndex(indexUrl)
  expect(await fetchPluginSourceText(sourceUrl)).toBe('export const meta = {}')
  expect(fetchMock.mock.calls).toEqual([
    [indexUrl, { cache: 'no-cache' }],
    [sourceUrl, { cache: 'no-cache' }],
  ])
})

test('a failed configured index makes no fallback request', async () => {
  const fetchMock = vi.fn(async () => {
    throw new TypeError('Failed to fetch')
  })
  vi.stubGlobal('fetch', fetchMock)
  await expect(
    fetchMarketplaceIndex('https://catalog.example/index.json')
  ).rejects.toThrow('Failed to fetch')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

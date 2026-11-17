import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { listMarketplaceSources } from '../api'
import { findPluginByCode, resolveCommunityPlugin } from '../lib/marketplace'
import type { MarketplaceSources } from '../types'

const trusted = {
  name: 'Own catalog',
  index_url: 'https://own.example/index.json',
  kind: 'official' as const,
}
const community = {
  name: 'Community',
  index_url: 'https://community.example/catalog/index.json',
  kind: 'community' as const,
}
const defaults = {
  community_enabled: false,
  short_codes_enabled: false,
  install_stats_enabled: false,
  remote_revocations_enabled: false,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test.each([null, {}, { sources: null }, []])(
  'empty or old settings %j default to no sources and all optional access disabled',
  async (payload) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: payload },
    })
    expect(await listMarketplaceSources()).toEqual({ sources: [], ...defaults })
  }
)

test('legacy array sources remain explicit third-party sources without enabling optional access', async () => {
  const source = { name: 'Legacy source', index_url: trusted.index_url }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [source] },
  })
  expect(await listMarketplaceSources()).toEqual({
    sources: [{ ...source, kind: 'third_party' }],
    ...defaults,
  })
})

test('only literal booleans opt into optional marketplace features', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        sources: [trusted],
        community_enabled: 'true',
        short_codes_enabled: 'true',
        install_stats_enabled: 1,
        remote_revocations_enabled: true,
      },
    },
  })
  expect(await listMarketplaceSources()).toEqual({
    sources: [trusted],
    ...defaults,
    remote_revocations_enabled: true,
  })
})

test.each([undefined, false])(
  'short codes enabled=%s prevents direct catalog and community lookup requests',
  async (enabled) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const settings: MarketplaceSources = {
      sources: [trusted, community],
      community_enabled: true,
      short_codes_enabled: enabled,
    }
    await expect(findPluginByCode('12345678', settings)).resolves.toBeNull()
    await expect(
      resolveCommunityPlugin('12345678', community, settings)
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  }
)

test('community lookup rejects a removed source and a disabled community without network requests', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  for (const settings of [
    { sources: [], community_enabled: true, short_codes_enabled: true },
    {
      sources: [community],
      community_enabled: false,
      short_codes_enabled: true,
    },
  ]) {
    await expect(
      resolveCommunityPlugin('12345678', community, settings)
    ).resolves.toBeNull()
  }
  expect(fetchMock).not.toHaveBeenCalled()
})

test('an aborted lookup does not contact another source after its first response', async () => {
  const controller = new AbortController()
  const fetchMock = vi.fn(async () => {
    controller.abort()
    return Response.json({ indexVersion: 1, plugins: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  await expect(
    findPluginByCode(
      '12345678',
      {
        sources: [trusted, community],
        community_enabled: true,
        short_codes_enabled: true,
      },
      undefined,
      controller.signal
    )
  ).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

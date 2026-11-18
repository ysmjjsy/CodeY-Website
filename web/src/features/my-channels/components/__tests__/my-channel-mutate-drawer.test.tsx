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
import { useEffect } from 'react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { MyChannelMutateDrawer } from '../my-channel-mutate-drawer'
import { MyChannelsProvider, useMyChannels } from '../my-channels-provider'

function OpenCreateDrawer() {
  const { setOpen } = useMyChannels()

  useEffect(() => {
    setOpen('create')
  }, [setOpen])

  return <MyChannelMutateDrawer />
}

function renderCreateDrawer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MyChannelsProvider>
        <OpenCreateDrawer />
      </MyChannelsProvider>
    </QueryClientProvider>
  )
}

test('selecting a provider opens the shared channel configuration', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: {} },
  })

  renderCreateDrawer()

  await user.click(
    await screen.findByRole('option', { name: 'OpenAI Built-in #1' })
  )

  expect(await screen.findByRole('textbox', { name: /Name/ })).toHaveValue(
    'OpenAI'
  )
  expect(
    screen.getByRole('textbox', { name: /OpenAI Organization/ })
  ).toBeVisible()
  expect(screen.getByRole('tab', { name: /Routing & Mapping/ })).toBeVisible()
  expect(
    screen.queryByRole('tab', { name: /Other Settings/ })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('tab', { name: /Request & Response/ })
  ).not.toBeInTheDocument()
})

test('Azure uses its endpoint and API version fields in the connection tab', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: {} },
  })

  renderCreateDrawer()

  await user.click(await screen.findByRole('option', { name: /Azure/ }))

  expect(
    await screen.findByRole('textbox', {
      name: /AZURE_OPENAI_ENDPOINT/,
    })
  ).toBeVisible()
  expect(
    screen.getByRole('textbox', { name: /Default API Version/ })
  ).toBeVisible()
  expect(
    screen.queryByRole('tab', { name: /Other Settings/ })
  ).not.toBeInTheDocument()
})

test('a registered provider plugin appears with its endpoint, models, and channel settings', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/channel_options') {
      return {
        data: {
          success: true,
          data: {
            allowed_channel_types: [1, 14],
            types: [
              { type: 1, name: 'OpenAI', models: ['gpt-4o'] },
              {
                type: 14,
                name: 'Anthropic',
                models: ['claude-3-5-sonnet'],
              },
            ],
            plugins: [
              {
                key: 'live-provider',
                name: 'Live Provider',
                baseUrl: 'https://live-provider.example',
                models: ['live-model-a', 'live-model-b'],
                provider: true,
                channelConfig: {
                  type: 'object',
                  properties: {
                    workspace: {
                      type: 'string',
                      title: 'Workspace',
                    },
                  },
                },
              },
            ],
          },
        },
      } as never
    }
    if (url === '/api/models') {
      return {
        data: {
          success: true,
          data: {
            '1': ['gpt-4o'],
            '14': ['claude-3-5-sonnet'],
          },
        },
      } as never
    }
    return { data: { success: true, data: {} } } as never
  })

  renderCreateDrawer()

  const plugin = await screen.findByRole('option', {
    name: 'Live Provider Plugin live-provider',
  })
  expect(plugin).toHaveTextContent('2 models')
  await user.click(plugin)

  expect(await screen.findByRole('textbox', { name: /Name/ })).toHaveValue(
    'Live Provider'
  )
  expect(screen.getByRole('textbox', { name: /Base URL/ })).toHaveValue(
    'https://live-provider.example'
  )
  expect(screen.getByRole('button', { name: 'live-model-a' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'live-model-b' })).toBeVisible()

  const settings = await screen.findByRole('group', {
    name: 'Plugin settings',
  })
  expect(
    within(settings).getByRole('textbox', { name: 'Workspace' })
  ).toBeVisible()
})

test('Vertex AI exposes key format, API version, and deployment region', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: {} },
  })

  renderCreateDrawer()

  await user.click(await screen.findByRole('option', { name: /Vertex AI/ }))

  expect(await screen.findByText('Vertex AI Key Format')).toBeVisible()
  expect(screen.getByText('Use Vertex AI v1beta1 endpoint')).toBeVisible()
  expect(
    screen.getByRole('textbox', { name: /Deployment Region/ })
  ).toBeVisible()
  expect(
    screen.queryByRole('tab', { name: /Other Settings/ })
  ).not.toBeInTheDocument()
})

test('AWS exposes API type and key format selectors', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: {} },
  })

  renderCreateDrawer()

  await user.click(await screen.findByRole('option', { name: /AWS/ }))

  expect(await screen.findByText('AWS API')).toBeVisible()
  expect(screen.getByText('AWS Key Format')).toBeVisible()
  expect(screen.getByText('InvokeModel (legacy)')).toBeVisible()
  expect(screen.getByText('AccessKey / SecretAccessKey')).toBeVisible()
})

test('switching providers clears the previous provider connection values', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: {} },
  })

  renderCreateDrawer()

  await user.click(await screen.findByRole('option', { name: /OpenRouter/ }))
  await user.type(
    screen.getByRole('textbox', { name: /Base URL/ }),
    'https://previous-provider.example'
  )

  await user.click(screen.getByRole('button', { name: 'Change provider' }))
  await user.click(await screen.findByRole('option', { name: /Cloudflare/ }))

  expect(await screen.findByRole('textbox', { name: /Name/ })).toHaveValue(
    'Cloudflare'
  )
  expect(screen.getByRole('textbox', { name: /Base URL/ })).toHaveValue('')
})

test('fills provider models from the default model catalog', async () => {
  const user = userEvent.setup()
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/models') {
      return {
        data: {
          success: true,
          data: {
            '1': [
              'gpt-4o',
              'o3',
              'text-embedding-3-small',
              'claude-3-5-sonnet',
            ],
            '3': null,
          },
        },
      } as never
    }
    if (url === '/api/user/channel_default_base_urls') {
      return {
        data: {
          success: true,
          data: { '1': 'https://api.openai.com' },
        },
      } as never
    }
    return { data: { success: true, data: {} } } as never
  })

  renderCreateDrawer()

  await user.click(await screen.findByRole('option', { name: /OpenAI/ }))

  expect(screen.getByPlaceholderText('https://api.openai.com')).toBeVisible()
  const fillButton = await screen.findByRole('button', {
    name: 'Fill Related Models',
  })
  await waitFor(() => expect(fillButton).toBeEnabled())
  await user.click(fillButton)

  expect(await screen.findByRole('button', { name: 'gpt-4o' })).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'text-embedding-3-small' })
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'o3' })).toBeVisible()
  expect(screen.queryByText('claude-3-5-sonnet')).not.toBeInTheDocument()
  expect(get.mock.calls.some(([url]) => url === '/api/models')).toBe(true)
  expect(
    get.mock.calls.some(
      ([url]) => url === '/api/user/channel_default_base_urls'
    )
  ).toBe(true)
  expect(get.mock.calls.some(([url]) => url === '/api/channel/models')).toBe(
    false
  )
})

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
import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { expect, test } from 'vitest'

import type { ChannelConfigurationSection } from '../../lib/channel-configuration'
import { ChannelConfiguration } from '../drawers/channel-configuration'

const statuses = {
  connection: 'idle',
  routing: 'idle',
  request: 'idle',
  other: 'idle',
} as const

async function renderConfiguration(
  sections?: readonly ChannelConfigurationSection[]
) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: {} } },
  })

  return render(
    <I18nextProvider i18n={i18n}>
      <ChannelConfiguration
        section='connection'
        onSectionChange={() => undefined}
        sections={sections}
        statuses={statuses}
        connection={<div>Connection</div>}
        models={<div>Models</div>}
        quickOptions={null}
        routing={<div>Routing</div>}
        request={<div>Request</div>}
        other={<div>Other</div>}
      />
    </I18nextProvider>
  )
}

test('default configuration keeps the administrator tabs', async () => {
  await renderConfiguration()

  expect(screen.getAllByRole('tab')).toHaveLength(4)
  expect(screen.getByRole('tab', { name: /Request & Response/ })).toBeVisible()
})

test('configuration sections hide unavailable tabs', async () => {
  await renderConfiguration(['connection', 'routing', 'other'])

  expect(screen.getAllByRole('tab')).toHaveLength(3)
  expect(
    screen.queryByRole('tab', { name: /Request & Response/ })
  ).not.toBeInTheDocument()
})

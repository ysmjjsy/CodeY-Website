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
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'vitest'

import { getOptionValue } from '../../hooks/use-system-options'

const billingDefaults = {
  'token_package_setting.enabled': false,
  'token_package_setting.commission_bps': 1000,
  'token_package_setting.seller_groups': [] as string[],
  'token_package_setting.allowed_channel_types': [] as number[],
}

describe('token package billing settings', () => {
  test('reads saved JSON arrays back instead of dropping unknown keys', () => {
    const settings = getOptionValue(
      [
        { key: 'token_package_setting.enabled', value: 'true' },
        { key: 'token_package_setting.commission_bps', value: '1500' },
        { key: 'token_package_setting.seller_groups', value: '["vip","svip"]' },
        {
          key: 'token_package_setting.allowed_channel_types',
          value: '[1,14,24]',
        },
        { key: 'seller_groups', value: '["ignored"]' },
      ],
      billingDefaults
    )

    assert.equal(settings['token_package_setting.enabled'], true)
    assert.equal(settings['token_package_setting.commission_bps'], 1500)
    assert.deepEqual(settings['token_package_setting.seller_groups'], [
      'vip',
      'svip',
    ])
    assert.deepEqual(
      settings['token_package_setting.allowed_channel_types'],
      [1, 14, 24]
    )
  })

  test('keeps the built-in defaults when a saved array is not valid JSON', () => {
    const settings = getOptionValue(
      [{ key: 'token_package_setting.seller_groups', value: 'vip,svip' }],
      billingDefaults
    )

    assert.deepEqual(settings['token_package_setting.seller_groups'], [])
  })

  test('saves the two lists under their dotted keys as JSON arrays', () => {
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../token-package-settings-section.tsx'
      ),
      'utf8'
    )

    assert.match(source, /name='token_package_setting\.seller_groups'/)
    assert.match(source, /name='token_package_setting\.allowed_channel_types'/)
    assert.match(source, /key\.endsWith\('\.seller_groups'\)/)
    assert.match(source, /key\.endsWith\('\.allowed_channel_types'\)/)
    assert.doesNotMatch(source, /name='seller_groups'/)
    assert.doesNotMatch(source, /name='allowed_channel_types'/)
  })
})

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
import { expect, test } from 'vitest'

import { parseSidebarModulesAdmin } from '@/features/system-settings/maintenance/config'

import { getVisibleAccountSections } from '../sections'

const all = parseSidebarModulesAdmin('')

test('the account tabs follow the requested order', () => {
  expect(getVisibleAccountSections(all, null)).toEqual([
    'profile',
    'wallet',
    'security',
    'keys',
  ])
})

test('a disabled module hides its tab while profile stays reachable', () => {
  expect(
    getVisibleAccountSections(
      parseSidebarModulesAdmin(
        JSON.stringify({
          personal: { enabled: true, topup: false, security: true },
          console: { enabled: true, token: false },
        })
      ),
      null
    )
  ).toEqual(['profile', 'security'])
})

test('a user preference can only hide tabs the admin left visible', () => {
  expect(
    getVisibleAccountSections(all, {
      personal: { enabled: true, security: false },
    })
  ).toEqual(['profile', 'wallet', 'keys'])
})

test('the real-name tab appears only while the token package market is on', () => {
  expect(getVisibleAccountSections(all, null)).not.toContain('verification')
  expect(
    getVisibleAccountSections(all, null, { tokenPackageEnabled: true })
  ).toEqual(['profile', 'wallet', 'security', 'keys', 'verification'])
})

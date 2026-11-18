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

import type { PackageEntitlement } from '../../types'
import { groupPackageEntitlements } from '../package-options'

function entitlement(
  overrides: Partial<PackageEntitlement>
): PackageEntitlement {
  return {
    id: 1,
    package_id: 7,
    package_title: 'Claude fast lane',
    status: 'active',
    amount_remaining: 100,
    end_time: 1000,
    models_snapshot: [{ model: 'claude-sonnet-4', multiplier: 0.6 }],
    ...overrides,
  } as PackageEntitlement
}

test('a package bought twice becomes one choice with the credit of both', () => {
  const options = groupPackageEntitlements([
    entitlement({ id: 1, amount_remaining: 100, end_time: 1000 }),
    entitlement({ id: 2, amount_remaining: 50, end_time: 3000 }),
  ])

  expect(options).toHaveLength(1)
  expect(options[0]).toMatchObject({
    packageId: 7,
    active: true,
    remaining: 150,
    endTime: 3000,
  })
})

test('a package with only used-up entitlements stays listed but inactive', () => {
  const options = groupPackageEntitlements([
    entitlement({ status: 'exhausted', amount_remaining: 0 }),
  ])

  expect(options).toEqual([
    expect.objectContaining({ packageId: 7, active: false, remaining: 0 }),
  ])
})

test('the model list is the union of every entitlement snapshot of the package', () => {
  const options = groupPackageEntitlements([
    entitlement({ models_snapshot: [{ model: 'a', multiplier: 1 }] }),
    entitlement({
      id: 2,
      models_snapshot: [
        { model: 'a', multiplier: 1 },
        { model: 'b', multiplier: 1 },
      ],
    }),
  ])

  expect(options[0].models).toEqual(['a', 'b'])
})

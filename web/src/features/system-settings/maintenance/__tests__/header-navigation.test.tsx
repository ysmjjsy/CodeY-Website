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

import {
  HEADER_NAV_DEFAULT,
  parseHeaderNavModules,
  serializeHeaderNavModules,
} from '../config'

test('legacy header navigation defaults subscription and market to visible', () => {
  const parsed = parseHeaderNavModules(
    JSON.stringify({
      home: true,
      products: true,
      docs: true,
      about: true,
    })
  )

  expect(parsed.subscription).toBe(true)
  expect(parsed.market).toBe(true)
})

test('header navigation preserves disabled subscription and market switches', () => {
  const parsed = parseHeaderNavModules(
    JSON.stringify({
      ...HEADER_NAV_DEFAULT,
      subscription: false,
      market: false,
    })
  )

  expect(parsed.subscription).toBe(false)
  expect(parsed.market).toBe(false)
  expect(parseHeaderNavModules(serializeHeaderNavModules(parsed))).toMatchObject(
    {
      subscription: false,
      market: false,
    }
  )
})

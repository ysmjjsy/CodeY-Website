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
import { describe, expect, it } from 'vitest'

import { mapStatusDataToConfig } from '../status-query'

/**
 * A stored name from before the CodeGuys rename is the old default, so it
 * shows as CodeGuys. A name set on purpose is shown as stored.
 */
describe('the displayed system name', () => {
  it('shows CodeGuys for a name from before the rename', () => {
    for (const stored of ['codeguys', ' New API ', 'new-api', 'NewAPI']) {
      expect(mapStatusDataToConfig({ system_name: stored }).systemName).toBe(
        'CodeGuys'
      )
    }
  })

  it('shows CodeGuys when the backend sends no name', () => {
    expect(mapStatusDataToConfig({}).systemName).toBe('CodeGuys')
    expect(mapStatusDataToConfig({ system_name: '  ' }).systemName).toBe(
      'CodeGuys'
    )
  })

  it('keeps a name that was set on purpose', () => {
    for (const chosen of ['My Gateway', 'codeguys cloud', 'CodeGuys Pro']) {
      expect(mapStatusDataToConfig({ system_name: chosen }).systemName).toBe(
        chosen
      )
    }
  })
})

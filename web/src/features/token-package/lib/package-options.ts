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
import type { PackageEntitlement } from '../types'

export type PackageOption = {
  packageId: number
  title: string
  /** True while at least one entitlement can still pay for requests. */
  active: boolean
  /** Credit left across the active entitlements. */
  remaining: number
  /** The latest end time among the active entitlements. */
  endTime: number
  /** Models any of the buyer's entitlements of this package may call. */
  models: string[]
}

/**
 * Groups a buyer's entitlements by package. A key binds to a package, not to
 * one purchase, so a package bought twice is one choice whose credit is the
 * sum of what is left.
 */
export function groupPackageEntitlements(
  entitlements: PackageEntitlement[]
): PackageOption[] {
  const byPackage = new Map<number, PackageOption>()
  for (const entitlement of entitlements) {
    let option = byPackage.get(entitlement.package_id)
    if (!option) {
      option = {
        packageId: entitlement.package_id,
        title: entitlement.package_title,
        active: false,
        remaining: 0,
        endTime: 0,
        models: [],
      }
      byPackage.set(entitlement.package_id, option)
    }
    for (const spec of entitlement.models_snapshot || []) {
      if (!option.models.includes(spec.model)) option.models.push(spec.model)
    }
    if (entitlement.status !== 'active') continue
    option.active = true
    option.remaining += entitlement.amount_remaining
    option.endTime = Math.max(option.endTime, entitlement.end_time)
  }
  return [...byPackage.values()]
}

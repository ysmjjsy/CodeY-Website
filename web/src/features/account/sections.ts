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
import type { TFunction } from 'i18next'

import type { SidebarModulesAdminConfig } from '@/features/system-settings/maintenance/config'

export const ACCOUNT_SECTION_IDS = [
  'profile',
  'wallet',
  'security',
  'keys',
] as const

export type AccountSectionId = (typeof ACCOUNT_SECTION_IDS)[number]

export const ACCOUNT_DEFAULT_SECTION: AccountSectionId = 'profile'

const SECTION_LABEL_KEYS: Record<AccountSectionId, string> = {
  profile: 'Profile',
  wallet: 'Wallet',
  security: 'Security & Access',
  keys: 'API Keys',
}

export function getAccountSectionLabel(
  section: AccountSectionId,
  t: TFunction
): string {
  return t(SECTION_LABEL_KEYS[section])
}

/**
 * Tabs follow the same admin × user sidebar_modules rules the standalone pages
 * used to. Profile stays reachable so the account page is never empty.
 */
export function getVisibleAccountSections(
  adminConfig: SidebarModulesAdminConfig,
  userConfig: SidebarModulesAdminConfig | null
): AccountSectionId[] {
  const visible = (section: string, module: string) => {
    const adminSection = adminConfig[section]
    if (!adminSection?.enabled || adminSection[module] !== true) return false
    if (!userConfig) return true
    const userSection = userConfig[section]
    if (!userSection) return true
    if (userSection.enabled === false) return false
    return userSection[module] !== false
  }

  return ACCOUNT_SECTION_IDS.filter((section) => {
    if (section === 'profile') return true
    if (section === 'wallet') return visible('personal', 'topup')
    if (section === 'security') return visible('personal', 'security')
    return visible('console', 'token')
  })
}

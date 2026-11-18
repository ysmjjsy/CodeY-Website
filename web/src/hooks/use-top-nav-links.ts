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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export type TopNavChildLink = {
  title: string
  /** Short line under the title. */
  description?: string
  href: string
  /** The cyan product marker. Only CodeY carries it. */
  accent?: boolean
}

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
  /**
   * Present only for the products entry, which opens a menu instead of
   * navigating. `href` is then the first product's page, used where a menu
   * cannot be shown.
   */
  children?: TopNavChildLink[]
}

/**
 * Generate top navigation links based on HeaderNavModules configuration from backend /api/status
 * Backend format example (stringified JSON):
 * {
 *   home: true,
 *   console: true,
 *   products: true,
 *   pricing: { enabled: true, requireAuth: false },
 *   rankings: { enabled: true, requireAuth: false },
 *   docs: true,
 *   about: true
 * }
 */
export function useTopNavLinks(): TopNavLink[] {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { auth } = useAuthStore()

  // Parse HeaderNavModules
  const modules = useMemo(() => {
    return parseHeaderNavModulesFromStatus(
      status as Record<string, unknown> | null
    )
  }, [status])

  const isAuthed = !!auth?.user

  const links: TopNavLink[] = []

  // The console is not a nav item. A signed-in user reaches it from the
  // account menu, so it never appears in the bar.

  // Home
  if (modules?.home !== false) {
    links.push({ title: t('Home'), href: '/' })
  }

  // Products. CodeY is the only one today; the menu exists so the next
  // product is another entry rather than another nav item.
  if (modules?.products !== false) {
    const codey = {
      title: 'CodeY',
      description: t('A local-first AI work partner'),
      href: '/products/codey',
      accent: true,
    }
    links.push({ title: t('Products'), href: codey.href, children: [codey] })
  }

  // Pricing
  const pricing = modules?.pricing
  if (pricing && typeof pricing === 'object' && pricing.enabled) {
    const requiresAuth = pricing.requireAuth && !isAuthed
    links.push({ title: t('Model Square'), href: '/pricing', requiresAuth })
  }

  if (modules?.subscription !== false) {
    links.push({ title: t('Subscription'), href: '/subscription' })
  }

  if (modules?.market !== false && status?.token_package_enabled === true) {
    links.push({ title: t('Token market'), href: '/market' })
  }

  // Rankings
  const rankings = modules?.rankings
  if (rankings && typeof rankings === 'object' && rankings.enabled) {
    const requiresAuth = rankings.requireAuth && !isAuthed
    links.push({ title: t('Rankings'), href: '/rankings', requiresAuth })
  }

  // Docs. Two entries, one per subject, each opening that subject's first
  // page. The chapters live in the docs sidebar, not in the menu. The
  // backend's docs_link is ignored: this site owns its documentation.
  if (modules?.docs !== false) {
    links.push({
      title: t('Docs'),
      href: '/docs/gateway',
      children: [
        {
          title: 'CodeGuys',
          description: t('The unified API gateway.'),
          href: '/docs/gateway',
        },
        {
          title: 'CodeY',
          description: t('A product built on CodeGuys.'),
          href: '/docs/codey',
          accent: true,
        },
      ],
    })
  }

  // About
  if (modules?.about !== false) {
    links.push({ title: t('About'), href: '/about' })
  }

  return links
}

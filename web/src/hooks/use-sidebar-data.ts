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
import {
  Activity,
  Box,
  ClipboardList,
  CreditCard,
  FileText,
  FlaskConical,
  LayoutDashboard,
  ListTodo,
  Package,
  ClipboardCheck,
  IdCard,
  Store,
  PlugZap,
  Radio,
  ServerCog,
  Settings,
  Ticket,
  Users,
  Workflow,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarBadges, SidebarData } from '@/components/layout/types'
import { useStatus } from '@/hooks/use-status'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(badges: SidebarBadges = {}): SidebarData {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { auth } = useAuthStore()
  const marketEnabled = Boolean(status?.token_package_enabled)
  const canReviewPackages = Boolean(
    auth?.user?.permissions?.admin_permissions?.token_package?.review
  )

  return {
    navGroups: [
      {
        id: 'chat',
        title: t('Frequently Used'),
        items: [
          {
            title: t('Playground'),
            url: '/playground',
            icon: FlaskConical,
          },
        ],
      },
      {
        id: 'general',
        title: t('General'),
        items: [
          {
            title: t('Overview'),
            url: '/dashboard/overview',
            icon: Activity,
          },
          {
            title: t('Dashboard'),
            url: '/dashboard/models',
            icon: LayoutDashboard,
          },
          {
            title: t('Usage Logs'),
            url: '/usage-logs/common',
            icon: FileText,
          },
          {
            title: t('Audit Logs'),
            url: '/usage-logs/audit',
            icon: ClipboardList,
          },
          ...(marketEnabled
            ? [
                {
                  title: t('Token market'),
                  url: '/market',
                  icon: Store,
                },
                {
                  title: t('My token packages'),
                  url: '/my-packages',
                  icon: Package,
                },
                {
                  title: t('Seller center'),
                  url: '/seller',
                  icon: Store,
                },
              ]
            : []),
          {
            title: t('Task Logs'),
            url: '/usage-logs/task',
            activeUrls: ['/usage-logs/drawing'],
            configUrls: ['/usage-logs/drawing', '/usage-logs/task'],
            icon: ListTodo,
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            title: t('Subscriptions'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          ...(marketEnabled && canReviewPackages
            ? [
                {
                  title: t('Package reviews'),
                  url: '/package-reviews',
                  icon: ClipboardCheck,
                },
                {
                  title: t('Real-name reviews'),
                  url: '/verification-reviews',
                  icon: IdCard,
                },
              ]
            : []),
          {
            title: t('System Info'),
            url: '/system-info',
            icon: ServerCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Plugins'),
            url: '/task-plugins',
            icon: PlugZap,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Request processing'),
            url: '/request-processing',
            icon: Workflow,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
            requiredRole: ROLE.SUPER_ADMIN,
            // Model pricing lives in System Settings.
            badge: badges.modelPricing,
          },
        ],
      },
    ],
  }
}

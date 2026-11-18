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
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiKeys } from '@/features/keys'
import { Profile } from '@/features/profile'
import { useProfile } from '@/features/profile/hooks'
import { Security } from '@/features/security'
import { parseSidebarModulesAdmin } from '@/features/system-settings/maintenance/config'
import { VerificationPanel } from '@/features/token-package/components/verification-panel'
import { Wallet } from '@/features/wallet'
import { useStatus } from '@/hooks/use-status'
import { useAuthStore } from '@/stores/auth-store'

import { AccountProfileCard } from './components/account-profile-card'
import { AccountReferralCard } from './components/account-referral-card'
import { AccountSubscriptionCard } from './components/account-subscription-card'
import {
  type AccountSectionId,
  ACCOUNT_DEFAULT_SECTION,
  getAccountSectionLabel,
  getVisibleAccountSections,
} from './sections'

export function Account() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false }) as { section?: string }
  const { status } = useStatus()
  const user = useAuthStore((state) => state.auth.user)
  const { profile, loading, refreshProfile } = useProfile()
  const activeSection = (params.section ??
    ACCOUNT_DEFAULT_SECTION) as AccountSectionId

  const visibleSections = useMemo(() => {
    const adminConfig = parseSidebarModulesAdmin(
      status?.SidebarModulesAdmin as string | null | undefined
    )
    const userConfig =
      user?.permissions?.sidebar_settings === false
        ? null
        : parseSidebarModulesAdmin(user?.sidebar_modules)
    return getVisibleAccountSections(adminConfig, userConfig, {
      tokenPackageEnabled: status?.token_package_enabled === true,
    })
  }, [
    status?.SidebarModulesAdmin,
    status?.token_package_enabled,
    user?.permissions?.sidebar_settings,
    user?.sidebar_modules,
  ])

  const handleSectionChange = useCallback(
    (section: string) => {
      // Wallet actions (top-up, purchase, transfer) change the balance,
      // subscription, and referral quota shown in the sidebar.
      if (activeSection === 'wallet' && section !== 'wallet') {
        void refreshProfile()
        void queryClient.invalidateQueries({
          queryKey: ['account', 'subscription-summary'],
        })
      }
      void navigate({
        to: '/account/$section',
        params: { section: section as AccountSectionId },
      })
    },
    [activeSection, navigate, queryClient, refreshProfile]
  )

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-6'>
        <aside
          aria-label={t('Account Information')}
          className='shrink-0 px-3 pt-4 sm:px-4 sm:pt-6 lg:w-96 lg:overflow-y-auto lg:py-6 lg:pr-0 lg:pl-6 xl:w-[28rem]'
        >
          <AccountProfileCard
            profile={profile}
            profileLoading={loading}
            onProfileUpdate={refreshProfile}
          />
          <div className='mt-4 hidden space-y-4 lg:block'>
            <AccountSubscriptionCard />
            <AccountReferralCard profile={profile} />
          </div>
        </aside>

        <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
          <div className='shrink-0 border-b px-3 pt-3 sm:px-4 sm:pt-5'>
            <Tabs
              value={activeSection}
              onValueChange={handleSectionChange}
              className='max-w-full'
            >
              <TabsList
                variant='line'
                className='h-auto w-full [scrollbar-width:none] justify-start gap-1 overflow-x-auto rounded-none p-0 group-data-horizontal/tabs:h-auto [&::-webkit-scrollbar]:hidden'
              >
                {visibleSections.map((section) => (
                  <TabsTrigger
                    key={section}
                    value={section}
                    className='flex-none px-2.5 pb-2 group-data-horizontal/tabs:after:bottom-0'
                  >
                    {getAccountSectionLabel(section, t)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className='flex min-h-0 flex-1 flex-col'>
            {activeSection === 'profile' && <Profile embedded />}
            {activeSection === 'wallet' && <Wallet embedded />}
            {activeSection === 'security' && <Security embedded />}
            {activeSection === 'keys' && <ApiKeys embedded />}
            {activeSection === 'verification' &&
              visibleSections.includes('verification') && (
                <div className='overflow-y-auto px-3 py-4 sm:px-4 sm:py-6'>
                  <VerificationPanel />
                </div>
              )}
          </div>
        </section>
      </div>
    </div>
  )
}

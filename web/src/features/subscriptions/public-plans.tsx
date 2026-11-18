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
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Crown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { PageTransition } from '@/components/page-transition'
import { Badge } from '@/components/ui/badge'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'
import { useAuthStore } from '@/stores/auth-store'

import { getPublicSubscriptionPlans } from './api'
import { PublicPlanCard } from './components/public-plan-card'

const publicSubscriptionPlansQueryKey = [
  'subscription',
  'public-plans',
] as const

export function PublicSubscriptionPlans() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.auth.user)
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)

  const plansQuery = useQuery({
    queryKey: publicSubscriptionPlansQueryKey,
    queryFn: async () => {
      const res = requireServerSuccess(await getPublicSubscriptionPlans())
      return res.data ?? []
    },
  })

  const handleSelectPlan = () => {
    if (!user) {
      openAuthDialog('sign-in', '/subscription')
      return
    }
    navigate({
      to: '/account/$section',
      params: { section: 'wallet' },
    })
  }

  let content: ReactNode
  const plans = plansQuery.data ?? []
  if (plansQuery.isLoading) {
    content = <LoadingState message={t('Loading subscription plans...')} />
  } else if (plansQuery.isError) {
    content = (
      <ErrorState
        title={t('Failed to load subscription plans')}
        description={
          plansQuery.error instanceof Error
            ? plansQuery.error.message
            : undefined
        }
        onRetry={() => void plansQuery.refetch()}
      />
    )
  } else if (plans.length === 0) {
    content = (
      <EmptyState
        title={t('No subscription plans available')}
        description={t(
          'The administrator has not published any subscription plans yet.'
        )}
      />
    )
  } else {
    content = (
      <div className='grid gap-5 md:grid-cols-2 xl:grid-cols-3'>
        {plans.map((plan, index) => (
          <PublicPlanCard
            key={plan.id}
            plan={plan}
            recommended={index === 0 && plans.length > 1}
            onSelect={handleSelectPlan}
          />
        ))}
      </div>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
          style={{
            background: [
              'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.72 0.18 250 / 80%) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.65 0.15 200 / 60%) 0%, transparent 70%)',
              'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.70 0.12 280 / 40%) 0%, transparent 70%)',
            ].join(', '),
            maskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <PageTransition className='relative mx-auto w-full max-w-[1200px] px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
          <header className='mx-auto mb-8 max-w-3xl pt-5 text-center sm:mb-12 sm:pt-10'>
            <Badge variant='outline' className='mb-4 gap-1.5'>
              <Crown className='size-3.5' />
              {t('Subscription')}
            </Badge>
            <h1 className='text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.15] font-bold tracking-tight'>
              {t('Subscription plans')}
            </h1>
            <p className='text-muted-foreground mx-auto mt-4 max-w-2xl text-sm leading-relaxed sm:text-base'>
              {t(
                'Choose a plan that fits how you use the gateway. Sign in to continue to checkout.'
              )}
            </p>
          </header>

          {content}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}

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
import { Link } from '@tanstack/react-router'
import { Crown } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { formatDate } from '@/lib/time'

type SubscriptionSummary = {
  active: UserSubscriptionRecord[]
  plans: PlanRecord[]
}

async function fetchSubscriptionSummary(): Promise<SubscriptionSummary> {
  const [subscriptionResponse, plansResponse] = await Promise.all([
    getSelfSubscriptionFull(),
    getPublicPlans(),
  ])
  const subscription = requireServerSuccess(subscriptionResponse).data
  const plans = requireServerSuccess(plansResponse).data ?? []
  return { active: subscription?.subscriptions ?? [], plans }
}

export function AccountSubscriptionCard() {
  const { t } = useTranslation()
  const summary = useQuery({
    queryKey: ['account', 'subscription-summary'],
    queryFn: fetchSubscriptionSummary,
    meta: { errorToast: false },
  })

  if (summary.isError) return null

  const active = summary.data?.active ?? []
  const primary = active[0]?.subscription
  const plans = summary.data?.plans ?? []
  const plan = primary
    ? plans.find((entry) => entry.plan.id === primary.plan_id)?.plan
    : undefined
  const total = Number(primary?.amount_total ?? 0)
  const used = Number(primary?.amount_used ?? 0)
  const remaining = Math.max(0, total - used)
  const usagePercent =
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const endTime = Number(primary?.end_time ?? 0)
  const resetTime = Number(primary?.next_reset_time ?? 0)
  const nextTime = resetTime > 0 ? resetTime : endTime
  const daysRemaining =
    endTime > 0
      ? Math.max(0, Math.ceil((endTime - Date.now() / 1000) / 86400))
      : 0

  let statusBadge: ReactNode = undefined
  if (!summary.isLoading) {
    statusBadge = primary ? (
      <StatusBadge label={t('Active')} variant='success' copyable={false} />
    ) : (
      <StatusBadge label={t('No Active')} variant='neutral' copyable={false} />
    )
  }

  let content: ReactNode
  if (summary.isLoading) {
    content = (
      <div className='space-y-3'>
        <Skeleton className='h-4 w-28' />
        <Skeleton className='h-1.5 w-full' />
        <Skeleton className='h-4 w-full' />
      </div>
    )
  } else if (primary) {
    content = (
      <>
        <div className='flex min-w-0 items-baseline justify-between gap-2'>
          <span className='truncate font-medium'>
            {plan?.title || t('Subscription')}
          </span>
          {active.length > 1 ? (
            <span className='text-muted-foreground shrink-0 text-xs'>
              {active.length} {t('active')}
            </span>
          ) : null}
        </div>

        {total > 0 ? (
          <div className='space-y-2'>
            <Progress
              value={usagePercent}
              aria-label={t('Usage percentage')}
              className='gap-0'
            />
            <div className='flex items-center justify-between gap-2 text-xs'>
              <span className='text-muted-foreground'>{t('Remaining')}</span>
              <span className='font-medium tabular-nums'>
                {formatQuota(remaining)}{' '}
                <span className='text-muted-foreground font-normal'>
                  / {formatQuota(total)}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <p className='text-muted-foreground text-xs'>{t('Unlimited')}</p>
        )}

        {nextTime > 0 ? (
          <div className='flex items-center justify-between gap-2 text-xs'>
            <span className='text-muted-foreground'>
              {resetTime > 0 ? t('Next reset') : t('Expires')}
            </span>
            <span className='tabular-nums'>{formatDate(nextTime)}</span>
          </div>
        ) : null}

        {daysRemaining > 0 ? (
          <p className='text-muted-foreground text-right text-[11px]'>
            {t('{{count}} days remaining', { count: daysRemaining })}
          </p>
        ) : null}
      </>
    )
  } else {
    content = (
      <>
        <p className='text-muted-foreground text-xs'>
          {t('Usage-based billing')}
        </p>
        {plans.length > 0 ? (
          <Button
            variant='outline'
            size='sm'
            className='w-full'
            render={
              <Link to='/account/$section' params={{ section: 'wallet' }} />
            }
          >
            {t('Subscription Plans')}
          </Button>
        ) : null}
      </>
    )
  }

  return (
    <TitledCard
      title={t('Subscription')}
      icon={<Crown className='size-4' />}
      iconTone='warning'
      disableHoverEffect
      headerClassName='px-4 py-3 !pb-3'
      contentClassName='space-y-3 p-4'
      titleClassName='text-sm'
      iconClassName='size-7'
      action={statusBadge}
    >
      {content}
    </TitledCard>
  )
}

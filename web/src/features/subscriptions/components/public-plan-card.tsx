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
import { Check, Crown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatQuota } from '@/lib/format'

import { formatDuration, formatResetPeriod } from '../lib'
import type { PublicSubscriptionPlan } from '../types'

type PublicPlanCardProps = {
  plan: PublicSubscriptionPlan
  recommended: boolean
  onSelect: () => void
}

export function PublicPlanCard(props: PublicPlanCardProps) {
  const { t } = useTranslation()
  const price =
    props.plan.price_amount === 0
      ? t('Free')
      : formatBillingCurrencyFromUSD(props.plan.price_amount)
  const total =
    props.plan.total_amount === 0
      ? t('Unlimited')
      : formatQuota(props.plan.total_amount)
  const purchaseLimit =
    props.plan.max_purchase_per_user === 0
      ? t('Unlimited')
      : t('{{count}} per user', {
          count: props.plan.max_purchase_per_user,
        })

  const details = [
    {
      label: t('Billing cycle'),
      value: formatDuration(props.plan, t),
    },
    {
      label: t('Included quota'),
      value: total,
    },
    {
      label: t('Quota reset'),
      value: formatResetPeriod(props.plan, t),
    },
    {
      label: t('Purchase limit'),
      value: purchaseLimit,
    },
  ]

  return (
    <Card
      className={
        props.recommended
          ? 'border-primary/40 shadow-primary/10 flex flex-col shadow-lg'
          : 'flex flex-col'
      }
    >
      <CardHeader className='space-y-3'>
        <div className='flex min-w-0 items-start justify-between gap-3'>
          <CardTitle className='min-w-0 text-xl'>{props.plan.title}</CardTitle>
          {props.recommended && (
            <Badge variant='secondary' className='shrink-0 gap-1'>
              <Crown className='size-3.5' />
              {t('Recommended')}
            </Badge>
          )}
        </div>
        <CardDescription>
          {props.plan.subtitle || t('Subscription plan')}
        </CardDescription>
        <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
          <span className='text-3xl font-bold tracking-tight'>{price}</span>
          <span className='text-muted-foreground text-sm'>
            / {formatDuration(props.plan, t)}
          </span>
        </div>
      </CardHeader>

      <CardContent className='flex-1'>
        <ul className='space-y-3 text-sm'>
          {details.map((detail) => (
            <li
              key={detail.label}
              className='flex items-start justify-between gap-4'
            >
              <span className='text-muted-foreground flex items-center gap-2'>
                <Check className='text-primary size-4 shrink-0' />
                {detail.label}
              </span>
              <span className='text-right font-medium'>{detail.value}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter>
        <Button className='w-full' onClick={props.onSelect}>
          {t('Get started')}
        </Button>
      </CardFooter>
    </Card>
  )
}

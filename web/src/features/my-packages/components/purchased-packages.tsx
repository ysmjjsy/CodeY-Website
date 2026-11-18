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
import { Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber, formatQuota, formatTimestampToDate } from '@/lib/format'
import { createServerError } from '@/lib/server-error-message'

import { fetchMyEntitlements } from '../../token-package/api'
import { entitlementStatusLabels } from '../../token-package/status-labels'
import type { PackageEntitlement } from '../../token-package/types'
import { PURCHASED_PACKAGES_QUERY_KEY } from '../lib'

function entitlementVariant(
  status: string
): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'active') return 'success'
  if (status === 'exhausted') return 'warning'
  if (status === 'expired') return 'secondary'
  return 'destructive'
}

function PurchasedPackageCard(props: { item: PackageEntitlement }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const percent =
    props.item.amount_total > 0
      ? Math.min(
          100,
          Math.round((props.item.amount_used / props.item.amount_total) * 100)
        )
      : 0
  const models = (props.item.models_snapshot || []).map((spec) => spec.model)
  const daysRemaining =
    props.item.end_time > 0
      ? Math.ceil(dayjs.unix(props.item.end_time).diff(dayjs(), 'day', true))
      : null
  const expiringSoon =
    props.item.status === 'active' &&
    daysRemaining !== null &&
    daysRemaining > 0 &&
    daysRemaining <= 7
  const inactive =
    props.item.status === 'expired' ||
    props.item.status === 'exhausted' ||
    props.item.status === 'terminated'

  return (
    <Card
      size='sm'
      className={
        inactive ? 'flex h-full flex-col opacity-75' : 'flex h-full flex-col'
      }
    >
      <CardHeader className='gap-1 pb-2'>
        <div className='flex items-start justify-between gap-3'>
          <CardTitle className='line-clamp-1 text-sm leading-snug'>
            {props.item.package_title}
          </CardTitle>
          <Badge variant={entitlementVariant(props.item.status)}>
            {t(entitlementStatusLabels[props.item.status] || props.item.status)}
          </Badge>
        </div>
        <CardDescription className='text-xs leading-4'>
          {props.item.end_time > 0
            ? t('Expires {{date}}', {
                date: formatTimestampToDate(props.item.end_time),
              })
            : t('Never expires')}
        </CardDescription>
      </CardHeader>

      <CardContent className='flex flex-1 flex-col gap-2 pt-0'>
        <div className='flex items-end justify-between gap-3'>
          <div>
            <p className='text-muted-foreground text-[11px]'>
              {t('Credit remaining')}
            </p>
            <p className='mt-0.5 text-lg font-semibold tracking-tight'>
              {formatQuota(props.item.amount_remaining)}
            </p>
          </div>
          <span className='text-muted-foreground text-xs font-medium'>
            {percent}%
          </span>
        </div>
        <Progress value={percent} className='h-1.5' />
        <div className='text-muted-foreground flex items-center justify-between gap-3 text-[11px]'>
          <span>
            {t('Used {{used}} of {{total}}', {
              used: formatQuota(props.item.amount_used),
              total: formatQuota(props.item.amount_total),
            })}
          </span>
        </div>

        {expiringSoon && (
          <p className='text-warning-strong text-[11px] font-medium'>
            {t('{{count}} days remaining', { count: daysRemaining })}
          </p>
        )}

        <div className='flex flex-wrap gap-1.5'>
          {models.slice(0, 2).map((model) => (
            <Badge
              key={model}
              variant='outline'
              className='max-w-48 truncate font-normal'
            >
              {model}
            </Badge>
          ))}
          {models.length > 2 && (
            <Badge variant='secondary'>+{models.length - 2}</Badge>
          )}
        </div>

        {props.item.extended_seconds > 0 && (
          <p className='text-muted-foreground text-[11px]'>
            {t('Extended by {{hours}} hours after outages', {
              hours: formatNumber(props.item.extended_seconds / 3600, locale),
            })}
          </p>
        )}
        {props.item.refunded_quota > 0 && (
          <p className='text-muted-foreground text-[11px]'>
            {t('Refunded: {{amount}}', {
              amount: formatQuota(props.item.refunded_quota),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function PurchasedPackages() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: PURCHASED_PACKAGES_QUERY_KEY,
    meta: { errorToast: false },
    queryFn: async () => {
      const response = await fetchMyEntitlements()
      if (!response.success) {
        throw createServerError(response, t('Failed to load your packages'))
      }
      return response.data || []
    },
  })

  if (query.isLoading) {
    return <LoadingState message={t('Loading token packages...')} />
  }
  if (query.isError) {
    return (
      <ErrorState
        description={
          query.error instanceof Error ? query.error.message : undefined
        }
        onRetry={() => void query.refetch()}
      />
    )
  }

  const items = query.data || []
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title={t('No packages yet')}
        description={t('Buy a package in the token market to start using it.')}
        action={
          <Button render={<Link to='/market' />}>
            {t('Browse the market')}
          </Button>
        }
      />
    )
  }

  return (
    <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
      {items.map((item) => (
        <PurchasedPackageCard key={item.id} item={item} />
      ))}
    </div>
  )
}

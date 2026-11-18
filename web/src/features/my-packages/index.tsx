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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { fetchMyEntitlements } from '../token-package/api'
import { entitlementStatusLabels } from '../token-package/status-labels'
import type { PackageEntitlement } from '../token-package/types'

function statusVariant(status: string) {
  switch (status) {
    case 'active':
      return 'default' as const
    case 'exhausted':
    case 'expired':
      return 'secondary' as const
    default:
      return 'destructive' as const
  }
}

export function MyPackages() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [items, setItems] = useState<PackageEntitlement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchMyEntitlements()
        if (!res.success) {
          handleServerError(
            createServerError(res, t('Failed to load your packages'))
          )
          return
        }
        if (!cancelled) setItems(res.data || [])
      } catch (error) {
        handleServerError(error, t('Failed to load your packages'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('My token packages')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {!loading && items.length === 0 ? (
          <EmptyState
            title={t('No packages yet')}
            description={t(
              'Buy a package in the token market to start using it.'
            )}
          />
        ) : (
          <div className='grid gap-4 md:grid-cols-2'>
            {items.map((item) => {
              const percent =
                item.amount_total > 0
                  ? Math.min(
                      100,
                      Math.round((item.amount_used / item.amount_total) * 100)
                    )
                  : 0
              return (
                <Card key={item.id}>
                  <CardHeader>
                    <CardTitle className='flex items-center justify-between gap-2'>
                      <span>{item.package_title}</span>
                      <Badge variant={statusVariant(item.status)}>
                        {t(entitlementStatusLabels[item.status] || item.status)}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {t('Expires')}{' '}
                      {item.end_time > 0
                        ? formatTimestampToDate(item.end_time)
                        : t('Never')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='space-y-3 text-sm'>
                    <Progress value={percent} />
                    <div className='flex justify-between'>
                      <span>
                        {t('Remaining')}:{' '}
                        <span className='font-medium'>
                          {formatQuota(item.amount_remaining)}
                        </span>
                      </span>
                      <span className='text-muted-foreground'>
                        {formatQuota(item.amount_used)} /{' '}
                        {formatQuota(item.amount_total)}
                      </span>
                    </div>
                    {item.extended_seconds > 0 && (
                      <p className='text-muted-foreground'>
                        {t('Extended by {{hours}} hours after outages', {
                          hours: formatNumber(
                            item.extended_seconds / 3600,
                            locale
                          ),
                        })}
                      </p>
                    )}
                    {item.refunded_quota > 0 && (
                      <p className='text-muted-foreground'>
                        {t('Refunded: {{amount}}', {
                          amount: formatQuota(item.refunded_quota),
                        })}
                      </p>
                    )}
                    <p className='text-muted-foreground'>
                      {(item.models_snapshot || [])
                        .map((spec) => spec.model)
                        .join(', ')}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

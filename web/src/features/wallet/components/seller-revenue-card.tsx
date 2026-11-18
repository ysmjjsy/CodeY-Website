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
import { Coins } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import {
  fetchSellerLedger,
  fetchSellerStats,
  fetchSellerStatus,
} from '@/features/token-package/api'
import {
  ledgerStatusLabels,
  ledgerTypeLabels,
} from '@/features/token-package/status-labels'
import type {
  SellerLedgerEntry,
  SellerRevenueSummary,
} from '@/features/token-package/types'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

interface SellerRevenueCardProps {
  enabled: boolean
}

interface SellerRevenueData {
  stats: SellerRevenueSummary | null
  entries: SellerLedgerEntry[]
}

export function SellerRevenueCard({ enabled }: SellerRevenueCardProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<SellerRevenueData | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setData(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    const load = async () => {
      try {
        const [statusRes, statsRes, ledgerRes] = await Promise.all([
          fetchSellerStatus(),
          fetchSellerStats(),
          fetchSellerLedger(1, 20),
        ])
        if (cancelled) return

        const stats = statsRes.success ? (statsRes.data ?? null) : null
        const entries = ledgerRes.success ? (ledgerRes.data?.items ?? []) : []
        const hasRevenue =
          (stats?.pending_quota ?? 0) > 0 ||
          (stats?.frozen_quota ?? 0) > 0 ||
          (stats?.settled_total_quota ?? 0) > 0 ||
          (stats?.sales_count ?? 0) > 0 ||
          entries.length > 0
        const isSeller =
          statusRes.success && statusRes.data?.in_seller_group === true
        setData(isSeller || hasRevenue ? { stats, entries } : null)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [enabled])

  if (!enabled || loading || !data) return null

  const summary = [
    {
      label: t('Pending'),
      value: formatQuota(data.stats?.pending_quota ?? 0),
    },
    {
      label: t('Frozen'),
      value: formatQuota(data.stats?.frozen_quota ?? 0),
    },
    {
      label: t('Settled'),
      value: formatQuota(data.stats?.settled_total_quota ?? 0),
    },
  ]

  return (
    <Card data-card-hover='false'>
      <CardHeader>
        <div className='flex items-start gap-2.5'>
          <IconBadge tone='success'>
            <Coins />
          </IconBadge>
          <div className='min-w-0'>
            <CardTitle>{t('Token package revenue')}</CardTitle>
            <CardDescription>
              {t(
                'Revenue from token packages you sell. Settled amounts are added to your balance.'
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid grid-cols-3 divide-x rounded-lg border'>
          {summary.map((item) => (
            <div key={item.label} className='min-w-0 px-3 py-3'>
              <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
                {item.label}
              </div>
              <div className='mt-1 font-mono text-sm font-semibold break-all tabular-nums'>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <h4 className='text-sm font-medium'>{t('Ledger')}</h4>
            <span className='text-muted-foreground text-xs'>
              {t('{{count}} orders', {
                count: data.stats?.sales_count ?? 0,
              })}
            </span>
          </div>
          {data.entries.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('No entries yet')}
            </p>
          ) : (
            <div className='max-h-64 divide-y overflow-y-auto rounded-lg border'>
              {data.entries.map((entry) => (
                <div
                  key={entry.id}
                  className='flex items-center justify-between gap-3 px-3 py-2'
                >
                  <div className='min-w-0'>
                    <div className='truncate text-sm'>
                      {t(ledgerTypeLabels[entry.type] || entry.type)} ·{' '}
                      {t(ledgerStatusLabels[entry.status] || entry.status)}
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {formatTimestampToDate(entry.created_at)}
                    </div>
                  </div>
                  <div className='shrink-0 text-sm font-medium tabular-nums'>
                    {formatQuota(entry.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

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
import { useMemo, useState } from 'react'

import { Link } from '@tanstack/react-router'
import { ArrowRight, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'
import {
  DEFAULT_TOKEN_UNIT,
  QUOTA_TYPE_VALUES,
} from '@/features/pricing/constants'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import type { PricingModel } from '@/features/pricing/types'

const PREVIEW_ROWS = 6
const SKELETON_KEYS = Array.from(
  { length: PREVIEW_ROWS },
  (_, i) => `skeleton-${i}`
)

function unitPrice(model: PricingModel, priceRate: number, usdExchangeRate: number): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return formatRequestPrice(model, false, priceRate, usdExchangeRate)
  }
  return formatPrice(
    model,
    'input',
    DEFAULT_TOKEN_UNIT,
    false,
    priceRate,
    usdExchangeRate
  )
}

interface MarketPreviewProps {
  className?: string
}

export function MarketPreview(props: MarketPreviewProps) {
  const { t } = useTranslation()
  const { models, isLoading, priceRate, usdExchangeRate } = usePricingData()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter(
      (m) =>
        m.model_name.toLowerCase().includes(q) ||
        (m.vendor_name ?? '').toLowerCase().includes(q)
    )
  }, [models, query])

  const rows = filtered.slice(0, PREVIEW_ROWS)

  function renderBody() {
    if (isLoading) {
      return (
        <div className='divide-border divide-y'>
          {SKELETON_KEYS.map((key) => (
            <div key={key} className='flex items-center gap-4 px-6 py-4'>
              <Skeleton className='size-8 rounded-lg' />
              <Skeleton className='h-4 flex-1' />
              <Skeleton className='h-4 w-20' />
            </div>
          ))}
        </div>
      )
    }
    if (rows.length === 0) {
      return (
        <div className='text-muted-foreground px-6 py-12 text-center text-sm'>
          {t('No models match “{{query}}”', { query })}
        </div>
      )
    }
    return (
      <ul className='divide-border divide-y'>
        {rows.map((model) => (
          <li key={model.id ?? model.model_name}>
            <Link
              to='/pricing/$modelId'
              params={{ modelId: model.model_name }}
              className='hover:bg-muted/50 grid grid-cols-[1.6fr_1fr] items-center gap-4 px-6 py-3.5 transition-colors sm:grid-cols-[1.6fr_1fr_1fr_1fr_auto]'
            >
              <div className='flex min-w-0 items-center gap-3'>
                <span className='bg-muted/60 flex size-8 shrink-0 items-center justify-center rounded-lg'>
                  {getLobeIcon(model.icon || model.vendor_icon, 18)}
                </span>
                <span className='truncate text-sm font-medium'>
                  {model.model_name}
                </span>
              </div>
              <span className='text-muted-foreground truncate text-sm'>
                {model.vendor_name ?? '—'}
              </span>
              <span className='hidden text-right font-mono text-sm sm:block'>
                {unitPrice(model, priceRate ?? 1, usdExchangeRate)}
              </span>
              <span className='text-muted-foreground hidden text-right text-xs sm:block'>
                {model.quota_type === QUOTA_TYPE_VALUES.REQUEST
                  ? t('Per request')
                  : t('Per token')}
              </span>
              <ArrowRight className='text-muted-foreground hidden size-4 sm:block' />
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section
      aria-label={t('Model market')}
      className={cn('relative px-6 py-16 md:py-20', props.className)}
    >
      <div className='mx-auto max-w-6xl'>
        <div className='mb-8 flex flex-wrap items-end justify-between gap-4'>
          <div>
            <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
              {t('Model market')}
            </p>
            <h2 className='text-[clamp(1.6rem,3vw,2.25rem)] font-bold tracking-tight'>
              {t('Compare every upstream in one list')}
            </h2>
            <p className='text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed'>
              {t(
                'Live prices from every connected provider. Search it here, open the full market to filter, sort, and call.'
              )}
            </p>
          </div>
          <Button
            variant='outline'
            render={<Link to='/pricing' />}
            className='group rounded-lg'
          >
            {t('Open the market')}
            <ArrowRight className='ml-1.5 size-4 transition-transform duration-150 group-hover:translate-x-0.5' />
          </Button>
        </div>

        {/* Search */}
        <div className='relative mb-5 max-w-sm'>
          <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
          <Input
            type='search'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search a model or provider')}
            aria-label={t('Search a model or provider')}
            className='h-10 pl-9'
          />
        </div>

        <div className='bg-card overflow-hidden rounded-2xl border'>
          {/* header */}
          <div className='border-border text-muted-foreground hidden grid-cols-[1.6fr_1fr_1fr_1fr_auto] gap-4 border-b px-6 py-3 text-[11px] font-medium tracking-wider uppercase sm:grid'>
            <span>{t('Model')}</span>
            <span>{t('Provider')}</span>
            <span className='text-right'>{t('Input / M')}</span>
            <span className='text-right'>{t('Billing')}</span>
            <span className='sr-only'>{t('Open')}</span>
          </div>

          {renderBody()}
        </div>

        <p className='text-muted-foreground mt-4 text-xs'>
          {t('{{count}} models listed', {
            count: isLoading ? '—' : filtered.length,
          })}
        </p>
      </div>
    </section>
  )
}

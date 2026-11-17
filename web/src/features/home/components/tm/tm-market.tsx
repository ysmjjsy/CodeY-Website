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
import { ArrowRight, ChevronRight, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DEFAULT_TOKEN_UNIT,
  QUOTA_TYPE_VALUES,
} from '@/features/pricing/constants'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import type { PricingModel } from '@/features/pricing/types'

import { modelIcon } from './tm-brand'

const PREVIEW_ROWS = 4
const SKELETON_KEYS = Array.from({ length: 4 }, (_, i) => `row-skeleton-${i}`)
const FILTERS = [
  { key: 'all', labelKey: 'All models' },
  { key: 'reasoning', labelKey: 'Complex reasoning' },
  { key: 'coding', labelKey: 'Code development' },
  { key: 'efficient', labelKey: 'Cost effective' },
]

// Map a live model to the capability tags the prototype shows. Since the
// backend has no capability field, infer a small set from name + vendor so the
// filter chips have something real to act on.
function tagsFor(model: PricingModel): string[] {
  const hay = `${model.model_name} ${model.vendor_name ?? ''}`.toLowerCase()
  const tags = new Set<string>()
  if (/claude|gpt|o[0-9]|reason|gemini|grok|qwen|sonnet|opus|pro/.test(hay)) {
    tags.add('reasoning')
  }
  if (/claude|gpt|deepseek|codex|code|devstral|qwen|sonnet/.test(hay)) {
    tags.add('coding')
  }
  if (/deepseek|mini|nano|lite|flash|small|free|efficient|v3/.test(hay)) {
    tags.add('efficient')
  }
  if (tags.size === 0) tags.add('reasoning')
  return [...tags]
}

function unitPrice(
  model: PricingModel,
  type: 'input' | 'output',
  priceRate: number,
  usdExchangeRate: number
): string {
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return type === 'input'
      ? formatRequestPrice(model, false, priceRate, usdExchangeRate)
      : '—'
  }
  return formatPrice(
    model,
    type,
    DEFAULT_TOKEN_UNIT,
    false,
    priceRate,
    usdExchangeRate
  )
}

interface TmMarketProps {
  onOpenDetails?: (model: PricingModel) => void
}

export function TmMarket(props: TmMarketProps) {
  const { t } = useTranslation()
  const { models, isLoading, priceRate, usdExchangeRate } = usePricingData()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models.filter((m) => {
      const inCategory =
        filter === 'all' || tagsFor(m).includes(filter)
      const hay = `${m.model_name} ${m.vendor_name ?? ''}`.toLowerCase()
      return inCategory && (!q || hay.includes(q))
    })
  }, [models, filter, query])

  const rows = filtered.slice(0, PREVIEW_ROWS)

  function renderRows() {
    if (isLoading) {
      return SKELETON_KEYS.map((key) => (
        <tr key={key}>
          <td colSpan={5}>
            <Skeleton className='h-9 w-full' />
          </td>
        </tr>
      ))
    }
    return rows.map((m) => (
      <tr key={m.id ?? m.model_name}>
        <td>
          <div className='tm-table-model'>
            <span className='tm-model-monogram'>
              {modelIcon(m, 16)}
            </span>
            <div>
              <strong>{m.model_name}</strong>
              <span>{m.vendor_name ?? t('Provider')}</span>
            </div>
          </div>
        </td>
        <td data-th={t('Input / 1M Token')}>
          {unitPrice(m, 'input', priceRate ?? 1, usdExchangeRate)}
        </td>
        <td data-th={t('Output / 1M Token')}>
          {unitPrice(m, 'output', priceRate ?? 1, usdExchangeRate)}
        </td>
        <td>
          <div className='tm-capability-tags'>
            {tagsFor(m).map((tag) => (
              <Badge key={tag} variant='outline'>
                {t(FILTERS.find((f) => f.key === tag)?.labelKey ?? tag)}
              </Badge>
            ))}
          </div>
        </td>
        <td>
          <Button
            variant='ghost'
            size='sm'
            className='tm-table-action'
            onClick={() => props.onOpenDetails?.(m)}
          >
            {t('View pricing')}
            <ChevronRight aria-hidden='true' />
          </Button>
        </td>
      </tr>
    ))
  }

  return (
    <section
      id='market'
      className='tm-market tm-shell tm-space'
      aria-labelledby='tm-market-title'
    >
      <div className='tm-heading tm-split-heading'>
        <div>
          <p className='tm-label'>{t('Model market')}</p>
          <h2 id='tm-market-title'>
            {t('For your next call,')}
            <br />
            {t('find the right model.')}
          </h2>
        </div>
        <p>
          {t(
            'Compare model capability, provider, and call price, and spend your credit on the capability that fits the job.'
          )}
        </p>
      </div>

      <div className='tm-market-toolbar'>
        <ToggleGroup
          value={[filter]}
          onValueChange={(values) => {
            const next = values[0]
            if (next) setFilter(next)
          }}
          variant='outline'
          size='sm'
          spacing={8}
          aria-label={t('Filter model category')}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.key} value={f.key}>
              {t(f.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <label className='tm-search-field'>
          <Search aria-hidden='true' className='size-4 text-muted-foreground' />
          <Input
            type='search'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search a model or provider')}
            aria-label={t('Search a model or provider')}
            className='h-auto w-[170px] border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0'
          />
        </label>
      </div>

      <div className='tm-market-table-wrap'>
        <table className='tm-market-table'>
          <thead>
            <tr>
              <th scope='col'>{t('Model / Provider')}</th>
              <th scope='col'>{t('Input / 1M Token')}</th>
              <th scope='col'>{t('Output / 1M Token')}</th>
              <th scope='col'>{t('Suitable capability')}</th>
              <th scope='col'>
                <span className='sr-only'>{t('Action')}</span>
              </th>
            </tr>
          </thead>
          <tbody>{renderRows()}</tbody>
        </table>
        {!isLoading && rows.length === 0 && (
          <Empty className='tm-market-empty'>
            <EmptyHeader>
              <EmptyTitle>{t('No matching models')}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant='link'
                size='sm'
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                {t('Clear filters')}
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>

      <div className='tm-market-caption'>
        <p>
          <span className='tm-demo-dot' />
          {t('Showing a preview of the live model market.')}
        </p>
        <Link to='/pricing' className='tm-inline-link'>
          {t('View all models and prices')}
          <ArrowRight aria-hidden='true' />
        </Link>
      </div>
    </section>
  )
}

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
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'
import {
  QUOTA_TYPE_VALUES,
  TOKEN_UNIT_DIVISORS,
} from '@/features/pricing/constants'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import type { PricingModel } from '@/features/pricing/types'

// Preset token budgets the slider snaps to (input tokens). Output is 1/5.
const TOKEN_PRESETS = [
  2_000, 5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 200_000, 400_000,
  800_000,
]
// Cap the model switcher so the console stays one row on desktop.
const MODEL_CHOICES = 4
const CHOICE_SKELETON_KEYS = Array.from(
  { length: MODEL_CHOICES },
  (_, i) => `choice-skeleton-${i}`
)

function formatCompactTokens(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 0,
  }).format(value)
}

interface QuoteConsoleProps {
  className?: string
}

export function QuoteConsole(props: QuoteConsoleProps) {
  const { t, i18n } = useTranslation()
  const { models, isLoading, usdExchangeRate } = usePricingData()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [presetIndex, setPresetIndex] = useState(2) // default 10K input tokens

  // Token-billable models only, with a valid ratio so the quote is real.
  const quotable = useMemo(
    () =>
      models.filter(
        (m) =>
          m.quota_type !== QUOTA_TYPE_VALUES.REQUEST &&
          Number.isFinite(m.model_ratio) &&
          Number.isFinite(m.completion_ratio)
      ),
    [models]
  )

  const choices = useMemo(() => quotable.slice(0, MODEL_CHOICES), [quotable])

  const selected: PricingModel | undefined = useMemo(() => {
    return choices.find((m) => m.model_name === selectedId) ?? choices[0]
  }, [choices, selectedId])

  const inputTokens = TOKEN_PRESETS[presetIndex]
  const outputTokens = Math.round(inputTokens / 5)

  // Estimated spend in USD for this token budget, computed locally.
  const estimate = useMemo(() => {
    if (!selected) return null
    const perInput =
      (selected.model_ratio * 2) / TOKEN_UNIT_DIVISORS.M
    const perOutput = perInput * selected.completion_ratio
    const usd = inputTokens * perInput + outputTokens * perOutput
    return formatBillingCurrencyFromUSD(usd * usdExchangeRate, {
      digitsLarge: 4,
      digitsSmall: 4,
      abbreviate: false,
    })
  }, [selected, inputTokens, outputTokens, usdExchangeRate])

  const inputPrice =
    selected &&
    formatBillingCurrencyFromUSD(
      (selected.model_ratio * 2 * usdExchangeRate) / TOKEN_UNIT_DIVISORS.M,
      { digitsLarge: 4, digitsSmall: 4, abbreviate: false }
    )
  const outputPrice =
    selected &&
    formatBillingCurrencyFromUSD(
      (selected.model_ratio *
        2 *
        selected.completion_ratio *
        usdExchangeRate) /
        TOKEN_UNIT_DIVISORS.M,
      { digitsLarge: 4, digitsSmall: 4, abbreviate: false }
    )

  return (
    <section
      aria-label={t('Token quote console')}
      className={cn('relative px-6 pb-16', props.className)}
    >
      <div className='mx-auto max-w-6xl'>
        <div className='bg-card overflow-hidden rounded-2xl border'>
          {/* Model picker strip */}
          <div className='border-border flex flex-wrap items-center gap-2 border-b px-5 py-3.5'>
            <span className='text-muted-foreground mr-1 text-xs font-medium tracking-widest uppercase'>
              {t('Pick a model')}
            </span>
            {isLoading
              ? CHOICE_SKELETON_KEYS.map((key) => (
                  <Skeleton key={key} className='h-8 w-24 rounded-lg' />
                ))
              : choices.map((model) => {
                  const active =
                    model.model_name === selected?.model_name
                  return (
                    <button
                      key={model.model_name}
                      type='button'
                      aria-pressed={active}
                      onClick={() => setSelectedId(model.model_name)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                      )}
                    >
                      <span className='flex size-4 items-center justify-center'>
                        {getLobeIcon(model.icon || model.vendor_icon, 16)}
                      </span>
                      {model.model_name}
                    </button>
                  )
                })}
          </div>

          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]'>
            {/* Selected model + its unit prices */}
            <div className='border-border border-b px-6 py-5 sm:border-b-0 sm:border-r'>
              {isLoading || !selected ? (
                <div className='space-y-2.5'>
                  <Skeleton className='h-5 w-40' />
                  <Skeleton className='h-4 w-28' />
                </div>
              ) : (
                <>
                  <div className='flex items-center gap-2.5'>
                    <span className='bg-muted/60 flex size-9 shrink-0 items-center justify-center rounded-lg'>
                      {getLobeIcon(selected.icon || selected.vendor_icon, 20)}
                    </span>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-semibold'>
                        {selected.model_name}
                      </p>
                      <p className='text-muted-foreground truncate text-xs'>
                        {selected.vendor_name ?? t('Community provider')}
                      </p>
                    </div>
                  </div>
                  <div className='mt-4 flex gap-6'>
                    <div>
                      <p className='text-muted-foreground text-[11px] tracking-wider uppercase'>
                        {t('Input / M')}
                      </p>
                      <p className='mt-0.5 font-mono text-base font-semibold'>
                        {inputPrice}
                      </p>
                    </div>
                    <div>
                      <p className='text-muted-foreground text-[11px] tracking-wider uppercase'>
                        {t('Output / M')}
                      </p>
                      <p className='mt-0.5 font-mono text-base font-semibold'>
                        {outputPrice}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Token budget slider */}
            <div className='border-border border-b px-6 py-5 sm:border-b-0 lg:border-r'>
              <div className='flex items-baseline justify-between'>
                <p className='text-muted-foreground text-[11px] tracking-wider uppercase'>
                  {t('Token budget')}
                </p>
                <Badge variant='secondary' className='font-mono'>
                  {formatCompactTokens(inputTokens, locale)}
                  {' → '}
                  {formatCompactTokens(outputTokens, locale)}
                </Badge>
              </div>
              <input
                type='range'
                min={1}
                max={TOKEN_PRESETS.length}
                step={1}
                value={presetIndex + 1}
                aria-label={t('Token budget')}
                aria-valuetext={t('{{input}} input tokens, {{output}} output tokens', {
                  input: formatCompactTokens(inputTokens, locale),
                  output: formatCompactTokens(outputTokens, locale),
                })}
                onChange={(e) => setPresetIndex(Number(e.target.value) - 1)}
                className='accent-primary mt-5 w-full cursor-pointer'
              />
              <div className='text-muted-foreground mt-1.5 flex justify-between font-mono text-[10px]'>
                <span>2K</span>
                <span>800K</span>
              </div>
            </div>

            {/* Estimated total */}
            <div className='flex flex-col justify-center px-6 py-5'>
              <p className='text-muted-foreground text-[11px] tracking-wider uppercase'>
                {t('Estimated cost')}
              </p>
              {isLoading || !selected ? (
                <Skeleton className='mt-1.5 h-8 w-28' />
              ) : (
                <p className='mt-1 font-mono text-3xl font-bold tracking-tight'>
                  {estimate}
                </p>
              )}
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('Pay only for what you call')}
              </p>
            </div>

            {/* CTA */}
            <div className='border-border flex items-stretch border-t lg:border-t-0 lg:border-l'>
              <Button
                render={<Link to='/pricing' />}
                className='group h-auto w-full items-center justify-center gap-1.5 rounded-none px-6 text-sm font-medium lg:rounded-r-2xl'
              >
                {t('Compare all models')}
                <ArrowUpRight className='size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5' />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

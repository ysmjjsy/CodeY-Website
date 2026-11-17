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
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'

interface CounterProps {
  end: number
  suffix?: string
  /** True once the backing data has resolved; counting only runs then. */
  ready: boolean
}

/**
 * Counts up once the red route line reaches it. The line marks the span with
 * `data-reached`; with reduced motion the line is drawn in full at once, so the
 * number shows its final value straight away, which is the finished frame.
 */
function Counter(props: CounterProps) {
  const { end, suffix = '', ready } = props
  const ref = useRef<HTMLSpanElement>(null)
  const startedRef = useRef(false)

  const animate = useCallback(() => {
    const el = ref.current
    if (!el || startedRef.current || !ready) return
    startedRef.current = true
    const duration = 900
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      el.textContent = `${Math.round(eased * end)}${suffix}`
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [end, suffix, ready])

  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = `${end}${suffix}`
      return
    }

    const observer = new MutationObserver(() => {
      if (el.hasAttribute('data-reached')) {
        animate()
        observer.disconnect()
      }
    })
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['data-reached'],
    })
    if (el.hasAttribute('data-reached')) animate()
    return () => observer.disconnect()
  }, [animate, end, suffix, ready])

  return (
    <span ref={ref} data-route-mark className='tabular-nums'>
      {ready ? `0${suffix}` : '—'}
    </span>
  )
}

interface StatsProps {
  className?: string
}

interface StatItem {
  end: number
  suffix: string
  label: string
}

export function Stats(_props: StatsProps) {
  const { t } = useTranslation()
  const { models, vendors, isLoading } = usePricingData()

  // Market-angle numbers from the live pricing payload.
  const ready = !isLoading
  const providerCount = vendors.length
  const modelCount = models.length

  const stats: StatItem[] = [
    {
      end: providerCount,
      suffix: '+',
      label: t('providers in the market'),
    },
    {
      end: modelCount,
      suffix: '+',
      label: t('models listed & priced'),
    },
    {
      end: 1,
      suffix: '',
      label: t('balance to pay for them all'),
    },
    {
      end: 100,
      suffix: '%',
      label: t('of calls logged & billed'),
    },
  ]

  return (
    <div className='border-border bg-muted dark:bg-card relative border-y'>
      <div className='mx-auto max-w-6xl px-6 py-10 md:py-12'>
        <div className='grid grid-cols-2 gap-8 md:grid-cols-4'>
          {stats.map((s, index) => (
            <div
              key={s.label}
              className={
                index > 0
                  ? 'md:border-foreground/10 flex flex-col md:border-l md:pl-8'
                  : 'flex flex-col'
              }
            >
              <span className='font-mono text-3xl font-semibold tracking-tight md:text-4xl'>
                <Counter end={s.end} suffix={s.suffix} ready={ready} />
              </span>
              <span
                aria-hidden='true'
                className='bg-primary mt-3 block h-px w-10 origin-left motion-safe:animate-[gateway-route-draw_0.9s_cubic-bezier(0.16,1,0.3,1)_both]'
              />
              <span className='text-muted-foreground mt-3 text-xs'>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

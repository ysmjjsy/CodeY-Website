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
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ReceiptText,
  Wallet,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'
import { cn } from '@/lib/utils'

interface BillingPreviewProps {
  className?: string
  isAuthenticated?: boolean
}

export function BillingPreview(props: BillingPreviewProps) {
  const { t } = useTranslation()
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)

  const steps = [
    {
      icon: Wallet,
      title: t('Top up once'),
      body: t(
        'Add credit to a single balance. One wallet pays for every model you call.'
      ),
    },
    {
      icon: Zap,
      title: t('Call any model'),
      body: t(
        'Each call draws down credit by the listed token price. No per-provider accounts.'
      ),
    },
    {
      icon: ReceiptText,
      title: t('See every charge'),
      body: t(
        'Every request is logged with its model, tokens, and cost, so spend is never a guess.'
      ),
    },
  ]

  const handleCta = () => {
    if (!props.isAuthenticated) {
      openAuthDialog('sign-up')
    }
  }

  return (
    <section
      aria-label={t('Recharge and billing')}
      className={cn('relative px-6 py-16 md:py-20', props.className)}
    >
      <div className='mx-auto max-w-6xl'>
        <div className='mb-10 max-w-xl'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('Recharge & billing')}
          </p>
          <h2 className='text-[clamp(1.6rem,3vw,2.25rem)] font-bold tracking-tight'>
            {t('One balance, every model')}
          </h2>
          <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
            {t(
              'Recharge once and call across providers. Per-token pricing means you pay for usage, not subscriptions.'
            )}
          </p>
        </div>

        <div className='grid gap-4 sm:grid-cols-3'>
          {steps.map((step, i) => {
            const Icon = step.icon
            return (
              <div
                key={step.title}
                className='bg-card relative rounded-2xl border p-6'
              >
                <div className='mb-4 flex items-center justify-between'>
                  <span className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl'>
                    <Icon className='size-5' />
                  </span>
                  <span className='text-muted-foreground/60 font-mono text-sm'>
                    0{i + 1}
                  </span>
                </div>
                <h3 className='text-base font-semibold'>{step.title}</h3>
                <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
                  {step.body}
                </p>
              </div>
            )
          })}
        </div>

        <div className='mt-8 flex flex-wrap items-center gap-3'>
          {props.isAuthenticated ? (
            <Button
              render={<Link to='/wallet' />}
              className='group h-11 rounded-lg px-5 text-sm font-medium'
            >
              {t('Open your wallet')}
              <ArrowRight className='ml-1.5 size-4 transition-transform duration-150 group-hover:translate-x-0.5' />
            </Button>
          ) : (
            <Button
              onClick={handleCta}
              className='group h-11 rounded-lg px-5 text-sm font-medium'
            >
              {t('Create an account to recharge')}
              <ArrowRight className='ml-1.5 size-4 transition-transform duration-150 group-hover:translate-x-0.5' />
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

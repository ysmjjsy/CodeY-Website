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
import { useState } from 'react'

import { Package, PackageCheck, Tags, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface PublishPreviewProps {
  className?: string
}

export function PublishPreview(props: PublishPreviewProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)

  const journey = [
    {
      icon: Upload,
      key: 'connect',
      label: t('Connect'),
      title: t('Bring your model to one endpoint.'),
      body: t(
        'Register your model service and describe its interface. We check it is reachable before it ever reaches the market.'
      ),
    },
    {
      icon: Tags,
      key: 'describe',
      label: t('Describe'),
      title: t('Say what it is good at.'),
      body: t(
        'Capability tags and a plain-language description help buyers find your model for the task they actually have.'
      ),
    },
    {
      icon: Package,
      key: 'price',
      label: t('Set a price'),
      title: t('Set the price before the first call.'),
      body: t(
        'Define your billing mode and unit price. The listing shows the real cost up front, so buyers know what a call will cost.'
      ),
    },
    {
      icon: PackageCheck,
      key: 'publish',
      label: t('Publish'),
      title: t('Open it to buyers who need it.'),
      body: t(
        'Publish the listing and start receiving calls. Track usage and earnings from the same dashboard buyers see.'
      ),
    },
  ]

  const step = journey[active]

  return (
    <section
      aria-label={t('Publish your model')}
      className={cn('relative px-6 py-16 md:py-20', props.className)}
    >
      <div className='mx-auto max-w-6xl'>
        <div className='mb-10 max-w-xl'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('For providers')}
          </p>
          <h2 className='text-[clamp(1.6rem,3vw,2.25rem)] font-bold tracking-tight'>
            {t('Sell your own model here')}
          </h2>
          <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
            {t(
              'Connect a service, describe it, set a price, publish. Four steps from a running model to a paid listing.'
            )}
          </p>
        </div>

        <div className='grid gap-6 lg:grid-cols-[1fr_1.1fr]'>
          {/* Step rail */}
          <ol className='space-y-2'>
            {journey.map((item, i) => {
              const Icon = item.icon
              const isActive = i === active
              return (
                <li key={item.key}>
                  <button
                    type='button'
                    aria-pressed={isActive}
                    onClick={() => setActive(i)}
                    className={cn(
                      'flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition-colors',
                      isActive
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-foreground/40'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <Icon className='size-4.5' />
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span
                        className={cn(
                          'block text-sm font-semibold',
                          isActive ? 'text-foreground' : 'text-foreground/80'
                        )}
                      >
                        {item.label}
                      </span>
                      <span className='text-muted-foreground block truncate text-xs'>
                        {item.title}
                      </span>
                    </span>
                    <span className='text-muted-foreground/60 font-mono text-xs'>
                      0{i + 1}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          {/* Detail card — read-only listing preview */}
          <div className='bg-card flex flex-col rounded-2xl border p-6'>
            <div className='mb-5 flex items-center justify-between'>
              <span className='text-muted-foreground text-[11px] font-medium tracking-widest uppercase'>
                {t('Listing preview')}
              </span>
              <Badge variant='secondary'>{step.label}</Badge>
            </div>
            <h3 className='text-xl font-semibold tracking-tight'>
              {step.title}
            </h3>
            <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
              {step.body}
            </p>

            {/* Mock listing body */}
            <div className='border-border mt-6 rounded-xl border border-dashed p-4'>
              <div className='flex items-center gap-3'>
                <span className='bg-muted/60 flex size-10 items-center justify-center rounded-lg'>
                  <step.icon className='text-muted-foreground size-5' />
                </span>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium'>
                    {t('Your model')}
                  </p>
                  <p className='text-muted-foreground truncate text-xs'>
                    {t('Your team · provider')}
                  </p>
                </div>
              </div>
              <div className='mt-4 grid grid-cols-3 gap-3'>
                <div className='bg-muted/40 rounded-lg px-3 py-2'>
                  <p className='text-muted-foreground text-[10px] tracking-wider uppercase'>
                    {t('Status')}
                  </p>
                  <p className='mt-0.5 text-xs font-medium'>
                    {step.label}
                  </p>
                </div>
                <div className='bg-muted/40 rounded-lg px-3 py-2'>
                  <p className='text-muted-foreground text-[10px] tracking-wider uppercase'>
                    {t('Price')}
                  </p>
                  <p className='mt-0.5 text-xs font-medium'>
                    {active >= 2 ? t('Set & public') : t('Not set')}
                  </p>
                </div>
                <div className='bg-muted/40 rounded-lg px-3 py-2'>
                  <p className='text-muted-foreground text-[10px] tracking-wider uppercase'>
                    {t('Calls')}
                  </p>
                  <p className='mt-0.5 text-xs font-medium'>
                    {active === 3 ? t('Open') : '—'}
                  </p>
                </div>
              </div>
            </div>

            <p className='text-muted-foreground mt-5 text-xs'>
              {t('Model publishing is a provider feature — contact us to enable it on your account.')}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

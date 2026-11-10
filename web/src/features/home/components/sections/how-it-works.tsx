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
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'

export function HowItWorks() {
  const { t } = useTranslation()

  const steps = [
    {
      num: '01',
      title: t('Configure'),
      desc: t(
        'Add your API keys, set up channels and configure access permissions'
      ),
    },
    {
      num: '02',
      title: t('Connect'),
      desc: t(
        'Connect through OpenAI, Claude, Gemini, and other compatible API routes'
      ),
    },
    {
      num: '03',
      title: t('Monitor'),
      desc: t('Track usage, costs and performance with real-time analytics'),
    },
  ]

  return (
    <section className='border-border border-t px-6 py-24 md:py-32'>
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-16'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('How It Works')}
          </p>
          <h2 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {t('Three steps to get started')}
          </h2>
        </AnimateInView>

        <div className='relative grid gap-12 md:grid-cols-3 md:gap-8'>
          <span
            aria-hidden='true'
            className='bg-border absolute top-3 right-[16.6%] left-[16.6%] hidden h-px origin-left motion-safe:animate-[gateway-route-draw_1.2s_cubic-bezier(0.16,1,0.3,1)_both] md:block'
          />
          {steps.map((step, index) => (
            <AnimateInView
              key={step.num}
              delay={index * 200}
              animation='fade-in'
              className='relative'
            >
              <span
                data-route-mark
                className='route-step bg-background text-muted-foreground relative pr-3 font-mono text-xs'
              >
                {step.num}
              </span>
              <h3 className='mt-4 text-base font-semibold'>{step.title}</h3>
              <p className='text-muted-foreground mt-2 max-w-xs text-sm leading-relaxed'>
                {step.desc}
              </p>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}

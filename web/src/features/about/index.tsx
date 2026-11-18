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
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'

/**
 * CodeGuys, the company and the gateway. CodeY appears here only as one of
 * its products, with the full explanation living on the product page.
 */
export function About() {
  const { t } = useTranslation()
  const points = [
    {
      title: t('One protocol, many providers'),
      desc: t(
        'An application writes against a single API. CodeGuys routes that call across the providers you have configured and fails over when one of them does not answer.'
      ),
    },
    {
      title: t('Billing you can read'),
      desc: t(
        'Every settled request is recorded against a model price, a key, and a user, and quotas stop a call before it can spend past the limit you set.'
      ),
    },
    {
      title: t('Yours to run'),
      desc: t(
        "The gateway runs on your own infrastructure, with the channels, keys, and limits under your control rather than a vendor's."
      ),
    },
  ]

  return (
    <PublicLayout showMainContainer={false}>
      <article className='mx-auto max-w-3xl px-6 py-24 md:py-32'>
        <p className='text-muted-foreground text-xs font-medium tracking-widest uppercase'>
          CodeGuys
        </p>
        <h1 className='mt-3 text-3xl font-bold tracking-tight md:text-4xl'>
          {t('The unified API gateway behind the products')}
        </h1>
        <p className='text-muted-foreground mt-5 text-base leading-relaxed'>
          {t(
            'CodeGuys is a gateway for model APIs. It gives every application one place to call, one place to see what that call cost, and one place to decide which provider answered it.'
          )}
        </p>

        <dl className='mt-14 flex flex-col gap-8'>
          {points.map((point) => (
            <div key={point.title} className='border-border border-t pt-6'>
              <dt className='text-sm font-semibold'>{point.title}</dt>
              <dd className='text-muted-foreground mt-2 text-sm leading-relaxed'>
                {point.desc}
              </dd>
            </div>
          ))}
        </dl>

        <h2 className='mt-16 text-xl font-semibold tracking-tight'>
          {t('Products')}
        </h2>
        <p className='text-muted-foreground mt-3 text-sm leading-relaxed'>
          {t(
            'CodeGuys is the platform. The products built on it each do one job and share the gateway for their models.'
          )}
        </p>
        <Link
          to='/products/codey'
          className='group border-primary mt-6 flex items-start gap-4 border-l-2 py-1 pl-5'
        >
          <span className='flex flex-col gap-1'>
            <span className='flex items-center gap-2 text-sm font-semibold'>
              <span
                aria-hidden='true'
                className='bg-brand-accent size-1.5 rounded-full'
              />
              CodeY
            </span>
            <span className='text-muted-foreground text-sm'>
              {t('A local-first AI work partner')}
            </span>
          </span>
          <ArrowRight className='mt-0.5 ml-auto size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5' />
        </Link>

      </article>
    </PublicLayout>
  )
}

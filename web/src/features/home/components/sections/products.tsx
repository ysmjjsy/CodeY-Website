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

/**
 * The handoff from the platform to the product. It follows the page theme, so
 * light mode stays light; the red rule and the cyan dot are what mark CodeY.
 */
export function Products() {
  const { t } = useTranslation()

  const entries = [
    {
      title: t('Desktop workspace'),
      desc: t(
        'Start a task, watch it work, and review every command, file, and decision.'
      ),
    },
    {
      title: t('Agent Runtime'),
      desc: t(
        'The same harness, reached from TypeScript, Python, and Rust over a local protocol.'
      ),
    },
  ]

  return (
    <section className='px-6 py-24 md:py-32'>
      <div
        data-route-end
        className='border-border relative mx-auto max-w-6xl overflow-hidden rounded-2xl border px-8 py-12 md:px-12 md:py-16'
      >
        <svg
          aria-hidden='true'
          viewBox='0 0 120 120'
          className='text-foreground pointer-events-none absolute top-1/2 right-6 hidden size-64 -translate-y-1/2 opacity-[0.06] lg:block'
        >
          <polygon
            points='60,6 110,34 110,86 60,114 10,86 10,34'
            fill='none'
            stroke='currentColor'
            strokeWidth='1'
            className='product-band-hex'
          />
        </svg>

        <div className='relative max-w-2xl'>
          <p className='text-muted-foreground text-xs font-medium tracking-widest uppercase'>
            {t('Products from CodeGuys')}
          </p>

          <div className='border-primary mt-8 border-l-2 pl-6'>
            <div className='flex items-center gap-2'>
              <span
                aria-hidden='true'
                className='bg-brand-accent size-1.5 rounded-full'
              />
              <span className='text-brand-accent text-xs font-medium tracking-widest uppercase'>
                CodeY
              </span>
            </div>
            <h2 className='mt-3 text-2xl font-bold tracking-tight md:text-3xl'>
              {t('A local-first AI work partner')}
            </h2>
            <p className='text-muted-foreground mt-4 text-sm leading-relaxed'>
              {t(
                'Give CodeY a goal, files, or a project. It works within the permissions you set, keeps a record of everything it does, and reaches its models through CodeGuys.'
              )}
            </p>

            <div className='mt-8 grid gap-6 sm:grid-cols-2'>
              {entries.map((entry) => (
                <div key={entry.title}>
                  <h3 className='text-sm font-semibold'>{entry.title}</h3>
                  <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
                    {entry.desc}
                  </p>
                </div>
              ))}
            </div>

            <div className='mt-8 flex flex-wrap items-center gap-6 text-sm font-medium'>
              <Link
                to='/products/codey'
                className='group inline-flex items-center gap-1.5'
              >
                {t('Explore CodeY')}
                <ArrowRight className='size-3.5 transition-transform duration-150 group-hover:translate-x-0.5' />
              </Link>
              <Link
                to='/docs/$section'
                params={{ section: 'codey' }}
                className='text-muted-foreground hover:text-foreground transition-colors duration-150'
              >
                {t('Read the CodeY docs')}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

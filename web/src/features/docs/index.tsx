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
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { cn } from '@/lib/utils'

import { DOC_GROUPS, DOC_SECTIONS, type DocSection } from './sections'

function DocsSidebar(props: { current?: string }) {
  const { t } = useTranslation()

  return (
    <nav aria-label={t('Docs')} className='flex flex-col gap-8'>
      {DOC_GROUPS.map((group) => (
        <div key={group.id}>
          <p className='text-muted-foreground text-xs font-medium tracking-widest uppercase'>
            {group.title}
          </p>
          <ul className='mt-3 flex flex-col'>
            {DOC_SECTIONS.filter((section) => section.group === group.id).map(
              (section) => (
                <li key={section.slug}>
                  <Link
                    to='/docs/$section'
                    params={{ section: section.slug }}
                    className={cn(
                      'block border-l-2 py-1.5 pl-3 text-sm transition-colors duration-150',
                      props.current === section.slug
                        ? 'border-primary text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground border-transparent'
                    )}
                  >
                    {t(section.title)}
                  </Link>
                </li>
              )
            )}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function DocsFrame(props: { current?: string; children: React.ReactNode }) {
  return (
    <PublicLayout showMainContainer={false}>
      <div className='mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 md:grid-cols-[16rem_1fr] md:py-20'>
        <aside className='md:sticky md:top-24 md:self-start'>
          <DocsSidebar current={props.current} />
        </aside>
        <div className='min-w-0'>{props.children}</div>
      </div>
    </PublicLayout>
  )
}

export function DocsHome() {
  const { t } = useTranslation()

  return (
    <DocsFrame>
      <h1 className='text-3xl font-bold tracking-tight'>{t('Docs')}</h1>
      <p className='text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed'>
        {t(
          'Documentation for the CodeGuys gateway, and for CodeY, one of the products built on it.'
        )}
      </p>
      <div className='mt-12 flex flex-col gap-12'>
        {DOC_GROUPS.map((group) => (
          <section key={group.id}>
            <h2 className='text-lg font-semibold'>{group.title}</h2>
            <p className='text-muted-foreground mt-1 text-sm'>
              {t(group.description)}
            </p>
            <ul className='border-border mt-4 divide-y border-y'>
              {DOC_SECTIONS.filter((section) => section.group === group.id).map(
                (section) => (
                  <li key={section.slug}>
                    <Link
                      to='/docs/$section'
                      params={{ section: section.slug }}
                      className='group flex flex-col gap-1 py-4'
                    >
                      <span className='group-hover:text-primary text-sm font-medium transition-colors duration-150'>
                        {t(section.title)}
                      </span>
                      <span className='text-muted-foreground text-sm'>
                        {t(section.summary)}
                      </span>
                    </Link>
                  </li>
                )
              )}
            </ul>
          </section>
        ))}
      </div>
    </DocsFrame>
  )
}

export function DocsSection(props: { slug: string }) {
  const { t } = useTranslation()
  const section = DOC_SECTIONS.find((item) => item.slug === props.slug) as
    | DocSection
    | undefined

  if (!section) return null

  return (
    <DocsFrame current={section.slug}>
      <p className='text-muted-foreground text-xs font-medium tracking-widest uppercase'>
        {section.group === 'codey' ? 'CodeY' : 'CodeGuys'}
      </p>
      <h1 className='mt-3 text-3xl font-bold tracking-tight'>
        {t(section.title)}
      </h1>
      <div className='mt-8 flex max-w-2xl flex-col gap-5'>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph} className='text-sm leading-relaxed'>
            {t(paragraph)}
          </p>
        ))}
      </div>
    </DocsFrame>
  )
}

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
 * CodeY, as one product of CodeGuys. The page explains the product and points
 * back at the gateway for anything about models and billing, rather than
 * restating it.
 */
export function CodeyProduct() {
  const { t } = useTranslation()

  const capabilities = [
    {
      title: t('Work that survives a restart'),
      desc: t(
        'Every task is written down as it happens, so closing the window or restarting the machine picks up where it stopped.'
      ),
    },
    {
      title: t('One timeline for the whole task'),
      desc: t(
        'The plan, the commands it ran, the files it changed, and the permissions it asked for all sit on a single timeline.'
      ),
    },
    {
      title: t('Permissions you set, and a sandbox'),
      desc: t(
        'Choose how much CodeY may do on its own. A sandbox, a workspace boundary, and a network policy hold it to that choice.'
      ),
    },
    {
      title: t('Tools, skills, and plugins'),
      desc: t(
        'Extend it with MCP servers, skills, plugins, browser automation, and computer control where the platform allows it.'
      ),
    },
    {
      title: t('Agents that work together'),
      desc: t(
        'Hand part of a task to another agent, run a team, or leave a workflow running in the background.'
      ),
    },
    {
      title: t('The same runtime, three languages'),
      desc: t(
        'TypeScript, Python, and Rust applications talk to the same local runtime the desktop app uses.'
      ),
    },
  ]

  return (
    <PublicLayout showMainContainer={false}>
      <article className='mx-auto max-w-3xl px-6 py-24 md:py-32'>
        <p className='text-muted-foreground text-xs font-medium tracking-widest uppercase'>
          {t('A CodeGuys product')}
        </p>
        <div className='mt-4 flex items-center gap-2'>
          <span
            aria-hidden='true'
            className='bg-brand-accent size-1.5 rounded-full'
          />
          <span className='text-brand-accent text-xs font-medium tracking-widest uppercase'>
            CodeY
          </span>
        </div>
        <h1 className='mt-3 text-3xl font-bold tracking-tight md:text-4xl'>
          {t('A local-first AI work partner')}
        </h1>
        <p className='text-muted-foreground mt-5 text-base leading-relaxed'>
          {t(
            'Give CodeY a goal, some files, or a project. It works on your machine, inside the permissions you set, and it shows its work instead of hiding it. The models it calls come through CodeGuys.'
          )}
        </p>

        <h2 className='mt-16 text-xl font-semibold tracking-tight'>
          {t('Two ways in')}
        </h2>
        <div className='border-border mt-6 divide-y border-y'>
          <div className='py-5'>
            <h3 className='text-sm font-semibold'>{t('Desktop workspace')}</h3>
            <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
              {t(
                'Open a project, describe the outcome, and follow the task as it runs. The desktop app sends the work to a local daemon; it never does the work itself.'
              )}
            </p>
          </div>
          <div className='py-5'>
            <h3 className='text-sm font-semibold'>{t('Agent Runtime')}</h3>
            <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
              {t(
                'Build your own application against the same daemon. The runtime speaks one local protocol, with clients for TypeScript, Python, and Rust.'
              )}
            </p>
          </div>
        </div>

        <h2 className='mt-16 text-xl font-semibold tracking-tight'>
          {t('What it does')}
        </h2>
        <dl className='mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2'>
          {capabilities.map((item) => (
            <div key={item.title}>
              <dt className='text-sm font-semibold'>{item.title}</dt>
              <dd className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
                {item.desc}
              </dd>
            </div>
          ))}
        </dl>

        <h2 className='mt-16 text-xl font-semibold tracking-tight'>
          {t('Where the models come from')}
        </h2>
        <p className='text-muted-foreground mt-4 text-sm leading-relaxed'>
          {t(
            'CodeY does not carry its own model accounts. It calls models through CodeGuys, so the billing, quotas, and provider routing you already configured for the gateway are the ones CodeY uses.'
          )}
        </p>
        <div className='mt-5 flex flex-wrap gap-6 text-sm font-medium'>
          <Link
            to='/pricing'
            className='group inline-flex items-center gap-1.5'
          >
            {t('Browse the model square')}
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
      </article>
    </PublicLayout>
  )
}

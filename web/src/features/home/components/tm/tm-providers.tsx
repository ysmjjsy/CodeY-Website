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

import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const STEPS = [
  {
    key: 'connect',
    nameKey: 'Connect model',
    captionKey: 'Link an existing model service',
    labelKey: 'Start from existing capability',
    titleKey: 'Bring your model to one call entry.',
    descKey:
      'Connect your model service and fill in the interface and capability info. We check availability before publishing so users can reliably find and call it.',
    stateKey: 'Onboarding config',
    tagsKey: 'To be filled',
    priceKey: 'To be configured',
    statusKey: 'Not yet published',
  },
  {
    key: 'describe',
    nameKey: 'Describe capability',
    captionKey: 'Tell users when to choose it',
    labelKey: 'Make choosing easy',
    titleKey: 'Say clearly what the model is for.',
    descKey:
      'Use concrete scenarios and capability tags to help users decide. Tell them what problem the model solves rather than stacking technical terms.',
    stateKey: 'Capability intro',
    tagsKey: 'Docs · Reasoning',
    priceKey: 'To be configured',
    statusKey: 'Not yet published',
  },
  {
    key: 'price',
    nameKey: 'Set pricing',
    captionKey: 'Define price and unit',
    labelKey: 'Price before call',
    titleKey: 'Make every call’s cost clear.',
    descKey:
      'Set the price and metering unit, shown clearly on the model page. Actual billing rules follow the platform’s capabilities.',
    stateKey: 'Billing config',
    tagsKey: 'Docs · Reasoning',
    priceKey: 'Set by rule',
    statusKey: 'Awaiting review',
  },
  {
    key: 'publish',
    nameKey: 'Open for calls',
    captionKey: 'Publish to market users',
    labelKey: 'From capability to service',
    titleKey: 'Publish to the users who need it.',
    descKey:
      'Confirm the interface, intro, and price, then open the model to market users. Track calls and usage records and keep improving it.',
    stateKey: 'Open for calls',
    tagsKey: 'Docs · Reasoning',
    priceKey: 'Price published',
    statusKey: 'Open for calls',
  },
]

interface TmProvidersProps {
  onOpenPublish?: () => void
}

export function TmProviders(props: TmProvidersProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  const step = STEPS[active]

  return (
    <section
      className='tm-providers tm-shell tm-space'
      id='providers'
      aria-labelledby='tm-providers-title'
    >
      <div className='tm-heading tm-split-heading'>
        <div>
          <p className='tm-label'>{t('Model providers')}</p>
          <h2 id='tm-providers-title'>
            {t('Bring your model')}
            <br />
            {t('into the market.')}
          </h2>
        </div>
        <div>
          <p>
            {t(
              'Connect a model, complete its intro and call pricing, and publish it to CodeGuys users. Turn a model into a service that can be bought and called.'
            )}
          </p>
          <button
            type='button'
            className='tm-inline-link'
            onClick={() => props.onOpenPublish?.()}
          >
            {t('Learn the publish flow')}
            <ArrowRight aria-hidden='true' />
          </button>
        </div>
      </div>

      <div className='tm-provider-journey'>
        {STEPS.map((s, i) => {
          const isActive = i === active
          return (
            <button
              key={s.key}
              type='button'
              aria-pressed={isActive}
              onClick={() => setActive(i)}
              className={
                isActive ? 'tm-journey-step tm-is-active' : 'tm-journey-step'
              }
            >
              <span className='tm-step-marker' />
              <span className='tm-step-name'>{t(s.nameKey)}</span>
              <span className='tm-step-caption'>{t(s.captionKey)}</span>
            </button>
          )
        })}
      </div>

      <div className='tm-provider-detail'>
        <div className='tm-provider-story'>
          <p className='tm-label'>{t(step.labelKey)}</p>
          <h3>{t(step.titleKey)}</h3>
          <p>{t(step.descKey)}</p>
          <Button size='lg' onClick={() => props.onOpenPublish?.()}>
            {t('Publish model')}
            <ArrowRight aria-hidden='true' />
          </Button>
        </div>
        <div className='tm-listing-preview'>
          <div className='tm-listing-top'>
            <Badge variant='secondary'>{t('Model page preview')}</Badge>
            <span className='tm-listing-state'>{t(step.stateKey)}</span>
          </div>
          <div className='tm-listing-model'>
            <span className='tm-model-monogram'>Y/</span>
            <div>
              <h3>{t('Your model')}</h3>
              <p>{t('Your team · model provider')}</p>
            </div>
          </div>
          <p className='tm-listing-description'>
            {active === 0
              ? t('Use one clear sentence to say what your model solves best.')
              : t('A model service for long-document understanding and professional Q&A.')}
          </p>
          <div className='tm-listing-data'>
            <div>
              <span>{t('Capability tags')}</span>
              <strong>{t(step.tagsKey)}</strong>
            </div>
            <div>
              <span>{t('Call price')}</span>
              <strong>{t(step.priceKey)}</strong>
            </div>
            <div>
              <span>{t('Open status')}</span>
              <strong>{t(step.statusKey)}</strong>
            </div>
          </div>
        </div>
      </div>
      <p className='tm-provider-note'>
        {t(
          'Publishing permission, pricing rules, revenue share, and settlement follow the official provider agreement.'
        )}
      </p>
    </section>
  )
}

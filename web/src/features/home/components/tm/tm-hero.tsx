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
import { ArrowRight, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'
import { cn } from '@/lib/utils'

import { TmExchangeScene } from './tm-exchange-scene'

interface TmHeroStat {
  /** Big figure, e.g. "12" or "¥0.32/1M". */
  value: string
  /** Caption under the figure, e.g. "Models live". */
  label: string
}

interface TmHeroProps {
  className?: string
  isAuthenticated?: boolean
  /** Active signal-route index (0-2), driven by the quote board. */
  activeRoute?: number
  /** Model readout under the scene, e.g. "CLAUDE / CONNECTED". */
  sceneModel?: string
  /** Estimate readout under the scene, e.g. "20K → 4K". */
  sceneTokens?: string
  /** Live figures rendered as a full-width strip above the footnote. */
  stats?: TmHeroStat[]
  /** Opens the top-up flow; guests get the demo modal, matching the prototype. */
  onOpenTopup?: () => void
}

export function TmHero(props: TmHeroProps) {
  const { t } = useTranslation()
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)

  const handleTopUp = () => {
    if (props.onOpenTopup) {
      props.onOpenTopup()
      return
    }
    if (!props.isAuthenticated) {
      openAuthDialog('sign-up')
    }
  }

  return (
    <section className={cn('tm-hero tm-shell', props.className)}>
      <div className='tm-hero-copy'>
        <p className='tm-label'>
          <span className='tm-live-dot' />
          {t('Model call market')}
        </p>
        <h1>
          {t('AI capability,')}
          <br />
          <span className='tm-h1-accent'>{t('called on demand.')}</span>
        </h1>
        <p className='tm-hero-description'>
          {t(
            'Discover models from different providers. Top up for call credit, then use them at the listed price and metering. Every call — its usage, cost, and balance change — is recorded.'
          )}
        </p>
        <div className='tm-hero-actions'>
          <Button size='lg' render={<Link to='/pricing' />}>
            {t('Enter the model market')}
            <ArrowRight aria-hidden='true' />
          </Button>
          {props.isAuthenticated ? (
            <Button variant='outline' size='lg' render={<Link to='/wallet' />}>
              <Wallet aria-hidden='true' />
              {t('Top up credit')}
            </Button>
          ) : (
            <Button variant='outline' size='lg' onClick={handleTopUp}>
              <Wallet aria-hidden='true' />
              {t('Top up credit')}
            </Button>
          )}
        </div>
        <p className='tm-publisher-invitation'>
          {t('Have a model to offer?')}
          <a href='#providers'>
            {t('Publish to CodeGuys')}
            <ArrowRight aria-hidden='true' />
          </a>
        </p>
      </div>

      <div className='tm-quote-stage' aria-label={t('Token exchange demo')}>
        <div className='tm-stage-topline'>
          <span>{t('TOKEN EXCHANGE')} / 001</span>
          <Badge variant='secondary'>{t('Interactive demo')}</Badge>
        </div>
        <TmExchangeScene
          activeRoute={props.activeRoute}
          sceneModel={props.sceneModel}
          sceneTokens={props.sceneTokens}
          receiptLabel={t('CALL RECEIPT / Call receipt')}
          receiptBody={t('Request complete, cost entered into usage record')}
          receiptStatus={t('DEMO · RECORDED')}
        />
      </div>

      {props.stats && props.stats.length > 0 && (
        <dl className='tm-hero-stats'>
          {props.stats.map((stat) => (
            <div className='tm-hero-stat' key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className='tm-hero-footnote'>
        <span>{t('Pay as you go')}</span>
        <span>{t('Transparent pricing')}</span>
        <span>{t('Every call recorded')}</span>
      </div>
    </section>
  )
}

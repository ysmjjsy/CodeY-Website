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
import { Check, Plus, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'

interface TmBillingProps {
  /** Demo wallet balance; updated when the top-up demo completes. */
  balance?: number
  /** Opens the interactive top-up demo for any visitor, like the prototype. */
  onOpenTopup?: () => void
}

export function TmBilling(props: TmBillingProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const balance = (props.balance ?? 200).toLocaleString(locale, {
    minimumFractionDigits: 2,
  })

  return (
    <section
      id='billing-section'
      className='tm-billing tm-space'
      aria-labelledby='tm-billing-title'
    >
      <div className='tm-shell'>
        <div className='tm-heading tm-split-heading'>
          <div>
            <p className='tm-label'>{t('Credit & billing')}</p>
            <h2 id='tm-billing-title'>
              {t('Top up once,')}
              <br />
              {t('use by the amount.')}
            </h2>
          </div>
          <p>
            {t(
              'Different models bill by token, request count, or other units. Exact price and metering follow each model’s detail page.'
            )}
          </p>
        </div>

        <div className='tm-wallet-demo'>
          <div className='tm-wallet-balance'>
            <div className='tm-wallet-title'>
              <Wallet aria-hidden='true' />
              <span>{t('Account credit')}</span>
              <Badge variant='secondary' className='ml-auto'>
                {t('Demo account')}
              </Badge>
            </div>
            <strong>¥ {balance}</strong>
            <p>
              {t(
                'Topping up doesn’t buy a fixed number of tokens — usable amount varies with the model and billing rule you choose.'
              )}
            </p>
            <Button size='lg' onClick={props.onOpenTopup}>
              {t('Top up credit')}
              <Plus aria-hidden='true' />
            </Button>
          </div>

          <div className='tm-usage-ledger'>
            <div className='tm-ledger-heading'>
              <h3>{t('Call receipt')}</h3>
              <span>{t('Example record')}</span>
            </div>
            <dl>
              <div>
                <dt>{t('Model called')}</dt>
                <dd>Claude Sonnet 4.5</dd>
              </div>
              <div>
                <dt>{t('Input usage')}</dt>
                <dd>{(20000).toLocaleString(locale)} Token</dd>
              </div>
              <div>
                <dt>{t('Output usage')}</dt>
                <dd>{(4000).toLocaleString(locale)} Token</dd>
              </div>
              <div className='tm-ledger-total'>
                <dt>{t('This call cost')}</dt>
                <dd>¥ 0.864</dd>
              </div>
            </dl>
            <div className='tm-ledger-footer'>
              <span className='tm-receipt-check'>
                <Check aria-hidden='true' />
              </span>
              {t('Billing follows the model detail and actual returned usage')}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

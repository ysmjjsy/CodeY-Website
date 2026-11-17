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

import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatPrice, formatRequestPrice } from '@/features/pricing/lib/price'
import { DEFAULT_TOKEN_UNIT, QUOTA_TYPE_VALUES } from '@/features/pricing/constants'
import type { PricingModel } from '@/features/pricing/types'

export type TmModalId = 'topup' | 'publish' | 'model'

/* ---------- Top-up ---------- */

const AMOUNTS = [50, 100, 200, 500]

interface TmTopupModalProps {
  open: boolean
  onClose: () => void
  balance: number
  onConfirm: (amount: number) => void
}

export function TmTopupModal(props: TmTopupModalProps) {
  const { t, i18n } = useTranslation()
  const [amount, setAmount] = useState(100)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const money = (v: number) =>
    `¥ ${v.toLocaleString(locale, { minimumFractionDigits: 2 })}`

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Top up call credit')}
      description={t('Credit & billing')}
      contentClassName='sm:max-w-md'
      footer={
        <Button
          className='w-full'
          onClick={() => props.onConfirm(amount)}
        >
          {t('Confirm demo top-up')}
        </Button>
      }
    >
      <Alert className='mb-5'>{t('This is an interactive demo — no real payment is made.')}</Alert>
      <div className='tm-topup-balance'>
        <span>{t('Current demo balance')}</span>
        <strong>{money(props.balance)}</strong>
      </div>
      <fieldset className='tm-amount-options'>
        <legend>{t('Choose a top-up amount')}</legend>
        <ToggleGroup
          value={[String(amount)]}
          onValueChange={(values) => {
            const next = values[0]
            if (next) setAmount(Number(next))
          }}
          variant='outline'
          spacing={8}
          className='w-full grid grid-cols-4'
        >
          {AMOUNTS.map((a) => (
            <ToggleGroupItem key={a} value={String(a)}>
              ¥ {a}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </fieldset>
      <div className='tm-conversion-note'>
        <span>{t('You will receive')}</span>
        <strong>{money(amount)} {t('call credit')}</strong>
        <p>
          {t(
            'Different models consume credit at different rates — check each model’s price and metering unit before calling.'
          )}
        </p>
      </div>
      <p className='tm-modal-footnote'>
        {t(
          'Actual payment channels, discounts, validity, and refund rules follow the official product.'
        )}
      </p>
    </Dialog>
  )
}

/* ---------- Publish ---------- */

interface TmPublishModalProps {
  open: boolean
  onClose: () => void
}

export function TmPublishModal(props: TmPublishModalProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Get your model seen')}
      description={t('Model providers')}
      contentClassName='sm:max-w-md'
      footer={
        <Button className='w-full' onClick={props.onClose}>
          {t('Got it')}
        </Button>
      }
    >
      <ol className='tm-publish-steps'>
        <li>
          <span>1</span>
          <div>
            <h3>{t('Connect the model service')}</h3>
            <p>{t('Fill in the model interface and basic info; check availability.')}</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <h3>{t('Complete intro & billing')}</h3>
            <p>{t('Describe scenarios, capability tags, price, and metering unit.')}</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <h3>{t('Review and open calls')}</h3>
            <p>{t('Confirm the model page info and publish per platform rules.')}</p>
          </div>
        </li>
      </ol>
      <Alert className='mt-5'>
        {t(
          'Self-serve publishing, review flow, revenue share, and settlement rules follow the official product capability.'
        )}
      </Alert>
    </Dialog>
  )
}

/* ---------- Model detail ---------- */

interface TmModelModalProps {
  open: boolean
  onClose: () => void
  model: PricingModel | null
  priceRate: number
  usdExchangeRate: number
  onTopup: () => void
}

export function TmModelModal(props: TmModelModalProps) {
  const { t } = useTranslation()
  const m = props.model

  function priceFor(type: 'input' | 'output'): string {
    if (!m) return '—'
    if (m.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
      return type === 'input'
        ? formatRequestPrice(m, false, props.priceRate, props.usdExchangeRate)
        : '—'
    }
    return formatPrice(
      m,
      type,
      DEFAULT_TOKEN_UNIT,
      false,
      props.priceRate,
      props.usdExchangeRate
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={m?.model_name ?? t('Model detail')}
      description={t('Model quote')}
      contentClassName='sm:max-w-md'
      footer={
        <Button
          className='w-full'
          onClick={() => {
            props.onClose()
            props.onTopup()
          }}
        >
          {t('Top up then call')}
        </Button>
      }
    >
      <p className='tm-detail-description'>
        {m?.description ||
          t('A model listed in the CodeGuys market. Call price and capability follow its detail page.')}
      </p>
      <div className='tm-detail-price-grid'>
        <div>
          <span>{t('Input / 1M Token')}</span>
          <strong>{priceFor('input')}</strong>
        </div>
        <div>
          <span>{t('Output / 1M Token')}</span>
          <strong>{priceFor('output')}</strong>
        </div>
      </div>
      <Alert className='mt-5'>
        {t(
          'Live quote from the market. Actual capability, billing, and availability follow the model detail page.'
        )}
      </Alert>
    </Dialog>
  )
}

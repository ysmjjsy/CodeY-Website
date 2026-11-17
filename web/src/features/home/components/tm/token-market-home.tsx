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
import { toast } from 'sonner'

import { toIntlLocale } from '@/i18n/languages'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import {
  DEFAULT_TOKEN_UNIT,
  QUOTA_TYPE_VALUES,
} from '@/features/pricing/constants'
import { formatPrice } from '@/features/pricing/lib/price'
import type { PricingModel } from '@/features/pricing/types'

import {
  TmBilling,
  TmClosing,
  TmDeveloper,
  TmHero,
  TmMarket,
  TmModelModal,
  TmProviders,
  TmPublishModal,
  TmTopupModal,
} from './index'

interface TokenMarketHomeProps {
  isAuthenticated?: boolean
}

export function TokenMarketHome(props: TokenMarketHomeProps) {
  const { t, i18n } = useTranslation()
  const { models, priceRate, usdExchangeRate } = usePricingData()

  const [topupOpen, setTopupOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [detailModel, setDetailModel] = useState<PricingModel | null>(null)
  const [balance, setBalance] = useState(200)

  // Hero exchange-scene readout: first quotable model, default 20K preset.
  const featured = models.find(
    (m) =>
      m.quota_type !== QUOTA_TYPE_VALUES.REQUEST &&
      Number.isFinite(m.model_ratio)
  )
  const sceneModel = featured
    ? `${featured.model_name.toUpperCase()} / ${t('CONNECTED')}`
    : `MODEL / ${t('CONNECTED')}`
  const sceneTokens = '20K → 4K'

  // Live figures for the hero stat strip; cheapest model gets the
  // "From" price so the strip doubles as a value proposition.
  const quotable = models.filter(
    (m) =>
      m.quota_type !== QUOTA_TYPE_VALUES.REQUEST &&
      Number.isFinite(m.model_ratio)
  )
  const cheapest = quotable.reduce<PricingModel | undefined>(
    (best, m) => (best && best.model_ratio <= m.model_ratio ? best : m),
    undefined
  )
  const heroStats = [
    {
      value: models.length > 0 ? String(models.length) : '—',
      label: t('Models live'),
    },
    {
      value: cheapest
        ? formatPrice(
            cheapest,
            'input',
            DEFAULT_TOKEN_UNIT,
            false,
            priceRate ?? 1,
            usdExchangeRate
          )
        : '—',
      label: t('From / input'),
    },
    {
      value: t('Pay as you go'),
      label: t('No subscription'),
    },
    {
      value: t('Full ledger'),
      label: t('Every call recorded'),
    },
  ]
  // Keep these stat keys stable — the same English strings appear in the
  // hero-strip and the market caption, so both translate together.

  const openTopup = () => {
    // The prototype's top-up demo is open to every visitor.
    setTopupOpen(true)
  }

  const confirmTopup = (amount: number) => {
    setBalance((b) => b + amount)
    setTopupOpen(false)
    toast.success(
      t('Demo top-up complete: balance +¥{{amount}} — no real payment made', {
        amount: amount.toLocaleString(
          toIntlLocale(i18n.resolvedLanguage || i18n.language)
        ),
      })
    )
  }

  return (
    <div className='tm'>
      <TmHero
        isAuthenticated={props.isAuthenticated}
        activeRoute={0}
        sceneModel={sceneModel}
        sceneTokens={sceneTokens}
        stats={heroStats}
        onOpenTopup={openTopup}
      />
      <TmMarket onOpenDetails={setDetailModel} />
      <TmBilling balance={balance} onOpenTopup={openTopup} />
      <TmProviders onOpenPublish={() => setPublishOpen(true)} />
      <TmDeveloper />
      <TmClosing onOpenPublish={() => setPublishOpen(true)} />

      <TmTopupModal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        balance={balance}
        onConfirm={confirmTopup}
      />
      <TmPublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
      />
      <TmModelModal
        open={detailModel !== null}
        onClose={() => setDetailModel(null)}
        model={detailModel}
        priceRate={priceRate ?? 1}
        usdExchangeRate={usdExchangeRate}
        onTopup={openTopup}
      />
    </div>
  )
}

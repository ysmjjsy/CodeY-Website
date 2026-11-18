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
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'

import type { PackageEditorValues } from '../lib'

export function PackageOfferPreview(props: { values: PackageEditorValues }) {
  const { t } = useTranslation()
  const validTiers = props.values.tiers
    .map((tier) => ({
      skuKey: tier.skuKey,
      title: tier.title.trim(),
      price: Number(tier.price),
      credit: Number(tier.credit),
      validDays: Number(tier.validDays),
    }))
    .filter(
      (tier) =>
        tier.title &&
        Number.isFinite(tier.price) &&
        tier.price > 0 &&
        Number.isFinite(tier.credit) &&
        tier.credit > 0
    )
  const prices = validTiers.map((tier) => parseQuotaFromDollars(tier.price))
  const credits = validTiers.map((tier) => parseQuotaFromDollars(tier.credit))
  const modelNames = props.values.models.map((row) => row.model).filter(Boolean)

  return (
    <Card className='gap-0 overflow-hidden py-0'>
      <CardHeader className='border-b p-4'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <p className='text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium'>
              <Sparkles className='size-3.5' aria-hidden='true' />
              {t('Buyer preview')}
            </p>
            <CardTitle className='line-clamp-2 text-lg'>
              {props.values.title.trim() || t('Package title')}
            </CardTitle>
            <CardDescription className='mt-1 line-clamp-2'>
              {props.values.subtitle.trim() || t('Your package')}
            </CardDescription>
          </div>
          <Badge variant='info'>{t('Preview')}</Badge>
        </div>
      </CardHeader>
      <CardContent className='space-y-4 p-4'>
        <div className='grid grid-cols-2 gap-3'>
          <div>
            <p className='text-muted-foreground text-xs'>{t('From')}</p>
            <p className='mt-1 font-semibold'>
              {prices.length > 0
                ? formatQuota(Math.min(...prices))
                : t('Set a price')}
            </p>
          </div>
          <div>
            <p className='text-muted-foreground text-xs'>
              {t('Included credit')}
            </p>
            <p className='mt-1 font-semibold'>
              {credits.length > 0
                ? formatQuota(Math.max(...credits))
                : t('Set a credit amount')}
            </p>
          </div>
        </div>

        <div className='space-y-2'>
          <p className='text-xs font-medium'>{t('Models')}</p>
          {modelNames.length > 0 ? (
            <div className='flex flex-wrap gap-1.5'>
              {modelNames.slice(0, 4).map((model) => (
                <Badge key={model} variant='outline' className='font-normal'>
                  {model}
                </Badge>
              ))}
              {modelNames.length > 4 && (
                <Badge variant='secondary'>+{modelNames.length - 4}</Badge>
              )}
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('Choose the models buyers can use.')}
            </p>
          )}
        </div>

        <div className='space-y-2 border-t pt-3'>
          <p className='text-xs font-medium'>{t('Package tiers')}</p>
          {validTiers.length > 0 ? (
            <div className='space-y-2'>
              {validTiers.slice(0, 3).map((tier) => (
                <div
                  key={tier.skuKey}
                  className='bg-muted/50 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs'
                >
                  <span className='min-w-0 truncate font-medium'>
                    {tier.title}
                  </span>
                  <span className='text-muted-foreground shrink-0 text-right'>
                    {formatQuota(parseQuotaFromDollars(tier.price))} ·{' '}
                    {t('{{count}} days', { count: tier.validDays })}
                  </span>
                </div>
              ))}
              {validTiers.length > 3 && (
                <p className='text-muted-foreground text-xs'>
                  {t('+{{count}} more', {
                    count: validTiers.length - 3,
                  })}
                </p>
              )}
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('Add a tier buyers can choose.')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

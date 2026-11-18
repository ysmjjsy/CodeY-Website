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
import { CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerHeaderClassName,
  sideDrawerSectionClassName,
} from '@/components/drawer-layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import {
  packageStatusLabels,
  versionStatusLabels,
} from '../../token-package/status-labels'
import type {
  PackageTestReport,
  PackageVersion,
  TokenPackage,
} from '../../token-package/types'
import { packageOffer, versionStatusVariant } from '../lib'

function VersionSummary(props: { version: PackageVersion; label: string }) {
  const { t } = useTranslation()
  const offer = packageOffer(props.version)
  return (
    <div className='bg-card rounded-xl border p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <p className='text-sm font-medium'>{props.label}</p>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Version {{version}}', { version: props.version.version_no })}
          </p>
        </div>
        <Badge variant={versionStatusVariant(props.version.status)}>
          {t(versionStatusLabels[props.version.status] || props.version.status)}
        </Badge>
      </div>
      <div className='mt-4 grid grid-cols-2 gap-3 text-sm'>
        <div>
          <p className='text-muted-foreground text-xs'>{t('From')}</p>
          <p className='mt-1 font-medium'>{formatQuota(offer.minPrice)}</p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>
            {t('Included credit')}
          </p>
          <p className='mt-1 font-medium'>{formatQuota(offer.maxCredit)}</p>
        </div>
      </div>
      <div className='mt-3 flex flex-wrap gap-1.5'>
        {(props.version.models || []).map((spec) => (
          <Badge key={spec.model} variant='outline' className='font-normal'>
            {spec.model} × {spec.multiplier}
          </Badge>
        ))}
      </div>
      <div className='mt-3 space-y-1.5 border-t pt-3 text-xs'>
        {(props.version.skus || []).map((sku) => (
          <div key={sku.sku_key} className='flex justify-between gap-3'>
            <span className='truncate'>{sku.title}</span>
            <span className='text-muted-foreground shrink-0'>
              {formatQuota(sku.price_quota)} · {formatQuota(sku.credit_quota)} ·{' '}
              {t('{{count}} days', { count: sku.valid_days })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TestReport(props: { report: PackageTestReport }) {
  const { t } = useTranslation()
  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm font-medium'>{t('Test results')}</p>
        <Badge variant={props.report.passed ? 'success' : 'destructive'}>
          {props.report.passed ? t('Passed') : t('Failed')}
        </Badge>
      </div>
      {props.report.checked_at > 0 && (
        <p className='text-muted-foreground text-xs'>
          {t('Checked')}: {formatTimestampToDate(props.report.checked_at)}
        </p>
      )}
      {(props.report.fail_reasons || []).length > 0 && (
        <Alert variant='destructive'>
          <XCircle />
          <AlertTitle>{t('Connection check failed')}</AlertTitle>
          <AlertDescription>
            <ul className='list-disc space-y-1 pl-4'>
              {(props.report.fail_reasons || []).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {(props.report.results || []).length > 0 && (
        <div className='space-y-2'>
          {(props.report.results || []).map((result) => (
            <div
              key={`${result.channel_id}-${result.model}`}
              className='bg-card flex items-start gap-2 rounded-lg border p-2.5 text-xs'
            >
              {result.success ? (
                <CheckCircle2 className='text-success mt-0.5 size-3.5 shrink-0' />
              ) : (
                <XCircle className='text-destructive mt-0.5 size-3.5 shrink-0' />
              )}
              <div className='min-w-0 flex-1'>
                <p className='truncate font-medium'>
                  {result.channel_name || `#${result.channel_id}`} ·{' '}
                  {result.model}
                </p>
                <p className='text-muted-foreground mt-1'>
                  {result.error ||
                    (result.model_mismatch
                      ? t('Returned a different model')
                      : t('Latency: {{ms}} ms', {
                          ms: result.latency_ms,
                        }))}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PackageDetailsDrawer(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  packageData: TokenPackage | null
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const latest = props.packageData?.latest_version
  const active = props.packageData?.active_version
  const showLatest = latest && latest.id !== active?.id
  const report = latest?.test_report || active?.test_report || null

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        className={sideDrawerContentClassName('sm:!max-w-xl')}
        showCloseButton
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle className='pr-8 break-words'>
            {props.packageData?.title || t('Package details')}
          </SheetTitle>
          <SheetDescription>
            {props.packageData?.subtitle ||
              t('Review the current offer and the latest version.')}
          </SheetDescription>
          {props.packageData && (
            <div className='mt-2 flex flex-wrap gap-1.5'>
              <Badge variant='outline'>
                {t(
                  packageStatusLabels[props.packageData.status] ||
                    props.packageData.status
                )}
              </Badge>
              {showLatest && (
                <Badge variant={versionStatusVariant(latest.status)}>
                  {t('Latest version')}:{' '}
                  {t(versionStatusLabels[latest.status] || latest.status)}
                </Badge>
              )}
            </div>
          )}
        </SheetHeader>

        <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6'>
          {props.packageData?.description && (
            <p className='text-muted-foreground text-sm leading-6'>
              {props.packageData.description}
            </p>
          )}

          {active && (
            <section className={sideDrawerSectionClassName()}>
              <VersionSummary version={active} label={t('Current version')} />
            </section>
          )}

          {showLatest && (
            <section className={sideDrawerSectionClassName()}>
              <VersionSummary version={latest} label={t('Latest version')} />
              {latest.review_note && (
                <Alert variant='warning'>
                  <AlertTitle>{t('Review note')}</AlertTitle>
                  <AlertDescription>{latest.review_note}</AlertDescription>
                </Alert>
              )}
            </section>
          )}

          {report && (
            <section className={sideDrawerSectionClassName()}>
              <TestReport report={report} />
            </section>
          )}

          {!active && !latest && (
            <div className='text-muted-foreground rounded-xl border border-dashed p-5 text-center text-sm'>
              {t('No version submitted yet')}
            </div>
          )}
        </div>

        <SheetFooter className={sideDrawerFooterClassName()}>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
          {props.packageData?.status !== 'terminated' && (
            <Button onClick={props.onEdit}>{t('Edit product info')}</Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

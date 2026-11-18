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
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatQuota } from '@/lib/format'

import { packageStatusLabels } from '../../token-package/status-labels'
import type { TokenPackage } from '../../token-package/types'
import {
  packageOffer,
  packageStatusVariant,
  type StatusBadgeVariant,
} from '../lib'

type LatestNotice = {
  text: string
  variant: 'info' | 'warning' | 'destructive' | 'secondary'
}

function latestNotice(
  packageData: TokenPackage,
  t: (key: string, options?: Record<string, unknown>) => string
): LatestNotice | null {
  const latest = packageData.latest_version
  if (!latest || latest.id === packageData.active_version?.id) return null

  if (latest.status === 'testing') {
    return {
      variant: 'info',
      text: t('Version {{version}} is being tested.', {
        version: latest.version_no,
      }),
    }
  }
  if (latest.status === 'pending_review') {
    return {
      variant: 'warning',
      text: t('Version {{version}} is waiting for review.', {
        version: latest.version_no,
      }),
    }
  }
  if (latest.status === 'rejected') {
    return {
      variant: 'destructive',
      text: t('The review team rejected version {{version}}.', {
        version: latest.version_no,
      }),
    }
  }
  if (
    latest.status === 'draft' &&
    latest.test_report &&
    !latest.test_report.passed
  ) {
    return {
      variant: 'destructive',
      text: t('The connection check failed for version {{version}}.', {
        version: latest.version_no,
      }),
    }
  }
  if (latest.status === 'draft') {
    return {
      variant: 'secondary',
      text: t('Version {{version}} is a draft.', {
        version: latest.version_no,
      }),
    }
  }
  return null
}

function noticeVariantClasses(variant: LatestNotice['variant']) {
  switch (variant) {
    case 'info':
      return 'border-info/40 bg-info/10 text-info-strong'
    case 'warning':
      return 'border-warning/40 bg-warning/10 text-warning-strong'
    case 'destructive':
      return 'border-destructive/30 bg-destructive/10 text-destructive'
    default:
      return 'bg-muted/60 text-muted-foreground border-transparent'
  }
}

function validityLabel(
  minDays: number,
  maxDays: number,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (minDays <= 0 || maxDays <= 0) return null
  if (minDays === maxDays) {
    return t('{{count}} days', { count: maxDays })
  }
  return t('{{min}}–{{max}} days', { min: minDays, max: maxDays })
}

export function CreatedPackageCard(props: {
  packageData: TokenPackage
  onDetails: () => void
  onEdit: () => void
  onOpenEditor: () => void
  onDelist: () => void
  onRelist: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const packageData = props.packageData
  const displayVersion =
    packageData.active_version || packageData.latest_version
  const offer = packageOffer(displayVersion)
  const latest = packageData.latest_version
  const notice = latestNotice(packageData, t)
  const models = (displayVersion?.models || []).map((spec) => spec.model)
  const validity = validityLabel(offer.minValidDays, offer.maxValidDays, t)
  const latestNeedsFix =
    latest?.status === 'rejected' ||
    (latest?.status === 'draft' &&
      Boolean(latest.test_report && !latest.test_report.passed))
  const latestInProgress =
    latest?.status === 'testing' || latest?.status === 'pending_review'
  const canRelist =
    packageData.status === 'stopped' && packageData.active_version_id > 0
  const canDelist =
    packageData.status === 'listed' || packageData.status === 'paused'
  const canEdit = packageData.status !== 'terminated'

  let primaryLabel = t('Adjust package')
  let primaryAction = props.onOpenEditor
  if (canRelist) {
    primaryLabel = t('Relist')
    primaryAction = props.onRelist
  } else if (latestInProgress) {
    primaryLabel = t('View status')
    primaryAction = props.onDetails
  } else if (latestNeedsFix) {
    primaryLabel = t('Fix issues')
    primaryAction = props.onOpenEditor
  } else if (!packageData.active_version) {
    primaryLabel = packageData.latest_version
      ? t('Complete setup')
      : t('Configure')
  } else if (packageData.status === 'paused') {
    primaryLabel = t('View status')
    primaryAction = props.onDetails
  } else if (packageData.status === 'terminated') {
    primaryLabel = t('Details')
    primaryAction = props.onDetails
  }
  const showDetails = primaryAction !== props.onDetails

  return (
    <Card size='sm' className='flex h-full flex-col'>
      <CardHeader className='gap-1 pb-2'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0 flex-1'>
            <CardTitle className='line-clamp-1 text-sm leading-snug'>
              {packageData.title}
            </CardTitle>
            {packageData.subtitle && (
              <p className='text-muted-foreground mt-1 line-clamp-1 text-[11px] leading-4'>
                {packageData.subtitle}
              </p>
            )}
          </div>
          <div className='flex shrink-0 flex-col items-end gap-1'>
            <Badge
              variant={
                packageStatusVariant(packageData.status) as StatusBadgeVariant
              }
            >
              {t(packageStatusLabels[packageData.status] || packageData.status)}
            </Badge>
            {packageData.degraded && (
              <Badge variant='warning'>{t('Degraded')}</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className='flex flex-1 flex-col gap-2 pt-0'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
          <div className='flex items-baseline gap-1.5'>
            <span className='text-muted-foreground text-[11px]'>
              {t('From')}
            </span>
            <span className='text-sm font-semibold'>
              {offer.minPrice > 0 ? formatQuota(offer.minPrice) : '—'}
            </span>
          </div>
          <div className='flex items-baseline gap-1.5'>
            <span className='text-muted-foreground text-[11px]'>
              {t('Included credit')}
            </span>
            <span className='text-sm font-semibold'>
              {offer.maxCredit > 0 ? formatQuota(offer.maxCredit) : '—'}
            </span>
          </div>
        </div>

        <div className='flex flex-wrap gap-1.5'>
          {models.slice(0, 2).map((model) => (
            <Badge
              key={model}
              variant='outline'
              className='max-w-48 truncate font-normal'
            >
              {model}
            </Badge>
          ))}
          {models.length > 2 && (
            <Badge variant='secondary'>+{models.length - 2}</Badge>
          )}
          {models.length === 0 && (
            <span className='text-muted-foreground text-[11px]'>
              {t('No models selected')}
            </span>
          )}
        </div>

        <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
          <span>{t('{{count}} tiers', { count: offer.tierCount })}</span>
          {validity && <span>{validity}</span>}
        </div>

        {notice && (
          <div
            className={`rounded-md border px-2 py-1.5 text-[11px] leading-4 ${noticeVariantClasses(notice.variant)}`}
          >
            {notice.text}
          </div>
        )}
      </CardContent>

      <CardFooter className='mt-auto flex-wrap gap-1.5 border-t px-3 py-2'>
        {showDetails && (
          <Button
            size='xs'
            variant='outline'
            disabled={props.busy}
            onClick={props.onDetails}
          >
            {t('Details')}
          </Button>
        )}
        {primaryLabel && (
          <Button
            size='xs'
            variant={canRelist ? 'default' : 'secondary'}
            disabled={props.busy}
            onClick={primaryAction}
          >
            {primaryLabel}
          </Button>
        )}
        {(canEdit || canDelist) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size='icon-xs'
                  variant='ghost'
                  aria-label={t('More actions')}
                  disabled={props.busy}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {canEdit && (
                <DropdownMenuItem onClick={props.onEdit}>
                  {t('Edit product info')}
                </DropdownMenuItem>
              )}
              {canEdit && canDelist && <DropdownMenuSeparator />}
              {canDelist && (
                <DropdownMenuItem
                  variant='destructive'
                  onClick={props.onDelist}
                >
                  {t('Delist')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardFooter>
    </Card>
  )
}

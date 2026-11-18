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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { fetchPendingReviews, reviewPackageVersion } from '../token-package/api'
import { versionStatusLabels } from '../token-package/status-labels'
import type { PendingReview } from '../token-package/types'

export function PackageReviews() {
  const { t } = useTranslation()
  const [items, setItems] = useState<PendingReview[]>([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchPendingReviews(1, 50)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Failed to load pending reviews'))
        )
        return
      }
      setItems(res.data?.items || [])
    } catch (error) {
      handleServerError(error, t('Failed to load pending reviews'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const decide = async (versionId: number, action: 'approve' | 'reject') => {
    const note = notes[versionId] || ''
    if (action === 'reject' && !note.trim()) {
      toast.error(t('A rejection reason is required'))
      return
    }
    try {
      const res = await reviewPackageVersion(versionId, action, note)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The review could not be saved'))
        )
        return
      }
      toast.success(
        action === 'approve' ? t('Version approved') : t('Version rejected')
      )
      void load()
    } catch (error) {
      handleServerError(error, t('The review could not be saved'))
    }
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Package reviews')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {!loading && items.length === 0 ? (
          <EmptyState
            title={t('Nothing to review')}
            description={t('New package versions will appear here.')}
          />
        ) : (
          <div className='space-y-4'>
            {items.map((item) => {
              // A different returned model is the clearest sign of a
              // substituted upstream, so those results are listed first.
              const results = [
                ...(item.version.test_report?.results || []),
              ].sort(
                (a, b) => Number(b.model_mismatch) - Number(a.model_mismatch)
              )
              return (
                <Card key={item.version.id}>
                  <CardHeader>
                    <CardTitle className='flex flex-wrap items-center gap-2'>
                      {item.package.title}
                      <Badge variant='outline'>
                        {t('Version {{version}}', {
                          version: item.version.version_no,
                        })}
                      </Badge>
                      <Badge>
                        {t(
                          versionStatusLabels[item.version.status] ||
                            item.version.status
                        )}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {t('Seller')}: {item.seller_name} ·{' '}
                      {t('Submitted at {{time}}', {
                        time: formatTimestampToDate(item.version.submitted_at),
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='space-y-3 text-sm'>
                    <div>
                      <p className='font-medium'>{t('Models')}</p>
                      <ul className='text-muted-foreground'>
                        {(item.version.models || []).map((spec) => (
                          <li key={spec.model}>
                            {spec.model} ·{' '}
                            {t('{{percent}}% of the platform price', {
                              percent: Math.round(spec.multiplier * 100),
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className='font-medium'>{t('SKUs')}</p>
                      <ul className='text-muted-foreground'>
                        {(item.version.skus || []).map((sku) => (
                          <li key={sku.sku_key}>
                            {sku.title}:{' '}
                            {t('Pay {{price}}, get {{credit}}', {
                              price: formatQuota(sku.price_quota),
                              credit: formatQuota(sku.credit_quota),
                            })}{' '}
                            · {t('{{days}} days', { days: sku.valid_days })}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {item.version.test_report && (
                      <div>
                        <p className='font-medium'>
                          {t('Connection check')}:{' '}
                          {item.version.test_report.passed
                            ? t('Passed')
                            : t('Failed')}
                        </p>
                        <ul className='text-muted-foreground list-disc pl-5'>
                          {results.map((result) => (
                            <li key={`${result.channel_id}-${result.model}`}>
                              {result.model}:{' '}
                              {result.model_mismatch ? (
                                <Badge variant='destructive'>
                                  {t('Returned a different model')}
                                </Badge>
                              ) : (
                                <span>
                                  {result.success
                                    ? t('OK')
                                    : result.error || t('Failed')}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <Input
                      aria-label={t('Review note')}
                      placeholder={t('Review note')}
                      value={notes[item.version.id] || ''}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [item.version.id]: event.target.value,
                        }))
                      }
                    />
                    <div className='flex gap-2'>
                      <Button
                        onClick={() => void decide(item.version.id, 'approve')}
                      >
                        {t('Approve')}
                      </Button>
                      <Button
                        variant='destructive'
                        onClick={() => void decide(item.version.id, 'reject')}
                      >
                        {t('Reject')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

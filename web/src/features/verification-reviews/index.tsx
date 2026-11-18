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

import { ConfirmDialog } from '@/components/confirm-dialog'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  fetchVerifications,
  reviewVerification,
  revokeVerification,
} from '../token-package/api'
import { verificationStatusLabels } from '../token-package/status-labels'
import type { AdminVerification } from '../token-package/types'

const REVIEW_PAGE_SIZE = 20

type ReviewView = 'pending' | 'verified'

export function VerificationReviews() {
  const { t } = useTranslation()
  const [view, setView] = useState<ReviewView>('pending')
  const [items, setItems] = useState<AdminVerification[]>([])
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [revoking, setRevoking] = useState<AdminVerification | null>(null)

  // Pending submissions come back oldest first, so buyers waiting to purchase
  // are reviewed in the order they asked.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchVerifications({
        page,
        pageSize: REVIEW_PAGE_SIZE,
        status: view,
      })
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Failed to load real-name reviews'))
        )
        return
      }
      setItems(res.data?.items || [])
      setTotal(res.data?.total || 0)
    } catch (error) {
      handleServerError(error, t('Failed to load real-name reviews'))
    } finally {
      setLoading(false)
    }
  }, [page, t, view])

  useEffect(() => {
    void load()
  }, [load])

  const decide = async (userId: number, approved: boolean) => {
    const note = notes[userId] || ''
    if (!approved && !note.trim()) {
      toast.error(t('A rejection reason is required'))
      return
    }
    try {
      const res = await reviewVerification(userId, approved, note)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The review could not be saved'))
        )
        return
      }
      toast.success(
        approved
          ? t('Real-name verification approved')
          : t('Real-name verification rejected')
      )
      void load()
    } catch (error) {
      handleServerError(error, t('The review could not be saved'))
    }
  }

  const requestRevoke = (item: AdminVerification) => {
    if (!(notes[item.user_id] || '').trim()) {
      toast.error(t('A reason is required to revoke a verification.'))
      return
    }
    setRevoking(item)
  }

  const confirmRevoke = async () => {
    if (!revoking) return
    try {
      const res = await revokeVerification(
        revoking.user_id,
        notes[revoking.user_id] || ''
      )
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The verification could not be revoked'))
        )
        return
      }
      toast.success(t('Real-name verification revoked'))
      setRevoking(null)
      void load()
    } catch (error) {
      handleServerError(error, t('The verification could not be revoked'))
    }
  }

  const changeView = (next: string) => {
    setView(next === 'verified' ? 'verified' : 'pending')
    setPage(1)
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Real-name reviews')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs value={view} onValueChange={changeView} className='mb-4'>
          <TabsList>
            <TabsTrigger value='pending'>{t('Pending review')}</TabsTrigger>
            <TabsTrigger value='verified'>{t('Verified')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {!loading && items.length === 0 ? (
          <EmptyState
            title={
              view === 'pending'
                ? t('Nothing to review')
                : t('No verified users')
            }
            description={t(
              'Pending real-name submissions will appear here. ID numbers are never stored.'
            )}
          />
        ) : (
          <div className='space-y-4'>
            {items.map((item) => (
              <Card key={item.user_id}>
                <CardHeader>
                  <CardTitle className='flex flex-wrap items-center gap-2'>
                    {item.username || t('User {{id}}', { id: item.user_id })}
                    <Badge>
                      {t(verificationStatusLabels[item.status] || item.status)}
                    </Badge>
                    <Badge variant='outline'>
                      {item.seller_group ? t('Seller group') : t('Buyer')}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {item.masked_name || t('Name hidden')} ·{' '}
                    {t('Submitted at {{time}}', {
                      time: formatTimestampToDate(item.updated_at),
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <Input
                    aria-label={t('Review note')}
                    placeholder={
                      view === 'pending'
                        ? t('Review note')
                        : t('Reason for revoking')
                    }
                    value={notes[item.user_id] || ''}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [item.user_id]: event.target.value,
                      }))
                    }
                  />
                  {view === 'pending' ? (
                    <div className='flex gap-2'>
                      <Button onClick={() => void decide(item.user_id, true)}>
                        {t('Approve')}
                      </Button>
                      <Button
                        variant='destructive'
                        onClick={() => void decide(item.user_id, false)}
                      >
                        {t('Reject')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant='destructive'
                      onClick={() => requestRevoke(item)}
                    >
                      {t('Revoke')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {total > REVIEW_PAGE_SIZE && (
          <div className='mt-4 flex justify-center gap-2'>
            <Button
              variant='outline'
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => current - 1)}
            >
              {t('Previous')}
            </Button>
            <Button
              variant='outline'
              disabled={page * REVIEW_PAGE_SIZE >= total || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        )}
        <ConfirmDialog
          open={revoking !== null}
          onOpenChange={(open) => {
            if (!open) setRevoking(null)
          }}
          title={t('Revoke this verification?')}
          desc={t(
            '{{name}} can no longer buy or publish until a new submission is approved. Their listed packages stop selling; packages already sold keep serving.',
            { name: revoking?.username || '' }
          )}
          destructive
          confirmText={t('Revoke')}
          handleConfirm={() => void confirmRevoke()}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

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
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { SectionPageLayout } from '@/components/layout'
import { RiskAcknowledgementDialog } from '@/components/risk-acknowledgement-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDebounce } from '@/hooks/use-debounce'
import { formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  fetchMarketPackages,
  PACKAGE_BUYER_UNVERIFIED_CODE,
  purchasePackage,
} from '../token-package/api'
import { BuyerVerificationNotice } from '../token-package/components/buyer-verification-notice'
import {
  myVerificationQueryKey,
  useMyVerification,
} from '../token-package/hooks/use-my-verification'
import type { PackageSKU, TokenPackage } from '../token-package/types'

function discountLabel(
  multiplier: number,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return t('Platform price')
  }
  const percent = Math.round(multiplier * 100)
  if (percent === 100) return t('Platform price')
  if (percent < 100) {
    return t('{{percent}}% of the platform price', { percent })
  }
  return t('{{percent}}% of the platform price', { percent })
}

export function Market() {
  const { t } = useTranslation()
  const [packages, setPackages] = useState<TokenPackage[]>([])
  const [keyword, setKeyword] = useState('')
  const [model, setModel] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TokenPackage | null>(null)
  const [selectedSKU, setSelectedSKU] = useState('')
  const [purchasing, setPurchasing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const purchasingRef = useRef(false)
  const [purchased, setPurchased] = useState<TokenPackage | null>(null)
  const balance = useAuthStore((state) => state.auth.user?.quota) || 0
  const queryClient = useQueryClient()
  const verificationQuery = useMyVerification()
  // A purchase needs a verified buyer (D17). Until the status is known the
  // purchase stays disabled; the server enforces the same rule.
  const verificationStatus = verificationQuery.data?.status
  const buyerVerified = verificationStatus === 'verified'

  // Search runs once typing pauses, not on every keystroke.
  const debouncedKeyword = useDebounce(keyword, 300)
  const debouncedModel = useDebounce(model, 300)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchMarketPackages({
        page,
        pageSize: 12,
        keyword: debouncedKeyword,
        model: debouncedModel,
      })
      if (!res.success || !res.data) {
        handleServerError(
          createServerError(res, t('Failed to load the marketplace'))
        )
        return
      }
      setPackages(res.data.items || [])
      setTotal(res.data.total || 0)
    } catch (error) {
      handleServerError(error, t('Failed to load the marketplace'))
    } finally {
      setLoading(false)
    }
  }, [debouncedKeyword, debouncedModel, page, t])

  useEffect(() => {
    void load()
  }, [load])

  const openPackage = (pkg: TokenPackage) => {
    setSelected(pkg)
    const first = pkg.active_version?.skus?.[0]
    setSelectedSKU(first ? first.sku_key : '')
  }

  const confirmPurchase = async () => {
    if (!selected || !selectedSKU || purchasingRef.current) return
    purchasingRef.current = true
    setPurchasing(true)
    try {
      const res = await purchasePackage(selected.id, selectedSKU)
      if (!res.success) {
        if (res.code === PACKAGE_BUYER_UNVERIFIED_CODE) {
          // The status changed since the page loaded; refresh it so the
          // dialog shows the verification guide instead of the purchase.
          setConfirming(false)
          void queryClient.invalidateQueries({
            queryKey: myVerificationQueryKey,
          })
        }
        handleServerError(
          createServerError(res, t('The purchase could not be completed'))
        )
        return
      }
      toast.success(t('Package purchased'))
      setPurchased(selected)
      setSelected(null)
      setConfirming(false)
    } catch (error) {
      handleServerError(error, t('The purchase could not be completed'))
    } finally {
      purchasingRef.current = false
      setPurchasing(false)
    }
  }

  const skus: PackageSKU[] = selected?.active_version?.skus || []

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Token market')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          {verificationStatus && !buyerVerified && (
            <BuyerVerificationNotice status={verificationStatus} />
          )}
          <div className='flex flex-wrap gap-2'>
            <Input
              className='max-w-xs'
              placeholder={t('Search packages')}
              value={keyword}
              onChange={(event) => {
                setPage(1)
                setKeyword(event.target.value)
              }}
            />
            <Input
              className='max-w-xs'
              placeholder={t('Filter by model')}
              value={model}
              onChange={(event) => {
                setPage(1)
                setModel(event.target.value)
              }}
            />
          </div>

          {!loading && packages.length === 0 ? (
            <EmptyState
              title={t('No packages on sale')}
              description={t('Sellers have not listed any package yet.')}
            />
          ) : (
            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {packages.map((pkg) => (
                <Card key={pkg.id} className='flex flex-col'>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2'>
                      {pkg.title}
                      {pkg.degraded && (
                        <Badge variant='destructive'>{t('Degraded')}</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {pkg.subtitle || pkg.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='flex-1 space-y-2 text-sm'>
                    <div className='text-muted-foreground'>
                      {t('Seller')}: {pkg.seller_name}
                    </div>
                    <div>
                      {t('From')}{' '}
                      <span className='font-medium'>
                        {formatQuota(
                          Math.min(
                            ...(pkg.active_version?.skus || []).map(
                              (sku) => sku.price_quota
                            )
                          )
                        )}
                      </span>
                    </div>
                    <div className='text-muted-foreground'>
                      {(pkg.active_version?.models || [])
                        .map((spec) => spec.model)
                        .join(', ')}
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button className='w-full' onClick={() => openPackage(pkg)}>
                      {t('View and buy')}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}

          {total > 12 && (
            <div className='flex justify-center gap-2'>
              <Button
                variant='outline'
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('Previous')}
              </Button>
              <Button
                variant='outline'
                disabled={page * 12 >= total}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          )}
        </div>

        <Dialog
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
        >
          <DialogContent className='sm:max-w-lg'>
            <DialogHeader>
              <DialogTitle>{selected?.title}</DialogTitle>
              <DialogDescription>
                {t(
                  'Requests bought here are sent to a third-party upstream operated by the seller.'
                )}
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-3'>
              {(selected?.active_version?.models || []).map((spec) => (
                <div key={spec.model} className='flex justify-between text-sm'>
                  <span>{spec.model}</span>
                  <span className='text-muted-foreground'>
                    {discountLabel(spec.multiplier, t)}
                  </span>
                </div>
              ))}
              <RadioGroup
                value={selectedSKU}
                onValueChange={(value) => setSelectedSKU(value)}
              >
                {skus.map((sku) => (
                  <Label
                    key={sku.sku_key}
                    className='flex cursor-pointer items-center justify-between rounded-md border p-3 text-sm font-normal'
                  >
                    <span className='flex items-center gap-2'>
                      <RadioGroupItem value={sku.sku_key} />
                      {sku.title}
                    </span>
                    <span className='text-muted-foreground'>
                      {t('Pay {{price}}, get {{credit}}', {
                        price: formatQuota(sku.price_quota),
                        credit: formatQuota(sku.credit_quota),
                      })}{' '}
                      · {t('{{days}} days', { days: sku.valid_days })}
                    </span>
                  </Label>
                ))}
              </RadioGroup>
              <p className='text-muted-foreground text-sm'>
                {t('Wallet balance')}: {formatQuota(balance)}
              </p>
              {verificationStatus && !buyerVerified && (
                <BuyerVerificationNotice status={verificationStatus} />
              )}
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setSelected(null)}>
                {t('Cancel')}
              </Button>
              <Button
                disabled={!selectedSKU || !buyerVerified}
                onClick={() => setConfirming(true)}
              >
                {t('Continue')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <RiskAcknowledgementDialog
          open={confirming}
          onOpenChange={(open) => {
            if (!open && purchasingRef.current) return
            setConfirming(open)
          }}
          destructive={false}
          isLoading={purchasing}
          title={t('Confirm purchase')}
          description={t(
            'Requests bought here are sent to a third-party upstream operated by the seller.'
          )}
          checklist={[
            t(
              'I understand the paid price is charged from my wallet and the credit is spent only on this package.'
            ),
            t(
              'I understand unused credit is refunded only if the package is terminated, not when it expires.'
            ),
          ]}
          confirmText={purchasing ? t('Purchasing...') : t('Confirm purchase')}
          onConfirm={() => void confirmPurchase()}
        />

        <Dialog
          open={purchased !== null}
          onOpenChange={(open) => {
            if (!open) setPurchased(null)
          }}
        >
          <DialogContent className='sm:max-w-lg'>
            <DialogHeader>
              <DialogTitle>{t('Package purchased')}</DialogTitle>
              <DialogDescription>
                {t(
                  'Create an API key for {{title}} before you can send requests against this package.',
                  { title: purchased?.title || '' }
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant='outline' onClick={() => setPurchased(null)}>
                {t('Close')}
              </Button>
              <Button
                render={
                  <Link to='/account/$section' params={{ section: 'keys' }} />
                }
              >
                {t('Create an API key')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

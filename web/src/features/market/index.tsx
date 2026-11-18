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
import { Store } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { PageTransition } from '@/components/page-transition'
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
import { useAuthDialogStore } from '@/stores/auth-dialog-store'
import { useAuthStore } from '@/stores/auth-store'

import {
  fetchMarketPackages,
  PACKAGE_BUYER_UNVERIFIED_CODE,
  purchasePackage,
} from '../token-package/api'
import { BuyerVerificationDialog } from '../token-package/components/buyer-verification-dialog'
import { useMyVerification } from '../token-package/hooks/use-my-verification'
import type {
  PackageSKU,
  PublicTokenPackage,
  VerificationState,
} from '../token-package/types'

function discountLabel(
  multiplier: number,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return t('Platform price')
  }
  const percent = Math.round(multiplier * 100)
  if (percent === 100) return t('Platform price')
  return t('{{percent}}% of the platform price', { percent })
}

export function Market() {
  const { t } = useTranslation()
  const [packages, setPackages] = useState<PublicTokenPackage[]>([])
  const [keyword, setKeyword] = useState('')
  const [model, setModel] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PublicTokenPackage | null>(null)
  const [selectedSKU, setSelectedSKU] = useState('')
  const [purchasing, setPurchasing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [checkingVerification, setCheckingVerification] = useState(false)
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false)
  const [verificationDialogStatus, setVerificationDialogStatus] =
    useState<VerificationState>('unverified')
  const purchasingRef = useRef(false)
  const [purchased, setPurchased] = useState<PublicTokenPackage | null>(null)
  const user = useAuthStore((state) => state.auth.user)
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)
  const verificationQuery = useMyVerification(false)
  const balance = user?.quota ?? 0

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

  const openPackage = (pkg: PublicTokenPackage) => {
    setSelected(pkg)
    const first = pkg.active_version?.skus?.[0]
    setSelectedSKU(first ? first.sku_key : '')
  }

  const handleContinue = async () => {
    if (!selected || !selectedSKU || checkingVerification) return
    if (!user) {
      openAuthDialog('sign-in', '/market')
      return
    }

    setCheckingVerification(true)
    try {
      const result = await verificationQuery.refetch()
      if (result.error) {
        handleServerError(
          result.error,
          t('Unable to check your real-name verification status')
        )
        return
      }

      const status = result.data?.status ?? 'unverified'
      if (status === 'verified') {
        setConfirming(true)
        return
      }

      setVerificationDialogStatus(status)
      setVerificationDialogOpen(true)
    } finally {
      setCheckingVerification(false)
    }
  }

  const confirmPurchase = async () => {
    if (!selected || !selectedSKU || purchasingRef.current) return
    purchasingRef.current = true
    setPurchasing(true)
    try {
      const res = await purchasePackage(selected.id, selectedSKU)
      if (!res.success) {
        if (res.code === PACKAGE_BUYER_UNVERIFIED_CODE) {
          setConfirming(false)
          const refreshed = await verificationQuery.refetch()
          setVerificationDialogStatus(refreshed.data?.status ?? 'unverified')
          setVerificationDialogOpen(true)
          return
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
  const prices = (selected?.active_version?.skus || []).map(
    (sku) => sku.price_quota
  )
  const minimumPrice = prices.length > 0 ? Math.min(...prices) : 0

  let content: ReactNode
  if (loading) {
    content = <LoadingState message={t('Loading token packages...')} />
  } else if (packages.length === 0) {
    content = (
      <EmptyState
        title={t('No packages on sale')}
        description={t('Sellers have not listed any package yet.')}
      />
    )
  } else {
    content = (
      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
        {packages.map((pkg) => {
          const skuPrices = (pkg.active_version?.skus || []).map(
            (sku) => sku.price_quota
          )
          const fromPrice = skuPrices.length > 0 ? Math.min(...skuPrices) : 0
          return (
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
                    {formatQuota(fromPrice)}
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
          )
        })}
      </div>
    )
  }

  let continueLabel = t('Sign in to buy')
  if (checkingVerification) {
    continueLabel = t('Checking...')
  } else if (user) {
    continueLabel = t('Continue')
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
          style={{
            background: [
              'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.72 0.18 250 / 80%) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.65 0.15 200 / 60%) 0%, transparent 70%)',
              'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.70 0.12 280 / 40%) 0%, transparent 70%)',
            ].join(', '),
            maskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <PageTransition className='relative mx-auto w-full max-w-[1440px] px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
          <header className='mx-auto mb-8 max-w-3xl pt-5 text-center sm:mb-12 sm:pt-10'>
            <Badge variant='outline' className='mb-4 gap-1.5'>
              <Store className='size-3.5' />
              {t('Token market')}
            </Badge>
            <h1 className='text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.15] font-bold tracking-tight'>
              {t('Token market')}
            </h1>
            <p className='text-muted-foreground mx-auto mt-4 max-w-2xl text-sm leading-relaxed sm:text-base'>
              {t(
                'Browse token packages from verified sellers. Sign in to buy when you find a package that fits your work.'
              )}
            </p>
          </header>

          <div className='mb-6 flex flex-wrap gap-2'>
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

          {content}

          {total > 12 && (
            <div className='mt-6 flex justify-center gap-2'>
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
        </PageTransition>
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
            <div className='text-muted-foreground text-sm'>
              {t('Seller')}: {selected?.seller_name}
            </div>
            <div className='text-sm'>
              {t('From')}{' '}
              <span className='font-medium'>{formatQuota(minimumPrice)}</span>
            </div>
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
            {user && (
              <p className='text-muted-foreground text-sm'>
                {t('Wallet balance')}: {formatQuota(balance)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setSelected(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={!selectedSKU || checkingVerification}
              onClick={() => void handleContinue()}
            >
              {continueLabel}
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

      <BuyerVerificationDialog
        open={verificationDialogOpen}
        status={verificationDialogStatus}
        onOpenChange={setVerificationDialogOpen}
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
    </PublicLayout>
  )
}

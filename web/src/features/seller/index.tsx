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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { CHANNEL_TYPES } from '@/features/channels/constants'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToEditableAmount,
} from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  createMyChannel,
  createSellerPackage,
  createSellerPackageVersion,
  deleteMyChannel,
  fetchMyChannels,
  fetchMyVerification,
  fetchSellerLedger,
  fetchSellerPackages,
  fetchSellerStats,
  fetchSellerStatus,
  fetchUserChannelModels,
  relistSellerPackage,
  stopSellerPackage,
  testMyChannel,
} from '../token-package/api'
import { VerificationPanel } from '../token-package/components/verification-panel'
import { MARKETPLACE_CHANNEL_TYPES } from '../token-package/marketplace-channel-types'
import {
  ledgerStatusLabels,
  ledgerTypeLabels,
  packageStatusLabels,
  sellerReasonLabels,
  verificationStatusLabels,
  versionStatusLabels,
} from '../token-package/status-labels'
import type {
  PackageVersion,
  SellerLedgerEntry,
  SellerRevenueSummary,
  SellerStatus,
  TokenPackage,
  UserChannel,
  VerificationStatus,
} from '../token-package/types'

export function Seller() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<SellerStatus | null>(null)
  const [verification, setVerification] = useState<VerificationStatus | null>(
    null
  )
  const [channels, setChannels] = useState<UserChannel[]>([])
  const [packages, setPackages] = useState<TokenPackage[]>([])
  const [ledger, setLedger] = useState<SellerLedgerEntry[]>([])
  const [stats, setStats] = useState<SellerRevenueSummary | null>(null)

  const load = useCallback(async () => {
    try {
      const [
        statusRes,
        verificationRes,
        channelRes,
        packageRes,
        ledgerRes,
        statsRes,
      ] = await Promise.all([
        fetchSellerStatus(),
        fetchMyVerification(),
        fetchMyChannels(),
        fetchSellerPackages(),
        fetchSellerLedger(1, 20),
        fetchSellerStats(),
      ])
      const failed = [
        statusRes,
        verificationRes,
        channelRes,
        packageRes,
        ledgerRes,
        statsRes,
      ].find((res) => !res.success)
      if (failed) {
        handleServerError(
          createServerError(failed, t('Failed to load the seller center'))
        )
      }
      if (statusRes.success) setStatus(statusRes.data || null)
      if (verificationRes.success) setVerification(verificationRes.data || null)
      if (channelRes.success) setChannels(channelRes.data || [])
      if (packageRes.success) setPackages(packageRes.data || [])
      if (ledgerRes.success) setLedger(ledgerRes.data?.items || [])
      if (statsRes.success) setStats(statsRes.data || null)
    } catch (error) {
      handleServerError(error, t('Failed to load the seller center'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  let statusMessage = ''
  if (status) {
    if (status.publish_banned) {
      statusMessage = status.ban_reason || t('Publishing has been suspended.')
    } else if (status.eligible) {
      statusMessage = t('You can publish channels and packages.')
    } else {
      statusMessage = t(
        'Complete real-name verification and meet the seller requirements to publish.'
      )
    }
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Seller center')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {status && (
          <Card className='mb-4'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                {t('Seller eligibility')}
                <Badge variant={status.eligible ? 'default' : 'secondary'}>
                  {status.eligible ? t('Eligible') : t('Not eligible')}
                </Badge>
              </CardTitle>
              <CardDescription>{statusMessage}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2'>
              {(status.reasons || []).length > 0 && (
                <ul className='text-muted-foreground list-disc pl-5 text-sm'>
                  {(status.reasons || []).map((reason) => (
                    <li key={reason}>
                      {t(sellerReasonLabels[reason] || reason)}
                    </li>
                  ))}
                </ul>
              )}
              {verification && (
                <p className='text-sm'>
                  {t('Real-name status')}:{' '}
                  <Badge variant='outline'>
                    {t(
                      verificationStatusLabels[verification.status] ||
                        verification.status
                    )}
                  </Badge>
                  {verification.masked_name && (
                    <span className='text-muted-foreground ml-2'>
                      {verification.masked_name}
                    </span>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue='verification'>
          <TabsList>
            <TabsTrigger value='verification'>
              {t('Real-name verification')}
            </TabsTrigger>
            <TabsTrigger value='channels'>{t('My channels')}</TabsTrigger>
            <TabsTrigger value='packages'>{t('My packages')}</TabsTrigger>
            <TabsTrigger value='revenue'>{t('Revenue')}</TabsTrigger>
          </TabsList>

          <TabsContent value='verification'>
            <VerificationPanel onSubmitted={() => void load()} />
          </TabsContent>

          <TabsContent value='channels'>
            <ChannelsPanel channels={channels} onChanged={() => void load()} />
          </TabsContent>

          <TabsContent value='packages'>
            <PackagesPanel
              packages={packages}
              channels={channels}
              onChanged={() => void load()}
            />
          </TabsContent>

          <TabsContent value='revenue'>
            <RevenuePanel stats={stats} ledger={ledger} />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function channelTypeLabel(type: number) {
  const label = CHANNEL_TYPES[type as keyof typeof CHANNEL_TYPES]
  return label || String(type)
}

function ChannelsPanel(props: {
  channels: UserChannel[]
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [type, setType] = useState(String(MARKETPLACE_CHANNEL_TYPES[0]))
  const [baseURL, setBaseURL] = useState('')
  const [key, setKey] = useState('')
  const [models, setModels] = useState('')
  const [creating, setCreating] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [deleting, setDeleting] = useState<UserChannel | null>(null)

  const fetchModels = async () => {
    setFetchingModels(true)
    try {
      const res = await fetchUserChannelModels({
        type: Number(type),
        baseURL: baseURL.trim(),
        key: key.trim(),
      })
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Models could not be fetched'))
        )
        return
      }
      setModels((res.data || []).join(', '))
    } catch (error) {
      handleServerError(error, t('Models could not be fetched'))
    } finally {
      setFetchingModels(false)
    }
  }

  const create = async () => {
    setCreating(true)
    try {
      const res = await createMyChannel({
        name: name.trim(),
        type: Number(type),
        base_url: baseURL.trim(),
        key: key.trim(),
        models: models
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      })
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The channel could not be created'))
        )
        return
      }
      toast.success(t('Channel created'))
      setName('')
      setBaseURL('')
      setKey('')
      setModels('')
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('The channel could not be created'))
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      const res = await deleteMyChannel(deleting.id)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The channel could not be deleted'))
        )
        return
      }
      toast.success(t('Channel deleted'))
      setDeleting(null)
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('The channel could not be deleted'))
    }
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Add a channel')}</CardTitle>
          <CardDescription>
            {t(
              'Only standard protocol channels are accepted. Keys are write-only.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3 md:grid-cols-2'>
          <Input
            placeholder={t('Channel name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Select
            value={type}
            onValueChange={(value) => setType(value ?? type)}
          >
            <SelectTrigger className='w-full'>
              <SelectValue placeholder={t('Channel type')} />
            </SelectTrigger>
            <SelectContent>
              {MARKETPLACE_CHANNEL_TYPES.map((channelType) => (
                <SelectItem key={channelType} value={String(channelType)}>
                  {t(channelTypeLabel(channelType))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={t('Base URL')}
            value={baseURL}
            onChange={(event) => setBaseURL(event.target.value)}
          />
          <Input
            placeholder={t('API key')}
            type='password'
            autoComplete='off'
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <div className='flex gap-2 md:col-span-2'>
            <Input
              placeholder={t('Models, comma separated')}
              value={models}
              onChange={(event) => setModels(event.target.value)}
            />
            <Button
              variant='outline'
              disabled={fetchingModels || !key.trim()}
              onClick={() => void fetchModels()}
            >
              {fetchingModels ? t('Fetching...') : t('Fetch models')}
            </Button>
          </div>
          <Button
            className='md:col-span-2'
            disabled={creating || !name || !key}
            onClick={() => void create()}
          >
            {creating ? t('Creating...') : t('Create channel')}
          </Button>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete this channel?')}
        desc={t('{{name}} will be removed. This cannot be undone.', {
          name: deleting?.name || '',
        })}
        destructive
        handleConfirm={() => void confirmDelete()}
      />

      {props.channels.length === 0 ? (
        <EmptyState title={t('No channels yet')} />
      ) : (
        props.channels.map((channel) => (
          <Card key={channel.id}>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                {channel.name}
                <Badge variant='outline'>
                  {t(channelTypeLabel(channel.type))}
                </Badge>
                {(channel.bound_packages || []).length > 0 && (
                  <Badge variant='secondary'>{t('Bound to packages')}</Badge>
                )}
              </CardTitle>
              <CardDescription>{channel.base_url}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap items-center gap-2 text-sm'>
              <span className='text-muted-foreground'>
                {(channel.models || []).join(', ')}
              </span>
              <div className='ml-auto flex gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={async () => {
                    try {
                      const res = await testMyChannel(channel.id)
                      if (!res.success) {
                        handleServerError(
                          createServerError(res, t('Channel test failed'))
                        )
                        return
                      }
                      toast.success(t('Channel test passed'))
                    } catch (error) {
                      handleServerError(error, t('Channel test failed'))
                    }
                  }}
                >
                  {t('Test')}
                </Button>
                <Button
                  variant='destructive'
                  size='sm'
                  disabled={(channel.bound_packages || []).length > 0}
                  onClick={() => setDeleting(channel)}
                >
                  {t('Delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

type VersionSKU = {
  key: string
  title: string
  price: string
  credit: string
  validDays: string
}

function blankSKU(): VersionSKU {
  return {
    key: `sku-${Date.now()}`,
    title: '',
    price: String(quotaUnitsToEditableAmount(10000)),
    credit: String(quotaUnitsToEditableAmount(200000)),
    validDays: '30',
  }
}

function TestReport(props: {
  report: NonNullable<PackageVersion['test_report']>
}) {
  const { t } = useTranslation()
  const report = props.report
  return (
    <div className='w-full space-y-1 text-sm'>
      <p className='font-medium'>
        {t('Connection check')}: {report.passed ? t('Passed') : t('Failed')}
      </p>
      {(report.fail_reasons || []).map((reason) => (
        <p key={reason} className='text-destructive'>
          {reason}
        </p>
      ))}
      {(report.results || []).map((result) => {
        let outcome = result.error || t('Failed')
        if (result.model_mismatch) outcome = t('Returned a different model')
        else if (result.success) outcome = t('OK')
        return (
          <p
            key={`${result.channel_id}-${result.model}`}
            className='text-muted-foreground'
          >
            {result.model}: {outcome}
          </p>
        )
      })}
    </div>
  )
}

function PackagesPanel(props: {
  packages: TokenPackage[]
  channels: UserChannel[]
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [versionFor, setVersionFor] = useState<TokenPackage | null>(null)
  const [delisting, setDelisting] = useState<TokenPackage | null>(null)
  const [modelLines, setModelLines] = useState('')
  const [skus, setSkus] = useState<VersionSKU[]>([blankSKU()])
  const [channelModels, setChannelModels] = useState<Record<number, string[]>>(
    {}
  )

  const updateSKU = (key: string, patch: Partial<VersionSKU>) => {
    setSkus((current) =>
      current.map((sku) => (sku.key === key ? { ...sku, ...patch } : sku))
    )
  }

  const toggleChannelModel = (
    channelId: number,
    model: string,
    checked: boolean
  ) => {
    setChannelModels((current) => {
      const selected = current[channelId] || []
      return {
        ...current,
        [channelId]: checked
          ? [...selected, model]
          : selected.filter((item) => item !== model),
      }
    })
  }

  const createPackage = async () => {
    setCreating(true)
    try {
      const res = await createSellerPackage({ title: title.trim() })
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The package could not be created'))
        )
        return
      }
      toast.success(t('Package created'))
      setTitle('')
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('The package could not be created'))
    } finally {
      setCreating(false)
    }
  }

  const submitVersion = async () => {
    if (!versionFor) return
    const models = modelLines
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [model, multiplier] = line.split('=')
        return { model: model.trim(), multiplier: Number(multiplier || '1') }
      })
    const modelNames = new Set(models.map((spec) => spec.model))
    const channels = Object.entries(channelModels)
      .map(([channelId, selected]) => ({
        channel_id: Number(channelId),
        models: selected.filter((model) => modelNames.has(model)),
        priority: 0,
        weight: 1,
      }))
      .filter((binding) => binding.models.length > 0)
    let res: Awaited<ReturnType<typeof createSellerPackageVersion>>
    try {
      res = await createSellerPackageVersion(versionFor.id, {
        models,
        skus: skus
          .filter((sku) => sku.title.trim())
          .map((sku) => ({
            sku_key: sku.key.trim(),
            title: sku.title.trim(),
            price_quota: parseQuotaFromDollars(Number(sku.price)),
            credit_quota: parseQuotaFromDollars(Number(sku.credit)),
            valid_days: Number(sku.validDays),
          })),
        channels,
      })
    } catch (error) {
      handleServerError(error, t('The version could not be submitted'))
      return
    }
    if (!res.success) {
      handleServerError(
        createServerError(res, t('The version could not be submitted'))
      )
      return
    }
    // The connection check runs in the background: the version shows as
    // testing and moves to review, approval or draft when it finishes.
    toast.success(
      t('Version submitted. The connection check is running in the background.')
    )
    setVersionFor(null)
    props.onChanged()
  }

  // A new version starts from the version buyers currently see, so a seller
  // only changes what is meant to change; keeping SKU keys lets a price cut
  // be recognised as one instead of as a removed and an added SKU.
  const startVersion = (pkg: TokenPackage) => {
    const active = pkg.active_version
    setVersionFor(pkg)
    if (!active) {
      setSkus([blankSKU()])
      setChannelModels({})
      setModelLines('')
      return
    }
    setModelLines(
      (active.models || [])
        .map((spec) => `${spec.model}=${spec.multiplier}`)
        .join('\n')
    )
    const activeSKUs = (active.skus || []).map((sku) => ({
      key: sku.sku_key,
      title: sku.title,
      price: String(quotaUnitsToEditableAmount(sku.price_quota)),
      credit: String(quotaUnitsToEditableAmount(sku.credit_quota)),
      validDays: String(sku.valid_days),
    }))
    setSkus(activeSKUs.length > 0 ? activeSKUs : [blankSKU()])
    setChannelModels(
      Object.fromEntries(
        (active.channels || []).map((binding) => [
          binding.channel_id,
          binding.models || [],
        ])
      )
    )
  }

  const confirmDelist = async () => {
    if (!delisting) return
    try {
      const res = await stopSellerPackage(delisting.id)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The package could not be stopped'))
        )
        return
      }
      toast.success(t('Package delisted'))
      setDelisting(null)
      props.onChanged()
    } catch (error) {
      handleServerError(error, t('The package could not be stopped'))
    }
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Create a package')}</CardTitle>
        </CardHeader>
        <CardContent className='flex gap-2'>
          <Input
            placeholder={t('Package title')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            disabled={creating || !title.trim()}
            onClick={() => void createPackage()}
          >
            {t('Create')}
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={delisting !== null}
        onOpenChange={(open) => {
          if (!open) setDelisting(null)
        }}
        title={t('Stop selling this package?')}
        desc={t(
          '{{name}} leaves the market. Buyers who already bought it keep using it until their credit runs out or expires.',
          { name: delisting?.title || '' }
        )}
        destructive
        handleConfirm={() => void confirmDelist()}
      />

      {props.packages.length === 0 ? (
        <EmptyState title={t('No packages yet')} />
      ) : (
        props.packages.map((pkg) => (
          <Card key={pkg.id}>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                {pkg.title}
                <Badge variant='outline'>
                  {t(packageStatusLabels[pkg.status] || pkg.status)}
                </Badge>
                {pkg.latest_version?.test_report &&
                  !pkg.latest_version.test_report.passed && (
                    <Badge variant='destructive'>{t('Check failed')}</Badge>
                  )}
              </CardTitle>
              <CardDescription>
                {pkg.latest_version
                  ? t('Version {{version}} · {{status}}', {
                      version: pkg.latest_version.version_no,
                      status: t(
                        versionStatusLabels[pkg.latest_version.status] ||
                          pkg.latest_version.status
                      ),
                    })
                  : t('No version submitted yet')}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap gap-2'>
              <Button
                size='sm'
                variant='outline'
                onClick={() => startVersion(pkg)}
              >
                {t('New version')}
              </Button>
              {(pkg.status === 'listed' || pkg.status === 'paused') && (
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={() => setDelisting(pkg)}
                >
                  {t('Delist')}
                </Button>
              )}
              {pkg.status === 'stopped' && pkg.active_version_id > 0 && (
                <Button
                  size='sm'
                  onClick={async () => {
                    try {
                      const res = await relistSellerPackage(pkg.id)
                      if (!res.success) {
                        handleServerError(
                          createServerError(
                            res,
                            t('The package could not be relisted')
                          )
                        )
                        return
                      }
                      toast.success(t('Package listed'))
                      props.onChanged()
                    } catch (error) {
                      handleServerError(
                        error,
                        t('The package could not be relisted')
                      )
                    }
                  }}
                >
                  {t('Relist')}
                </Button>
              )}
              {pkg.latest_version?.review_note && (
                <p className='text-muted-foreground w-full text-sm'>
                  {t('Review note')}: {pkg.latest_version.review_note}
                </p>
              )}
              {pkg.latest_version?.test_report && (
                <TestReport report={pkg.latest_version.test_report} />
              )}
            </CardContent>
          </Card>
        ))
      )}

      {versionFor && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('New version for {{title}}', { title: versionFor.title })}
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='space-y-1'>
              <Label>{t('Models')}</Label>
              <Textarea
                className='min-h-24 font-mono'
                placeholder={t('One model per line, as model=multiplier')}
                value={modelLines}
                onChange={(event) => setModelLines(event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'The multiplier is applied to the platform price. 0.6 means the buyer pays 60%.'
                )}
              </p>
            </div>
            <div className='space-y-2'>
              {skus.map((sku) => (
                <div key={sku.key} className='grid gap-2 md:grid-cols-5'>
                  <Input
                    placeholder={t('SKU key')}
                    value={sku.key}
                    onChange={(event) =>
                      updateSKU(sku.key, { key: event.target.value })
                    }
                  />
                  <Input
                    placeholder={t('SKU title')}
                    value={sku.title}
                    onChange={(event) =>
                      updateSKU(sku.key, { title: event.target.value })
                    }
                  />
                  <Input
                    type='number'
                    placeholder={t('Price')}
                    value={sku.price}
                    onChange={(event) =>
                      updateSKU(sku.key, { price: event.target.value })
                    }
                  />
                  <Input
                    type='number'
                    placeholder={t('Credit')}
                    value={sku.credit}
                    onChange={(event) =>
                      updateSKU(sku.key, { credit: event.target.value })
                    }
                  />
                  <Input
                    type='number'
                    placeholder={t('Valid days')}
                    value={sku.validDays}
                    onChange={(event) =>
                      updateSKU(sku.key, { validDays: event.target.value })
                    }
                  />
                </div>
              ))}
              <Button
                variant='outline'
                size='sm'
                onClick={() => setSkus((current) => [...current, blankSKU()])}
              >
                {t('Add SKU')}
              </Button>
            </div>
            <div className='space-y-3'>
              {props.channels.map((channel) => (
                <div key={channel.id} className='space-y-1'>
                  <p className='text-sm font-medium'>{channel.name}</p>
                  {(channel.models || []).length === 0 ? (
                    <p className='text-muted-foreground text-xs'>
                      {t('This channel has no declared models.')}
                    </p>
                  ) : (
                    <div className='flex flex-wrap gap-3'>
                      {(channel.models || []).map((model) => (
                        <label
                          key={model}
                          className='flex items-center gap-2 text-sm'
                        >
                          <Checkbox
                            checked={(channelModels[channel.id] || []).includes(
                              model
                            )}
                            onCheckedChange={(checked) =>
                              toggleChannelModel(
                                channel.id,
                                model,
                                checked === true
                              )
                            }
                          />
                          {model}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className='flex gap-2'>
              <Button onClick={() => void submitVersion()}>
                {t('Submit for review')}
              </Button>
              <Button variant='outline' onClick={() => setVersionFor(null)}>
                {t('Cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RevenuePanel(props: {
  stats: SellerRevenueSummary | null
  ledger: SellerLedgerEntry[]
}) {
  const { t } = useTranslation()
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 md:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardDescription>{t('Pending')}</CardDescription>
            <CardTitle>
              {formatQuota(props.stats?.pending_quota || 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('Frozen')}</CardDescription>
            <CardTitle>{formatQuota(props.stats?.frozen_quota || 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('Settled')}</CardDescription>
            <CardTitle>
              {formatQuota(props.stats?.settled_total_quota || 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('Ledger')}</CardTitle>
          <CardDescription>
            {t('{{count}} orders', { count: props.stats?.sales_count || 0 })}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          {props.ledger.length === 0 && <p>{t('No entries yet')}</p>}
          {props.ledger.map((entry) => (
            <div key={entry.id} className='flex justify-between'>
              <span>
                {t(ledgerTypeLabels[entry.type] || entry.type)} ·{' '}
                {t(ledgerStatusLabels[entry.status] || entry.status)}
              </span>
              <span>{formatQuota(entry.amount)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

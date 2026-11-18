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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  Plus,
  Server,
  Trash2,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { MultiSelect } from '@/components/multi-select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getPricing } from '@/features/pricing/api'
import type { PricingModel } from '@/features/pricing/types'
import { getCurrencyLabel } from '@/lib/currency'
import { getEditableQuotaStep, parseQuotaFromDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  createSellerPackage,
  createSellerPackageVersion,
} from '../../token-package/api'
import type { TokenPackage, UserChannel } from '../../token-package/types'
import {
  buildChannelBindings,
  buildPackageEditorValues,
  channelsForModel,
  createBlankTier,
  MAX_PACKAGE_CHANNELS,
  MAX_PACKAGE_TIERS,
  versionForEditing,
  type PackageEditorValues,
} from '../lib'
import { getPackageEditorSchema } from '../schema'
import { PackageOfferPreview } from './package-offer-preview'

type EditorCheck = {
  key: string
  label: string
  passed: boolean
}

function isModelPriced(model: PricingModel): boolean {
  if (model.billing_mode === 'tiered_expr' && model.billing_expr?.trim()) {
    return true
  }
  if (model.quota_type === 1) {
    return Number(model.model_price) > 0
  }
  return Number(model.model_ratio) > 0
}

function isValidAmount(value: string): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

function isValidDays(value: string): boolean {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 3650
}

function EditorSection(props: {
  step: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className='space-y-4'>
      <div className='flex items-start gap-3'>
        <span className='bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
          {props.step}
        </span>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold'>{props.title}</h3>
          {props.description && (
            <p className='text-muted-foreground mt-1 text-xs leading-5'>
              {props.description}
            </p>
          )}
        </div>
      </div>
      {props.children}
    </section>
  )
}

function CheckRow(props: { check: EditorCheck }) {
  const Icon = props.check.passed ? CheckCircle2 : Circle
  return (
    <li className='flex items-start gap-2 text-xs'>
      <Icon
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          props.check.passed ? 'text-success' : 'text-muted-foreground'
        )}
        aria-hidden='true'
      />
      <span className={cn(!props.check.passed && 'text-muted-foreground')}>
        {props.check.label}
      </span>
    </li>
  )
}

type PackageVersionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  packageData: TokenPackage | null
  channels: UserChannel[]
  onSaved: () => void
}

export function PackageVersionDialog(props: PackageVersionDialogProps) {
  const { t } = useTranslation()
  const loadedKeyRef = useRef('')
  const [createdPackageId, setCreatedPackageId] = useState<number | null>(null)
  const currencyLabel = getCurrencyLabel()
  const quotaStep = getEditableQuotaStep()
  const isCreating = props.packageData === null
  const editorSchema = useMemo(() => getPackageEditorSchema(t), [t])

  const form = useForm<PackageEditorValues>({
    resolver: zodResolver(editorSchema),
    defaultValues: buildPackageEditorValues(null, []),
    mode: 'onChange',
  })
  const tierRows = useFieldArray({ control: form.control, name: 'tiers' })
  const modelRows = useFieldArray({ control: form.control, name: 'models' })
  const values = form.watch()
  const sourceVersion = useMemo(
    () => versionForEditing(props.packageData),
    [props.packageData]
  )
  const sourceBindings = sourceVersion?.channels || []

  const pricingQuery = useQuery({
    queryKey: ['my-packages', 'model-pricing'],
    queryFn: getPricing,
    enabled: props.open,
    staleTime: 5 * 60 * 1000,
    retry: false,
    meta: { errorToast: false },
  })
  const pricingModels = useMemo(
    () => pricingQuery.data?.data || [],
    [pricingQuery.data]
  )
  const pricingKnown = pricingQuery.isSuccess && pricingModels.length > 0
  const pricedModelNames = useMemo(
    () =>
      new Set(
        pricingModels
          .filter((model) => isModelPriced(model))
          .map((model) => model.model_name)
      ),
    [pricingModels]
  )

  useEffect(() => {
    if (!props.open) {
      loadedKeyRef.current = ''
      return
    }
    const key = String(props.packageData?.id ?? 'new')
    if (loadedKeyRef.current === key) return

    loadedKeyRef.current = key
    form.reset(buildPackageEditorValues(props.packageData, props.channels))
    setCreatedPackageId(null)
  }, [props.open, props.packageData, props.channels, form])

  const selectedModels = useMemo(
    () => values.models.map((row) => row.model),
    [values.models]
  )
  const channelChoices = useMemo(
    () =>
      props.channels.filter(
        (channel) => channel.status === 1 && (channel.models || []).length > 0
      ),
    [props.channels]
  )
  const selectedChannels = useMemo(
    () =>
      channelChoices.filter((channel) =>
        values.channelIds.includes(channel.id)
      ),
    [channelChoices, values.channelIds]
  )
  const coverageByModel = useMemo(() => {
    const coverage = new Map<string, UserChannel[]>()
    for (const model of selectedModels) {
      coverage.set(
        model,
        channelsForModel(props.channels, model, values.channelIds)
      )
    }
    return coverage
  }, [props.channels, selectedModels, values.channelIds])

  const modelOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const channel of selectedChannels) {
      for (const model of channel.models || []) {
        counts.set(model, (counts.get(model) || 0) + 1)
      }
    }
    for (const model of selectedModels) {
      if (!counts.has(model)) counts.set(model, 0)
    }
    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([model, count]) => ({
        value: model,
        label: model,
        hint:
          count > 0
            ? t('{{count}} channels', { count })
            : t('No selected channel'),
      }))
  }, [selectedChannels, selectedModels, t])

  const missingPricing = pricingKnown
    ? selectedModels.filter((model) => !pricedModelNames.has(model))
    : []
  const modelsWithoutChannels = selectedModels.filter(
    (model) => (coverageByModel.get(model) || []).length === 0
  )
  const validTiers = values.tiers.filter(
    (tier) =>
      tier.title.trim() &&
      isValidAmount(tier.price) &&
      isValidAmount(tier.credit) &&
      isValidDays(tier.validDays)
  )
  const checks: EditorCheck[] = [
    {
      key: 'title',
      label: t('Product name is complete'),
      passed: values.title.trim().length > 0,
    },
    {
      key: 'tiers',
      label: t('Every tier has a name, price, credit, and validity'),
      passed:
        values.tiers.length > 0 && validTiers.length === values.tiers.length,
    },
    {
      key: 'channels',
      label: t('Select at least one supply channel'),
      passed: selectedChannels.length > 0,
    },
    {
      key: 'channel-limit',
      label: t('At most {{count}} supply channels are used', {
        count: MAX_PACKAGE_CHANNELS,
      }),
      passed: selectedChannels.length <= MAX_PACKAGE_CHANNELS,
    },
    {
      key: 'models',
      label: t('At least one model is selected'),
      passed: values.models.length > 0,
    },
    {
      key: 'coverage',
      label: t('Every selected model has a selected supply channel'),
      passed: values.models.length > 0 && modelsWithoutChannels.length === 0,
    },
  ]
  if (pricingKnown) {
    checks.push({
      key: 'pricing',
      label: t('Every selected model has a platform price'),
      passed: missingPricing.length === 0,
    })
  }

  const canSubmit =
    checks.every((check) => check.passed) &&
    editorSchema.safeParse(values).success &&
    !pricingQuery.isLoading

  const saveMutation = useMutation({
    mutationFn: async (formValues: PackageEditorValues) => {
      let packageId = props.packageData?.id || createdPackageId
      if (!packageId) {
        const createResponse = await createSellerPackage({
          title: formValues.title.trim(),
          subtitle: formValues.subtitle.trim(),
        })
        if (!createResponse.success || !createResponse.data?.id) {
          throw createServerError(
            createResponse,
            t('The package could not be created')
          )
        }
        packageId = createResponse.data.id
        setCreatedPackageId(packageId)
        props.onSaved()
      }

      const modelNames = formValues.models.map((row) => row.model)
      const versionResponse = await createSellerPackageVersion(packageId, {
        models: formValues.models.map((row) => ({
          model: row.model,
          multiplier: Number(row.multiplier),
        })),
        skus: formValues.tiers.map((tier) => ({
          sku_key: tier.skuKey,
          title: tier.title.trim(),
          price_quota: parseQuotaFromDollars(Number(tier.price)),
          credit_quota: parseQuotaFromDollars(Number(tier.credit)),
          valid_days: Number(tier.validDays),
        })),
        channels: buildChannelBindings(
          props.channels,
          modelNames,
          formValues.channelIds,
          sourceBindings
        ),
      })
      if (!versionResponse.success) {
        throw createServerError(
          versionResponse,
          t('The version could not be submitted')
        )
      }
    },
    onSuccess: () => {
      toast.success(
        t(
          'Version submitted. The connection check is running in the background.'
        )
      )
      props.onOpenChange(false)
      props.onSaved()
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const submit = form.handleSubmit((formValues) => {
    if (selectedChannels.length === 0) {
      toast.error(t('Select at least one supply channel'))
      return
    }
    if (modelsWithoutChannels.length > 0) {
      toast.error(t('Every selected model needs a selected supply channel'))
      return
    }
    if (selectedChannels.length > MAX_PACKAGE_CHANNELS) {
      toast.error(
        t('A package can bind at most {{count}} channels', {
          count: MAX_PACKAGE_CHANNELS,
        })
      )
      return
    }
    if (missingPricing.length > 0) {
      toast.error(
        t('Configure the platform price for {{models}} before submitting', {
          models: missingPricing.join(', '),
        })
      )
      return
    }
    saveMutation.mutate(formValues)
  })

  const changeModels = (nextModels: string[]) => {
    const existing = new Map(
      form.getValues('models').map((row) => [row.model, row.multiplier])
    )
    modelRows.replace(
      nextModels.map((model) => ({
        model,
        multiplier: existing.get(model) || '1',
      }))
    )
  }

  const toggleChannel = (channelId: number, checked: boolean) => {
    const current = form.getValues('channelIds')
    if (checked) {
      if (current.includes(channelId)) return
      if (current.length >= MAX_PACKAGE_CHANNELS) {
        toast.error(
          t('A package can bind at most {{count}} channels', {
            count: MAX_PACKAGE_CHANNELS,
          })
        )
        return
      }
      form.setValue('channelIds', [...current, channelId], {
        shouldDirty: true,
        shouldValidate: true,
      })
    } else {
      form.setValue(
        'channelIds',
        current.filter((id) => id !== channelId),
        {
          shouldDirty: true,
          shouldValidate: true,
        }
      )
    }
  }

  const selectAllChannels = () => {
    if (channelChoices.length > MAX_PACKAGE_CHANNELS) {
      toast.error(
        t('A package can bind at most {{count}} channels', {
          count: MAX_PACKAGE_CHANNELS,
        })
      )
      return
    }
    form.setValue(
      'channelIds',
      channelChoices.map((channel) => channel.id),
      {
        shouldDirty: true,
        shouldValidate: true,
      }
    )
  }

  const clearChannels = () => {
    form.setValue('channelIds', [], {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  const closeDialog = (open: boolean) => {
    if (!open && saveMutation.isPending) return
    props.onOpenChange(open)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={closeDialog}
      title={
        isCreating
          ? t('Create a package')
          : t('New version for {{title}}', {
              title: props.packageData?.title || '',
            })
      }
      description={
        isCreating
          ? t('Design the offer buyers see. You can refine it later.')
          : t(
              'Only future buyers see this version. Existing purchases stay unchanged.'
            )
      }
      contentClassName='sm:max-w-5xl'
      contentHeight='min(78dvh, 50rem)'
      footer={
        <>
          <Button
            variant='outline'
            disabled={saveMutation.isPending}
            onClick={() => closeDialog(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='package-version-form'
            disabled={!canSubmit || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className='animate-spin' />
            ) : (
              <Zap />
            )}
            {t('Start connection check')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]'>
          <form
            id='package-version-form'
            className='min-w-0 space-y-7'
            onSubmit={submit}
          >
            {createdPackageId && (
              <Alert variant='warning'>
                <AlertCircle />
                <AlertTitle>{t('The package has been created')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'The version still needs to be submitted. Fix any issues and start the connection check again.'
                  )}
                </AlertDescription>
              </Alert>
            )}

            {isCreating && (
              <EditorSection
                step='1'
                title={t('Product information')}
                description={t('This is what buyers see in the market.')}
              >
                <div className='space-y-4'>
                  <FormField
                    control={form.control}
                    name='title'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('Package title')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            maxLength={128}
                            placeholder={t('A clear name for your package')}
                            disabled={Boolean(createdPackageId)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='subtitle'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Short selling point')}</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={2}
                            maxLength={256}
                            placeholder={t(
                              'One sentence that helps buyers understand the value.'
                            )}
                            disabled={Boolean(createdPackageId)}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Optional. Shown on the marketplace card.')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </EditorSection>
            )}

            <EditorSection
              step={isCreating ? '2' : '1'}
              title={t('Package tiers')}
              description={t(
                'Each tier is a price, a credit amount, and a validity period.'
              )}
            >
              <div className='space-y-3'>
                {tierRows.fields.map((tier, index) => {
                  const current = form.getValues(`tiers.${index}`)
                  const tierSummary =
                    current.title.trim() &&
                    isValidAmount(current.price) &&
                    isValidAmount(current.credit) &&
                    isValidDays(current.validDays)
                      ? t(
                          'Buyers pay {{price}} and receive {{credit}} credit, valid for {{days}} days.',
                          {
                            price: t('{{currency}} {{amount}}', {
                              currency: currencyLabel,
                              amount: current.price,
                            }),
                            credit: t('{{currency}} {{amount}}', {
                              currency: currencyLabel,
                              amount: current.credit,
                            }),
                            days: current.validDays,
                          }
                        )
                      : null

                  return (
                    <div
                      key={tier.id}
                      className='bg-card rounded-xl border p-3 shadow-xs'
                    >
                      <div className='mb-3 flex items-center justify-between gap-2'>
                        <p className='text-sm font-medium'>
                          {t('Tier {{index}}', { index: index + 1 })}
                        </p>
                        <div className='flex items-center gap-1'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            aria-label={t('Duplicate tier')}
                            onClick={() =>
                              tierRows.insert(index + 1, {
                                ...current,
                                skuKey: createBlankTier().skuKey,
                              })
                            }
                          >
                            <Copy />
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            aria-label={t('Remove tier')}
                            onClick={() => tierRows.remove(index)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      <div className='grid gap-3 sm:grid-cols-3'>
                        <FormField
                          control={form.control}
                          name={
                            `tiers.${index}.title` as FieldPath<PackageEditorValues>
                          }
                          render={({ field }) => (
                            <FormItem className='sm:col-span-3'>
                              <FormLabel required>{t('Tier name')}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value as string}
                                  maxLength={128}
                                  placeholder={t('Basic')}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={
                            `tiers.${index}.price` as FieldPath<PackageEditorValues>
                          }
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel required>
                                {t('Price ({{currency}})', {
                                  currency: currencyLabel,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value as string}
                                  type='number'
                                  min='0'
                                  step={quotaStep}
                                  placeholder='0.00'
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={
                            `tiers.${index}.credit` as FieldPath<PackageEditorValues>
                          }
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel required>
                                {t('Credit ({{currency}})', {
                                  currency: currencyLabel,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value as string}
                                  type='number'
                                  min='0'
                                  step={quotaStep}
                                  placeholder='0.00'
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={
                            `tiers.${index}.validDays` as FieldPath<PackageEditorValues>
                          }
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel required>{t('Valid days')}</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value as string}
                                  type='number'
                                  min='1'
                                  max='3650'
                                  step='1'
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      {tierSummary && (
                        <p className='bg-muted/60 text-muted-foreground mt-3 rounded-lg px-3 py-2 text-xs'>
                          {tierSummary}
                        </p>
                      )}
                    </div>
                  )
                })}
                <Button
                  type='button'
                  variant='outline'
                  className='w-full border-dashed'
                  disabled={tierRows.fields.length >= MAX_PACKAGE_TIERS}
                  onClick={() => tierRows.append(createBlankTier())}
                >
                  <Plus />
                  {t('Add tier')}
                </Button>
              </div>
            </EditorSection>

            <EditorSection
              step={isCreating ? '3' : '2'}
              title={t('Channels and models')}
              description={t(
                'Choose supply channels first, then pick the models they can serve.'
              )}
            >
              <div className='space-y-5'>
                <div className='space-y-3'>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      <p className='text-sm font-medium'>
                        {t('Supply channels')}
                      </p>
                      <p className='text-muted-foreground mt-1 text-xs leading-5'>
                        {t('Select the channels that can supply this package.')}
                      </p>
                    </div>
                    <div className='flex items-center gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        disabled={
                          channelChoices.length === 0 ||
                          selectedChannels.length === channelChoices.length
                        }
                        onClick={selectAllChannels}
                      >
                        {t('Select all')}
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        disabled={values.channelIds.length === 0}
                        onClick={clearChannels}
                      >
                        {t('Clear')}
                      </Button>
                    </div>
                  </div>

                  {channelChoices.length > 0 ? (
                    <>
                      <div className='flex flex-wrap items-center gap-2 text-xs'>
                        <Badge variant='secondary'>
                          {t('{{count}} channels selected', {
                            count: selectedChannels.length,
                          })}
                        </Badge>
                        <span className='text-muted-foreground'>
                          {t(
                            'The connection check runs against channels that serve a selected model.'
                          )}
                        </span>
                      </div>
                      <div className='space-y-2'>
                        {channelChoices.map((channel) => {
                          const checked = values.channelIds.includes(channel.id)
                          const atLimit =
                            values.channelIds.length >= MAX_PACKAGE_CHANNELS
                          return (
                            <div
                              key={channel.id}
                              className={cn(
                                'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                                checked && 'border-primary/40 bg-primary/5'
                              )}
                            >
                              <Checkbox
                                id={`supply-channel-${channel.id}`}
                                checked={checked}
                                disabled={!checked && atLimit}
                                onCheckedChange={(next) =>
                                  toggleChannel(channel.id, next === true)
                                }
                              />
                              <div className='min-w-0 flex-1'>
                                <Label
                                  htmlFor={`supply-channel-${channel.id}`}
                                  className='block truncate'
                                >
                                  {channel.name}
                                </Label>
                                <p className='text-muted-foreground mt-1 truncate text-xs'>
                                  {channel.base_url}
                                </p>
                              </div>
                              <Badge variant='outline'>
                                {t('{{count}} models', {
                                  count: (channel.models || []).length,
                                })}
                              </Badge>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  ) : (
                    <Alert variant='warning'>
                      <Server />
                      <AlertTitle>{t('No usable channels')}</AlertTitle>
                      <AlertDescription>
                        {t(
                          'Enable a channel and add models before building this package.'
                        )}{' '}
                        <Link to='/my-channels' className='underline'>
                          {t('My channels')}
                        </Link>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className='space-y-3 border-t pt-5'>
                  <div className='space-y-2'>
                    <Label htmlFor='package-models'>{t('Models')}</Label>
                    <p className='text-muted-foreground text-xs leading-5'>
                      {selectedChannels.length > 0
                        ? t(
                            'Only models available in the selected channels are shown.'
                          )
                        : t('Select supply channels to see their models.')}
                    </p>
                    <MultiSelect
                      id='package-models'
                      options={modelOptions}
                      selected={selectedModels}
                      onChange={changeModels}
                      placeholder={t('Search models')}
                      emptyText={t('No models available')}
                      maxVisibleChips={6}
                      disabled={
                        selectedChannels.length === 0 &&
                        selectedModels.length === 0
                      }
                    />
                  </div>

                  {modelsWithoutChannels.length > 0 && (
                    <Alert variant='warning'>
                      <AlertCircle />
                      <AlertTitle>
                        {t('Some selected models have no supply channel')}
                      </AlertTitle>
                      <AlertDescription>
                        {t(
                          'Select a channel that provides them or remove those models before submitting.'
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  {modelRows.fields.map((row, index) => {
                    const coverage = coverageByModel.get(row.model) || []
                    const missingPrice =
                      pricingKnown && !pricedModelNames.has(row.model)
                    return (
                      <div
                        key={row.id}
                        className='bg-card rounded-xl border p-3 shadow-xs'
                      >
                        <div className='flex items-start justify-between gap-3'>
                          <div className='min-w-0'>
                            <p className='truncate text-sm font-medium'>
                              {row.model}
                            </p>
                            <div className='mt-1.5 flex flex-wrap gap-1.5'>
                              {coverage.length > 0 ? (
                                <>
                                  <Badge variant='info'>
                                    {t('{{count}} channels', {
                                      count: coverage.length,
                                    })}
                                  </Badge>
                                  {coverage.slice(0, 3).map((channel) => (
                                    <Badge
                                      key={channel.id}
                                      variant='outline'
                                      className='font-normal'
                                    >
                                      {channel.name}
                                    </Badge>
                                  ))}
                                  {coverage.length > 3 && (
                                    <Badge variant='secondary'>
                                      +{coverage.length - 3}
                                    </Badge>
                                  )}
                                </>
                              ) : (
                                <Badge variant='destructive'>
                                  {t('No selected channel')}
                                </Badge>
                              )}
                              {missingPrice && (
                                <Badge variant='warning'>
                                  {t('Price not configured')}
                                </Badge>
                              )}
                            </div>
                            {coverage.length === 0 && (
                              <p className='text-destructive mt-2 text-xs'>
                                {t(
                                  'Select a supply channel that provides this model or remove it.'
                                )}
                              </p>
                            )}
                          </div>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon-sm'
                            aria-label={t('Remove model {{model}}', {
                              model: row.model,
                            })}
                            onClick={() => modelRows.remove(index)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <div className='mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-start'>
                          <div className='text-muted-foreground space-y-1 text-xs leading-5'>
                            <p>{t('Price ratio')}</p>
                            <p>
                              {t(
                                '1 means the platform price. Below 1 is a discount; above 1 is a markup.'
                              )}
                            </p>
                            {missingPrice && (
                              <p className='text-destructive'>
                                {t(
                                  'Ask an administrator to configure this model price before buyers can use it.'
                                )}
                              </p>
                            )}
                          </div>
                          <FormField
                            control={form.control}
                            name={
                              `models.${index}.multiplier` as FieldPath<PackageEditorValues>
                            }
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className='sr-only'>
                                  {t('Price ratio')}
                                </FormLabel>
                                <FormControl>
                                  <div className='relative'>
                                    <Input
                                      {...field}
                                      value={field.value as string}
                                      type='number'
                                      min='0'
                                      step='0.01'
                                      className='pr-9'
                                    />
                                    <span className='text-muted-foreground absolute inset-y-0 right-2.5 flex items-center text-xs'>
                                      ×
                                    </span>
                                  </div>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    )
                  })}

                  {selectedModels.length === 0 && (
                    <div className='text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm'>
                      {selectedChannels.length > 0
                        ? t(
                            'Pick models from the selected channels to start building the offer.'
                          )
                        : t('Select supply channels to see their models.')}
                    </div>
                  )}
                </div>
              </div>
            </EditorSection>
          </form>

          <aside className='min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start'>
            <PackageOfferPreview values={values} />
            <div className='bg-card rounded-xl border p-4 shadow-xs'>
              <p className='text-sm font-medium'>{t('Before you submit')}</p>
              <p className='text-muted-foreground mt-1 text-xs leading-5'>
                {t(
                  'The connection check runs before this version goes to review.'
                )}
              </p>
              <ul className='mt-3 space-y-2'>
                {checks.map((check) => (
                  <CheckRow key={check.key} check={check} />
                ))}
              </ul>
            </div>
            <p className='text-muted-foreground text-xs leading-5'>
              {t(
                'Submitted versions are checked against every selected channel. Existing buyers keep their current offer.'
              )}
            </p>
          </aside>
        </div>
      </Form>
    </Dialog>
  )
}

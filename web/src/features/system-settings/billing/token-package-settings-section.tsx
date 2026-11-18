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
import i18next from 'i18next'
import type { Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

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
import { Switch } from '@/components/ui/switch'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { FormNavigationGuard } from '../components/form-navigation-guard'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsFormGridItem,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'

function commaListSchema() {
  return z.string()
}

const tokenPackageSchema = z.object({
  token_package_setting: z.object({
    enabled: z.boolean(),
    admin_skip_review: z.boolean(),
    commission_bps: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .min(0)
      .max(10000),
    freeze_days: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .min(0)
      .max(365),
    multiplier_min: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .positive(),
    multiplier_max: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .positive(),
    low_balance_ratio: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .min(0)
      .max(1),
    probe_minutes: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .min(1),
    outage_threshold_minutes: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .min(1),
    auto_terminate_hours: z.coerce
      .number({ error: () => i18next.t('Please enter a valid number') })
      .min(1),
    seller_groups: commaListSchema(),
    allowed_channel_types: commaListSchema(),
  }),
})

type TokenPackageFormValues = z.infer<typeof tokenPackageSchema>

export type TokenPackageSettingsDefaults = {
  enabled: boolean
  admin_skip_review: boolean
  commission_bps: number
  freeze_days: number
  multiplier_min: number
  multiplier_max: number
  low_balance_ratio: number
  probe_minutes: number
  outage_threshold_minutes: number
  auto_terminate_hours: number
  seller_groups: string[]
  allowed_channel_types: number[]
}

type TokenPackageSettingsSectionProps = {
  defaultValues: TokenPackageSettingsDefaults
}

export function TokenPackageSettingsSection({
  defaultValues,
}: TokenPackageSettingsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const { form, handleSubmit, isDirty, isSubmitting } =
    useSettingsForm<TokenPackageFormValues>({
      resolver: zodResolver(tokenPackageSchema) as Resolver<
        TokenPackageFormValues,
        unknown,
        TokenPackageFormValues
      >,
      defaultValues: {
        token_package_setting: {
          enabled: defaultValues.enabled,
          admin_skip_review: defaultValues.admin_skip_review,
          commission_bps: defaultValues.commission_bps,
          freeze_days: defaultValues.freeze_days,
          multiplier_min: defaultValues.multiplier_min,
          multiplier_max: defaultValues.multiplier_max,
          low_balance_ratio: defaultValues.low_balance_ratio,
          probe_minutes: defaultValues.probe_minutes,
          outage_threshold_minutes: defaultValues.outage_threshold_minutes,
          auto_terminate_hours: defaultValues.auto_terminate_hours,
          seller_groups: defaultValues.seller_groups.join(','),
          allowed_channel_types: defaultValues.allowed_channel_types.join(','),
        },
      },
      onSubmit: async (_data, changedFields) => {
        for (const [key, rawValue] of Object.entries(changedFields)) {
          let value = rawValue as string | number | boolean
          if (key.endsWith('.seller_groups')) {
            value = JSON.stringify(
              String(rawValue)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            )
          }
          if (key.endsWith('.allowed_channel_types')) {
            value = JSON.stringify(
              String(rawValue)
                .split(',')
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isInteger(item))
            )
          }
          await updateOption.mutateAsync({ key, value })
        }
      },
    })

  return (
    <SettingsSection title={t('Token Package Marketplace')}>
      <FormNavigationGuard when={isDirty} />
      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit}>
          <SettingsPageFormActions
            onSave={handleSubmit}
            isSaving={updateOption.isPending || isSubmitting}
          />
          <FormDirtyIndicator isDirty={isDirty} />
          <SettingsFormGrid>
            <SettingsFormGridItem>
              <FormField
                control={form.control}
                name='token_package_setting.enabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Enable marketplace')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Allow verified sellers to publish token packages.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
            </SettingsFormGridItem>

            <SettingsFormGridItem>
              <FormField
                control={form.control}
                name='token_package_setting.admin_skip_review'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Skip review for admins')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Admin submissions still run the connection check.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
            </SettingsFormGridItem>

            <FormField
              control={form.control}
              name='token_package_setting.commission_bps'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Commission (basis points)')}</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>
                    {t('1000 means the platform keeps 10% of each sale.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.freeze_days'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Payout freeze (days)')}</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Released revenue stays frozen for this many days before the seller can be paid.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.multiplier_min'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Minimum multiplier')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step='0.01'
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.multiplier_max'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Maximum multiplier')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step='0.01'
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.low_balance_ratio'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Low balance warning ratio')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step='0.01'
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.seller_groups'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Seller user groups')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='vip,svip' />
                  </FormControl>
                  <FormDescription>
                    {t('Comma-separated user groups allowed to publish.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.allowed_channel_types'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Allowed channel type IDs')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Leave empty to use the built-in standard protocol list.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.probe_minutes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Health probe interval (minutes)')}</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.outage_threshold_minutes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Outage threshold (minutes)')}</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='token_package_setting.auto_terminate_hours'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Auto terminate after (hours)')}</FormLabel>
                  <FormControl>
                    <Input type='number' {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'A package is terminated automatically after staying unavailable for this long.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}

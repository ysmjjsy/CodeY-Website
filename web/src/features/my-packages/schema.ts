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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import {
  MAX_PACKAGE_MODELS,
  MAX_PACKAGE_TIERS,
  type PackageEditorValues,
} from './lib'

const positiveAmount = (requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .refine(
      (value) => Number.isFinite(Number(value)) && Number(value) > 0,
      requiredMessage
    )

export type PackageDetailsValues = {
  title: string
  subtitle: string
  description: string
}

export function getPackageEditorSchema(t: TFunction) {
  const tierSchema = z.object({
    skuKey: z.string().trim().min(1, t('SKU key cannot be empty')),
    title: z
      .string()
      .trim()
      .min(1, t('Tier name is required'))
      .max(128, t('Tier name is too long')),
    price: positiveAmount(t('Enter a price greater than zero')),
    credit: positiveAmount(t('Enter a credit amount greater than zero')),
    validDays: z
      .string()
      .trim()
      .min(1, t('Validity must be between 1 and 3650 days'))
      .refine((value) => {
        const days = Number(value)
        return Number.isInteger(days) && days >= 1 && days <= 3650
      }, t('Validity must be between 1 and 3650 days')),
  })

  const modelSchema = z.object({
    model: z.string().trim().min(1, t('Select at least one model')),
    multiplier: positiveAmount(t('Enter a multiplier greater than zero')),
  })

  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1, t('Package title is required'))
        .max(128, t('Package title is too long')),
      subtitle: z.string().trim().max(256, t('Subtitle is too long')),
      tiers: z
        .array(tierSchema)
        .min(1, t('Add at least one tier'))
        .max(MAX_PACKAGE_TIERS, t('A package can offer at most 10 tiers')),
      models: z
        .array(modelSchema)
        .min(1, t('Select at least one model'))
        .max(MAX_PACKAGE_MODELS, t('A package can offer at most 50 models')),
      channelIds: z.array(z.number()),
    })
    .superRefine((values, ctx) => {
      const seenModels = new Set<string>()
      for (const [index, model] of values.models.entries()) {
        if (seenModels.has(model.model)) {
          ctx.addIssue({
            code: 'custom',
            path: ['models', index, 'model'],
            message: t('The same model cannot be added twice'),
          })
        }
        seenModels.add(model.model)
      }
    }) satisfies z.ZodType<PackageEditorValues>
}

export function getPackageDetailsSchema(t: TFunction) {
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, t('Package title is required'))
      .max(128, t('Package title is too long')),
    subtitle: z.string().trim().max(256, t('Subtitle is too long')),
    description: z.string().trim().max(4000, t('Description is too long')),
  }) satisfies z.ZodType<PackageDetailsValues>
}

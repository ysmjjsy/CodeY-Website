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
import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { updateSellerPackage } from '../../token-package/api'
import type { TokenPackage } from '../../token-package/types'
import { getPackageDetailsSchema, type PackageDetailsValues } from '../schema'

export function PackageDetailsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  packageData: TokenPackage | null
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const detailsSchema = useMemo(() => getPackageDetailsSchema(t), [t])
  const form = useForm<PackageDetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { title: '', subtitle: '', description: '' },
    mode: 'onChange',
  })

  useEffect(() => {
    if (!props.open) return
    form.reset({
      title: props.packageData?.title || '',
      subtitle: props.packageData?.subtitle || '',
      description: props.packageData?.description || '',
    })
  }, [props.open, props.packageData, form])

  const saveMutation = useMutation({
    mutationFn: async (values: PackageDetailsValues) => {
      if (!props.packageData) throw new Error(t('Package not found'))
      const response = await updateSellerPackage(props.packageData.id, {
        title: values.title,
        subtitle: values.subtitle,
        description: values.description,
      })
      if (!response.success) {
        throw createServerError(
          response,
          t('The product info could not be updated')
        )
      }
    },
    onSuccess: () => {
      toast.success(t('Product info updated'))
      props.onOpenChange(false)
      props.onSaved()
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const closeDialog = (open: boolean) => {
    if (!open && saveMutation.isPending) return
    props.onOpenChange(open)
  }
  const canSubmit = detailsSchema.safeParse(form.watch()).success

  return (
    <Dialog
      open={props.open}
      onOpenChange={closeDialog}
      title={t('Edit product info')}
      description={t('Update what buyers see in the marketplace.')}
      contentClassName='sm:max-w-2xl'
      contentHeight='auto'
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
            form='package-details-form'
            disabled={saveMutation.isPending || !canSubmit}
          >
            {saveMutation.isPending && <Loader2 className='animate-spin' />}
            {t('Save changes')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id='package-details-form'
          className='space-y-5'
          onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
        >
          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Package title')}</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={128} />
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
                  <Input {...field} maxLength={256} />
                </FormControl>
                <FormDescription>
                  {t('Optional. Shown on the marketplace card.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Description')}</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={5} maxLength={4000} />
                </FormControl>
                <FormDescription>
                  {t('Explain what is included and who the package is for.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}

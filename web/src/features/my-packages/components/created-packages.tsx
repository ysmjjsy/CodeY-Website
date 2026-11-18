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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PackagePlus, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  fetchAllMyChannels,
  fetchSellerPackages,
  relistSellerPackage,
  stopSellerPackage,
} from '../../token-package/api'
import type { TokenPackage } from '../../token-package/types'
import {
  CREATED_PACKAGES_QUERY_KEY,
  MY_PACKAGE_CHANNELS_QUERY_KEY,
} from '../lib'
import { CreatedPackageCard } from './created-package-card'
import { PackageDetailsDialog } from './package-details-dialog'
import { PackageDetailsDrawer } from './package-details-drawer'
import { PackageVersionDialog } from './package-version-dialog'

type EditorState =
  | { mode: 'create' }
  | { mode: 'version'; packageData: TokenPackage }

export function CreatedPackages() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [detailsId, setDetailsId] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [delistId, setDelistId] = useState<number | null>(null)

  const packagesQuery = useQuery({
    queryKey: CREATED_PACKAGES_QUERY_KEY,
    meta: { errorToast: false },
    queryFn: async () => {
      const response = await fetchSellerPackages()
      if (!response.success) {
        throw createServerError(response, t('Failed to load created packages'))
      }
      return response.data || []
    },
  })
  const channelsQuery = useQuery({
    queryKey: MY_PACKAGE_CHANNELS_QUERY_KEY,
    meta: { errorToast: false },
    queryFn: async () => {
      const response = await fetchAllMyChannels()
      if (!response.success) {
        throw createServerError(response, t('Failed to load channels'))
      }
      return response.data || []
    },
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: CREATED_PACKAGES_QUERY_KEY })

  const stopMutation = useMutation({
    mutationFn: async (packageId: number) => {
      const response = await stopSellerPackage(packageId)
      if (!response.success) {
        throw createServerError(response, t('The package could not be stopped'))
      }
    },
    onSuccess: () => {
      toast.success(t('Package delisted'))
      setDelistId(null)
      void refresh()
    },
    onError: (error) => {
      handleServerError(error)
    },
  })
  const relistMutation = useMutation({
    mutationFn: async (packageId: number) => {
      const response = await relistSellerPackage(packageId)
      if (!response.success) {
        throw createServerError(
          response,
          t('The package could not be relisted')
        )
      }
    },
    onSuccess: () => {
      toast.success(t('Package listed'))
      void refresh()
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  if (packagesQuery.isLoading || channelsQuery.isLoading) {
    return <LoadingState message={t('Loading token packages...')} />
  }
  if (packagesQuery.isError || channelsQuery.isError) {
    const error = packagesQuery.error || channelsQuery.error
    return (
      <ErrorState
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => {
          void packagesQuery.refetch()
          void channelsQuery.refetch()
        }}
      />
    )
  }

  const packages = packagesQuery.data || []
  const channels = channelsQuery.data || []
  const selectedPackage =
    packages.find((packageData) => packageData.id === detailsId) || null
  const editingPackage =
    packages.find((packageData) => packageData.id === editId) || null
  const delistingPackage =
    packages.find((packageData) => packageData.id === delistId) || null
  const busy = stopMutation.isPending || relistMutation.isPending

  return (
    <div className='space-y-4'>
      {packages.length > 0 && (
        <div className='flex justify-end'>
          <Button onClick={() => setEditor({ mode: 'create' })}>
            <Plus />
            {t('Create a package')}
          </Button>
        </div>
      )}

      {packages.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title={t('No packages yet')}
          description={t(
            'Build a package, choose the models it includes, and publish it to the token market.'
          )}
          action={
            <Button onClick={() => setEditor({ mode: 'create' })}>
              <Plus />
              {t('Create a package')}
            </Button>
          }
        />
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
          {packages.map((packageData) => (
            <CreatedPackageCard
              key={packageData.id}
              packageData={packageData}
              busy={busy}
              onDetails={() => setDetailsId(packageData.id)}
              onEdit={() => setEditId(packageData.id)}
              onOpenEditor={() => setEditor({ mode: 'version', packageData })}
              onDelist={() => setDelistId(packageData.id)}
              onRelist={() => relistMutation.mutate(packageData.id)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={delistId !== null}
        onOpenChange={(open) => {
          if (!open) setDelistId(null)
        }}
        title={t('Stop selling this package?')}
        desc={t(
          '{{name}} leaves the market. Buyers who already bought it keep using it until their credit runs out or expires.',
          { name: delistingPackage?.title || '' }
        )}
        destructive
        isLoading={stopMutation.isPending}
        handleConfirm={() => {
          if (delistId) stopMutation.mutate(delistId)
        }}
      />

      <PackageVersionDialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null)
        }}
        packageData={editor?.mode === 'version' ? editor.packageData : null}
        channels={channels}
        onSaved={() => void refresh()}
      />
      <PackageDetailsDrawer
        open={detailsId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsId(null)
        }}
        packageData={selectedPackage}
        onEdit={() => {
          if (!selectedPackage) return
          setDetailsId(null)
          setEditId(selectedPackage.id)
        }}
      />
      <PackageDetailsDialog
        open={editId !== null}
        onOpenChange={(open) => {
          if (!open) setEditId(null)
        }}
        packageData={editingPackage}
        onSaved={() => void refresh()}
      />
    </div>
  )
}

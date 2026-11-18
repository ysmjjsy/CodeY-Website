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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { SectionPageLayout } from '@/components/layout'
import { deleteMyChannel } from '@/features/token-package/api'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { MyChannelMutateDrawer } from './components/my-channel-mutate-drawer'
import { MyChannelTestDialog } from './components/my-channel-test-dialog'
import { MyChannelsPrimaryButtons } from './components/my-channels-primary-buttons'
import {
  MyChannelsProvider,
  useMyChannels,
} from './components/my-channels-provider'
import { MyChannelsTable } from './components/my-channels-table'
import { MY_CHANNELS_QUERY_KEY } from './lib'

function MyChannelsContent() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { deleteRow, setDeleteRow } = useMyChannels()

  const confirmDelete = async () => {
    if (!deleteRow) return
    try {
      const res = await deleteMyChannel(deleteRow.id)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The channel could not be deleted'))
        )
        return
      }
      toast.success(t('Channel deleted'))
      setDeleteRow(null)
      await queryClient.invalidateQueries({ queryKey: MY_CHANNELS_QUERY_KEY })
    } catch (error) {
      handleServerError(error, t('The channel could not be deleted'))
    }
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('My channels')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <MyChannelsPrimaryButtons />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <MyChannelsTable />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <MyChannelMutateDrawer />
      <MyChannelTestDialog />
      <ConfirmDialog
        open={deleteRow !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRow(null)
        }}
        title={t('Delete this channel?')}
        desc={t('{{name}} will be removed. This cannot be undone.', {
          name: deleteRow?.name || '',
        })}
        destructive
        handleConfirm={() => void confirmDelete()}
      />
    </>
  )
}

export function MyChannels() {
  return (
    <MyChannelsProvider>
      <MyChannelsContent />
    </MyChannelsProvider>
  )
}

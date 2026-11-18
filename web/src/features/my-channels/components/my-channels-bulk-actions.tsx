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
import type { Table } from '@tanstack/react-table'
import { Power, PowerOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { batchMyChannels } from '@/features/token-package/api'
import type { UserChannel } from '@/features/token-package/types'
import { handleServerError } from '@/lib/handle-server-error'
import {
  createServerError,
  translateServerText,
} from '@/lib/server-error-message'

import { MY_CHANNELS_QUERY_KEY } from '../lib'

type BatchAction = 'enable' | 'disable' | 'delete'

export function DataTableBulkActions<TData>({
  table,
}: {
  table: Table<TData>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<BatchAction | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const selectedIds = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => (row.original as UserChannel).id)

  const runAction = async (action: BatchAction) => {
    if (selectedIds.length === 0) {
      toast.warning(t('Select at least one channel'))
      return
    }
    setPending(action)
    try {
      const res = await batchMyChannels(action, selectedIds)
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The channel could not be updated'))
        )
        return
      }
      const result = res.data
      if (!result) return
      if (result.failed.length === 0) {
        toast.success(
          action === 'delete'
            ? t('Channels deleted successfully')
            : t('Updated successfully')
        )
      } else {
        toast.warning(
          result.succeeded.length > 0
            ? t('Some selected channels could not be updated')
            : t('The channel could not be updated'),
          {
            description: (
              <div className='space-y-1'>
                {result.failed.map((failure) => (
                  <p key={failure.id}>
                    {failure.name || `#${failure.id}`}:{' '}
                    {translateServerText(t, failure.message)}
                  </p>
                ))}
              </div>
            ),
          }
        )
      }
      table.resetRowSelection()
      setDeleteOpen(false)
      await queryClient.invalidateQueries({ queryKey: MY_CHANNELS_QUERY_KEY })
    } catch (error) {
      handleServerError(error, t('The channel could not be updated'))
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <BulkActionsToolbar table={table} entityName='channel'>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                disabled={pending !== null}
                onClick={() => void runAction('enable')}
                aria-label={t('Enable selected channels')}
              />
            }
          >
            <Power />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Enable selected channels')}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                disabled={pending !== null}
                onClick={() => void runAction('disable')}
                aria-label={t('Disable selected channels')}
              />
            }
          >
            <PowerOff />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Disable selected channels')}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='destructive'
                size='icon'
                className='size-8'
                disabled={pending !== null}
                onClick={() => setDeleteOpen(true)}
                aria-label={t('Delete selected channels')}
              />
            }
          >
            <Trash2 />
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Delete selected channels')}</p>
          </TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('Delete Channels?')}
        description={
          <>
            {t('Are you sure you want to delete')} {selectedIds.length}{' '}
            {t('channel(s)? This action cannot be undone.')}
          </>
        }
        contentHeight='auto'
        footer={
          <>
            <Button
              variant='outline'
              disabled={pending !== null}
              onClick={() => setDeleteOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={pending !== null}
              onClick={() => void runAction('delete')}
            >
              {t('Delete')}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  )
}

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
/* eslint-disable react-refresh/only-export-components */
import { useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  FlaskConical,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_CONFIG,
} from '@/features/channels/constants'
import { updateMyChannel } from '@/features/token-package/api'
import type { UserChannel } from '@/features/token-package/types'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import {
  MY_CHANNELS_QUERY_KEY,
  channelTypeLabel,
  isBoundChannel,
  parseModelList,
} from '../lib'
import { useMyChannels } from './my-channels-provider'

function MyChannelRowActions({ channel }: { channel: UserChannel }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { setOpen, setCurrentRow, setTestRow, setDeleteRow } = useMyChannels()
  const bound = isBoundChannel(channel)
  const autoDisabled = channel.status === CHANNEL_STATUS.AUTO_DISABLED

  const setStatus = async (status: number) => {
    try {
      const res = await updateMyChannel(channel.id, { status })
      if (!res.success) {
        handleServerError(
          createServerError(res, t('The channel could not be updated'))
        )
        return
      }
      toast.success(
        status === CHANNEL_STATUS.ENABLED
          ? t('Channel enabled successfully')
          : t('Channel disabled successfully')
      )
      await queryClient.invalidateQueries({
        queryKey: MY_CHANNELS_QUERY_KEY,
      })
    } catch (error) {
      handleServerError(error, t('The channel could not be updated'))
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant='ghost' size='icon' className='size-8' />}
        aria-label={t('More actions')}
      >
        <MoreHorizontal className='size-4' aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(channel)
            setOpen('edit')
          }}
        >
          <Pencil className='mr-2 size-4' aria-hidden />
          {t('Edit')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTestRow(channel)}>
          <FlaskConical className='mr-2 size-4' aria-hidden />
          {t('Test Connection')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {channel.status === CHANNEL_STATUS.ENABLED ? (
          <DropdownMenuItem
            onClick={() => void setStatus(CHANNEL_STATUS.MANUAL_DISABLED)}
          >
            <PowerOff className='mr-2 size-4' aria-hidden />
            {t('Disable')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={autoDisabled}
            onClick={() => void setStatus(CHANNEL_STATUS.ENABLED)}
          >
            <Power className='mr-2 size-4' aria-hidden />
            {t('Enable')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={bound}
          className='text-destructive focus:text-destructive'
          onClick={() => setDeleteRow(channel)}
        >
          <Trash2 className='mr-2 size-4' aria-hidden />
          {t('Delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function useMyChannelsColumns(options: {
  enableSelection: boolean
}): ColumnDef<UserChannel>[] {
  const { t } = useTranslation()

  return useMemo<ColumnDef<UserChannel>[]>(
    () => [
      ...(options.enableSelection
        ? [
            {
              id: 'select',
              header: ({ table }) => (
                <Checkbox
                  checked={table.getIsAllPageRowsSelected()}
                  indeterminate={table.getIsSomePageRowsSelected()}
                  onCheckedChange={(value) =>
                    table.toggleAllPageRowsSelected(!!value)
                  }
                  aria-label={t('Select all')}
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(value) => row.toggleSelected(!!value)}
                  aria-label={t('Select row')}
                />
              ),
              enableHiding: false,
              enableSorting: false,
              size: 40,
            } satisfies ColumnDef<UserChannel>,
          ]
        : []),
      {
        accessorKey: 'id',
        header: t('ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => <TableId value={row.original.id} />,
        size: 76,
      },
      {
        accessorKey: 'name',
        header: t('Name'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='min-w-0 space-y-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <span className='truncate font-medium'>{row.original.name}</span>
              {isBoundChannel(row.original) && (
                <Badge variant='secondary' className='shrink-0'>
                  {t('Bound to packages')}
                </Badge>
              )}
            </div>
            <p className='text-muted-foreground max-w-[28rem] truncate text-xs'>
              {row.original.base_url || '-'}
            </p>
          </div>
        ),
        size: 280,
      },
      {
        accessorKey: 'type',
        header: t('Type'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <div className='flex items-center gap-2'>
            <ChannelTypeLogo type={row.original.type} size={16} />
            <span>{t(channelTypeLabel(row.original.type))}</span>
          </div>
        ),
        size: 150,
      },
      {
        accessorKey: 'models',
        header: t('Models'),
        meta: { mobileHidden: true },
        cell: ({ row }) => {
          const models = parseModelList(row.original.models)
          if (models.length === 0) {
            return <span className='text-muted-foreground'>-</span>
          }
          return (
            <span className='text-muted-foreground block max-w-[22rem] truncate font-mono text-xs'>
              {models.join(', ')}
            </span>
          )
        },
        size: 260,
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => {
          const config =
            CHANNEL_STATUS_CONFIG[
              row.original.status as keyof typeof CHANNEL_STATUS_CONFIG
            ] || CHANNEL_STATUS_CONFIG[CHANNEL_STATUS.UNKNOWN]
          return (
            <StatusBadge
              label={t(config.label)}
              variant={config.variant}
              size='sm'
              copyable={false}
            />
          )
        },
        size: 120,
        enableSorting: false,
      },
      {
        accessorKey: 'priority',
        header: t('Priority'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='font-mono text-sm tabular-nums'>
            {row.original.priority}
          </span>
        ),
        size: 90,
        enableSorting: false,
      },
      {
        accessorKey: 'weight',
        header: t('Weight'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='font-mono text-sm tabular-nums'>
            {row.original.weight}
          </span>
        ),
        size: 90,
        enableSorting: false,
      },
      {
        id: 'actions',
        header: () => t('Actions'),
        cell: ({ row }) => <MyChannelRowActions channel={row.original} />,
        enableHiding: false,
        enableSorting: false,
        size: 72,
      },
    ],
    [options.enableSelection, t]
  )
}

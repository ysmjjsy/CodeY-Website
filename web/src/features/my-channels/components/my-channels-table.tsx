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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChannelTypeLogo } from '@/features/channels/components/channel-type-badge'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_OPTIONS,
  DEFAULT_PAGE_SIZE,
} from '@/features/channels/constants'
import { fetchMyChannels } from '@/features/token-package/api'
import { MARKETPLACE_CHANNEL_TYPES } from '@/features/token-package/marketplace-channel-types'
import type { UserChannel } from '@/features/token-package/types'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { MY_CHANNELS_QUERY_KEY, channelTypeLabel } from '../lib'
import { DataTableBulkActions } from './my-channels-bulk-actions'
import { useMyChannelsColumns } from './my-channels-columns'
import { useMyChannels } from './my-channels-provider'

const route = getRouteApi('/_authenticated/my-channels/')

function isDisabledChannel(channel: UserChannel) {
  return channel.status !== CHANNEL_STATUS.ENABLED
}

export function MyChannelsTable() {
  const { t } = useTranslation()
  const { batchMode } = useMyChannels()
  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: {
      defaultPage: 1,
      defaultPageSize: DEFAULT_PAGE_SIZE,
    },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: 'type', searchKey: 'type', type: 'array' },
      { columnId: 'bound', searchKey: 'bound', type: 'array' },
    ],
  })

  const statusFilter =
    (columnFilters.find((filter) => filter.id === 'status')?.value as
      | string[]
      | undefined) || []
  const typeFilter =
    (columnFilters.find((filter) => filter.id === 'type')?.value as
      | string[]
      | undefined) || []
  const boundFilter =
    (columnFilters.find((filter) => filter.id === 'bound')?.value as
      | string[]
      | undefined) || []

  const status = statusFilter.find((value) => value !== 'all')
  const type = typeFilter.find((value) => value !== 'all')
  const bound = boundFilter.find((value) => value !== 'all')

  const query = useQuery({
    queryKey: [
      ...MY_CHANNELS_QUERY_KEY,
      {
        keyword: globalFilter,
        status,
        type,
        bound,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      },
    ],
    queryFn: async () =>
      requireServerSuccess(
        await fetchMyChannels({
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          keyword: globalFilter,
          status,
          type: type ? Number(type) : undefined,
          bound,
        })
      ),
    placeholderData: (previous) => previous,
  })

  const channels = query.data?.data?.items || []
  const total = query.data?.data?.total || 0
  const columns = useMyChannelsColumns({ enableSelection: batchMode })

  const { table } = useDataTable({
    data: channels,
    columns,
    totalCount: total,
    pagination,
    globalFilter,
    columnFilters,
    enableRowSelection: batchMode,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    ensurePageInRange,
  })

  useEffect(() => {
    if (!batchMode) {
      table.resetRowSelection()
    }
  }, [batchMode, table])

  const typeOptions = [
    { label: t('All Types'), value: 'all' },
    ...MARKETPLACE_CHANNEL_TYPES.map((channelType) => ({
      label: t(channelTypeLabel(channelType)),
      value: String(channelType),
      iconNode: <ChannelTypeLogo type={channelType} size={16} />,
    })),
  ]

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      emptyTitle={t('No channels found')}
      emptyDescription={t(
        'No channels available. Create your first channel to get started.'
      )}
      skeletonKeyPrefix='my-channel-skeleton'
      toolbarProps={{
        collapsibleOnMobile: true,
        searchPlaceholder: t('Search channels by name or endpoint...'),
        searchDebounceMs: 400,
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: [...CHANNEL_STATUS_OPTIONS],
            singleSelect: true,
          },
          {
            columnId: 'type',
            title: t('Type'),
            options: typeOptions,
            singleSelect: true,
          },
          {
            columnId: 'bound',
            title: t('Binding'),
            options: [
              { label: t('All bindings'), value: 'all' },
              { label: t('Bound'), value: 'bound' },
              { label: t('Unbound'), value: 'unbound' },
            ],
            singleSelect: true,
          },
        ],
        preActions: (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => void query.refetch()}
                  aria-label={t('Refresh')}
                  aria-busy={query.isFetching}
                  className='text-muted-foreground hover:text-foreground size-8'
                />
              }
            >
              <RefreshCw
                aria-hidden
                className={cn(query.isFetching && 'animate-spin')}
              />
            </TooltipTrigger>
            <TooltipContent>{t('Refresh')}</TooltipContent>
          </Tooltip>
        ),
      }}
      getRowClassName={(row, { isMobile }) => {
        if (!isDisabledChannel(row.original)) return undefined
        return isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
      }}
      bulkActions={batchMode ? <DataTableBulkActions table={table} /> : null}
    />
  )
}

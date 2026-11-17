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
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'

import { listMarketplaceSources, updateMarketplaceSources } from '../api'
import { marketplaceSourceKind } from '../lib/marketplace'
import type { MarketplaceSource, MarketplaceSourceKind } from '../types'

type MarketplaceSourcesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Client-only identities keep edited inputs attached to their original row. */
type DraftRow = MarketplaceSource & { rowId: string }

export function MarketplaceSourcesDialog(props: MarketplaceSourcesDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<DraftRow[]>([])
  const [communityEnabled, setCommunityEnabled] = useState(false)
  const [services, setServices] = useState({
    short_codes_enabled: false,
    install_stats_enabled: false,
    remote_revocations_enabled: false,
  })
  const nextRowId = useRef(0)
  const sourcesQuery = useQuery({
    queryKey: ['task-plugin-marketplace-sources'],
    queryFn: listMarketplaceSources,
    enabled: props.open,
  })

  useEffect(() => {
    if (props.open && sourcesQuery.data) {
      setDraft(
        sourcesQuery.data.sources.map((source) => ({
          ...source,
          rowId: `row-${++nextRowId.current}`,
        }))
      )
      setCommunityEnabled(sourcesQuery.data.community_enabled === true)
      setServices({
        short_codes_enabled: sourcesQuery.data.short_codes_enabled === true,
        install_stats_enabled: sourcesQuery.data.install_stats_enabled === true,
        remote_revocations_enabled:
          sourcesQuery.data.remote_revocations_enabled === true,
      })
    }
  }, [props.open, sourcesQuery.data])

  const saveMutation = useMutation({
    mutationFn: updateMarketplaceSources,
    onSuccess: (saved) => {
      queryClient.setQueryData(['task-plugin-marketplace-sources'], saved)
      queryClient.invalidateQueries({ queryKey: ['task-plugin-marketplace'] })
      toast.success(t('Marketplace sources updated'))
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })
  const updateRow = (index: number, patch: Partial<MarketplaceSource>) => {
    setDraft((rows) =>
      rows.map((row, position) =>
        position === index ? { ...row, ...patch } : row
      )
    )
  }
  const invalidRow = draft.some(
    (row) => !row.name.trim() || !row.index_url.trim()
  )

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Marketplace sources')}
      description={t('The marketplace lists the plugins these sources offer.')}
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={
              invalidRow ||
              !sourcesQuery.data ||
              sourcesQuery.isError ||
              saveMutation.isPending
            }
            onClick={() =>
              saveMutation.mutate({
                sources: draft.map((row) => ({
                  name: row.name.trim(),
                  index_url: row.index_url.trim(),
                  kind: marketplaceSourceKind(row),
                })),
                community_enabled: communityEnabled,
                ...services,
              })
            }
          >
            {saveMutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <div className='space-y-3'>
        <div className='flex items-center gap-2'>
          <Switch
            id='marketplace-community-enabled'
            checked={communityEnabled}
            disabled={!sourcesQuery.data || saveMutation.isPending}
            onCheckedChange={setCommunityEnabled}
          />
          <Label htmlFor='marketplace-community-enabled'>
            {t('Enable community plugins')}
          </Label>
        </div>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Community sources are hidden and are not contacted while disabled.'
          )}
        </p>
        {(
          [
            ['short_codes_enabled', t('Enable plugin short codes')],
            ['install_stats_enabled', t('Show installation statistics')],
            [
              'remote_revocations_enabled',
              t('Enable remote revocation warnings'),
            ],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className='flex items-center gap-2'>
            <Switch
              id={`marketplace-${key}`}
              checked={services[key]}
              disabled={!sourcesQuery.data || saveMutation.isPending}
              onCheckedChange={(checked) =>
                setServices((current) => ({ ...current, [key]: checked }))
              }
            />
            <Label htmlFor={`marketplace-${key}`}>{label}</Label>
          </div>
        ))}
        <p className='text-muted-foreground text-sm'>
          {t(
            'Short code lookups and background revocation checks contact only enabled configured sources. Installation statistics are hidden and do not affect sorting while disabled.'
          )}
        </p>
        {draft.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No marketplace sources configured.')}
          </p>
        )}
        {draft.map((row, index) => (
          <div key={row.rowId} className='space-y-2 rounded-md border p-3'>
            <div className='flex items-center justify-between gap-2'>
              <Label htmlFor={`marketplace-source-name-${row.rowId}`}>
                {t('Source name')}
              </Label>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('Remove source {{name}}', {
                  name: row.name || row.index_url,
                })}
                onClick={() =>
                  setDraft((rows) =>
                    rows.filter((_, position) => position !== index)
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
            <Input
              id={`marketplace-source-name-${row.rowId}`}
              value={row.name}
              onChange={(event) =>
                updateRow(index, { name: event.target.value })
              }
            />
            <Label htmlFor={`marketplace-source-url-${row.rowId}`}>
              {t('Source address')}
            </Label>
            <Input
              id={`marketplace-source-url-${row.rowId}`}
              type='url'
              inputMode='url'
              value={row.index_url}
              placeholder='https://example.com/index.json'
              onChange={(event) =>
                updateRow(index, { index_url: event.target.value })
              }
            />
            <Label htmlFor={`marketplace-source-kind-${row.rowId}`}>
              {t('Source kind')}
            </Label>
            <NativeSelect
              id={`marketplace-source-kind-${row.rowId}`}
              value={marketplaceSourceKind(row)}
              onChange={(event) =>
                updateRow(index, {
                  kind: event.target.value as MarketplaceSourceKind,
                })
              }
            >
              <NativeSelectOption value='third_party'>
                {t('Third-party')}
              </NativeSelectOption>
              <NativeSelectOption value='official'>
                {t('CodeGuys trusted source')}
              </NativeSelectOption>
              <NativeSelectOption value='community'>
                {t('Community')}
              </NativeSelectOption>
            </NativeSelect>
          </div>
        ))}
        <Button
          variant='outline'
          onClick={() => {
            const rowId = `row-${++nextRowId.current}`
            setDraft((rows) => [
              ...rows,
              { name: '', index_url: '', kind: 'third_party', rowId },
            ])
          }}
        >
          <Plus />
          {t('Add source')}
        </Button>
        <p className='text-muted-foreground text-sm'>
          {t(
            'A CodeGuys trusted source is an address explicitly trusted by your administrator. No source is trusted by default.'
          )}
        </p>
        <Alert>
          <AlertTitle>{t('Third-party source risk')}</AlertTitle>
          <AlertDescription>
            {t(
              'Third-party sources are run by others. Read the plugin code before installing it.'
            )}
          </AlertDescription>
        </Alert>
      </div>
    </Dialog>
  )
}

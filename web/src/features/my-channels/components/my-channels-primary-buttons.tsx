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
import { ListChecks, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { useMyChannels } from './my-channels-provider'

export function MyChannelsPrimaryButtons() {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow, batchMode, setBatchMode } = useMyChannels()

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <div className='bg-muted/40 flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5'>
        <Label
          htmlFor='my-channels-batch-mode'
          className='cursor-pointer gap-1.5 text-xs whitespace-nowrap'
        >
          <ListChecks className='size-3.5' aria-hidden />
          {t('Batch Operations')}
        </Label>
        <Switch
          id='my-channels-batch-mode'
          size='sm'
          checked={batchMode}
          onCheckedChange={setBatchMode}
        />
      </div>
      <Button
        onClick={() => {
          setCurrentRow(null)
          setOpen('create')
        }}
      >
        <Plus className='size-4' />
        <span className='max-sm:hidden'>{t('Create Channel')}</span>
        <span className='sm:hidden'>{t('Create')}</span>
      </Button>
    </div>
  )
}

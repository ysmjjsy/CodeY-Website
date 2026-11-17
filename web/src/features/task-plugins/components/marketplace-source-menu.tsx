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
import { ChevronDown, Globe, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import type { MarketplaceSource } from '../types'

type MarketplaceSourceMenuProps = {
  sources: MarketplaceSource[]
  selected: MarketplaceSource
  onSelect: (source: MarketplaceSource) => void
  onManage: () => void
}

/** Switches between the catalogs configured on this gateway. */
export function MarketplaceSourceMenu(props: MarketplaceSourceMenuProps) {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            aria-label={t('Marketplace source')}
            className='max-w-full'
          />
        }
      >
        <Globe aria-hidden='true' />
        <span className='truncate'>{props.selected.name}</span>
        <ChevronDown aria-hidden='true' className='text-muted-foreground' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-auto min-w-56'>
        <DropdownMenuRadioGroup
          value={props.selected.index_url}
          onValueChange={(value) => {
            const source = props.sources.find(
              (item) => item.index_url === value
            )
            if (source) props.onSelect(source)
          }}
        >
          {props.sources.map((source) => (
            <DropdownMenuRadioItem
              closeOnClick
              key={source.index_url}
              value={source.index_url}
            >
              {source.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={props.onManage}>
          <Settings2 aria-hidden='true' />
          {t('Manage sources')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
import type { ReactNode } from 'react'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'

import type { ChannelConfigurationStatus } from '../../lib/channel-configuration'
import { ChannelConfigurationStatusIndicator } from './channel-configuration'

export function ChannelConfigurationCardHeading(props: {
  title: string
  icon?: ReactNode
  iconTone?: IconBadgeTone
  status?: ChannelConfigurationStatus
}) {
  return (
    <div className='flex items-center gap-3'>
      {props.icon && (
        <IconBadge tone={props.iconTone} size='md'>
          {props.icon}
        </IconBadge>
      )}
      <h3 className='min-w-0 flex-1 text-sm font-semibold tracking-tight'>
        {props.title}
      </h3>
      {props.status && (
        <ChannelConfigurationStatusIndicator status={props.status} />
      )}
    </div>
  )
}

export function ChannelConfigurationSubHeading(props: {
  title: string
  icon?: ReactNode
  iconTone?: IconBadgeTone
  status?: ChannelConfigurationStatus
}) {
  return (
    <div className='flex items-center gap-2'>
      {props.icon && (
        <IconBadge tone={props.iconTone} size='xs'>
          {props.icon}
        </IconBadge>
      )}
      <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        {props.title}
      </h4>
      {props.status && (
        <ChannelConfigurationStatusIndicator status={props.status} />
      )}
    </div>
  )
}

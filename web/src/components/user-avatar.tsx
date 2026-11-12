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
import { useMemo } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { cn } from '@/lib/utils'

export type UserAvatarUser = {
  username?: string
  display_name?: string
  avatar_url?: string
}

type UserAvatarProps = {
  user: UserAvatarUser | null | undefined
  className?: string
  fallbackClassName?: string
  fallbackText?: string
  alt?: string
}

export function UserAvatar(props: UserAvatarProps) {
  const name = props.user?.username || props.user?.display_name || '?'
  const fallback = props.fallbackText || getUserAvatarFallback(name)
  const fallbackStyle = useMemo(() => getUserAvatarStyle(name), [name])

  return (
    <Avatar className={props.className}>
      {props.user?.avatar_url ? (
        <AvatarImage
          src={props.user.avatar_url}
          alt={props.alt || props.user.display_name || name}
        />
      ) : null}
      <AvatarFallback
        className={cn('text-white', props.fallbackClassName)}
        style={fallbackStyle}
      >
        {fallback}
      </AvatarFallback>
    </Avatar>
  )
}

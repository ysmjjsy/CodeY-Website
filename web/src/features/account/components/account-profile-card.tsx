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
import {
  CalendarDays,
  Camera,
  Check,
  Fingerprint,
  Loader2,
  Mail,
  Pencil,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { UserAvatar } from '@/components/user-avatar'
import { useUserDisplay } from '@/hooks/use-user-display'
import { formatCompactNumber, formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { formatDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { updateUserProfile, uploadUserAvatar } from '../../profile/api'
import type { UserProfile } from '../../profile/types'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const AVATAR_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

type AccountProfileCardProps = {
  profile: UserProfile | null
  profileLoading: boolean
  onProfileUpdate: () => void
}

export function AccountProfileCard(props: AccountProfileCardProps) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const { displayName, roleLabel } = useUserDisplay(user)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingName) setNameDraft(displayName)
  }, [displayName, editingName])

  if (!user) {
    return <AccountProfileCardSkeleton />
  }

  const avatarURL = user.avatar_url || props.profile?.avatar_url
  const avatarUser = { ...user, avatar_url: avatarURL }
  const joinedAt =
    props.profile?.created_time && props.profile.created_time > 0
      ? formatDate(props.profile.created_time)
      : ''

  const startEditingName = () => {
    setNameDraft(displayName)
    setNameError('')
    setEditingName(true)
  }

  const cancelEditingName = () => {
    setEditingName(false)
    setNameError('')
    setNameDraft(displayName)
  }

  const saveDisplayName = async () => {
    const nextName = nameDraft.trim()
    if (!nextName) {
      setNameError(t('Display name is required'))
      return
    }
    if (nextName.length > 20) {
      setNameError(t('Display name must be 20 characters or fewer'))
      return
    }
    if (nextName === displayName) {
      cancelEditingName()
      return
    }

    setSavingName(true)
    try {
      const response = await updateUserProfile({ display_name: nextName })
      if (!response.success) {
        throw createServerError(response, t('Failed to update profile'))
      }
      const current = useAuthStore.getState().auth.user
      if (current) {
        useAuthStore
          .getState()
          .auth.setUser({ ...current, display_name: nextName })
      }
      props.onProfileUpdate()
      setEditingName(false)
      setNameError('')
      toast.success(t('Profile updated successfully'))
    } catch (error) {
      handleServerError(error, t('Failed to update profile'))
    } finally {
      setSavingName(false)
    }
  }

  const handleAvatarFile = async (file: File | undefined) => {
    if (!file) return
    if (!AVATAR_TYPES.has(file.type)) {
      toast.error(t('Unsupported image format'))
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('Image is too large'))
      return
    }

    setUploadingAvatar(true)
    try {
      const response = await uploadUserAvatar(file)
      const nextURL = response.data?.avatar_url
      if (!response.success || !nextURL) {
        throw createServerError(response, t('Failed to upload avatar'))
      }
      const current = useAuthStore.getState().auth.user
      if (current) {
        useAuthStore
          .getState()
          .auth.setUser({ ...current, avatar_url: nextURL })
      }
      props.onProfileUpdate()
      toast.success(t('Avatar updated'))
    } catch (error) {
      handleServerError(error, t('Failed to upload avatar'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardContent className='p-4 sm:p-5'>
        <div className='flex items-center gap-3 lg:flex-col lg:gap-3'>
          <Button
            type='button'
            variant='ghost'
            disabled={uploadingAvatar}
            aria-label={t('Upload avatar')}
            onClick={() => fileInputRef.current?.click()}
            className='group/button relative size-16 shrink-0 rounded-full p-0 hover:bg-transparent lg:size-32'
          >
            <UserAvatar
              user={avatarUser}
              alt={displayName}
              className='size-16 text-xl lg:size-32 lg:text-3xl'
              fallbackClassName='font-semibold'
            />
            <span
              aria-hidden='true'
              className={cn(
                'bg-foreground/45 text-background absolute inset-0 flex items-center justify-center rounded-full transition-opacity',
                uploadingAvatar
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100'
              )}
            >
              {uploadingAvatar ? (
                <Loader2 className='size-5 animate-spin' />
              ) : (
                <Camera className='size-5' />
              )}
            </span>
          </Button>
          <input
            ref={fileInputRef}
            type='file'
            aria-label={t('Upload avatar')}
            accept='image/png,image/jpeg,image/webp,image/gif'
            className='hidden'
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void handleAvatarFile(file)
            }}
          />

          <div className='min-w-0 flex-1 lg:w-full lg:flex-none lg:text-center'>
            {editingName ? (
              <div className='flex min-w-0 items-center gap-1.5 lg:justify-center'>
                <Input
                  autoFocus
                  value={nameDraft}
                  maxLength={20}
                  aria-label={t('Display Name')}
                  aria-invalid={nameError ? true : undefined}
                  disabled={savingName}
                  onChange={(event) => {
                    setNameDraft(event.target.value)
                    setNameError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveDisplayName()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelEditingName()
                    }
                  }}
                  className='h-8 min-w-0 flex-1 lg:w-48 lg:flex-none'
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  disabled={savingName}
                  aria-label={t('Save')}
                  onClick={() => void saveDisplayName()}
                >
                  {savingName ? (
                    <Loader2 className='animate-spin' />
                  ) : (
                    <Check />
                  )}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  disabled={savingName}
                  aria-label={t('Cancel')}
                  onClick={cancelEditingName}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <div className='flex min-w-0 items-center gap-1.5 lg:justify-center'>
                <h1 className='truncate text-lg font-semibold tracking-tight sm:text-xl lg:text-2xl'>
                  {displayName}
                </h1>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={t('Edit display name')}
                  onClick={startEditingName}
                >
                  <Pencil />
                </Button>
              </div>
            )}
            {nameError ? (
              <p className='text-destructive mt-1 text-xs' role='alert'>
                {nameError}
              </p>
            ) : null}

            <div className='text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs lg:justify-center lg:text-sm'>
              <span className='max-w-full truncate'>@{user.username}</span>
              {roleLabel ? (
                <>
                  <span aria-hidden='true'>·</span>
                  <StatusBadge
                    label={roleLabel}
                    variant='neutral'
                    copyable={false}
                  />
                </>
              ) : null}
              {user.group ? (
                <>
                  <span aria-hidden='true'>·</span>
                  <span className='truncate'>{String(user.group)}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <Separator className='my-4 hidden lg:block' />

        <div className='hidden space-y-2.5 text-sm lg:block'>
          {user.email ? (
            <div className='flex min-w-0 items-center gap-2'>
              <Mail className='text-muted-foreground size-3.5 shrink-0' />
              <span className='truncate' title={user.email}>
                {user.email}
              </span>
            </div>
          ) : null}
          <div className='flex min-w-0 items-center gap-2'>
            <UsersRound className='text-muted-foreground size-3.5 shrink-0' />
            <span className='text-muted-foreground'>{t('User Group')}</span>
            <span className='ml-auto truncate'>
              {String(user.group || '-')}
            </span>
          </div>
          <div className='flex min-w-0 items-center gap-2'>
            <Fingerprint className='text-muted-foreground size-3.5 shrink-0' />
            <span className='text-muted-foreground'>{t('User ID')}</span>
            <span className='ml-auto font-mono text-xs tabular-nums'>
              {user.id}
            </span>
            <CopyButton
              value={String(user.id)}
              size='icon'
              className='size-5'
              iconClassName='size-3'
              aria-label={t('Copy User ID')}
            />
          </div>
          {joinedAt ? (
            <div className='flex min-w-0 items-center gap-2'>
              <CalendarDays className='text-muted-foreground size-3.5 shrink-0' />
              <span className='text-muted-foreground'>{t('Joined')}</span>
              <span className='ml-auto tabular-nums'>{joinedAt}</span>
            </div>
          ) : null}
        </div>

        <Separator className='my-4 hidden lg:block' />

        <dl className='hidden space-y-2.5 text-sm lg:block'>
          <AccountStatRow
            label={t('Current Balance')}
            value={props.profile ? formatQuota(props.profile.quota) : '-'}
            loading={props.profileLoading}
          />
          <AccountStatRow
            label={t('Total Usage')}
            value={props.profile ? formatQuota(props.profile.used_quota) : '-'}
            loading={props.profileLoading}
          />
          <AccountStatRow
            label={t('API Requests')}
            value={
              props.profile
                ? formatCompactNumber(props.profile.request_count)
                : '-'
            }
            loading={props.profileLoading}
          />
        </dl>
      </CardContent>
    </Card>
  )
}

function AccountStatRow(props: {
  label: string
  value: string
  loading: boolean
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <dt className='text-muted-foreground'>{props.label}</dt>
      <dd className='font-mono font-medium tabular-nums'>
        {props.loading ? <Skeleton className='h-4 w-16' /> : props.value}
      </dd>
    </div>
  )
}

function AccountProfileCardSkeleton() {
  return (
    <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
      <CardContent className='flex items-center gap-3 p-4 sm:p-5 lg:flex-col lg:gap-3'>
        <Skeleton className='size-16 shrink-0 rounded-full lg:size-32' />
        <div className='flex-1 space-y-2 lg:flex lg:w-full lg:flex-col lg:items-center'>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='h-4 w-44' />
        </div>
      </CardContent>
    </Card>
  )
}

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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import type { VerificationState } from '../types'

type NoticeCopy = { title: string; description: string; action: string }

// Every state except "verified" blocks a purchase (D17); each one tells the
// buyer what to do next.
const NOTICE_COPY: Record<
  Exclude<VerificationState, 'verified'>,
  NoticeCopy
> = {
  unverified: {
    title: 'Real-name verification is required to buy',
    description: 'Verify your real name once before your first purchase.',
    action: 'Verify now',
  },
  pending: {
    title: 'Your real-name verification is under review',
    description:
      'You can buy packages once it is approved. You will be notified.',
    action: 'View status',
  },
  rejected: {
    title: 'Your real-name verification was rejected',
    description: 'Correct your details and submit again.',
    action: 'Submit again',
  },
}

type BuyerVerificationNoticeProps = {
  status: VerificationState
}

/** Explains why a buyer cannot purchase yet and links to the verification page. */
export function BuyerVerificationNotice(props: BuyerVerificationNoticeProps) {
  const { t } = useTranslation()
  if (props.status === 'verified') return null
  const copy = NOTICE_COPY[props.status]
  return (
    <Alert>
      <AlertTitle>{t(copy.title)}</AlertTitle>
      <AlertDescription className='flex flex-wrap items-center justify-between gap-2'>
        <span>{t(copy.description)}</span>
        <Button
          size='sm'
          variant='outline'
          render={
            <Link to='/account/$section' params={{ section: 'verification' }} />
          }
        >
          {t(copy.action)}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

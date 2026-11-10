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

import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { SignInMark } from '../sign-in/components/sign-in-mark'

/**
 * The dialog shared by sign-in, registration, and password reset. It stays
 * mounted while the visitor moves between the three, so only the right-hand
 * form changes; the coordinate paper and the mark do not redraw. On a narrow
 * screen the paper drops away and the mark shrinks above the form.
 */
export function AuthDialogFrame(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const systemName = useSystemConfigStore((state) => state.config.systemName)

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='gap-0 overflow-hidden p-0 sm:max-w-[720px]'>
        <div className='grid sm:grid-cols-[260px_1fr]'>
          {/* The homepage's coordinate paper, with one arc whose center sits
              off the panel, and the gateway's mark at rest. */}
          <div className='border-border relative hidden min-h-[460px] overflow-hidden border-r sm:block'>
            <div aria-hidden='true' className='hero-grid absolute inset-0' />
            <svg
              aria-hidden='true'
              className='text-border pointer-events-none absolute inset-0 h-full w-full'
              viewBox='0 0 260 480'
              preserveAspectRatio='xMidYMid slice'
              fill='none'
            >
              <circle
                cx='-120'
                cy='620'
                r='470'
                stroke='currentColor'
                strokeWidth='1'
                vectorEffect='non-scaling-stroke'
              />
            </svg>
            <div className='relative flex h-full flex-col items-center justify-center gap-4 px-6 py-10'>
              <SignInMark className='h-auto w-28' />
              <span className='text-sm font-semibold tracking-tight'>
                {systemName}
              </span>
            </div>
          </div>

          <div className='flex flex-col gap-4 p-6'>
            <SignInMark className='mx-auto h-auto w-16 sm:hidden' />
            {props.children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

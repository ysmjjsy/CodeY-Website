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
import { ArrowRight, Coins, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'

import { GatewayRoutes } from '../gateway-routes'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)

  const handleTopUp = () => {
    if (!props.isAuthenticated) {
      openAuthDialog('sign-up')
    }
  }

  return (
    <section className='relative overflow-hidden px-6 pt-24 pb-16 md:pt-28 md:pb-20'>
      <div
        aria-hidden='true'
        className='hero-grid pointer-events-none absolute inset-0'
      />
      {/* Two arcs, centers off the page, so only a segment of each shows.
          Same border color as the grid, no fill, and they do not move. */}
      <svg
        aria-hidden='true'
        className='text-border pointer-events-none absolute inset-0 h-full w-full'
        viewBox='0 0 1200 700'
        preserveAspectRatio='xMidYMid slice'
        fill='none'
      >
        <circle
          cx='-400'
          cy='-200'
          r='780'
          stroke='currentColor'
          strokeWidth='1'
          vectorEffect='non-scaling-stroke'
        />
        <circle
          cx='1600'
          cy='980'
          r='820'
          stroke='currentColor'
          strokeWidth='1'
          vectorEffect='non-scaling-stroke'
        />
      </svg>
      <div className='relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8'>
        <div className='flex flex-col items-start text-left lg:col-span-6'>
          <p className='text-muted-foreground mb-5 text-xs font-medium tracking-widest uppercase'>
            {t('CodeGuys · Model token market')}
          </p>

          <h1 className='text-[clamp(2.25rem,4.5vw,3.25rem)] leading-[1.12] font-bold tracking-tight'>
            {t('Every model, priced by the token')}
          </h1>
          <p className='text-muted-foreground mt-5 max-w-xl text-base leading-relaxed'>
            {t(
              'CodeGuys is a market for model tokens. Browse providers side by side, compare prices, top up once, and call them all through one API.'
            )}
          </p>

          <div className='mt-8 flex flex-wrap items-center gap-3'>
            <Button
              className='group h-11 rounded-lg px-5 text-sm font-medium'
              render={<Link to='/pricing' />}
            >
              <Store className='mr-1.5 size-4' />
              {t('Browse the market')}
              <ArrowRight className='ml-1.5 size-4 transition-transform duration-150 group-hover:translate-x-0.5' />
            </Button>
            {props.isAuthenticated ? (
              <Button
                variant='outline'
                className='h-11 rounded-lg px-5 text-sm font-medium'
                render={<Link to='/wallet' />}
              >
                <Coins className='mr-1.5 size-4' />
                {t('Top up credit')}
              </Button>
            ) : (
              <Button
                variant='outline'
                className='h-11 rounded-lg px-5 text-sm font-medium'
                onClick={handleTopUp}
              >
                <Coins className='mr-1.5 size-4' />
                {t('Top up credit')}
              </Button>
            )}
            <Button
              variant='ghost'
              className='h-11 rounded-lg px-5 text-sm font-medium'
              render={<Link to='/docs' />}
            >
              {t('Read the docs')}
            </Button>
          </div>
        </div>

        <div className='lg:col-span-6'>
          <GatewayRoutes />
        </div>
      </div>
    </section>
  )
}

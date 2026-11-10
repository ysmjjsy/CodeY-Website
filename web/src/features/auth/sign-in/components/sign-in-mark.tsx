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
import { useId } from 'react'

import { useSystemConfigStore } from '@/stores/system-config-store'

/**
 * The gateway's mark, at rest: a stroked hexagon with the logo's inner mark in
 * brand red. The same drawing as the homepage diagram's center, without the
 * routes or the travelling request.
 */

const CENTER = 60
const RADIUS = 46
const CLIP = 0.7

const HEXAGON = [0, 60, 120, 180, 240, 300]
  .map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return [CENTER + RADIUS * Math.cos(rad), CENTER + RADIUS * Math.sin(rad)]
  })
  .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  .join(' ')

export function SignInMark(props: { className?: string }) {
  const logo = useSystemConfigStore((state) => state.config.logo)
  const size = RADIUS * 2 * CLIP
  // Painted twice in the dialog, so each copy needs its own filter and clip.
  const markId = useId().replaceAll(':', '')
  const clipId = `${markId}-clip`
  const filterId = `${markId}-filter`

  return (
    <svg viewBox='0 0 120 120' className={props.className} aria-hidden='true'>
      <defs>
        <clipPath id={clipId}>
          <polygon
            points={HEXAGON}
            transform={`translate(${CENTER} ${CENTER}) scale(${CLIP}) translate(${-CENTER} ${-CENTER})`}
          />
        </clipPath>
        {/* The brand red drops out, so only the knocked-out mark survives, and
            only its edge is kept, drawn in the brand red. */}
        <filter id={filterId} colorInterpolationFilters='sRGB'>
          <feColorMatrix
            in='SourceGraphic'
            type='matrix'
            values='0 0 0 0 1  0 0 0 0 0  0 0 0 0 0  -1.45 1.15 1.15 0 0.88'
            result='mark'
          />
          <feMorphology in='mark' operator='erode' radius='3' result='core' />
          <feComposite in='mark' in2='core' operator='out' result='edge' />
          <feFlood floodColor='var(--primary)' result='paper' />
          <feComposite in='paper' in2='edge' operator='in' />
        </filter>
      </defs>
      <polygon
        points={HEXAGON}
        className='fill-background stroke-primary'
        strokeWidth={1.5}
      />
      <image
        href={logo}
        x={CENTER - size / 2}
        y={CENTER - size / 2}
        width={size}
        height={size}
        clipPath={`url(#${clipId})`}
        filter={`url(#${filterId})`}
        preserveAspectRatio='xMidYMid meet'
      />
    </svg>
  )
}

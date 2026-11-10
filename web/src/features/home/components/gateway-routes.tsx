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
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

/**
 * The gateway drawn as geometry: one empty hexagon, the lines that leave its
 * edge, and a single request travelling out and back. CodeY is the one cyan
 * line, so it reads as a product on the gateway rather than a second platform.
 *
 * At rest the lines are faint and the names sit bare. While a request is at an
 * endpoint that one route turns solid, gains a dot at each end, and its name
 * takes a box. With reduced motion nothing travels and nothing lights up; the
 * drawing shows its finished frame.
 */

const VIEW_WIDTH = 640
const VIEW_HEIGHT = 560
const CENTER = { x: 320, y: 292 }

/** How long one trip out and back takes, and how long the name stays lit. */
const TRIP_SECONDS = 3.6
const HOLD_SECONDS = 0.6

/** The hexagon is stroke only, so the radius has to clear its own stroke. */
const HEX_RADIUS = 58
const HEX_STROKE = 1.5
const DOT_RADIUS = 2.5

/**
 * The logo is a red hexagon with the mark knocked out in white, and the white
 * runs out to the canvas edge, so the mark cannot be told from the background
 * by color. The red is dropped instead: what is left is the mark plus the
 * corners, and the hexagon crop cuts the corners off.
 */
const LOGO_CLIP = 0.7
const LOGO_SIZE = HEX_RADIUS * 2 * LOGO_CLIP

type Endpoint = {
  id: string
  label: string
  x: number
  y: number
  /** CodeY, drawn in the product cyan instead of the brand red. */
  product?: boolean
}

/** Two rings, so the longer names never share an edge with a neighbour. */
const ENDPOINTS: Endpoint[] = [
  { id: 'openai', label: 'OpenAI', x: 196, y: 62 },
  { id: 'claude', label: 'Claude', x: 320, y: 44 },
  { id: 'gemini', label: 'Gemini', x: 444, y: 62 },
  { id: 'deepseek', label: 'DeepSeek', x: 92, y: 168 },
  { id: 'qwen', label: 'Qwen', x: 548, y: 168 },
  { id: 'codey', label: 'CodeY', x: 78, y: 300, product: true },
  { id: 'llama', label: 'Llama', x: 562, y: 300 },
  { id: 'mistral', label: 'Mistral', x: 104, y: 432 },
  { id: 'doubao', label: 'Doubao', x: 320, y: 516 },
  { id: 'grok', label: 'Grok', x: 536, y: 432 },
]

const HEXAGON = [0, 60, 120, 180, 240, 300]
  .map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return [
      CENTER.x + HEX_RADIUS * Math.cos(rad),
      CENTER.y + HEX_RADIUS * Math.sin(rad),
    ]
  })
  .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  .join(' ')

/**
 * Where a line meets the hexagon: the point on the edge that faces the
 * endpoint, pushed out by half the stroke so the line starts clean of it.
 */
function edgePoint(endpoint: Endpoint) {
  const dx = endpoint.x - CENTER.x
  const dy = endpoint.y - CENTER.y
  const distance = Math.hypot(dx, dy)
  const reach = (HEX_RADIUS + HEX_STROKE / 2) / distance
  return {
    x: (CENTER.x + dx * reach).toFixed(1),
    y: (CENTER.y + dy * reach).toFixed(1),
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

export function GatewayRoutes(props: { className?: string }) {
  const reduced = useReducedMotion()
  // The store, not the hook: the hook pulls in the query client, and this
  // drawing only needs the logo URL the status response already stored.
  const logo = useSystemConfigStore((state) => state.config.logo)
  const [visible, setVisible] = useState(false)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const frame = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.05 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The whole drawing leans toward the pointer, but never more than a few
  // pixels, and only while it is actually on screen.
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || !visible) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const next = {
      x: (event.clientX - bounds.left) / bounds.width - 0.5,
      y: (event.clientY - bounds.top) / bounds.height - 0.5,
    }
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => setPointer(next))
  }

  const offset = reduced || !visible ? { x: 0, y: 0 } : pointer
  const travelling = !reduced && visible
  // One request flies at a time, so the whole tour is one endpoint per trip.
  const tour = ENDPOINTS.length * TRIP_SECONDS

  return (
    <div
      ref={rootRef}
      className={cn('relative w-full', props.className)}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setPointer({ x: 0, y: 0 })}
    >
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className='h-auto w-full'
        role='img'
        aria-label='CodeGuys'
        style={{
          transform: `translate3d(${(offset.x * 12).toFixed(2)}px, ${(offset.y * 12).toFixed(2)}px, 0)`,
        }}
      >
        {ENDPOINTS.map((endpoint, index) => {
          const start = edgePoint(endpoint)
          const path = `M ${start.x} ${start.y} L ${endpoint.x} ${endpoint.y}`
          // The name lights for the moment the request is at the endpoint,
          // halfway through its own trip.
          const lit = travelling
            ? {
                animationDelay: `${index * TRIP_SECONDS + (TRIP_SECONDS - HOLD_SECONDS) / 2}s`,
                animationDuration: `${tour}s`,
              }
            : undefined
          return (
            <g key={endpoint.id}>
              {/* The faint line draws itself in; the solid line on top of it
                  appears only while the request is at this endpoint. Two lines,
                  because the drawing and the lighting run on different clocks. */}
              <line
                x1={start.x}
                y1={start.y}
                x2={endpoint.x}
                y2={endpoint.y}
                pathLength={1}
                className={cn(
                  'gateway-route-line',
                  endpoint.product && 'gateway-route-line-cyan'
                )}
                strokeWidth={1}
                style={{ animationDelay: `${0.9 + index * 0.12}s` }}
                data-reduced={reduced || undefined}
              />
              {travelling && (
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={endpoint.x}
                  y2={endpoint.y}
                  className={cn(
                    'gateway-route-lit',
                    endpoint.product && 'gateway-route-lit-cyan'
                  )}
                  strokeWidth={1}
                  style={lit}
                />
              )}
              {travelling && (
                <g>
                  <circle
                    cx={start.x}
                    cy={start.y}
                    r={DOT_RADIUS}
                    className={cn(
                      'gateway-route-dot',
                      endpoint.product && 'gateway-route-dot-cyan'
                    )}
                    style={lit}
                  />
                  <circle
                    cx={endpoint.x}
                    cy={endpoint.y}
                    r={DOT_RADIUS}
                    className={cn(
                      'gateway-route-dot',
                      endpoint.product && 'gateway-route-dot-cyan'
                    )}
                    style={lit}
                  />
                  <rect width={4} height={4} className='fill-primary'>
                    <animateMotion
                      dur={`${TRIP_SECONDS}s`}
                      begin={`${index * TRIP_SECONDS}s`}
                      repeatDur={`${tour}s`}
                      repeatCount='indefinite'
                      keyPoints='0;1;0'
                      keyTimes='0;0.5;1'
                      calcMode='linear'
                      path={path}
                    />
                  </rect>
                </g>
              )}
              <rect
                x={endpoint.x - 46}
                y={endpoint.y - 13}
                width={92}
                height={26}
                rx={4}
                className={cn(
                  'gateway-route-box',
                  endpoint.product && 'gateway-route-box-cyan'
                )}
                strokeWidth={1}
                style={lit}
                data-reduced={!travelling || undefined}
              />
              <text
                x={endpoint.x}
                y={endpoint.y + 4}
                textAnchor='middle'
                className={cn(
                  'gateway-route-name text-[13px] font-medium',
                  endpoint.product && 'gateway-route-name-cyan'
                )}
                style={lit}
                data-reduced={!travelling || undefined}
              >
                {endpoint.label}
              </text>
            </g>
          )
        })}

        {/* The logo is cropped to a hexagon smaller than the stroked one. The
            red drops out and only the mark's edge is kept, recolored to the
            brand red so it stays in the logo's color in both themes. */}
        <defs>
          <clipPath id='gateway-logo-clip'>
            <polygon
              points={HEXAGON}
              transform={`translate(${CENTER.x} ${CENTER.y}) scale(${LOGO_CLIP}) translate(${-CENTER.x} ${-CENTER.y})`}
            />
          </clipPath>
          {/* The brand red becomes transparent, so only the knocked-out mark
              survives; its edge is then drawn in the brand red. */}
          <filter id='gateway-logo-mark' colorInterpolationFilters='sRGB'>
            <feColorMatrix
              in='SourceGraphic'
              type='matrix'
              values='0 0 0 0 1  0 0 0 0 0  0 0 0 0 0  -1.45 1.15 1.15 0 0.88'
              result='mark'
            />
            {/* Keep only the mark's edge, so it reads as a line drawing like
                the hexagon around it instead of a solid blob. */}
            <feMorphology in='mark' operator='erode' radius='3' result='core' />
            <feComposite in='mark' in2='core' operator='out' result='edge' />
            <feFlood floodColor='var(--primary)' result='paper' />
            <feComposite in='paper' in2='edge' operator='in' />
          </filter>
        </defs>
        <polygon
          data-route-start
          points={HEXAGON}
          pathLength={1}
          className='gateway-route-hex stroke-primary'
          strokeWidth={HEX_STROKE}
          data-reduced={reduced || undefined}
        />
        <image
          href={logo}
          x={CENTER.x - LOGO_SIZE / 2}
          y={CENTER.y - LOGO_SIZE / 2}
          width={LOGO_SIZE}
          height={LOGO_SIZE}
          clipPath='url(#gateway-logo-clip)'
          filter='url(#gateway-logo-mark)'
          preserveAspectRatio='xMidYMid meet'
        />
        <text
          x={CENTER.x}
          y={CENTER.y + HEX_RADIUS + 22}
          textAnchor='middle'
          className='fill-foreground text-[13px] font-semibold tracking-tight'
        >
          CodeGuys
        </text>
      </svg>
    </div>
  )
}

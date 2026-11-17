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
import { useTranslation } from 'react-i18next'

import { getLobeIcon } from '@/lib/lobe-icon'

import { Check } from 'lucide-react'
import { TM_INPUT_ROUTES } from './tm-routes'

const NODES = [
  {
    cls: 'tm-node-claude',
    glyph: getLobeIcon('Claude.Color', 18),
    title: 'CLAUDE',
    titleKey: '',
    subKey: 'MODEL INPUT',
  },
  {
    cls: 'tm-node-openai',
    glyph: getLobeIcon('OpenAI.Color', 18),
    title: 'OPENAI',
    titleKey: '',
    subKey: 'MODEL INPUT',
  },
  {
    cls: 'tm-node-deepseek',
    glyph: getLobeIcon('DeepSeek.Color', 18),
    title: 'DEEPSEEK',
    titleKey: '',
    subKey: 'MODEL INPUT',
  },
  {
    cls: 'tm-node-api',
    glyph: '↗',
    title: '',
    titleKey: 'UNIFIED API',
    subKey: 'ONE ENDPOINT',
  },
  {
    cls: 'tm-node-usage',
    glyph: 'Σ',
    title: '',
    titleKey: 'USAGE LEDGER',
    subKey: 'EVERY CALL TRACKED',
  },
]

interface TmExchangeSceneProps {
  /** Index into TM_INPUT_ROUTES for the currently lit model path. */
  activeRoute?: number
  /** e.g. "CLAUDE / CONNECTED" */
  sceneModel?: string
  /** e.g. "20K → 4K" */
  sceneTokens?: string
  /** Receipt strip body */
  receiptLabel?: string
  receiptBody?: string
  receiptStatus?: string
}

export function TmExchangeScene(props: TmExchangeSceneProps) {
  const { t } = useTranslation()
  const active = props.activeRoute ?? 0
  const activeRoute = TM_INPUT_ROUTES[active] ?? TM_INPUT_ROUTES[0]

  return (
    <>
      <div className='tm-exchange-scene' aria-hidden='true'>
        <div className='tm-scene-glow' />
        <svg className='tm-signal-map' viewBox='-100 0 900 380' fill='none'>
          <defs>
            <linearGradient id='tm-signal-in' x1='0' y1='0' x2='1' y2='0'>
              <stop stopColor='#ee9f94' stopOpacity='.05' />
              <stop offset='.55' stopColor='#ee9f94' />
              <stop offset='1' stopColor='#ff4d3a' />
            </linearGradient>
            <linearGradient id='tm-signal-out' x1='0' y1='0' x2='1' y2='0'>
              <stop stopColor='#ff4d3a' />
              <stop offset='1' stopColor='#f5927c' stopOpacity='.05' />
            </linearGradient>
            <radialGradient id='tm-core-glow'>
              <stop stopColor='#ff4d3a' stopOpacity='.3' />
              <stop offset='1' stopColor='#ff4d3a' stopOpacity='0' />
            </radialGradient>
          </defs>
          <g className='tm-grid-plane'>
            <path d='M-70 330H770M-40 280H740M5 230H695M55 180H645M120 130H580M350 20V375M230 30 290 375M470 30 410 375M110 40 240 375M590 40 460 375' />
          </g>
          <g className='tm-orbit-ring'>
            <ellipse
              cx='350'
              cy='150'
              rx='138'
              ry='50'
              transform='rotate(-22 350 150)'
            />
            <ellipse
              cx='350'
              cy='150'
              rx='153'
              ry='63'
              transform='rotate(32 350 150)'
            />
          </g>
          <g className='tm-signal-paths'>
            {TM_INPUT_ROUTES.map((r, i) => (
              <path
                key={r.key}
                className={
                  i === active ? 'tm-signal-path tm-is-active' : 'tm-signal-path'
                }
                d={r.d}
              />
            ))}
            <path
              className='tm-signal-path tm-output-path'
              d='M385 144 455 110 650 92'
            />
            <path
              className='tm-signal-path tm-output-path tm-secondary'
              d='M385 157 475 196 645 226'
            />
          </g>
          <g className='tm-signal-packets'>
            <rect width='24' height='2' rx='1'>
              {/* key forces a remount so SMIL restarts on the new route,
                  matching the prototype's beginElement() re-trigger */}
              <animateMotion
                key={activeRoute.key}
                dur='2.8s'
                repeatCount='indefinite'
                path={activeRoute.d}
              />
            </rect>
            <rect width='20' height='2' rx='1'>
              <animateMotion
                dur='2.4s'
                begin='.7s'
                repeatCount='indefinite'
                path='M385 144 455 110 650 92'
              />
            </rect>
            <rect width='18' height='2' rx='1'>
              <animateMotion
                dur='2.6s'
                begin='1.2s'
                repeatCount='indefinite'
                path='M385 157 475 196 645 226'
              />
            </rect>
          </g>
          <g className='tm-scene-ticks'>
            <path d='M30 28h18M39 19v18M650 328h18M659 319v18M613 170h24M625 158v24' />
          </g>
        </svg>
        {NODES.map((n) => (
          <div key={n.cls} className={`tm-signal-node ${n.cls}`}>
            <span>{n.glyph}</span>
            <div>
              {n.titleKey ? t(n.titleKey) : n.title}
              <small>{t(n.subKey)}</small>
            </div>
          </div>
        ))}
        <div className='tm-exchange-core'>
          <div className='tm-core-aura' />
          <div className='tm-core-orbit tm-orbit-a' />
          <div className='tm-core-orbit tm-orbit-b' />
          <div className='tm-core-hex'>
            <div>
              {/* The prototype's stylized brand mark (transparent white
                  glyph), not the configured logo — that may carry a white
                  background square which reads as a pasted image here. */}
              <img
                className='tm-core-mark'
                src='/codeguys-mark.png'
                alt=''
              />
              <span>CODEGUYS</span>
            </div>
          </div>
          <span className='tm-core-coordinate tm-coord-top'>
            {t('CG / EXCHANGE')}
          </span>
          <span className='tm-core-coordinate tm-coord-bottom'>
            {t('TOKENS IN MOTION')}
          </span>
        </div>
        <div className='tm-scene-readout'>
          <span className='tm-live-dot' />
          <span>{props.sceneModel}</span>
          <span className='tm-scene-tokens'>{props.sceneTokens}</span>
        </div>
      </div>
      <div className='tm-receipt-strip'>
        <span className='tm-receipt-check'>
          <Check aria-hidden='true' />
        </span>
        <div>
          <span className='tm-mini-label'>{props.receiptLabel}</span>
          <p>{props.receiptBody}</p>
        </div>
        <span className='tm-receipt-status'>{props.receiptStatus}</span>
      </div>
    </>
  )
}

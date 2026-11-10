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

/**
 * One 1px red line that runs down the homepage. It starts at the hexagon in the
 * route diagram and ends at the CodeY block, and it grows as the page scrolls:
 * the tip sits at the middle of the viewport. With reduced motion it is drawn
 * in full from the start, which is the finished frame.
 *
 * Anything the line should light up carries `data-route-mark`. Once the tip
 * passes a mark, that element gets `data-reached`, and it keeps it.
 */

const MARK = '[data-route-mark]'

export function RouteLine() {
  const [reduced, setReduced] = useState(false)
  const lineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const line = lineRef.current
    if (!line) return

    const reached = new Set<Element>()

    const place = () => {
      const start = document.querySelector('[data-route-start]')
      const end = document.querySelector('[data-route-end]')
      if (!start || !end) return

      const startBox = start.getBoundingClientRect()
      const endBox = end.getBoundingClientRect()
      const top = startBox.top + startBox.height / 2 + window.scrollY
      const bottom = endBox.top + endBox.height / 2 + window.scrollY
      const height = Math.max(bottom - top, 0)

      line.style.top = `${top}px`
      line.style.height = `${height}px`

      const tip = reduced ? bottom : window.scrollY + window.innerHeight / 2
      const grown = Math.min(Math.max(tip - top, 0), height)
      line.style.setProperty('--route-line', `${grown}px`)

      document.querySelectorAll(MARK).forEach((mark) => {
        if (reached.has(mark)) return
        const box = mark.getBoundingClientRect()
        const middle = box.top + box.height / 2 + window.scrollY
        if (middle <= top + grown) {
          reached.add(mark)
          mark.setAttribute('data-reached', '')
        }
      })
    }

    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }

    place()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [reduced])

  return (
    <div
      ref={lineRef}
      aria-hidden='true'
      data-reduced={reduced || undefined}
      className='route-line bg-primary pointer-events-none absolute left-1/2 z-10 hidden w-px -translate-x-1/2 md:block'
    />
  )
}

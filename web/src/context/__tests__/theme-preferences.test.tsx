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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ThemeCustomizationProvider,
  useThemeCustomization,
} from '@/context/theme-customization-provider'
import { ThemeProvider, useTheme } from '@/context/theme-provider'
import { initializeFrontendCache } from '@/lib/frontend-cache'

const MODE_KEY = 'codeguys:theme:v1:mode'
const LAYOUT_KEY = 'codeguys:theme:v1:content-layout'

// Choices the brand no longer offers. A build that stored them must forget
// them instead of keeping them around.
const RETIRED_KEYS = [
  'codeguys:theme:v1:preset',
  'codeguys:theme:v1:font',
  'codeguys:theme:v1:radius',
  'codeguys:theme:v1:scale',
]

function ThemeControls() {
  const theme = useTheme()
  const customization = useThemeCustomization()

  return (
    <>
      <output aria-label='Theme mode'>{theme.theme}</output>
      <output aria-label='Content layout'>
        {customization.customization.contentLayout}
      </output>
      <button type='button' onClick={() => theme.setTheme('dark')}>
        Dark mode
      </button>
      <button
        type='button'
        onClick={() => customization.setContentLayout('centered')}
      >
        Centered layout
      </button>
      <button
        type='button'
        onClick={() => {
          theme.resetTheme()
          customization.resetCustomization()
        }}
      >
        Reset
      </button>
    </>
  )
}

function ThemeFixture() {
  return (
    <ThemeProvider>
      <ThemeCustomizationProvider>
        <ThemeControls />
      </ThemeCustomizationProvider>
    </ThemeProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.trim().split('=')[0]
    document.cookie = `${name}=; path=/; max-age=0`
  }
  document.documentElement.classList.remove('light', 'dark')
  for (const name of document.body.getAttributeNames()) {
    if (name.startsWith('data-theme-')) document.body.removeAttribute(name)
  }
})

describe('theme preference persistence', () => {
  it('starts from the brand defaults when only legacy theme cookies exist', () => {
    document.cookie = 'theme_preset=ocean-breeze; path=/'
    document.cookie = 'vite-ui-theme=dark; path=/'
    document.cookie = 'theme_content_layout=centered; path=/'

    render(<ThemeFixture />)

    expect(screen.getByLabelText('Theme mode')).toHaveTextContent('system')
    expect(document.documentElement).toHaveClass('light')
    expect(screen.getByLabelText('Content layout')).toHaveTextContent('full')
    expect(document.body).toHaveAttribute('data-theme-content-layout', 'full')
  })

  it('restores the mode and content layout after remounting without writing cookies', async () => {
    const user = userEvent.setup()
    const first = render(<ThemeFixture />)

    await user.click(screen.getByRole('button', { name: 'Dark mode' }))
    await user.click(screen.getByRole('button', { name: 'Centered layout' }))
    first.unmount()
    render(<ThemeFixture />)

    expect(screen.getByLabelText('Theme mode')).toHaveTextContent('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(screen.getByLabelText('Content layout')).toHaveTextContent('centered')
    expect(document.body).toHaveAttribute(
      'data-theme-content-layout',
      'centered'
    )
    expect(localStorage.getItem(MODE_KEY)).toBe('dark')
    expect(localStorage.getItem(LAYOUT_KEY)).toBe('centered')
    expect(document.cookie).toBe('')
  })

  it('keeps a reset after remounting even when a legacy theme cookie remains', async () => {
    localStorage.setItem(MODE_KEY, 'dark')
    localStorage.setItem(LAYOUT_KEY, 'centered')
    localStorage.setItem('unrelated-preference', 'keep')
    document.cookie = 'theme_preset=ocean-breeze; path=/'
    const user = userEvent.setup()
    const first = render(<ThemeFixture />)

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    first.unmount()
    render(<ThemeFixture />)

    expect(screen.getByLabelText('Theme mode')).toHaveTextContent('system')
    expect(document.documentElement).toHaveClass('light')
    expect(screen.getByLabelText('Content layout')).toHaveTextContent('full')
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
    expect(localStorage.getItem(LAYOUT_KEY)).toBeNull()
    expect(localStorage.getItem('unrelated-preference')).toBe('keep')
    expect(document.cookie).toContain('theme_preset=ocean-breeze')
  })

  it('discards a color preset, font, radius, and density stored by an older build', () => {
    for (const key of RETIRED_KEYS) {
      localStorage.setItem(key, 'rose-garden')
    }

    render(<ThemeFixture />)

    for (const key of RETIRED_KEYS) {
      expect(localStorage.getItem(key)).toBeNull()
    }
    expect(document.body).not.toHaveAttribute('data-theme-preset')
    expect(document.body).not.toHaveAttribute('data-theme-font')
    expect(document.body).not.toHaveAttribute('data-theme-radius')
    expect(document.body).not.toHaveAttribute('data-theme-scale')
  })

  it.each(['', 'unknown'])(
    'uses the brand default when the stored content layout is %j',
    (value) => {
      localStorage.setItem(LAYOUT_KEY, value)

      render(<ThemeFixture />)

      expect(screen.getByLabelText('Content layout')).toHaveTextContent('full')
      expect(document.body).toHaveAttribute('data-theme-content-layout', 'full')
    }
  )

  it('renders the brand defaults when reading local storage fails', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError')
    })

    render(<ThemeFixture />)

    expect(screen.getByLabelText('Theme mode')).toHaveTextContent('system')
    expect(screen.getByLabelText('Content layout')).toHaveTextContent('full')
  })

  it('still applies and resets preferences when storage writes fail', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError')
    })
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError')
    })
    const user = userEvent.setup()
    render(<ThemeFixture />)

    await user.click(screen.getByRole('button', { name: 'Dark mode' }))
    await user.click(screen.getByRole('button', { name: 'Centered layout' }))

    expect(screen.getByLabelText('Theme mode')).toHaveTextContent('dark')
    expect(screen.getByLabelText('Content layout')).toHaveTextContent('centered')

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(screen.getByLabelText('Theme mode')).toHaveTextContent('system')
    expect(screen.getByLabelText('Content layout')).toHaveTextContent('full')
  })

  it('preserves the mode and content layout during frontend cache initialization', () => {
    localStorage.setItem(MODE_KEY, 'dark')
    localStorage.setItem(LAYOUT_KEY, 'centered')
    localStorage.setItem('stale-ui-cache', 'old')

    initializeFrontendCache()
    initializeFrontendCache()
    render(<ThemeFixture />)

    expect(screen.getByLabelText('Theme mode')).toHaveTextContent('dark')
    expect(screen.getByLabelText('Content layout')).toHaveTextContent('centered')
    expect(localStorage.getItem('stale-ui-cache')).toBeNull()
  })
})

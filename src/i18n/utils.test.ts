import { describe, expect, it } from 'vitest'

import {
  alternateLocalePath,
  consolePath,
  docsBase,
  docsPath,
  downloadPath,
  homePath,
  isLocale,
  marketPath,
  modelsPath,
  pricingPath,
  registerPath,
  switchLocalePath,
  t,
} from './utils'

describe('isLocale', () => {
  it('accepts the supported locales', () => {
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('en')).toBe(true)
  })

  it('rejects unsupported or missing locales', () => {
    expect(isLocale('fr-FR')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale('')).toBe(false)
  })
})

describe('t', () => {
  it('returns the localized string for a known key', () => {
    expect(t('en', 'nav.download')).toBe('Download')
    expect(t('zh-CN', 'nav.download')).toBe('下载')
  })
})

describe('locale path helpers', () => {
  it('keeps zh-CN at the unprefixed root and prefixes en', () => {
    expect(homePath('zh-CN')).toBe('/')
    expect(homePath('en')).toBe('/en/')
    expect(switchLocalePath('zh-CN')).toBe('/en/')
    expect(switchLocalePath('en')).toBe('/')
  })

  it('builds docs paths', () => {
    expect(docsBase('zh-CN')).toBe('/docs')
    expect(docsBase('en')).toBe('/en/docs')
    expect(docsPath('zh-CN', 'intro')).toBe('/docs/intro/')
    expect(docsPath('en', '/sdk/overview/')).toBe('/en/docs/sdk/overview/')
  })

  it('builds market paths with and without a slug', () => {
    expect(marketPath('zh-CN')).toBe('/market/')
    expect(marketPath('en')).toBe('/en/market/')
    expect(marketPath('zh-CN', 'item')).toBe('/market/item/')
    expect(marketPath('en', '/item/')).toBe('/en/market/item/')
  })

  it('builds the remaining section paths', () => {
    expect(modelsPath('zh-CN')).toBe('/models/')
    expect(modelsPath('en')).toBe('/en/models/')
    expect(pricingPath('zh-CN')).toBe('/pricing/')
    expect(pricingPath('en')).toBe('/en/pricing/')
    expect(downloadPath('zh-CN')).toBe('/download/')
    expect(downloadPath('en')).toBe('/en/download/')
    expect(registerPath('zh-CN')).toBe('/register/')
    expect(registerPath('en')).toBe('/en/register/')
  })

  it('builds console paths per section', () => {
    expect(consolePath('zh-CN')).toBe('/console/')
    expect(consolePath('en')).toBe('/en/console/')
    expect(consolePath('zh-CN', 'models')).toBe('/console/models/')
    expect(consolePath('en', 'users')).toBe('/en/console/users/')
  })
})

describe('alternateLocalePath', () => {
  it('prefixes /en for zh-CN pages', () => {
    expect(alternateLocalePath('zh-CN', '/')).toBe('/en/')
    expect(alternateLocalePath('zh-CN', '/pricing/')).toBe('/en/pricing/')
    expect(alternateLocalePath('zh-CN', '/console/models/')).toBe('/en/console/models/')
  })

  it('strips the /en prefix for en pages', () => {
    expect(alternateLocalePath('en', '/en/')).toBe('/')
    expect(alternateLocalePath('en', '/en/pricing/')).toBe('/pricing/')
    expect(alternateLocalePath('en', '/en/console/models/')).toBe('/console/models/')
  })

  it('round-trips every page back to itself', () => {
    const paths = ['/', '/pricing/', '/console/models/', '/market/item/', '/en/download/']
    for (const path of paths) {
      const locale = path === '/en/' || path.startsWith('/en/') ? 'en' : 'zh-CN'
      const other = locale === 'en' ? 'zh-CN' : 'en'
      expect(alternateLocalePath(other, alternateLocalePath(locale, path))).toBe(path)
    }
  })
})

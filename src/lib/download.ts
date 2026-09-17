type Platform = 'darwin' | 'windows' | 'linux'
type ReleaseAsset = {
  name?: unknown
  size?: unknown
  browser_download_url?: unknown
}
type ReleasePayload = {
  tag_name?: unknown
  name?: unknown
  published_at?: unknown
  body?: unknown
  prerelease?: unknown
  assets?: unknown
}

/**
 * Behaviour for the download page: fetch the GitHub release feed, render the
 * per-platform download cards, and drive the release-history browser.
 *
 * Extracted verbatim from `Download.astro`; the component only imports and calls it.
 */
export function initDownload(): void {
  const root = document.querySelector<HTMLElement>('[data-download-root]')
  if (!root) return
  const status = root.querySelector<HTMLElement>('.release-status')
  const statusText = root.querySelector<HTMLElement>('[data-release-status-text]')
  const grid = root.querySelector<HTMLElement>('[data-download-grid]')
  const history = root.querySelector<HTMLElement>('[data-release-history]')
  const historyBrowser = history?.querySelector<HTMLElement>('.release-browser')
  const historyList = history?.querySelector<HTMLElement>('[data-release-list]')
  const historyDetail = history?.querySelector<HTMLElement>('[data-release-detail]')
  const historyCount = history?.querySelector<HTMLElement>('[data-release-count]')
  const locale = root.dataset.locale === 'en' ? 'en' : 'zh-CN'

  const setStatus = (state: 'ready' | 'empty' | 'error', text: string) => {
    root.dataset.releaseState = state
    if (status) status.dataset.releaseState = state
    if (statusText) statusText.textContent = text
  }

  const detectedPlatform = (): Platform | undefined => {
    const value = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase()
    if (/iphone|ipad|ipod|android/.test(value)) return undefined
    // iPadOS desktop mode reports as Macintosh
    if (value.includes('mac') && navigator.maxTouchPoints > 1) return undefined
    if (value.includes('mac')) return 'darwin'
    if (value.includes('win')) return 'windows'
    if (value.includes('linux')) return 'linux'
    return undefined
  }

  const recommended = detectedPlatform()
  if (recommended) {
    const card = root.querySelector<HTMLElement>(`[data-platform="${recommended}"]`)
    card?.classList.add('is-recommended')
    const badge = card?.querySelector<HTMLElement>('[data-recommended]')
    if (badge) badge.hidden = false
    if (grid && card && grid.firstElementChild !== card) {
      grid.prepend(card)
    }
    ;[...(grid?.querySelectorAll<HTMLElement>('.download-card') ?? [])].forEach((item, index) => {
      item.style.setProperty('--reveal-delay', `${index * 0.08}s`)
    })
  }

  const assetPlatform = (name: string): Platform | undefined => {
    const normalized = name.toLowerCase()
    if (normalized.endsWith('.dmg')) return 'darwin'
    if (normalized.endsWith('.msi') || normalized.endsWith('.exe')) return 'windows'
    if (
      normalized.endsWith('.appimage') ||
      normalized.endsWith('.deb') ||
      normalized.endsWith('.rpm')
    ) {
      return 'linux'
    }
    return undefined
  }

  const assetKind = (name: string) => {
    const normalized = name.toLowerCase()
    if (normalized.endsWith('.appimage')) return 'AppImage'
    if (normalized.endsWith('.dmg')) return 'DMG'
    if (normalized.endsWith('.msi')) return 'MSI'
    if (normalized.endsWith('.exe')) return 'EXE'
    if (normalized.endsWith('.deb')) return 'DEB'
    if (normalized.endsWith('.rpm')) return 'RPM'
    return ''
  }

  const assetArchitecture = (name: string, platform: Platform) => {
    const normalized = name.toLowerCase()
    if (/(aarch64|arm64)/.test(normalized)) {
      return platform === 'darwin'
        ? (root.dataset.archAppleSilicon ?? 'Apple Silicon')
        : (root.dataset.archArm64 ?? 'ARM64')
    }
    if (/(x86_64|x64|amd64)/.test(normalized)) {
      return platform === 'darwin'
        ? (root.dataset.archIntel ?? 'Intel')
        : (root.dataset.archX64 ?? 'x64')
    }
    return ''
  }

  const assetRank = (name: string, platform: Platform) => {
    const normalized = name.toLowerCase()
    const isArm = /(aarch64|arm64)/.test(normalized)
    const isX64 = /(x86_64|x64|amd64)/.test(normalized)
    if (platform === 'darwin') return isArm ? 0 : isX64 ? 1 : 2
    if (platform === 'windows') {
      const architecture = isX64 ? 0 : isArm ? 10 : 20
      const format = normalized.endsWith('.exe') ? 0 : 1
      return architecture + format
    }
    if (normalized.endsWith('.appimage')) return 0
    if (normalized.endsWith('.deb')) return 1
    if (normalized.endsWith('.rpm')) return 2
    return 3
  }

  const assetSize = (size: unknown) => {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return ''
    const megabytes = size / 1024 / 1024
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes)} MB`
  }

  const safeAssetUrl = (value: unknown) => {
    if (typeof value !== 'string') return undefined
    try {
      const url = new URL(value)
      if (
        url.protocol === 'https:' &&
        url.hostname === 'github.com' &&
        url.pathname.startsWith('/ysmjjsy/CodeY-Releases/releases/download/')
      ) {
        return url.href
      }
    } catch {
      return undefined
    }
    return undefined
  }

  const renderAssets = (assets: ReleaseAsset[]) => {
    const platforms: Platform[] = ['darwin', 'windows', 'linux']
    for (const platform of platforms) {
      const card = root.querySelector<HTMLElement>(`[data-platform="${platform}"]`)
      const actions = card?.querySelector<HTMLElement>('[data-assets]')
      const unavailable = card?.querySelector<HTMLElement>('[data-unavailable]')
      if (!actions || !unavailable) continue

      const matches = assets
        .filter((asset) => typeof asset.name === 'string' && assetPlatform(asset.name) === platform)
        .map((asset) => ({
          name: asset.name as string,
          size: asset.size,
          url: safeAssetUrl(asset.browser_download_url),
        }))
        .filter((asset): asset is { name: string; size: unknown; url: string } =>
          Boolean(asset.url),
        )
        .sort((left, right) => assetRank(left.name, platform) - assetRank(right.name, platform))

      actions.replaceChildren()

      if (matches.length === 0) {
        unavailable.textContent = root.dataset.platformUnavailable ?? ''
        unavailable.hidden = false
        continue
      }

      unavailable.hidden = true
      for (const [index, asset] of matches.entries()) {
        const link = document.createElement('a')
        link.className = `btn ${card?.classList.contains('is-recommended') && index === 0 ? 'btn-primary' : 'btn-ghost'} download-asset`
        link.href = asset.url
        link.target = '_blank'
        link.rel = 'noopener'
        link.dataset.assetName = asset.name

        const icon = document.createElement('i')
        icon.className = 'ph ph-download-simple'
        icon.setAttribute('aria-hidden', 'true')

        const kind = document.createElement('span')
        kind.className = 'asset-kind'
        kind.textContent = assetKind(asset.name)

        const metaParts = [assetArchitecture(asset.name, platform), assetSize(asset.size)].filter(
          Boolean,
        )
        const meta = document.createElement('span')
        meta.className = 'asset-meta'
        meta.textContent = metaParts.length > 0 ? `· ${metaParts.join(' · ')}` : ''

        link.append(icon, kind)
        if (meta.textContent) link.append(meta)
        actions.append(link)
      }
    }
  }

  const releaseDate = (value: unknown, dateStyle: 'long' | 'medium' = 'medium') => {
    if (typeof value !== 'string') return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(locale, { dateStyle }).format(date)
  }

  const plainMarkdown = (value: string) =>
    value
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)]/g, '$1')
      .trim()

  const renderReleaseNotes = (container: HTMLElement, body: unknown) => {
    container.replaceChildren()
    if (typeof body !== 'string' || !body.trim()) {
      const empty = document.createElement('p')
      empty.className = 'release-empty'
      empty.textContent = root.dataset.historyEmptyNotes ?? ''
      container.append(empty)
      return
    }

    const lines = body.replace(/\r/g, '').split('\n')
    let list: HTMLUListElement | undefined
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) {
        list = undefined
        continue
      }
      if (/^\[[^\]]+]:\s*https?:\/\//.test(line) || /^\*\*Full Changelog\*\*:/i.test(line)) {
        continue
      }
      if (/^##\s+\[[^\]]+]\s+-\s+/.test(line)) continue

      const heading = line.match(/^#{2,4}\s+(.+)$/)
      if (heading) {
        const title = document.createElement('h4')
        title.textContent = plainMarkdown(heading[1] ?? '')
        container.append(title)
        list = undefined
        continue
      }

      const listItem = line.match(/^[-*]\s+(.+)$/)
      if (listItem) {
        if (!list) {
          list = document.createElement('ul')
          container.append(list)
        }
        const item = document.createElement('li')
        item.textContent = plainMarkdown(listItem[1] ?? '')
        list.append(item)
        continue
      }

      const paragraph = document.createElement('p')
      paragraph.textContent = plainMarkdown(line)
      container.append(paragraph)
      list = undefined
    }

    if (!container.hasChildNodes()) {
      const empty = document.createElement('p')
      empty.className = 'release-empty'
      empty.textContent = root.dataset.historyEmptyNotes ?? ''
      container.append(empty)
    }
  }

  const platformMeta = (platform: Platform) => {
    if (platform === 'darwin') return { name: 'macOS', icon: 'apple-logo' }
    if (platform === 'windows') return { name: 'Windows', icon: 'windows-logo' }
    return { name: 'Linux', icon: 'linux-logo' }
  }

  const installerAssets = (release: ReleasePayload, platform: Platform) =>
    (Array.isArray(release.assets) ? (release.assets as ReleaseAsset[]) : [])
      .filter((asset) => typeof asset.name === 'string' && assetPlatform(asset.name) === platform)
      .map((asset) => ({
        name: asset.name as string,
        size: asset.size,
        url: safeAssetUrl(asset.browser_download_url),
      }))
      .filter((asset): asset is { name: string; size: unknown; url: string } => Boolean(asset.url))
      .sort((left, right) => assetRank(left.name, platform) - assetRank(right.name, platform))

  const renderReleaseDownloads = (container: HTMLElement, release: ReleasePayload) => {
    container.replaceChildren()
    const platforms: Platform[] = ['darwin', 'windows', 'linux']
    let packageCount = 0

    for (const platform of platforms) {
      const assets = installerAssets(release, platform)
      if (assets.length === 0) continue
      packageCount += assets.length

      const group = document.createElement('section')
      group.className = 'release-platform-group'
      const platformName = document.createElement('div')
      platformName.className = 'release-platform-name'
      const platformIcon = document.createElement('i')
      platformIcon.className = `ph ph-${platformMeta(platform).icon}`
      platformIcon.setAttribute('aria-hidden', 'true')
      const platformLabel = document.createElement('span')
      platformLabel.textContent = platformMeta(platform).name
      platformName.append(platformIcon, platformLabel)

      const assetList = document.createElement('div')
      assetList.className = 'release-asset-list'
      for (const asset of assets) {
        const link = document.createElement('a')
        link.className = 'release-asset'
        link.href = asset.url
        link.rel = 'noopener'
        link.dataset.assetName = asset.name

        const icon = document.createElement('i')
        icon.className = 'ph ph-download-simple'
        icon.setAttribute('aria-hidden', 'true')
        const kind = document.createElement('span')
        kind.className = 'release-asset-kind'
        kind.textContent = assetKind(asset.name)
        const meta = document.createElement('span')
        meta.className = 'release-asset-meta'
        const metaParts = [assetArchitecture(asset.name, platform), assetSize(asset.size)].filter(
          Boolean,
        )
        meta.textContent = metaParts.join(' · ')
        link.append(icon, kind, meta)
        assetList.append(link)
      }

      group.append(platformName, assetList)
      container.append(group)
    }

    if (packageCount === 0) {
      const empty = document.createElement('p')
      empty.className = 'release-empty'
      empty.textContent = root.dataset.historyEmptyDownloads ?? ''
      container.append(empty)
    }
    return packageCount
  }

  const renderReleaseDetail = (release: ReleasePayload, index: number, latestIndex: number) => {
    if (!historyDetail || !historyList) return
    historyDetail.replaceChildren()
    historyDetail.id = `release-panel-${index}`
    historyDetail.setAttribute('aria-labelledby', `release-tab-${index}`)

    const head = document.createElement('header')
    head.className = 'release-detail-head'
    const versionMeta = document.createElement('div')
    const versionLine = document.createElement('div')
    versionLine.className = 'release-version-line'
    const version = document.createElement('span')
    version.className = 'release-version'
    version.textContent = typeof release.tag_name === 'string' ? release.tag_name : ''
    versionLine.append(version)
    if (index === latestIndex || release.prerelease === true) {
      const badge = document.createElement('span')
      badge.className = 'release-badge'
      badge.textContent =
        index === latestIndex
          ? (root.dataset.historyLatest ?? '')
          : (root.dataset.historyPrerelease ?? '')
      versionLine.append(badge)
    }
    const date = document.createElement('time')
    date.className = 'release-date'
    date.textContent = (root.dataset.historyPublished ?? '{date}').replace(
      '{date}',
      releaseDate(release.published_at, 'long'),
    )
    if (typeof release.published_at === 'string') date.dateTime = release.published_at
    versionMeta.append(versionLine, date)
    const packageCount = document.createElement('span')
    packageCount.className = 'release-package-count'
    head.append(versionMeta, packageCount)

    const notesSection = document.createElement('section')
    notesSection.className = 'release-content-section'
    const notesTitle = document.createElement('h3')
    notesTitle.className = 'release-content-title'
    const notesIcon = document.createElement('i')
    notesIcon.className = 'ph ph-note-pencil'
    notesIcon.setAttribute('aria-hidden', 'true')
    notesTitle.append(notesIcon, document.createTextNode(root.dataset.historyNotes ?? ''))
    const notes = document.createElement('div')
    notes.className = 'release-notes'
    renderReleaseNotes(notes, release.body)
    notesSection.append(notesTitle, notes)

    const downloadsSection = document.createElement('section')
    downloadsSection.className = 'release-content-section'
    const downloadsTitle = document.createElement('h3')
    downloadsTitle.className = 'release-content-title'
    const downloadsIcon = document.createElement('i')
    downloadsIcon.className = 'ph ph-package'
    downloadsIcon.setAttribute('aria-hidden', 'true')
    downloadsTitle.append(
      downloadsIcon,
      document.createTextNode(root.dataset.historyDownloads ?? ''),
    )
    const downloads = document.createElement('div')
    downloads.className = 'release-assets-grid'
    const count = renderReleaseDownloads(downloads, release)
    packageCount.textContent = (root.dataset.historyPackages ?? '{count}').replace(
      '{count}',
      `${count}`,
    )
    downloadsSection.append(downloadsTitle, downloads)

    historyDetail.append(head, notesSection, downloadsSection)
    for (const tab of historyList.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const selected = tab.dataset.releaseIndex === `${index}`
      tab.setAttribute('aria-selected', `${selected}`)
      tab.tabIndex = selected ? 0 : -1
    }
  }

  const renderReleaseHistory = (releases: ReleasePayload[], latestRelease?: ReleasePayload) => {
    if (!historyBrowser || !historyList || !historyDetail || !historyCount) return
    historyBrowser.dataset.historyState = releases.length > 0 ? 'ready' : 'empty'
    historyCount.textContent = (root.dataset.historyCount ?? '{count}').replace(
      '{count}',
      `${releases.length}`,
    )
    historyList.replaceChildren()

    if (releases.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'release-empty'
      empty.textContent = root.dataset.statusEmpty ?? ''
      historyDetail.replaceChildren(empty)
      return
    }

    const latestIndex = Math.max(0, latestRelease ? releases.indexOf(latestRelease) : 0)

    releases.forEach((release, index) => {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.className = 'release-tab'
      tab.id = `release-tab-${index}`
      tab.role = 'tab'
      tab.dataset.releaseIndex = `${index}`
      tab.setAttribute('aria-controls', `release-panel-${index}`)
      tab.setAttribute('aria-selected', `${index === latestIndex}`)
      tab.tabIndex = index === latestIndex ? 0 : -1

      const version = document.createElement('span')
      version.className = 'release-tab-version'
      version.textContent = typeof release.tag_name === 'string' ? release.tag_name : ''
      const date = document.createElement('time')
      date.className = 'release-tab-date'
      date.textContent = releaseDate(release.published_at)
      if (typeof release.published_at === 'string') date.dateTime = release.published_at
      tab.append(version, date)
      if (index === latestIndex || release.prerelease === true) {
        const badge = document.createElement('span')
        badge.className = 'release-tab-badge'
        badge.textContent =
          index === latestIndex
            ? (root.dataset.historyLatest ?? '')
            : (root.dataset.historyPrerelease ?? '')
        tab.append(badge)
      }
      tab.addEventListener('click', () => renderReleaseDetail(release, index, latestIndex))
      tab.addEventListener('keydown', (event) => {
        if (
          !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
        ) {
          return
        }
        event.preventDefault()
        const lastIndex = releases.length - 1
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? lastIndex
              : event.key === 'ArrowDown' || event.key === 'ArrowRight'
                ? (index + 1) % releases.length
                : (index - 1 + releases.length) % releases.length
        const nextTab = historyList.querySelector<HTMLButtonElement>(
          `[data-release-index="${nextIndex}"]`,
        )
        nextTab?.focus()
        renderReleaseDetail(releases[nextIndex] ?? release, nextIndex, latestIndex)
      })
      historyList.append(tab)
    })

    renderReleaseDetail(releases[latestIndex] ?? {}, latestIndex, latestIndex)
  }

  const renderHistoryError = () => {
    if (!historyBrowser || !historyList || !historyDetail || !historyCount) return
    historyBrowser.dataset.historyState = 'error'
    historyCount.textContent = root.dataset.historyError ?? ''
    historyList.replaceChildren()
    const empty = document.createElement('p')
    empty.className = 'release-empty'
    empty.textContent = root.dataset.historyError ?? ''
    historyDetail.replaceChildren(empty)
  }

  const loadReleases = async () => {
    try {
      const response = await fetch(root.dataset.releaseApi ?? '', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (response.status === 404) {
        setStatus('empty', root.dataset.statusEmpty ?? '')
        renderAssets([])
        renderReleaseHistory([])
        return
      }
      if (!response.ok) throw new Error(`Release source returned ${response.status}`)

      const payload = (await response.json()) as unknown
      const releases = Array.isArray(payload)
        ? (payload as ReleasePayload[]).filter(
            (release) => typeof release.tag_name === 'string' && release.tag_name.length > 0,
          )
        : []
      const release = releases.find((item) => item.prerelease !== true) ?? releases[0]
      if (!release) {
        setStatus('empty', root.dataset.statusEmpty ?? '')
        renderAssets([])
        renderReleaseHistory([])
        return
      }
      const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
      const date = releaseDate(release.published_at)
      const ready = (root.dataset.statusReady ?? '{version}')
        .replace('{version}', tag)
        .replace('{date}', date)
      setStatus('ready', ready)
      renderAssets(Array.isArray(release.assets) ? (release.assets as ReleaseAsset[]) : [])
      renderReleaseHistory(releases, release)
    } catch {
      setStatus('error', root.dataset.statusError ?? '')
      for (const actions of root.querySelectorAll('[data-assets]')) {
        actions.replaceChildren()
      }
      renderHistoryError()
    }
  }

  void loadReleases()
}

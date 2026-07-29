import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'start') {
  throw new Error('Usage: node scripts/run-site.mjs <dev|start>')
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localEnvironmentFile = resolve(projectRoot, '.env.local')
if (existsSync(localEnvironmentFile)) process.loadEnvFile(localEnvironmentFile)

const cargoManifest = resolve(projectRoot, 'Cargo.toml')
const astroCli = resolve(projectRoot, 'node_modules/astro/bin/astro.mjs')
const marketTargetDirectory = resolve(
  process.env.CODEY_MARKET_TARGET_DIR || resolve(projectRoot, '.codey-market/target'),
)
const marketBinary = resolve(
  marketTargetDirectory,
  'release',
  process.platform === 'win32' ? 'codey-market-server.exe' : 'codey-market-server',
)
const websiteHost = process.env.CODEY_WEBSITE_HOST || '127.0.0.1'
const websitePort = parsePort(process.env.CODEY_WEBSITE_PORT || '4321', 'CODEY_WEBSITE_PORT')
const websiteListenOrigin = `http://${websiteHost}:${websitePort}`
const websiteOrigin = parseOrigin(
  process.env.CODEY_WEBSITE_ORIGIN || websiteListenOrigin,
  'CODEY_WEBSITE_ORIGIN',
)
const marketUpstream = new URL(
  process.env.CODEY_MARKET_UPSTREAM || 'http://127.0.0.1:8787',
)
const marketPort = parsePort(
  marketUpstream.port || (marketUpstream.protocol === 'https:' ? '443' : '80'),
  'CODEY_MARKET_UPSTREAM',
)

if (marketUpstream.protocol !== 'http:') {
  throw new Error('CODEY_MARKET_UPSTREAM must use http://')
}

if (mode === 'dev' && !existsSync(astroCli)) {
  throw new Error('Astro is not installed. Run pnpm install first.')
}

if (mode === 'start' && !existsSync(marketBinary)) {
  throw new Error('Market Server is not built. Run pnpm build first.')
}

let marketProcess = null
let webProcess = null
let webServer = null
let shuttingDown = false

try {
  marketProcess = await startMarketServer()
  await waitForMarket()

  if (mode === 'dev') {
    const astroArgs = [
      astroCli,
      'dev',
      '--host',
      websiteHost,
      '--port',
      String(websitePort),
    ]
    if (process.env.CODEY_WEBSITE_IGNORE_LOCK === '1') astroArgs.push('--ignore-lock')
    webProcess = spawn(
      process.execPath,
      astroArgs,
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ASTRO_DEV_BACKGROUND: '0',
          CODEY_MARKET_UPSTREAM: marketUpstream.origin,
        },
        stdio: 'inherit',
      },
    )
    webProcess.once('error', fail)
    webProcess.once('exit', (code, signal) => {
      if (!shuttingDown && code !== 0) fail(new Error(`Astro exited (${signal || code})`))
      void shutdown(code || 0)
    })
    await waitForWebsite()
    console.log(`CodeY website ready at ${websiteOrigin}`)
  } else {
    webServer = createProductionServer()
    await new Promise((resolvePromise, reject) => {
      webServer.once('error', reject)
      webServer.listen(websitePort, websiteHost, resolvePromise)
    })
    console.log(`CodeY website ready at ${websiteOrigin}`)
  }
} catch (error) {
  fail(error)
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

async function startMarketServer() {
  const command = mode === 'dev' ? 'cargo' : marketBinary
  const args =
    mode === 'dev'
      ? ['run', '--manifest-path', cargoManifest, '-p', 'codey-market-server']
      : []
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: marketTargetDirectory,
      CODEY_MARKET_ADDR: `${marketUpstream.hostname}:${marketPort}`,
      CODEY_MARKET_DATA_ROOT:
        process.env.CODEY_MARKET_DATA_ROOT || resolve(projectRoot, '.codey-market'),
      CODEY_MARKET_WEB_BASE_URL: `${websiteOrigin}/market`,
      CODEY_MARKET_API_BASE_URL: `${websiteOrigin}/api/market/v1`,
      CODEY_CLOUD_API_BASE_URL: `${websiteOrigin}/api/cloud/v1`,
      CODEY_MARKET_CORS_ORIGIN: websiteOrigin,
    },
    stdio: 'inherit',
  })
  child.once('error', fail)
  child.once('exit', (code, signal) => {
    if (!shuttingDown) fail(new Error(`Market Server exited (${signal || code})`))
  })
  return child
}

async function waitForMarket() {
  const discoveryUrl = new URL('/.well-known/codey-market.json', marketUpstream)
  const deadline = Date.now() + 600_000
  while (Date.now() < deadline) {
    if (marketProcess?.exitCode !== null) {
      throw new Error(`Market Server exited before becoming ready (${marketProcess?.exitCode})`)
    }
    try {
      const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // The first Rust build can take a while. Keep waiting until the bounded deadline.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`Market Server did not become ready: ${discoveryUrl}`)
}

async function waitForWebsite() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (webProcess?.exitCode !== null) {
      throw new Error(`Astro exited before becoming ready (${webProcess?.exitCode})`)
    }
    try {
      const response = await fetch(`${websiteListenOrigin}/market/`, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Astro did not become ready: ${websiteListenOrigin}`)
}

function createProductionServer() {
  const distRoot = resolve(projectRoot, 'dist')
  if (!existsSync(resolve(distRoot, 'index.html'))) {
    throw new Error('Website is not built. Run pnpm build first.')
  }
  return createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', websiteOrigin)
    if (
      requestUrl.pathname.startsWith('/api/market/v1/') ||
      requestUrl.pathname === '/api/market/v1' ||
      requestUrl.pathname.startsWith('/api/cloud/v1/') ||
      requestUrl.pathname === '/api/cloud/v1' ||
      requestUrl.pathname === '/.well-known/codey-market.json' ||
      requestUrl.pathname === '/.well-known/codey-cloud.json'
    ) {
      proxyMarketRequest(request, response)
      return
    }
    serveStatic(request, response, requestUrl.pathname, distRoot)
  })
}

function proxyMarketRequest(incoming, outgoing) {
  const upstreamRequest = httpRequest(
    {
      protocol: marketUpstream.protocol,
      hostname: marketUpstream.hostname,
      port: marketPort,
      method: incoming.method,
      path: incoming.url,
      headers: {
        ...incoming.headers,
        host: marketUpstream.host,
      },
    },
    (upstreamResponse) => {
      outgoing.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
      upstreamResponse.pipe(outgoing)
    },
  )
  upstreamRequest.once('error', (error) => {
    if (outgoing.headersSent) {
      outgoing.destroy(error)
      return
    }
    outgoing.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    outgoing.end(JSON.stringify({ error: { code: 'market_unavailable', message: error.message } }))
  })
  incoming.pipe(upstreamRequest)
}

function serveStatic(request, response, pathname, distRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }

  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    response.writeHead(400)
    response.end('Bad request')
    return
  }

  const relativePath = decodedPath.replace(/^\/+/, '')
  const directPath = safePath(distRoot, relativePath || 'index.html')
  const candidates = [directPath]
  if (directPath && existsSync(directPath) && statSync(directPath).isDirectory()) {
    candidates.unshift(safePath(distRoot, `${relativePath}/index.html`))
  } else if (!extname(relativePath)) {
    candidates.unshift(safePath(distRoot, `${relativePath}/index.html`))
  }
  const filePath = candidates.find(
    (candidate) => candidate && existsSync(candidate) && statSync(candidate).isFile(),
  )
  const resolvedPath = filePath || resolve(distRoot, '404.html')
  const status = filePath ? 200 : 404
  const headers = {
    'content-type': contentType(resolvedPath),
    'cache-control': pathname.startsWith('/_astro/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  }
  response.writeHead(status, headers)
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  createReadStream(resolvedPath).pipe(response)
}

function safePath(root, relativePath) {
  const candidate = resolve(root, relativePath)
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null
}

function contentType(filePath) {
  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }[extname(filePath).toLowerCase()] || 'application/octet-stream'
  )
}

function parsePort(value, name) {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must contain a valid TCP port`)
  }
  return port
}

function parseOrigin(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must contain a valid HTTP origin`)
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must contain an HTTP origin without a path, query, or fragment`)
  }
  return url.origin
}

function fail(error) {
  if (shuttingDown) return
  console.error(error instanceof Error ? error.message : error)
  void shutdown(1)
}

async function shutdown(exitCode) {
  if (shuttingDown) return
  shuttingDown = true
  if (webServer) {
    await new Promise((resolvePromise) => webServer.close(resolvePromise))
  }
  if (webProcess && webProcess.exitCode === null) webProcess.kill('SIGTERM')
  if (marketProcess && marketProcess.exitCode === null) marketProcess.kill('SIGTERM')
  process.exitCode = exitCode
}

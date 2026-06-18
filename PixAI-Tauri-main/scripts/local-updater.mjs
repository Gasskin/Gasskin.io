#!/usr/bin/env node

import { createServer } from 'node:http'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  findUpdaterArtifacts,
  hasUpdaterArtifacts,
  stageUpdaterArtifacts,
  writeLatestManifest
} from './updater-artifacts.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const srcTauriDir = join(rootDir, 'src-tauri')
const localUpdaterDir = join(rootDir, 'artifacts', 'local-updater')
const keysDir = join(localUpdaterDir, 'keys')
const feedDir = join(localUpdaterDir, 'feed')
const tempConfigPath = join(localUpdaterDir, 'tauri.local-updater.runtime.json')
const keyPath = join(keysDir, 'updater.key')
const pubKeyPath = `${keyPath}.pub`
const defaultPort = 14333
const defaultVersion = '0.0.3'

const command = process.argv[2] || 'help'
const options = parseArgs(process.argv.slice(3))

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  switch (command) {
    case 'keygen':
      await ensureKeypair({ force: options.force === true })
      return
    case 'build':
      await buildLocalUpdater()
      return
    case 'publish':
      await publishLocalUpdater()
      return
    case 'serve':
      await serveLocalUpdater()
      return
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp()
  }
}

async function buildLocalUpdater() {
  await ensureKeypair({ force: false })

  const version = readStringOption(options.version) || defaultVersion
  const port = Number(options.port || defaultPort)
  const endpoint = `http://127.0.0.1:${port}/latest.json`
  const pubkey = (await readFile(pubKeyPath, 'utf8')).trim()
  const privateKey = await readFile(keyPath, 'utf8')

  const config = {
    version,
    bundle: {
      createUpdaterArtifacts: true
    },
    plugins: {
      updater: {
        endpoints: [endpoint],
        pubkey,
        dangerousInsecureTransportProtocol: true
      }
    }
  }

  await ensureDir(localUpdaterDir)
  await writeFile(tempConfigPath, JSON.stringify(config, null, 2))

  console.log(`Building local updater test package ${version}`)
  console.log(`Updater endpoint: ${endpoint}`)

  await runCommand('pnpm', [
    'tauri',
    'build',
    '--config',
    'src-tauri/tauri.local-updater.conf.json',
    '--config',
    tempConfigPath,
    '--ci'
  ], {
    cwd: rootDir,
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
      PIXAI_APP_VERSION: version
    }
  })

  console.log('Build finished.')
}

async function publishLocalUpdater() {
  const version = readStringOption(options.version) || inferVersionFromBundle()
  const port = Number(options.port || defaultPort)
  await ensureDir(feedDir)

  const artifacts = await findUpdaterArtifacts({ srcTauriDir, version, macosArch: readMacosArchOption() })
  if (!hasUpdaterArtifacts(artifacts)) {
    throw new Error(
      `No updater bundle found for version ${version}. Run "pnpm updater:local:build -- --version ${version}" first.`
    )
  }

  const feedVersionDir = join(feedDir, version)
  await rm(feedVersionDir, { recursive: true, force: true })
  await mkdir(feedVersionDir, { recursive: true })

  const { platforms, copiedAssets } = await stageUpdaterArtifacts({
    artifacts,
    destinationDir: feedVersionDir,
    urlForFilename: (filename) => `http://127.0.0.1:${port}/${version}/${filename}`
  })

  const latestJson = {
    version,
    notes: readStringOption(options.notes) || `Local updater test build ${version}`,
    pub_date: new Date().toISOString(),
    platforms
  }

  await writeLatestManifest(join(feedDir, 'latest.json'), latestJson)

  console.log(`Published local feed for ${version}`)
  for (const asset of copiedAssets) {
    const target = asset.platformTarget ? ` (${asset.platformTarget})` : ''
    console.log(`${asset.label}${target}: ${relative(rootDir, asset.path)}`)
  }
  console.log(`Feed: http://127.0.0.1:${port}/latest.json`)
}

async function serveLocalUpdater() {
  const port = Number(options.port || defaultPort)
  await ensureDir(feedDir)

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${port}`}`)
    const pathname = decodeURIComponent(url.pathname)
    const requestedPath = pathname === '/' ? '/latest.json' : pathname
    const filePath = resolve(feedDir, `.${requestedPath}`)
    if (!filePath.startsWith(feedDir)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Forbidden')
      return
    }

    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Not Found')
        return
      }
      response.writeHead(200, {
        'Content-Type': contentTypeFor(filePath),
        'Content-Length': String(fileStat.size),
        'Cache-Control': 'no-store'
      })
      createReadStream(filePath).pipe(response)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not Found')
    }
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`Local updater feed listening on http://127.0.0.1:${port}/latest.json`)
    console.log(`Feed directory: ${relative(rootDir, feedDir)}`)
  })
}

async function ensureKeypair({ force }) {
  if (!force && await pathExists(keyPath) && await pathExists(pubKeyPath)) {
    return
  }

  await ensureDir(keysDir)
  if (force) {
    await rm(keyPath, { force: true })
    await rm(pubKeyPath, { force: true })
  }

  console.log('Generating local updater signing key...')
  await runCommand('pnpm', [
    'tauri',
    'signer',
    'generate',
    '--write-keys',
    keyPath,
    '--ci'
  ], { cwd: rootDir })
}

function inferVersionFromBundle() {
  const raw = readStringOption(options.version)
  if (raw) return raw
  throw new Error('Version is required. Use --version 0.0.x when publishing a specific build.')
}

function contentTypeFor(filePath) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.json') return 'application/json; charset=utf-8'
  if (extension === '.exe') return 'application/octet-stream'
  if (extension === '.sig') return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}". Use --name value.`)
    const eqIndex = arg.indexOf('=')
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2)
    const inlineValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined
    const nextValue = inlineValue ?? args[index + 1]
    if (nextValue === undefined || nextValue.startsWith('--')) {
      parsed[key] = true
      continue
    }
    if (inlineValue === undefined) index += 1
    parsed[key] = nextValue
  }
  return parsed
}

function readStringOption(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readMacosArchOption() {
  return readStringOption(options.macosArch || options['macos-arch'] || options.arch)
}

async function runCommand(command, args, { cwd, env }) {
  const commandLine = [command, ...args].join(' ')
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === 'win32',
      stdio: 'inherit'
    })
    child.on('error', rejectPromise)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`Command failed: ${commandLine}`))
      }
    })
  })
}

function printHelp() {
  console.log(`Local updater helper

Commands:
  pnpm updater:local:keygen
  pnpm updater:local:build -- --version 0.0.3 --port ${defaultPort}
  pnpm updater:local:publish -- --version 0.0.3 --port ${defaultPort}
  pnpm updater:local:serve -- --port ${defaultPort}

Notes:
  - Real releases can keep using GitHub release + latest.json.
  - This helper builds a separate local update feed for updater verification.
  - Windows local feeds preserve MSI/NSIS installer types and macOS feeds use darwin-aarch64/darwin-x86_64.
  - Use --macos-arch aarch64 or --macos-arch x86_64 when publishing cross-compiled macOS bundles.
`)
}

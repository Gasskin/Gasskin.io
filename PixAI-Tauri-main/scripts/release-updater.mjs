#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import {
  findUpdaterArtifacts,
  hasUpdaterArtifacts,
  mergeLatestManifest,
  stageUpdaterArtifacts,
  writeLatestManifest
} from './updater-artifacts.mjs'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const srcTauriDir = join(rootDir, 'src-tauri')
const tauriConfigPath = join(srcTauriDir, 'tauri.conf.json')
const releaseUpdaterDir = join(rootDir, 'artifacts', 'release-updater')
const keysDir = join(releaseUpdaterDir, 'keys')
const stagingDir = join(releaseUpdaterDir, 'staging')
const tempConfigPath = join(releaseUpdaterDir, 'tauri.release-updater.runtime.json')
const defaultKeyPath = join(keysDir, 'updater.key')
const keyPath = resolveKeyPath()
const pubKeyPath = `${keyPath}.pub`
const githubRepo = 'FingerCaster/PixAI-Tauri'
const githubReleaseBaseUrl = `https://github.com/${githubRepo}/releases/download`
const onePasswordVault = readStringOption(process.env.PIXAI_1PASSWORD_VAULT) || 'PixAI Release'
const onePasswordPrivateKeyTitle = readStringOption(process.env.PIXAI_1PASSWORD_UPDATER_KEY_TITLE) || 'PixAI updater.key'
const onePasswordPublicKeyTitle = readStringOption(process.env.PIXAI_1PASSWORD_UPDATER_PUBKEY_TITLE) || 'PixAI updater.key.pub'

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
      await buildReleaseUpdater()
      return
    case 'pull-key':
      await pullReleaseUpdaterKey()
      return
    case 'manifest':
      await stageReleaseUpdater()
      return
    case 'publish':
      await publishReleaseUpdater()
      return
    case 'publish-staged':
      await publishStagedReleaseUpdater()
      return
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp()
  }
}

async function buildReleaseUpdater() {
  await ensureKeypair({ force: false })
  await assertConfiguredPubkey()
  const version = await resolveVersion()
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY || await readFile(keyPath, 'utf8')
  const tempConfig = {
    version,
    bundle: {
      createUpdaterArtifacts: true
    }
  }

  await ensureDir(releaseUpdaterDir)
  await writeFile(tempConfigPath, JSON.stringify(tempConfig, null, 2))

  console.log(`Building signed production updater package ${version}`)
  console.log(`Signing key: ${relative(rootDir, keyPath)}`)

  await runCommand('pnpm', [
    'tauri',
    'build',
    '--config',
    tempConfigPath,
    '--ci',
    ...macosBuildTargetArgs()
  ], {
    cwd: rootDir,
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey
    }
  })

  console.log('Signed production build finished.')
}

async function pullReleaseUpdaterKey() {
  const outputKeyPath = keyPath
  const outputPubKeyPath = pubKeyPath

  await ensureDir(dirname(outputKeyPath))
  const privateKeyDocumentId = await resolveOnePasswordDocumentId(onePasswordPrivateKeyTitle)
  const publicKeyDocumentId = await resolveOnePasswordDocumentId(onePasswordPublicKeyTitle)

  console.log(`Pulling updater key from 1Password vault "${onePasswordVault}"`)
  await runCommand('op', [
    'document',
    'get',
    privateKeyDocumentId,
    '--vault',
    onePasswordVault,
    '--force',
    '--out-file',
    outputKeyPath
  ], { cwd: rootDir, env: process.env, shell: false })

  await runCommand('op', [
    'document',
    'get',
    publicKeyDocumentId,
    '--vault',
    onePasswordVault,
    '--force',
    '--out-file',
    outputPubKeyPath
  ], { cwd: rootDir, env: process.env, shell: false })

  console.log(`Private key: ${relative(rootDir, outputKeyPath)}`)
  console.log(`Public key: ${relative(rootDir, outputPubKeyPath)}`)
}

async function resolveOnePasswordDocumentId(title) {
  const raw = await runCommandCapture('op', [
    'item',
    'list',
    '--vault',
    onePasswordVault,
    '--categories',
    'DOCUMENT'
  ], {
    cwd: rootDir,
    env: {
      ...process.env,
      OP_FORMAT: 'json'
    },
    shell: false
  })
  const items = JSON.parse(raw || '[]')
  const match = items.find((item) => item?.title === title)
  if (!match?.id) {
    throw new Error(`1Password document "${title}" was not found in vault "${onePasswordVault}".`)
  }
  return match.id
}

async function stageReleaseUpdater() {
  await ensureKeypair({ force: false })
  await assertConfiguredPubkey()

  const version = await resolveVersion()
  const tag = resolveTag(version)
  const artifacts = await findUpdaterArtifacts({ srcTauriDir, version, macosArch: readMacosArchOption() })
  if (!hasUpdaterArtifacts(artifacts)) {
    throw new Error(
      `No signed updater bundle found for version ${version}. Run "pnpm updater:release:build -- --version ${version}" first.`
    )
  }

  const releaseMetadata = await readReleaseMetadata(tag)
  const notes = readStringOption(options.notes)
    || releaseMetadata?.body?.trim()
    || `PixAI ${version}`
  const pubDate = readStringOption(options.pubDate)
    || releaseMetadata?.publishedAt
    || new Date().toISOString()

  const releaseDir = join(stagingDir, version)
  const existingManifest = await readExistingLatestManifest(tag)
  await rm(releaseDir, { recursive: true, force: true })
  await mkdir(releaseDir, { recursive: true })

  const { platforms, copiedAssets } = await stageUpdaterArtifacts({
    artifacts,
    destinationDir: releaseDir,
    urlForFilename: (filename) => `${githubReleaseBaseUrl}/${encodeURIComponent(tag)}/${filename}`
  })

  const manifestPath = join(releaseDir, 'latest.json')
  const latestJson = mergeLatestManifest(existingManifest, {
    version,
    notes,
    pub_date: pubDate,
    platforms
  })

  await writeLatestManifest(manifestPath, latestJson)

  console.log(`Staged production updater manifest for ${version}`)
  console.log(`Manifest: ${relative(rootDir, manifestPath)}`)
  for (const asset of copiedAssets) {
    const target = asset.platformTarget ? ` (${asset.platformTarget})` : ''
    console.log(`Asset ${asset.label}${target}: ${relative(rootDir, asset.path)}`)
  }
  if (existingManifest?.version && normalizeVersion(existingManifest.version) === version) {
    console.log(`Merged existing latest.json platforms: ${Object.keys(existingManifest.platforms || {}).join(', ') || 'none'}`)
  }
  if (!releaseMetadata) {
    console.log(`Release metadata fallback: notes/pub_date were generated locally for tag ${tag}`)
  }

  return {
    tag,
    version,
    manifestPath,
    assetPaths: copiedAssets.map((asset) => asset.path)
  }
}

async function publishReleaseUpdater() {
  const { tag, version, manifestPath, assetPaths } = await stageReleaseUpdater()
  await requireGithubRelease(tag)

  console.log(`Uploading production updater assets to GitHub release ${tag}`)
  await runCommand('gh', [
    'release',
    'upload',
    tag,
    manifestPath,
    ...assetPaths,
    '--clobber'
  ], { cwd: rootDir, env: process.env })

  console.log(`Release ${tag} now includes latest.json for signed updater checks.`)
  console.log(`Endpoint: https://github.com/${githubRepo}/releases/latest/download/latest.json`)
  console.log(`Version: ${version}`)
}

async function publishStagedReleaseUpdater() {
  const { tag, version, manifestPath, assetPaths } = await stageDownloadedReleaseUpdater()
  await requireGithubRelease(tag)

  console.log(`Uploading merged production updater assets to GitHub release ${tag}`)
  await runCommand('gh', [
    'release',
    'upload',
    tag,
    manifestPath,
    ...assetPaths,
    '--clobber'
  ], { cwd: rootDir, env: process.env })

  console.log(`Release ${tag} now includes merged latest.json for signed updater checks.`)
  console.log(`Endpoint: https://github.com/${githubRepo}/releases/latest/download/latest.json`)
  console.log(`Version: ${version}`)
}

async function stageDownloadedReleaseUpdater() {
  const version = await resolveVersion()
  const tag = resolveTag(version)
  const inputDir = resolve(rootDir, readStringOption(options.inputDir || options['input-dir']) || join(releaseUpdaterDir, 'ci-staging'))
  const latestManifestPaths = await findLatestManifestPaths(inputDir)

  if (latestManifestPaths.length === 0) {
    throw new Error(`No staged latest.json files found in ${relative(rootDir, inputDir)}.`)
  }

  const releaseMetadata = await readReleaseMetadata(tag)
  const releaseDir = join(stagingDir, version)
  const existingManifest = await readExistingLatestManifest(tag)
  let latestJson = existingManifest?.version && normalizeVersion(existingManifest.version) === version
    ? existingManifest
    : null
  const copiedAssetPaths = new Map()

  await rm(releaseDir, { recursive: true, force: true })
  await mkdir(releaseDir, { recursive: true })

  for (const manifestPath of latestManifestPaths) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (normalizeVersion(manifest?.version) !== version) {
      throw new Error(`${relative(rootDir, manifestPath)} is for version ${manifest?.version || '<missing>'}, expected ${version}.`)
    }

    latestJson = mergeLatestManifest(latestJson, manifest)

    const manifestDir = dirname(manifestPath)
    const entries = await readdir(manifestDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === 'latest.json') continue
      const sourcePath = join(manifestDir, entry.name)
      const destinationPath = join(releaseDir, entry.name)
      await cp(sourcePath, destinationPath)
      copiedAssetPaths.set(entry.name, destinationPath)
    }
  }

  const notes = readStringOption(options.notes)
    || releaseMetadata?.body?.trim()
    || latestJson?.notes
    || `PixAI ${version}`
  const pubDate = readStringOption(options.pubDate)
    || releaseMetadata?.publishedAt
    || latestJson?.pub_date
    || new Date().toISOString()
  const finalManifest = {
    ...(latestJson || {}),
    version,
    notes,
    pub_date: pubDate,
    platforms: latestJson?.platforms || {}
  }
  assertRequiredPlatforms(finalManifest)
  const finalManifestPath = join(releaseDir, 'latest.json')
  await writeLatestManifest(finalManifestPath, finalManifest)

  console.log(`Merged staged production updater assets for ${version}`)
  console.log(`Manifest: ${relative(rootDir, finalManifestPath)}`)
  for (const assetPath of copiedAssetPaths.values()) {
    console.log(`Asset: ${relative(rootDir, assetPath)}`)
  }
  if (existingManifest?.version && normalizeVersion(existingManifest.version) === version) {
    console.log(`Merged existing latest.json platforms: ${Object.keys(existingManifest.platforms || {}).join(', ') || 'none'}`)
  }

  return {
    tag,
    version,
    manifestPath: finalManifestPath,
    assetPaths: [...copiedAssetPaths.values()]
  }
}

async function assertConfiguredPubkey() {
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, 'utf8'))
  const configuredPubkey = tauriConfig?.plugins?.updater?.pubkey?.trim?.() || ''
  const configuredEndpoints = tauriConfig?.plugins?.updater?.endpoints || []
  const actualPubkey = (await readFile(pubKeyPath, 'utf8')).trim()

  if (!configuredPubkey) {
    throw new Error(
      `Missing plugins.updater.pubkey in src-tauri/tauri.conf.json. Expected ${actualPubkey}`
    )
  }
  if (configuredPubkey !== actualPubkey) {
    throw new Error(
      `Configured updater pubkey does not match ${relative(rootDir, pubKeyPath)}. Update src-tauri/tauri.conf.json before publishing.`
    )
  }
  if (!Array.isArray(configuredEndpoints) || !configuredEndpoints.some((value) => typeof value === 'string' && value.includes('latest.json'))) {
    throw new Error('src-tauri/tauri.conf.json must point updater endpoints at a latest.json release feed.')
  }
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

  console.log('Generating production updater signing key...')
  await runCommand('pnpm', [
    'tauri',
    'signer',
    'generate',
    '--write-keys',
    keyPath,
    '--ci'
  ], { cwd: rootDir, env: process.env })
}

async function resolveVersion() {
  const rawVersion = readStringOption(options.version)
  if (rawVersion) return normalizeVersion(rawVersion)
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, 'utf8'))
  return normalizeVersion(String(tauriConfig.version || '0.0.0'))
}

function resolveTag(version) {
  return readStringOption(options.tag) || version
}

function macosBuildTargetArgs() {
  const arch = normalizeMacosArch(readMacosArchOption())
  if (!arch) return []
  return ['--target', `${arch}-apple-darwin`]
}

async function readReleaseMetadata(tag) {
  try {
    const raw = await runCommandCapture('gh', [
      'release',
      'view',
      tag,
      '--json',
      'body,publishedAt,url'
    ], { cwd: rootDir, env: process.env, shell: false })
    const parsed = JSON.parse(raw || '{}')
    return {
      body: typeof parsed.body === 'string' ? parsed.body : '',
      publishedAt: typeof parsed.publishedAt === 'string' ? parsed.publishedAt : null,
      url: typeof parsed.url === 'string' ? parsed.url : null
    }
  } catch {
    return null
  }
}

async function readExistingLatestManifest(tag) {
  try {
    const raw = await runCommandCapture('gh', [
      'release',
      'download',
      tag,
      '--pattern',
      'latest.json',
      '--output',
      '-'
    ], { cwd: rootDir, env: process.env, shell: false })
    if (raw) return JSON.parse(raw)
  } catch {
    // Fall back to the public release asset URL for environments without gh auth.
  }

  const url = `${githubReleaseBaseUrl}/${encodeURIComponent(tag)}/latest.json`
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function findLatestManifestPaths(root) {
  const results = []

  async function walk(directory) {
    const entries = await safeReaddir(directory)
    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      if (entry.isFile() && entry.name === 'latest.json') {
        results.push(entryPath)
      }
    }
  }

  await walk(root)
  return results.sort()
}

function assertRequiredPlatforms(manifest) {
  const requiredPlatforms = readStringListOption(options.requirePlatforms || options['require-platforms'])
  if (requiredPlatforms.length === 0) return

  const platforms = manifest?.platforms || {}
  const missingPlatforms = requiredPlatforms.filter((platform) => !platforms[platform])
  if (missingPlatforms.length > 0) {
    throw new Error(`Merged latest.json is missing required platforms: ${missingPlatforms.join(', ')}`)
  }
}

async function safeReaddir(path) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

async function requireGithubRelease(tag) {
  try {
    await runCommandCapture('gh', [
      'release',
      'view',
      tag,
      '--json',
      'tagName'
    ], { cwd: rootDir, env: process.env, shell: false })
  } catch {
    throw new Error(
      `GitHub release ${tag} does not exist yet. Create it first, then rerun "pnpm updater:release:publish -- --version ${tag} --tag ${tag}".`
    )
  }
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

function normalizeVersion(version) {
  return String(version).trim().replace(/^v/i, '')
}

function resolveKeyPath() {
  const configuredPath = readStringOption(process.env.PIXAI_RELEASE_UPDATER_KEY_PATH)
    || readStringOption(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH)
    || defaultKeyPath
  return resolve(rootDir, configuredPath)
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

function readStringListOption(value) {
  const rawValue = readStringOption(value)
  if (!rawValue) return []
  return rawValue.split(',').map((item) => item.trim()).filter(Boolean)
}

function readMacosArchOption() {
  return readStringOption(options.macosArch || options['macos-arch'] || options.arch)
}

function normalizeMacosArch(value) {
  if (value === 'arm64') return 'aarch64'
  if (value === 'x64') return 'x86_64'
  if (value === 'aarch64' || value === 'x86_64') return value
  if (!value) return null
  throw new Error(`Unsupported macOS arch "${value}". Use aarch64, arm64, x86_64, or x64.`)
}

async function runCommand(command, args, { cwd, env, shell = process.platform === 'win32' }) {
  const commandLine = [command, ...args].join(' ')
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
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

async function runCommandCapture(command, args, { cwd, env, shell = process.platform === 'win32' }) {
  const commandLine = [command, ...args].join(' ')
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectPromise)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim())
      } else {
        rejectPromise(new Error(stderr.trim() || `Command failed: ${commandLine}`))
      }
    })
  })
}

function printHelp() {
  console.log(`Production updater helper

Commands:
  pnpm updater:release:keygen
  pnpm updater:release:pull-key
  pnpm updater:release:build -- --version 0.0.3
  pnpm updater:release:manifest -- --version 0.0.3 --tag 0.0.3
  pnpm updater:release:publish -- --version 0.0.3 --tag 0.0.3
  pnpm updater:release:publish-staged -- --version 0.0.3 --tag 0.0.3 --input-dir artifacts/release-updater/ci-staging --require-platforms windows-x86_64-msi,windows-x86_64-nsis,darwin-aarch64,darwin-x86_64

Notes:
  - Keep artifacts/release-updater/keys/updater.key private and stable across releases.
  - pull-key reads "PixAI updater.key" and "PixAI updater.key.pub" from the "PixAI Release" vault by default.
  - src-tauri/tauri.conf.json must contain the matching updater public key.
  - publish uploads latest.json plus the matching Windows and/or macOS assets to an existing GitHub release.
  - publish-staged merges staged assets generated by CI matrix jobs, then uploads the combined latest.json/assets.
  - publish-staged --require-platforms fails before upload when any required platform key is missing.
  - latest.json is merged with an existing same-version release manifest so split Windows/macOS publishing keeps prior platform entries.
  - Use --macos-arch aarch64 or --macos-arch x86_64 when publishing cross-compiled macOS bundles.
`)
}

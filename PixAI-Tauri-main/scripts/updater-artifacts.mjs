import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'

export const windowsMsiTarget = 'windows-x86_64-msi'
export const windowsNsisTarget = 'windows-x86_64-nsis'
export const darwinX64Target = 'darwin-x86_64'
export const darwinArm64Target = 'darwin-aarch64'

const macosArchTargets = {
  aarch64: darwinArm64Target,
  x86_64: darwinX64Target
}

export async function findUpdaterArtifacts({ srcTauriDir, version, macosArch = null }) {
  const roots = bundleRoots(srcTauriDir, macosArch)
  const defaultBundleDir = roots.find((root) => root.kind === 'default')?.bundleDir || join(srcTauriDir, 'target', 'release', 'bundle')
  const msi = await findMsiUpdaterArtifact(defaultBundleDir, version)
  const nsis = await findNsisUpdaterArtifact(defaultBundleDir, version)
  const macos = await findMacosUpdaterArtifacts(roots, version)

  return {
    msi,
    nsis,
    macos,
    updaterArtifacts: [
      msi,
      nsis,
      ...macos
    ].filter(Boolean)
  }
}

export function hasUpdaterArtifacts(artifacts) {
  return artifacts.updaterArtifacts.length > 0
}

export async function stageUpdaterArtifacts({ artifacts, destinationDir, urlForFilename }) {
  await mkdir(destinationDir, { recursive: true })

  const platforms = {}
  const copiedAssets = []

  for (const artifact of artifacts.updaterArtifacts) {
    const destinationArtifact = join(destinationDir, artifact.releaseFilename)
    await cp(artifact.path, destinationArtifact)
    copiedAssets.push({
      path: destinationArtifact,
      label: artifact.label,
      platformTarget: artifact.target
    })
    const signature = (await readFile(artifact.signaturePath, 'utf8')).trim()
    platforms[artifact.target] = {
      url: urlForFilename(artifact.releaseFilename),
      signature
    }

    for (const manualAsset of artifact.manualAssets || []) {
      const destinationManualAsset = join(destinationDir, manualAsset.releaseFilename)
      await cp(manualAsset.path, destinationManualAsset)
      copiedAssets.push({
        path: destinationManualAsset,
        label: manualAsset.label,
        platformTarget: null
      })
    }
  }

  return {
    platforms,
    copiedAssets
  }
}

export function mergeLatestManifest(existingManifest, nextManifest) {
  if (!existingManifest?.version) return nextManifest

  const existingVersion = normalizeVersion(existingManifest.version)
  const nextVersion = normalizeVersion(nextManifest.version)
  if (existingVersion !== nextVersion) return nextManifest

  return {
    ...existingManifest,
    ...nextManifest,
    version: nextManifest.version,
    notes: nextManifest.notes ?? existingManifest.notes,
    pub_date: nextManifest.pub_date ?? existingManifest.pub_date,
    platforms: {
      ...(existingManifest.platforms || {}),
      ...(nextManifest.platforms || {})
    }
  }
}

export async function writeLatestManifest(path, manifest) {
  await writeFile(path, JSON.stringify(manifest, null, 2))
}

export async function readJsonFileIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export function describeArtifacts(artifacts, rootDir) {
  return artifacts.updaterArtifacts.map((artifact) => ({
    label: artifact.label,
    target: artifact.target,
    path: relative(rootDir, artifact.path),
    signaturePath: relative(rootDir, artifact.signaturePath),
    manualAssets: (artifact.manualAssets || []).map((asset) => relative(rootDir, asset.path))
  }))
}

async function findNsisUpdaterArtifact(bundleDir, version) {
  const nsisDir = join(bundleDir, 'nsis')
  const entries = await safeReaddir(nsisDir)
  const expectedPrefix = `PixAI_${version}_`

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(expectedPrefix)) continue
    if (!entry.name.endsWith('-setup.exe')) continue
    const artifactPath = join(nsisDir, entry.name)
    const signaturePath = `${artifactPath}.sig`
    if (!await pathExists(signaturePath)) continue
    return {
      kind: 'nsis',
      label: 'NSIS',
      target: windowsNsisTarget,
      filename: entry.name,
      releaseFilename: entry.name,
      path: artifactPath,
      signaturePath,
      manualAssets: []
    }
  }

  return null
}

async function findMsiUpdaterArtifact(bundleDir, version) {
  const msiDir = join(bundleDir, 'msi')
  const entries = await safeReaddir(msiDir)
  const expectedPrefix = `PixAI_${version}_`

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(expectedPrefix)) continue
    if (extname(entry.name).toLowerCase() !== '.msi') continue
    const artifactPath = join(msiDir, entry.name)
    const signaturePath = `${artifactPath}.sig`
    if (!await pathExists(signaturePath)) continue
    return {
      kind: 'msi',
      label: 'MSI',
      target: windowsMsiTarget,
      filename: entry.name,
      releaseFilename: entry.name,
      path: artifactPath,
      signaturePath,
      manualAssets: []
    }
  }

  return null
}

async function findMacosUpdaterArtifacts(roots, version) {
  const artifacts = []
  const seenTargets = new Set()

  for (const root of roots) {
    if (!root.arch || seenTargets.has(macosArchTargets[root.arch])) continue
    const artifact = await findMacosUpdaterArtifact(root.bundleDir, version, root.arch)
    if (!artifact) continue
    artifacts.push(artifact)
    seenTargets.add(artifact.target)
  }

  return artifacts
}

async function findMacosUpdaterArtifact(bundleDir, version, arch) {
  const macosDir = join(bundleDir, 'macos')
  const dmgDir = join(bundleDir, 'dmg')
  const macosEntries = await safeReaddir(macosDir)
  const dmgEntries = await safeReaddir(dmgDir)
  const updaterEntry = macosEntries.find((entry) => entry.isFile() && /\.app\.tar\.gz$/i.test(entry.name))

  if (!updaterEntry) return null

  const artifactPath = join(macosDir, updaterEntry.name)
  const signaturePath = `${artifactPath}.sig`
  if (!await pathExists(signaturePath)) return null

  const archLabel = arch === 'x86_64' ? 'x64' : arch
  const manualAssets = [
    ...macosEntries.map((entry) => ({ entry, directory: macosDir })),
    ...dmgEntries.map((entry) => ({ entry, directory: dmgDir }))
  ]
    .filter(({ entry }) => entry.isFile() && extname(entry.name).toLowerCase() === '.dmg')
    .filter(({ entry }) => macosFileMatchesArch(entry.name, arch))
    .map(({ entry, directory }) => {
      const releaseFilename = macosReleaseFilename(entry.name, version, archLabel, '.dmg')
      return {
        kind: 'dmg',
        label: 'DMG',
        filename: entry.name,
        releaseFilename,
        path: join(directory, entry.name)
      }
    })

  return {
    kind: 'macos',
    label: `macOS ${arch}`,
    target: macosArchTargets[arch],
    filename: updaterEntry.name,
    releaseFilename: macosReleaseFilename(updaterEntry.name, version, archLabel, '.app.tar.gz'),
    path: artifactPath,
    signaturePath,
    manualAssets
  }
}

function bundleRoots(srcTauriDir, macosArch) {
  const roots = [
    {
      kind: 'default',
      arch: normalizeMacosArch(macosArch) || hostMacosArch(),
      bundleDir: join(srcTauriDir, 'target', 'release', 'bundle')
    }
  ]

  for (const arch of ['aarch64', 'x86_64']) {
    if (macosArch && normalizeMacosArch(macosArch) !== arch) continue
    roots.push({
      kind: arch,
      arch,
      bundleDir: join(srcTauriDir, 'target', `${arch}-apple-darwin`, 'release', 'bundle')
    })
  }

  return roots
}

function macosReleaseFilename(filename, version, archLabel, extension) {
  const name = basename(filename)
  if (name.includes(version) && new RegExp(`macos-${archLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(name)) return name
  return `PixAI_${version}_macos-${archLabel}${extension}`
}

function macosFileMatchesArch(filename, arch) {
  if (arch === 'aarch64') return !/(?:x64|x86_64|amd64)/i.test(filename)
  if (arch === 'x86_64') return /(?:x64|x86_64|amd64)/i.test(filename)
  return true
}

function hostMacosArch() {
  if (process.platform !== 'darwin') return null
  if (process.arch === 'arm64') return 'aarch64'
  if (process.arch === 'x64') return 'x86_64'
  return null
}

function normalizeMacosArch(value) {
  if (value === 'arm64') return 'aarch64'
  if (value === 'x64') return 'x86_64'
  if (value === 'aarch64' || value === 'x86_64') return value
  return null
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '')
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function safeReaddir(path) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

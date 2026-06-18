#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const FALLBACK_BASE_URL = 'http://127.0.0.1:43117'
const PIXAI_CODEX_SKILL_NAME = 'pixai-image-workbench'
const BRIDGE_STATE_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bridge.json')

const commands = new Map([
  ['health', { method: 'GET', path: '/health' }],
  ['settings', { method: 'GET', path: '/settings' }],
  ['conversations', { method: 'GET', path: '/conversations' }],
  ['history', { method: 'GET', path: '/history', query: true }],
  ['generate', { method: 'POST', path: '/generate', body: true }],
  ['reedit', { method: 'POST', path: ({ id }) => `/images/${encodeURIComponent(id)}/reedit`, id: true, body: true }],
  ['image', { method: 'GET', path: ({ id }) => `/images/${encodeURIComponent(id)}`, id: true }],
  ['delete', { method: 'DELETE', path: ({ id }) => `/images/${encodeURIComponent(id)}`, id: true }],
  ['favorite', { method: 'PATCH', path: ({ id }) => `/images/${encodeURIComponent(id)}/favorite`, id: true, body: true }],
  ['export', { method: 'POST', path: '/images/export', body: true }],
  ['inspire', { method: 'POST', path: '/prompt/inspire', body: true, optionalBody: true }],
  ['enrich', { method: 'POST', path: '/prompt/enrich', body: true }]
])

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

async function main() {
  const [commandName, ...args] = process.argv.slice(2)
  if (!commandName || commandName === 'help' || commandName === '--help' || commandName === '-h') {
    printHelp()
    return
  }

  const command = commands.get(commandName)
  if (!command) throw new Error(`Unknown command "${commandName}". Run: pnpm codex help`)

  const options = parseArgs(args)
  const baseUrl = await resolveBridgeBaseUrl(options)
  const id = command.id ? readRequiredOption(options, 'id') : undefined
  const path = typeof command.path === 'function' ? command.path({ id }) : command.path
  const url = new URL(`${baseUrl}${path}`)

  if (command.query) {
    for (const key of ['query', 'sort', 'favoritesOnly', 'status', 'limit', 'offset', 'model', 'ratio', 'quality']) {
      if (options[key] !== undefined) url.searchParams.set(key, String(options[key]))
    }
  }

  const init = { method: command.method, headers: {} }
  if (command.body) {
    const body = await buildBody(options, command.optionalBody)
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
  }

  const response = await fetch(url, init)
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `PixAI Codex Bridge returned HTTP ${response.status}.`)
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  const text = await response.text()
  if (!response.ok) throw new Error(text || `PixAI Codex Bridge returned HTTP ${response.status}.`)
  process.stdout.write(text)
}

async function resolveBridgeBaseUrl(options) {
  const explicitUrl = options.url || process.env.PIXAI_CODEX_URL
  if (explicitUrl) return String(explicitUrl).replace(/\/+$/, '')
  const stateUrl = await readBridgeStateUrl()
  if (stateUrl) return stateUrl.replace(/\/+$/, '')
  return FALLBACK_BASE_URL
}

async function readBridgeStateUrl() {
  for (const path of bridgeStatePaths()) {
    try {
      const payload = JSON.parse(await readFile(path, 'utf8'))
      if (typeof payload.url === 'string' && payload.url.trim()) return payload.url.trim()
    } catch {
      // try the next candidate
    }
  }
  return null
}

function bridgeStatePaths() {
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  return [
    BRIDGE_STATE_PATH,
    join(codexHome, 'skills', PIXAI_CODEX_SKILL_NAME, 'bridge.json')
  ]
}

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}". Options must use --name value.`)
    const eqIndex = arg.indexOf('=')
    const key = eqIndex >= 0 ? arg.slice(2, eqIndex) : arg.slice(2)
    const inlineValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined
    const rawValue = inlineValue ?? args[index + 1]
    if (rawValue === undefined || rawValue.startsWith('--')) {
      options[key] = true
      continue
    }
    if (inlineValue === undefined) index += 1
    options[key] = parseOptionValue(rawValue)
  }
  return options
}

function parseOptionValue(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  return value
}

async function buildBody(options, optionalBody = false) {
  if (options.json !== undefined) return JSON.parse(String(options.json))
  if (options.file !== undefined) {
    return JSON.parse(await readFile(String(options.file), 'utf8'))
  }

  const body = {}
  for (const [key, value] of Object.entries(options)) {
    if (key === 'url' || key === 'id') continue
    body[key] = normalizeBodyValue(key, value)
  }

  if (Object.keys(body).length === 0) {
    if (optionalBody) return {}
    throw new Error('This command needs a JSON body. Use --json \'{"prompt":"..."}\' or --file request.json.')
  }
  return body
}

function normalizeBodyValue(key, value) {
  if (['referenceImageIds', 'referenceHistoryIds', 'referenceImagePaths', 'ids'].includes(key)) {
    if (Array.isArray(value)) return value
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return value
}

function readRequiredOption(options, key) {
  const value = options[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required option --${key}.`)
  return value
}

function printHelp() {
  console.log(`PixAI Codex Bridge client

The PixAI desktop app must be running. The client reads the current bridge URL from bridge.json, then falls back to ${FALLBACK_BASE_URL}.

Commands:
  health
  settings
  conversations
  history [--query text] [--sort newest|oldest] [--favoritesOnly true] [--status succeeded|failed]
  generate --json '{"prompt":"a glass greenhouse","ratio":"1:1","n":1}'
  generate --prompt "a glass greenhouse" --ratio 1:1 --n 1
  reedit --id <historyId> --json '{"prompt":"make it dusk"}'
  image --id <historyId>
  favorite --id <historyId> --favorite true
  delete --id <historyId>
  export --ids id1,id2 --directory C:\\Temp\\PixAI
  inspire
  enrich --prompt "short prompt"

Global:
  --url http://127.0.0.1:<port>
`)
}

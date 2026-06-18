export function nowIso(): string {
  return new Date().toISOString()
}

export function elapsedMs(startedAt: number, nowMs = Date.now()): number {
  return Math.max(0, nowMs - startedAt)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

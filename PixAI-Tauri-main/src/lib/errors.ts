export function createErrorDetails(input: unknown, stage: string, details: Record<string, unknown>): string {
  return JSON.stringify(
    {
      stage,
      input,
      details,
      createdAt: new Date().toISOString()
    },
    null,
    2
  )
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  }
  return { value: String(error) }
}

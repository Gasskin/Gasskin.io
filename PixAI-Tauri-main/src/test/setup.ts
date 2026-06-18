import { afterEach } from 'vitest'
import { __resetPlatformStateForTests } from '../lib/platform'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  __resetPlatformStateForTests()
})

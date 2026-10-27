import { browserBackend } from './browser'
import { httpBackend } from './http'
import type { Backend } from './types'

/**
 * `npm run build:artifact` sets VITE_TARGET=artifact (claude.ai), `npm run build:demo` sets
 * VITE_TARGET=demo (standalone page); every other build talks to the FastAPI server.
 */
export const backend: Backend = import.meta.env.VITE_TARGET === 'server' ? httpBackend : browserBackend
export type { Backend }

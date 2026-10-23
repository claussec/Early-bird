import { artifactBackend } from './artifact'
import { httpBackend } from './http'
import type { Backend } from './types'

/** `npm run build:artifact` sets VITE_TARGET=artifact; every other build talks to the FastAPI server. */
export const backend: Backend = import.meta.env.VITE_TARGET === 'artifact' ? artifactBackend : httpBackend
export type { Backend }

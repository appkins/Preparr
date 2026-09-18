import type { TdarrFlow } from '@/config/schema'
import type { Plain } from './match'

/**
 * Find the stored flow a declaration refers to.
 *
 * A flow document declares its id, or a library names a flow. A declared id
 * is an instruction and is matched on nothing else: falling back to the name
 * would adopt some other flow and then rewrite it. A library's reference is
 * looser, since it is a name typed by a person -- name first, then id.
 */
export function findFlow<T extends { _id: string; name: string }>(
  stored: T[],
  flow: TdarrFlow | string,
): T | undefined {
  if (typeof flow === 'string') {
    return stored.find((f) => f.name === flow) ?? stored.find((f) => f._id === flow)
  }
  if (flow._id !== undefined) {
    return stored.find((f) => f._id === flow._id)
  }
  return stored.find((f) => f.name === flow.name)
}

/** The flow without its id, which names the document rather than describing it. */
export function desiredFlow(flow: TdarrFlow): Plain {
  const { _id, ...rest } = flow
  const desired: Plain = {}
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      desired[key] = value
    }
  }
  return desired
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

/** An id of the shape Tdarr's own shortid makes. */
export function generateId(length = 9): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

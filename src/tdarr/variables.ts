/**
 * User variables, which flows read as {{{args.userVariables.global.<key>}}}
 * or {{{args.userVariables.library.<key>}}}.
 *
 * Each is its own document: a key, a value, and a type that is either
 * "global" or "library:<library id>". The workers build the two maps from
 * those types, so a variable's scope is the type string and nothing else.
 */

export interface TdarrVariable {
  _id: string
  key?: string
  value: unknown
  type: string
  date?: number
  [key: string]: unknown
}

export interface VariableWrite {
  key: string
  value: string
  type: string
}

export interface VariablePlan {
  create: VariableWrite[]
  update: (VariableWrite & { _id: string })[]
}

export type VariableValues = Record<string, string | number | boolean>

/** The scope string for a library's variables. */
export const libraryScope = (libraryId: string): string => `library:${libraryId}`

/**
 * What to write so that every declared variable in the scope holds its value.
 *
 * Values are stored and compared as text, which is what the flow editor
 * stores and what the worker substitutes into a plugin input. Anything Tdarr
 * holds in the scope that is not declared is left alone.
 */
export function planVariables(
  current: TdarrVariable[],
  desired: VariableValues,
  type: string,
): VariablePlan {
  const plan: VariablePlan = { create: [], update: [] }
  const scoped = current.filter((v) => v.type === type)

  for (const [key, raw] of Object.entries(desired)) {
    const value = String(raw)
    const have = scoped.find((v) => (v.key ?? v._id) === key)

    if (!have) {
      plan.create.push({ key, value, type })
    } else if (String(have.value) !== value) {
      plan.update.push({ _id: have._id, key, value, type })
    }
  }

  return plan
}

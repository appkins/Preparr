/**
 * What, if anything, the admin user needs.
 *
 * Separated from the step so the decision can be tested without a database,
 * and separated from createInitialUser because that call does three different
 * things -- create, re-hash a changed password, and delete users left over --
 * and the step has to know whether any of them is actually outstanding.
 *
 * Without this the step read its own current state as a literal `false` and
 * planned a creation on every pass: a change reported for ever, and a log line
 * claiming a user had been created when the call had found one and returned.
 */

export interface AdminUserState {
  exists: boolean

  /** Whether the stored hash is the configured password. */
  passwordCurrent: boolean

  /**
   * Users that are not the configured admin. More than one user makes
   * Prowlarr fail authentication with "Sequence contains more than one
   * element", so these are work even when the admin itself is correct.
   */
  duplicates: number
}

export function adminUserAction(state: AdminUserState): 'create' | 'update' | null {
  if (!state.exists) {
    return 'create'
  }

  if (!state.passwordCurrent || state.duplicates > 0) {
    return 'update'
  }

  return null
}

/**
 * Whether a value read back from an app is a mask rather than the value.
 *
 * The Servarr apps will not disclose a secret they hold: an API key set to
 * a real value reads back as "********". Comparing that to the key that was
 * sent always differs, so a client carrying one was judged out of date on
 * every pass -- and since an update is performed as a delete followed by an
 * add, the client was destroyed and recreated on a loop, taking its id, and
 * with it whatever the app had associated to that id, each time.
 *
 * A masked value carries no information, so the only sound reading is that
 * nothing is known to have changed.
 */

const MASK = /^\*+$/

export function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && MASK.test(value)
}

/**
 * The sync confirmation's "don't ask again" switch.
 *
 * A presentation preference, so it lives where the resizer widths and the
 * stacked split already live: `localStorage`, read per press. Storage can be
 * unavailable (private mode, a sandboxed origin); the sync then keeps asking
 * rather than silently merging, because an unreadable answer must never
 * authorize a history-changing write.
 */

const KEY = 'gp.sync.noAsk'

/**
 * Whether the reader asked to skip the next sync confirmations.
 * @returns `true` only when the stored value is exactly `'1'`.
 */
export function readSyncNoAsk(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Remember (or forget) the "don't ask again" answer.
 * @param value - whether the confirmations are suppressed from now on.
 */
export function writeSyncNoAsk(value: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (value) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable — the switch just won't save */
  }
}

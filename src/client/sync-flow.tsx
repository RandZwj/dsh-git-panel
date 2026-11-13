/**
 * The diverged-branch sync's confirmation and its "don't ask again" answer.
 *
 * Two surfaces offer the same write — the overview's status bar and the changes
 * toolbar — and both must ask the same question, remember the same preference,
 * and report into their own busy/error slots. This hook owns exactly the shared
 * half: the dialog, the preference, and the decision to skip the question. The
 * sequence itself (`branch-merge` then `push`) belongs to the caller, because
 * each tab runs it through its own operation envelope.
 */
import { createElement as h, useCallback, useState } from 'react'
import type { JSX } from 'react'
import type { GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'
import { canSync } from './push-policy.js'
import { readSyncNoAsk, writeSyncNoAsk } from './sync-preference.js'
import { renderConfirmModal } from './ops-modals.js'

type Translate = (key: GitKey, params?: Record<string, string | number>) => string

/** What the sync flow needs from the tab that hosts it. */
export interface SyncFlowOptions {
  readonly snapshot: GitSnapshot
  /** The host tab's in-flight flag (drives the dialog's confirm button). */
  readonly busy: boolean
  /** The host tab's error line; shown inside the dialog while it is open. */
  readonly error: string | null
  readonly t: Translate
  /** Runs the merge-then-push sequence through the caller's own envelope. */
  readonly onRun: () => void | Promise<void>
}

/** The pieces a tab renders and wires. */
export interface SyncFlow {
  /** Whether this snapshot offers the sync at all. */
  readonly enabled: boolean
  /** Whether the confirmation is currently on screen (for dialog gating). */
  readonly open: boolean
  /** The status-bar / toolbar entry: ask first, or run when already answered. */
  readonly request: () => void
  /** The confirmation dialog, or null. */
  readonly dialog: JSX.Element | null
}

/**
 * Wire the sync confirmation for one tab.
 * @param options - the snapshot, the tab's busy/error slots, copy and the run.
 * @returns the entry, the dialog and its open flag.
 */
export function useSyncFlow(options: SyncFlowOptions): SyncFlow {
  const { snapshot, busy, error, t, onRun } = options
  const [open, setOpen] = useState(false)
  // The checkbox's live value while the dialog is open; it starts unchecked on
  // every open, so a remembered answer can only come from this press.
  const [noAsk, setNoAsk] = useState(false)
  const enabled = canSync(snapshot)

  const request = useCallback((): void => {
    if (!canSync(snapshot)) return
    // Storage that cannot answer keeps asking: an unreadable preference must
    // never authorize a history-changing write.
    if (readSyncNoAsk()) { void onRun(); return }
    setNoAsk(false)
    setOpen(true)
  }, [snapshot, onRun])

  const dialog = open && snapshot.upstream !== undefined
    ? renderConfirmModal({
      title: t('sync.title'),
      body: t('sync.body', {
        branch: snapshot.branch ?? t('switch.detached'),
        remote: snapshot.upstream.remote,
        upstream: snapshot.upstream.branch,
        ahead: snapshot.ahead,
        behind: snapshot.behind,
      }) + (snapshot.dirty ? `\n\n${t('ops.dirtyWarn')}` : ''),
      extra: h('label', { key: 'noask', className: 'gp-confirm__noask' }, [
        h('input', {
          key: 'cb', type: 'checkbox', className: 'gp-check', checked: noAsk,
          onChange: () => setNoAsk((value) => !value),
        }),
        h('span', { key: 't' }, t('sync.noAsk')),
      ]),
      confirmLabel: t('sync.confirm'),
      danger: false,
      error,
      confirmBusy: busy,
      busyLabel: t('status.syncing'),
      onConfirm: () => {
        if (noAsk) writeSyncNoAsk(true)
        setOpen(false)
        void onRun()
      },
      onClose: () => setOpen(false),
      t,
    })
    : null

  return { enabled, open, request, dialog }
}

/**
 * The sync confirmation's remembered answer.
 *
 * It lives in `localStorage`, which the panel cannot always read. The two
 * behaviours that matter: a stored answer is remembered exactly, and an
 * unreadable storage reads as "ask again" (never as "already answered").
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSyncNoAsk, writeSyncNoAsk } from '../../lib/testkit.mjs'

/** A minimal Storage stand-in. */
function stubStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    size: () => map.size,
  }
}

test('the answer round-trips and can be forgotten', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  globalThis.localStorage = stubStorage()
  try {
    assert.equal(readSyncNoAsk(), false, 'nothing stored yet')
    writeSyncNoAsk(true)
    assert.equal(readSyncNoAsk(), true)
    writeSyncNoAsk(false)
    assert.equal(readSyncNoAsk(), false, 'unchecking forgets the answer')
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', previous)
  }
})

test('an unavailable storage keeps asking', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  delete globalThis.localStorage
  try {
    assert.equal(readSyncNoAsk(), false)
    writeSyncNoAsk(true)
    assert.equal(readSyncNoAsk(), false)
  } finally {
    if (previous !== undefined) Object.defineProperty(globalThis, 'localStorage', previous)
  }
})

test('a throwing storage is read as unanswered', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  globalThis.localStorage = {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
    removeItem: () => { throw new Error('denied') },
  }
  try {
    assert.equal(readSyncNoAsk(), false)
    writeSyncNoAsk(true)
    assert.equal(readSyncNoAsk(), false)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', previous)
  }
})

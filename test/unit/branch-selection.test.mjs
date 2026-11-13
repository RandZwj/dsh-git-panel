/**
 * Branch-list selection: the pure rules behind Ctrl/⌘ multi-select, Shift
 * ranges, pruning on a new snapshot, and a directory row's branch set.
 *
 * The panel keeps the state; these helpers decide what a gesture means, so the
 * row rendering stays a projection and the edge cases (anchor outside the
 * visible rows, a name that disappeared, a directory whose own branch shares
 * its path) are asserted without a DOM.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { branchNamesUnderDir, branchSelectionRange, buildBranchTree, pruneBranchSelection, toggleBranchSelection } from '../../lib/testkit.mjs'

const b = (name) => ({ name, shortHash: 'abc1234', ref: `refs/heads/${name}` })

test('toggle adds then removes, preserving pick order', () => {
  assert.deepEqual(toggleBranchSelection([], 'a'), ['a'])
  assert.deepEqual(toggleBranchSelection(['a', 'b'], 'c'), ['a', 'b', 'c'])
  assert.deepEqual(toggleBranchSelection(['a', 'b', 'c'], 'b'), ['a', 'c'])
})

test('a range covers the visible rows between anchor and target, either direction', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepEqual(branchSelectionRange(order, 'b', 'd'), ['b', 'c', 'd'])
  assert.deepEqual(branchSelectionRange(order, 'd', 'a'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(branchSelectionRange(order, 'b', 'b'), ['b'])
})

test('a range without a usable anchor selects just the target', () => {
  const order = ['a', 'b', 'c']
  assert.deepEqual(branchSelectionRange(order, null, 'c'), ['c'])
  assert.deepEqual(branchSelectionRange(order, 'gone', 'c'), ['c'], 'anchored outside the visible rows')
  assert.deepEqual(branchSelectionRange(order, 'a', 'gone'), [], 'the target is not a visible row')
})

test('pruning drops names a new snapshot no longer lists, keeping order', () => {
  const names = new Set(['a', 'c'])
  assert.deepEqual(pruneBranchSelection(['a', 'b', 'c'], names), ['a', 'c'])
  assert.deepEqual(pruneBranchSelection(['a'], names), ['a'])
  assert.deepEqual(pruneBranchSelection(['x'], names), [])
})

test('a directory collects every branch below it, its own same-named branch included', () => {
  const tree = buildBranchTree([b('feature/a'), b('feature/b/x'), b('feature/b/y'), b('fix/z')])
  assert.deepEqual(branchNamesUnderDir(tree, 'feature'), ['feature/a', 'feature/b/x', 'feature/b/y'])
  assert.deepEqual(branchNamesUnderDir(tree, 'feature/b'), ['feature/b/x', 'feature/b/y'])

  // A branch whose name equals a directory path is that directory's `self`
  // row: it still belongs to the directory's set.
  const withSelf = buildBranchTree([b('feature'), b('feature/a')])
  assert.deepEqual(branchNamesUnderDir(withSelf, 'feature'), ['feature', 'feature/a'])
})

test('a missing or leaf path yields no directory set', () => {
  const tree = buildBranchTree([b('feature/a'), b('main')])
  assert.deepEqual(branchNamesUnderDir(tree, 'nope'), [])
  assert.deepEqual(branchNamesUnderDir(tree, 'main'), [], 'a leaf row is not a directory')
})

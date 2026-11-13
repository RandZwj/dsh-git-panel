/**
 * Selection model for the branch list: which local branches the reader picked.
 *
 * Rows keep their original meaning — a plain click filters the history — so
 * selection is an explicit modifier gesture: Ctrl/⌘+click toggles one row,
 * Shift+click extends from the anchor over the rows the reader can see. A
 * directory row toggles every local branch below it. Keys are branch names,
 * never object identities: the list is rebuilt on every snapshot, and a name
 * that disappeared must simply leave the selection (see
 * {@link pruneBranchSelection}).
 *
 * Pure on purpose: the panel keeps the state, the rows only report gestures,
 * and the rules are unit-tested without a DOM.
 */
import type { BranchTreeNode } from './branch-tree.js'

/** Local branch names the reader picked, in pick order. */
export type BranchSelection = readonly string[]

/**
 * Toggle one branch in or out of the selection.
 * @param selected - current selection.
 * @param name - the row's local branch name.
 * @returns the next selection (identity preserved when nothing changes).
 */
export function toggleBranchSelection(selected: BranchSelection, name: string): BranchSelection {
  return selected.includes(name) ? selected.filter((entry) => entry !== name) : [...selected, name]
}

/**
 * Replace the selection with the visible range between an anchor and a target.
 * @param order - visible local branch names, in row order.
 * @param anchor - the row the previous selection started at, or null.
 * @param target - the row Shift was released on.
 * @returns the inclusive range, or just the target when the anchor is not visible.
 */
export function branchSelectionRange(order: readonly string[], anchor: string | null, target: string): BranchSelection {
  const to = order.indexOf(target)
  const from = anchor === null ? -1 : order.indexOf(anchor)
  if (to < 0) return []
  if (from < 0) return [target]
  return order.slice(Math.min(from, to), Math.max(from, to) + 1)
}

/**
 * Drop names the current snapshot no longer lists (deleted, renamed, or checked
 * out as a tag): a stale name must never reach a delete request.
 * @param selected - current selection.
 * @param names - local branch names the snapshot currently reports.
 * @returns the surviving selection (identity preserved when nothing changes).
 */
export function pruneBranchSelection(selected: BranchSelection, names: ReadonlySet<string>): BranchSelection {
  const kept = selected.filter((name) => names.has(name))
  return kept.length === selected.length ? selected : kept
}

/** Every leaf branch under one folded node, in row order. */
function leavesOf(node: BranchTreeNode, out: string[]): void {
  if (node.kind === 'leaf') { out.push(node.branch.name); return }
  if (node.self !== null) out.push(node.self.name)
  for (const child of node.children) leavesOf(child, out)
}

/**
 * Every local branch under one directory node of the folded tree — the
 * directory's own same-named branch included.
 * @param nodes - the local section's folded tree.
 * @param path - the directory node's path (what the row shows as its title).
 * @returns the branch names in row order; empty when the path names no directory.
 */
export function branchNamesUnderDir(nodes: readonly BranchTreeNode[], path: string): readonly string[] {
  const found = findDir(nodes, path)
  if (found === undefined) return []
  const out: string[] = []
  leavesOf(found, out)
  return out
}

/** Depth-first lookup of one directory node by its folded path. */
function findDir(nodes: readonly BranchTreeNode[], path: string): BranchTreeNode | undefined {
  for (const node of nodes) {
    if (node.kind !== 'dir') continue
    if (node.path === path) return node
    const nested = findDir(node.children, path)
    if (nested !== undefined) return nested
  }
  return undefined
}

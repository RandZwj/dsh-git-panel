/**
 * Additional roots registered by `@dsh-electron/dsh-plugin-multi-root-workspace`
 * (fork-local extension, not upstream).
 *
 * The plugin keeps its registry in `$DSH_HOME/storages/multi_root_workspace.json`,
 * keyed by the session's workspace root:
 *
 *   { tables: { roots: { "<workspace root>": { roots: [
 *       { path: "/abs/repo", aliasId: "repo", access: "inherit" | "read-only" | "read-write" }
 *   ] } } } }
 *
 * This module turns the entries whose `access` is not `read-only` into the same
 * shape the `.code-workspace` scan produces, so both sources feed one admission
 * door (`repoDirExternal`): a selector may leave the cwd only when the registry
 * names the directory AND git confirms it is a work-tree top. Nothing here
 * relaxes a path rule — an unregistered path still cannot be named.
 *
 * Read-only roots are dropped rather than listed: the git host runs outside the
 * multi-root fence, so a listed read-only root could be committed to. Hiding it
 * keeps the panel honest about what it can write.
 */
import { basename, isAbsolute, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { isOutwardSelector, samePath } from './repos.js'

/** The filesystem face this scan needs — a structural subset of the host's. */
export interface MultiRootFs {
  readonly realpath: (path: string) => Promise<string>
  readonly readFile: (path: string) => Promise<Uint8Array>
}

/** One registered root, resolved to the shape the repository list uses. */
export interface RegistryRoot {
  /** cwd-relative selector with POSIX separators; it leaves the cwd (`../…`). */
  readonly path: string
  /** Absolute realpath of the work-tree top. */
  readonly root: string
  /** Repository basename, for the row title. */
  readonly name: string
  /** `aliasId` when it differs from the basename: the plugin's display name. */
  readonly label?: string
}

/** One registry scan: the file it read and the roots it admits. */
export interface MultiRootScan {
  readonly file: string | null
  readonly roots: readonly RegistryRoot[]
  /** `absent` when no registry exists; `invalid` when it cannot be trusted. */
  readonly state?: 'absent' | 'invalid' | 'applied'
}

/** Upper bound mirroring the plugin's own `maxAdditionalRoots` default. */
export const MULTI_ROOT_MAX_ROOTS = 64

/** The registry location: `$DSH_HOME/storages/…`, else `~/.dsh/storages/…`. */
export function multiRootStorePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : `${homedir()}/.dsh`
  return `${home}/storages/multi_root_workspace.json`
}

/** Read the registry file once; `undefined` when absent or unparsable. */
async function readRegistry(fs: MultiRootFs, file: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(file)
    return JSON.parse(Buffer.from(raw).toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Resolve the registered roots for `cwd`.
 *
 * @param fs - realpath/readFile face (the host's snapshot deps satisfy it).
 * @param toplevel - `git rev-parse --show-toplevel` realpath'd, or null; the
 *   same certifier the `.code-workspace` scan uses, so both doors agree on
 *   what counts as a work-tree top.
 * @param cwd - the session's working directory.
 * @param file - registry path; tests pass a fixture path.
 */
export async function scanMultiRootRoots(
  fs: MultiRootFs,
  toplevel: (dir: string) => Promise<string | null>,
  cwd: string,
  file: string = multiRootStorePath(),
): Promise<MultiRootScan> {
  const cwdReal = await fs.realpath(cwd).catch(() => cwd)
  const store = await readRegistry(fs, file)
  if (store === null) return { file, roots: [], state: 'absent' }
  const table = (store as { tables?: { roots?: unknown } }).tables?.roots
  if (table === null || typeof table !== 'object') return { file, roots: [] }

  // Pick the owning workspace key: exact match first, otherwise the longest
  // ancestor key (a session inside a subdirectory still belongs to it).
  let entry: unknown = undefined
  let best = -1
  for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
    if (!isAbsolute(key)) continue
    const real = await fs.realpath(key).catch(() => key)
    if (samePath(real, cwdReal)) {
      entry = value
      best = real.length
      break
    }
    const inside = cwdReal === real || cwdReal.startsWith(real + sep)
    if (inside && real.length > best) {
      entry = value
      best = real.length
    }
  }
  if (entry === undefined) return { file, roots: [] }
  const listed = (entry as { roots?: unknown }).roots
  if (!Array.isArray(listed)) return { file, roots: [] }

  const roots: RegistryRoot[] = []
  for (const item of listed) {
    if (roots.length >= MULTI_ROOT_MAX_ROOTS) break
    if (item === null || typeof item !== 'object') continue
    const record = item as { path?: unknown; aliasId?: unknown; access?: unknown }
    if (typeof record.path !== 'string' || record.path === '') continue
    // Read-only roots stay out: the host's git runs outside the plugin's
    // fence, so listing one would offer commit actions the plugin forbids.
    if (record.access === 'read-only') continue
    const real = await fs.realpath(record.path).catch(() => null)
    if (real === null) continue
    if (samePath(real, cwdReal)) continue
    const rel = relative(cwdReal, real)
    // Roots inside the cwd are already the scan's business; only outward
    // selectors need this door.
    if (rel === '' || isAbsolute(rel) || !isOutwardSelector(rel)) continue
    const top = await toplevel(real)
    if (top === null || !samePath(top, real)) continue
    if (roots.some((root) => samePath(root.root, real))) continue
    const name = basename(real)
    const label = typeof record.aliasId === 'string' && record.aliasId !== '' && record.aliasId !== name ? record.aliasId : undefined
    roots.push({
      path: rel.split(sep).join('/'),
      root: real,
      name,
      ...(label !== undefined ? { label } : {}),
    })
  }
  return { file, roots, state: 'applied' }
}

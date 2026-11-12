/**
 * Additional roots from the multi-root workspace plugin's registry
 * (fork-local extension, see src/host/multi-root.ts).
 *
 * Real temp directories and real `git init` fixtures; the registry file is a
 * JSON fixture written per test. The admission door itself (`repoDirExternal`)
 * is covered in repos.test.mjs next to the other two doors.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { scanMultiRootRoots, multiRootStorePath } from '../../lib/host/multi-root.js'
import { listSessionRepos, resolveWorkspace } from '../../lib/host/core.js'
import { gitRunner, runGit } from './_git-fixture.mjs'

const runner = gitRunner()
const fs = createFsDeps()

/** `git rev-parse --show-toplevel` in `dir`, realpath'd; null when git fails. */
async function toplevel(dir) {
  const res = await runner.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir })
  if (res.exitCode !== 0) return null
  return realpathSync.native(res.stdout.trim())
}

let tmp
let hub
let registry

before(async () => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gp-multiroot-')))
  hub = join(tmp, 'hub')
  mkdirSync(hub, { recursive: true })

  for (const name of ['service-a', 'service-b', 'read-only-lib', 'plain-dir']) {
    mkdirSync(join(tmp, name), { recursive: true })
  }
  for (const name of ['service-a', 'service-b', 'read-only-lib']) {
    await runGit(join(tmp, name), ['init', '-q'])
    await runGit(join(tmp, name), ['config', 'user.email', 't@t.co'])
    await runGit(join(tmp, name), ['config', 'user.name', 'Tester'])
    await runGit(join(tmp, name), ['commit', '--allow-empty', '-qm', 'init'])
  }
  // A repository inside the hub: the scan owns it, the registry must not
  // duplicate the row.
  mkdirSync(join(hub, 'inner'), { recursive: true })
  await runGit(join(hub, 'inner'), ['init', '-q'])
  await runGit(join(hub, 'inner'), ['config', 'user.email', 't@t.co'])
  await runGit(join(hub, 'inner'), ['config', 'user.name', 'Tester'])
  await runGit(join(hub, 'inner'), ['commit', '--allow-empty', '-qm', 'init'])

  registry = join(tmp, 'multi_root_workspace.json')
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function writeRegistry(payload) {
  writeFileSync(registry, JSON.stringify(payload, null, 2))
}

test('absent registry reads as absent and admits nothing', async () => {
  const scan = await scanMultiRootRoots(fs, toplevel, hub, join(tmp, 'missing.json'))
  assert.equal(scan.state, 'absent')
  assert.deepEqual(scan.roots, [])
})

test('unparsable registry is reported invalid, not trusted', async () => {
  writeFileSync(registry, '{ not json')
  const scan = await scanMultiRootRoots(fs, toplevel, hub, registry)
  assert.equal(scan.roots.length, 0)
})

test('exact workspace key: outward repos admitted, read-only and non-repos dropped', async () => {
  writeRegistry({
    tables: {
      roots: {
        [hub]: {
          roots: [
            { path: join(tmp, 'service-a'), aliasId: 'service-a' },
            { path: join(tmp, 'service-b'), aliasId: 'api', access: 'read-write' },
            { path: join(tmp, 'read-only-lib'), access: 'read-only' },
            { path: join(tmp, 'plain-dir'), access: 'inherit' },
            { path: join(hub, 'inner'), access: 'inherit' },
            { path: join(tmp, 'service-a'), aliasId: 'service-a' },
          ],
        },
      },
    },
  })
  const scan = await scanMultiRootRoots(fs, toplevel, hub, registry)
  assert.equal(scan.state, 'applied')
  const paths = scan.roots.map((root) => root.root).sort()
  assert.deepEqual(paths, [join(tmp, 'service-a'), join(tmp, 'service-b')].sort())
  // Outward selectors, POSIX separators, and the alias becomes the label.
  const api = scan.roots.find((root) => root.root.endsWith('service-b'))
  assert.equal(api.path, '../service-b')
  assert.equal(api.label, 'api')
  const serviceA = scan.roots.find((root) => root.root.endsWith('service-a'))
  assert.equal(serviceA.label, undefined)
})

test('a session inside a subdirectory still matches its workspace key', async () => {
  writeRegistry({
    tables: {
      roots: {
        [tmp]: { roots: [{ path: join(tmp, 'service-a') }] },
      },
    },
  })
  const scan = await scanMultiRootRoots(fs, toplevel, join(hub, 'inner'), registry)
  assert.deepEqual(scan.roots.map((root) => root.root), [join(tmp, 'service-a')])
})

test('store path follows DSH_HOME', () => {
  assert.equal(
    multiRootStorePath({ DSH_HOME: '/tmp/custom-home' }),
    '/tmp/custom-home/storages/multi_root_workspace.json',
  )
})

test('the panel lists registered roots and admits their selectors', async () => {
  const home = join(tmp, 'home')
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(
    join(home, 'storages', 'multi_root_workspace.json'),
    JSON.stringify({
      tables: {
        roots: {
          [hub]: { roots: [{ path: join(tmp, 'service-b'), aliasId: 'api' }] },
        },
      },
    }),
  )
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const deps = {
      run: gitRunner(),
      fs: createFsDeps(),
      sessions: { liveCwd: () => hub, persistedMeta: async () => undefined },
    }
    const listed = await listSessionRepos(deps, 'test-session', true)
    assert.equal(listed.ok, true)
    const row = listed.value.repos.find((repo) => repo.root === join(tmp, 'service-b'))
    assert.ok(row, 'registered root appears in the repository list')
    assert.equal(row.kind, 'external')
    assert.equal(row.path, '../service-b')
    assert.equal(row.label, 'api')

    const ws = await resolveWorkspace(deps, 'test-session', '../service-b')
    assert.equal(ws.ok, true)
    assert.equal(ws.ok && ws.root, join(tmp, 'service-b'))

    // An unregistered sibling stays unreachable even though it is a repo.
    const denied = await resolveWorkspace(deps, 'test-session', '../service-a')
    assert.equal(denied.ok, false)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

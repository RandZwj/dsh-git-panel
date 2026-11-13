/**
 * Remote-branch scope: only refs a configured remote owns reach the branch
 * list.
 *
 * `refs/remotes` is not "remote branches" — tooling writes GitLab merge-request
 * refs into `refs/remotes/mrs/<id>/head`, and removing a remote leaves its
 * tracking refs behind. Neither is covered by a configured refspec, so
 * `git fetch --prune` never refreshes or drops them; a large repository
 * accumulates thousands of pseudo branches (measured on one: 6948 refs, 6916 of
 * them `mrs/*`, 3474 already merged). The query keeps a ref only when its first
 * segment names a configured remote; the helper resolves that owner with the
 * longest configured name, so a remote called `work/fork` is not confused with
 * one called `work`.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, readFile, readdir, rm, stat, lstat, readlink } from 'node:fs/promises'
import { runQuery, createGitRunner, DEFAULT_CONFIG } from '../../lib/host/index.js'
import { configuredRemoteOf } from '../../lib/testkit.mjs'

const SID = 'remote-scope-session'

const subprocess = {
  spawn(spec) {
    const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd })
    if (typeof spec.stdio.stdin === 'object') child.stdin.end(spec.stdio.stdin.data)
    else child.stdin.end()
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const done = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
    })
    return {
      done,
      collected: {
        stdout: { readFrom: () => ({ text: out, lossy: false }) },
        stderr: { readFrom: () => ({ text: err, lossy: false }) },
      },
    }
  },
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const c = nodeSpawn('git', args, { cwd })
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')}: ${err}`))))
  })
}

function depsAt(dir) {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    fs: {
      realpath, stat: (p) => stat(p), readFile: (p) => readFile(p),
      symlinkTarget: async (p) => {
        try { return (await lstat(p)).isSymbolicLink() ? await readlink(p) : null } catch { return null }
      },
      readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      remove: (p) => rm(p, { force: true }),
    },
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

const branchQuery = { sessionId: SID, query: { kind: 'branches' } }

async function remoteNames(repo) {
  const res = await runQuery(depsAt(repo), DEFAULT_CONFIG, branchQuery)
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.value.kind, 'branches')
  return res.value.remote.map((branch) => branch.name)
}

let repo

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gp-remote-scope-'))
  await runGit(repo, ['init', '-q'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'root'])
})

after(() => { rmSync(repo, { recursive: true, force: true }) })

test('the owner is the longest configured remote name', () => {
  assert.equal(configuredRemoteOf('origin/feature/x', ['origin', 'upstream']), 'origin')
  assert.equal(configuredRemoteOf('work/fork/topic/x', ['work', 'work/fork']), 'work/fork')
  assert.equal(configuredRemoteOf('origin/x', ['upstream']), null, 'no configured remote owns it')
  assert.equal(configuredRemoteOf('origin/x', []), null)
  assert.equal(configuredRemoteOf('originx/main', ['origin']), null, 'prefix must end at a slash')
})

test('a repository with no configured remote reports no remote branches', async () => {
  // `git update-ref` can create a tracking ref without any remote existing; it
  // must not become a "branch" in the panel.
  await runGit(repo, ['update-ref', 'refs/remotes/mrs/1/head', 'HEAD'])
  assert.deepEqual(await remoteNames(repo), [])
})

test('only refs owned by a configured remote are listed', async () => {
  await runGit(repo, ['remote', 'add', 'origin', 'https://example.invalid/origin.git'])
  await runGit(repo, ['remote', 'add', 'work/fork', 'https://example.invalid/fork.git'])
  await runGit(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  await runGit(repo, ['update-ref', 'refs/remotes/work/fork/topic', 'HEAD'])
  // Orphans: a GitLab MR ref, and a ref under a segment that is not a remote
  // (`work/topic` sits under the nonexistent remote `work`).
  await runGit(repo, ['update-ref', 'refs/remotes/mrs/1/head', 'HEAD'])
  await runGit(repo, ['update-ref', 'refs/remotes/mrs/1/merge', 'HEAD'])
  await runGit(repo, ['update-ref', 'refs/remotes/work/topic', 'HEAD'])

  const names = (await remoteNames(repo)).sort()
  assert.deepEqual(names, ['origin/main', 'work/fork/topic'])
  // The full ref still rides along for the switch/delete paths.
  const res = await runQuery(depsAt(repo), DEFAULT_CONFIG, branchQuery)
  const origin = res.value.remote.find((branch) => branch.name === 'origin/main')
  assert.equal(origin.ref, 'refs/remotes/origin/main')
  assert.equal(origin.shortHash, res.value.remote.find((branch) => branch.name === 'work/fork/topic').shortHash)
})

test('local branches are untouched by the remote scope', async () => {
  const res = await runQuery(depsAt(repo), DEFAULT_CONFIG, branchQuery)
  assert.equal(res.ok, true)
  assert.equal(res.value.local.length, 1)
  assert.equal(res.value.local[0].ref, 'refs/heads/' + res.value.current)
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import {
  patchAtFile, patchAtFileClient, patchMagicPath, patchBillionContext, patchBetterSidebar, patchSentinelXManifest, installBundledPluginCompatibility,
} from './bundled-compat.mjs'

function archiveContent(name, path) {
  return execFileSync('tar', ['-xOf', fileURLToPath(new URL('../bundled-plugins/' + name, import.meta.url)), 'package/' + path],
    { maxBuffer: 32 * 1024 * 1024 }).toString()
}

const cases = [
  { name: 'dsh-at-file', version: '0.7.0', tar: 'dsh-at-file-0.7.0.tgz', path: 'lib/index.js', patch: patchAtFile },
  { name: 'dsh-at-file', version: '0.7.0', tar: 'dsh-at-file-0.7.0.tgz', path: 'lib/client.js', patch: patchAtFileClient },
  { name: 'dsh-magicpath', version: '0.1.0', tar: 'dsh-magicpath-0.1.0.tgz', path: 'lib/index.js', patch: patchMagicPath },
  { name: 'billion-context', version: '0.1.190', tar: 'billion-context-0.1.190.tgz', path: 'dist/agent/dsh-native.js', patch: patchBillionContext },
  { name: 'dsh-better-sidebar', version: '0.25.0', tar: 'dsh-better-sidebar-0.25.0.tgz', path: 'lib/index.js', patch: patchBetterSidebar },
]

test('Better Sidebar mounts terminal chunks with the current Connection trust list', () => {
  const fixed = patchBetterSidebar(archiveContent('dsh-better-sidebar-0.25.0.tgz', 'lib/index.js'))
  const inject = runInNewContext(fixed.match(/const inject = \[[\s\S]*?\];/)[0] + '; inject')
  assert.ok(inject.includes('connection'))
  assert.ok(!inject.includes('webRuntime'))
  const source = fixed.match(/function isTrustedApiRequest\([\s\S]*?\n\}/)[0]
  const helpers = fixed.slice(fixed.indexOf('function header('), fixed.indexOf(source) + source.length)
  const fence = runInNewContext(helpers + '; req => isTrustedApiRequest(req, ctx.connection.trustedHosts)', {
    URL, ctx: { connection: { trustedHosts: ['harness.internal:8080'] } },
  })
  assert.ok(source)
  assert.equal(fence({ headers: { host: '127.0.0.1:49898', origin: 'dsh-app://app' } }), true)
  assert.equal(fence({ headers: { host: 'harness.internal:8080', origin: 'http://harness.internal:8080' } }), true)
  assert.equal(fence({ headers: { host: 'evil.example', origin: 'dsh-app://app' } }), false)
  assert.equal(fence({ headers: { host: '127.0.0.1:49898', origin: 'http://evil.example' } }), false)
  assert.equal(fence({ headers: { host: '127.0.0.1:49898', 'sec-fetch-site': 'cross-site' } }), false)
  assert.ok(fixed.includes('registerBundleRoute(ctx, fence)'))
})

test('patches target shipped plugins, preserve program entry points and remain idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-plugin-syntax-'))
  try {
    for (const spec of cases) {
      const original = archiveContent(spec.tar, spec.path)
      const fixed = spec.patch(original)
      assert.notEqual(fixed, original, spec.name + ' should need a compatibility repair')
      assert.equal(spec.patch(fixed), fixed)
      const path = join(dir, spec.name + '.mjs')
      writeFileSync(path, fixed)
      execFileSync(process.execPath, ['--check', path])
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('at-file keeps live remote settings writes and persists valid values without the removed API', () => {
  const original = archiveContent(cases[0].tar, cases[0].path)
  const fixed = patchAtFile(original)
  assert.ok(!fixed.includes('ctx.settings.register(AT_FILE_NAMESPACE'))
  assert.ok(fixed.includes('new AtFileRuntime(ctx, resolved, readSettings, writeSettings)'))
  assert.ok(fixed.includes('normalizeWorkspaceIgnoreFiles(update.value)'))
  const body = fixed.match(/function registerAtFileSettings\(ctx\) \{[\s\S]*?\n\}/)?.[0]
  assert.ok(body)
  const home = mkdtempSync(join(tmpdir(), 'pg-at-file-settings-'))
  try {
    const context = {
      pgJoin: join, pgHome: homedir, pgExists: existsSync, pgRead: readFileSync,
      pgMkdir: mkdirSync, pgWrite: writeFileSync, pgRename: renameSync,
      pgUnlink: unlinkSync, pgDirname: dirname,
      pgProcess: { env: { DSH_HOME: home }, pid: process.pid },
      TypertRemoteService: class {}, Remote: () => {},
      JSON,
      AtFileSettingsSchema: value => ({
        enabled: true,
        ignoreFiles: ['.DS_Store'],
        workspaceIgnoreFiles: [],
        ignorePastedMentions: true,
        ...value,
      }),
    }
    const prefix = fixed.slice(0, fixed.indexOf('// src/mention.ts')).replace(/^import .*;?\n/gm, '')
    assert.equal(runInNewContext(prefix + '; typeof process', context), 'function')
    assert.throws(() => runInNewContext(prefix + '\n' + body.replaceAll('pgProcess.', 'process.') + '\nregisterAtFileSettings({})', context), /DSH_HOME/)
    const create = runInNewContext(prefix + '\n' + body + '\nregisterAtFileSettings', context)
    const instance = create({})
    assert.equal(instance.get().enabled, true)
    return instance.update({ enabled: false, workspaceIgnoreFiles: [{ workspace: '/repo', ignoreFiles: ['secret.txt'] }] }).then(() => {
      const again = create({})
      assert.equal(again.get().enabled, false)
      assert.equal(again.get().workspaceIgnoreFiles[0].workspace, '/repo')
      const disk = JSON.parse(readFileSync(join(home, 'pg-harness-state', 'dsh-at-file.json'), 'utf8'))
      assert.equal(disk.enabled, false)
    }).finally(() => rmSync(home, { recursive: true, force: true }))
  } catch (error) {
    rmSync(home, { recursive: true, force: true })
    throw error
  }
})

test('at-file exposes strict codec factories accepted by the current Typert registry', () => {
  const fixed = patchAtFile(archiveContent(cases[0].tar, cases[0].path))
  const prefix = fixed.slice(0, fixed.indexOf('// src/mention.ts')).replace(/^import .*;?\n/gm, '')
  const invocations = runInNewContext(prefix + '; AT_FILE_INVOCATIONS', { TypertRemoteService: class {}, Remote: () => {} })
  for (const invocation of invocations) {
    for (const codec of [invocation.result, ...invocation.parameters.map(parameter => parameter.codec)]) {
      assert.equal(typeof codec.create, 'function')
      assert.equal(typeof codec.create().safeParse, 'function')
    }
  }
  assert.equal(invocations[0].result.create().safeParse([{ path: 7 }]).success, false)
  assert.equal(invocations[0].result.create().safeParse([]).success, true)
  assert.equal(invocations[1].result.create().safeParse({ enabled: 'invalid' }).success, false)
})

test('at-file browser mounts the same strict factories before exposing its picker', () => {
  const original = archiveContent(cases[1].tar, cases[1].path)
  const fixed = patchAtFileClient(original)
  const read = source => {
    const prefix = source.slice(source.indexOf('"use strict";'), source.indexOf('// src/client/remote.ts'))
    return runInNewContext('var module = { exports: {} }; var exports = module.exports;\n' + prefix + '; AT_FILE_INVOCATIONS', { require: () => ({}) })
  }
  assert.equal(read(original)[0].result.create, undefined)
  for (const invocation of read(fixed)) {
    for (const codec of [invocation.result, ...invocation.parameters.map(parameter => parameter.codec)]) {
      assert.equal(typeof codec.create, 'function')
      assert.equal(typeof codec.create().safeParse, 'function')
    }
  }
  assert.ok(fixed.includes('async function apply(ctx)'))
  assert.ok(fixed.includes('await ctx.effect(async () =>'))
})

test('magicpath tool registers a validator-compatible output while preserving CLI commands', async () => {
  const original = archiveContent(cases[2].tar, cases[2].path)
  const fixed = patchMagicPath(original)
  const dir = mkdtempSync(join(tmpdir(), 'pg-magicpath-'))
  try {
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
    writeFileSync(join(dir, 'lib', 'index.js'), fixed)
    writeFileSync(join(dir, 'lib', 'cli.js'), archiveContent(cases[2].tar, 'lib/cli.js'))
    const plugin = await import(pathToFileURL(join(dir, 'lib', 'index.js')).href)
    const registered = []
    const disposers = []
    plugin.apply({ effect: effect => { disposers.push(effect()) }, tools: { register: tool => {
      registered.push(tool)
      return () => { registered.splice(registered.indexOf(tool), 1) }
    } } })
    assert.equal(registered.length, 1)
    const tool = registered[0]
    assert.equal(tool.name, 'magicpath')
    assert.equal(tool.parameters.properties.flags.additionalProperties, true)
    for (const entry of Object.values(tool.output.schema.properties)) {
      assert.equal(Array.isArray(entry.type), false)
    }
    assert.deepEqual(tool.output.schema.properties.data, {})
    const rendered = tool.output.render({}, {
      ok: true, command: 'info', argv: ['info'], exitCode: 0, data: { status: 'ok' },
      stdout: '', stderr: '', error: null, hint: null, authUrl: null,
    })
    assert.equal(rendered[0].type, 'text')
    await assert.rejects(() => tool.execute({ command: 'info', flags: { invalid: [] } }, {}),
      /flags must contain only/)
    disposers[0]()
    assert.equal(registered.length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('existing v1 repairs gain codec factories and cleanup without replacing persisted settings', () => {
  const atFile = patchAtFile(archiveContent(cases[0].tar, cases[0].path))
  const v2 = atFile.replace('at-file settings compatibility v3', 'at-file settings compatibility v2')
    .replace('import pgProcess from "node:process";\n', '').replaceAll('pgProcess.', 'process.')
  assert.equal(patchAtFile(v2), atFile)
  const v1 = v2.replace('at-file settings compatibility v2', 'at-file settings compatibility v1').replaceAll('create: () => ', 'schema: ')
  assert.equal(patchAtFile(v1), atFile)
  const magicPath = patchMagicPath(archiveContent(cases[2].tar, cases[2].path))
  const magicV1 = magicPath.replace('tool schema compatibility v2', 'tool schema compatibility v1')
    .replace('ctx.effect(() => ctx.tools.register({', 'ctx.tools.register({')
    .replace('  }), "magicpath: tool")', '  })')
  assert.equal(patchMagicPath(magicV1), magicPath)
})

test('billion-context direct fetch wrapper is the safe default; upstream opt-in stays available', () => {
  const original = archiveContent(cases[3].tar, cases[3].path)
  const fixed = patchBillionContext(original)
  const fn = fixed.match(/function shouldReclaimFetchPatch\(\)\{[^}]+\}/)?.[0]
  assert.ok(fn)
  const check = value => runInNewContext(fn + ';shouldReclaimFetchPatch()', {
    process: { env: value === undefined ? {} : { BILI_RECLAIM_FETCH_PATCH: value } },
  })
  assert.equal(check(undefined), false)
  assert.equal(check('1'), true)
  assert.equal(check('0'), false)
  assert.ok(fixed.includes('function installFetchChain(makeDispatch)'))
})

test('installation backs up originals once and never patches different versions', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-plugin-patches-'))
  try {
    const profile = join(home, 'profile')
    const backup = join(home, 'backup')
    for (const spec of cases) {
      const root = join(profile, 'node_modules', spec.name)
      const file = join(root, spec.path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: spec.version }))
      writeFileSync(file, archiveContent(spec.tar, spec.path))
    }
    assert.deepEqual(installBundledPluginCompatibility(profile, backup), cases.map(x => x.name))
    assert.deepEqual(installBundledPluginCompatibility(profile, backup), [])
    for (const spec of cases) {
      const root = join(profile, 'node_modules', spec.name)
      assert.equal(readFileSync(join(root, spec.path), 'utf8'),
        spec.patch(archiveContent(spec.tar, spec.path)))
      writeFileSync(join(root, 'package.json'), '{"version":"999.0.0"}')
      writeFileSync(join(root, spec.path), 'user owned version')
    }
    assert.deepEqual(installBundledPluginCompatibility(profile, backup), [])
    for (const spec of cases) {
      assert.equal(readFileSync(join(profile, 'node_modules', spec.name, spec.path), 'utf8'), 'user owned version')
    }
    assert.equal(archiveContent(cases[0].tar, cases[0].path).includes('settings.register'), true)
    assert.throws(() => patchAtFile('unexpected code'), /strict codec declarations/)
    assert.throws(() => patchMagicPath('unexpected code'), /patch anchor/)
    assert.throws(() => patchBillionContext('unexpected code'), /patch anchor/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('SentinelX rc.2 compatibility retains bridge code, OAuth state, dependency sources and custom policies', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-sentinelx-compat-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    const root = join(profile, 'node_modules', 'dsh-sentinelx')
    const backup = join(home, 'backup')
    mkdirSync(join(root, 'lib'), { recursive: true })
    const original = archiveContent('dsh-sentinelx-0.1.1.tgz', 'package.json')
    const bridge = archiveContent('dsh-sentinelx-0.1.1.tgz', 'lib/index.js')
    const manifestPath = join(root, 'package.json')
    writeFileSync(manifestPath, original)
    writeFileSync(join(root, 'lib', 'index.js'), bridge)
    mkdirSync(join(home, 'sentinelx'))
    const state = join(home, 'sentinelx', 'oauth.json')
    writeFileSync(state, '{"fixture_token":"retained"}\n')
    assert.deepEqual(installBundledPluginCompatibility(profile, backup), ['dsh-sentinelx'])
    const fixed = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const prior = JSON.parse(original)
    assert.ok(fixed.engines.dsh.includes('0.2.1-alpha.4'))
    assert.ok(fixed.engines.dsh.includes('0.2.1-alpha.5'))
    assert.ok(fixed.engines.dsh.includes('0.2.1-rc.2'))
    for (const name of ['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-tools']) {
      assert.ok(fixed.peerDependencies[name].includes('0.2.1-rc.2'))
    }
    assert.ok(fixed.engines.dsh.includes('0.2.1-alpha.2'))
    assert.equal(fixed.engines.node, prior.engines.node)
    assert.deepEqual(fixed.dependencies, prior.dependencies)
    assert.equal(readFileSync(join(root, 'lib', 'index.js'), 'utf8'), bridge)
    assert.equal(readFileSync(state, 'utf8'), '{"fixture_token":"retained"}\n')
    assert.equal(readFileSync(join(backup, 'dsh-sentinelx-package.json'), 'utf8'), original)
    assert.deepEqual(installBundledPluginCompatibility(profile, backup), [])
    assert.equal(readFileSync(join(backup, 'dsh-sentinelx-package.json'), 'utf8'), original)
    for (const override of [{ version: '0.1.2' }, { engines: { ...prior.engines, dsh: '0.2.1-alpha.2' } },
      { peerDependencies: { ...prior.peerDependencies, '@deepseek-ai/dsh-tools': 'custom-policy' } }]) {
      const custom = JSON.stringify({ ...prior, ...override }) + '\n'
      writeFileSync(manifestPath, custom)
      assert.deepEqual(installBundledPluginCompatibility(profile, backup), [])
      assert.equal(readFileSync(manifestPath, 'utf8'), custom)
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})


for (const suffix of ['', ' || 0.2.1-alpha.5']) {
test(`SentinelX upgrades an existing alpha repair${suffix} to rc.2 without widening unknown custom policy`, () => {
  const original = JSON.parse(archiveContent('dsh-sentinelx-0.1.1.tgz', 'package.json'))
  const alpha4 = original.peerDependencies['@deepseek-ai/dsh-tools'] + ' || 0.2.1-alpha.4' + suffix
  const peers = ['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-tools']
  const existing = {
    ...original,
    engines: { ...original.engines, dsh: alpha4 },
    peerDependencies: { ...original.peerDependencies },
    devDependencies: { ...original.devDependencies },
  }
  for (const name of peers) {
    existing.peerDependencies[name] = alpha4
    if (existing.devDependencies[name] !== undefined) existing.devDependencies[name] = alpha4
  }
  const upgraded = JSON.parse(patchSentinelXManifest(JSON.stringify(existing)))
  assert.equal(upgraded.engines.dsh, original.peerDependencies[peers[0]] + ' || 0.2.1-alpha.4 || 0.2.1-alpha.5 || 0.2.1-rc.2')
  for (const name of peers) {
    assert.equal(upgraded.peerDependencies[name], upgraded.engines.dsh)
    if (existing.devDependencies[name] !== undefined) assert.equal(upgraded.devDependencies[name], upgraded.engines.dsh)
  }
  assert.equal(patchSentinelXManifest(JSON.stringify(upgraded)), JSON.stringify(upgraded))
  const custom = { ...existing, peerDependencies: { ...existing.peerDependencies, [peers[0]]: 'custom-policy' } }
  const serialized = JSON.stringify(custom)
  assert.equal(patchSentinelXManifest(serialized), serialized)
})
}

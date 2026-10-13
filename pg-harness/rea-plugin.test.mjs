import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { REA_BUNDLE, REA_RELEASE_SPEC, selectReaBundle, inspectReaBundle, activateInstalledReaBundle } from './rea-plugin.mjs'

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'pg-rea-'))
  try { fn(home) } finally { rmSync(home, { recursive: true, force: true }) }
}

test('REA selection is idempotent and uses only the build-free release bundle', () => {
  const doc = { dependencies: { prior: '1.0.0' }, dsh: { profile: { bundles: ['prior'] } } }
  const first = selectReaBundle(doc)
  assert.deepEqual(first, { addedDependency: true, enabledNow: true, source: REA_RELEASE_SPEC, bundles: 2 })
  assert.equal(doc.dependencies[REA_BUNDLE], REA_RELEASE_SPEC)
  assert.deepEqual(doc.dsh.profile.bundles, ['prior', REA_BUNDLE])
  const again = selectReaBundle(doc)
  assert.equal(again.addedDependency, false)
  assert.equal(again.enabledNow, false)
  assert.deepEqual(doc.dsh.profile.bundles, ['prior', REA_BUNDLE])
})

test('existing REA Git/release dependency is preserved, only selection is changed', () => {
  for (const spec of ['https://github.com/xxxxxwater/rea#dsh-plugin-v0.2.0',
    'file:../../bundled-plugin-archives/custom-rea.tgz',
    'dsh-rea-bundle@0.9.0']) {
    const doc = { dependencies: { [REA_BUNDLE]: spec }, dsh: { profile: { bundles: ['retained'] } } }
    const result = selectReaBundle(doc)
    assert.equal(result.source, spec)
    assert.equal(result.addedDependency, false)
    assert.equal(result.enabledNow, true)
    assert.deepEqual(doc.dsh.profile.bundles, ['retained', REA_BUNDLE])
  }
})

test('invalid manifest and duplicate selections fail closed without mutation', () => {
  for (const malformed of [
    { dependencies: {}, dsh: { profile: { bundles: 'bad' } } },
    { dependencies: {}, dsh: { profile: { bundles: ['a', 'a'] } } },
    { dependencies: { [REA_BUNDLE]: '' }, dsh: { profile: { bundles: ['a'] } } },
    { dependencies: {}, dsh: { profile: { bundles: [false] } } },
  ]) {
    const before = JSON.stringify(malformed)
    assert.throws(() => selectReaBundle(malformed))
    assert.equal(JSON.stringify(malformed), before)
  }
})

test('read-only status distinguishes installed, enabled and composed', () => {
  withHome(home => {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    const manifest = join(profile, 'package.json')
    writeFileSync(manifest, JSON.stringify({
      dependencies: { [REA_BUNDLE]: REA_RELEASE_SPEC },
      dsh: { profile: { bundles: ['other'] } },
    }))
    let status = inspectReaBundle(home)
    assert.equal(status.source, REA_RELEASE_SPEC)
    assert.equal(status.selected, false)
    assert.equal(status.bundled, false)
    assert.equal(status.composed, false)
    assert.equal(status.runtimeReady, false)
    const before = readFileSync(manifest)
    const command = execFileSync(process.execPath, [new URL('./rea-plugin.mjs', import.meta.url).pathname, '--status'],
      { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' })
    assert.match(command, /REA enabled: false/)
    assert.deepEqual(readFileSync(manifest), before)
  })
})

test('Cordis output with wrong or stale launcher rows is not accepted as a healthy session', () => {
  withHome(home => {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    const manifest = join(profile, 'package.json')
    const compiled = join(profile, 'cordis.yml')
    writeFileSync(manifest, JSON.stringify({
      dependencies: { [REA_BUNDLE]: REA_RELEASE_SPEC },
      dsh: { profile: { bundles: [REA_BUNDLE] } },
    }))
    writeFileSync(compiled, '- id: rea-launcher\n- id: other\n')
    assert.equal(inspectReaBundle(home).composed, false)
    writeFileSync(compiled, '- id: rea-launcher\n- id: rea-mcp\n')
    assert.equal(inspectReaBundle(home).composed, true)
    const older = new Date(Date.now() - 60000)
    const newer = new Date()
    utimesSync(compiled, older, older)
    utimesSync(manifest, newer, newer)
    assert.equal(inspectReaBundle(home).composedFresh, false)
  })
})

test('read-only diagnostics flag legacy home-level REA overriding the new bundle', () => {
  withHome(home => {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { [REA_BUNDLE]: REA_RELEASE_SPEC },
      dsh: { profile: { bundles: [REA_BUNDLE] } },
    }))
    writeFileSync(join(home, 'cordis.patch.yml'),
      '- insert:\n    - id: rea-mcp\n      name: old-mcp\n')
    const state = inspectReaBundle(home)
    assert.equal(state.homePatchOverridesRea, true)
    assert.equal(state.selected, true)
  })
})


function installedReaFixture(home, options = {}) {
  const profile = join(home, 'profiles', 'desktop')
  const bundle = join(profile, 'node_modules', REA_BUNDLE)
  const engine = join(bundle, 'node_modules', 'rea-agents')
  mkdirSync(join(engine, 'scripts'), { recursive: true })
  writeFileSync(join(engine, 'package.json'), JSON.stringify({ name: 'rea-agents', version: '6.4.0' }))
  writeFileSync(join(engine, 'scripts', 'rea.mjs'), '// fixture engine\n')
  writeFileSync(join(bundle, 'launcher.mjs'), '// fixture launcher\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: REA_BUNDLE, version: '0.2.0',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'),
    '- insert:\n    - id: rea-launcher\n      name: dsh-rea-bundle/launcher\n'
    + '    - id: rea-mcp\n      name: "@deepseek-ai/dsh-mcp-client"\n'
    + '      options:\n        serverName: rea\n        transport: stdio\n')
  const manifest = join(profile, 'package.json')
  const dependencies = { retained: '1.0.0', [REA_BUNDLE]: REA_RELEASE_SPEC }
  const selected = Array.from({ length: 35 }, (_, i) => i === 34 ? 'dsh-prompt-enhancer' : 'bundle-' + i)
  writeFileSync(manifest, JSON.stringify({
    dependencies: options.noDependency ? { retained: '1.0.0' } : dependencies,
    dsh: { profile: { bundles: options.enabled ? [...selected, REA_BUNDLE] : selected } },
    preservedSettings: { safety: 'enabled' },
  }, null, 2) + '\n')
  return { profile, manifest, selected }
}

test('local activation repairs installed-but-disabled bundle, preserving 35 entries and backup exactly', () => {
  withHome(home => {
    const { profile, manifest, selected } = installedReaFixture(home)
    assert.equal(inspectReaBundle(home).runtimeReady, true)
    const previous = readFileSync(manifest)
    const result = activateInstalledReaBundle(home)
    assert.equal(result.changed, true)
    assert.ok(result.backup.startsWith(manifest + '.rea-backup-'))
    assert.deepEqual(readFileSync(result.backup), previous)
    const updated = JSON.parse(readFileSync(manifest, 'utf8'))
    assert.deepEqual(updated.dsh.profile.bundles.slice(0, 35), selected)
    assert.equal(updated.dsh.profile.bundles[35], REA_BUNDLE)
    assert.deepEqual(updated.dependencies, { retained: '1.0.0', [REA_BUNDLE]: REA_RELEASE_SPEC })
    assert.deepEqual(updated.preservedSettings, { safety: 'enabled' })
    const after = readFileSync(manifest)
    const second = activateInstalledReaBundle(home)
    assert.equal(second.changed, false)
    assert.deepEqual(readFileSync(manifest), after)
    assert.equal(readdirSync(profile).filter(x => x.startsWith('package.json.rea-backup-')).length, 1)
  })
})

test('local activation fails closed if dependency is missing or bundle selection corrupt', () => {
  for (const options of [{ noDependency: true }, {}]) {
    withHome(home => {
      const { profile, manifest } = installedReaFixture(home, options)
      if (!options.noDependency) {
        const config = JSON.parse(readFileSync(manifest, 'utf8'))
        config.dsh.profile.bundles.push('bundle-1')
        writeFileSync(manifest, JSON.stringify(config))
      }
      const initial = readFileSync(manifest)
      assert.throws(() => activateInstalledReaBundle(home))
      assert.deepEqual(readFileSync(manifest), initial)
      assert.equal(readdirSync(profile).filter(x => x.startsWith('package.json.rea-backup-')).length, 0)
    })
  }
})

test('local activation rejects missing plugin files and an active Desktop profile lock', () => {
  withHome(home => {
    const { profile, manifest } = installedReaFixture(home)
    writeFileSync(join(profile, 'lock'), 'locked')
    assert.throws(() => activateInstalledReaBundle(home), /locked/)
    rmSync(join(profile, 'lock'))
    rmSync(join(profile, 'node_modules', REA_BUNDLE, 'launcher.mjs'))
    assert.throws(() => activateInstalledReaBundle(home), /missing/)
    assert.equal(readdirSync(profile).filter(x => x.startsWith('package.json.rea-backup-')).length, 0)
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).dsh.profile.bundles.includes(REA_BUNDLE), false)
  })
})

test('already enabled REA requires no write or backup', () => {
  withHome(home => {
    const { profile, manifest } = installedReaFixture(home, { enabled: true })
    const before = readFileSync(manifest)
    const result = activateInstalledReaBundle(home)
    assert.equal(result.changed, false)
    assert.deepEqual(readFileSync(manifest), before)
    assert.equal(readdirSync(profile).filter(x => x.startsWith('package.json.rea-backup-')).length, 0)
  })
})

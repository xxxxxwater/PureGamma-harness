import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { REA_BUNDLE, REA_RELEASE_SPEC, selectReaBundle, inspectReaBundle } from './rea-plugin.mjs'

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

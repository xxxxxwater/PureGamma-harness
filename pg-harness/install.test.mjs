import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { install } from './install.mjs'
import { REA_BUNDLE, REA_RELEASE_SPEC } from './rea-plugin.mjs'

test('installation preserves third-party bundles and user settings and remains repeatable', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-install-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { retained: '1.2.3' }, dsh: { profile: { bundles: ['retained'] } } }))
    writeFileSync(join(profile, 'cordis.patch.yml'), 'retained settings\n')
    writeFileSync(join(home, 'credentials.json'), 'retained credentials\n')
    install(home)
    install(home)
    const result = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(result.dependencies.retained, '1.2.3')
    assert.equal(result.dsh.profile.bundles[0], 'retained')
    assert.equal(result.dependencies['dsh-codex-cli-models'], 'link:../../local-plugins/dsh-codex-cli-models')
    assert.ok(result.dsh.profile.bundles.includes('dsh-codex-cli-models'))
    assert.equal(result.dependencies['dsh-evidence-trust'], 'link:../../local-plugins/dsh-evidence-trust')
    assert.ok(result.dsh.profile.bundles.includes('dsh-evidence-trust'))
    assert.equal(result.dependencies[REA_BUNDLE], REA_RELEASE_SPEC)
    assert.equal(result.dsh.profile.bundles.filter(name => name === REA_BUNDLE).length, 1)
    const trustPlugin = join(home, 'local-plugins', 'dsh-evidence-trust')
    assert.ok(readFileSync(join(trustPlugin, 'index.js'), 'utf8').includes("ctx.tools.guard"))
    assert.equal(result.dsh.profile.bundles.includes('dsh-task-completion-chime'), process.platform === 'darwin')
    const codex = join(home, 'local-plugins', 'dsh-codex-cli-models')
    assert.ok(readFileSync(join(codex, 'client.js'), 'utf8').includes('使用 ChatGPT 登录'))
    assert.equal(readFileSync(join(codex, 'package.json'), 'utf8'), readFileSync(new URL('./plugins/dsh-codex-cli-models/package.json', import.meta.url), 'utf8'))
    const inventory = JSON.parse(readFileSync(new URL('./bundled-plugins/inventory.json', import.meta.url), 'utf8'))
    for (const bundle of inventory.bundles) assert.ok(result.dsh.profile.bundles.includes(bundle))
    for (const plugin of inventory.plugins) assert.equal(result.dependencies[plugin.name], 'file:../../bundled-plugin-archives/' + plugin.archive)
    assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), 'retained settings\n')
    assert.equal(readFileSync(join(home, 'credentials.json'), 'utf8'), 'retained credentials\n')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('installation refuses an active desktop profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-install-'))
  try {
    mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'desktop', 'lock'), 'active')
    assert.throws(() => install(home), /Quit Harness/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})


test('Codex CLI upgrades the legacy model route without mutating existing credentials', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-codex-installer-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      name: 'original', dependencies: { 'keep-me': '1.0.0', 'dsh-codex-cli': 'link:../../local-plugins/dsh-codex-cli' },
      dsh: { profile: { bundles: ['keep-me', 'dsh-codex-cli'] } },
    }))
    writeFileSync(join(home, 'credentials.json'), 'original-auth-untouched')
    install(home)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies['dsh-codex-cli'], 'link:../../local-plugins/dsh-codex-cli')
    assert.ok(!manifest.dsh.profile.bundles.includes('dsh-codex-cli'))
    assert.ok(manifest.dsh.profile.bundles.includes('dsh-codex-cli-models'))
    assert.equal(manifest.dependencies['keep-me'], '1.0.0')
    assert.equal(readFileSync(join(home, 'credentials.json'), 'utf8'), 'original-auth-untouched')
    const packageInfo = JSON.parse(readFileSync(join(
      home, 'local-plugins', 'dsh-codex-cli-models', 'package.json',
    ), 'utf8'))
    assert.equal(packageInfo.dsh.bundle.patch, './cordis.patch.yml')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('already-installed-but-disabled REA is activated without replacing its source or user configuration', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-rea-existing-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    const originalReaSource = 'https://github.com/xxxxxwater/rea#dsh-plugin-v0.2.0'
    const before = {
      dependencies: { another: '1.0.0', [REA_BUNDLE]: originalReaSource },
      dsh: { profile: { bundles: ['another', 'dsh-prompt-enhancer'] } },
      custom: { unchanged: true },
    }
    writeFileSync(join(profile, 'package.json'), JSON.stringify(before))
    install(home)
    const after = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(after.dependencies[REA_BUNDLE], originalReaSource)
    assert.deepEqual(after.dsh.profile.bundles.slice(0, 2), before.dsh.profile.bundles)
    assert.equal(after.dsh.profile.bundles.filter(x => x === REA_BUNDLE).length, 1)
    assert.deepEqual(after.custom, before.custom)
    install(home)
    const repeated = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(repeated.dependencies[REA_BUNDLE], originalReaSource)
    assert.equal(repeated.dsh.profile.bundles.filter(x => x === REA_BUNDLE).length, 1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

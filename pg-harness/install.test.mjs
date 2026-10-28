import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { install } from './install.mjs'
import { createHash } from 'node:crypto'
import { REA_BUNDLE, REA_RELEASE_ARCHIVE, REA_RELEASE_SPEC, REA_RELEASE_URL } from './rea-plugin.mjs'

// Offline stand-in for the GitHub release download; the installer still
// performs its sha256 check against this fixture's digest.
const REA_FIXTURE = Buffer.from('fixture dsh-rea-bundle archive\n')
const OFFLINE = Object.freeze({ rea: {
  download: (_url, file) => writeFileSync(file, REA_FIXTURE),
  sha256: createHash('sha256').update(REA_FIXTURE).digest('hex'),
} })

test('installation preserves third-party bundles and user settings and remains repeatable', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-install-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { retained: '1.2.3', 'dsh-pixel-font': 'link:original-font', 'dsh-imessage-blue': 'link:original-palette' }, dsh: { profile: { bundles: ['retained', 'dsh-pixel-font', 'dsh-imessage-blue'] } } }))
    writeFileSync(join(profile, 'cordis.patch.yml'), 'retained settings\n')
    writeFileSync(join(home, 'credentials.json'), 'retained credentials\n')
    install(home, OFFLINE)
    install(home, OFFLINE)
    const result = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(result.dependencies.retained, '1.2.3')
    assert.equal(result.dsh.profile.bundles[0], 'retained')
    assert.equal(result.dependencies['dsh-pixel-font'], 'link:original-font')
    assert.equal(result.dependencies['dsh-imessage-blue'], 'link:original-palette')
    assert.ok(!result.dsh.profile.bundles.includes('dsh-pixel-font'))
    assert.ok(!result.dsh.profile.bundles.includes('dsh-imessage-blue'))
    assert.equal(result.dsh.profile.bundles.filter(name => name === 'dsh-quiet-workspace').length, 1)
    assert.equal(result.dependencies['dsh-codex-cli-models'], 'link:../../local-plugins/dsh-codex-cli-models')
    assert.ok(result.dsh.profile.bundles.includes('dsh-codex-cli-models'))
    assert.equal(result.dependencies['dsh-evidence-trust'], 'link:../../local-plugins/dsh-evidence-trust')
    assert.ok(result.dsh.profile.bundles.includes('dsh-evidence-trust'))
    assert.equal(result.dependencies['dsh-prompt-pro'], 'link:../../local-plugins/dsh-prompt-pro')
    assert.equal(result.dsh.profile.bundles.filter(name => name === 'dsh-prompt-pro').length, 1)
    assert.ok(result.dsh.profile.bundles.includes('dsh-composer-menu'))
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

test('installing local UI updates preserves an already-installed disabled bundled plugin', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-disabled-bundle-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'billion-context': '0.1.199' }, dsh: { profile: { bundles: ['retained'] } } }))
    install(home, OFFLINE)
    const result = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(result.dependencies['billion-context'], '0.1.199')
    assert.ok(!result.dsh.profile.bundles.includes('billion-context'))
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('upgrades only the prior PureGamma-bundled dsh-purge archive', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-purge-upgrade-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        'dsh-purge': 'file:' + join(home, 'bundled-plugin-archives', 'dsh-purge-1.1.71-puregamma.3.tgz'),
        retained: '3.2.1',
      },
      dsh: { profile: { bundles: ['retained'] } },
    }))
    writeFileSync(join(home, 'prompt-inject.md'), 'user prompt remains\n')
    install(home, OFFLINE)
    const result = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(result.dependencies['dsh-purge'], 'file:../../bundled-plugin-archives/dsh-purge-1.1.71-puregamma.4.tgz')
    assert.equal(result.dependencies.retained, '3.2.1')
    assert.equal(readFileSync(join(home, 'prompt-inject.md'), 'utf8'), 'user prompt remains\n')
    assert.equal(result.dsh.profile.bundles.filter(name => name === 'dsh-purge').length, 1)
    result.dependencies['dsh-purge'] = 'link:../../local-plugins/dsh-purge'
    writeFileSync(join(profile, 'package.json'), JSON.stringify(result))
    install(home, OFFLINE)
    const custom = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(custom.dependencies['dsh-purge'], 'link:../../local-plugins/dsh-purge')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('bundled purge refreshes its old default prompt and recognizes the native app for restart', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-purge-compat-'))
  try {
    const archive = new URL('./bundled-plugins/dsh-purge-1.1.71-puregamma.4.tgz', import.meta.url)
    execFileSync('tar', ['-xzf', fileURLToPath(archive), '-C', home])
    const plugin = join(home, 'package')
    const core = await import(pathToFileURL(join(plugin, 'lib', 'core.js')).href)
    const desktop = await import(pathToFileURL(join(plugin, 'lib', 'desktop.js')).href)
    const prompt = core.defaultOverrideText()
    assert.ok(prompt.includes('PureGamma Harness'))
    assert.ok(prompt.length < 512)
    assert.ok(!prompt.includes('UNRESTRICTED'))
    const dshHome = join(home, 'profile')
    mkdirSync(join(dshHome, 'dsh-purge'), { recursive: true })
    const old = '<|im_start|>system:<project_instructions>Little Code Sauce</project_instructions>'
    writeFileSync(join(dshHome, 'prompt-inject.md'), old)
    writeFileSync(join(dshHome, 'dsh-purge', 'override-state.json'), JSON.stringify({
      customized: false, hash: core.hashOverride(old), seedHash: core.hashOverride(old),
    }))
    assert.equal(core.syncPromptInjectOnDiskSync(dshHome).action, 'wrote')
    assert.equal(readFileSync(join(dshHome, 'prompt-inject.md'), 'utf8'), prompt)
    writeFileSync(join(dshHome, 'prompt-inject.md'), 'User-authored prompt')
    assert.equal(core.syncPromptInjectOnDiskSync(dshHome).reason, 'user_custom')
    assert.equal(readFileSync(join(dshHome, 'prompt-inject.md'), 'utf8'), 'User-authored prompt')
    const exe = join(home, 'PureGamma Harness.app', 'Contents', 'MacOS', 'PureGamma Harness')
    mkdirSync(join(home, 'PureGamma Harness.app', 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(exe, '')
    assert.equal(desktop.restartPlan({ execPath: exe }).execPath, exe)
    assert.equal(desktop.desktopRestartChoice({ platform: 'darwin', exe }), 'helper')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('installation refuses an active desktop profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-install-'))
  try {
    mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'desktop', 'lock'), 'active')
    assert.throws(() => install(home, OFFLINE), /Quit Harness/)
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
    install(home, OFFLINE)
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
    install(home, OFFLINE)
    const after = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(after.dependencies[REA_BUNDLE], originalReaSource)
    assert.equal(after.dsh.profile.bundles[0], 'another')
    assert.ok(!after.dsh.profile.bundles.includes('dsh-prompt-enhancer'))
    assert.ok(after.dsh.profile.bundles.includes('dsh-prompt-pro'))
    assert.equal(after.dsh.profile.bundles.filter(x => x === REA_BUNDLE).length, 1)
    assert.deepEqual(after.custom, before.custom)
    install(home, OFFLINE)
    const repeated = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(repeated.dependencies[REA_BUNDLE], originalReaSource)
    assert.equal(repeated.dsh.profile.bundles.filter(x => x === REA_BUNDLE).length, 1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('REA release archive is downloaded, sha256-verified and installed via file: spec', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-rea-archive-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { [REA_BUNDLE]: REA_RELEASE_URL }, dsh: { profile: { bundles: ['kept'] } },
    }))
    const urls = []
    install(home, { rea: { ...OFFLINE.rea, download: (url, file) => { urls.push(url); writeFileSync(file, REA_FIXTURE) } } })
    assert.deepEqual(urls, [REA_RELEASE_URL])
    const result = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.equal(result.dependencies[REA_BUNDLE], REA_RELEASE_SPEC)
    assert.ok(REA_RELEASE_SPEC.startsWith('file:'))
    assert.deepEqual(readFileSync(join(home, 'bundled-plugin-archives', REA_RELEASE_ARCHIVE)), REA_FIXTURE)
    // A verified cached archive is reused without another download.
    install(home, { rea: { ...OFFLINE.rea, download: () => { throw new Error('unexpected download') } } })
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('tampered REA release archive fails closed without changing the profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-rea-tampered-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    const original = JSON.stringify({ dependencies: { kept: '1.0.0' }, dsh: { profile: { bundles: ['kept'] } } })
    writeFileSync(join(profile, 'package.json'), original)
    assert.throws(() => install(home, { rea: { ...OFFLINE.rea, download: (_url, file) => writeFileSync(file, 'evil') } }),
      /integrity check/)
    assert.equal(readFileSync(join(profile, 'package.json'), 'utf8'), original)
    assert.equal(readdirSync(join(home, 'bundled-plugin-archives')).length, 0)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('a user-disabled dsh-purge bundle stays disabled on reinstall', () => {
  const home = mkdtempSync(join(tmpdir(), 'pg-purge-disabled-'))
  try {
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['kept'] } } }))
    install(home, OFFLINE)
    const first = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.ok(first.dsh.profile.bundles.includes('dsh-purge'))
    first.dsh.profile.bundles = first.dsh.profile.bundles.filter(name => name !== 'dsh-purge')
    writeFileSync(join(profile, 'package.json'), JSON.stringify(first))
    install(home, OFFLINE)
    const second = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    assert.ok(!second.dsh.profile.bundles.includes('dsh-purge'))
    assert.equal(second.dependencies['dsh-purge'], 'file:../../bundled-plugin-archives/dsh-purge-1.1.71-puregamma.4.tgz')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

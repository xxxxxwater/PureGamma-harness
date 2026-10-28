/**
 * PureGamma's first-party REA Desktop integration.
 *
 * Installing a dependency and activating a dsh.profile.bundles layer are
 * distinct Harness operations. This is an explicit installer opt-in, not a
 * background plugin-manager mutation. Never touch pnpm allowBuilds.
 */
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REA_BUNDLE = 'dsh-rea-bundle'
export const REA_BUNDLE_VERSION = '0.2.0'
export const REA_RELEASE_ARCHIVE = 'dsh-rea-bundle-0.2.0.tgz'
// Pinned standalone bundle release, not the repo root (which has prepare).
// GitHub release assets are mutable, so the installer never hands this URL to
// pnpm directly: it downloads the archive, verifies REA_RELEASE_SHA256 and
// installs the verified local copy via a file: spec.
export const REA_RELEASE_URL =
  'https://github.com/xxxxxwater/rea/releases/download/dsh-v0.2.0/' + REA_RELEASE_ARCHIVE
export const REA_RELEASE_SHA256 =
  '011e78aebde2b71577286869b65719af83de888e01313445e744999d78844630'
// Dependency spec written into the Desktop profile (relative to profiles/desktop).
export const REA_RELEASE_SPEC = 'file:../../bundled-plugin-archives/' + REA_RELEASE_ARCHIVE
// Earlier PureGamma installers wrote the unverified release URL; migrate it.
export const REA_LEGACY_SPECS = Object.freeze([REA_RELEASE_URL])

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Synchronously download url to file using a child Node process (fetch). */
export function downloadFileSync(url, file) {
  const script = [
    "const [url, file] = process.argv.slice(-2)",
    "const res = await fetch(url, { redirect: 'follow' })",
    "if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url)",
    "const { writeFileSync } = await import('node:fs')",
    "writeFileSync(file, Buffer.from(await res.arrayBuffer()), { flag: 'wx', mode: 0o600 })",
  ].join('\n')
  execFileSync(process.execPath, ['--input-type=module', '-e', script, url, file], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
    timeout: 300000,
  })
}

/**
 * Ensure the pinned REA archive is present under home/bundled-plugin-archives
 * and matches REA_RELEASE_SHA256. An existing verified copy is reused; a
 * mismatching download is deleted and the install fails closed.
 * @returns absolute path of the verified archive.
 */
export function ensureReaReleaseArchive(home, {
  download = downloadFileSync, url = REA_RELEASE_URL, sha256 = REA_RELEASE_SHA256,
} = {}) {
  const destination = join(home, 'bundled-plugin-archives', REA_RELEASE_ARCHIVE)
  if (existsSync(destination) && sha256File(destination) === sha256) return destination
  mkdirSync(dirname(destination), { recursive: true })
  const pending = destination + '.' + process.pid + '-' + randomBytes(4).toString('hex') + '.download'
  try {
    download(url, pending)
    const actual = existsSync(pending) ? sha256File(pending) : 'missing'
    if (actual !== sha256) {
      throw new Error('REA release archive failed its integrity check (expected sha256 '
        + sha256 + ', got ' + actual + '); refusing to install it')
    }
    renameSync(pending, destination)
  } finally {
    if (existsSync(pending)) unlinkSync(pending)
  }
  return destination
}

/** Whether selectReaBundle would (re)write the pinned archive spec. */
export function reaArchiveNeeded(manifest) {
  const previous = manifest?.dependencies?.[REA_BUNDLE]
  return previous === undefined || REA_LEGACY_SPECS.includes(previous)
}

/**
 * Explicitly select REA as part of the user-requested PureGamma install.
 * Preserve existing specs (tarball, Git tag, local path, newer version) and
 * the relative order of every existing profile bundle. Repeated runs are
 * idempotent. Do not modify npm/ pnpm workspace or build-script approvals.
 */
export function selectReaBundle(manifest) {
  const deps = manifest?.dependencies
  const bundles = manifest?.dsh?.profile?.bundles
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new Error('Desktop profile dependencies must be an object')
  }
  if (!Array.isArray(bundles) || bundles.some(name => typeof name !== 'string' || !name)) {
    throw new Error('Desktop dsh.profile.bundles must be an array of package names')
  }
  if (new Set(bundles).size !== bundles.length) {
    throw new Error('Desktop dsh.profile.bundles contains duplicates; refusing to alter it')
  }
  const previous = Object.hasOwn(deps, REA_BUNDLE) ? deps[REA_BUNDLE] : undefined
  if (previous !== undefined && (typeof previous !== 'string' || !previous.trim())) {
    throw new Error('Existing dsh-rea-bundle dependency spec is invalid; refusing to override it')
  }
  const addedDependency = previous === undefined || REA_LEGACY_SPECS.includes(previous)
  if (addedDependency) deps[REA_BUNDLE] = REA_RELEASE_SPEC
  const enabledNow = !bundles.includes(REA_BUNDLE)
  if (enabledNow) bundles.push(REA_BUNDLE)
  return Object.freeze({
    addedDependency,
    enabledNow,
    source: deps[REA_BUNDLE],
    bundles: bundles.length,
  })
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { throw new Error('Cannot read JSON ' + path + ': ' + error.message) }
}

function includesRow(contents, id) {
  return new RegExp('(?:^|\\n)\\s*-?\\s*id:\\s*[\\x27\\x22]?' + id + '[\\x27\\x22]?(?=\\s|$)', 'm').test(contents)
}

function readTextIfPresent(path) {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : '' }
  catch { return '' }
}

function fileMtime(path) {
  try { return statSync(path).mtimeMs } catch { return null }
}

/** Read-only status snapshot; does not launch Node or the REA MCP subprocess. */
export function inspectReaBundle(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const profile = join(home, 'profiles', 'desktop')
  const manifestPath = join(profile, 'package.json')
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null
  const dependencies = manifest?.dependencies
  const names = manifest?.dsh?.profile?.bundles
  const source = dependencies && Object.hasOwn(dependencies, REA_BUNDLE)
    ? dependencies[REA_BUNDLE] : null
  const selected = Array.isArray(names) && names.includes(REA_BUNDLE)
  const pkgDir = join(profile, 'node_modules', REA_BUNDLE)
  const pkgPath = join(pkgDir, 'package.json')
  const launcher = join(pkgDir, 'launcher.mjs')
  const patchPath = join(pkgDir, 'cordis.patch.yml')
  const packageInfo = existsSync(pkgPath) ? readJson(pkgPath) : null
  const patch = readTextIfPresent(patchPath)
  const validPackage = packageInfo?.name === REA_BUNDLE
    && packageInfo?.dsh?.bundle?.patch === './cordis.patch.yml'
    && existsSync(launcher)
  const validPatch = includesRow(patch, 'rea-launcher')
    && includesRow(patch, 'rea-mcp')
    && patch.includes('@deepseek-ai/dsh-mcp-client')
    && patch.includes('serverName: rea')
    && patch.includes('transport: stdio')

  let runtimeReady = false
  let runtimeError = null
  if (validPackage) {
    try {
      // Node resolves modules relative to the real launcher path; do not
      // assume pnpm uses flat node_modules directories.
      const from = realpathSync(launcher)
      const entry = createRequire(from).resolve('rea-agents/scripts/rea.mjs')
      runtimeReady = statSync(entry).isFile()
    } catch (error) { runtimeError = error.message }
  }

  const compiledPath = join(profile, 'cordis.yml')
  const compiled = readTextIfPresent(compiledPath)
  const legacyPatchPath = join(home, 'cordis.patch.yml')
  // Home-level patches outrank profile bundles; report conflicting legacy
  // config but never delete, change or override a user's global patch.
  const homePatchOverridesRea = includesRow(readTextIfPresent(legacyPatchPath), 'rea-mcp')
  const composed = includesRow(compiled, 'rea-launcher') && includesRow(compiled, 'rea-mcp')
  const manifestMtime = fileMtime(manifestPath)
  const compiledMtime = fileMtime(compiledPath)
  const composedFresh = composed && manifestMtime !== null
    && compiledMtime !== null && compiledMtime >= manifestMtime - 1000
  return {
    profile,
    source,
    selected,
    bundled: validPackage && validPatch,
    version: packageInfo?.version ?? null,
    runtimeReady,
    runtimeError,
    composed,
    composedFresh,
    homePatchOverridesRea,
  }
}

/**
 * Opt-in local-only repair for a successfully installed but disabled bundle.
 * The PureGamma installer is intentionally not invoked: do not reinstall any
 * third-party dependencies or write pnpm lockfiles / build allowlists here.
 * Fully quit the Desktop app before invoking this command.
 */
export function activateInstalledReaBundle(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  const profile = join(home, 'profiles', 'desktop')
  if (existsSync(join(profile, 'lock'))) {
    throw new Error('Desktop profile is locked; fully quit PureGamma Harness before activating REA')
  }
  const manifestPath = join(profile, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error('Missing Desktop package.json; use the packaged installer first')
  }
  const original = readFileSync(manifestPath)
  const current = readJson(manifestPath)
  const selected = current?.dsh?.profile?.bundles
  const dependency = current?.dependencies?.[REA_BUNDLE]
  if (typeof dependency !== 'string' || !dependency.trim()) {
    throw new Error('REA dependency is missing; install the bundle before activating it')
  }
  if (!Array.isArray(selected) || selected.some(name => typeof name !== 'string' || !name)
    || new Set(selected).size !== selected.length) {
    throw new Error('Invalid Desktop dsh.profile.bundles; refusing to change any file')
  }
  const status = inspectReaBundle(home)
  if (!status.bundled || !status.runtimeReady) {
    throw new Error('REA installed files or engine are missing; refusing to enable a broken bundle')
  }
  if (selected.includes(REA_BUNDLE)) {
    return Object.freeze({ changed: false, backup: null, selected: selected.length })
  }
  if (!readFileSync(manifestPath).equals(original)) {
    throw new Error('Desktop profile changed during inspection; retry after fully quitting')
  }
  const nonce = new Date().toISOString().replace(/[:.]/g, '-')
    + '-' + process.pid + '-' + randomBytes(4).toString('hex')
  const backup = manifestPath + '.rea-backup-' + nonce
  copyFileSync(manifestPath, backup, constants.COPYFILE_EXCL)
  const pending = join(dirname(manifestPath), '.package.json.rea-' + nonce + '.pending')
  try {
    current.dsh.profile.bundles.push(REA_BUNDLE)
    const mode = statSync(manifestPath).mode & 0o777
    writeFileSync(pending, JSON.stringify(current, null, 2) + '\n', { flag: 'wx', mode })
    if (!readFileSync(manifestPath).equals(original)) {
      throw new Error('Desktop profile changed before replacement; backup retained')
    }
    renameSync(pending, manifestPath)
  } finally {
    if (existsSync(pending)) unlinkSync(pending)
  }
  return Object.freeze({ changed: true, backup, selected: current.dsh.profile.bundles.length })
}

function formatStatus(result) {
  return [
    'Profile: ' + result.profile,
    'REA dependency: ' + (result.source === null ? 'MISSING' : result.source),
    'REA enabled: ' + result.selected,
    'Bundle package and patch: ' + result.bundled,
    'REA runtime resolved: ' + result.runtimeReady,
    'Cordis composed: ' + result.composed,
    'Home-level rea-mcp override: ' + result.homePatchOverridesRea,
    'Cordis current with profile: ' + result.composedFresh,
    ...result.runtimeError === null ? [] : ['Runtime resolution: ' + result.runtimeError],
  ].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    console.log('Usage: node rea-plugin.mjs [--status | --verify | --activate]')
    console.log('--status and --verify are read-only; --activate backs up and safely selects an existing REA bundle.')
    console.log('Prefer the Desktop Plugins UI switch; quit the app completely before --activate.')
  } else {
    const action = args.length ? args[0] : '--status'
    if (args.length > 1 || !['--status', '--verify', '--activate'].includes(action)) {
      console.error('Expected --status, --verify or --activate')
      process.exitCode = 2
    } else {
      try {
        if (action === '--activate') {
          const change = activateInstalledReaBundle()
          console.log(change.changed ? 'REA enabled; original backup: ' + change.backup : 'REA already selected: no change')
          console.log('Fully restart Desktop and run --verify; confirm mcp__rea__* tools in a new session.')
        }
        const result = inspectReaBundle()
        console.log(formatStatus(result))
        if (action === '--verify') {
          if (result.source === null || !result.selected || !result.bundled
              || !result.runtimeReady || !result.composedFresh
              || result.homePatchOverridesRea) {
            throw new Error('REA is not yet active; install/enable it and fully restart Desktop')
          }
          console.log('PASS: REA dependency, selected bundle, local engine and generated Cordis layer')
          console.log('Verify mcp__rea__* tools separately inside a live Desktop session.')
        }
      } catch (error) {
        console.error(error.message)
        process.exitCode = 1
      }
    }
  }
}

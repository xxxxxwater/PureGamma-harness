/**
 * PureGamma's first-party REA Desktop integration.
 *
 * Installing a dependency and activating a dsh.profile.bundles layer are
 * distinct Harness operations. This is an explicit installer opt-in, not a
 * background plugin-manager mutation. Never touch pnpm allowBuilds.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REA_BUNDLE = 'dsh-rea-bundle'
export const REA_BUNDLE_VERSION = '0.2.0'
// Pinned standalone bundle release, not the repo root (which has prepare).
export const REA_RELEASE_SPEC =
  'https://github.com/xxxxxwater/rea/releases/download/dsh-v0.2.0/dsh-rea-bundle-0.2.0.tgz'
// Metadata for operators verifying the versioned release through GitHub.
export const REA_RELEASE_SHA256 =
  '011e78aebde2b71577286869b65719af83de888e01313445e744999d78844630'

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
  const addedDependency = previous === undefined
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
    console.log('Usage: node rea-plugin.mjs [--status | --verify]')
    console.log('Read-only checks for the PureGamma / DeepSeek Harness Desktop profile.')
    console.log('To enable a disabled REA bundle, use Desktop Plugins UI or rerun the PureGamma installer after quitting Desktop.')
  } else {
    const action = args.length ? args[0] : '--status'
    if (args.length > 1 || !['--status', '--verify'].includes(action)) {
      console.error('Expected --status or --verify (read only)')
      process.exitCode = 2
    } else {
      try {
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

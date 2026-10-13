# REA for PureGamma Harness: Desktop setup and activation

PureGamma Harness integrates the native `dsh-rea-bundle` Cordis plugin, not
the REA Git repository's root CLI package. The aim is to expose local
`mcp__rea__*` reverse-engineering tools in Desktop sessions.

## Current pinned release

| Item | Value |
| --- | --- |
| Bundle | `dsh-rea-bundle@0.2.0` |
| Installer source | `https://github.com/xxxxxwater/rea/releases/download/dsh-v0.2.0/dsh-rea-bundle-0.2.0.tgz` |
| Published artifact SHA-256 | `011e78aebde2b71577286869b65719af83de888e01313445e744999d78844630` |
| REA runtime dependency inside the bundle | `rea-agents@6.4.0` |
| Alternate standalone Git tag | `https://github.com/xxxxxwater/rea#dsh-plugin-v0.2.0` |

The REA repository's `main` branch has moved beyond the runtime version
pinned by the stable bundle. Updating the Git source does not automatically
upgrade `rea-agents`. Wait for a tested new plugin release before changing
the runtime pin. Do not install the untagged REA repository root or loosen
pnpm `allowBuilds`: the root CLI includes install-time build hooks and is
not a Harness bundle.

## Installing on Intel Mac, Apple Silicon and Windows

1. Fully quit PureGamma / DeepSeek Harness.
2. Run the matching packaged `Install PureGamma Harness` helper. The
   installer uses the app-bundled Node and pnpm and backs up Desktop profile
   manifests and lockfiles in `~/.dsh/pg-harness-backups`.
3. On fresh installs, the helper registers the versioned standalone REA
   release asset as a dependency. The first dependency install needs internet.
4. The helper **also selects `dsh-rea-bundle` in
   `dsh.profile.bundles`**. Dependency installation without this step is
   not enough to activate its Cordis `rea-launcher` and `rea-mcp` rows.
5. Relaunch Desktop; open a fresh session and confirm `mcp__rea__*`
   tools appear.

If REA is already installed but disabled, prefer
**Plugins → Installed plugins → dsh-rea-bundle → Enable**. If the UI switch
is inaccessible, fully quit Desktop and rerun the PureGamma installer.
That run preserves your existing REA version and dependency source (even a
custom Git-tagged package), keeps existing bundle ordering, and only appends
the missing enabled entry. Other plugins, settings, credentials and sessions
remain untouched. Running the installer is an explicit opt-in to activating
the packaged plugins; to deliberately keep REA disabled, turn off its
Desktop switch after setup and do not rerun the installer.

## Read-only local diagnosis

From this repository checkout, with Node.js installed:

~~~sh
node pg-harness/rea-plugin.mjs --status
# After restarting Desktop:
node pg-harness/rea-plugin.mjs --verify
~~~

In the packaged macOS app, **a global Node installation is not needed**:

~~~sh
APP="/Applications/PureGamma Harness.app"
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/PureGamma Harness" \
  "$APP/Contents/Resources/pg-harness/rea-plugin.mjs" --status
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/PureGamma Harness" \
  "$APP/Contents/Resources/pg-harness/rea-plugin.mjs" --verify
~~~

Both commands are read-only. Verification checks manifest registration,
selected-bundle state, native patch/launcher files, the resolved REA runtime,
and the generated `cordis.yml` rows with modification-time freshness.
It cannot prove the MCP process actually initialized, survived, or registered
every tool: confirm live `mcp__rea__*` tools in Desktop separately.

If `$DSH_HOME/cordis.patch.yml` has a legacy `rea-mcp` row, it may
override the profile plugin due to higher Cordis patch precedence. Status
reports this but **never deletes it**. Back up and manually fix that global
configuration, retaining unrelated entries. For damaged plugin files or
unresolved REA runtime, inspect the Desktop install logs and rerun the
packaged installer; do not disable supply-chain checks.

## Compatibility and safety

PureGamma Harness currently remains **ahead of its DeepSeek Harness upstream
and is not missing upstream commits**. This integration is source code only:
no macOS computer was changed and no new installer binary was published.
The stable version is a pinned package, not a promise that REA follows
`main` automatically.

Tests cover fresh install, install-but-disabled migration, idempotence,
retained third-party sources and settings, malformed-profile refusal,
legacy global override detection and stale Cordis files. The separate CI
job verifies the pinned release tarball and npm dependency resolution on
Linux. Native macOS Electron GUI acceptance still requires local testing.

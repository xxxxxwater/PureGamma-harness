# PureGamma Harness installation and plugins

English | [中文](README.zh.md)

Install the release for your computer, add the bundled plugin capabilities, and continue using your existing local Harness data. This source builds PureGamma Harness with upstream engine `0.2.1-rc.2`.

<a id="installation"></a>

## Installation

Quit all Harness instances before installing plugins. The installer preserves existing dependencies, settings, sessions, and credentials, and writes reversible configuration backups under `.dsh/pg-harness-backups`. A fresh installation needs network access to download missing plugin libraries; no system Node.js installation is required.

| Platform | Steps |
| --- | --- |
| Intel Mac | Extract the x64 ZIP. Keep `Install PureGamma Harness.command` beside `PureGamma Harness.app`, run it once, then launch the app. |
| M-series Mac | Extract the arm64 ZIP and run the same adjacent command. Use the arm64 app on Apple Silicon. |
| Windows x64 | Run the EXE installer and quit the app if it opens. In the installed application folder, run `resources/pg-harness/Install PureGamma Harness.cmd`, then open the app. |
| Source | Extract the source ZIP or clone this repository. Follow the build steps below. |

You can move the Mac app after plugin installation. Mac builds are ad-hoc signed and have not been Apple notarized; the Windows build is unsigned. The application id and Electron data directory remain compatible with the upstream desktop installation. Personal conversations, context records, API credentials, and user profiles are excluded from every published artifact.

<a id="plugins-and-local-setup"></a>

## Plugins and local setup

The [inventory](bundled-plugins/inventory.json) records 13 third-party plugin archives, their exact versions, licenses, SHA-256 hashes, and the official bundles. The installer validates each new archive and retains an existing dependency's version, source, and enabled state. PureGamma UI packages provide integrated plugin navigation, IDE code colors, and a [quiet workspace](plugins/dsh-quiet-workspace/README.md) with neutral colors and system typography. The installer retains legacy blue-message and pixel-font dependencies without enabling them. Native plugins add Codex models and a macOS completion chime.

| Package | Capability and setup |
| --- | --- |
| [`dsh-evidence-trust`](plugins/dsh-evidence-trust/README.md) | Session-scoped hash-chained tool Evidence Ledger, Unknown Registry, and an opt-in fail-closed Verification Gate. Audit-only by default; never stores raw tool outputs. |
| [`dsh-codex-cli-models`](plugins/dsh-codex-cli-models/README.md) | Use locally authenticated Codex models with Harness history and tools; sign in through Settings → Codex CLI. |
| [`dsh-prompt-pro`](plugins/dsh-prompt-pro/README.md) | Expand a draft through the locally authenticated Codex CLI with a monochrome composer icon and undo. |
| [`dsh-composer-menu`](plugins/dsh-composer-menu/README.md) | Open files, projects, GitHub references, Skills, connectors, design guidelines, and plugins from the conversation plus menu. |
| [`dsh-claude-cli-models`](plugins/dsh-claude-cli-models/README.md) | Read the local Claude CLI account's model catalog; inference requires that account's eligible plan or authorization. |
| [`dsh-task-completion-chime`](plugins/dsh-task-completion-chime/README.md) | Play one chime per successful top-level turn on macOS. |
| `dsh-context` | Inspect how the context is composed and how it changes. |
| `billion-context` | Compress conversation context; configure its model-related settings locally. |
| `@vectorize-io/hindsight-coding-agents` | Integrate long-term coding memory; configure a Hindsight connection locally. |
| `dsh-better-sidebar` | Browse files, edit, inspect changes, and access workspace panels beside a conversation. |
| `dsh-at-file` | Find and reference workspace paths with `@`. |
| `@linxin666/dsh-client-ui-skill-explorer` | Browse and manage skills from available sources. |
| `@dhicoc/dsh-reverse-skill` | Route reverse-engineering and authorized security-research skills. |
| `dsh-ego-browser` | Automate the browser and watch its live panel; install the plugin's required browser locally. |
| `dsh-magicpath` | Invoke MagicPath from a session; authenticate its CLI locally. |
| `dsh-sentinelx` | Connect SentinelX tools; complete the hub's OAuth authorization locally. |
| `dsh-univer-office` | Preview and collaborate on office files through its gateway and viewer. |
| `dshmarket` | Browse, search, and install community plugins. |
| `open-sea-skin` | Display an optional ocean skin where WebGPU is supported. |

The Codex model plugin requires the official Codex CLI installed locally. Every user authorizes their own ChatGPT account in the browser; an existing CLI login is reused automatically. Requests share that account’s Codex / ChatGPT Work allowance. The installer mounts the native provider instead of the earlier text-only `dsh-codex-cli` bundle and retains its dependency for rollback. Codex and Claude Code subagent bundles are part of the upstream source and runtime; their providers require local configuration. Included code does not supply any account, subscription, or API credentials. The capability rail shows mounted plugins and keeps pinned choices on the device; some entries open the relevant settings or tool panel rather than a dedicated page.

The installer also applies version-scoped compatibility patches to the shipped `dsh-at-file` 0.7.0, `dsh-magicpath` 0.1.0, and `billion-context` 0.1.190 packages after dependencies are installed. At-file keeps its live `@` picker, file filters, and enable switch, storing settings at `~/.dsh/pg-harness-state/dsh-at-file.json` (or under `DSH_HOME`); this avoids the removed `settings.register()` API. Both Host and browser strict Remote codecs use the current schema factories, and the picker waits for its Remote namespace to mount. MagicPath retains its official CLI commands and result fields with validated, supported tool JSON Schemas, and withdraws its tool registration on unload. Billion-context keeps its request interception and context compression but defaults to direct `fetch` wrapping rather than a global property accessor, avoiding interference with Node diagnostics; `BILI_RECLAIM_FETCH_PATCH=1` explicitly opts back into upstream accessor re-arming. Each changed entry point is backed up in the install's `pg-harness-backups` folder; different package versions remain untouched, and existing v1 repairs receive the codec and cleanup fixes without replacing settings. Restart Harness after running the plugin installer to load the fixes.

The installer adds a preview compatibility fix to the bundled `dsh-univer-office` 0.3.7 client. Native calls and nested code-tool calls now populate conversation review cards and live windows; open `.univer` files in the right sidebar for the file viewer. The fix subscribes to the current turn's Chat tool source, so nested call results appear without a full conversation refresh. It preserves plugin settings and dependency pins, backs up the original client, and refuses an unrecognized 0.3.7 build; other versions are left unchanged. The readable implementation is under `plugin-patches/univer-office`.

The bundled Better Sidebar 0.25.0 terminal uses the current Connection service and retains its Host/Origin checks, including native-shell WebSocket support. The installer applies the version-specific repair after dependency installation and backs up the original entry point.

SentinelX 0.1.1 declares support for rc.2 through its unchanged bridge and compatible Harness APIs. The installer backs up its manifest and extends only the known peer ranges, retaining its dependency versions, linked source, OAuth state, and any explicit custom compatibility policy.

<a id="build-and-verify"></a>

## Build and verify

Use Node.js 24, the pnpm version in `package.json`, and a native host that matches the target. Install the locked dependencies before building. Each packaging command builds the source, prepares the runtime, and runs the packaged-runtime smoke checks.

| Target | Command |
| --- | --- |
| Intel Mac | `pnpm run package:desktop:mac:x64:unsigned --dir` |
| Apple Silicon Mac | `pnpm run package:desktop:mac:arm64:unsigned --dir` |
| Windows x64 | `pnpm run package:desktop:win:x64:unsigned` |

The manual [release build workflow](../.github/workflows/puregamma-desktop-release.yml) builds Windows and Apple Silicon on separate native runners. The source archive comes from the release commit. Run `node --test pg-harness/install.test.mjs pg-harness/plugin-patches/bundled-compat.test.mjs pg-harness/plugin-patches/univer-office/preview.test.mjs pg-harness/plugins/dsh-codex-cli-models/plugin.test.mjs pg-harness/plugins/dsh-task-completion-chime/plugin.test.mjs` for profile preservation and office preview regressions. The preview fixture exercises the shipped client with real React and includes the unpatched client's missing-preview case. The owning client and desktop tests cover the brand and packaging contracts.

The app carries this directory in its resources. The Windows helper and Mac command use the bundled runtime to run `install.mjs`; optional plugins are added to the reserved desktop profile. The upstream MIT license and third-party notices apply, and the pixel font licenses are included under `licenses`.

The MemOS 2.0.20-compat.1 adapter receives a version-scoped source fix for Session format v4: recall and auxiliary user messages use producer identities, and auxiliary assistant messages identify their model. The installer backs up both adapter files and retains the memory database and settings.

# Codex CLI model provider for PureGamma Harness

The `dsh-codex-cli` plugin adds an OpenAI **Codex CLI** model route to the *current* Harness chat model selector. This is different from the existing `subagent-codex` delegation tool. The plugin delegates authentication, model access decisions and API traffic entirely to the official local Codex CLI, without copying its auth file or accessing undocumented endpoints.

## Login on the same OS user account

1. Install the official Codex CLI: `npm install -g @openai/codex`.
2. Run `codex login` in a local Terminal and finish ChatGPT OAuth. For a headless session, the official CLI supports `codex login --device-auth`.
3. Confirm authentication with `codex login status`. Do not paste an OAuth access token into PureGamma or the repository.
4. Close PureGamma Harness, rerun `Install PureGamma Harness.command` / the bundled Windows installer helper (or `node pg-harness/install.mjs` in the source tree), and reopen the app.
5. From the normal Harness **model selector**, select **OpenAI Codex CLI (ChatGPT login)** and `Codex · CLI default`. The default alias lets the CLI choose its configured model. Another offered example is `gpt-6.1-sol`, subject to entitlement and installed CLI support.

Optional: if a macOS desktop launch cannot find the CLI because it has no interactive shell PATH, set the Cordis plugin config `binary` to the full executable path shown by `which codex`, or export `PG_CODEX_CLI_BIN=/absolute/path/to/codex` in the app launch environment. Model IDs are configurable through `models: ['codex-default', 'another-model-id']` in the plugin's Cordis settings.

## Model-call semantics and safety

- The adapter registers `codex-cli` with the Harness LLM registry; it can therefore be selected **within an existing conversation**, and the full text context is serialized into each new Codex CLI request. There is no hidden parallel context or cross-session thread reuse.
- It uses `codex exec --json --ephemeral --sandbox read-only`, noninteractive approval mode, no shell command interpolation, and an isolated temporary cwd. Child processes terminate on abort or after a maximum of five minutes.
- **Text only:** images and file blocks are rejected; native Harness tool declarations and tool calls are not implemented as bidirectional Codex tool use. The Codex CLI may have internal read-only tools, which are *not* recorded as Harness tool invocations.
- Only the user's local `codex login` manages OAuth secrets; no tokens, auth.json, cookies or subscription identifiers are copied by this plugin. The CLI retains its normal provider access and usage limits.
- The adapter limits each projected prompt to 1 MiB and each response to 8 MiB. It never truncates past turns silently and reports missing CLI, execution failure, cancellation and empty output explicitly.
- This is a source/plugin update; it does not sign in on your behalf, package a new desktop binary, or verify actual account-specific Codex responses. Functional tests mock the Codex executable without real credentials.

Official CLI commands: https://learn.chatgpt.com/docs/cli/reference

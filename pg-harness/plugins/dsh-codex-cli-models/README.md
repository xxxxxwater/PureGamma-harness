# Codex CLI models plugin

English | [中文](README.zh.md)

For PureGamma Harness 0.2.1-alpha.2, with live verification on macOS. Install the official Codex CLI on the same device and OS account before enabling this plugin. In Settings, open **Codex CLI** and select **Use ChatGPT to sign in**. Complete authorization in the browser, then choose a model under **Codex CLI · ChatGPT** in the conversation model menu. An existing local Codex CLI login is recognized automatically. Installing this plugin does not change existing conversation selections or global Codex model configuration.

Every person signs in with their own ChatGPT account and uses that account's allowance. No account, subscription, API key, login file, or personal conversation is included in the plugin. The Settings panel provides re-login, account switching, a browser continuation link, and cancellation of an unfinished authorization.

The model catalog comes from the official `codex app-server` `model/list` method. Every non-hidden model returned by that Codex catalog is selectable, including model IDs that the installed Harness catalog does not yet know; those IDs use the Codex Responses adapter profile and any context or output limits the CLI reports. This is the Codex CLI catalog, not a promise that every model shown in the regular ChatGPT app is available to Codex. A listed model does not prove inference permission or remaining quota; requests can return account limit errors. The official CLI owns login and renewal. The plugin reads its request credential without returning tokens to the page, copying them into Harness configuration, or writing the CLI login file.

Requests consume the current account's shared Codex / ChatGPT Work allowance, rather than ordinary ChatGPT Chat message limits or OpenAI API balances. Check the official usage dashboard or Codex CLI `/status` for remaining allowance. Harness token counts cannot be converted into subscription limits. See [official pricing](https://learn.chatgpt.com/docs/pricing).

The host's existing PiAiAdapter converts full Harness history, tool calls, reasoning, and images into Codex Responses requests. Harness continues to execute and approve tools; the plugin does not start a separate Codex agent for each message. Account HTTP routes use the host Connection authentication and origin checks.

Optional configuration: `cliPath` is an absolute executable path; `cliHome` selects an existing CLI login directory. By default, the plugin follows `CODEX_HOME`, otherwise `~/.codex`. This version requires ChatGPT credentials saved in `auth.json`; keychain-only credentials produce an explicit login error. It never falls back to an ambient API key. A missing CLI must be installed before loading the host plugin.

Disabling or uninstalling releases the model route, Settings panel, and CLI subprocess while preserving the local CLI account login. The installer replaces the earlier text-only `dsh-codex-cli` bundle with this provider; it retains the earlier dependency and backs up the profile for rollback. Both providers use `codex-cli` and must not be enabled together.

Protocol reference: [Codex app-server](https://learn.chatgpt.com/docs/app-server).

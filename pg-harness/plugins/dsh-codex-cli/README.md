# Codex CLI text provider for PureGamma Harness

English | [中文](README.zh.md)

This optional `dsh-codex-cli` provider offers text-only inference through the official local CLI. The PureGamma installer instead enables [the native Codex models plugin](../dsh-codex-cli-models/README.md), which provides browser authorization and Harness tool support. Both register `codex-cli`; enable only one provider. Existing dependencies are retained for rollback.

## Local authentication and configuration

Install the official Codex CLI and sign in under the same OS account with `codex login`. Each person uses their own ChatGPT account and allowance; no credentials are included. Check login with `codex login status`. See [official CLI commands](https://learn.chatgpt.com/docs/cli/reference).

To use this optional provider, disable `dsh-codex-cli-models` and manually enable the `dsh-codex-cli` bundle in Plugins. Rerunning the PureGamma installer selects the native provider again. In the model selector, choose **OpenAI Codex CLI (ChatGPT login)** and `Codex · CLI default`; the CLI chooses its configured model. Explicit model IDs remain subject to account access and installed CLI support.

Configuration accepts `binary` as an absolute CLI executable path, or `PG_CODEX_CLI_BIN` in the app launch environment. `models` sets the offered IDs, for example `['codex-default', 'another-model-id']`.

## Inference behavior

The full text history is serialized into each `codex exec --json --ephemeral --sandbox read-only` request in an isolated temporary working directory, without cross-session thread reuse or shell interpolation. Processes terminate on cancellation or after five minutes. Prompts are limited to 1 MiB and responses to 8 MiB; missing CLI, failed requests, empty output, and oversized content produce errors rather than silently truncating history.

Images and file blocks are rejected. Harness tool declarations and tool calls are not bridged; any CLI internal tools are not recorded as Harness tool invocations. The official CLI owns login, provider access, and usage limits. This provider copies no login files, tokens, cookies, or subscription identifiers. Automated tests use a mock CLI rather than account-specific inference.

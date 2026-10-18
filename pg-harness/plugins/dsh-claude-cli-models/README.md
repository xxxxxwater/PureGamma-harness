# Claude CLI models plugin

English | [中文](README.zh.md)

This optional PureGamma Harness plugin uses the official Claude CLI account on your machine. Install Claude Code, run `claude auth login` in Terminal, and choose a model under **Claude CLI · claude.ai account** in the Harness conversation menu. The plugin asks Claude's own model picker for the current account's choices and refreshes them after one minute.

The Claude CLI owns login, token storage, and renewal. The plugin never reads or copies its credentials and excludes ambient Anthropic API keys from its subprocess environment. Model listing alone does not prove that a request will succeed; a completed response verifies access. `claude auth status` can report a saved login even when its session has expired.

This version carries text conversation history and returns text responses. It disables Claude's built-in tools so Claude cannot edit files or run commands outside Harness approvals. Harness tool calls and images are not yet available through this provider. Existing Anthropic API-key routes remain separate.

Anthropic requires prior approval before a third-party product offers claude.ai login or subscription rate limits. Enable this plugin only for an approved integration.

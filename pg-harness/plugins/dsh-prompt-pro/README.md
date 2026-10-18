# PureGamma Prompt Pro

English | [中文](README.zh.md)

Adds one monochrome SVG button to the Harness conversation composer. Click it to expand the current draft into a clearer, more professional request using the locally authenticated Codex CLI. The result replaces the draft and is never sent automatically. Click the button again to undo, or edit the result before sending.

The plugin preserves the original intent and constraints, avoids invented facts, and adapts the amount of structure to the task. It uses an authenticated local endpoint, an ephemeral Codex CLI run in an empty read-only workspace, and does not save prompt text in its own files. The call uses the signed-in ChatGPT Codex quota. A draft edited during enhancement is never overwritten.

Requires a working `codex` CLI login. Set `PG_PROMPT_PRO_CODEX_PATH` if the CLI is outside the usual executable paths. The server accepts at most two concurrent requests and limits each draft to 12,000 characters.

# PureGamma Evidence Trust (v0.1.0)

A Cordis plugin for the PureGamma Harness desktop profile. It adds a session-scoped **Evidence Ledger**, **Unknown Registry**, and **Verification Gate** without modifying the upstream Agent Loop or vendor source. The PureGamma installer mounts it; after reinstall, restart the app.

## What it actually guarantees

- Observes final `tools/result` outcomes (including errors and policy denials) in the executing Agent session. Stores the tool name, success/failure, argument/result **SHA-256 hashes**, hashed call identity, monotonic sequence, and a chained ledger digest. **No raw tool arguments, outputs, API keys, or tokens** are persisted by the ledger.
- Stores explicit unresolved questions linked to a prior recorded evidence ID. Resolution needs a later successful observation from a configured verifier tool, and is itself appended to the chain. A successful tool result is **not** proof that a business outcome is correct.
- Mounts `ctx.tools.guard()`, a monotonic last-mile denial after `tools/pre-execute`. In `enforce` mode, protected tools fail closed if the ledger is corrupt/unavailable, any unknown remains open, or configured verification observations are missing/stale.
- Evidence data lives under `$DSH_HOME/pg-trust-ledgers/<SHA256(session-id)>.jsonl` (default `~/.dsh`). Files are created private; no stored credential data is intentional. An unexpected disk write error makes the in-memory ledger unhealthy; corruption blocks protected operations.

The chain **detects edits**, but SHA-256 does not authenticate against an attacker who can rewrite the entire file and recompute hashes. Protect filesystem permissions and backups. The ledger is separate from Harness session-log persistence; an interrupted write causes a fail-closed session until safely recovered by an administrator. This version does not claim cross-host attestation, signed CI proofs, semantic test verification, or automatic recovery. File size is capped at 32 MiB per session and old records are not silently pruned.

## Agent-facing tools

| Tool | Action |
| --- | --- |
| `pg_trust_status` | Show integrity, recent evidence IDs, open unknowns and configured policy |
| `pg_trust_open_unknown` | Record a question tied to a real evidence ID |
| `pg_trust_resolve_unknown` | Close a question with **later** successful verifier evidence |
| `pg_trust_check_gate` | Read-only preview of what the gate would decide for a tool name |

These management tools cannot manufacture a successful observation or override the gate. Do not store secrets in free-text questions.

## Enabling enforcement

The installer sets **audit** with empty patterns; it never changes existing tool permissions. To protect a known tool, use a later profile patch that replaces the `evidence-trust` row's **entire** config (the Loader does not deep-merge rows). Example policy:

```yaml
- patch:
    id: evidence-trust
    config:
      mode: enforce
      protectedTools: ['your_publish_tool']
      verifierTools: ['your_ci_verifier_tool']
      mutationTools: ['your_code_edit_tool']
```

Replace all placeholder names with **actual registered tool names**. Every verifier pattern must be backed by a trusted, read-only validator (e.g. a CI status reader with pinned run/artifact identity). Generic shell commands, LLM summaries, and self-reported PASS strings are **not trusted verifiers**. The gate requires at least one successful observation for **each** verifier pattern after the last successful mutation-tool observation, with no unresolved unknowns. Configuration with `mode: enforce` but without protected and verifier lists fails at plugin initialization.

**Important boundary:** this is a tool-name/session-scoped gate, not an OS sandbox or a proof that one specific commit passed CI. Other tools that can deploy, write, or execute must be independently sandboxed or explicitly protected. For production releases, add artifact SHA and external CI signature checks before treating the gate as a security control.

## Verification and rollback

Run `node --test pg-harness/plugins/dsh-evidence-trust/ledger.test.mjs pg-harness/install.test.mjs` from repo root. The plugin is pure Node ESM; its tests exercise persistence, tamper detection, unknown resolution, stale proof invalidation and denial. The standard PureGamma installer backs up the desktop profile configuration and pre-existing local plugin files before replacement. To disable, remove the `dsh-evidence-trust` bundle from the desktop profile and restart; existing JSONL ledgers are preserved for audit.

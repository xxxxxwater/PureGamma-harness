# PureGamma Harness upstream sync — 2026-10-16

## Git lineage

- Upstream: `deepseek-ai/deepseek-harness@86a402200d95fecef4529d969836f1fe13c6cb0d` (`dsh-v0.2.1-alpha.4`).
- Preserved fork head: `xxxxxwater/PureGamma-harness@31eb85b2d44857a411f3b3d9500f875c72acde90`.
- Original fork preserved in `backup/master-pre-alpha4-20261016`.
- This synchronization uses a two-parent merge commit to retain both histories. Upstream changes form the base of the merged tree, with the PureGamma-specific branding, plugins, launch/install support, and CI configurations reapplied.

## Preserved PureGamma additions

- `pg-harness/` installer, local optional plugin bundles, compatibility patches, REA integration, and original local plugin packages.
- PureGamma-branded desktop assets, shell/client labels, menu and about panel text.
- Codex CLI, evidence trust, iMessage, plugin rail, pixel font, completion chime, VS Code code theme, and other custom bundle sources.
- Existing `puregamma-*.yml` workflows.

## Merge decisions

- Modified files without conflicting upstream edits retained their fork versions.
- Most colliding desktop script and UI source files were updated by applying PureGamma-specific edits onto upstream alpha.4 versions.
- The desktop and chat README source documents with incompatible full-document edits retained the fork versions; future documentation refresh may be needed.
- `pnpm-lock.yaml` uses the alpha.4 lockfile plus PureGamma's additional local `ui-conversation` workspace devDependency.

## Validation

The source synchronization does not imply that an Electron installer or plugin is already installed on user devices. Validate by running the plugin compatibility tests, typecheck, desktop packaging tests, and package smoke checks before releasing binaries. Do not publish a release solely from the presence of this merge.

## Local update

Use this fork's updated `master` branch after integration CI passes. Re-run the PureGamma installer on the target workstation and restart the app; installed plugin bundles and their activation state are separate.

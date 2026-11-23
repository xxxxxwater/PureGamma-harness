---
description: "PureGamma Harness branding and the default click-triggered pixel whale on the home page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

The shipped Web and Desktop compositions load this package to play a pixel whale animation on the blank home. An `official` client build shows PureGamma Harness branding in the sidebar and conversation hero. Other profiles use the shell and hero fallbacks. The background owns only temporary canvas resources and adds no model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web and Desktop compositions mount this plugin by default. Home feedback is active when the plugin mounts. An `official` client build also registers the PureGamma branding.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects which brand renders. An `official` build shows the PureGamma swallow and product name in the sidebar and the swallow in the conversation hero. Other values use the shell's default mark and local-build label and the hero fallback from `dsh-client-ui-conversation`. The home background is shared across build profiles.

### Home feedback

The default home stays clear until a primary click on empty space plays one light-gray whale breach. Successive completed clicks alternate between dots and code lettering, starting with dots. Both use the same large animated silhouette. The animation lasts 5.7 seconds, then clears. Repeated clicks leave the current playback uninterrupted. The whale's frame layer classifies clicks: blank space inside its frame triggers playback, including margins beside the input card, while input fields, controls, the input card, portaled overlays, and a click that ends a text selection never do. The canvas takes neither focus nor pointer events; the frame receives the clicks. On narrow homes the whale keeps a larger scale and is cropped at the canvas edges, without adding horizontal scrolling. Reduced-motion preference disables it, and leaving the blank home releases its animation and observers.

The whale uses very faint neutral theme ink, appearing as a subtle background texture; code lettering has more contrast than the dots. Water splashes retain fine particles with stronger ink, especially on the left during landing. A packaged frame atlas supplies the motion; the browser loads it once through the plugin asset route on the first eligible click. Code fills use dense 7px lettering drawn only from authored code slogans, and the moving silhouette clips text as it enters or leaves the water. Decode or pixel-read failures stop the decoration, leave home usable, and log a reload action.

The artwork values are fixed and the row takes no configuration. This is built-in presentation, without a separately installed bundle or Plugins-page toggle.

### Replacing the brand

A deployment with its own identity composes a replacement package that occupies the sidebar and hero-mark slots, plus the `conversation.hero.frame` layer if it supplies home feedback. The artwork identity comes from slot composition.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The sidebar occupants install as one declaration-aware set. Nested `ctx.slots.inject()` calls wait for both sidebar declarations and withdraw the branding when either declaration collapses. The hero mark also waits for its own declaration. The independent `conversation.hero.frame` layer owns the canvas renderer and waits for its declaration through `ctx.slots.inject()`. While `hero` is true it paints the canvas at negative `z-index`, above the Conversation background and below all Conversation content. It plays on primary clicks within its frame, outside controls and the composer card. Portaled overlays and clicks that end a text selection leave the canvas idle. The browser half is [`src/client/index.ts`](src/client/index.ts), and the Node half is an empty Loader seat. The [frame atlas](src/client/assets/breach-atlas.webp) samples seconds 1.5–7.2 of the user-supplied [showcase video](https://yinghuo-hg.deepseek.com/wuyexinrui/dev-cpu/web-showcase/orca.mp4) at 24 frames per second, with 192 × 108 cells stored as lossless WebP. Its red and green channels encode dot radius and opacity at 32 levels. The renderer reads it once after the first eligible click. `DSH_CLIENT_TITLE` selects the browser title at build time.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero and the `conversation.hero.frame` layer this package occupies.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **Decorative rendering requires Canvas 2D** — unavailable contexts or reduced-motion preference leave the home clear.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

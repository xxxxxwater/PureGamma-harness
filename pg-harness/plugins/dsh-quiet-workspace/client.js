/** Neutral workspace tokens and chrome; native navigation and theme selection remain authoritative. */
window.__ModuleLoader__.load({ id: 'dsh-quiet-workspace', factory: () => ({
 name: 'quiet-workspace-client',
 apply(ctx) {
  ctx.effect(() => {
   const style = document.createElement('style'); style.id = 'pg-quiet-workspace';
   style.textContent = `
body {
 --pg-surface: #fff; --pg-sidebar: #f7f7f7; --pg-raised: #fff; --pg-ink: #202020;
 --pg-muted: #777; --pg-hover: #ebebeb; --pg-line: #e6e6e6; --pg-input: #fff;
}
body[data-ds-dark-theme] {
 --pg-surface: #212121; --pg-sidebar: #181818; --pg-raised: #2b2b2b; --pg-ink: #ececec;
 --pg-muted: #a1a1a1; --pg-hover: #303030; --pg-line: #383838; --pg-input: #303030;
}
body, body[data-ds-dark-theme] {
 --dsw-alias-bg-base: var(--pg-surface) !important;
 --dsw-alias-bg-layer-1: var(--pg-surface) !important;
 --dsw-alias-bg-layer-2: var(--pg-raised) !important;
 --dsw-specific-sidebar-fill: var(--pg-sidebar) !important;
 --dsw-specific-input-major: var(--pg-input) !important;
 --dsw-specific-bubble: var(--pg-hover) !important;
 --dsw-specific-bubble-highlight: var(--pg-hover) !important;
 --dsw-alias-label-primary: var(--pg-ink) !important;
 --dsw-alias-label-secondary: var(--pg-muted) !important;
 --dsw-alias-border-l3: var(--pg-line) !important;
 --dsw-alias-interactive-bg-hover: var(--pg-hover) !important;
 --dsw-alias-button-elevated-fill: var(--pg-raised) !important;
 --dsw-alias-button-info-fill: var(--pg-ink) !important;
 --dsw-alias-button-info-hover: var(--pg-muted) !important;
 --dsw-alias-state-business-primary: var(--pg-ink) !important;
}
body, button, input, textarea, select, [class*='_brandName'], [class*='_fallbackBrandName'] {
 font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif !important;
 -webkit-font-smoothing: antialiased;
}
pre, code, kbd, pre *, code * { font-family: 'SFMono-Regular', Consolas, monospace !important; }
body #root { margin-left: 0; width: 100%; }
body [class$='_sidebarCol'], body[data-ds-dark-theme] [class$='_sidebarCol'] {
 background: var(--pg-sidebar) !important; border-right: none;
}
body [class$='_centerCol'] { border-left: none !important; }
[data-slot='sidebar'] [class*='_logoRow'] { height: 44px; margin-top: -4px; margin-bottom: 8px; padding: 4px 8px; }
[data-slot='sidebar'] [class*='_brandName'] { font-size: 17px; font-weight: 600; letter-spacing: -.5px; }
[data-slot='sidebar.brand.name'] { display: none !important; }
[data-slot='sidebar'] [class*='_brandName']::after { content: 'PureGamma'; }
[data-slot='sidebar'] [class*='_brandMark'] { width: 22px; }
[data-slot='sidebar'] [class*='_brandIdentity'] { gap: 9px; }
[data-slot='sidebar'] [class*='_localBuildBrand'] { display: none; }
[data-slot='sidebar'] [class*='_newSession'] { border: 0; box-shadow: none; background: transparent !important; border-radius: 9px; }
[data-slot='sidebar'] button[class*='_newSession'] { justify-content: flex-start; height: 38px; margin-bottom: 4px; padding: 8px 12px; font-size: 13px; }
[data-slot='sidebar'] [class*='_newSessionContent'] { width: auto; justify-content: flex-start; gap: 10px; }
[data-slot='sidebar'] button[class*='_newSession']:hover { background: var(--pg-hover) !important; }
[data-slot='sidebar'] [class*='_panelList'] { gap: 2px; padding-bottom: 4px; }
[data-slot='sidebar'] [class*='_panelRow'] { min-height: 36px; padding: 8px 12px; border-radius: 9px; font-size: 13px; }
[data-slot='sidebar'] [class*='_panelActive'] { background: var(--pg-hover); color: var(--pg-ink); }
[data-slot='sidebar'] [class*='_panelGlyph'] { width: 17px; height: 17px; }
[data-slot='sidebar'] [class*='_footArea'] { padding-top: 8px; border-top: 1px solid var(--pg-line); }
[data-slot='sidebar'] [class*='_regionArea'] { margin-top: 8px; }
[data-slot='sidebar'] button { transition: background-color 120ms ease; }
header:has([data-conversation-header-leading]) { padding: 12px 24px 10px 20px; min-height: 56px; border-bottom-color: transparent; }
header:has([role='tablist']) { border-bottom-color: var(--pg-line); }
[data-conversation-header-leading] { margin-right: 16px; }
.pg-header-name { display: inline-flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 500; letter-spacing: -.45px; white-space: nowrap; }
.pg-header-name small { font-size: 11px; font-weight: 400; color: var(--pg-muted); letter-spacing: 0; }
html[data-platform='darwin'] [data-sidebar-collapsed='true'] .pg-header-name { margin-inline-start: max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - 20px)); }
[data-sidebar-collapsed='true'] header:has(.pg-header-name) [class*='_titleRow'] { padding-inline-start: 0; }
[class*='_headerActions'], [class*='_headerUtilities'], [data-conversation-header-corner] { gap: 4px; }
[data-conversation-header-corner] { margin-right: -12px; }
[data-conversation-header-corner] button, [class*='_headerUtilities'] button, [class*='_headerActions'] button {
 min-width: 32px; min-height: 32px; border-radius: 9px; box-shadow: none;
}
.pg-header-more { display: grid; place-items: center; width: 32px; height: 32px; flex: none; margin-right: 4px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--pg-ink); cursor: pointer; -webkit-app-region: no-drag; }
.pg-header-more:hover { background: var(--pg-hover); }
.pg-header-more svg { width: 19px; height: 19px; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline-color: var(--pg-muted); outline-offset: 2px; }
body [class$='_bubble'] { color: var(--pg-ink) !important; --dsw-alias-label-primary: var(--pg-ink); --dsw-alias-label-secondary: var(--pg-muted); border-radius: 22px; }
body [class$='_bubble'] a { color: inherit !important; }
@media (max-width: 850px) { .pg-header-name small { display: none; } [data-conversation-header-leading] { margin-right: 8px; } }
@media (prefers-reduced-motion: reduce) { [data-slot='sidebar'] button { transition: none; } }
`;
   document.head.append(style);
   return () => style.remove();
  }, 'quiet-workspace: appearance');
 }
}) });

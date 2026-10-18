window.__ModuleLoader__.load({ id: 'dsh-composer-menu', factory: require => {
  const React = require('react'), h = React.createElement
  const { createPortal } = require('react-dom')
  const NS = 'pg.composerMenu'
  const zh = { title: '添加内容', files: '添加文件或照片', projects: '添加到项目', github: '从 GitHub 添加', skills: 'Skills', connectors: '添加连接器', design: '设计系统', plugins: '插件', search: '网页搜索', back: '返回', empty: '暂无可用项目', loading: '正在加载…', changed: '草稿已改变，请重新打开菜单后选择。', repoHint: '将 GitHub 仓库、文件或 Issue 链接加入草稿', add: '添加到草稿', invalid: '请输入有效的 https://github.com/ 链接', workspaceHint: '将当前草稿带入所选项目的新会话', chooseFolder: '选择其他文件夹…', ui: '界面设计规范', components: '组件设计规范', brand: '品牌与视觉规范', manage: '管理已安装插件', commands: '全部指令', find: '搜索', searchHint: '在草稿中加入联网检索要求', searchText: '请使用可用的网页搜索工具核实相关信息，优先引用可靠来源，并附上来源链接。', uiText: '请先梳理页面目标与用户流程，再给出布局、信息层级、间距、字体和响应式规范；遵循现有设计语言，使用简洁的单色矢量图标，并检查键盘操作与可读性。', componentsText: '请定义可复用组件及其尺寸、间距、交互状态、键盘行为和无障碍要求，覆盖默认、悬停、聚焦、禁用、加载与错误状态，并与现有组件保持一致。', brandText: '请根据现有品牌资料梳理视觉规范，明确字体、层级、图标、留白和素材使用规则；未提供的品牌信息先核实，并提供可落地的应用示例。' }
  const en = { title: 'Add content', files: 'Add files or photos', projects: 'Add to project', github: 'Add from GitHub', skills: 'Skills', connectors: 'Add connectors', design: 'Design system', plugins: 'Plugins', search: 'Web search', back: 'Back', empty: 'No items available', loading: 'Loading…', changed: 'The draft changed. Reopen the menu and choose again.', repoHint: 'Add a GitHub repository, file, or issue link to the draft', add: 'Add to draft', invalid: 'Enter a valid https://github.com/ link', workspaceHint: 'Open a new conversation in the selected project with this draft', chooseFolder: 'Choose another folder…', ui: 'Interface design guidelines', components: 'Component guidelines', brand: 'Brand and visual guidelines', manage: 'Manage installed plugins', commands: 'All commands', find: 'Search', searchHint: 'Add a web research requirement to the draft', searchText: 'Use the available web search tools to verify relevant information, prefer reliable sources, and include source links.', uiText: 'Clarify the page goals and user flows, then define layout, information hierarchy, spacing, typography, and responsive behavior. Follow the existing design language, use simple monochrome vector icons, and verify keyboard access and readability.', componentsText: 'Define reusable components, dimensions, spacing, interaction states, keyboard behavior, and accessibility. Cover default, hover, focus, disabled, loading, and error states, keeping the existing components consistent.', brandText: 'Review the available brand materials and define typography, hierarchy, icons, spacing, and asset rules. Verify missing brand facts and provide practical application examples.' }
  const paths = { files: 'M8 12.5 15.5 5a4 4 0 0 1 5.5 5.8L10.5 21A6 6 0 0 1 2 12.5L12.5 2', projects: 'M3 7h18l-2 14H5L3 7ZM7 3h10M2 7h20', github: 'M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .2-2-1-3 4 0 7-2 7-6 0-2-1-3-2-4 0-1 0-2-.3-3-2 0-4 1-5 2-2-.5-4-.5-6 0-1-1-3-2-5-2-.4 1-.4 2-.3 3-1 1-2 2-2 4 0 4 3 6 7 6-1 1-1 2-1 3v4', skills: 'M6 3h14v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 0v18M9 8l2-2 2 2 2-2 2 2', connectors: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 17h7M17.5 13.5v7', design: 'M21 12A9 9 0 1 0 12 21c3 0 1-4 4-4s5-2 5-5ZM7 8h.01M12 5h.01M17 9h.01M6 13h.01', plugins: 'm8 3-4 4 13 13 4-4M5 8l-3 3 4 4M10 3l4 4M9 14l-6 7M15 4l4-4', search: 'M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c5 5 5 13 0 18-5-5-5-13 0-18Z', arrow: 'm9 5 7 7-7 7', back: 'm15 5-7 7 7 7', check: 'm4 12 5 5L21 5' }
  const icon = name => h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.plugins }))
  function ComposerMenu(props) {
    const { t, menuActions } = props
    const draft = props.useInput(value => value?.draft ?? '')
    const workspaces = props.useWorkspaces(value => value?.items ?? [])
    const marker = React.useRef(null), menu = React.useRef(null), plus = React.useRef(null), span = React.useRef(null)
    const [position, setPosition] = React.useState(null), [page, setPage] = React.useState(''), [items, setItems] = React.useState([]), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [query, setQuery] = React.useState('')
    const close = React.useCallback(() => { setPosition(null); setPage(''); setQuery(''); plus.current?.setAttribute('aria-expanded', 'false') }, [])
    React.useEffect(() => {
      const card = marker.current?.closest('[data-composer-card]')
      const button = card?.querySelector('button[aria-haspopup="listbox"]')
      if (!button) return
      plus.current = button
      const original = { label: button.getAttribute('aria-label'), title: button.getAttribute('title') }
      const open = event => {
        event.preventDefault(); event.stopPropagation()
        span.current = props.inputActions.captureInsertion()
        const rect = button.getBoundingClientRect()
        setPosition(current => current ? null : { left: Math.max(12, Math.min(rect.left, innerWidth - 332)), bottom: Math.max(12, innerHeight - rect.top + 10), maxHeight: Math.max(180, rect.top - 24) })
        setPage(''); setQuery(''); setError('')
      }
      button.setAttribute('aria-label', t('title'))
      button.setAttribute('title', t('title'))
      button.addEventListener('click', open, true)
      return () => {
        button.removeEventListener('click', open, true)
        for (const [key, value] of Object.entries(original)) value === null ? button.removeAttribute(key === 'label' ? 'aria-label' : key) : button.setAttribute(key === 'label' ? 'aria-label' : key, value)
      }
    }, [props.inputActions, t])
    React.useEffect(() => {
      if (!position) return
      plus.current?.setAttribute('aria-expanded', 'true')
      const dismiss = event => { if (!menu.current?.contains(event.target) && !plus.current?.contains(event.target)) close() }
      const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); plus.current?.focus() } }
      document.addEventListener('pointerdown', dismiss, true)
      document.addEventListener('keydown', escape, true)
      window.addEventListener('resize', close)
      menu.current?.querySelector('button,input')?.focus()
      return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', close) }
    }, [position, page, close])
    React.useEffect(() => { close() }, [props.sessionId, close])
    React.useEffect(() => {
      if (!['skills', 'plugins', 'connectors'].includes(page)) return
      const abort = new AbortController(); setBusy(true); setError(''); setItems([])
      const request = Promise.resolve().then(() => page === 'skills' ? menuActions.skills(props.sessionId) : menuActions.plugins())
      request.then(result => {
        if (abort.signal.aborted) return
        if (!result.ok) throw new Error(result.error?.message || 'Request failed')
        const rows = page === 'skills' ? result.value.skills.map(skill => ({ id: skill.name, label: skill.name, detail: skill.description })) : result.value.filter(item => item.installed && (page !== 'connectors' || /mcp|sentinel|magicpath|browser|connector/i.test(item.name))).map(item => ({ id: item.name, label: item.meta?.name?.zh || item.name, detail: item.version }))
        setItems(rows)
      }).catch(cause => { if (!abort.signal.aborted) setError(cause.message) }).finally(() => { if (!abort.signal.aborted) setBusy(false) })
      return () => abort.abort()
    }, [page, props.sessionId, menuActions])
    const insert = text => {
      if (!props.inputActions.insertText(text, span.current)) { setError(t('changed')); return }
      close()
    }
    const selectPage = name => { setPage(name); setError(''); setQuery('') }
    const row = (id, label, action, sub = false, checked = false, detail = '') => h('button', { type: 'button', role: checked ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': checked || undefined, 'data-pg-menu-action': id, key: id, onClick: action, className: 'pg-composer-menu-row', title: detail || label }, icon(paths[id] ? id : page || 'plugins'), h('span', { className: 'pg-composer-menu-label' }, label, detail ? h('small', null, detail) : null), sub ? icon('arrow') : checked ? icon('check') : null)
    let body
    if (!page) body = [row('files', t('files'), () => { marker.current.closest('[data-composer-card]').querySelector('input[type=file]')?.click(); close() }), row('projects', t('projects'), () => selectPage('projects'), true), row('github', t('github'), () => selectPage('github')), h('hr', { key: 'a' }), ...['skills', 'connectors', 'design', 'plugins'].map(id => row(id, t(id), () => selectPage(id), true)), h('hr', { key: 'b' }), row('search', t('search'), () => { if (!draft.includes(t('searchText'))) insert((draft ? '\n\n' : '') + t('searchText')); else close() }, false, draft.includes(t('searchText')), t('searchHint'))]
    else if (page === 'github') body = [h('p', { key: 'hint' }, t('repoHint')), h('form', { key: 'form', onSubmit: event => { event.preventDefault(); try { const url = new URL(query); if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.pathname.split('/').filter(Boolean).length < 2 || url.username || url.password) throw new Error(); insert((draft ? '\n\n' : '') + url.href) } catch { setError(t('invalid')) } } }, h('input', { 'aria-label': 'GitHub URL', placeholder: 'https://github.com/owner/repository', value: query, onChange: event => setQuery(event.target.value), autoFocus: true }), h('button', { type: 'submit', className: 'pg-composer-menu-row' }, t('add')))]
    else if (page === 'projects') body = [h('p', { key: 'hint' }, t('workspaceHint')), ...workspaces.map(workspace => row(workspace.workspaceId, workspace.title || workspace.path || workspace.cwd || workspace.workspaceId, () => { close(); menuActions.project(workspace.workspaceId, draft) })), row('folder', t('chooseFolder'), async () => { try { await menuActions.folder(draft); close() } catch (cause) { setError(cause.message) } })]
    else if (page === 'design') body = ['ui', 'components', 'brand'].map(id => row(id, t(id), () => insert((draft ? '\n\n' : '') + t(id + 'Text'))))
    else body = [h('input', { key: 'query', 'aria-label': t('find'), placeholder: t('find'), value: query, onChange: event => setQuery(event.target.value) }), ...items.filter(item => (item.label + ' ' + (item.detail || '')).toLowerCase().includes(query.toLowerCase())).map(item => row(item.id, item.label, () => { if (page === 'skills') insert('/' + item.id + ' '); else { close(); menuActions.plugin(item.id) } }, false, false, item.detail)), !busy && !items.length ? h('p', { key: 'empty' }, t('empty')) : null, page === 'plugins' ? row('manage', t('manage'), () => { close(); menuActions.manage() }) : null]
    return h('span', { ref: marker, 'data-pg-composer-menu': '' }, position ? createPortal(h('div', { ref: menu, role: 'menu', 'aria-label': t('title'), className: 'pg-composer-menu', style: position, onKeyDown: event => { if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return; event.preventDefault(); const buttons = [...menu.current.querySelectorAll('button,input')]; const index = buttons.indexOf(document.activeElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus() } }, page ? h('button', { type: 'button', className: 'pg-composer-menu-back', onClick: () => selectPage('') }, icon('back'), t(page)) : null, ...body, busy ? h('p', null, t('loading')) : null, error ? h('p', { role: 'alert' }, error) : null), document.body) : null)
  }
  return { inject: ['slots', 'locale', 'layout', 'uiWorkspace', 'workspaces', 'remote', 'remote.skills', 'remote.pluginManager'], apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'composer-menu: dictionaries')
    ctx.effect(() => {
      const style = document.createElement('style'); style.textContent = '.pg-composer-menu{position:fixed;z-index:10000;box-sizing:border-box;width:320px;max-width:calc(100vw - 24px);overflow:auto;padding:7px;border:1px solid var(--pg-line,#444);border-radius:18px;background:var(--pg-surface,var(--dsw-alias-bg-layer-2,#242424));color:var(--pg-ink,var(--dsw-alias-label-primary,#eee));box-shadow:0 12px 36px #0004;font:15px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.pg-composer-menu-row,.pg-composer-menu-back{box-sizing:border-box;display:flex;align-items:center;gap:13px;width:100%;padding:12px 13px;border:0;border-radius:11px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.pg-composer-menu-row:hover,.pg-composer-menu-row:focus-visible,.pg-composer-menu-back:hover{background:var(--pg-hover,#ffffff0b);outline:none}.pg-composer-menu-row svg{flex:none}.pg-composer-menu-label{flex:1;min-width:0;overflow-wrap:anywhere}.pg-composer-menu-label small{display:block;font-size:11px;opacity:.6;margin-top:3px}.pg-composer-menu hr{margin:6px 13px;border:0;border-top:1px solid var(--pg-line,#444)}.pg-composer-menu p{padding:5px 13px;font-size:12px;opacity:.7}.pg-composer-menu input{box-sizing:border-box;width:calc(100% - 16px);margin:5px 8px;padding:10px;border:1px solid var(--pg-line,#444);border-radius:9px;background:transparent;color:inherit;font:inherit}.pg-composer-menu-back{font-size:13px;opacity:.75;border-bottom:1px solid var(--pg-line,#444);border-radius:0}'; document.head.append(style); return () => style.remove()
    }, 'composer-menu: monochrome styles')
    const menuActions = {
      skills: sessionId => ctx.remote.skills.list({ sessionId }), plugins: () => ctx.remote.pluginManager.listBundles(),
      plugin: name => ctx.get('pluginNavigation')?.openBundle(name), manage: () => ctx.layout.selectPanel('plugins'),
      project: (id, prompt) => ctx.uiWorkspace.startSession(id, { prompt }),
      folder: async prompt => { const path = await ctx.uiWorkspace.pickDirectory(); if (path) { const workspace = await ctx.workspaces.create({ path }); ctx.uiWorkspace.startSession(workspace.workspaceId, { prompt }) } },
    }
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'pg-composer-menu', order: -100, locale: NS, inject: () => ({ menuActions }) }, ComposerMenu))
  } }
} })

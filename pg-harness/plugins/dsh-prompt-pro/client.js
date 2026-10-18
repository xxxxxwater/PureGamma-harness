window.__ModuleLoader__.load({ id: 'dsh-prompt-pro', factory: require => {
  const React = require('react')
  const h = React.createElement
  const icon = undo => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    ...(undo ? [h('path', { key: 'a', d: 'M9 14 4 9l5-5' }), h('path', { key: 'b', d: 'M4 9h9a7 7 0 0 1 0 14h-2' })]
      : [h('path', { key: 'a', d: 'M4 7h10M4 12h12M4 17h8' }), h('path', { key: 'b', d: 'm18 3 .8 2.2L21 6l-2.2.8L18 9l-.8-2.2L15 6l2.2-.8L18 3Z' }), h('path', { key: 'c', d: 'm19 14 .5 1.5L21 16l-1.5.5L19 18l-.5-1.5L17 16l1.5-.5L19 14Z' })]))
  function PromptPro(props) {
    const state = props.useInput(value => value)
    const latest = React.useRef(state)
    latest.current = state
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [undo, setUndo] = React.useState(null)
    const abortRef = React.useRef(null)
    React.useEffect(() => () => abortRef.current?.abort(), [])
    React.useEffect(() => { setUndo(null); setError(''); abortRef.current?.abort() }, [props.sessionId])
    const canUndo = undo && state?.draft === undo.after
    const enhance = async () => {
      if (busy || !state?.draft?.trim() || !props.inputActions?.setDraft) return
      if (canUndo) { props.inputActions.setDraft(undo.before); setUndo(null); return }
      const before = state.draft
      const revision = state.draftRev
      const controller = new AbortController()
      abortRef.current = controller
      setBusy(true); setError(''); setUndo(null)
      try {
        const response = await fetch('/pg-prompt-pro/api/enhance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft: before }), signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || '增强失败')
        if (latest.current?.draftRev !== revision || latest.current?.draft !== before) throw new Error('草稿已改变，增强结果未覆盖您的编辑')
        if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('增强结果为空')
        props.inputActions.setDraft(result.text.trim())
        setUndo({ before, after: result.text.trim() })
      } catch (cause) { if (cause.name !== 'AbortError') setError(cause.message || '增强失败') }
      finally { if (abortRef.current === controller) abortRef.current = null; setBusy(false) }
    }
    const label = busy ? '正在丰富提示词' : canUndo ? '撤回专业化' : '一键丰富并专业化提示词'
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', position: 'relative' } },
      h('button', { type: 'button', title: label, 'aria-label': label, onClick: enhance, disabled: busy || !state?.draft?.trim(), style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 29, height: 29, padding: 4, border: 0, borderRadius: 7, background: 'transparent', color: 'inherit', opacity: busy ? .45 : .75, cursor: busy ? 'wait' : 'pointer' } }, icon(canUndo)),
      error ? h('span', { role: 'alert', style: { position: 'absolute', right: 0, bottom: '100%', width: 220, padding: 8, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2, #242424)', color: 'inherit', fontSize: 12, lineHeight: 1.4, boxShadow: '0 4px 16px #0003' } }, error) : null)
  }
  return { inject: ['slots'], apply(ctx) { ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'pg-prompt-pro', order: 80, label: '专业化提示词' }, PromptPro)) } }
} })

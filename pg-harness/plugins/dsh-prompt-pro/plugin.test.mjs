import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { instruction } from './index.js'

function mountedClient() {
  const hooks = []
  let cursor = 0
  let component
  let draft = '帮我写项目复盘'
  let draftRev = 1
  let answer = '请为五人研发团队编写一份项目复盘模板。'
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(value) { const slot = cursor++; return hooks[slot] ??= { current: value } },
    useState(value) { const slot = cursor++; hooks[slot] ??= { value }; return [hooks[slot].value, next => { hooks[slot].value = next }] },
    useEffect() { cursor++ },
  }
  const context = {
    window: { __ModuleLoader__: { load(module) { const plugin = module.factory(name => name === 'react' ? React : undefined); plugin.apply({ slots: { inject(_key, register) { register() }, register(_options, view) { component = view } } }) } } },
    fetch: async () => ({ ok: true, json: async () => ({ text: answer }) }),
    AbortController,
  }
  runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), context)
  const render = () => { cursor = 0; const tree = component({ sessionId: 'test', useInput: select => select({ draft, draftRev }), inputActions: { setDraft(value) { draft = value; draftRev++ } } }); return tree.props.children[0] }
  return { render, read: () => draft, edit(value) { draft = value; draftRev++ }, answer(value) { answer = value } }
}

test('professional rewrite preserves the exact original request as input', () => {
  const text = instruction('保留 5 倍杠杆；只修改测试。')
  assert.match(text, /保留 5 倍杠杆；只修改测试。/)
  assert.match(text, /不编造/)
  assert.match(text, /不执行请求本身/)
})

test('monochrome composer button rewrites the draft and can undo', async () => {
  const client = mountedClient()
  const button = client.render()
  assert.equal(button.type, 'button')
  assert.equal(button.props.style.color, 'inherit')
  assert.equal(button.props.children[0].type, 'svg')
  await button.props.onClick()
  assert.equal(client.read(), '请为五人研发团队编写一份项目复盘模板。')
  await client.render().props.onClick()
  assert.equal(client.read(), '帮我写项目复盘')
})

test('a changed draft is not overwritten by a late result', async () => {
  let release
  const client = mountedClient()
  const originalFetch = globalThis.fetch
  try {
    // The client module closes over the injected fetch; use a delayed response in the fixture.
    const pending = new Promise(resolve => { release = resolve })
    const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
    const hooks = []
    let cursor = 0, component, draft = '原稿', draftRev = 1
    const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useRef(value) { const i = cursor++; return hooks[i] ??= { current: value } },
      useState(value) { const i = cursor++; hooks[i] ??= { value }; return [hooks[i].value, next => { hooks[i].value = next }] },
      useEffect() { cursor++ } }
    runInNewContext(source, { window: { __ModuleLoader__: { load(module) { module.factory(() => React).apply({ slots: { inject(_key, fn) { fn() }, register(_opts, view) { component = view } } }) } } }, fetch: () => pending, AbortController })
    const render = () => { cursor = 0; return component({ sessionId: 'test', useInput: fn => fn({ draft, draftRev }), inputActions: { setDraft(value) { draft = value; draftRev++ } } }).props.children[0] }
    const running = render().props.onClick()
    draft = '用户正在编辑的新稿'; draftRev++
    render()
    release({ ok: true, json: async () => ({ text: '过期结果' }) })
    await running
    assert.equal(draft, '用户正在编辑的新稿')
  } finally { globalThis.fetch = originalFetch }
})

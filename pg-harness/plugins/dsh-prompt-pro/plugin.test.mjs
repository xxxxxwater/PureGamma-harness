import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { apply, cliEnvironment, findCodex, instruction, runCodex } from './index.js'

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

test('Codex subprocess gets an allowlisted environment, including Windows runtime variables', () => {
  assert.deepEqual(cliEnvironment({ HOME: '/h', PATH: '/bin', OPENAI_API_KEY: 'private', DSH_WEB_TOKEN: 'private', HTTPS_PROXY: 'http://p' }, 'linux'),
    { HOME: '/h', PATH: '/bin', HTTPS_PROXY: 'http://p', NO_COLOR: '1' })
  const win = cliEnvironment({ Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\L', SystemRoot: 'C:\\Windows', TMP: 'C:\\T', OPENAI_API_KEY: 'private' }, 'win32')
  assert.deepEqual(win, { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\L', SystemRoot: 'C:\\Windows', TMP: 'C:\\T', NO_COLOR: '1' })
})

test('findCodex uses the platform PATH delimiter and Windows PATHEXT', () => {
  const seen = []
  const exists = file => { seen.push(file); return file === 'C:\\npm\\codex.cmd' }
  assert.equal(findCodex({ PATH: 'C:\\Tools;C:\\npm', PATHEXT: '.EXE;.CMD;.JS' }, 'win32', exists), 'C:\\npm\\codex.cmd')
  assert.deepEqual(seen.filter(Boolean), ['C:\\Tools\\codex.exe', 'C:\\Tools\\codex.cmd', 'C:\\npm\\codex.exe', 'C:\\npm\\codex.cmd'])
  assert.equal(findCodex({ PATH: '/a:/b' }, 'linux', file => file === '/b/codex'), '/b/codex')
})

test('runCodex does not pass ambient secrets and honors the configured model', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-prompt-pro-cli-'))
  const saved = process.env.OPENAI_API_KEY
  try {
    const cli = join(dir, 'codex')
    writeFileSync(cli, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ key: process.env.OPENAI_API_KEY ?? null, model: process.argv[process.argv.indexOf(\'-m\') + 1] }))\n')
    chmodSync(cli, 0o700)
    process.env.OPENAI_API_KEY = 'private'
    const result = JSON.parse(await runCodex('draft', { cliPath: cli, model: 'custom-model' }))
    assert.deepEqual(result, { key: null, model: 'custom-model' })
    await assert.rejects(runCodex('draft', { cliPath: cli, model: 'bad model; rm' }), /Invalid model/)
  } finally {
    if (saved === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = saved
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the two-run limit also counts requests whose body is still uploading', async () => {
  let handler
  apply({
    effect(fn) { fn() },
    webServer: { register(route) { handler = route.handler; return () => {} } },
    connection: { requestRejection: () => undefined },
  }, { cliPath: '/nonexistent/codex' })
  const call = body => {
    const req = Object.assign(body, { method: 'POST', url: '/pg-prompt-pro/api/enhance' })
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false, destroyed: false,
      writeHead(status) { this.status = status },
      end(text) { this.writableEnded = true; this.body = JSON.parse(text) },
    })
    return { res, done: handler(req, res) }
  }
  const slow = [new PassThrough(), new PassThrough()]
  const pending = slow.map(call)
  await new Promise(resolve => setImmediate(resolve))
  const third = call(new PassThrough())
  await third.done
  assert.equal(third.res.status, 429)
  for (const body of slow) body.end('not json')
  await Promise.all(pending.map(p => p.done))
  assert.deepEqual(pending.map(p => p.res.status), [500, 500])
  // Finished requests release their slots.
  const body = new PassThrough()
  const after = call(body)
  body.end('not json')
  await after.done
  assert.equal(after.res.status, 500)
})

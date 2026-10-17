import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const pause = () => new Promise(resolve => setTimeout(resolve, 35))

async function mount() {
 const dom = new JSDOM('<div id="root"><div data-slot="sidebar"><div><div class="shell_regionArea"></div></div></div><header><div data-conversation-header-leading></div><div data-conversation-header-corner></div></header></div>', { url: 'https://harness.invalid', runScripts: 'outside-only', pretendToBeVisual: true })
 const { window } = dom
 const names = ['dsh-context', 'dsh-univer-office', 'dsh-sentinelx', 'billion-context', 'dsh-ego-browser', 'dshmarket']
 window.localStorage.setItem('dsh-plugin-rail:pinned:v1', JSON.stringify(names))
 let dispose
 const opened = []
 const ctx = {
  effect(fn) { dispose = fn() },
  layout: { toggleSidebar() {}, selectPanel(id) { opened.push(id) }, panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
  slots: { entriesOfSlot: () => [{ options: { id: 'context', label: '上下文洞察' } }] },
  remote: { pluginManager: { listBundles: async () => ({ ok: true, value: names.map(name => ({ name, installed: true, enabled: true, version: '1.0' })) }) }, $on: () => () => {} },
  get: name => name === 'pluginNavigation' ? { openBundle(id) { opened.push(id) } } : { startSession() {} },
 }
 window.__ModuleLoader__ = { load: ({ factory }) => factory().apply(ctx) }
 window.eval(client)
 await pause()
 return { window, document: window.document, opened, dispose: () => { dispose(); dom.window.close() } }
}

test('integrated navigation limits visible pins and retains searchable access to every installed entry', async () => {
 const app = await mount()
 try {
  const { document: d, window: w } = app
  const nav = d.querySelector('#dsh-plugin-rail')
  assert.equal(nav.parentElement.parentElement.dataset.slot, 'sidebar')
  const visible = [...nav.querySelectorAll('.rail-plugins button')].filter(b => !b.hidden)
  assert.equal(visible.length, 4)
  assert.ok(!visible.some(b => b.dataset.plugin === 'dsh-context'))
  d.querySelector('.pg-header-more').click()
  const menu = d.querySelector('#dsh-plugin-rail-menu')
  assert.equal(menu.hidden, false)
  const search = menu.querySelector('input')
  assert.equal(d.activeElement, search)
  search.value = 'univer'; search.dispatchEvent(new w.Event('input'))
  const matches = [...menu.querySelectorAll('.plugin-row')].filter(row => !row.hidden)
  assert.equal(matches.length, 1)
  matches[0].querySelector('.plugin-open').click()
  await pause()
  assert.deepEqual(app.opened, ['plugins', 'dsh-univer-office'])
  assert.equal(menu.hidden, true)
  d.querySelector('.pg-header-more').click()
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(menu.hidden, true)
  assert.equal(d.activeElement, d.querySelector('.pg-header-more'))
 } finally { app.dispose() }
})

test('pin changes persist and disabling the plugin removes its DOM and observers', async () => {
 const app = await mount()
 const d = app.document
 d.querySelector('.pg-header-more').click()
 const firstPin = d.querySelector('#dsh-plugin-rail-menu button[aria-pressed="true"]')
 firstPin.click()
 assert.equal(JSON.parse(app.window.localStorage.getItem('dsh-plugin-rail:pinned:v1')).length, 5)
 app.dispose()
 assert.equal(d.querySelector('#dsh-plugin-rail'), null)
 assert.equal(d.querySelector('#dsh-plugin-rail-menu'), null)
 assert.equal(d.querySelector('.pg-header-more'), null)
 assert.equal(d.querySelector('.pg-header-name'), null)
 assert.equal(d.querySelector('#dsh-plugin-rail-style'), null)
})

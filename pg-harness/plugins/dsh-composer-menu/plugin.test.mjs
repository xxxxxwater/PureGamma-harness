import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {JSDOM} from 'jsdom'
const requireUi=createRequire(new URL('../../../packages/client/ui-conversation/package.json',import.meta.url))
const React=requireUi('react')

test('composer plus menu owns its button, inserts reviewed context, and cleans up on unload', async()=>{
 const dom=new JSDOM('<!doctype html><html><head></head><body><div data-composer-card><button aria-haspopup="listbox" aria-label="Original plus">+</button><input type="file" hidden><div id="seat"></div></div></body></html>',{runScripts:'outside-only',url:'http://localhost'})
 const previous=new Map()
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})){
  previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})
 }
 const {createRoot}=requireUi('react-dom/client'), {Simulate}=requireUi('react-dom/test-utils')
 let component,face,draft='',fileCalls=0,unloaded=false
 const effects=[]
 const root=createRoot(dom.window.document.querySelector('#seat'))
 try{
  const ctx={locale:{register(_ns,dictionaries){face=dictionaries.zh;return()=>{}}},effect(fn){effects.push(fn())},slots:{inject(_key,fn){fn()},register(options,view){component=view;face={...face,...options.inject()}}},remote:{skills:{list:async()=>({ok:true,value:{skills:[{name:'review',description:'Review code'}]}})},pluginManager:{listBundles:async()=>({ok:true,value:[{name:'dsh-sentinelx',installed:true,version:'1.0'}]})}},layout:{selectPanel(){}},uiWorkspace:{startSession(){}},get(){return{openBundle(){}}}}
  dom.window.__ModuleLoader__={load(module){const plugin=module.factory(name=>name==='react'?React:requireUi(name));assert.ok(plugin.inject.includes('remote.skills'));assert.ok(plugin.inject.includes('remote.pluginManager'));plugin.apply(ctx)}}
  dom.window.eval(readFileSync(new URL('./client.js',import.meta.url),'utf8'))
  const actions={captureInsertion:()=>({revision:1}),insertText(text){draft+=text;return true}}
  await React.act(async()=>root.render(React.createElement(component,{sessionId:'test',t:key=>face[key],menuActions:face.menuActions,useInput:fn=>fn({draft}),useWorkspaces:fn=>fn({items:[]}),inputActions:actions})))
  const plus=dom.window.document.querySelector('button[aria-haspopup]')
  const click=async element=>React.act(async()=>element.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})))
  const item=id=>dom.window.document.querySelector(`[data-pg-menu-action="${id}"]`)
  const open=()=>click(plus)
  await open()
  assert.deepEqual([...dom.window.document.querySelectorAll('.pg-composer-menu-row')].map(x=>x.querySelector('.pg-composer-menu-label')?.childNodes[0].textContent),['添加文件或照片','添加到项目','从 GitHub 添加','Skills','添加连接器','设计系统','插件','网页搜索'])
  dom.window.document.querySelector('input[type=file]').click=()=>{fileCalls++}
  await click(item('files'));assert.equal(fileCalls,1);assert.equal(dom.window.document.querySelector('[role=menu]'),null)
  await open();await click(item('skills'));await click(item('review'));assert.equal(draft,'/review ')
  await open();await click(item('github'))
  await React.act(async()=>Simulate.change(dom.window.document.querySelector('input[aria-label="GitHub URL"]'),{target:{value:'https://github.com/owner/repo'}}))
  await React.act(async()=>Simulate.submit(dom.window.document.querySelector('.pg-composer-menu form')))
  assert.match(draft,/https:\/\/github.com\/owner\/repo/)
  await open();await click(item('design'));await click(item('ui'));assert.match(draft,/单色矢量图标/)
  await open();await click(item('search'));assert.match(draft,/网页搜索工具/)
  await open();await React.act(async()=>dom.window.document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true})));assert.equal(dom.window.document.querySelector('[role=menu]'),null)
  await React.act(async()=>root.unmount());unloaded=true
  assert.equal(plus.getAttribute('aria-label'),'Original plus')
 }finally{
  if(!unloaded)await React.act(async()=>root.unmount())
  for(const dispose of effects.reverse())if(typeof dispose==='function')dispose()
  dom.window.close()
  for(const[key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]
 }
})

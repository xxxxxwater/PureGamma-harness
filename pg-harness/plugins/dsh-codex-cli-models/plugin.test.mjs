import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CodexAppServer,cliCandidates,cliEnvironment,findCli,needsShell} from './app-server.mjs'
import {materializeModels} from './catalog.mjs'
import {CliTokenSource,readCliLogin,tokenExpiry} from './auth.mjs'
import {apply} from './index.js'
const jwt=expires=>'header.'+Buffer.from(JSON.stringify({exp:Math.floor(expires/1000)})).toString('base64url')+'.signature'
const persist=(home,token)=>writeFile(join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:token,refresh_token:'private-refresh'}}),{mode:0o600})

test('every visible CLI ChatGPT model is materialized, including new model ids',()=>{
 const codexModel={id:'gpt-5-codex',api:'openai-codex-responses',provider:'openai-codex',name:'GPT-5-Codex',contextWindow:196000,maxTokens:8192,input:['text','image'],reasoning:true}
 const rows=[
  {model:'gpt-5-codex',displayName:'GPT-5 Codex'},
  {model:'gpt-5.2',displayName:'GPT-5.2',contextWindow:256000,maxOutputTokens:16000},
  {model:'hidden-model',hidden:true},
 ]
 const models=materializeModels(rows,[codexModel],'codex-cli')
 assert.deepEqual(models.map(model=>model.id),['gpt-5-codex','gpt-5.2'])
 assert.equal(models[0].name,'GPT-5 Codex')
 assert.equal(models[1].name,'GPT-5.2')
 assert.equal(models[1].api,'openai-codex-responses')
 assert.equal(models[1].provider,'codex-cli')
 assert.equal(models[1].contextWindow,256000)
 assert.equal(models[1].maxTokens,16000)
 assert.deepEqual(models[1].input,['text','image'])
})

test('CLI child environment excludes Harness and ambient API credentials',()=>{
 const env=cliEnvironment({HOME:'/test',PATH:'/bin',OPENAI_API_KEY:'private',ANTHROPIC_API_KEY:'private',DSH_WEB_TOKEN:'private',PASSWORD:'private',HTTPS_PROXY:'http://proxy'},'/codex')
 assert.deepEqual(env,{HOME:'/test',PATH:'/bin',HTTPS_PROXY:'http://proxy',CODEX_HOME:'/codex'})
})
test('request token is reused without copying, ambient API key fallback, or renewal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pg-codex-auth-'))
 try{
  const token=jwt(Date.now()+3600000);await persist(home,token)
  const source=new CliTokenSource(home,{request(){throw Error('unexpected renewal')}})
  assert.equal(await source.access(),token)
  await writeFile(join(home,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'private'}))
  assert.equal(await readCliLogin(home),undefined)
  await assert.rejects(source.access(),/ChatGPT/)
 }finally{await rm(home,{recursive:true,force:true})}
})
test('concurrent expiry checks renew once through the CLI and then reread its file',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pg-codex-renew-'))
 try{
  await persist(home,jwt(Date.now()-1000));let calls=0;const token=jwt(Date.now()+3600000)
  const source=new CliTokenSource(home,{async request(method,params){calls++;assert.equal(method,'account/read');assert.equal(params.refreshToken,true);await persist(home,token)}})
  const results=await Promise.all([source.access(),source.access()])
  assert.deepEqual(results,[token,token]);assert.equal(calls,1)
  const controller=new AbortController();controller.abort(new Error('cancelled'))
  await assert.rejects(source.access(controller.signal),/cancelled/)
 }finally{await rm(home,{recursive:true,force:true})}
})
test('invalid login parsing does not expose the token contents in errors',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pg-codex-invalid-'))
 try{await writeFile(join(home,'auth.json'),'private-access-token malformed');await assert.rejects(readCliLogin(home),error=>!error.message.includes('private-access-token'))}finally{await rm(home,{recursive:true,force:true})}
})
test('app-server performs handshake, bounds requests, and closes pending operations on disposal',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pg-codex-rpc-'))
 const path=join(home,'codex')
 await writeFile(path,'#!/usr/bin/env node\n'+String.raw`
const readline=require('node:readline');let ready=false
readline.createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);if(x.method==='initialized'){ready=true;return}if(x.method==='initialize'){process.stdout.write(JSON.stringify({id:x.id,result:{ok:true}})+'\n');return}if(x.method==='hang'){if(x.params.notify)process.stdout.write(JSON.stringify({method:'fixture/received'})+'\n');return}process.stdout.write(JSON.stringify({id:x.id,result:{ready,method:x.method,privateEnv:!!process.env.OPENAI_API_KEY}})+'\n')})
`)
 await chmod(path,0o700)
 const server=new CodexAppServer(path,cliEnvironment({...process.env,HOME:home,OPENAI_API_KEY:'private'},home))
 try{
  assert.deepEqual(await server.request('status'),{ready:true,method:'status',privateEnv:false})
  await assert.rejects(server.request('hang',{},undefined,25),/超时/)
  const controller=new AbortController();const cancelled=server.request('hang',{},controller.signal)
  controller.abort(new Error('cancelled'));await assert.rejects(cancelled,/cancelled/)
  let received
  const accepted=new Promise(resolve=>{received=resolve})
  const unsubscribe=server.subscribe(message=>{if(message.method==='fixture/received')received()})
  const pending=server.request('hang',{notify:true}).catch(error=>error.message)
  await accepted;unsubscribe();await server.dispose()
  assert.match(await pending,/已关闭/);assert.equal(server.pending.size,0)
 }finally{await server.dispose();await rm(home,{recursive:true,force:true})}
})

const fixture=async(home,body)=>{const path=join(home,'codex');await writeFile(path,'#!/usr/bin/env node\n'+body);await chmod(path,0o700);return path}
const exited=child=>child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))
test('a CLI that closes stdin rejects the request instead of crashing the Host with EPIPE',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pg-codex-epipe-'))
 const path=await fixture(home,String.raw`
const readline=require('node:readline');const rl=readline.createInterface({input:process.stdin})
rl.on('line',line=>{const x=JSON.parse(line);if(x.method==='initialize'){process.stdout.write(JSON.stringify({id:x.id,result:{}})+'\n',()=>{rl.close();process.stdin.destroy();require('node:fs').closeSync(0)})}})
setInterval(()=>{},1000)
`)
 const server=new CodexAppServer(path,cliEnvironment({...process.env,HOME:home},home))
 let uncaught;const onUncaught=error=>{uncaught=error};process.on('uncaughtException',onUncaught)
 try{
  await server.start();const child=server.child
  await new Promise(resolve=>setTimeout(resolve,100))
  await assert.rejects(server.requestRaw('large',{blob:'x'.repeat(4*1024*1024)},undefined,5000),/不可用|已退出|超时/)
  await exited(child)
  assert.equal(uncaught,undefined);assert.equal(server.child,undefined)
 }finally{process.off('uncaughtException',onUncaught);await server.dispose();await rm(home,{recursive:true,force:true})}
})
test('a timed-out handshake kills its CLI, and that late exit cannot detach the next child',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pg-codex-boot-'))
 const marker=join(home,'started')
 const path=await fixture(home,String.raw`
const fs=require('node:fs');const first=!fs.existsSync(${JSON.stringify(marker)});fs.writeFileSync(${JSON.stringify(marker)},'1')
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);if(first||x.method==='initialized')return;process.stdout.write(JSON.stringify({id:x.id,result:{method:x.method}})+'\n')})
process.on('SIGTERM',()=>{});setInterval(()=>{},1000)
`)
 const server=new CodexAppServer(path,cliEnvironment({...process.env,HOME:home},home))
 server.initTimeout=200
 try{
  const starting=server.start();const stalled=server.child
  await assert.rejects(starting,/超时/)
  await exited(stalled)
  assert.notEqual(stalled.signalCode??stalled.exitCode,null)
  server.initTimeout=5000
  assert.deepEqual(await server.request('status'),{method:'status'})
  assert.notEqual(server.child,stalled);assert.equal(server.child.exitCode,null)
 }finally{await server.dispose();await rm(home,{recursive:true,force:true})}
})

test('Windows CLI discovery uses ; and PATHEXT, and keeps Windows runtime variables',async()=>{
 const env=cliEnvironment({Path:'C:\\Tools;C:\\npm',PATHEXT:'.COM;.EXE;.BAT;.CMD;.VBS;.JS',USERPROFILE:'C:\\Users\\me',APPDATA:'C:\\AppData',SystemRoot:'C:\\Windows',ComSpec:'cmd.exe',TEMP:'C:\\Temp',OPENAI_API_KEY:'private'},undefined,'win32')
 assert.equal(env.PATH,'C:\\Tools;C:\\npm')
 assert.equal(env.USERPROFILE,'C:\\Users\\me');assert.equal(env.SystemRoot,'C:\\Windows');assert.equal(env.ComSpec,'cmd.exe');assert.equal(env.TEMP,'C:\\Temp')
 assert.equal(env.OPENAI_API_KEY,undefined)
 assert.deepEqual(cliCandidates(env,'win32'),['C:\\Tools\\codex.com','C:\\Tools\\codex.exe','C:\\Tools\\codex.bat','C:\\Tools\\codex.cmd','C:\\npm\\codex.com','C:\\npm\\codex.exe','C:\\npm\\codex.bat','C:\\npm\\codex.cmd'])
 assert.deepEqual(cliCandidates({PATH:'C:\\a'},'win32').map(x=>x.slice(5)),['codex.com','codex.exe','codex.bat','codex.cmd'])
 assert.deepEqual(cliCandidates({PATH:'/a:/b'},'linux'),['/a/codex','/b/codex'])
 assert.equal(needsShell('C:\\npm\\codex.cmd','win32'),true)
 assert.equal(needsShell('C:\\npm\\codex.exe','win32'),false)
 assert.equal(needsShell('/bin/codex.cmd','linux'),false)
})
test('POSIX CLI discovery finds codex on PATH',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pg-codex-path-'))
 try{
  await writeFile(join(dir,'codex'),'#!/bin/sh\n');await chmod(join(dir,'codex'),0o700)
  assert.equal(await findCli(undefined,{PATH:'/nonexistent:'+dir},'linux'),join(dir,'codex'))
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('tokens without exp are treated as unknown expiry, not permanently expired',async()=>{
 const noExp='header.'+Buffer.from(JSON.stringify({sub:'x'})).toString('base64url')+'.signature'
 assert.equal(tokenExpiry(noExp),null)
 assert.equal(tokenExpiry('opaque-token'),null)
 const home=await mkdtemp(join(tmpdir(),'pg-codex-noexp-'))
 try{
  await persist(home,noExp)
  const source=new CliTokenSource(home,{request(){throw Error('unexpected renewal')}})
  assert.equal(await source.access(),noExp)
 }finally{await rm(home,{recursive:true,force:true})}
})
test('cancelling a login the CLI no longer knows still clears the pending login',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pg-codex-login-'))
 const path=join(home,'codex')
 await writeFile(path,'#!/usr/bin/env node\n'+String.raw`
let logins=0
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);if(x.id===undefined)return
 const reply=body=>process.stdout.write(JSON.stringify({id:x.id,...body})+'\n')
 if(x.method==='account/login/start')return reply({result:{loginId:'login-'+(++logins),authUrl:'https://auth.openai.com/oauth?n='+logins}})
 if(x.method==='account/login/cancel')return reply({error:{code:-32600,message:'unknown loginId'}})
 if(x.method==='account/read')return reply({result:{account:null}})
 if(x.method==='model/list')return reply({result:{data:[]}})
 reply({result:{}})})
`)
 await chmod(path,0o700)
 let handler;const cleanups=[]
 const ctx={
  effect(fn){const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup)},
  root:{loader:{import:async name=>({
   '@deepseek-ai/dsh-llm-pi-ai':{PiAiAdapter:class{}},
   '@deepseek-ai/dsh-llm':{LlmAdapter:class{},resolveRetryPolicy:()=>({})},
   '@earendil-works/pi-ai/providers/openai-codex':{openaiCodexProvider:()=>({getModels:()=>[]})},
  })[name]}},
  llm:{registerAdapter:()=>()=>{}},
  webServer:{register(route){handler=route.handler;return()=>{}}},
  connection:{requestRejection:()=>undefined},
 }
 const call=(method,url)=>new Promise(resolve=>{
  const res={writeHead(status){this.status=status},end(text){resolve({status:this.status,body:JSON.parse(text)})}}
  handler({method,url},res)
 })
 try{
  await apply(ctx,{cliPath:path,cliHome:home})
  const first=await call('POST','/codex-cli/api/login')
  assert.equal(first.body.loginId,'login-1')
  assert.deepEqual(await call('POST','/codex-cli/api/cancel-login'),{status:200,body:{ok:true}})
  assert.equal((await call('GET','/codex-cli/api/status')).body.loginPending,false)
  assert.equal((await call('POST','/codex-cli/api/login')).body.loginId,'login-2')
 }finally{for(const cleanup of cleanups.reverse())await cleanup();await rm(home,{recursive:true,force:true})}
})

import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CodexAppServer,cliEnvironment} from './app-server.mjs'
import {CliTokenSource,readCliLogin} from './auth.mjs'
const jwt=expires=>'header.'+Buffer.from(JSON.stringify({exp:Math.floor(expires/1000)})).toString('base64url')+'.signature'
const persist=(home,token)=>writeFile(join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:token,refresh_token:'private-refresh'}}),{mode:0o600})

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

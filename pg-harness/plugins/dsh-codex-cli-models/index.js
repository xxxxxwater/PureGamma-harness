import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
import {CodexAppServer,cliEnvironment,findCli} from './app-server.mjs'
import {materializeModels} from './catalog.mjs'
import {CliTokenSource} from './auth.mjs'

export const name='codex-cli-models'
export const inject=['llm','loader','webServer','connection']
export const PROVIDER='codex-cli'
const LABEL='Codex CLI · ChatGPT'

/** Use the host's one adapter/runtime generation rather than vendoring another Harness. */
export async function apply(ctx,config={}) {
  const home=resolve(config.cliHome ?? process.env.CODEX_HOME ?? join(homedir(),'.codex'))
  const environment=cliEnvironment(process.env,home)
  const cliPath=await findCli(config.cliPath,environment)
  const server=new CodexAppServer(cliPath,environment)
  const lifetime=new AbortController()
  let pendingLogin,loginError,catalogPromise,catalogTime=0,snapshot
  ctx.effect(()=>()=>{lifetime.abort(new Error('Codex 插件已关闭'));return server.dispose()},'codex-cli: app-server lifecycle')
  const tokenSource=new CliTokenSource(home,server)
  const [pi,llm,codex]=await Promise.all([
    ctx.root.loader.import('@deepseek-ai/dsh-llm-pi-ai',()=>[]),
    ctx.root.loader.import('@deepseek-ai/dsh-llm',()=>[]),
    ctx.root.loader.import('@earendil-works/pi-ai/providers/openai-codex',()=>[]),
  ])
  const builtin=codex.openaiCodexProvider()
  const emptyStore={read:async()=>undefined,list:async()=>[],modify:async()=>{throw new Error('Codex CLI owns its login')},delete:async()=>{throw new Error('Codex CLI owns its login')}}
  const auth={credentials:emptyStore,authContext:{env:async()=>undefined,fileExists:async()=>false}}

  const loadCatalog=async(force=false)=>{
    if(snapshot && !force && Date.now()-catalogTime<60000)return snapshot
    if(catalogPromise)return catalogPromise
    catalogPromise=(async()=>{
      const rows=[];let cursor
      do {
        const result=await server.request('model/list',{limit:100,includeHidden:false,...cursor?{cursor}:{}},lifetime.signal)
        if(!Array.isArray(result.data))throw new Error('Codex 返回了无效的模型列表')
        rows.push(...result.data.filter(row=>!row.hidden));cursor=result.nextCursor
      }while(cursor)
      const metadata=new Map(rows.map(row=>[row.model,row]))
      const models=materializeModels(rows,builtin.getModels(),PROVIDER)
      if(!models.length)throw new Error('Codex CLI 未返回可用的 ChatGPT 模型。')
      const provider={...builtin,id:PROVIDER,name:LABEL,
        // The CLI refreshes its login; pi-ai receives one request token and never rotates it independently.
        auth:{apiKey:{name:LABEL,resolve:async({credential})=>({auth:credential?.key?{apiKey:credential.key}:{},source:LABEL})}},
        getModels:()=>models,
      }
      const profile={provider:PROVIDER,displayName:LABEL,piProvider:provider,
        configuredMaxTokens:new Map(),modelErrors:new Map(),
        streamIdleTimeoutMs:300000,maxRequestImageBytes:20*1024*1024,
        requestImagePixelBudget:2048*2048,requestImageMaxBytes:1024*1024,
        transport:'sse',retryPolicy:llm.resolveRetryPolicy({mode:'normal',maxRetries:1},PROVIDER),
      }
      snapshot={profiles:new Map([[PROVIDER,profile]]),metadata};catalogTime=Date.now()
      return snapshot
    })().finally(()=>{catalogPromise=undefined})
    return catalogPromise
  }
  const engine=(state,resolveApiKey)=>new pi.PiAiAdapter({profiles:()=>state.profiles,resolveApiKey,auth,
    resolveAttachments:()=>ctx.get('attachments'),
    resolveImageAccess:(attachments,ref)=>llm.resolveImageAttachmentAccess(attachments,hostPath=>ctx.get('fs')?.processPathFromHostPath(hostPath),ref),
  })
  class Adapter extends llm.LlmAdapter {
    providerInfo(){return{id:PROVIDER,name:LABEL}}
    providerRetryPolicy(){return llm.resolveRetryPolicy({mode:'normal',maxRetries:1},PROVIDER)}
    async listModels(){const state=await loadCatalog();return engine(state,async()=>undefined).listModels(PROVIDER)}
    async resolveModel(_provider,model,signal){
      if(signal?.aborted)throw signal.reason
      const state=await loadCatalog();const info=await engine(state,async()=>undefined).resolveModel(PROVIDER,model,signal)
      // Only expose effort levels supported by both the CLI catalog and the wire adapter.
      const cli=state.metadata.get(model)
      if(info.reasoning && cli){const allowed=new Set(cli.supportedReasoningEfforts?.map(x=>x.reasoningEffort));info.reasoning={...info.reasoning,efforts:info.reasoning.efforts.filter(x=>allowed.has(x.id)),defaultEffort:cli.defaultReasoningEffort}}
      return info
    }
    async prepareCall(_provider,model,signal){
      const state=await loadCatalog();const metadata=await this.resolveModel(PROVIDER,model,signal)
      const access=await tokenSource.access(signal??lifetime.signal)
      const bound=await engine(state,async()=>access).prepareCall(PROVIDER,model,signal)
      return{model:metadata,stream:bound.stream}
    }
    async *stream(options){const call=await this.prepareCall(PROVIDER,options.model,options.signal);yield*call.stream(options)}
  }
  ctx.effect(()=>ctx.llm.registerAdapter([PROVIDER],new Adapter()),'codex-cli: model route')
  ctx.effect(()=>server.subscribe(message=>{
    if(message.method==='account/login/completed' && message.params?.loginId===pendingLogin?.loginId){
      loginError=message.params.success?undefined:(message.params.error??'登录未完成')
      pendingLogin=undefined;catalogTime=0
    }
  }),'codex-cli: login notifications')

  const status=async()=>{
    const account=await server.request('account/read',{refreshToken:false},lifetime.signal)
    let models=[],catalogError
    try{const state=await loadCatalog();models=[...state.metadata.values()].map(row=>({id:row.model,name:row.displayName??row.model,default:row.isDefault}))}catch(error){catalogError=error.message}
    return{loggedIn:account.account?.type==='chatgpt',accountType:account.account?.type,
      email:account.account?.email,plan:account.account?.planType,
      models,loginPending:!!pendingLogin,loginError,catalogError,provider:PROVIDER}
  }
  const send=(res,code,value)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value))}
  ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/codex-cli/api',handler:async(req,res)=>{
    const rejection=ctx.connection.requestRejection(req)
    if(rejection!==undefined){send(res,rejection,{error:'unauthorized'});return}
    const path=new URL(req.url??'/','http://local').pathname
    try{
      if(path==='/codex-cli/api/status'&&req.method==='GET'){send(res,200,await status());return}
      if(path==='/codex-cli/api/refresh'&&req.method==='POST'){await loadCatalog(true);send(res,200,await status());return}
      if(path==='/codex-cli/api/login'&&req.method==='POST'){
        if(pendingLogin){send(res,200,pendingLogin);return}
        loginError=undefined
        const result=await server.request('account/login/start',{type:'chatgpt'},lifetime.signal)
        const url=new URL(result.authUrl)
        if(url.protocol!=='https:'||url.hostname!=='auth.openai.com')throw new Error('Codex 返回了无法识别的登录链接')
        pendingLogin={loginId:result.loginId,authUrl:url.href};send(res,200,pendingLogin);return
      }
      if(path==='/codex-cli/api/cancel-login'&&req.method==='POST'){
        if(pendingLogin)await server.request('account/login/cancel',{loginId:pendingLogin.loginId},lifetime.signal)
        pendingLogin=undefined;send(res,200,{ok:true});return
      }
      send(res,req.method==='GET'||req.method==='POST'?404:405,{error:'not found'})
    }catch(error){send(res,500,{error:error.message})}
  }}),'codex-cli: authenticated account routes')
}

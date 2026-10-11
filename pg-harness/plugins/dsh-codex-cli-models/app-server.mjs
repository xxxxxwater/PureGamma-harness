import {spawn} from 'node:child_process'
import {access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {join, isAbsolute} from 'node:path'
import {homedir} from 'node:os'

/** Give the official CLI only its runtime and transport environment. */
export function cliEnvironment(environment = process.env, home = environment.CODEX_HOME) {
  const allowed = new Set(['HOME','USER','LOGNAME','SHELL','PATH','TMPDIR','LANG','LC_ALL','LC_CTYPE','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])
  const env = Object.fromEntries(Object.entries(environment).filter(([key,value]) => allowed.has(key) && typeof value === 'string'))
  env.HOME ??= homedir()
  env.PATH ??= '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  if (home) env.CODEX_HOME = home
  return env
}

/** Discover an installed official Codex CLI without a shell or package installation. */
export async function findCli(explicit, env = cliEnvironment()) {
  const candidates = explicit ? [explicit] : [...(env.PATH ?? '').split(':').map(p=>join(p,'codex')), '/usr/local/bin/codex','/opt/homebrew/bin/codex']
  for (const path of new Set(candidates)) {
    if (!isAbsolute(path)) continue
    try { await access(path, constants.X_OK); return path } catch {}
  }
  throw new Error('未找到 Codex CLI。请先安装 Codex CLI，或在插件配置中设置 cliPath。')
}

/** Own one official app-server process and its bounded, cancellable JSON-RPC requests. */
export class CodexAppServer {
  constructor(path, env) { this.path=path; this.env=env; this.pending=new Map(); this.listeners=new Set(); this.next=0; this.closed=false; this.starting=undefined; this.child=undefined }
  async start() {
    if (this.closed) throw new Error('Codex 插件已关闭')
    if (this.starting) return this.starting
    this.starting = this.boot().catch(error=>{this.starting=undefined;throw error})
    return this.starting
  }
  async boot() {
    const child=spawn(this.path,['app-server','--listen','stdio://'],{cwd:this.env.HOME,env:this.env,stdio:['pipe','pipe','pipe'],windowsHide:true})
    this.child=child
    let buffer=''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data',chunk=>{
      buffer+=chunk
      if (buffer.length>4*1024*1024) { this.fail(new Error('Codex 协议消息过大')); child.kill(); return }
      for (;;) {
        const at=buffer.indexOf('\n');if(at<0)break
        const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.trim())continue
        let message;try{message=JSON.parse(line)}catch{this.fail(new Error('Codex 返回了无效的协议消息'));child.kill();return}
        if (message.id!==undefined && (message.result!==undefined || message.error!==undefined)) {
          const request=this.pending.get(message.id)
          if(request)message.error ? request.reject(new Error(message.error.message ?? 'Codex 请求失败')) : request.resolve(message.result)
        } else if(message.method && message.id===undefined) {
          for(const listener of this.listeners) { try {listener(message)}catch{} }
        } else if(message.id!==undefined) {
          this.write({id:message.id,error:{code:-32601,message:'Inference tools are owned by PureGamma Harness, not this account/catalog connection.'}})
        }
      }
    })
    // CLI diagnostic output may contain account material. Drain it without logging.
    child.stderr.resume()
    child.on('error',()=>this.fail(new Error('Codex CLI 无法启动')))
    child.on('exit',()=>{this.fail(new Error('Codex CLI 已退出'));this.starting=undefined;this.child=undefined})
    await this.requestRaw('initialize',{clientInfo:{name:'puregamma_harness',title:'PureGamma Harness',version:'0.1.0'},capabilities:{experimentalApi:true}},undefined,30000)
    this.write({method:'initialized',params:{}})
  }
  write(message) { if(!this.child || this.child.stdin.destroyed) throw new Error('Codex 连接不可用');this.child.stdin.write(JSON.stringify(message)+'\n') }
  async request(method,params={},signal,timeout=30000) { await this.start(); return this.requestRaw(method,params,signal,timeout) }
  requestRaw(method,params,signal,timeout) {
    if(signal?.aborted)return Promise.reject(signal.reason ?? new Error('操作已取消'))
    return new Promise((resolve,reject)=>{
      const id=++this.next
      const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);this.pending.delete(id);fn(value)}
      const aborted=()=>finish(reject,signal.reason ?? new Error('操作已取消'))
      const timer=setTimeout(()=>finish(reject,new Error('Codex 请求超时')),timeout)
      this.pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)})
      signal?.addEventListener('abort',aborted,{once:true})
      try{this.write({id,method,params})}catch(error){finish(reject,error)}
    })
  }
  subscribe(listener) {this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  fail(error) {for(const request of [...this.pending.values()])request.reject(error)}
  async dispose() {
    this.closed=true;this.listeners.clear();this.fail(new Error('Codex 插件已关闭'))
    const child=this.child;if(!child)return
    await new Promise(resolve=>{
      let done=false
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(deadline);resolve()}
      child.once('exit',finish)
      const timer=setTimeout(()=>child.kill('SIGKILL'),2000)
      const deadline=setTimeout(finish,4000)
      if(child.exitCode!==null || child.signalCode!==null)finish()
      else {child.stdin.end();child.kill('SIGTERM')}
    })
  }
}

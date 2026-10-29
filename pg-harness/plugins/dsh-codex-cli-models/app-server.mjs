import {spawn} from 'node:child_process'
import {access} from 'node:fs/promises'
import {constants} from 'node:fs'
import {posix, win32} from 'node:path'
import {homedir} from 'node:os'

const WINDOWS_ENV = ['USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','SystemDrive','PATHEXT','ComSpec','TEMP','TMP','windir','ProgramFiles','ProgramData','HOMEDRIVE','HOMEPATH']
const SPAWNABLE_EXTENSIONS = ['.com','.exe','.bat','.cmd']

/** Give the official CLI only its runtime and transport environment. */
export function cliEnvironment(environment = process.env, home = environment.CODEX_HOME, platform = process.platform) {
  const names = ['HOME','USER','LOGNAME','SHELL','PATH','TMPDIR','LANG','LC_ALL','LC_CTYPE','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy']
  if (platform === 'win32') names.push(...WINDOWS_ENV)
  // Windows variable names are case-insensitive (PATH is often spelled Path).
  const canonical = new Map(names.map(name => [platform === 'win32' ? name.toUpperCase() : name, name]))
  const env = {}
  for (const [key,value] of Object.entries(environment)) {
    const name = canonical.get(platform === 'win32' ? key.toUpperCase() : key)
    if (name && typeof value === 'string') env[name] ??= value
  }
  env.HOME ??= homedir()
  if (platform !== 'win32') env.PATH ??= '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  if (home) env.CODEX_HOME = home
  return env
}

/** Candidate codex executables on PATH, honoring the platform delimiter and Windows PATHEXT. */
export function cliCandidates(env, platform = process.platform) {
  const path = platform === 'win32' ? win32 : posix
  const names = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.trim().toLowerCase())
      .filter(ext => SPAWNABLE_EXTENSIONS.includes(ext)).map(ext => 'codex' + ext)
    : ['codex']
  return (env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap(dir => names.map(name => path.join(dir, name)))
}

/** Windows .cmd/.bat shims can only be started through the shell. */
export function needsShell(file, platform = process.platform) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(file)
}

/** Discover an installed official Codex CLI without a shell or package installation. */
export async function findCli(explicit, env = cliEnvironment(), platform = process.platform) {
  const path = platform === 'win32' ? win32 : posix
  const fallbacks = platform === 'win32' ? [] : ['/usr/local/bin/codex','/opt/homebrew/bin/codex']
  const candidates = explicit ? [explicit] : [...cliCandidates(env, platform), ...fallbacks]
  for (const file of new Set(candidates)) {
    if (!path.isAbsolute(file)) continue
    try { await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK); return file } catch {}
  }
  throw new Error('未找到 Codex CLI。请先安装 Codex CLI，或在插件配置中设置 cliPath。')
}

/** Own one official app-server process and its bounded, cancellable JSON-RPC requests. */
export class CodexAppServer {
  constructor(path, env) { this.path=path; this.env=env; this.pending=new Map(); this.listeners=new Set(); this.next=0; this.closed=false; this.starting=undefined; this.child=undefined; this.initTimeout=30000 }
  async start() {
    if (this.closed) throw new Error('Codex 插件已关闭')
    if (this.starting) return this.starting
    this.starting = this.boot().catch(error=>{this.starting=undefined;throw error})
    return this.starting
  }
  async boot() {
    // Fixed arguments only; the quoted path is the sole shell input for .cmd shims.
    const shell=needsShell(this.path)
    const child=spawn(shell?'"'+this.path+'"':this.path,['app-server','--listen','stdio://'],{cwd:this.env.HOME,env:this.env,stdio:['pipe','pipe','pipe'],windowsHide:true,shell})
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
    // An unhandled EPIPE on stdin (CLI closed its input) would crash the Host process;
    // stop the unusable child so its exit lets the next request start a new one.
    child.stdin.on('error',()=>{if(this.child!==child)return;this.fail(new Error('Codex 连接不可用'));child.kill()})
    // Events from a replaced child must not reject or detach its successor.
    child.on('error',()=>{if(this.child===child)this.fail(new Error('Codex CLI 无法启动'))})
    child.on('exit',()=>{if(this.child!==child)return;this.fail(new Error('Codex CLI 已退出'));this.starting=undefined;this.child=undefined})
    try {
      await this.requestRaw('initialize',{clientInfo:{name:'puregamma_harness',title:'PureGamma Harness',version:'0.1.0'},capabilities:{experimentalApi:true}},undefined,this.initTimeout)
      this.write({method:'initialized',params:{}})
    } catch (error) {
      // A failed handshake leaves no orphan behind for the next start() to race with.
      if(this.child===child)this.child=undefined
      child.kill('SIGKILL')
      throw error
    }
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

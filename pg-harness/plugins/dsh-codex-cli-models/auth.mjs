import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Decode expiry only; never expose the token or JWT claims to the UI. */
export function tokenExpiry(token) {
  try { const exp=JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp;return Number.isFinite(exp)?exp*1000:0 } catch { return 0 }
}

/** Read the CLI's existing login. This plugin never writes or copies its token file. */
export async function readCliLogin(home) {
  let auth
  try { auth=JSON.parse(await readFile(join(home,'auth.json'),'utf8')) } catch(error) {
    if(error.code==='ENOENT')return undefined
    throw new Error('无法读取 Codex CLI 登录，请使用浏览器重新登录。')
  }
  const access=auth.tokens?.access_token
  if(auth.auth_mode==='apikey' || typeof access!=='string' || !access)return undefined
  return {access,expires:tokenExpiry(access)}
}

/** Serialize renewal through the official CLI and return only the request credential. */
export class CliTokenSource {
  constructor(home,server) {this.home=home;this.server=server;this.operations=Promise.resolve()}
  access(signal) {
    const task=this.operations.catch(()=>{}).then(async()=>{
      if(signal?.aborted)throw signal.reason
      let login=await readCliLogin(this.home)
      if(!login)throw new Error('请在设置 → Codex CLI 中使用 ChatGPT 登录。')
      if(login.expires < Date.now()+120000) {
        await this.server.request('account/read',{refreshToken:true},signal)
        login=await readCliLogin(this.home)
        if(!login || login.expires<Date.now()+30000)throw new Error('Codex 登录已过期，请在设置 → Codex CLI 中重新登录。')
      }
      if(signal?.aborted)throw signal.reason
      return login.access
    })
    this.operations=task.then(()=>{},()=>{})
    return task
  }
}

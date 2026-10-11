window.__ModuleLoader__.load({id:'dsh-codex-cli-models',factory:require=>{
  const React=require('react'),h=React.createElement
  async function api(path,method='GET',signal){const response=await fetch('/codex-cli/api/'+path,{method,signal});const value=await response.json();if(!response.ok)throw new Error(value.error??'请求失败');return value}
  function Settings(){
    const [status,setStatus]=React.useState(),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[login,setLogin]=React.useState()
    React.useEffect(()=>{
      const controller=new AbortController();let timer
      const update=async()=>{try{const next=await api('status','GET',controller.signal);if(!controller.signal.aborted){setStatus(next);setError('');if(!next.loginPending)setLogin(undefined)}}catch(e){if(!controller.signal.aborted)setError(e.message)}finally{if(!controller.signal.aborted)timer=setTimeout(update,3000)}}
      void update();return()=>{controller.abort();clearTimeout(timer)}
    },[])
    const action=async(kind)=>{setBusy(true);setError('');try{
      const result=await api(kind,'POST')
      if(kind==='login'){setLogin(result);window.open(result.authUrl,'_blank','noopener,noreferrer')}
      else if(kind==='cancel-login')setLogin(undefined)
      else setStatus(result)
    }catch(e){setError(e.message)}finally{setBusy(false)}}
    const button={padding:'9px 14px',borderRadius:8,border:'1px solid var(--dsw-alias-border-base,#555)',background:'var(--dsw-alias-bg-layer-2,#242429)',color:'inherit',cursor:'pointer'}
    return h('section',{'data-pg-codex-settings':true,style:{maxWidth:720,padding:'24px',display:'grid',gap:16}},
      h('h2',{style:{margin:0}},'Codex CLI'),
      h('p',{style:{margin:0}},'使用 ChatGPT 登录，在会话的模型菜单中选择 Codex CLI · ChatGPT。登录与本机 Codex CLI 共用。'),
      h('div',{role:'status'},status?.loggedIn?`已登录${status.email?' · '+status.email:''}${status.plan?' · '+status.plan:''}`:'尚未登录 ChatGPT'),
      h('div',{style:{display:'flex',gap:10,flexWrap:'wrap'}},
        h('button',{style:button,disabled:busy,onClick:()=>action('login')},status?.loggedIn?'切换 / 重新登录':'使用 ChatGPT 登录'),
        h('button',{style:button,disabled:busy,onClick:()=>action('refresh')},'刷新模型列表')),
      login?h('div',null,h('a',{href:login.authUrl,target:'_blank',rel:'noopener noreferrer'},'在浏览器中继续登录'),h('button',{style:{...button,marginLeft:16},disabled:busy,onClick:()=>action('cancel-login')},'取消此次登录')):null,
      error||status?.loginError||status?.catalogError?h('p',{role:'alert',style:{color:'var(--dsw-alias-state-error-primary,#e98080)'}},error||status.loginError||status.catalogError):null,
      status?.models?.length?h('div',null,h('p',null,'可选择的 Codex 模型'),h('ul',null,...status.models.map(model=>h('li',{key:model.id},model.name+(model.default?'（CLI 默认）':''))))):null,
      h('p',{style:{opacity:.7,fontSize:13}},'这里消耗当前 ChatGPT 账号的 Codex / Work 工作额度，与 Codex CLI 和 ChatGPT Work 共享。它不使用普通聊天消息额度或 API 余额。模型列表由 Codex CLI 返回。'))
  }
  return{inject:['slots'],apply(ctx){ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'codex-cli-models',order:105,label:()=> 'Codex CLI'},Settings))}}
}})

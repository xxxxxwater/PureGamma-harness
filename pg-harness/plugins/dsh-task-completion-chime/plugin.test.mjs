import {readFileSync,accessSync,constants} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {runInNewContext} from 'node:vm'
import {test} from 'node:test'
import assert from 'node:assert/strict'

function fixture(){
  const plays=[],effects=[],warnings=[]
  let listener
  const source=readFileSync(new URL('./index.js',import.meta.url),'utf8')
    .replace(/^import .+\n/gm,'').replaceAll('export ','')
    .replaceAll('import.meta.url',JSON.stringify(new URL('./index.js',import.meta.url).href))
  const plugin=runInNewContext(source+'; ({apply,createChimePlayer})',{
    URL,fileURLToPath,accessSync,constants,process:{platform:'darwin'},
    execFile(path,args,options,callback){
      const play={path,args,options,killed:false,done:false,
        finish(error){if(this.done)return;this.done=true;callback(error)}}
      const child={kill(){play.killed=true;queueMicrotask(()=>play.finish())}}
      plays.push(play);return child
    },
  })
  const ctx={effect(fn){effects.push(fn())},on(name,fn,options){assert.equal(name,'session/event');assert.equal(options.global,true);listener=fn},logger:{info(){},warn(...args){warnings.push(args)}}}
  plugin.apply(ctx)
  return{plays,warnings,emit:(session,event)=>listener(session,event),dispose:()=>effects[0](),plugin}
}
const session=()=>({id:'fixture',header:{origin:'user'},firstLiveSeq:10})
const end=(turn=1,seq=10,kind='completed')=>({type:'turn/end',seq,data:{turn,reason:{kind}}})

test('only new successful top-level turns play one native sound each',async()=>{
  const f=fixture(),s=session()
  try{
    f.emit(s,end(1,9));f.emit(s,end(1,10,'error'));f.emit(s,end(1,10,'aborted'))
    f.emit({...s,header:{origin:'subagent'}},end())
    f.emit({...s,header:{origin:'user',delegationDepth:1}},end())
    f.emit(s,{type:'tool/end'})
    assert.equal(f.plays.length,0)
    f.emit(s,end());f.emit(s,end());f.emit(s,end(2,11))
    assert.equal(f.plays.length,2)
    assert.equal(f.plays[0].path,'/usr/bin/afplay')
    assert.deepEqual([...f.plays[0].args.slice(0,2)],['-v','0.7'])
    assert.ok(f.plays[0].args[2].endsWith('/ding-dong.wav'))
  }finally{await f.dispose()}
})
test('unload kills pending sound processes, waits for completion and silences late events',async()=>{
  const f=fixture(),s=session()
  f.emit(s,end());await f.dispose()
  assert.equal(f.plays[0].killed,true)
  assert.equal(f.plays[0].done,true)
  f.emit(s,end(2,11));assert.equal(f.plays.length,1)
  assert.equal(f.warnings.length,0)
})
test('a failed playback is contained and the next turn can still notify',async()=>{
  const f=fixture(),s=session()
  try{
    f.emit(s,end());f.plays[0].finish(new Error('audio unavailable'))
    await Promise.resolve();await Promise.resolve()
    assert.equal(f.warnings.length,1)
    f.emit(s,end(2,11));assert.equal(f.plays.length,2)
  }finally{await f.dispose()}
})

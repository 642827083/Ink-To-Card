const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function harness(options={}) {
  let time=0,serial=0,busy=false;const timers=new Map(),notes=new Map(),writes=[],errors=[],reads=[];
  for(const id of ['A','B'])notes.set(id,{available:true,noteId:id,topicId:'topic',source:{index:1,hash:'drawing:'+id},settings:{auto:true,mapping:{red:7}}});
  const context=vm.createContext({setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../web/src/lib/inkFollow.js'),'utf8'),context);
  const follow=context.InkToCardFollow.create({now:()=>time,
    later:(fn,delay)=>{const id=++serial;timers.set(id,{fn,due:time+delay});return id;},cancel:id=>timers.delete(id),
    read:async id=>{reads.push(id);return JSON.parse(JSON.stringify(notes.get(id)));},
    busy:()=>busy,onError:error=>errors.push(error.message),
    handle:async(snapshot,valid)=>{await options.wait?.();if(valid())writes.push({id:snapshot.noteId,hash:snapshot.source.hash,time});return true;}
  });
  follow.setEnabled(true);
  async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
  async function advance(ms){const target=time+ms;for(let n=0;n<1000;n++){
    const first=[...timers].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];
    if(!first)break;time=first[1].due;timers.delete(first[0]);first[1].fn();await flush();
    if(n===999)throw new Error('计时器未收敛');
  }time=target;await flush();}
  return {follow,notes,writes,errors,reads,timers,advance,flush,setBusy:value=>{busy=value;}};
}

test('两张卡交替收到事件时各自稳定300毫秒后处理，不依赖当前选择',async()=>{
  const h=harness();h.follow.enqueue('A');h.follow.enqueue('B');
  await h.advance(299);assert.equal(h.writes.length,0);
  await h.advance(1);assert.deepEqual(h.writes.map(w=>[w.id,w.time]),[['A',300],['B',300]]);
});

test('重复事件不重复改色，1.5秒窗口内未推送的最后保存由追加检查捕获',async()=>{
  const h=harness();h.follow.enqueue('A');await h.advance(100);h.follow.enqueue('A');
  await h.advance(200);assert.equal(h.writes.length,1);
  await h.advance(700);h.notes.get('A').source.hash='drawing:A-new';
  await h.advance(1199);assert.equal(h.writes.length,1);
  await h.advance(1);assert.equal(h.writes.length,2);assert.equal(h.writes[1].hash,'drawing:A-new');
  await h.advance(8000);assert.equal(h.writes.length,2);assert.equal(h.timers.size,0);
});

test('识别期间持续变化时重新等待稳定，忙碌时保留任务而不丢失',async()=>{
  const h=harness();h.follow.enqueue('A');await h.advance(200);
  h.notes.get('A').source.hash='drawing:A-new';h.follow.enqueue('A');await h.advance(299);
  assert.equal(h.writes.length,0);h.setBusy(true);await h.advance(101);assert.equal(h.writes.length,0);
  h.setBusy(false);await h.advance(100);assert.equal(h.writes.length,1);assert.equal(h.writes[0].hash,'drawing:A-new');
});

test('撤销或后台使在途图像分析失效，相同笔迹不自动重新覆盖',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),h=harness({wait:()=>gate});
  h.follow.enqueue('A');await h.advance(300);h.follow.invalidate();release();await h.flush();
  assert.equal(h.writes.length,0);h.follow.enqueue('A');await h.advance(2500);assert.equal(h.writes.length,0);
  h.notes.get('A').source.hash='drawing:A-new';h.follow.enqueue('A');await h.advance(300);assert.equal(h.writes.length,1);
  h.follow.stop();assert.equal(h.timers.size,0);
});

test('关闭自动识别及没有手写来源时不改色，队列有上限',async()=>{
  const h=harness();h.notes.get('A').settings.auto=false;h.notes.get('B').source=null;
  h.follow.enqueue('A');h.follow.enqueue('B');await h.advance(3000);assert.equal(h.writes.length,0);
  h.follow.setEnabled(false);h.follow.enqueue('A');assert.equal(h.timers.size,0);
  h.follow.setEnabled(true);for(let i=0;i<129;i++)h.follow.enqueue('card-'+i);assert.equal(h.errors.length,1);h.follow.stop();
});

test('批量处理等忙碌超过8秒时仍保留未处理的事件，空闲后继续',async()=>{
  const h=harness();h.setBusy(true);h.follow.enqueue('A');await h.advance(10000);
  assert.equal(h.writes.length,0);h.setBusy(false);await h.advance(100);
  assert.equal(h.writes.length,1);assert.equal(h.writes[0].id,'A');h.follow.stop();
});

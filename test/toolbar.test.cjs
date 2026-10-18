const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function setup(){
  let now=100000,methods,singleClicks=0,refreshes=0;
  const timers=[],storage=new Map(),messages=[],evaluated=[];
  const notebook={notebookId:'A'},addon={window:{},inkClassicTracking:true,inkNotebookOpen:true,inkSceneEpoch:1,
    inkPanel:{ready:true,view:{hidden:true},webView:{stopLoading(){},delegate:{} }}};
  addon.inkPanel.view.removeFromSuperview=()=>{};
  const study={notebookController:notebook,refreshAddonCommands(){refreshes++;}};
  const context=vm.createContext({console,self:addon,Date:class extends Date {static now(){return now;}},
    Application:{sharedInstance:()=>({studyController:()=>study,showHUD:text=>messages.push(text)})},
    NSUserDefaults:{standardUserDefaults:()=>({objectForKey:key=>storage.get(key),setObjectForKey:(value,key)=>storage.set(key,value)})},
    JSB:{defineClass:(name,instance)=>{methods=instance;return {}; }},
    NSTimer:{scheduledTimerWithTimeInterval(seconds,repeats,callback){assert.equal(repeats,false);const timer={due:now+seconds*1000,callback,active:true,invalidate(){this.active=false;}};timers.push(timer);return timer;}},
    __INK_TO_CARD_PANEL__:{attach:()=>true,toggle(){singleClicks++;addon.inkPanel.view.hidden=!addon.inkPanel.view.hidden;},evaluate:(panel,script)=>evaluated.push(script)}
  });
  for(const name of ['InkToCardConfig','InkToCardCore','InkToCardNative','InkToCardToolbar','InkToCardAddon'])
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),context);
  context.createInkToCardAddon('/addon');
  const native=context.__INK_TO_CARD_NATIVE__;
  storage.set('cn.marginnote.ink-to-card.settings.A',JSON.stringify({auto:false,policy:'red',minPixels:51,mapping:{red:7,uncolored:1}}));
  function advance(ms,fire=true){now+=ms;if(fire)for(const timer of timers)if(timer.active&&timer.due<=now){timer.active=false;timer.callback();}}
  return {context,native,methods,addon,notebook,timers,storage,messages,evaluated,advance,
    click:()=>methods.handleInkToCardToolbar(),get singles(){return singleClicks;},get refreshes(){return refreshes;}};
}

test('工具栏单击等待300毫秒后开合面板，不切换自动跟随',()=>{
  const env=setup();assert.equal(env.methods.queryAddonCommandStatus().selector,'handleInkToCardToolbar:');
  env.click();assert.equal(env.singles,0);env.advance(299);assert.equal(env.singles,0);
  env.advance(1);assert.equal(env.singles,1);assert.equal(env.addon.inkPanel.view.hidden,false);
  assert.equal(env.native.followEnabled(env.addon),false);
  env.click();env.advance(300);assert.equal(env.addon.inkPanel.view.hidden,true);assert.equal(env.singles,2);
});

test('工具栏双击取消单击，自动跟随持久保存并同步图标及面板开关',()=>{
  const env=setup();env.click();const cancelledTimer=env.timers[0];env.advance(120);env.click();
  assert.equal(env.singles,0);assert.equal(env.native.followEnabled(env.addon),true);
  assert.equal(env.methods.queryAddonCommandStatus().checked,true);assert.equal(env.refreshes,1);
  assert.match(env.evaluated[0],/InkToCardApp\.refresh/);assert.equal(env.messages.at(-1),'自动跟随已开启');
  assert.equal(cancelledTimer.active,false);cancelledTimer.callback();env.advance(500);assert.equal(env.singles,0,'已排队的旧回调也不会弹面板');
  const settings=env.native.settings('A');assert.equal(settings.mapping.red,7);assert.equal(settings.mapping.uncolored,1);assert.equal(settings.policy,'red');assert.equal(settings.minPixels,51);
  env.addon.inkPanel.view.hidden=false;env.click();env.advance(100);env.click();
  assert.equal(env.native.followEnabled(env.addon),false);assert.equal(env.addon.inkPanel.view.hidden,true);assert.equal(env.singles,0);
  assert.equal(env.messages.at(-1),'自动跟随已关闭');
});

test('两次点击超过双击窗口各执行单击，积压计时器也不误判双击',()=>{
  const env=setup();env.click();env.advance(301,false);env.click();
  assert.equal(env.singles,1);assert.equal(env.native.followEnabled(env.addon),false);
  env.advance(300);assert.equal(env.singles,2);
});

test('切换学习集、进入后台和断开窗口会取消待执行的单击',()=>{
  for(const method of ['notebookWillClose','notebookWillOpen','sceneWillResignActive','sceneDidDisconnect']){
    const env=setup();env.click();const timer=env.timers[0];env.methods[method]();
    timer.callback();env.advance(500);assert.equal(env.singles,0,method);assert.equal(timer.active,false);
  }
});

test('双击跨学习集不会串改开关，新学习集独立保存设置',()=>{
  const env=setup();env.click();env.advance(100);env.notebook.notebookId='B';env.click();env.advance(100);env.click();
  assert.equal(env.native.settings('A').auto,false);assert.equal(env.native.settings('B').auto,true);assert.equal(env.singles,0);
  assert.throws(()=>env.native.toggleFollow(env.addon,'1:A'),/学习窗口或学习集/);
});

test('无学习集或在后台双击不会写设置，缺少计时器时保留单击入口',()=>{
  for(const unavailable of ['closed','background','no-topic']){
    const env=setup(),stored=env.storage.get('cn.marginnote.ink-to-card.settings.A');
    if(unavailable==='closed')env.addon.inkNotebookOpen=false;
    if(unavailable==='background')env.addon.inkInactive=true;
    if(unavailable==='no-topic')env.notebook.notebookId='';
    env.click();env.advance(100);env.click();env.advance(500);
    assert.equal(env.storage.get('cn.marginnote.ink-to-card.settings.A'),stored);
    assert.equal(env.messages.at(-1),'请先打开一个学习集');
  }
  const fallback=setup();fallback.context.NSTimer=undefined;fallback.click();assert.equal(fallback.singles,1);
});

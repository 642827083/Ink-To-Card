const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pack,unpack}=require('../scripts/zip.cjs');
test('ZIP 编解码保留目录与二进制内容',()=>{
  const entries=[{name:'mnaddon.json',data:Buffer.from('{}')},{name:'web/中文.html',data:Buffer.from('你好')},{name:'icon.png',data:Buffer.from([0,20,255])}];
  assert.deepEqual(unpack(pack(entries)),entries);
});
test('生命周期使用官方 NSTimer 导出方法，退出窗口后释放定时器与 WebView',()=>{
  let methods,timerBlock,invalidated=false,stopped=false,removed=false,ticks=0;
  const panel={ready:true,webView:{stopLoading:()=>{stopped=true;},delegate:{}},view:{removeFromSuperview:()=>{removed=true;}}};
  const addon={window:{}};
  const context=vm.createContext({console,self:addon,
    JSB:{defineClass:(name,instance)=>{methods=instance;return {}; }},
    NSTimer:{scheduledTimerWithTimeInterval:(interval,repeats,block)=>{assert.equal(interval,0.3);assert.equal(repeats,true);timerBlock=block;return {invalidate:()=>{invalidated=true;}};}},
    __INK_TO_CARD_PANEL__:{create:()=>panel,attach:()=>true,evaluate:()=>{ticks++;}},
    __INK_TO_CARD_NATIVE__:{syncToolbar(){}},Application:{sharedInstance:()=>({studyController:()=>({})})}
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/InkToCardToolbar.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/InkToCardAddon.js'),'utf8'),context);
  context.createInkToCardAddon('/addon');methods.sceneWillConnect();methods.notebookWillOpen();timerBlock();
  assert.equal(addon.inkClassicTracking,true);assert.equal(ticks,1);
  panel.view.hidden=true;timerBlock();assert.equal(ticks,2,'收起面板继续检查');
  addon.inkTargetId='card';const epoch=addon.inkSceneEpoch;
  methods.sceneWillResignActive();timerBlock();assert.equal(ticks,2);assert.ok(addon.inkSceneEpoch>epoch);
  methods.sceneDidBecomeActive();timerBlock();assert.equal(ticks,3);assert.equal(addon.inkTargetId,'card');
  methods.notebookWillClose();timerBlock();assert.equal(ticks,3);assert.equal(addon.inkTargetId,null);
  methods.notebookWillOpen();assert.equal(addon.inkTargetId,null);
  methods.sceneDidDisconnect();assert.ok(invalidated&&stopped&&removed);assert.equal(panel.webView.delegate,null);
});

test('MN5 融合面板按官方 mn.call 分发命令，关闭及后台使会话失效',()=>{
  let methods,callback,closed=0,posted=[];
  const addon={window:{}},panel={loadPanel:()=>true,showFloatingIn(){},hideFloating(){closed++;},teardown(){},post:(event,data)=>posted.push([event,data])};
  const context=vm.createContext({self:addon,JSB:{defineClass:(name,instance)=>{methods=instance;return {};}},
    AddonWebPanel:{panel:()=>panel},Application:{sharedInstance:()=>({studyController:()=>({notebookController:{notebookId:'topic'}})})},
    __INK_TO_CARD_COMMANDS__:{readCurrent:()=>({available:true})}
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/InkToCardSceneAddon.js'),'utf8'),context);
  context.createInkToCardSceneAddon();methods.sceneWillConnect();methods.toggleInkToCard();callback=panel.onMessage;
  assert.equal(callback('readCurrent',{}).available,true);assert.throws(()=>callback('constructor',{}),/不支持/);
  const epoch=addon.inkSceneEpoch;methods.sceneWillResignActive();assert.ok(addon.inkSceneEpoch>epoch);assert.equal(posted.at(-1)[1].active,false);
  methods.sceneDidBecomeActive();assert.equal(posted.at(-1)[1].active,true);
  methods.sceneDidDisconnect();assert.equal(closed,1);assert.equal(panel.onMessage,null);assert.throws(()=>callback('readCurrent',{}),/面板已关闭/);
});

test('测试包保留 MN4 经典入口和面板、乔木Joe作者，排除场景插件依赖',()=>{
  const entries=unpack(fs.readFileSync(path.resolve(__dirname,'../Ink To Card Test.mnaddon')));
  const manifest=JSON.parse(entries.find(e=>e.name==='mnaddon.json').data);
  assert.equal(manifest.author,'乔木Joe');assert.equal(manifest.marginnote_version_min,'4.2.3');
  assert.equal(manifest.panel,undefined);assert.equal(manifest.events,undefined);assert.equal(manifest.immersiveOnly,undefined);
  assert.ok(entries.find(e=>e.name==='InkToCardPanel.js'));
  assert.ok(!entries.find(e=>e.name==='web/src/lib/inkFollow.js'||e.name==='InkToCardSceneAddon.js'));
  assert.match(entries.find(e=>e.name==='web/index.html').data.toString(),/connect-src 'none'/);
  const main=entries.find(e=>e.name==='main.js').data.toString();
  assert.match(main,/return createInkToCardAddon\(mainPath\)/);assert.ok(main.includes('JSB.require("InkToCardPanel")'));
});

test('经典工具栏按当前学习集自动跟随开关常亮，面板开合不改变图标状态',()=>{
  const storage=new Map(),notebook={notebookId:'A',mindmapView:{selViewLst:[]}};
  const addon={window:{},inkClassicTracking:true,inkNotebookOpen:true,inkSceneEpoch:1,inkPanel:{view:{hidden:false}}};
  let methods,refreshes=0;
  const study={notebookController:notebook,refreshAddonCommands(){refreshes++;}};
  const context=vm.createContext({self:addon,console,
    JSB:{defineClass:(name,instance)=>{methods=instance;return {}; }},
    NSUserDefaults:{standardUserDefaults:()=>({objectForKey:key=>storage.get(key),setObjectForKey:(value,key)=>storage.set(key,value)})},
    Application:{sharedInstance:()=>({studyController:()=>study})},__INK_TO_CARD_PANEL__:{attach:()=>true}
  });
  for(const name of ['InkToCardConfig','InkToCardCore','InkToCardNative','InkToCardToolbar','InkToCardAddon'])
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),context);
  context.createInkToCardAddon('/addon');
  const native=context.__INK_TO_CARD_NATIVE__;
  function save(auto){native.saveSettings(addon,{topicId:notebook.notebookId,scopeToken:native.scopeToken(addon),settings:{auto}});}
  assert.equal(methods.queryAddonCommandStatus().checked,false,'面板打开但自动关闭时不高亮');
  assert.equal(refreshes,0,'状态查询没有刷新工具栏的副作用');
  save(true);assert.equal(refreshes,1,'保存开关后立即刷新图标');
  addon.inkPanel.view.hidden=true;assert.equal(methods.queryAddonCommandStatus().checked,true,'收起面板仍高亮');
  native.snapshot(addon);native.snapshot(addon);assert.equal(refreshes,1,'轮询相同状态不反复刷新图标');
  save(false);assert.equal(methods.queryAddonCommandStatus().checked,false);assert.equal(refreshes,2);
  storage.set('cn.marginnote.ink-to-card.settings.B',JSON.stringify({auto:true}));notebook.notebookId='B';
  native.snapshot(addon);assert.equal(methods.queryAddonCommandStatus().checked,true);assert.equal(refreshes,3);
  methods.notebookWillClose();assert.equal(methods.queryAddonCommandStatus().checked,false);
  methods.notebookWillOpen();assert.equal(methods.queryAddonCommandStatus().checked,true,'重新打开学习集恢复已保存的开关');
  assert.equal(methods.queryAddonCommandStatus().image,'icon.png');
});

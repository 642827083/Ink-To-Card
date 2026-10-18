const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {unpack} = require('../scripts/zip.cjs');

function packagedPage(options = {}) {
  const entries = unpack(fs.readFileSync(path.resolve(__dirname, '../Ink To Card Test.mnaddon')));
  const html = entries.find(entry => entry.name === 'web/index.html').data.toString();
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  const denied = [], errors = [], created = [], listeners = [], windowListeners = [], timers = new Map();
  let timerId = 0, clock = 100000;
  function node(tagName) {
    const item = {tagName: tagName.toUpperCase(), children: [], style: {}, textContent: '', handlers: new Map(),
      appendChild(child) {
        this.children.push(child);
        if (child.tagName === 'IFRAME') options.onBridge?.(child.src, context);
      },
      append(...children) {children.forEach(child => this.appendChild(child));},
      replaceChildren() {this.children = [];this._value = undefined;},
      addEventListener(event, handler) {this.handlers.set(event, handler);},
      setAttribute(key, value) {this[key] = value;}, removeAttribute(key) {delete this[key];},
      focus() {sandbox.document.activeElement = this;}, remove() {this.removed = true;}
    };
    Object.defineProperties(item, {
      options: {get: () => item.children.filter(child => child.tagName === 'OPTION')},
      value: {get: () => item._value ?? item.children[0]?.value ?? '', set: value => {item._value = String(value);}}
    });
    created.push(item);return item;
  }
  // 仅实现启动、读取卡片和报错所需 DOM，不模拟图像识别。
  const elements = new Map([...html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)].map(match => {
    const item = node(match[1]);item.id = match[2];return [item.id, item];
  }));
  const sandbox = {console,
    setTimeout(callback, delay) {const id = ++timerId;timers.set(id, {callback, delay, due: clock + delay});return id;},
    clearTimeout(id) {timers.delete(id);},
    setInterval(callback, delay) {const id = ++timerId;timers.set(id, {callback, delay, due: clock + delay, interval: true});return id;},
    clearInterval(id) {timers.delete(id);},
    addEventListener(event, handler) {windowListeners.push({event, handler});},
    document: {readyState: 'loading', visibilityState: 'visible', body: node('body'), createElement(tag) {
      const item = node(tag);
      if (tag === 'canvas' && options.rgba) item.getContext = () => ({drawImage() {}, getImageData: () => ({data: options.rgba})});
      return item;
    },
      createTextNode: text => ({textContent: text}),
      getElementById: id => elements.get(id) || created.find(item => item.id === id),
    querySelectorAll: selector => selector.startsWith('.mapping-row')
      ? created.filter(item => item.className === 'mapping-row').flatMap(row => row.children.filter(child => ['BUTTON', 'SELECT'].includes(child.tagName)))
      : created.filter(item => ['BUTTON', 'SELECT', 'INPUT'].includes(item.tagName)),
      addEventListener(event, handler) {listeners.push({event, handler});}}
  };
  if (options.mn) sandbox.mn = options.mn;
  if (options.Image) sandbox.Image = options.Image;
  if (options.virtualClock) sandbox.Date = class extends Date {static now() {return clock;}};
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  function emit(event, data) {windowListeners.filter(item => item.event === event).forEach(item => item.handler(data));}
  for (const source of scripts) {
    const name = path.posix.normalize('web/' + source);
    // 模拟本地 WebView 将 HTML 所在目录作为可读范围。
    if (!name.startsWith('web/')) {denied.push(name);continue;}
    const entry = entries.find(item => item.name === name);
    if (!entry || name === options.missing) {
      errors.push('文件缺失：' + name);emit('error', {target: {tagName: 'SCRIPT', src: name}});continue;
    }
    try {vm.runInContext(entry.data.toString(), context, {filename: name});}
    catch (error) {errors.push(error.message);emit('error', {message: error.message});}
  }
  return {entries, context, denied, errors, elements, timers, emit,
    keydown(key) {listeners.filter(item => item.event === 'keydown').forEach(item => item.handler({key, preventDefault() {}}));},
    async start() {
      context.document.readyState = 'interactive';
      listeners.filter(item => item.event === 'DOMContentLoaded').forEach(item => item.handler());
      for (let i = 0; i < 100; i++) await Promise.resolve();
    },
    async fire(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay) {timers.delete(id);timer.callback();}
      }
      for (let i = 0; i < 100; i++) await Promise.resolve();
    },
    async advance(ms) {
      for (let i = 0; i < 100; i++) await Promise.resolve();
      const end = clock + ms;
      for (let count = 0; count < 1000; count++) {
        const first = [...timers].filter(([,timer]) => timer.due <= end).sort((a,b) => a[1].due-b[1].due)[0];
        if (!first) break;
        clock = first[1].due;
        if (first[1].interval) first[1].due += first[1].delay; else timers.delete(first[0]);
        first[1].callback();for (let i = 0; i < 100; i++) await Promise.resolve();
        if (count === 999) throw new Error('计时器未收敛');
      }
      clock = end;for (let i = 0; i < 100; i++) await Promise.resolve();
    }
  };
}

test('安装包在限定入口目录加载时，通过 iframe 与原生委托完成卡片读取', async () => {
  let methods, calls = 0, currentColor = 7, savedSettings;
  const controller = {addon: {}, webView: {evaluateJavaScript(script, callback) {
    vm.runInContext(script, page.context);callback();
  }}};
  const native = vm.createContext({console, self: controller,
    JSB: {defineClass(name, instance) {methods = instance;return {}; }},
    __INK_TO_CARD_NATIVE__: {value: (object, key) => object[key]},
    __INK_TO_CARD_COMMANDS__: {readCurrent() {
      calls++;
      return {available: true, noteId: 'note-1', title: '手写卡片', colorIndex: currentColor,
        sources: [{index: 0, hash: 'drawing:archive', kind: 'drawing'}], source: {index: 0, hash: 'drawing:archive', kind: 'drawing'},
        settings: page.context.__INK_TO_CARD_CONFIG__.normalize(savedSettings || {mapping: {red: 7}})};
    }, saveSettings(addon, payload) {
      savedSettings = payload.settings;return savedSettings;
    }, inspectSources(addon, payload) {
      assert.equal(payload.noteId, 'note-1');
      const info = {commentCount: 0, paintCommentCount: 0, strokes: {supported: true, value: 18}, drawingBytes: {supported: false}};
      return {noteId: 'note-1', summary: '检测到绘图笔画', focus: info, database: info};
    }, exportDrawingSample(addon, payload) {
      assert.equal(payload.noteId, 'note-1');assert.equal(payload.index, 0);assert.equal(payload.hash, 'drawing:archive');
      return {filename: 'Ink-To-Card-drawing-sample.json', bytes: 20919, saveRequested: true};
    }}
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/InkToCardPanel.js'), 'utf8'), native);
  const page = packagedPage({onBridge(address) {
    assert.equal(methods.webViewShouldStartLoadWithRequestNavigationType({}, {URL: {absoluteString: address}}), false);
  }});
  assert.deepEqual(page.errors, [], '页面脚本错误；拒绝资源：' + page.denied.join(', '));
  assert.deepEqual(page.denied, []);
  assert.ok(!page.entries.some(entry => entry.name.endsWith('/demo.js')));
  for (const name of ['InkToCardConfig.js', 'InkToCardCore.js']) {
    assert.ok(page.entries.find(entry => entry.name === 'web/' + name).data.equals(
      fs.readFileSync(path.resolve(__dirname, '../src/' + name))));
  }
  await page.start();
  assert.equal(calls, 1);
  assert.equal(page.elements.get('note-title').textContent, '手写卡片');
  assert.equal(page.elements.get('note-color').textContent, '当前色号 8');
  const red = page.context.document.getElementById('map-red');
  assert.equal(red.value, '7', '已有映射仍使用原来的内部索引');
  assert.deepEqual(red.options.map(option => option.textContent), ['不触发', ...Array.from({length: 16}, (_, i) => '色号 ' + (i + 1))]);
  assert.equal(red.options.find(option => String(option.value) === red.value).textContent, '色号 8');
  red.value = '15';await red.handlers.get('change')();
  assert.equal(savedSettings.mapping.red, 15, '选择色号16时仍保存内部索引15');
  assert.equal(red.options.find(option => String(option.value) === red.value).textContent, '色号 16');
  currentColor = 0;
  await page.elements.get('mapping').children[0].children.at(-1).handlers.get('click')();
  assert.equal(savedSettings.mapping.red, 0, '取当前卡色不额外偏移索引');
  assert.equal(page.elements.get('note-color').textContent, '当前色号 1');
  assert.equal(red.options.find(option => String(option.value) === red.value).textContent, '色号 1');
  red.value = '-1';await red.handlers.get('change')();
  assert.equal(savedSettings.mapping.red, -1, '不触发设置保持不变');
  const uncolored=page.context.document.getElementById('map-uncolored');
  assert.equal(uncolored.value,'-1','无彩色书写默认关闭');
  assert.equal(page.elements.get('mapping').children.at(-1).children[1],uncolored,'位于映射列表末尾');
  uncolored.value='15';await uncolored.handlers.get('change')();
  assert.equal(savedSettings.mapping.uncolored,15);assert.equal(savedSettings.mapping.red,-1,'不修改已有彩色映射');
  await page.elements.get('mapping').children.at(-1).children.at(-1).handlers.get('click')();
  assert.equal(savedSettings.mapping.uncolored,0,'无彩色书写也可取当前卡色');
  uncolored.value='-1';await uncolored.handlers.get('change')();assert.equal(savedSettings.mapping.uncolored,-1);
  assert.equal(page.elements.get('source').textContent, '最后一条手写绘图 · 批注 1');
  assert.equal(page.elements.get('export-sample').disabled, false);
  await page.context.InkToCardApp.exportDrawingSample();
  assert.match(page.elements.get('status').textContent, /已请求打开保存窗口.*Ink-To-Card-drawing-sample.json/);
  assert.equal(page.elements.get('export-sample').disabled, false);
  await page.context.InkToCardApp.inspectSources();
  assert.equal(page.elements.get('source-diagnostic').hidden, false);
  assert.match(page.elements.get('source-summary').textContent, /笔画 18/);
  assert.match(page.elements.get('source-summary').textContent, /绘图字节 接口不可用/);
  assert.equal(page.timers.size, 0);
});

test('原生桥接无响应时，20 秒后结束读取状态并允许重试', async () => {
  const page = packagedPage();
  await page.start();
  await page.fire(20000);
  assert.equal(page.elements.get('note-title').textContent, '读取失败，点击刷新');
  assert.match(page.elements.get('status').textContent, /MN 未响应/);
  assert.equal(page.timers.size, 0);
  assert.equal(page.elements.get('refresh').disabled, undefined);
  const retry = page.context.InkToCardApp.refresh();
  const frame = page.context.document.body.children.at(-1);
  const message = JSON.parse(decodeURIComponent(frame.src.split('payload=')[1]));
  page.context.InkToCardReceive({requestId: message.requestId, payload: {available: false, reason: '请在脑图中选中一张卡片，再点击刷新'}});
  await retry;
  assert.equal(page.elements.get('note-title').textContent, '请在脑图中选中一张卡片，再点击刷新');
});

test('业务脚本加载失败时显示文件名，并阻止未初始化的操作', async () => {
  const page = packagedPage({missing: 'web/src/app.js'});
  await page.start();
  assert.equal(page.elements.get('note-title').textContent, '插件启动失败');
  assert.match(page.elements.get('status').textContent, /脚本无法加载：app.js/);
  assert.equal(page.elements.get('preview').disabled, true);
  assert.equal(page.timers.size, 0);
});

test('未捕获的页面初始化异常显示原因', async () => {
  const page = packagedPage();
  page.emit('error', {message: '初始化异常'});
  await page.start();
  assert.equal(page.elements.get('note-title').textContent, '插件启动失败');
  assert.match(page.elements.get('status').textContent, /初始化异常/);
  await page.context.InkToCardApp.tick();
  assert.equal(page.context.document.body.children.length, 0);
});

test('经典安装包彩色与无彩色书写：取消选中仍跟踪，稳定后自动及手动改色', async () => {
 for(const uncolored of [false,true]){
  const storage=new Map(),calls=[],mediaReads=[];
  const note={noteId:'A',notebookId:'topic',noteTitle:'跟踪卡片A',colorIndex:0,comments:[{type:'PaintNote',drawing:'ink-A'}]},
    other={noteId:'B',notebookId:'topic',noteTitle:'卡片B',colorIndex:0,comments:[{type:'PaintNote',drawing:'ink-B'}]};
  const notebook={notebookId:'topic',focusNote:note,mindmapView:{selViewLst:[{note}]}},addon={window:{},inkClassicTracking:true,inkSceneEpoch:1,inkNotebookOpen:true};
  const raw=uncolored?require('./helpers/handwriting.cjs').handwriting([{pathMarker:1}]):fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build62-path9-94-strokes.wrd'));
  const native=vm.createContext({
    NSUserDefaults:{standardUserDefaults:()=>({objectForKey:key=>storage.get(key),setObjectForKey:(value,key)=>storage.set(key,value)})},
    Database:{sharedInstance:()=>({getNoteById:id=>id==='A'?note:id==='B'?other:null,getMediaByHash:hash=>{mediaReads.push(hash);return {length:raw.length,base64Encoding:()=>raw.toString('base64')};}})},
    Application:{sharedInstance:()=>({studyController:()=>({notebookController:notebook}),refreshAfterDBChanged(){}})},
    UndoManager:{sharedInstance:()=>({undoGrouping:(title,topic,fn)=>fn()})}
  });
  for(const file of ['InkToCardConfig','InkToCardCore','InkToCardDrawing','InkToCardNative','InkToCardBatch','WebBridgeCommands'])
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+file+'.js'),'utf8'),native);
  storage.set('cn.marginnote.ink-to-card.settings.topic',JSON.stringify({auto:true,policy:'red',mapping:uncolored?{uncolored:7}:{red:7}}));
  const rgba=new Uint8ClampedArray(100*100*4);for(let i=0;i<100;i++)rgba.set(uncolored?[0,0,0,255]:[255,0,0,255],i*4);
  const page=packagedPage({virtualClock:true,rgba,
    Image:class {naturalWidth=100;naturalHeight=100;set src(value){queueMicrotask(()=>this.onload());}},
    onBridge(address,context){
      const request=JSON.parse(decodeURIComponent(address.split('payload=')[1]));calls.push(request.command);
      try {context.InkToCardReceive({requestId:request.requestId,payload:native.__INK_TO_CARD_COMMANDS__[request.command](addon,request.payload)});}
      catch(error){context.InkToCardReceive({requestId:request.requestId,error:error.message});}
    }
  });
  await page.start();assert.deepEqual(page.errors,[]);
  notebook.focusNote=null;notebook.mindmapView.selViewLst=[];
  await page.context.InkToCardApp.tick();await page.context.InkToCardApp.tick();
  assert.equal(page.elements.get('tracking-status').textContent,'等待笔迹稳定');
  assert.equal(note.colorIndex,0);assert.deepEqual(mediaReads,[],'连续积压检查不会直接解析图片');
  await page.advance(299);await page.context.InkToCardApp.tick();assert.equal(note.colorIndex,0);
  note.comments[0].drawing='ink-A-saved';await page.context.InkToCardApp.tick();
  await page.advance(299);await page.context.InkToCardApp.tick();assert.equal(note.colorIndex,0,'媒体变化重新等待稳定');
  await page.advance(1);await page.context.InkToCardApp.tick();
  assert.equal(note.colorIndex,7);assert.equal(other.colorIndex,0);
  assert.deepEqual(mediaReads,['ink-A-saved','ink-A-saved']);assert.match(page.elements.get('status').textContent,/卡片色号 8/);
  assert.match(page.elements.get('status').textContent,uncolored?/无彩色书写 → 已设置卡片色号 8/:/红色笔迹 → 已设置卡片色号 8/);
  assert.equal(page.elements.get('status').className,'success');
  assert.equal(page.elements.get('tracking-status').textContent,'跟踪中');
  assert.equal(page.elements.get('note-title').textContent,'跟踪卡片A');
  note.colorIndex=0;await page.context.InkToCardApp.tick();assert.equal(note.colorIndex,0,'撤销后不会反复覆盖');
  assert.doesNotMatch(page.elements.get('status').textContent,/已设置卡片色号/,'撤销后不再显示过期的成功结果');
  if(uncolored){await page.elements.get('recognize').handlers.get('click')();assert.equal(note.colorIndex,7,'手动无彩色识别也通过完整桥接');note.colorIndex=0;}
  notebook.mindmapView.selViewLst=[{note:other}];await page.context.InkToCardApp.tick();
  notebook.mindmapView.selViewLst=[];await page.advance(300);await page.context.InkToCardApp.tick();
  assert.equal(other.colorIndex,7);assert.equal(note.colorIndex,0);
  assert.equal(page.elements.get('note-title').textContent,'卡片B');
  assert.equal(calls.filter(command=>command==='applyResult').length,uncolored?3:2);
  assert.equal(page.timers.size,0);
 }
});

test('经典安装包即使宿主提供 mn 对象，仍使用经典 iframe 桥接',async()=>{
  let calls=0;
  const page=packagedPage({mn:{on(){throw Error('不应使用场景事件');},call(){throw Error('不应使用场景桥接');}},onBridge(address,context){
    calls++;const request=JSON.parse(decodeURIComponent(address.split('payload=')[1]));
    context.InkToCardReceive({requestId:request.requestId,payload:{available:false,reason:'请先选一张卡片'}});
  }});
  await page.start();assert.deepEqual(page.errors,[]);assert.equal(calls,1);
  assert.equal(page.elements.get('note-title').textContent,'请先选一张卡片');
});


function previewPage(options={}){
  const raw=options.unverified?require('./helpers/handwriting.cjs').handwriting([{pathMarker:2}]):fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build62-path9-black-red.wrd'));
  const decoder=vm.createContext({});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/InkToCardDrawing.js'),'utf8'),decoder);
  const media=decoder.__INK_TO_CARD_DRAWING__.preview(raw.toString('base64'),raw.length),calls=[],images=[];
  let currentId='A',currentHash='drawing:marked';
  const page=packagedPage({virtualClock:true,Image:class {set src(value){images.push(this);if(!options.deferImages)queueMicrotask(()=>options.imageError?this.onerror():this.onload());}},
    onBridge(address,context){
      const request=JSON.parse(decodeURIComponent(address.split('payload=')[1]));calls.push(request.command);
      const snapshot={available:true,noteId:currentId,title:'试验卡'+currentId,colorIndex:0,topicId:'topic',settings:context.__INK_TO_CARD_CONFIG__.normalize({}),
        source:{index:0,hash:currentHash,kind:'drawing'},sources:[{index:0,hash:currentHash,kind:'drawing'}]};
      if(request.command==='readPreview'&&options.bridgeError){context.InkToCardReceive({requestId:request.requestId,error:'媒体尚未下载'});return;}
      context.InkToCardReceive({requestId:request.requestId,payload:request.command==='readCurrent'?snapshot:media});
    }
  });
  return {...page,calls,images,setCurrent:id=>{currentId=id;},setDrawing:hash=>{currentHash=hash;}};
}

test('预览再次点击可收起，重开复用图片，绘图变化后重新生成',async()=>{
  const page=previewPage();await page.start();
  const click=page.elements.get('preview').handlers.get('click');
  await click();assert.equal(page.elements.get('preview-wrap').hidden,false);
  await click();assert.equal(page.elements.get('preview-wrap').hidden,true,'再次点击应收起图片');
  assert.equal(page.elements.get('preview').textContent,'预览');
  assert.equal(page.elements.get('preview')['aria-expanded'],'false');
  await click();assert.equal(page.elements.get('preview-wrap').hidden,false);
  assert.equal(page.elements.get('preview').textContent,'收起');
  assert.equal(page.elements.get('preview')['aria-expanded'],'true');
  assert.equal(page.calls.filter(x=>x==='readPreview').length,1,'同一绘图重开不重复读取媒体');
  assert.equal(page.images.length,1,'同一绘图重开不重新加载图片');
  await click();page.setDrawing('drawing:changed');await click();
  assert.equal(page.calls.filter(x=>x==='readPreview').length,2,'绘图变化后重新生成');
  assert.equal(page.elements.get('preview-wrap').hidden,false);
});

test('已核对绘图预览显示加载状态与正常说明，不再标为试验只读',async()=>{
  const page=previewPage({deferImages:true});await page.start();
  const loading=page.elements.get('preview').handlers.get('click')();await page.advance(0);
  assert.equal(page.elements.get('preview').textContent,'生成中…');assert.equal(page.elements.get('preview').disabled,true);
  assert.equal(page.elements.get('preview-wrap').hidden,true);assert.equal(page.elements.get('status').textContent,'正在生成预览…');
  page.images[0].onload();await loading;
  assert.equal(page.elements.get('preview-wrap').hidden,false);assert.equal(page.elements.get('preview').textContent,'收起');
  assert.equal(page.elements.get('preview-note').textContent,'预览为近似渲染。');
  assert.match(page.elements.get('status').textContent,/预览已生成，2 条笔画/);
  assert.deepEqual(page.calls,['readCurrent','readCurrent','readPreview','readCurrent']);assert.equal(page.timers.size,0);
});

test('超出已核对范围的路径标记仍在预览旁明确标为只读试验',async()=>{
  const page=previewPage({unverified:true});await page.start();await page.elements.get('preview').handlers.get('click')();
  assert.match(page.elements.get('preview-note').textContent,/试验预览.*暂不参与单卡、自动及批量改色/);
  assert.doesNotMatch(page.elements.get('status').textContent,/试验预览/,'顶部不重复预览旁的长说明');
  assert.match(page.elements.get('status').textContent,/1 条笔画/);
  assert.deepEqual(page.calls,['readCurrent','readCurrent','readPreview','readCurrent']);
});

test('放大预览可关闭、键盘返回，并在跟踪卡片变化后清除',async()=>{
  const page=previewPage();await page.start();await page.elements.get('preview').handlers.get('click')();
  page.elements.get('preview-zoom').handlers.get('click')();
  assert.equal(page.elements.get('preview-dialog').hidden,false);
  assert.equal(page.elements.get('preview-large-image').src,page.elements.get('preview-image').src);
  assert.equal(page.context.document.activeElement,page.elements.get('preview-close'));
  page.keydown('Tab');assert.equal(page.context.document.activeElement,page.elements.get('preview-close'));
  page.keydown('Escape');assert.equal(page.elements.get('preview-dialog').hidden,true);
  assert.equal(page.context.document.activeElement,page.elements.get('preview-zoom'));
  page.elements.get('preview-zoom').handlers.get('click')();
  page.setCurrent('B');await page.context.InkToCardApp.refresh();
  assert.equal(page.elements.get('preview-dialog').hidden,true);
  assert.equal(page.elements.get('preview-wrap').hidden,true);
  assert.equal(page.elements.get('preview-large-image').src,undefined);
});

test('面板反馈区分等待选卡、缺少映射、等待手写，并随学习集刷新摘要',async()=>{
  let snapshot={available:false,topicId:'topic',tracking:true,reason:'请先选一张卡片'};
  const page=packagedPage({onBridge(address,context){
    const request=JSON.parse(decodeURIComponent(address.split('payload=')[1]));
    context.InkToCardReceive({requestId:request.requestId,payload:{...snapshot,settings:context.__INK_TO_CARD_CONFIG__.normalize(snapshot.settings)}});
  }});
  await page.start();assert.equal(page.elements.get('tracking-status').textContent,'等待选卡');
  assert.equal(page.elements.get('status').textContent,'请先选一张卡片');
  snapshot={available:true,topicId:'topic',noteId:'A',colorIndex:0,title:'卡片A',source:{index:2,hash:'drawing:A'},settings:{auto:true}};
  await page.context.InkToCardApp.refresh();
  assert.equal(page.elements.get('tracking-status').textContent,'待配置映射');
  assert.match(page.elements.get('status').textContent,/请展开“颜色映射”/);
  snapshot.settings={auto:true,policy:'red',mapping:{red:7,uncolored:1}};
  await page.context.InkToCardApp.refresh();
  assert.equal(page.elements.get('mapping-summary').textContent,'红色 → 8；无彩色书写 → 2');
  assert.equal(page.elements.get('rules-summary').textContent,'有红色就设为红色');
  snapshot.source=null;await page.context.InkToCardApp.refresh();
  assert.equal(page.elements.get('tracking-status').textContent,'等待手写');
  assert.equal(page.elements.get('recognize').disabled,true);
  assert.match(page.elements.get('status').textContent,/没有可读取的手写绘图/);
});

test('媒体读取失败或浏览器图片显示失败时，预览明确报错并可重试',async()=>{
  for(const options of [{bridgeError:true},{imageError:true}]){
    const page=previewPage(options);await page.start();await page.elements.get('preview').handlers.get('click')();
    assert.match(page.elements.get('status').textContent,options.bridgeError?/预览失败：媒体尚未下载/:/预览失败：预览图片无法显示/);
    assert.equal(page.elements.get('preview-wrap').hidden,true);assert.equal(page.elements.get('preview').textContent,'预览');
    assert.equal(page.elements.get('preview').disabled,false);assert.equal(page.timers.size,0);
  }
});

test('图片加载无响应会超时报错；加载期间换卡不显示旧卡预览',async()=>{
  const timeout=previewPage({deferImages:true});await timeout.start();
  const waiting=timeout.elements.get('preview').handlers.get('click')();await timeout.advance(15000);await waiting;
  assert.match(timeout.elements.get('status').textContent,/预览失败：预览图片加载超时/);assert.equal(timeout.elements.get('preview').disabled,false);
  const changed=previewPage({deferImages:true});await changed.start();
  const loading=changed.elements.get('preview').handlers.get('click')();await changed.advance(0);
  changed.setCurrent('B');changed.images[0].onload();await loading;
  assert.equal(changed.elements.get('preview-wrap').hidden,true);assert.match(changed.elements.get('status').textContent,/卡片或绘图已变化/);
});

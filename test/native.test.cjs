const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup() {
  const storage=new Map(), writes=[], mediaReads=[], note={noteId:'card',notebookId:'topic',noteTitle:'题目',colorIndex:0,
    comments:[{type:'TextNote',text:'原题文字'},{type:'PaintNote',drawing:'handwriting'},{type:'PaintNote',paint:'problem-image'}]};
  const addon={window:{},inkNotebookOpen:true}, notebook={focusNote:note,notebookId:'topic'};
  const database={getNoteById:id=>id===note.noteId?note:null,getMediaByHash:hash=>{
    mediaReads.push(hash);const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-drawing.wrd'));return {length:raw.length,base64Encoding:()=>raw.toString('base64')};
  }};
  const context=vm.createContext({console,
    NSUserDefaults:{standardUserDefaults:()=>({objectForKey:key=>storage.get(key),setObjectForKey:(value,key)=>storage.set(key,value),removeObjectForKey:key=>storage.delete(key)})},
    Database:{sharedInstance:()=>database},
    Application:{sharedInstance:()=>({studyController:()=>({notebookController:notebook}),refreshAfterDBChanged:topic=>writes.push(['refresh',topic])})},
    UndoManager:{sharedInstance:()=>({undoGrouping:(label,topic,fn)=>{writes.push(['undo',topic]);fn();}})},
    UIImage:{imageWithData:()=>({size:{width:100,height:100},pngData:()=>({base64Encoding:()=> 'aGVsbG8='})})}
  });
  for(const file of ['InkToCardConfig.js','InkToCardCore.js','InkToCardDrawing.js','InkToCardNative.js','InkToCardBatch.js','WebBridgeCommands.js']) {
    const filename=path.resolve(__dirname,'../src',file);
    if(fs.existsSync(filename))vm.runInContext(fs.readFileSync(filename,'utf8'),context);
  }
  const native=context.__INK_TO_CARD_NATIVE__, commands=context.__INK_TO_CARD_COMMANDS__;
  const settings=context.__INK_TO_CARD_CONFIG__.normalize({auto:true,mapping:{red:3,blue:2}});
  native.saveSettings(addon,{noteId:'card',settings});
  function request(overrides={}){return {noteId:'card',index:1,hash:'drawing:handwriting',settingsToken:JSON.stringify(settings),expectedColorIndex:0,automatic:true,
    histogram:{pixels:10000,colored:100,counts:{red:100,orange:0,yellow:0,green:0,cyan:0,blue:0,purple:0}},...overrides};}
  return {storage,writes,mediaReads,note,addon,notebook,database,context,native,commands,settings,request};
}
test('无当前卡片时提示在脑图选中，不要求双击进入焦点',()=>{
  const env=setup();env.notebook.focusNote=null;
  const state=env.native.snapshot(env.addon);
  assert.equal(state.available,false);assert.match(state.reason,/脑图.*选中.*卡片/);
  assert.ok(!/双击|进入.*焦点/.test(state.reason));
});

test('只有普通图片时不自动选择，即使有旧绑定也不能改色',()=>{
  const env=setup();env.note.comments[1]={type:'PaintNote',paint:'handwriting'};env.storage.set('cn.marginnote.ink-to-card.binding.card',JSON.stringify({index:1,hash:'handwriting',context:[]}));
  assert.equal(env.native.snapshot(env.addon).source,null);
  assert.deepEqual(env.mediaReads,[]);
  assert.throws(()=>env.native.apply(env.addon,env.request()),/手写批注已变化/);
  assert.equal(env.note.colorIndex,0);
});
test('无需指定即可读取最后一条手写绘图，不读取题目图片',()=>{
  const env=setup();
  env.native.media(env.addon,{noteId:'card',index:1,hash:'drawing:handwriting'});
  assert.deepEqual(env.mediaReads,['handwriting']);
});
test('改色分组撤销，并重新读取验证',()=>{
  const env=setup();
  const result=env.native.apply(env.addon,env.request());
  assert.equal(result.status,'applied');
  assert.equal(result.reason,'已设置卡片色号 4');
  assert.equal(env.note.colorIndex,3);
  assert.deepEqual(env.writes,[['undo','topic'],['refresh','topic']]);
});

test('MN5 按事件身份改卡色：焦点在B，仍能读取并改A，已有映射与色号保持一致',()=>{
  const env=setup();env.addon.inkSceneMode=true;env.addon.inkSceneEpoch=1;
  const other={noteId:'other',notebookId:'topic',colorIndex:2,comments:[]};
  env.notebook.focusNote=other;
  const get=env.database.getNoteById;env.database.getNoteById=id=>id==='other'?other:get(id);
  const snapshot=env.commands.trackNote(env.addon,{noteId:'card'});
  assert.equal(snapshot.noteId,'card');assert.equal(env.native.snapshot(env.addon).noteId,'card');
  assert.equal(snapshot.settings.mapping.red,3);
  env.commands.readMedia(env.addon,{noteId:'card',index:1,hash:'drawing:handwriting'});
  const result=env.commands.applyResult(env.addon,env.request({scopeToken:snapshot.scopeToken}));
  assert.equal(result.status,'applied');assert.equal(env.note.colorIndex,3);assert.equal(other.colorIndex,2);
  assert.equal(result.reason,'已设置卡片色号 4');
});

test('MN5 不选卡也可保存当前学习集设置，后台恢复或切集后拒绝旧结果',()=>{
  const env=setup();env.addon.inkSceneMode=true;env.addon.inkSceneEpoch=1;env.notebook.focusNote=null;
  const state=env.native.snapshot(env.addon);assert.equal(state.available,false);assert.equal(state.settings.mapping.red,3);
  env.commands.saveSettings(env.addon,{topicId:'topic',scopeToken:state.scopeToken,settings:env.settings});
  const snapshot=env.commands.readNote(env.addon,{noteId:'card'});
  env.addon.inkSceneEpoch++;
  assert.throws(()=>env.commands.applyResult(env.addon,env.request({scopeToken:snapshot.scopeToken})),/学习窗口或学习集/);
  env.notebook.notebookId='other-topic';
  assert.throws(()=>env.commands.readNote(env.addon,{noteId:'card'}),/不属于当前学习集/);
  assert.deepEqual(env.writes,[]);
});
test('已是目标色时不制造撤销记录',()=>{
  const env=setup();env.note.colorIndex=3;
  assert.equal(env.native.apply(env.addon,env.request({expectedColorIndex:3})).status,'unchanged');
  assert.deepEqual(env.writes,[]);
});
test('切换焦点卡、手动改色、修改图片均拒绝过期识别结果',()=>{
  for(const change of [env=>{env.notebook.focusNote=null;},env=>{env.note.colorIndex=5;},env=>{env.note.comments[1].drawing='new-ink';}]){
    const env=setup();change(env);
    assert.throws(()=>env.native.apply(env.addon,env.request()));
    assert.deepEqual(env.writes,[]);
  }
});
test('关闭自动识别、切换设置、退出学习集或后台时停止写入',()=>{
  for(const change of [env=>{env.native.saveSettings(env.addon,{noteId:'card',settings:{...env.settings,auto:false}});},
    env=>{env.native.saveSettings(env.addon,{noteId:'card',settings:{...env.settings,mapping:{red:7}}});},
    env=>{env.addon.inkNotebookOpen=false;},env=>{env.addon.inkInactive=true;}]){
    const env=setup();change(env);
    assert.throws(()=>env.native.apply(env.addon,env.request())); assert.deepEqual(env.writes,[]);
  }
});
test('按最后一条绘图选择，普通图片及新增文字不改变来源',()=>{
  const env=setup();
  env.note.comments.push({type:'PaintNote',drawing:'last-ink'},{type:'PaintNote',paint:'last-image'});
  assert.equal(env.native.snapshot(env.addon).source.hash,'drawing:last-ink');
  env.note.comments.reverse();
  assert.equal(env.native.snapshot(env.addon).source.hash,'drawing:handwriting');
  env.note.comments.unshift({type:'TextNote',text:'新增'});
  assert.equal(env.native.snapshot(env.addon).source.hash,'drawing:handwriting');
});
test('仅手写媒体变更、其他批注未改时继续跟踪',()=>{
  const env=setup();env.note.comments[1].drawing='new-ink';
  assert.equal(env.native.snapshot(env.addon).source.hash,'drawing:new-ink');
});
test('畸形统计和不确定多色不写入',()=>{
  const env=setup();
  assert.throws(()=>env.native.apply(env.addon,env.request({histogram:{pixels:1,colored:Infinity,counts:{red:Infinity}}})),/结果无效/);
  const invalid=env.request();invalid.histogram.colored=NaN;
  assert.throws(()=>env.native.apply(env.addon,invalid),/结果无效/);
  const payload=env.request();payload.histogram.counts.blue=95;payload.histogram.colored=195;
  assert.equal(env.native.apply(env.addon,payload).status,'ambiguous');
  assert.equal(env.note.colorIndex,0);
});
test('图片解码失败会明确报错，撤销接口缺失时保持原色',()=>{
  const env=setup(),getMedia=env.database.getMediaByHash;env.context.UIImage.imageWithData=()=>null;env.database.getMediaByHash=()=>({length:100});
  assert.throws(()=>env.native.media(env.addon,{noteId:'card',index:1,hash:'drawing:handwriting'}),/无法解码为图片/);
  env.database.getMediaByHash=getMedia;env.context.UndoManager=undefined;
  assert.throws(()=>env.native.apply(env.addon,env.request()),/撤销接口/);assert.equal(env.note.colorIndex,0);
});
test('不同学习集独立保存映射，重建原生会话仍能读取',()=>{
  const env=setup();env.note.notebookId='other';
  assert.equal(env.native.snapshot(env.addon).settings.mapping.red,-1);
  env.note.notebookId='topic';
  assert.equal(env.native.snapshot(env.addon).settings.mapping.red,3);
  assert.ok([...env.storage.values()].every(value=>typeof value==='string'));
});

test('来源检查能报告有笔画但没有 PaintNote 的卡片，且不读取媒体或改色',()=>{
  const env=setup();env.note.comments=[{type:'TextNote',text:'原题文字'}];
  env.note.getStrokesCount=()=>18;env.note.getDrawingSize=()=>2048;
  assert.equal(env.native.snapshot(env.addon).sources.length,0);
  const report=env.commands.inspectSources(env.addon,{noteId:'card'});
  assert.equal(report.database.commentCount,1);
  assert.equal(report.database.paintCommentCount,0);
  assert.equal(report.database.strokes.value,18);
  assert.equal(report.database.drawingBytes.value,2048);
  assert.match(report.summary,/笔画/);
  assert.deepEqual(env.writes,[]);assert.deepEqual(env.mediaReads,[]);
});

test('来源检查分别读取焦点与数据库，兼容原生数组和字典，并隐藏正文与媒体哈希',()=>{
  const env=setup(), comment={type:'PaintNote',paint:'private-hash',text:'private-text'};
  const keys=Object.keys(comment);
  const dictionary={objectForKey:key=>comment[key],allKeys:()=>({count:()=>keys.length,objectAtIndex:index=>keys[index]})};
  const fresh={...env.note,comments:{count:()=>1,objectAtIndex:()=>dictionary},getStrokesCount:()=>0};
  env.database.getNoteById=()=>fresh;env.note.comments=[];
  const report=env.commands.inspectSources(env.addon,{noteId:'card'});
  assert.equal(report.focus.commentCount,0);assert.equal(report.database.paintCommentCount,1);
  assert.deepEqual(Array.from(report.database.entries[0].fields),keys);
  assert.equal(report.database.drawingBytes.supported,false);
  assert.ok(!JSON.stringify(report).includes('private-'));
});

test('来源检查保留接口异常，不把不可用或失败误报为零笔画，并拒绝过期卡片',()=>{
  const env=setup();env.note.comments=[];
  env.note.getStrokesCount=()=>{throw new Error('绘图未保存');};
  const report=env.commands.inspectSources(env.addon,{noteId:'card'});
  assert.equal(report.database.strokes.error,'绘图未保存');
  assert.equal(report.database.strokes.value,undefined);
  assert.match(report.summary,/不能.*断定/);
  env.notebook.focusNote=null;
  assert.throws(()=>env.commands.inspectSources(env.addon,{noteId:'card'}),/当前卡片已变化/);
});

test('drawing 字段的 PaintNote 能进入来源列表，并读取该媒体而非其他图片',()=>{
  const env=setup();env.note.comments[1]={type:'PaintNote',drawing:'drawing-media',size:{width:100,height:100}};
  const sources=env.native.snapshot(env.addon).sources;
  assert.equal(sources.length,2,'带 drawing 的手写批注不能被 paint 字段筛选漏掉');
  const source=sources.find(item=>item.index===1);
  assert.equal(source.kind,'drawing');
  const result=env.native.media(env.addon,{noteId:'card',...source});
  assert.match(result.dataURL,/^data:image\/svg\+xml/);
  assert.deepEqual(env.mediaReads,['drawing-media']);
});

test('两份真机 MN4.5.0 drawing 样本通过桥接预览完整笔画，不要求 UIImage 解码归档',()=>{
  for(const [filename,count] of [['mn4-450-drawing.wrd',150],['mn4-450-drawing-field13.wrd',88]]) {
  const env=setup(), raw=fs.readFileSync(path.resolve(__dirname,'fixtures',filename));
  env.note.comments[1]={type:'PaintNote',drawing:'real-drawing'};
  env.database.getMediaByHash=hash=>{env.mediaReads.push(hash);return {length:raw.length,base64Encoding:()=>raw.toString('base64')};};
  env.context.UIImage.imageWithData=()=>{throw new Error('PencilKit 归档不能交给 UIImage');};
  const source=env.native.snapshot(env.addon).sources.find(item=>item.index===1);
  const media=env.commands.readMedia(env.addon,{noteId:'card',...source});
  assert.match(media.dataURL,/^data:image\/svg\+xml/);
  assert.equal(media.drawing.strokeCount,count);
  assert.deepEqual(Array.from(media.drawing.colors),['#000000','#fd2f43']);
  assert.deepEqual(env.mediaReads,['real-drawing']);assert.deepEqual(env.writes,[]);
  }
});

test('drawing 保存后继续跟踪新媒体，旧识别结果拒绝写入',()=>{
  const env=setup();env.note.comments[1]={type:'PaintNote',drawing:'old-drawing',size:{width:100,height:100}};
  const source=env.native.snapshot(env.addon).sources.find(item=>item.index===1);
  env.note.comments[1].drawing='new-drawing';
  const updated=env.native.snapshot(env.addon).source;
  assert.equal(updated.kind,'drawing');assert.notEqual(updated.hash,source.hash);
  assert.throws(()=>env.native.apply(env.addon,env.request({hash:source.hash})),/手写批注已变化/);
  assert.deepEqual(env.writes,[]);
});

test('drawing 原始二进制不伪装成图片，检查报告格式且不制造改色',()=>{
  const env=setup();env.note.comments[1]={type:'PaintNote',drawing:'archive'};
  env.note.getStrokesCount=()=>36;
  env.database.getMediaByHash=hash=>{env.mediaReads.push(hash);return {length:20919,
    base64Encoding:()=>Buffer.concat([Buffer.from('bplist00'),Buffer.from([0xd1,1,2])]).toString('base64')};};
  env.context.UIImage.imageWithData=()=>null;
  const source=env.native.snapshot(env.addon).sources.find(item=>item.index===1);
  assert.throws(()=>env.native.media(env.addon,{noteId:'card',...source}),/已读取 drawing 媒体.*20919.*无法解码/);
  const report=env.native.inspectSources(env.addon,{noteId:'card',inspectMedia:true});
  assert.equal(report.database.paintTypeCount,2);assert.equal(report.database.drawingCommentCount,1);
  assert.equal(report.database.entries[1].drawing.type,'string');
  assert.equal(report.drawingMedia[0].format,'二进制 Property List');
  assert.equal(report.drawingMedia[0].imageDecoded,false);
  assert.ok(!report.summary.includes('未返回 PaintNote'));
  assert.deepEqual(env.writes,[]);
});

test('内嵌 drawing 对象不被字符串化为虚假的媒体哈希',()=>{
  const env=setup();env.note.comments[1]={type:'PaintNote',drawing:{unknown:'inline'}};
  assert.equal(env.native.snapshot(env.addon).sources.length,1);
  const report=env.native.inspectSources(env.addon,{noteId:'card',inspectMedia:true});
  assert.equal(report.database.entries[1].drawing.type,'object');
  assert.equal(report.drawingMedia.length,0);
  assert.deepEqual(env.mediaReads,[]);
});

test('导出所选 drawing 原始样本保存完整二进制，不读其他图片或修改卡片',()=>{
  const env=setup(), raw=Buffer.from([0,1,2,250,251,252]), files=new Map(), saves=[];
  env.note.comments[1]={type:'PaintNote',drawing:'archive',size:{width:450,height:200}};
  env.database.getMediaByHash=hash=>{env.mediaReads.push(hash);return {length:raw.length,base64Encoding:()=>raw.toString('base64')};};
  env.context.NSData={dataWithStringEncoding:(string,encoding)=>{
    assert.equal(encoding,4);
    return {writeToFileAtomically:(filename,atomic)=>{assert.equal(atomic,true);files.set(filename,string);return true;}};
  }};
  env.context.NSFileManager={defaultManager:()=>({createDirectoryAtPathWithIntermediateDirectoriesAttributes:(directory,intermediates,attributes)=>{
    assert.equal(directory,'/tmp/cn.marginnote.ink-to-card');assert.equal(intermediates,true);assert.equal(attributes,null);return true;
  }})};
  env.context.Application.sharedInstance=()=>({studyController:()=>({notebookController:env.notebook}),
    tempPath:'/tmp',appVersion:'4.5.0',build:'60',saveFileWithUti:(filename,uti)=>saves.push([filename,uti])});
  const source=env.native.snapshot(env.addon).sources.find(item=>item.index===1);
  const result=env.commands.exportDrawingSample(env.addon,{noteId:'card',...source});
  assert.equal(saves.length,1);assert.equal(saves[0][1],'public.json');
  const sample=JSON.parse(files.get(saves[0][0]));
  assert.equal(sample.format,'InkToCardDrawingSample');
  assert.equal(sample.appVersion,'4.5.0');assert.equal(sample.build,'60');
  assert.deepEqual(Buffer.from(sample.base64,'base64'),raw);assert.equal(sample.byteLength,raw.length);
  assert.equal(sample.size.width,450);assert.equal(sample.size.height,200);
  assert.ok(!files.get(saves[0][0]).includes('原题文字'));
  assert.deepEqual(env.mediaReads,['archive']);assert.deepEqual(env.writes,[]);
  assert.ok(!JSON.stringify(result).includes(raw.toString('base64')));
});

test('样本过大、编码缺失、焦点变化或写入失败时不打开保存窗口',()=>{
  for(const scenario of ['oversize','encoding','focus','write']) {
    const env=setup(), saves=[];
    env.note.comments[1]={type:'PaintNote',drawing:'archive'};
    env.context.Application.sharedInstance=()=>({studyController:()=>({notebookController:env.notebook}),
      tempPath:'/tmp',saveFileWithUti:(filename,uti)=>saves.push([filename,uti])});
    env.context.NSData={dataWithStringEncoding:()=>({writeToFileAtomically:()=>false})};
    env.context.NSFileManager={defaultManager:()=>({createDirectoryAtPathWithIntermediateDirectoriesAttributes:()=>true})};
    env.database.getMediaByHash=()=>{
      if(scenario==='focus')env.notebook.focusNote=null;
      return {length:scenario==='oversize'?1048577:1,base64Encoding:()=>scenario==='encoding'?'': 'AA=='};
    };
    const source=env.native.snapshot(env.addon).sources.find(item=>item.index===1);
    const expected={oversize:/1 MB/,encoding:/编码不完整/,focus:/当前卡片已变化/,write:/写入失败/};
    assert.throws(()=>env.commands.exportDrawingSample(env.addon,{noteId:'card',...source}),expected[scenario]);
    assert.deepEqual(saves,[]);assert.deepEqual(env.writes,[]);
  }
});

function batchSetup() {
  const env=setup(), child={noteId:'child',notebookId:'topic',noteTitle:'子卡',colorIndex:0,
    comments:[{type:'PaintNote',drawing:'child-first'},{type:'PaintNote',drawing:'child-last'},{type:'PaintNote',paint:'question'}]},
    image={noteId:'image',notebookId:'topic',noteTitle:'普通图片卡',colorIndex:0,comments:[{type:'PaintNote',paint:'red-question'}]},
    foreign={noteId:'foreign',notebookId:'other',colorIndex:0,comments:[{type:'PaintNote',drawing:'other-ink'}]};
  env.note.childNotes=[child,image];child.childNotes=[env.note];env.note.linkedNotes=[foreign];
  const notes=new Map([env.note,child,image,foreign].map(note=>[note.noteId,note]));
  env.database.getNoteById=id=>notes.get(id);
  env.database.getNotebookById=()=>({notes:[env.note,foreign]});
  env.notebook.mindmapView={selViewLst:[{note:{note:child}},{note:env.note},{note:{note:child}}]};
  return {...env,child,image,foreign,notes};
}
test('整学习集批量遍历子卡并去重，不跟随外集链接，也不必切换焦点',()=>{
  const env=batchSetup(), job=env.commands.beginBatch(env.addon,{scope:'notebook'}), results=[];
  assert.equal(job.total,3);env.notebook.focusNote=null;
  for(let position=0;position<job.total;position++) {
    const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position});
    if(item.skipped){results.push('skipped');continue;}
    assert.equal(item.media.drawing.strokeCount,150);
    results.push(env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:item.noteId,histogram:env.request().histogram}).status);
  }
  assert.deepEqual(results.sort(),['applied','applied','skipped']);
  assert.equal(env.note.colorIndex,3);assert.equal(env.child.colorIndex,3);assert.equal(env.image.colorIndex,0);assert.equal(env.foreign.colorIndex,0);
  assert.deepEqual(env.mediaReads.sort(),['child-last','child-last','handwriting','handwriting']);
  assert.equal(env.writes.filter(item=>item[0]==='undo').length,2);
});
test('选中批量只处理选中的卡片，原生容器兼容且不自动扩展子卡',()=>{
  const env=batchSetup(), entries=[{objectForKey:key=>key==='note'?{note:env.child}:undefined}];
  env.notebook.mindmapView.selViewLst={count:()=>entries.length,objectAtIndex:index=>entries[index]};
  const job=env.commands.beginBatch(env.addon,{scope:'selected'});
  assert.equal(job.total,1);
  const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position:0});
  assert.equal(item.noteId,'child');
  assert.throws(()=>env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:'card',histogram:env.request().histogram}),/尚未准备/);
  env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:'child',histogram:env.request().histogram});
  assert.equal(env.note.colorIndex,0);assert.equal(env.child.colorIndex,3);
  assert.throws(()=>env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position:0}),/顺序/);
});
test('批量取消、学习集切换、后台和设置变化都会拒绝在途写入',()=>{
  const changes=[env=>env.commands.endBatch(env.addon,{batchId:env.job.batchId}),env=>{env.notebook.notebookId='other';},
    env=>{env.addon.inkInactive=true;},env=>{env.addon.inkNotebookOpen=false;},
    env=>env.storage.set('cn.marginnote.ink-to-card.settings.topic',JSON.stringify({...env.settings,policy:'red'}))];
  for(const change of changes) {
    const env=batchSetup();env.notebook.mindmapView.selViewLst=[{note:env.note}];
    env.job=env.commands.beginBatch(env.addon,{scope:'selected'});
    env.commands.prepareBatchCard(env.addon,{batchId:env.job.batchId,position:0});change(env);
    assert.throws(()=>env.commands.applyBatchResult(env.addon,{batchId:env.job.batchId,noteId:'card',histogram:env.request().histogram}));
    assert.deepEqual(env.writes,[]);
  }
});
test('最后一条绘图新增、重排、更新和手动改色后跳过单卡，不覆盖用户修改',()=>{
  for(const change of [env=>{env.note.comments.push({type:'PaintNote',drawing:'new-last'});},
    env=>{env.note.comments[1].drawing='changed';},env=>{env.note.comments.unshift({type:'TextNote',text:'移动位置'});},
    env=>{env.note.colorIndex=7;},env=>{env.notes.delete('card');}]) {
    const env=batchSetup();env.notebook.mindmapView.selViewLst=[{note:env.note}];
    const job=env.commands.beginBatch(env.addon,{scope:'selected'});
    env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position:0});change(env);
    assert.equal(env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:'card',histogram:env.request().histogram}).status,'skipped');
    assert.deepEqual(env.writes,[]);
  }
});
test('最后绘图不支持时跳过，不回退到早期绘图或题目图片',()=>{
  const env=batchSetup();env.note.comments.push({type:'PaintNote',drawing:'unsupported-last'});
  env.database.getMediaByHash=hash=>{env.mediaReads.push(hash);return {length:100};};
  env.notebook.mindmapView.selViewLst=[{note:env.note}];
  const job=env.commands.beginBatch(env.addon,{scope:'selected'});
  const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position:0});
  assert.equal(item.skipped,true);assert.match(item.reason,/手写笔画格式/);
  assert.deepEqual(env.mediaReads,['unsupported-last']);assert.deepEqual(env.writes,[]);
  assert.throws(()=>env.commands.readMedia(env.addon,{noteId:'card',index:1,hash:'drawing:handwriting'}),/最后一条/);
});
test('最后绘图是未知内嵌对象时也不回退到可解码的早期绘图',()=>{
  const env=batchSetup();env.note.comments.push({type:'PaintNote',drawing:{unknown:'inline'}});
  env.notebook.mindmapView.selViewLst=[{note:env.note}];
  const snapshot=env.native.snapshot(env.addon);
  assert.equal(snapshot.source.index,3);
  assert.throws(()=>env.commands.readMedia(env.addon,{noteId:'card',...snapshot.source}),/引用格式不支持/);
  const job=env.commands.beginBatch(env.addon,{scope:'selected'});
  const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position:0});
  assert.equal(item.skipped,true);assert.deepEqual(env.mediaReads,[]);assert.deepEqual(env.writes,[]);
});
test('空选择、未配置红色映射、超大批次明确报错',()=>{
  const env=batchSetup();env.notebook.mindmapView.selViewLst=[];
  assert.throws(()=>env.commands.beginBatch(env.addon,{scope:'selected'}),/选中/);
  env.native.saveSettings(env.addon,{noteId:'card',settings:{policy:'red',mapping:{blue:2}}});
  assert.throws(()=>env.commands.beginBatch(env.addon,{scope:'notebook'}),/红色对应/);
  env.database.getNotebookById=()=>({notes:Array.from({length:5001},(_,i)=>({noteId:String(i),notebookId:'topic'}))});
  assert.throws(()=>env.commands.beginBatch(env.addon,{scope:'notebook'}),/5000/);
});

function webBatchSetup(options={}) {
  const env=batchSetup(), elements=new Map(), calls=[], imageCallbacks=[];
  function element(id) {
    if(!elements.has(id)) elements.set(id,{textContent:'',hidden:false,style:{},appendChild(){},replaceChildren(){},
      setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];}});
    return elements.get(id);
  }
  const rgba=options.rgba||new Uint8ClampedArray(100*100*4);
  if(!options.rgba){
    for(let i=0;i<50;i++)rgba.set([255,0,0,255],i*4);
    for(let i=50;i<900;i++)rgba.set([0,0,255,255],i*4);
  }
  const web=vm.createContext({console,setTimeout,clearTimeout,
    InkToCardStartup:{failed:()=>false,settled(){}},
    MNBridge:{send:async(command,payload)=>{calls.push(command);const result=env.commands[command](env.addon,payload);options.onCommand?.(command,env);return result;}},
    Image:class {naturalWidth=100;naturalHeight=100;set src(value){imageCallbacks.push(()=>this.onload());if(!options.deferImages)queueMicrotask(()=>this.onload());}},
    document:{readyState:'loading',body:{},addEventListener(){},getElementById:element,querySelectorAll:()=>[],
      createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:rgba})})})}
  });
  web.window=web;
  for(const file of ['src/InkToCardConfig.js','src/InkToCardCore.js','web/src/app.js'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8'),web);
  env.native.saveSettings(env.addon,{noteId:'card',settings:{...env.settings,policy:'red'}});
  return {...env,web,elements,calls,imageCallbacks};
}
test('网页批量通过实际原生命令处理多卡，使用红色模式并显示完成与跳过详情',async()=>{
  const env=webBatchSetup();await env.web.InkToCardApp.refresh();
  await env.web.InkToCardApp.runBatch('notebook');
  assert.equal(env.note.colorIndex,3);assert.equal(env.child.colorIndex,3);assert.equal(env.image.colorIndex,0);
  assert.match(env.elements.get('batch-status').textContent,/处理 3 \/ 3 · 改色 2.*跳过 1/);
  assert.match(env.elements.get('batch-details').textContent,/普通图片卡.*没有可读取的手写绘图/);
  assert.equal(env.elements.get('batch-notebook').disabled,false);assert.equal(env.addon.inkBatch,null);
});
test('网页取消图像分析中的批次，不能继续提交当前卡或剩余卡',async()=>{
  const env=webBatchSetup({deferImages:true});await env.web.InkToCardApp.refresh();
  const running=env.web.InkToCardApp.runBatch('notebook');
  for(let i=0;i<10&&!env.imageCallbacks.length;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(env.imageCallbacks.length);
  await env.web.InkToCardApp.cancelBatch();env.imageCallbacks[0]();await running;
  assert.deepEqual(env.writes,[]);assert.ok(!env.calls.includes('applyBatchResult'));
  assert.match(env.elements.get('batch-status').textContent,/已取消/);assert.equal(env.addon.inkBatch,null);
});
test('网页在途任务失效后停止整批，不把设置变化当作单卡解码失败继续',async()=>{
  const env=webBatchSetup({onCommand:(command,env)=>{if(command==='prepareBatchCard')env.notebook.notebookId='other';}});
  env.notebook.mindmapView.selViewLst=[{note:env.note}];
  await env.web.InkToCardApp.refresh();await env.web.InkToCardApp.runBatch('selected');
  assert.deepEqual(env.writes,[]);
  assert.equal(env.calls.filter(command=>command==='prepareBatchCard').length,1);
  assert.match(env.elements.get('batch-status').textContent,/已停止.*学习集已切换/);
});


test('经典插件记住单选卡片，取消选中及进入编辑后仍能读取并改色',()=>{
  const env=setup();env.addon.inkClassicTracking=true;env.addon.inkSceneEpoch=1;
  env.notebook.mindmapView={selViewLst:[{note:{note:env.note}}]};
  const snapshot=env.native.snapshot(env.addon);
  assert.equal(snapshot.noteId,'card');assert.equal(snapshot.tracking,true);
  env.notebook.focusNote=null;env.notebook.visibleFocusNote=null;env.notebook.mindmapView.selViewLst=[];
  assert.equal(env.native.snapshot(env.addon).noteId,'card');
  env.commands.readMedia(env.addon,{noteId:'card',index:1,hash:'drawing:handwriting'});
  const result=env.commands.applyResult(env.addon,env.request({scopeToken:snapshot.scopeToken}));
  assert.equal(result.status,'applied');assert.equal(env.note.colorIndex,3);
});

test('经典插件优先实际新单选，忽略残留焦点；多选及取消选择保留当前目标',()=>{
  const env=setup();env.addon.inkClassicTracking=true;
  env.notebook.mindmapView={selViewLst:[{note:env.note}]};
  const before=env.native.snapshot(env.addon),other={...env.note,noteId:'other',noteTitle:'B'};
  const get=env.database.getNoteById;env.database.getNoteById=id=>id==='other'?other:get(id);
  env.notebook.mindmapView.selViewLst={count:1,objectAtIndex:()=>({objectForKey:key=>key==='note'?{note:other}:undefined})};
  assert.throws(()=>env.commands.applyResult(env.addon,env.request({scopeToken:before.scopeToken})),/当前卡片/,'尚未再次轮询时也拒绝旧目标写入');
  assert.equal(env.native.snapshot(env.addon).noteId,'other');
  assert.throws(()=>env.commands.applyResult(env.addon,env.request({scopeToken:before.scopeToken})),/学习窗口或学习集|当前卡片/);
  env.notebook.mindmapView.selViewLst=[{note:env.note},{note:other}];
  assert.equal(env.native.snapshot(env.addon).noteId,'other');
  env.notebook.mindmapView.selViewLst=[];assert.equal(env.native.snapshot(env.addon).noteId,'other');
  assert.deepEqual(env.writes,[]);
});

test('经典插件在无选区接口时兼容焦点变化，但不复活已删除卡片或跨学习集目标',()=>{
  const env=setup();env.addon.inkClassicTracking=true;
  assert.equal(env.native.snapshot(env.addon).noteId,'card');
  env.notebook.focusNote=null;assert.equal(env.native.snapshot(env.addon).noteId,'card');
  env.database.getNoteById=()=>null;env.notebook.focusNote=env.note;
  assert.equal(env.native.snapshot(env.addon).available,false);assert.equal(env.addon.inkTargetId,null);
  env.database.getNoteById=id=>id==='card'?env.note:null;env.notebook.notebookId='different';
  assert.equal(env.native.snapshot(env.addon).available,false);
});

test('经典插件不选卡也能配置学习集，后台恢复后旧结果与旧设置请求失效',()=>{
  const env=setup();env.addon.inkClassicTracking=true;env.addon.inkSceneEpoch=1;env.notebook.focusNote=null;
  const empty=env.native.snapshot(env.addon);assert.equal(empty.settings.mapping.red,3);
  env.commands.saveSettings(env.addon,{topicId:'topic',scopeToken:empty.scopeToken,settings:env.settings});
  env.notebook.focusNote=env.note;const snapshot=env.native.snapshot(env.addon);
  env.addon.inkInactive=true;assert.equal(env.native.snapshot(env.addon).available,false);
  env.addon.inkSceneEpoch++;env.addon.inkInactive=false;
  assert.throws(()=>env.commands.applyResult(env.addon,env.request({scopeToken:snapshot.scopeToken})),/学习窗口或学习集/);
  assert.throws(()=>env.commands.saveSettings(env.addon,{topicId:'topic',scopeToken:snapshot.scopeToken,settings:env.settings}),/学习窗口或学习集/);
  assert.deepEqual(env.writes,[]);
});


function uncoloredSetup(create=setup,raw=require('./helpers/handwriting.cjs').handwriting()) {
  const env=create();
  env.database.getMediaByHash=hash=>{env.mediaReads.push(hash);return raw&&{length:raw.length,base64Encoding:()=>raw.toString('base64')};};
  env.settings=env.context.__INK_TO_CARD_CONFIG__.normalize({...env.settings,mapping:{...env.settings.mapping,uncolored:5}});
  env.native.saveSettings(env.addon,{noteId:'card',settings:env.settings});
  const request=env.request;
  env.request=(overrides={})=>request({settingsToken:JSON.stringify(env.settings),histogram:{pixels:10000,visible:100,colored:0,
    counts:{red:0,orange:0,yellow:0,green:0,cyan:0,blue:0,purple:0}},...overrides});
  return env;
}

test('build64黑色图形曲线支持预览、单卡、自动和批量无彩色改色',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build64-marked-curves.wrd'));
  for(const automatic of [false,true]){
    const env=uncoloredSetup(setup,raw),source={noteId:'card',index:1,hash:'drawing:handwriting'};
    env.settings=env.context.__INK_TO_CARD_CONFIG__.normalize({...env.settings,policy:'priority',mapping:{...env.settings.mapping,uncolored:1}});
    env.native.saveSettings(env.addon,{noteId:'card',settings:env.settings});
    assert.equal(env.commands.readPreview(env.addon,source).drawing.strokeCount,70);
    assert.equal(env.commands.readMedia(env.addon,source).drawing.previewOnly,undefined);
    const result=env.commands.applyResult(env.addon,env.request({automatic}));
    assert.equal(result.status,'applied');assert.equal(result.color,'uncolored');assert.equal(env.note.colorIndex,1);
    assert.equal(result.reason,'已设置卡片色号 2');
  }
  const env=uncoloredSetup(batchSetup,raw),job=env.commands.beginBatch(env.addon,{scope:'selected'});
  for(let position=0;position<job.total;position++){
    const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position});
    assert.equal(item.skipped,undefined);assert.equal(item.media.drawing.strokeCount,70);
    const result=env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:item.noteId,histogram:env.request().histogram});
    assert.equal(result.status,'applied');assert.equal(result.color,'uncolored');
  }
  assert.equal(env.note.colorIndex,5);assert.equal(env.child.colorIndex,5);assert.equal(env.image.colorIndex,0);
});

test('单卡与自动无彩色书写均须通过原生笔画验证，支持黑灰白且沿用撤销',()=>{
  const {handwriting}=require('./helpers/handwriting.cjs');
  for(const color of [[0,0,0,1],[0.5,0.5,0.5,1],[1,1,1,1]])for(const automatic of [true,false]){
    const env=uncoloredSetup(setup,handwriting([{color}]));
    const result=env.commands.applyResult(env.addon,env.request({automatic}));
    assert.equal(result.status,'applied');assert.equal(result.color,'uncolored');assert.equal(env.note.colorIndex,5);
    assert.deepEqual(env.mediaReads,['handwriting']);assert.deepEqual(env.writes,[['undo','topic'],['refresh','topic']]);
    assert.equal(env.native.settings('topic').mapping.red,3,'原有红色映射保留');
  }
});

test('没有绘图、只有图片、透明绘图、媒体缺失和不支持格式都不能触发无彩色改色',()=>{
  const {handwriting}=require('./helpers/handwriting.cjs');
  const variants=[
    env=>{env.note.comments=[];},
    env=>{env.note.comments=[{type:'PaintNote',paint:'black-image'}];},
    env=>{env.database.getMediaByHash=()=>null;},
    env=>{env.database.getMediaByHash=()=>({length:3,base64Encoding:()=>Buffer.from('bad').toString('base64')});},
    env=>{const raw=handwriting([{color:[0,0,0,0]}]);env.database.getMediaByHash=()=>({length:raw.length,base64Encoding:()=>raw.toString('base64')});},
    env=>{const raw=handwriting([{brush:'unknown'}]);env.database.getMediaByHash=()=>({length:raw.length,base64Encoding:()=>raw.toString('base64')});}
  ];
  for(const change of variants){const env=uncoloredSetup();change(env);assert.throws(()=>env.native.apply(env.addon,env.request()));assert.deepEqual(env.writes,[]);}
});

test('预览没有彩色像素但原始绘图有彩笔时，也不能作为无彩色书写',()=>{
  const env=uncoloredSetup();const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-drawing-field13.wrd'));
  env.database.getMediaByHash=()=>({length:raw.length,base64Encoding:()=>raw.toString('base64')});
  const result=env.native.apply(env.addon,env.request());
  assert.equal(result.status,'insufficient');assert.match(result.reason,/仍含彩色/);assert.deepEqual(env.writes,[]);
});

test('无彩色书写拒绝无效统计，空白或缺少可见笔迹统计时保持原色',()=>{
  for(const visible of [-1,NaN,Infinity,'100',10001]){
    const env=uncoloredSetup(),payload=env.request();payload.histogram.visible=visible;
    assert.throws(()=>env.native.apply(env.addon,payload),/识别结果无效/);assert.deepEqual(env.writes,[]);
  }
  for(const visible of [undefined,0,29]){
    const env=uncoloredSetup(),payload=env.request();payload.histogram.visible=visible;
    assert.equal(env.native.apply(env.addon,payload).status,'insufficient');assert.deepEqual(env.writes,[]);
  }
});

test('仅配置无彩色书写即可批量，无手写或最后绘图不支持时跳过，不回退',()=>{
  const env=uncoloredSetup(batchSetup);
  env.settings=env.context.__INK_TO_CARD_CONFIG__.normalize({policy:'red',mapping:{uncolored:5}});
  env.native.saveSettings(env.addon,{noteId:'card',settings:env.settings});
  env.child.comments.push({type:'PaintNote',drawing:{unsupported:true}});
  const job=env.commands.beginBatch(env.addon,{scope:'notebook'});assert.equal(job.total,3);
  let applied=0,skipped=0;
  for(let position=0;position<job.total;position++){
    const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position});
    if(item.skipped){skipped++;continue;}
    const result=env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:item.noteId,histogram:env.request().histogram});
    assert.equal(result.status,'applied');applied++;
  }
  assert.equal(applied,1);assert.equal(skipped,2);assert.equal(env.note.colorIndex,5);assert.equal(env.child.colorIndex,0);assert.equal(env.image.colorIndex,0);
});

test('网页批量无彩色书写通过实际原生命令改黑笔卡，彩笔漏检和图片卡保持原色',async()=>{
  const rgba=new Uint8ClampedArray(100*100*4);for(let i=0;i<100;i++)rgba.set([0,0,0,255],i*4);
  const env=uncoloredSetup(()=>webBatchSetup({rgba}));
  env.settings=env.context.__INK_TO_CARD_CONFIG__.normalize({...env.settings,policy:'red',mapping:{uncolored:5}});
  env.native.saveSettings(env.addon,{noteId:'card',settings:env.settings});
  const {handwriting}=require('./helpers/handwriting.cjs'),black=handwriting(),red=handwriting([{color:[1,0,0,1]}]);
  env.database.getMediaByHash=hash=>{const raw=hash==='handwriting'?black:red;return {length:raw.length,base64Encoding:()=>raw.toString('base64')};};
  await env.web.InkToCardApp.refresh();await env.web.InkToCardApp.runBatch('notebook');
  assert.equal(env.note.colorIndex,5);assert.equal(env.child.colorIndex,0);assert.equal(env.image.colorIndex,0);
  assert.match(env.elements.get('batch-status').textContent,/改色 1.*跳过 2/);
});


test('已核对路径标记和单点布局支持单卡、自动和批量，仍只处理最后手写绘图',()=>{
  for(const file of ['mn4-450-build62-path9-black-red.wrd','mn4-450-build62-path9-red.wrd','mn4-450-build62-path9-94-strokes.wrd','mn4-450-build64-single-point.wrd']){
    const env=batchSetup(),raw=fs.readFileSync(path.resolve(__dirname,'fixtures',file));
    env.database.getMediaByHash=()=>({length:raw.length,base64Encoding:()=>raw.toString('base64')});
    const source={noteId:'card',index:1,hash:'drawing:handwriting'};
    assert.equal(env.commands.readPreview(env.addon,source).drawing.previewOnly,undefined);
    assert.equal(env.commands.readMedia(env.addon,source).drawing.previewOnly,undefined);
    for(const automatic of [true,false]){
      env.note.colorIndex=0;const result=env.commands.applyResult(env.addon,env.request({automatic}));
      assert.equal(result.status,'applied');assert.equal(env.note.colorIndex,3);
    }
    env.note.colorIndex=0;const job=env.commands.beginBatch(env.addon,{scope:'selected'});
    for(let position=0;position<job.total;position++){
      const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position});assert.equal(item.skipped,undefined);
      assert.equal(env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:item.noteId,histogram:env.request().histogram}).status,'applied');
    }
    assert.equal(env.note.colorIndex,3);assert.equal(env.child.colorIndex,3);assert.equal(env.image.colorIndex,0);
  }
});

test('build64布局131蓝色样本支持单卡、自动和批量蓝色改色，不误用无彩色映射',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build64-layout131-blue.wrd'));
  const histogram={pixels:10000,colored:100,counts:{red:0,orange:0,yellow:0,green:0,cyan:0,blue:100,purple:0}};
  for(const automatic of [false,true]){
    const env=uncoloredSetup(setup,raw),source={noteId:'card',index:1,hash:'drawing:handwriting'};
    assert.equal(env.commands.readPreview(env.addon,source).drawing.strokeCount,61);
    assert.equal(env.commands.readMedia(env.addon,source).drawing.previewOnly,undefined);
    const result=env.commands.applyResult(env.addon,env.request({automatic,histogram}));
    assert.equal(result.status,'applied');assert.equal(result.color,'blue');assert.equal(env.note.colorIndex,2);
    assert.equal(result.reason,'已设置卡片色号 3');
  }
  const env=uncoloredSetup(batchSetup,raw),job=env.commands.beginBatch(env.addon,{scope:'selected'});
  for(let position=0;position<job.total;position++){
    const item=env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position});
    assert.equal(item.skipped,undefined);assert.equal(item.media.drawing.strokeCount,61);
    const result=env.commands.applyBatchResult(env.addon,{batchId:job.batchId,noteId:item.noteId,histogram});
    assert.equal(result.status,'applied');assert.equal(result.color,'blue');
  }
  assert.equal(env.note.colorIndex,2);assert.equal(env.child.colorIndex,2);assert.equal(env.image.colorIndex,0);
  const missed=uncoloredSetup(setup,raw),result=missed.commands.applyResult(missed.addon,missed.request());
  assert.equal(result.status,'insufficient');assert.match(result.reason,/仍含彩色/);assert.deepEqual(missed.writes,[]);
});

test('预览不能越过兼容范围授予写入：越界路径标记仍拒绝识别和改色',()=>{
  const env=batchSetup(),raw=require('./helpers/handwriting.cjs').handwriting([{color:[1,0,0,1],pathMarker:2}]);
  env.database.getMediaByHash=()=>({length:raw.length,base64Encoding:()=>raw.toString('base64')});
  const source={noteId:'card',index:1,hash:'drawing:handwriting'};
  assert.equal(env.commands.readPreview(env.addon,source).drawing.previewOnly,true);
  assert.throws(()=>env.commands.readMedia(env.addon,{...source,previewOnly:true}),/未验证标记/);
  for(const automatic of [true,false])assert.throws(()=>env.commands.applyResult(env.addon,env.request({automatic})),/未验证标记/);
  const job=env.commands.beginBatch(env.addon,{scope:'selected'});
  for(let position=0;position<job.total;position++)assert.equal(env.commands.prepareBatchCard(env.addon,{batchId:job.batchId,position}).skipped,true);
  assert.deepEqual(env.writes,[]);
});

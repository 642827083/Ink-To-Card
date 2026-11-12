const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {handwriting}=require('./helpers/handwriting.cjs');
const {binaryPlist,archivedDrawing}=require('./helpers/archive.cjs');
function runtime(){
  const context=vm.createContext({});
  for(const name of ['InkToCardConfig','InkToCardCore','InkToCardDrawing','InkToCardAnalysis'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),context);
  return context;
}
function analyze(raw,settings={}){
  const c=runtime();return c.__INK_TO_CARD_ANALYSIS__.analyze(raw.toString('base64'),raw.length,settings);
}
const settings={mapping:{red:3,blue:2,uncolored:7}};

test('MN5.0.2混合真实样本排除1条马克笔，只统计153条普通笔3372点，红色可改卡色',()=>{
  const raw=fs.readFileSync(path.join(__dirname,'fixtures/mn5-502-build2-mixed-pen-marker-red.bplist')),c=runtime();
  const decoded=c.__INK_TO_CARD_DRAWING__.colors(raw.toString('base64'),raw.length);
  assert.equal(decoded.strokes.length,153);assert.equal(decoded.pointCount,3372);assert.equal(decoded.pathMarkers.length,23);
  assert.equal(decoded.archive.verifiedAlternative,'drawing2');
  assert.equal(decoded.strokes.filter(s=>s.color==='#000000').length,16);
  assert.equal(decoded.strokes.filter(s=>s.color==='#d35d5d').length,137);assert.equal(decoded.excludedMarkerCount,1);
  const result=analyze(raw,settings);assert.equal(result.drawing.strokeCount,153);assert.equal(result.drawing.pointCount,3372);
  assert.equal(result.drawing.excludedMarkerCount,1);
  assert.ok(result.histogram.counts.red>0);assert.equal(c.InkToCardCore.choose(result.histogram,{...settings,policy:'red'}).color,'red');
});

test('马克笔与普通笔混用覆盖32种通道和两种尾部，仅核对普通笔并统计无彩色',()=>{
  const c=runtime();
  for(let combination=0;combination<32;combination++)for(const tailLength of [12,16]){
    const layout=1|(combination&3)<<1|(combination>>2)<<5;
    const strokes=[{layout,tailLength,color:[0,0,0,1]},
      {layout,tailLength,brush:'com.apple.ink.marker',inkVariant:'linear',color:[1,0,0,0.6]}];
    const raw=handwriting(strokes),baseline=analyze(raw,settings);
    assert.equal(c.InkToCardCore.choose(baseline.histogram,{...settings,policy:'red'}).color,'uncolored');
    for(const wrapped of [raw,binaryPlist({drawing1:raw,drawing2:raw}),archivedDrawing({drawing1:raw,drawing2:raw})]){
      const d=c.__INK_TO_CARD_DRAWING__.colors(wrapped.toString('base64'),wrapped.length);
      assert.equal(d.strokes.length,1);assert.equal(d.excludedMarkerCount,1);
      assert.equal(JSON.stringify(analyze(wrapped,settings).histogram),JSON.stringify(baseline.histogram));
    }
    const pen=handwriting(strokes.map(s=>({...s,brush:'com.apple.ink.pen',inkVariant:undefined})));
    assert.throws(()=>analyze(archivedDrawing({drawing1:pen,drawing2:raw}),settings),/两个绘图版本内容不一致/);
  }
});

test('马克笔只按精确身份排除，未知参数不参与识色，其他笔刷和旧预览仍严格拒绝',()=>{
  const marker={brush:'com.apple.ink.marker',inkVariant:'linear',color:[1,0,0,0.6]};
  for(const inkVariant of [undefined,'','fixed-width','Linear','linear\0','unknown']){
    const r=analyze(handwriting([{color:[0,0,0,1]},{...marker,inkVariant}]),settings);
    assert.equal(r.drawing.strokeCount,1);assert.equal(r.drawing.excludedMarkerCount,1);assert.equal(r.histogram.colored,0);
  }
  for(const brush of ['com.apple.ink.pencil','com.apple.ink.fountainpen','com.apple.ink.eraser']){
    assert.throws(()=>analyze(handwriting([{...marker,brush}]),settings),/当前仅支持/);
  }
  const raw=handwriting([marker]),d=runtime().__INK_TO_CARD_DRAWING__;
  assert.throws(()=>d.media(raw.toString('base64'),raw.length),/当前仅支持/);
});

test('MN5.0.2双版本归档的fixed-width黑笔完整核对，配置无彩色映射后匹配',()=>{
  const raw=fs.readFileSync(path.join(__dirname,'fixtures/mn5-502-build2-fixed-width-black.bplist')),c=runtime();
  assert.equal(require('node:crypto').createHash('sha256').update(raw).digest('hex'),'df56426c350b9771666fe87e36c1f606e617500620b25356241e3207ca1659bb');
  const decoded=c.__INK_TO_CARD_DRAWING__.colors(raw.toString('base64'),raw.length);
  assert.equal(decoded.strokes.length,23);assert.equal(decoded.pointCount,396);assert.equal(decoded.pathMarkers.length,0);
  assert.ok(decoded.strokes.every(s=>s.color==='#000000'));
  assert.equal(JSON.stringify(decoded.archive),JSON.stringify({selected:'drawing1',verifiedAlternative:'drawing2'}));
  assert.equal(JSON.stringify(decoded.strokes[0].points[0]),JSON.stringify({x:833.546782206744,y:26.50574515387416,width:3.9922027587890625}));
  const result=analyze(raw,settings);assert.equal(result.histogram.colored,0);assert.ok(result.histogram.visible>7900);
  assert.equal(c.InkToCardCore.choose(result.histogram,settings).color,'uncolored');
  assert.equal(c.InkToCardCore.choose(result.histogram,{mapping:{red:3}}).status,'insufficient');
});

test('fixed-width按统一规则覆盖32种通道、两种尾部、8种笔色和5种包装，不改变笔迹及面积',()=>{
  const c=runtime(),colors=[[0,0,0,1],[1,0,0,1],[1,0.4,0,1],[1,1,0,1],[0,1,0,1],[0,1,1,1],[0,0,1,1],[0.6,0,1,0.5]];
  let checked=0;
  for(let combination=0;combination<32;combination++)for(const tailLength of [12,16])for(const color of colors){
    const stroke={layout:1|(combination&3)<<1|(combination>>2)<<5,tailLength,color,pathMarker:1};
    const regular=handwriting([stroke]),fixed=handwriting([{...stroke,inkVariant:'fixed-width'}]);
    const reference=c.__INK_TO_CARD_ANALYSIS__.analyze(regular.toString('base64'),regular.length,settings);
    const baseline=c.__INK_TO_CARD_DRAWING__.colors(regular.toString('base64'),regular.length);
    for(const raw of [fixed,binaryPlist({drawing1:fixed,drawing2:regular}),
      archivedDrawing({drawing1:regular,drawing2:fixed}),archivedDrawing({drawing1:fixed,drawing2:fixed}),archivedDrawing({drawing2:fixed})]){
      const encoded=raw.toString('base64'),decoded=c.__INK_TO_CARD_DRAWING__.colors(encoded,raw.length);
      const result=c.__INK_TO_CARD_ANALYSIS__.analyze(encoded,raw.length,settings);
      assert.equal(JSON.stringify(decoded.strokes),JSON.stringify(baseline.strokes));
      assert.equal(JSON.stringify(decoded.pathMarkers),JSON.stringify(baseline.pathMarkers));
      assert.equal(JSON.stringify(result.histogram),JSON.stringify(reference.histogram));checked++;
    }
  }
  assert.equal(checked,2560);
});

test('fixed-width归档另一表示出现未知参数、其他笔刷或内容冲突时，不使用可读表示改色',()=>{
  const ordinary=handwriting([{color:[1,0,0,1]}]);
  for(const alternative of [handwriting([{color:[1,0,0,1],inkVariant:'unknown'}]),
    handwriting([{color:[1,0,0,1],brush:'com.apple.ink.fountainpen',inkVariant:'fixed-width'}]),
    handwriting([{color:[0,0,1,1],inkVariant:'fixed-width'}]),
    handwriting([{color:[1,0,0,0.5],inkVariant:'fixed-width'}])]){
    for(const wrap of [binaryPlist,archivedDrawing]){
      assert.throws(()=>analyze(wrap({drawing1:ordinary,drawing2:alternative}),settings),/未验证的普通笔变体|两个绘图版本内容不一致/);
    }
  }
});

test('MN5 fixed-width真实样本完整保留616笔9195点及深红原色，可触发红色映射',()=>{
  const raw=fs.readFileSync(path.join(__dirname,'fixtures/mn5-500-build5-fixed-width-black-red.wrd')),c=runtime();
  const decoded=c.__INK_TO_CARD_DRAWING__.colors(raw.toString('base64'),raw.length);
  assert.equal(decoded.strokes.length,616);assert.equal(decoded.pointCount,9195);assert.equal(decoded.pathMarkers.length,294);
  assert.equal(decoded.strokes.filter(s=>s.color==='#000000').length,323);
  assert.equal(decoded.strokes.filter(s=>s.color==='#a32a00').length,293);
  assert.equal(JSON.stringify(decoded.strokes[0].points[0]),JSON.stringify({x:4.927617259323597,y:397.22687242925167,width:1.5593909048885166}));
  const last=decoded.strokes.at(-1).points.at(-1);
  assert.equal(JSON.stringify(last),JSON.stringify({x:454.10215955227613,y:653.4517851993442,width:1.5593909048885166}));
  const result=analyze(raw,settings);
  assert.equal(result.drawing.strokeCount,616);assert.equal(result.drawing.pointCount,9195);
  assert.ok(result.histogram.counts.red>12000);
  assert.equal(Object.entries(result.histogram.counts).filter(([name])=>name!=='red').reduce((sum,[,count])=>sum+count,0),0);
  const chosen=c.InkToCardCore.choose(result.histogram,{...settings,policy:'red'});
  assert.equal(chosen.status,'matched');assert.equal(chosen.color,'red');assert.equal(chosen.colorIndex,3);
});

test('无需图片或Canvas即可从真实笔色计算可见面积，保留最低量、红色和无彩色规则',()=>{
  const c=runtime();
  for(const [color,expected] of [[[1,0,0,1],'red'],[[0,0,1,1],'blue'],[[0,0,0,1],'uncolored'],[[1,1,1,1],'uncolored']]){
    const result=analyze(handwriting([{color}]),settings),chosen=c.InkToCardCore.choose(result.histogram,settings);
    assert.equal(chosen.color,expected);assert.ok(result.histogram.visible>90&&result.histogram.visible<105);
    assert.equal(result.dataURL,undefined);assert.equal(result.drawing.strokeCount,1);
  }
  for(const stroke of [{color:[1,0,0,1],width:0.1,points:[[10,20]]},{color:[1,0,0,0.1]}]){
    const result=analyze(handwriting([stroke]),settings);assert.equal(c.InkToCardCore.choose(result.histogram,settings).status,'insufficient');
  }
});

test('重叠按笔画顺序统计，后一笔不透明蓝色覆盖红色时主要色为蓝色',()=>{
  const points=[[10,20],[40,20]],c=runtime();
  for(const [first,second,expected] of [[[1,0,0,1],[0,0,1,1],'blue'],[[0,0,1,1],[1,0,0,1],'red']]){
    const r=analyze(handwriting([{color:first,points},{color:second,points}]),settings);
    assert.equal(c.InkToCardCore.choose(r.histogram,settings).color,expected);
    assert.ok(r.histogram.visible<110,'重叠面积不能按两笔简单相加');
  }
});

test('同一笔路径重走不重复叠加透明度',()=>{
  const a=analyze(handwriting([{color:[1,0,0,0.5],points:[[10,20],[40,20]]}]),settings);
  const b=analyze(handwriting([{color:[1,0,0,0.5],points:[[10,20],[40,20],[10,20],[40,20]]}]),settings);
  assert.equal(JSON.stringify(a.histogram),JSON.stringify(b.histogram));
});

test('统一通道规则覆盖32种组合及12/16字节尾部，公共笔宽位置一致且错误长度仍拒绝',()=>{
  const c=runtime();
  for(let combination=0;combination<32;combination++){
    const layout=1|(combination&3)<<1|(combination>>2)<<5;
    const regular=analyze(handwriting([{layout,color:[1,0,0,1]}]),settings);
    const extended=analyze(handwriting([{layout,tailLength:16,color:[1,0,0,1]}]),settings);
    assert.equal(JSON.stringify(regular.histogram),JSON.stringify(extended.histogram),'layout='+layout);
    assert.equal(c.InkToCardCore.choose(extended.histogram,settings).color,'red');
    assert.throws(()=>analyze(handwriting([{layout,tailLength:15}])),/通道布局/);
  }
  for(const width of [0,-1,NaN,Infinity,1001])assert.throws(()=>analyze(handwriting([{layout:131,tailLength:16,width}])),/坐标或宽度/);
  for(const layout of [0,9,257])assert.throws(()=>analyze(handwriting([{layout}])),/通道布局|点数或长度/);
});

test('全部真实回归样本直接识色保留完整笔画和点数，不经过SVG生成',()=>{
  const c=runtime();c.__INK_TO_CARD_DRAWING__.render=()=>{throw Error('不应生成SVG');};
  for(const file of fs.readdirSync(path.join(__dirname,'fixtures')).filter(n=>/\.(wrd|bplist)$/.test(n))){
    const bytes=fs.readFileSync(path.join(__dirname,'fixtures',file)),encoded=bytes.toString('base64');
    const decoded=c.__INK_TO_CARD_DRAWING__.colors(encoded,bytes.length);
    const result=c.__INK_TO_CARD_ANALYSIS__.analyze(encoded,bytes.length,settings);
    assert.equal(result.drawing.strokeCount,decoded.strokes.length,file);assert.equal(result.drawing.pointCount,decoded.pointCount,file);
    assert.ok(result.histogram.visible>0||(!decoded.strokes.length&&decoded.excludedMarkerCount>0),file);
    assert.ok(result.histogram.colored<=result.histogram.visible+1e-6,file);
    assert.ok(result.histogram.pixels<=1048576,file);assert.equal(result.dataURL,undefined);
  }
});

test('未知笔刷、越界路径标记、截断和无效坐标不返回部分颜色统计',()=>{
  for(const raw of [handwriting([{brush:'unknown'}]),handwriting([{pathMarker:2}]),handwriting().subarray(0,40),handwriting([{points:[[NaN,1]]}])])
    assert.throws(()=>analyze(raw));
});

test('异常的大跨度路径达到分析上限时明确拒绝，不返回部分颜色结果',()=>{
  const points=Array.from({length:60},(_,i)=>i%2?[1000,1000]:[0,0]);
  assert.throws(()=>analyze(handwriting([{color:[1,0,0,1],points}]),settings),/分析量过大/);
});

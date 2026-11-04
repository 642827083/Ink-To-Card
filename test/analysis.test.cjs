const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {handwriting}=require('./helpers/handwriting.cjs');
function runtime(){
  const context=vm.createContext({});
  for(const name of ['InkToCardConfig','InkToCardCore','InkToCardDrawing','InkToCardAnalysis'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),context);
  return context;
}
function analyze(raw,settings={}){
  const c=runtime();return c.__INK_TO_CARD_ANALYSIS__.analyze(raw.toString('base64'),raw.length,settings);
}
const settings={mapping:{red:3,blue:2,uncolored:7}};

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
    assert.ok(result.histogram.visible>0,file);assert.ok(result.histogram.colored<=result.histogram.visible+1e-6,file);
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

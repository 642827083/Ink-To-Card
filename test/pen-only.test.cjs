const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {handwriting,combineDrawings}=require('./helpers/handwriting.cjs');
const {binaryPlist,archivedDrawing}=require('./helpers/archive.cjs');
function runtime(){
  const c=vm.createContext({});
  for(const name of ['InkToCardConfig','InkToCardCore','InkToCardDrawing','InkToCardAnalysis'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/'+name+'.js'),'utf8'),c);
  return c;
}
const options={policy:'red',mapping:{red:3,blue:2,uncolored:7}};
function analyze(c,raw){return c.__INK_TO_CARD_ANALYSIS__.analyze(raw.toString('base64'),raw.length,options);}
const marker={brush:'com.apple.ink.marker',inkVariant:'linear',color:[1,0,0,0.6]};

test('普通笔与马克笔重叠时，马克笔的颜色、透明度、宽度和顺序均不改变普通笔统计',()=>{
  const c=runtime(),pen={color:[0,0,1,1],points:[[10,20],[40,20]]},expected=analyze(c,handwriting([pen]));
  for(const inkVariant of [undefined,'linear','unknown','fixed-width'])for(const alpha of [0,0.6,1])for(const order of [0,1]){
    const excluded={...marker,inkVariant,color:[1,0,0,alpha],width:40,points:pen.points};
    const raw=handwriting(order?[pen,excluded]:[excluded,pen]),result=analyze(c,raw);
    assert.equal(result.drawing.strokeCount,1);assert.equal(result.drawing.excludedMarkerCount,1);
    assert.equal(JSON.stringify(result.histogram),JSON.stringify(expected.histogram));
    assert.equal(c.InkToCardCore.choose(result.histogram,options).status,'insufficient');
    assert.equal(c.InkToCardCore.choose(result.histogram,{...options,policy:'dominant'}).color,'blue');
  }
});

test('黑色普通笔加彩色马克笔仍按普通笔无彩色规则，彩色普通笔仍阻止无彩色兜底',()=>{
  const c=runtime(),raw=handwriting([{color:[0,0,0,1]},marker]),r=analyze(c,raw);
  assert.equal(r.histogram.colored,0);assert.equal(c.InkToCardCore.drawingHasColor(r.drawing,options),false);
  assert.equal(c.InkToCardCore.choose(r.histogram,options).color,'uncolored');
  const tiny=analyze(c,handwriting([{color:[1,0,0,1],width:0.01,points:[[10,20]]},{color:[0,0,0,1]},marker]));
  assert.equal(c.InkToCardCore.drawingHasColor(tiny.drawing,options),true);
});

test('只有马克笔时含MN5.1新布局也不读取点数据，返回空普通笔结果且不能匹配无彩色',()=>{
  const c=runtime(),actual=fs.readFileSync(path.join(__dirname,'fixtures/mn5-510-build7-marker-only.wrd'));
  for(const raw of [actual,handwriting([marker]),binaryPlist({drawing1:actual}),archivedDrawing({drawing1:actual,drawing2:actual})]){
    const r=analyze(c,raw);assert.equal(r.drawing.strokeCount,0);assert.equal(r.drawing.pointCount,0);assert.equal(r.drawing.excludedMarkerCount,1);
    assert.equal(r.histogram.visible,0);assert.equal(r.histogram.colored,0);
    assert.equal(c.InkToCardCore.choose(r.histogram,options).status,'insufficient');
  }
});

test('马克笔的未知布局和无效坐标不阻断普通笔，普通笔相同问题仍拒绝',()=>{
  const c=runtime(),pen={color:[0,0,1,1]},reference=analyze(c,handwriting([pen]));
  for(const change of [{layout:495},{points:[[NaN,NaN]]},{width:0},{pathMarker:999},{extraStroke:Buffer.from([0x82,1,16,...Array(16).fill(0)])}]){
    const raw=handwriting([{...marker,...change},pen]),r=analyze(c,raw);
    assert.equal(JSON.stringify(r.histogram),JSON.stringify(reference.histogram));
    assert.throws(()=>analyze(c,handwriting([{...pen,...change},marker])));
  }
  assert.throws(()=>analyze(c,handwriting([{brush:'com.apple.ink.pencil'},pen])),/当前仅支持/);
});

test('MN5.1真实26字节马克笔与普通笔组合后，直接及归档均只使用普通笔统计',()=>{
  const c=runtime(),marker=fs.readFileSync(path.join(__dirname,'fixtures/mn5-510-build7-marker-only.wrd'));
  const pen=handwriting([{color:[1,0,0,1],pathMarker:1}]),reference=analyze(c,pen);
  for(const raw of [combineDrawings(pen,marker),combineDrawings(marker,pen)]){
    for(const wrapped of [raw,binaryPlist({drawing1:raw,drawing2:pen}),archivedDrawing({drawing1:raw,drawing2:raw})]){
      const r=analyze(c,wrapped);assert.equal(r.drawing.strokeCount,1);assert.equal(r.drawing.pointCount,2);
      assert.equal(r.drawing.excludedMarkerCount,1);assert.equal(JSON.stringify(r.histogram),JSON.stringify(reference.histogram));
      assert.equal(c.InkToCardCore.choose(r.histogram,options).color,'red');
    }
  }
});

test('归档按排除后的普通笔核对，马克笔差异可忽略，普通笔颜色、笔宽和缺失仍拒绝',()=>{
  const c=runtime(),pen={color:[0,0,1,1],points:[[10,20],[40,20]],pathMarker:1},regular=handwriting([pen]);
  const mixed=handwriting([marker,pen]),otherMarker=handwriting([pen,{...marker,layout:495}]);
  for(const wrap of [binaryPlist,archivedDrawing]){
    for(const alternative of [regular,otherMarker]){
      const raw=wrap({drawing1:mixed,drawing2:alternative});
      assert.equal(JSON.stringify(analyze(c,raw).histogram),JSON.stringify(analyze(c,regular).histogram));
    }
    for(const changed of [handwriting([{color:[1,0,0,1]}]),handwriting([{...pen,width:4}]),handwriting([marker])]){
      assert.throws(()=>analyze(c,wrap({drawing1:mixed,drawing2:changed})),/两个绘图版本内容不一致/);
    }
  }
});

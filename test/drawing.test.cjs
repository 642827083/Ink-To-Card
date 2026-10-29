const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
function decoder(){const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/InkToCardDrawing.js'),'utf8'),context);return context.__INK_TO_CARD_DRAWING__;}
const fixture=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-drawing.wrd'));
function vint(value){const bytes=[];do{let part=value%128;value=Math.floor(value/128);bytes.push(part+(value?128:0));}while(value);return Buffer.from(bytes);}
function field(number,wire,value){let body=wire===0?vint(value):wire===2?Buffer.concat([vint(value.length),value]):value;return Buffer.concat([vint(number*8+wire),body]);}
function float(number,value){const bytes=Buffer.alloc(4);bytes.writeFloatLE(value);return field(number,5,bytes);}
function minimal(options={}){
  const color=Buffer.concat([float(1,1),float(2,0),float(3,0),float(4,options.alpha??1)]);
  const ink=Buffer.concat([field(1,2,color),field(2,2,Buffer.from(options.brush??'com.apple.ink.pen')),field(3,0,3)]);
  const coordinates=options.points??[[options.x??10,20,3]];
  const sharedLayouts={3:[12,22],131:[14,20],195:[16,18]},shared=sharedLayouts[options.layout],compact=!!shared;
  const common=Buffer.alloc(options.commonSize??(compact?shared[1]:16));
  if(compact)common.writeFloatLE(coordinates[0][2]);
  const points=Buffer.concat(coordinates.map(([x,y,width])=>{const p=Buffer.alloc(options.stride??(compact?shared[0]:18));p.writeFloatLE(x);p.writeFloatLE(y,4);if(!compact)p.writeFloatLE(width,12);if(options.pointTail!==undefined)p.writeUInt32LE(options.pointTail,12);return p;}));
  const pathBytes=Buffer.concat([field(3,0,coordinates.length),field(4,0,options.layout??39),field(6,2,common),field(7,2,points),...(options.extraPath?[options.extraPath]:[])]);
  const transform=Buffer.concat([float(1,1),float(2,0),float(3,0),float(4,1),float(5,0),float(6,0)]);
  const stroke=Buffer.concat([field(4,0,options.inkIndex??0),field(5,2,pathBytes),field(7,2,transform),...(options.extraStroke?[options.extraStroke]:[])]);
  return Buffer.concat([Buffer.from('wrd'),field(4,2,ink),field(5,2,stroke)]);
}
function read(raw){const d=decoder();return d.decode(d.decodeBase64(raw.toString('base64'),raw.length));}
function lineFields(identifier=Buffer.from('e209bea639ed4363be7a253677d40e68','hex'),kind=6){return Buffer.concat([field(13,2,identifier),field(14,0,kind)]);}

function pairedCurve(vertices=17){
  const points=[];
  for(let i=0;i<vertices;i++){
    const point=[10+i,20+i*i/10,3];points.push(point);
    if(i>0&&i<vertices-1)points.push([...point]);
  }
  return points;
}

test('MN4.4.6旧公共头样本保留8条深棕笔画、169个点和原始笔宽',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-446-build3-brown.wrd')),d=decoder(),result=read(raw);
  assert.equal(result.strokes.length,8);assert.equal(result.pointCount,169);
  assert.ok(result.strokes.every(stroke=>stroke.color==='#3b272d'));
  const widths=result.strokes[0].points.map(point=>point.width);
  assert.ok(Math.abs(Math.min(...widths)-9.897571914421462)<0.000001);
  assert.ok(Math.abs(Math.max(...widths)-10.647353985458437)<0.000001);
  const media=d.media(raw.toString('base64'),raw.length),preview=d.preview(raw.toString('base64'),raw.length);
  assert.equal(media.drawing.previewOnly,undefined);assert.equal(media.dataURL,preview.dataURL);
  assert.equal(media.drawing.pathMarkers.length,6);
  assert.equal((decodeURIComponent(media.dataURL.split(',')[1]).match(/<polyline /g)||[]).length,8);
});

test('旧公共头仅用于已验证的逐点笔宽布局，新旧格式保留同一坐标与宽度',()=>{
  const points=[[10,20,3],[14,25,4]];
  for(const [layout,stride,oldSize,newSize] of [[39,18,14,16],[103,20,12,14],[167,20,12,14],[231,22,10,12]]){
    const older=read(minimal({layout,stride,commonSize:oldSize,points}));
    const newer=read(minimal({layout,stride,commonSize:newSize,points}));
    assert.equal(JSON.stringify(older.strokes),JSON.stringify(newer.strokes));
    assert.equal(JSON.stringify(older.strokes[0].points),JSON.stringify([{x:10,y:20,width:3},{x:14,y:25,width:4}]));
  }
  for(const options of [{layout:39,commonSize:13},{layout:39,commonSize:15},{layout:39,commonSize:17},
    {layout:195,commonSize:16},{layout:131,commonSize:18},{layout:39,commonSize:14,stride:20}]){
    assert.throws(()=>read(minimal({...options,points})),/通道布局/);
  }
});

test('布局195真实样本保留92条黑笔、2596个点和公共笔宽',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build64-layout195-black.wrd')),d=decoder(),result=read(raw);
  assert.equal(result.strokes.length,92);assert.equal(result.pointCount,2596);
  assert.ok(result.strokes.every(s=>s.color==='#000000'));
  assert.equal(result.strokes[26].points.length,2);
  for(const point of result.strokes[26].points)assert.ok(Math.abs(point.width-3.4660746322260536)<0.000001);
  const media=d.media(raw.toString('base64'),raw.length),preview=d.preview(raw.toString('base64'),raw.length);
  assert.equal(media.drawing.previewOnly,undefined);assert.equal(media.dataURL,preview.dataURL);
  assert.equal((decodeURIComponent(media.dataURL.split(',')[1]).match(/<(?:circle|polyline) /g)||[]).length,92);
});

test('布局195的16字节点从公共头取宽，不把末尾通道误读成浮点笔宽',()=>{
  const raw=minimal({layout:195,points:[[10,20,3.125],[14,25,3.125]],pointTail:0x7fc00000}),result=read(raw);
  assert.equal(JSON.stringify(result.strokes[0].points),JSON.stringify([{x:10,y:20,width:3.125},{x:14,y:25,width:3.125}]));
});

test('布局195仍拒绝错误长度、异常公共笔宽和越界路径标记',()=>{
  for(const options of [{commonSize:17},{commonSize:19},{stride:14},{stride:18},
    {points:[[10,20,0]]},{points:[[10,20,NaN]]},{points:[[10,20,1001]]},{extraPath:field(9,0,2)}]){
    assert.throws(()=>read(minimal({layout:195,points:[[10,20,3],[14,25,3]],...options})),/通道布局|坐标或宽度|未验证标记/);
  }
});

test('build64布局131真实样本完整解析61条蓝笔、1436个点，保留两点短笔画',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build64-layout131-blue.wrd')),d=decoder(),result=read(raw);
  assert.equal(result.strokes.length,61);assert.equal(result.pointCount,1436);
  assert.ok(result.strokes.every(s=>s.color==='#2e68b5'));
  assert.equal(result.strokes[49].points.length,2);
  for(const point of result.strokes[49].points)assert.ok(Math.abs(point.width-8.462158622826678)<0.000001);
  const media=d.media(raw.toString('base64'),raw.length),preview=d.preview(raw.toString('base64'),raw.length);
  assert.equal(media.drawing.previewOnly,undefined);assert.equal(media.dataURL,preview.dataURL);
  assert.equal((decodeURIComponent(media.dataURL.split(',')[1]).match(/<(?:circle|polyline) /g)||[]).length,61);
});

test('布局131从公共头读取笔宽，不把点尾通道作为宽度',()=>{
  const points=[[10,20,3.125],[14,25,3.125]],result=read(minimal({layout:131,points}));
  assert.equal(result.pointCount,2);
  assert.equal(JSON.stringify(result.strokes[0].points),JSON.stringify([{x:10,y:20,width:3.125},{x:14,y:25,width:3.125}]));
});

test('布局131仍拒绝错误长度、无效宽度和越界路径标记',()=>{
  for(const options of [{commonSize:19},{commonSize:21},{stride:12},{stride:16},
    {points:[[10,20,0],[14,25,0]]},{points:[[10,20,NaN],[14,25,NaN]]},{extraPath:field(9,0,2)}]){
    assert.throws(()=>read(minimal({layout:131,points:[[10,20,3],[14,25,3]],...options})),/通道布局|坐标或宽度|未验证标记/);
  }
});

test('build64图形曲线样本保留70条黑笔、1602个点和两条非共线图形',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build64-marked-curves.wrd')),d=decoder(),result=read(raw);
  assert.equal(result.strokes.length,70);assert.equal(result.pointCount,1602);
  assert.ok(result.strokes.every(s=>s.color==='#000000'));
  for(const index of [32,33]){
    const path=result.strokes[index].points,first=path[0],last=path.at(-1),dx=last.x-first.x,dy=last.y-first.y;
    assert.equal(path.length,32);assert.ok(path.every(p=>p.width===first.width));
    assert.ok(Math.max(...path.map(p=>Math.abs(dx*(p.y-first.y)-dy*(p.x-first.x))/Math.hypot(dx,dy)))>10);
  }
  const strict=d.media(raw.toString('base64'),raw.length),preview=d.preview(raw.toString('base64'),raw.length);
  assert.equal(strict.drawing.previewOnly,undefined);assert.equal(strict.dataURL,preview.dataURL);
  assert.equal((decodeURIComponent(strict.dataURL.split(',')[1]).match(/<(?:circle|polyline) /g)||[]).length,70);
});

test('图形曲线按已有配对控制点原样渲染，不拉直、不删点',()=>{
  const points=pairedCurve(),raw=minimal({layout:3,points,extraStroke:lineFields()}),result=read(raw);
  assert.equal(result.pointCount,32);
  result.strokes[0].points.forEach((p,i)=>{
    assert.equal(p.x,points[i][0]);assert.ok(Math.abs(p.y-points[i][1])<0.00001);assert.equal(p.width,3);
  });
});

test('图形曲线不要求32点或重复点，不同通道组合仍完整保留原路径',()=>{
  const broken=pairedCurve();broken[2][1]+=1;
  for(const options of [{layout:39,points:pairedCurve()},{layout:3,points:pairedCurve(16)},
    {layout:3,points:pairedCurve(18)},{layout:3,points:broken}]){
    const result=read(minimal({...options,extraStroke:lineFields()}));
    assert.equal(result.pointCount,options.points.length);
    result.strokes[0].points.forEach((point,index)=>{
      assert.equal(point.x,options.points[index][0]);assert.ok(Math.abs(point.y-options.points[index][1])<0.0001);assert.equal(point.width,3);
    });
  }
});

function singlePoint(options={}){
  const color=Buffer.concat([float(1,1),float(2,0),float(3,0),float(4,1)]);
  const ink=Buffer.concat([field(1,2,color),field(2,2,Buffer.from('com.apple.ink.pen')),field(3,0,3)]);
  const common=Buffer.alloc(options.commonSize??26);common.writeFloatLE(options.width??3.25,4);
  const raw=Buffer.alloc(options.rawSize??8);raw.writeFloatLE(options.x??10);raw.writeFloatLE(20,4);
  const points=Buffer.concat([field(3,0,options.count??1),field(4,0,options.flags??1),field(6,2,common),field(7,2,raw),field(9,0,options.marker??0)]);
  const transform=Buffer.concat([1,0,0,1,0,0].map((value,index)=>float(index+1,value)));
  const stroke=Buffer.concat([field(4,0,0),field(5,2,points),field(7,2,transform)]);
  return Buffer.concat([Buffer.from('wrd'),field(4,2,ink),field(5,2,stroke)]);
}

test('build64真实样本完整解析621条笔画，保留5条单点笔画及三种笔色',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build64-single-point.wrd')),d=decoder(),result=read(raw);
  assert.equal(result.strokes.length,621);assert.equal(result.pointCount,11447);
  for(const [color,count] of [['#000000',566],['#fd2f43',34],['#2e68b5',21]])assert.equal(result.strokes.filter(s=>s.color===color).length,count);
  for(const index of [184,379,380,381,382]){
    assert.equal(result.strokes[index].points.length,1);
    assert.equal(result.strokes[index].color,'#000000');
    assert.ok(result.strokes[index].points[0].width>0);
  }
  const media=d.media(raw.toString('base64'),raw.length),preview=d.preview(raw.toString('base64'),raw.length);
  assert.equal(media.drawing.previewOnly,undefined);assert.equal(media.dataURL,preview.dataURL);
  const svg=decodeURIComponent(media.dataURL.split(',')[1]);
  assert.equal((svg.match(/<(?:circle|polyline) /g)||[]).length,621);
  assert.ok(!svg.includes('NaN'));
});

test('单点布局从公共头第4字节读取笔宽，坐标、颜色和圆点半径正确',()=>{
  const raw=singlePoint(),d=decoder(),result=read(raw),point=result.strokes[0].points[0];
  assert.deepEqual({x:point.x,y:point.y,width:point.width},{x:10,y:20,width:3.25});
  assert.equal(result.strokes[0].color,'#ff0000');
  assert.match(decodeURIComponent(d.media(raw.toString('base64'),raw.length).dataURL.split(',')[1]),/<circle cx="10" cy="20" r="1.625" fill="#ff0000"/);
});

test('坐标通道支持多点，长度、笔宽、坐标和越界标记仍检查',()=>{
  const d=decoder();
  assert.equal(read(singlePoint({count:2,rawSize:16})).pointCount,2);
  for(const options of [{commonSize:25},{commonSize:27},{rawSize:9},{flags:2},
    {width:0},{width:-1},{width:NaN},{width:1001},{x:NaN},{marker:1}]){
    const raw=singlePoint(options);
    assert.throws(()=>d.media(raw.toString('base64'),raw.length),/通道布局|点数或长度|坐标或宽度|未验证标记/);
  }
});

test('新增真机样本的直线附加字段保留全部88条笔画及红色取反笔迹',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-drawing-field13.wrd')),result=read(raw);
  assert.equal(result.strokes.length,88);assert.equal(result.pointCount,1970);
  assert.equal(result.strokes.filter(s=>s.color==='#000000').length,84);
  assert.equal(result.strokes.filter(s=>s.color==='#fd2f43').length,4);
  for(const index of [32,58]) {
    const p=result.strokes[index].points;
    assert.ok(p.at(-1).x-p[0].x>850);
    assert.ok(p.every(point=>Math.abs(point.y-p[0].y)<0.0001));
  }
  assert.equal((decodeURIComponent(decoder().render(result).dataURL.split(',')[1]).match(/<polyline /g)||[]).length,88);
});

test('最小直线路径带13/14字段时不丢失坐标、宽度或颜色',()=>{
  const result=read(minimal({points:[[10,20,3],[20,30,3],[30,40,3]],extraStroke:lineFields()}));
  assert.equal(JSON.stringify(result.strokes[0].points),JSON.stringify([{x:10,y:20,width:3},{x:20,y:30,width:3},{x:30,y:40,width:3}]));
  assert.equal(result.strokes[0].color,'#ff0000');
});

test('图形标记须成对且值有效，不再要求直线或等宽、首尾不重合',()=>{
  const base={points:[[10,20,3],[30,20,3]]};
  for(const extraStroke of [field(13,2,Buffer.alloc(16)),field(14,0,6),lineFields(Buffer.alloc(15)),lineFields(Buffer.alloc(16),7),Buffer.concat([lineFields(),field(14,0,6)])]) {
    assert.throws(()=>read(minimal({...base,extraStroke})),/字段|图形标记/);
  }
  for(const points of [[[10,20,3]],[[10,20,3],[20,25,3],[30,20,3]],[[10,20,3],[30,20,4]],[[10,20,3],[10,20,3]]]) {
    const result=read(minimal({points,extraStroke:lineFields()}));
    assert.equal(JSON.stringify(result.strokes[0].points),JSON.stringify(points.map(([x,y,width])=>({x,y,width}))));
  }
  assert.throws(()=>read(minimal({...base,extraStroke:Buffer.concat([lineFields(),field(9,2,Buffer.from([1]))])})),/未验证字段 9/);
});

test('原始真机归档还原150条笔画、2899个点，黑73条、红77条',()=>{
  const d=decoder(), result=d.decode(d.decodeBase64(fixture.toString('base64'),fixture.length));
  assert.equal(result.strokes.length,150);assert.equal(result.pointCount,2899);
  assert.equal(result.strokes.filter(s=>s.color==='#000000').length,73);
  assert.equal(result.strokes.filter(s=>s.color==='#fd2f43').length,77);
  const svg=decodeURIComponent(d.render(result).dataURL.split(',')[1]);
  assert.equal((svg.match(/<polyline /g)||[]).length,150);
  assert.match(svg,/width="1024" height="605"/);
  assert.ok(!svg.includes('NaN'));assert.ok(!svg.includes('com.apple'));
});
test('最小单笔数据正确还原坐标、笔宽和笔色，能生成圆点预览',()=>{
  const d=decoder(), result=read(minimal());
  assert.equal(result.strokes.length,1);const point=result.strokes[0].points[0];
  assert.deepEqual({x:point.x,y:point.y,width:point.width},{x:10,y:20,width:3});
  assert.match(decodeURIComponent(d.render(result).dataURL.split(',')[1]),/<circle .*fill="#ff0000"/);
});
test('未知笔刷、遮罩和路径标记明确拒绝，不能以部分笔迹继续识别',()=>{
  assert.throws(()=>read(minimal({brush:'com.apple.ink.marker'})),/当前仅支持普通笔/);
  assert.throws(()=>read(minimal({extraStroke:field(9,2,Buffer.from([1]))})),/未验证字段 9/);
  assert.throws(()=>read(minimal({extraPath:field(9,0,1)})),/未验证标记/);
  assert.throws(()=>read(minimal({extraPath:field(10,2,Buffer.from([1]))})),/未验证字段 10/);
});
test('截断、异常坐标、颜色范围和错误笔色引用拒绝解析',()=>{
  const raw=minimal();
  assert.throws(()=>read(raw.subarray(0,raw.length-1)),/截断/);
  assert.throws(()=>read(minimal({x:NaN})),/坐标或宽度/);
  assert.throws(()=>read(minimal({alpha:2})),/笔色范围/);
  assert.throws(()=>read(minimal({inkIndex:1})),/笔色不存在/);
});
test('编码字节数与样本声明不一致、无标记或整数溢出拒绝解析',()=>{
  const d=decoder(), raw=minimal();
  assert.throws(()=>d.media(raw.toString('base64'),raw.length+5),/长度无效/);
  assert.throws(()=>d.media('d3Jk====',4),/长度无效/);
  assert.throws(()=>read(Buffer.concat([Buffer.from('wrd'),Buffer.alloc(10,128)])),/整数/);
  assert.throws(()=>read(Buffer.from('invalid')),/wrd 标记/);
});


test('已核对布局使此前两份build62样本可识别，完整笔画与预览保持一致',()=>{
  const d=decoder();
  for(const [file,points,marker,colors] of [
    ['mn4-450-build62-path9-black-red.wrd',215,157,['#000000','#fd2f43']],
    ['mn4-450-build62-path9-red.wrd',266,224,['#fd2f43']]
  ]){
    const raw=fs.readFileSync(path.resolve(__dirname,'fixtures',file));
    const strict=d.media(raw.toString('base64'),raw.length);
    const preview=d.preview(raw.toString('base64'),raw.length);
    assert.equal(preview.drawing.previewOnly,undefined);assert.equal(preview.drawing.strokeCount,2);assert.equal(preview.drawing.pointCount,points);
    assert.equal(JSON.stringify(preview.drawing.colors),JSON.stringify(colors));
    assert.equal(JSON.stringify(preview.drawing.pathMarkers),JSON.stringify([{strokeIndex:0,value:marker}]));
    const svg=decodeURIComponent(preview.dataURL.split(',')[1]);
    assert.equal((svg.match(/<polyline /g)||[]).length,2);
    assert.ok(!svg.includes('NaN'));assert.equal(strict.dataURL,preview.dataURL);
  }
});

test('试验预览只放宽路径字段9，其余未知字段、笔刷、遮罩和损坏数据仍拒绝',()=>{
  const d=decoder();
  const allowed=minimal({extraPath:field(9,0,1)});
  assert.equal(d.preview(allowed.toString('base64'),allowed.length).drawing.previewOnly,true);
  for(const raw of [minimal({brush:'unknown'}),minimal({extraPath:field(10,2,Buffer.from([1]))}),
    minimal({extraStroke:field(9,2,Buffer.from([1]))}),minimal({extraPath:Buffer.concat([field(9,0,1),field(9,0,2)])}),allowed.subarray(0,allowed.length-1)])
    assert.throws(()=>d.preview(raw.toString('base64'),raw.length));
  assert.equal(d.preview(fixture.toString('base64'),fixture.length).drawing.previewOnly,undefined);
});


test('用户核对正确的94笔样本通过识别解析，保留全部27个非零路径标记与笔色',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-450-build62-path9-94-strokes.wrd')),d=decoder();
  const strict=d.media(raw.toString('base64'),raw.length),preview=d.preview(raw.toString('base64'),raw.length);
  assert.equal(strict.drawing.strokeCount,94);assert.equal(strict.drawing.pointCount,1937);
  assert.equal(strict.drawing.previewOnly,undefined);assert.equal(strict.drawing.pathMarkers.length,27);
  assert.equal(JSON.stringify(strict.drawing.colors),JSON.stringify(['#000000','#fd2f43']));
  assert.equal(strict.dataURL,preview.dataURL,'开放识别不应改变已核对的预览');
  assert.equal((decodeURIComponent(strict.dataURL.split(',')[1]).match(/<polyline /g)||[]).length,94);
});


test('路径标记不限制通道组合，重复字段与超界值仍不用于识别',()=>{
  const d=decoder(),{handwriting}=require('./helpers/handwriting.cjs');
  const valid=handwriting([{pathMarker:1}]);assert.equal(d.media(valid.toString('base64'),valid.length).drawing.previewOnly,undefined);
  const sharedWidth=handwriting([{pathMarker:1,layout:3}]);
  assert.equal(d.media(sharedWidth.toString('base64'),sharedWidth.length).drawing.previewOnly,undefined);
  assert.equal(d.preview(sharedWidth.toString('base64'),sharedWidth.length).drawing.previewOnly,undefined);
  for(const marker of [2,3,999999]){
    const raw=handwriting([{pathMarker:marker}]);assert.throws(()=>d.media(raw.toString('base64'),raw.length),/未验证标记/);
  }
  const repeated=minimal({points:[[10,20,3],[40,20,3]],extraPath:Buffer.concat([field(9,0,1),field(9,0,1)])});
  assert.throws(()=>d.media(repeated.toString('base64'),repeated.length),/重复/);
});

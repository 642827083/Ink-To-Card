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
  const points=Buffer.concat(coordinates.map(([x,y,width])=>{const p=Buffer.alloc(18);p.writeFloatLE(x);p.writeFloatLE(y,4);p.writeFloatLE(width,12);return p;}));
  const pathBytes=Buffer.concat([field(3,0,coordinates.length),field(4,0,39),field(6,2,Buffer.alloc(16)),field(7,2,points),...(options.extraPath?[options.extraPath]:[])]);
  const transform=Buffer.concat([float(1,1),float(2,0),float(3,0),float(4,1),float(5,0),float(6,0)]);
  const stroke=Buffer.concat([field(4,0,options.inkIndex??0),field(5,2,pathBytes),field(7,2,transform),...(options.extraStroke?[options.extraStroke]:[])]);
  return Buffer.concat([Buffer.from('wrd'),field(4,2,ink),field(5,2,stroke)]);
}
function read(raw){const d=decoder();return d.decode(d.decodeBase64(raw.toString('base64'),raw.length));}
function lineFields(identifier=Buffer.from('e209bea639ed4363be7a253677d40e68','hex'),kind=6){return Buffer.concat([field(13,2,identifier),field(14,0,kind)]);}

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

test('直线附加字段缺失、重复、值变化或路径不同仍拒绝识别',()=>{
  const base={points:[[10,20,3],[30,20,3]]};
  for(const extraStroke of [field(13,2,Buffer.alloc(16)),field(14,0,6),lineFields(Buffer.alloc(15)),lineFields(Buffer.alloc(16),7),Buffer.concat([lineFields(),field(14,0,6)])]) {
    assert.throws(()=>read(minimal({...base,extraStroke})),/字段|直线标记/);
  }
  for(const points of [[[10,20,3]],[[10,20,3],[20,25,3],[30,20,3]],[[10,20,3],[30,20,4]],[[10,20,3],[10,20,3]]]) {
    assert.throws(()=>read(minimal({points,extraStroke:lineFields()})),/直线路径/);
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


test('路径标记仅对已核对布局和范围开放，重复字段与超界值仍不用于识别',()=>{
  const d=decoder(),{handwriting}=require('./helpers/handwriting.cjs');
  const valid=handwriting([{pathMarker:1}]);assert.equal(d.media(valid.toString('base64'),valid.length).drawing.previewOnly,undefined);
  const unknownLayout=handwriting([{pathMarker:1,layout:3}]);
  assert.throws(()=>d.media(unknownLayout.toString('base64'),unknownLayout.length),/未验证标记/);
  assert.equal(d.preview(unknownLayout.toString('base64'),unknownLayout.length).drawing.previewOnly,true);
  for(const marker of [2,3,999999]){
    const raw=handwriting([{pathMarker:marker}]);assert.throws(()=>d.media(raw.toString('base64'),raw.length),/未验证标记/);
  }
  const repeated=minimal({points:[[10,20,3],[40,20,3]],extraPath:Buffer.concat([field(9,0,1),field(9,0,1)])});
  assert.throws(()=>d.media(repeated.toString('base64'),repeated.length),/重复/);
});

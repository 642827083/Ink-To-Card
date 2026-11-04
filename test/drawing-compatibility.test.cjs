const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {binaryPlist,archiveObject,archivedDrawing}=require('./helpers/archive.cjs');
const {handwriting}=require('./helpers/handwriting.cjs');
function decoder(){const c=vm.createContext({});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/InkToCardDrawing.js'),'utf8'),c);return c.__INK_TO_CARD_DRAWING__;}
function media(raw,preview=false){return decoder()[preview?'preview':'media'](raw.toString('base64'),raw.length);}
function varint(n){const result=[];do{const b=n%128;n=Math.floor(n/128);result.push(b+(n?128:0));}while(n);return Buffer.from(result);}
function field(n,w,v){return Buffer.concat([varint(n*8+w),w===2?Buffer.concat([varint(v.length),v]):w===0?varint(v):v]);}
function float(n,v){const b=Buffer.alloc(4);b.writeFloatLE(v);return field(n,5,b);}

// 按完整通道序列分别写入逐点值或公共值，预期结果由输入坐标给出。
function channels(flags,legacy=false,extra={}){
  const definitions=[[1,8],[2,4],[4,4],[32,2],[64,2],[128,2]];
  const points=[[10,20,3],[30,24,3],[12,40,3]],packed=[],shared=[];
  for(let p=0;p<points.length;p++){
    const records=[];
    for(const [bit,size] of definitions){
      const bytes=Buffer.alloc(size);
      if(bit===1){bytes.writeFloatLE(points[p][0]);bytes.writeFloatLE(points[p][1],4);}
      else if(bit===4)bytes.writeFloatLE(points[p][2]);
      else if(size===4)bytes.writeFloatLE(bit===2?0.1:1);
      else bytes.writeUInt16LE(0x7fc0);
      if(flags&bit)records.push(bytes);else if(p===0)shared.push(bytes);
    }
    packed.push(Buffer.concat(records));
  }
  const ink=Buffer.concat([field(1,2,Buffer.concat([1,0,0,1].map((v,i)=>float(i+1,v)))),field(2,2,Buffer.from('com.apple.ink.pen')),field(3,0,3)]);
  const raw=Buffer.concat(packed),common=Buffer.concat([...shared,Buffer.alloc(legacy?10:12)]);
  const inkPath=Buffer.concat([field(3,0,3),field(4,0,flags),field(6,2,extra.common??common),field(7,2,extra.raw??raw),field(9,0,extra.marker??1)]);
  const stroke=Buffer.concat([field(4,0,0),field(5,2,inkPath),field(7,2,Buffer.concat([1,0,0,1,0,0].map((v,i)=>float(i+1,v))))]);
  return Buffer.concat([Buffer.from('wrd'),field(4,2,ink),field(5,2,stroke)]);
}

test('MN5 build5真实20字节公共头保留3条红笔199点及变换后的坐标和笔宽',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn5-500-build5-common20-red.wrd')),d=decoder();
  assert.equal(raw.length,4208);
  assert.equal(require('node:crypto').createHash('sha256').update(raw).digest('hex'),'1fff268a5d37d7ed57721e8626b1709e8761258697dedebaee6b198b906016f0');
  const result=d.decode(d.decodeBase64(raw.toString('base64'),raw.length));
  assert.equal(result.strokes.length,3);assert.equal(result.pointCount,199);
  assert.deepEqual(Array.from(result.strokes,s=>s.points.length),[78,80,41]);
  assert.ok(result.strokes.every(s=>s.color==='#fd2f43'&&s.alpha===1));
  const first=result.strokes[0].points[0],last=result.strokes[2].points.at(-1);
  for(const [actual,expected]of [[first.x,120.20336537063122],[first.y,110.40354244410992],[first.width,14.923453620279759],
    [last.x,1014.4736187756062],[last.y,307.8398321568966],[last.width,12.581710519233411]])assert.ok(Math.abs(actual-expected)<0.000001);
  const strict=media(raw),preview=media(raw,true);
  assert.equal(strict.dataURL,preview.dataURL);assert.equal(strict.drawing.previewOnly,undefined);
  assert.deepEqual(Array.from(strict.drawing.colors),['#fd2f43']);
  assert.equal((decodeURIComponent(strict.dataURL.split(',')[1]).match(/<polyline /g)||[]).length,3);
});

test('20字节公共头仅用于已核对的布局39，不改变逐点坐标与笔宽，也不放开其他组合',()=>{
  const regular=media(channels(39)).dataURL;
  assert.equal(media(channels(39,false,{common:Buffer.alloc(20,0xff)})).dataURL,regular);
  for(const length of [13,15,17,18,19,21,22,24,26])assert.throws(()=>media(channels(39,false,{common:Buffer.alloc(length)})),/通道布局/);
  for(const flags of [1,3,7,103,195,231])assert.throws(()=>media(channels(flags,false,{common:Buffer.alloc(20)})),/通道布局/);
  for(const extra of [{raw:Buffer.alloc(55)},{raw:Buffer.alloc(60)},{marker:3}])assert.throws(()=>media(channels(39,false,{common:Buffer.alloc(20),...extra})),/通道布局|点数或长度|未验证标记/);
  const invalidWidth=Buffer.alloc(54);for(let i=0;i<3;i++)invalidWidth.writeFloatLE(NaN,i*18+12);
  assert.throws(()=>media(channels(39,false,{common:Buffer.alloc(20),raw:invalidWidth})),/坐标或宽度/);
});

test('MN5混合扩展公共头样本完整保留8笔161点，不漏掉黑笔或红色叉号',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn5-500-build5-mixed-extended-heads.wrd')),d=decoder();
  assert.equal(raw.length,4808);
  assert.equal(require('node:crypto').createHash('sha256').update(raw).digest('hex'),'3877dedd3f76b675afc1e8f220fc4745f6c556074a6d6c2177da02795882549d');
  const result=d.decode(d.decodeBase64(raw.toString('base64'),raw.length));
  assert.equal(result.strokes.length,8);assert.equal(result.pointCount,161);
  assert.deepEqual(Array.from(result.strokes,s=>s.points.length),[15,20,5,12,40,23,25,21]);
  assert.deepEqual(Array.from(result.strokes,s=>s.color),[...Array(6).fill('#000000'),'#ff0000','#ff0000']);
  assert.ok(result.strokes.every(s=>s.alpha===1&&s.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.width>0&&p.width<1000)));
  const strict=media(raw),preview=media(raw,true);
  assert.equal(strict.dataURL,preview.dataURL);assert.equal(strict.drawing.previewOnly,undefined);
  assert.deepEqual(Array.from(strict.drawing.colors),['#000000','#ff0000']);
  const svg=decodeURIComponent(strict.dataURL.split(',')[1]);
  assert.equal((svg.match(/<polyline /g)||[]).length,8);
  assert.equal((svg.match(/stroke="#ff0000"/g)||[]).length,2);
});

test('扩展公共头103、167和231沿用逐点坐标与笔宽，不推定其他组合或宽松接受错误长度',()=>{
  for(const [flags,length,stride]of [[103,18,20],[167,18,20],[231,16,22]]){
    const regular=media(channels(flags)),extended=channels(flags,false,{common:Buffer.alloc(length,0xff)}),d=decoder();
    assert.equal(media(extended).dataURL,regular.dataURL);assert.equal(media(extended,true).dataURL,regular.dataURL);
    const result=d.decode(d.decodeBase64(extended.toString('base64'),extended.length));
    assert.equal(JSON.stringify(result.strokes[0].points),JSON.stringify([{x:10,y:20,width:3},{x:30,y:24,width:3},{x:12,y:40,width:3}]));
    for(const size of [length-2,length-1,length+1,length+2])assert.throws(()=>media(channels(flags,false,{common:Buffer.alloc(size)})),/通道布局/);
    for(const size of [stride*3-1,(stride+2)*3])assert.throws(()=>media(channels(flags,false,{common:Buffer.alloc(length),raw:Buffer.alloc(size)})),/通道布局|点数或长度/);
    assert.throws(()=>media(channels(flags,false,{common:Buffer.alloc(length),marker:3})),/未验证标记/);
    for(const value of [0,-1,NaN,Infinity,1001]){
      const points=Buffer.alloc(stride*3);for(let i=0;i<3;i++)points.writeFloatLE(value,i*stride+12);
      assert.throws(()=>media(channels(flags,false,{common:Buffer.alloc(length),raw:points})),/坐标或宽度/);
    }
    assert.throws(()=>media(Buffer.concat([extended,field(9,2,Buffer.from([1]))])),/未验证字段/);
  }
  for(const [flags,length]of [[7,22],[3,26],[1,30],[195,22]])
    assert.throws(()=>media(channels(flags,false,{common:Buffer.alloc(length)})),/通道布局/);
});

test('MN5.0.1布局131的24字节公共头保留462条红笔8063点及179个路径标记',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn5-501-build1-layout131-common24-red.wrd')),d=decoder();
  assert.equal(raw.length,221358);
  assert.equal(require('node:crypto').createHash('sha256').update(raw).digest('hex'),'220c5a208f41301b9753529ef7c7940a1cca80292efc9552d605c8bd75494efd');
  const result=d.decode(d.decodeBase64(raw.toString('base64'),raw.length));
  assert.equal(result.strokes.length,462);assert.equal(result.pointCount,8063);assert.equal(result.pathMarkers.length,179);
  assert.ok(result.strokes.every(s=>s.color==='#ff0000'&&s.alpha===1));
  assert.equal(result.strokes[309].points.length,2);
  const [first,last]=result.strokes[309].points;
  for(const [actual,expected]of [[first.x,50.88727980852127],[first.y,505.8884387090802],[first.width,1.8551023214477027],
    [last.x,50.45271188765764],[last.y,506.44152515381575],[last.width,1.8551023214477027]])assert.ok(Math.abs(actual-expected)<0.000001);
  const strict=media(raw),preview=media(raw,true);
  assert.equal(strict.dataURL,preview.dataURL);assert.equal(strict.drawing.previewOnly,undefined);
  assert.deepEqual(Array.from(strict.drawing.colors),['#ff0000']);
  assert.equal((decodeURIComponent(strict.dataURL.split(',')[1]).match(/<(?:circle|polyline) /g)||[]).length,462);
});

test('布局131扩展公共头仍从偏移0读取笔宽，拒绝错误长度、无效宽度及越界标记',()=>{
  const common=Buffer.alloc(24,0xff);common.writeFloatLE(3,0);
  const extended=channels(131,false,{common}),d=decoder();
  assert.equal(media(extended).dataURL,media(channels(131)).dataURL);
  assert.equal(JSON.stringify(d.decode(d.decodeBase64(extended.toString('base64'),extended.length)).strokes[0].points),
    JSON.stringify([{x:10,y:20,width:3},{x:30,y:24,width:3},{x:12,y:40,width:3}]));
  for(const size of [21,22,23,25,26,28])assert.throws(()=>media(channels(131,false,{common:Buffer.alloc(size)})),/通道布局/);
  for(const size of [41,45,48])assert.throws(()=>media(channels(131,false,{common,raw:Buffer.alloc(size)})),/通道布局|点数或长度/);
  for(const width of [0,-1,NaN,Infinity,1001]){
    const bad=Buffer.from(common);bad.writeFloatLE(width,0);
    assert.throws(()=>media(channels(131,false,{common:bad})),/坐标或宽度/);
  }
  assert.throws(()=>media(channels(131,false,{common,marker:3})),/未验证标记/);
  assert.throws(()=>media(Buffer.concat([extended,field(9,2,Buffer.from([1]))])),/未验证字段/);
});

test('MN5.0.1布局167真实样本保留421笔7154点及130个路径标记，黑色书写不丢笔',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn5-501-build1-layout167-black.wrd')),d=decoder();
  assert.equal(raw.length,198883);
  assert.equal(require('node:crypto').createHash('sha256').update(raw).digest('hex'),'6aeeb17029b215854e6cf4f82f850607f499c7dfd7d5ddb6c5bd371b7f21e60e');
  const result=d.decode(d.decodeBase64(raw.toString('base64'),raw.length));
  assert.equal(result.strokes.length,421);assert.equal(result.pointCount,7154);assert.equal(result.pathMarkers.length,130);
  assert.ok(result.strokes.every(s=>s.color==='#000000'&&s.alpha===1));
  assert.deepEqual([262,336,337,338,339,385].map(i=>result.strokes[i].points.length),[9,7,6,6,6,5]);
  const first=result.strokes[262].points[0],last=result.strokes[385].points.at(-1);
  for(const [actual,expected]of [[first.x,7.865808606147766],[first.y,406.93072628974915],[first.width,4.138975469373236],
    [last.x,865.2686841487885],[last.y,584.5231499671936],[last.width,3.4868657113902373]])assert.ok(Math.abs(actual-expected)<0.000001);
  const strict=media(raw),preview=media(raw,true);
  assert.equal(strict.dataURL,preview.dataURL);assert.equal(strict.drawing.previewOnly,undefined);
  assert.deepEqual(Array.from(strict.drawing.colors),['#000000']);
  assert.equal((decodeURIComponent(strict.dataURL.split(',')[1]).match(/<(?:circle|polyline) /g)||[]).length,421);
});

test('按通道定义解析全部32种已知位组合，公共笔宽、多点和路径标记不再逐个列白名单',()=>{
  for(let combination=0;combination<32;combination++){
    const flags=1|(combination&3)<<1|(combination>>2)<<5,raw=channels(flags),d=decoder();
    const result=d.decode(d.decodeBase64(raw.toString('base64'),raw.length));
    assert.equal(JSON.stringify(result.strokes[0].points),JSON.stringify([{x:10,y:20,width:3},{x:30,y:24,width:3},{x:12,y:40,width:3}]),'flags='+flags);
    assert.equal(media(raw).drawing.previewOnly,undefined);assert.equal(media(raw).dataURL,media(raw,true).dataURL);
  }
});

test('通道缺少坐标、出现未知位、声明长度与实际不符仍拒绝写入',()=>{
  for(const flags of [0,2,8,9,17,257,0x80000001])assert.throws(()=>media(channels(flags)),/通道布局|点数或长度/);
  for(const extra of [{common:Buffer.alloc(15)},{raw:Buffer.alloc(17)},{raw:Buffer.alloc(54+3)},{common:Buffer.alloc(18)}])assert.throws(()=>media(channels(39,false,extra)),/通道布局|点数或长度/);
});

test('旧头逐点笔宽组合与新头保留相同路径，不能误解缺失的公共笔宽',()=>{
  for(let combination=0;combination<16;combination++){
    const flags=5|(combination&1)<<1|(combination>>1)<<5;
    assert.equal(media(channels(flags,true)).dataURL,media(channels(flags)).dataURL,'flags='+flags);
  }
  assert.throws(()=>media(channels(3,true)),/通道布局/);
});

test('恢复的MN4.4.6真实归档解出同一份10笔35点红色绘图，不把两个兼容版本叠加',()=>{
  const raw=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-446-build3-archive.bplist'));
  const result=media(raw),preview=media(raw,true);
  assert.equal(result.drawing.strokeCount,10);assert.equal(result.drawing.pointCount,35);
  assert.equal(JSON.stringify(result.drawing.colors),JSON.stringify(['#fd2f43']));
  assert.equal(result.drawing.archive.selected,'drawing1');assert.equal(result.drawing.archive.verifiedAlternative,'drawing2');
  assert.equal(result.drawing.previewOnly,undefined);assert.equal(result.dataURL,preview.dataURL);
  assert.equal((decodeURIComponent(result.dataURL.split(',')[1]).match(/<polyline /g)||[]).length,10);
});

test('同一个解析入口接收直接wrd、普通plist字典、NSKeyedArchiver；重包装不改变识别预览',()=>{
  const raw=handwriting(),expected=media(raw).dataURL;
  for(const wrapped of [binaryPlist({drawing1:raw}),archivedDrawing({drawing1:raw}),archivedDrawing({drawing2:raw}),archivedDrawing({drawing1:raw,drawing2:raw})]){
    assert.equal(media(wrapped).dataURL,expected);assert.equal(media(wrapped).drawing.strokeCount,1);
  }
});

test('归档两个版本内容矛盾、混入图像或遮罩时拒绝，不静默退到可读的版本',()=>{
  const raw=handwriting(),red=handwriting([{color:[1,0,0,1]}]);
  for(const variants of [{drawing1:raw,drawing2:red},{drawing1:raw,drawing2:Buffer.from('bad')},{drawing1:raw,other:raw}]){
    assert.throws(()=>media(archivedDrawing(variants)),/归档|wrd/);
  }
  const malformed=archiveObject({drawing1:raw});malformed.$objects[1]['$class']={uid:9999};
  assert.throws(()=>media(binaryPlist(malformed)),/归档/);
  malformed.$objects[1]['$class']={uid:1};assert.throws(()=>media(binaryPlist(malformed)),/归档/);
});

test('真实归档的现代表示仍校验新字段和附加记录，不能只取可读的旧表示掩盖差异',()=>{
  const archive=fs.readFileSync(path.resolve(__dirname,'fixtures/mn4-446-build3-archive.bplist'));
  const offset=archive.indexOf(Buffer.from('wrd')),modern=archive.subarray(offset,offset+2701);
  const oldOffset=archive.indexOf(Buffer.from('wrd'),offset+2701),legacy=archive.subarray(oldOffset,oldOffset+2373);
  assert.equal(media(archivedDrawing({drawing1:legacy,drawing2:modern})).drawing.strokeCount,10);
  assert.throws(()=>media(modern),/未验证字段|普通笔/,'归档比对不代表已经实现独立钢笔渲染');
  const changed=Buffer.from(modern),extra=Buffer.concat([float(1,1),float(2,0),float(3,0),float(4,0.25),float(5,0),float(6,0)]);
  const extraOffset=changed.indexOf(extra);assert.ok(extraOffset>0);changed.writeFloatLE(0.5,extraOffset+16);
  for(const bad of [changed,Buffer.concat([modern,field(9,2,Buffer.from([1]))]),Buffer.concat([modern,field(46,0,0)])])
    assert.throws(()=>media(archivedDrawing({drawing1:legacy,drawing2:bad})),/归档/);
});

test('损坏或越界的plist引用、偏移、超大计数和不支持的对象类型均拒绝',()=>{
  const raw=archivedDrawing({drawing1:handwriting()});
  const badOffset=Buffer.from(raw);badOffset.writeBigUInt64BE(BigInt(raw.length),badOffset.length-8);
  const badCount=Buffer.from(raw);badCount.writeBigUInt64BE(0xffffffffffffffffn,badCount.length-24);
  const badType=Buffer.from(raw);badType[8]=0x30;
  const cycle=Buffer.from(raw),table=Number(cycle.readBigUInt64BE(cycle.length-8));
  cycle[8]=0xa1;cycle[9]=0;
  for(const b of [raw.subarray(0,raw.length-1),badOffset,badCount,badType,cycle,Buffer.from('bplist00'),Buffer.from('bplist01')])assert.throws(()=>media(b),/归档/);
  assert.ok(table>8);
});

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

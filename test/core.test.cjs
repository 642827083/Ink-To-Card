const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['InkToCardConfig.js','InkToCardCore.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src',file),'utf8'),context);
const config = context.__INK_TO_CARD_CONFIG__, core = context.InkToCardCore;
const mapping = {red:3, orange:4, yellow:0, green:1, cyan:5, blue:2, purple:6};
function raster(...strokes) {
  const data = new Uint8ClampedArray(100*100*4);
  for (let i=0; i<data.length; i+=4) data.set([255,255,255,255],i);
  let start=0;
  for (const [count, color] of strokes) {
    for (let i=start; i<start+count; i++) data.set(color,i*4);
    start+=count;
  }
  return data;
}
function recognize(data, options={}) {
  const settings = config.normalize({mapping,...options});
  return core.choose(core.histogram(data,100,100,settings),settings);
}
test('七种笔色均映射到用户配置色号',()=>{
  const colors = {red:[230,40,50,255],orange:[245,130,20,255],yellow:[240,220,20,255],green:[30,180,60,255],cyan:[20,180,185,255],blue:[30,90,230,255],purple:[180,40,220,255]};
  for (const [name,color] of Object.entries(colors)) {
    const result=recognize(raster([300,color],[600,[30,30,30,255]]));
    assert.equal(result.status,'matched'); assert.equal(result.color,name); assert.equal(result.colorIndex,mapping[name]);
  }
});
test('黑灰白和透明 RGB 噪声不触发',()=>{
  const result=recognize(raster([300,[255,0,0,0]],[300,[90,90,90,255]],[400,[0,0,0,255]]));
  assert.equal(result.status,'insufficient');
});
test('零星彩色像素达不到最低笔迹量',()=>assert.equal(recognize(raster([15,[255,0,0,255]])).status,'insufficient'));
test('多色接近时保持原色',()=>assert.equal(recognize(raster([300,[255,0,0,255]],[290,[0,0,255,255]])).status,'ambiguous'));
test('主要颜色占比达标时选主要颜色',()=>assert.equal(recognize(raster([700,[255,0,0,255]],[200,[0,0,255,255]])).color,'red'));
test('优先级模式按红色优先，跳过未设置映射的颜色',()=>{
  const data=raster([50,[255,0,0,255]],[700,[0,0,255,255]]);
  assert.equal(recognize(data,{policy:'priority'}).color,'red');
  assert.equal(recognize(data,{policy:'priority',mapping:{blue:2}}).color,'blue');
});
test('主要色未设置映射时不会退而选择少量次要色',()=>{
  assert.equal(recognize(raster([800,[255,0,0,255]],[90,[0,0,255,255]]),{mapping:{blue:2}}).status,'unmapped');
});
test('未配置的测试版默认关闭自动识别与全部颜色映射',()=>{
  const options=config.normalize(null);
  assert.equal(options.auto,false);
  assert.ok(Object.values(options.mapping).every(value=>value===-1));
});
test('非法像素数据拒绝分析',()=>assert.throws(()=>core.histogram(new Uint8Array(1),100,100,{}),/图片像素无效/));

test('红色模式不要求占多数，但仍使用最低笔迹量',()=>{
  assert.equal(recognize(raster([30,[255,0,0,255]],[900,[0,0,255,255]]),{policy:'red'}).color,'red');
  assert.equal(recognize(raster([29,[255,0,0,255]],[900,[0,0,255,255]]),{policy:'red'}).status,'insufficient');
});
test('红色模式无红色保持原色，不回退选择其他颜色',()=>{
  assert.equal(recognize(raster([900,[0,0,255,255]]),{policy:'red'}).status,'insufficient');
  assert.equal(recognize(raster([400,[255,0,0,0]],[900,[0,0,255,255]]),{policy:'red'}).status,'insufficient');
});
test('红色模式映射未设置时跳过，也不能选择已经映射的蓝色',()=>{
  assert.equal(recognize(raster([40,[255,0,0,255]],[900,[0,0,255,255]]),{policy:'red',mapping:{blue:2}}).status,'unmapped');
});

test('旧设置保留七种映射，无彩色书写默认不触发，非法色号不能启用',()=>{
  const old=config.normalize({mapping});
  assert.equal(old.mapping.uncolored,-1);
  for(const [name,index] of Object.entries(mapping))assert.equal(old.mapping[name],index);
  for(const value of [undefined,null,'3',16,-2,0.5])assert.equal(config.normalize({mapping:{uncolored:value}}).mapping.uncolored,-1);
  assert.equal(config.normalize({mapping:{uncolored:0}}).mapping.uncolored,0);
});

function inkRaster(count,color) {
  const data=new Uint8ClampedArray(100*100*4);
  for(let i=0;i<count;i++)data.set(color,i*4);
  return data;
}

test('无彩色书写适用于三种颜色模式，黑灰白可见手写按指定卡色处理',()=>{
  for(const policy of ['dominant','priority','red'])for(const color of [[0,0,0,255],[90,90,90,255],[255,255,255,255]]){
    const result=recognize(inkRaster(100,color),{policy,mapping:{uncolored:5}});
    assert.equal(result.status,'matched');assert.equal(result.color,'uncolored');assert.equal(result.colorIndex,5);
  }
});

test('透明空白、不可见或不足量的手写不触发无彩色书写',()=>{
  for(const data of [inkRaster(0,[0,0,0,255]),inkRaster(100,[0,0,0,0]),inkRaster(100,[0,0,0,63]),inkRaster(29,[0,0,0,255])]){
    assert.notEqual(recognize(data,{mapping:{uncolored:5}}).status,'matched');
  }
  const histogram=core.histogram(inkRaster(100,[0,0,0,128]),100,100,{});
  assert.ok(Math.abs(histogram.visible-100*128/255)<0.001);assert.equal(histogram.colored,0);
});

test('少量彩色、未映射彩色、多色冲突和红色模式里的蓝色都不使用无彩色书写',()=>{
  for(const [data,options] of [
    [raster([1,[255,0,0,255]],[100,[0,0,0,255]]),{}],
    [raster([100,[255,0,0,255]]),{}],
    [raster([300,[255,0,0,255]],[290,[0,0,255,255]]),{mapping:{red:3,blue:2,uncolored:5}}],
    [raster([100,[0,0,255,255]]),{policy:'red'}]
  ]){
    const result=recognize(data,{mapping:{uncolored:5},...options});
    assert.notEqual(result.status,'matched');assert.notEqual(result.color,'uncolored');
  }
  assert.equal(recognize(raster([50,[255,0,0,255]],[100,[0,0,0,255]]),{policy:'red',mapping:{red:3,uncolored:5}}).color,'red');
});

test('原始笔色存在微小或深色彩笔时仍阻止无彩色兜底',()=>{
  assert.equal(core.drawingHasColor({colors:['#000000','#808080','#ffffff']},{}),false);
  assert.equal(core.drawingHasColor({colors:['#000000','#ff0000']},{}),true);
  assert.equal(core.drawingHasColor({colors:['#100000']},{}),true);
});

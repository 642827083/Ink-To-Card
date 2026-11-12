// 生成已验证格式的最小笔画，用于区分纯黑、彩色、透明和损坏媒体。
function varint(value) {
  const result=[];
  do { const part=value%128;value=Math.floor(value/128);result.push(part+(value?128:0)); } while(value);
  return Buffer.from(result);
}
function field(number,wire,value) {
  const body=wire===0?varint(value):Buffer.concat([varint(value.length),value]);
  return Buffer.concat([varint(number*8+wire),body]);
}
function float(number,value) {
  const bytes=Buffer.alloc(4);bytes.writeFloatLE(value);
  return Buffer.concat([varint(number*8+5),bytes]);
}
function handwriting(strokes=[{color:[0,0,0,1]}]) {
  const records=[Buffer.from('wrd')];
  strokes.forEach(({color=[0,0,0,1],brush='com.apple.ink.pen',inkVariant})=>{
    const rgba=Buffer.concat(color.map((channel,index)=>float(index+1,channel)));
    records.push(field(4,2,Buffer.concat([field(1,2,rgba),field(2,2,Buffer.from(brush)),field(3,0,3),
      ...(inkVariant===undefined?[]:[field(4,2,Buffer.from(inkVariant))])])));
  });
  strokes.forEach(({pathMarker,layout=39,points:coordinates,width=3,tailLength=12,extraStroke},index)=>{
    coordinates=coordinates||[[10,20+index*10],[40,20+index*10]];
    const definitions=[[1,8],[2,4],[4,4],[32,2],[64,2],[128,2]],shared=[],packed=[];
    for(let point=0;point<coordinates.length;point++){
      const row=[];
      for(const [bit,size] of definitions){
        const bytes=Buffer.alloc(size);
        if(bit===1){bytes.writeFloatLE(coordinates[point][0]);bytes.writeFloatLE(coordinates[point][1],4);}
        if(bit===4)bytes.writeFloatLE(width);
        if(layout&bit)row.push(bytes);else if(point===0)shared.push(bytes);
      }
      packed.push(Buffer.concat(row));
    }
    const common=Buffer.concat([...shared,Buffer.alloc(tailLength)]),points=Buffer.concat(packed);
    const path=Buffer.concat([field(3,0,coordinates.length),field(4,0,layout),field(6,2,common),field(7,2,points),...(pathMarker===undefined?[]:[field(9,0,pathMarker)])]);
    const transform=Buffer.concat([1,0,0,1,0,0].map((value,index)=>float(index+1,value)));
    records.push(field(5,2,Buffer.concat([field(4,0,index),field(5,2,path),field(7,2,transform),...(extraStroke?[extraStroke]:[])])));
  });
  return Buffer.concat(records);
}
// 组合真实样本与合成笔迹，仅重排笔色引用，保留原始点数据和新字段。
function combineDrawings(...drawings) {
  function records(raw) {
    let cursor=0;
    function integer(){let value=0,multiplier=1,byte;do{byte=raw[cursor++];value+=(byte&127)*multiplier;multiplier*=128;}while(byte&128);return value;}
    const result=[];
    while(cursor<raw.length){
      const start=cursor,tag=integer(),wire=tag%8,number=Math.floor(tag/8);let value;
      if(wire===0)value=integer();
      else if(wire===2){const length=integer();value=raw.subarray(cursor,cursor+length);cursor+=length;}
      else if(wire===1||wire===5)cursor+=wire===1?8:4;
      else throw Error('测试样本包含未知类型');
      result.push({number,wire,value,raw:raw.subarray(start,cursor)});
    }
    return result;
  }
  const inks=[],strokes=[];
  for(const drawing of drawings){
    if(drawing.subarray(0,3).toString()!=='wrd')throw Error('组合样本必须为wrd');
    const items=records(drawing.subarray(3)),offset=inks.length;
    for(const item of items.filter(r=>r.number===4))inks.push(item.raw);
    for(const item of items.filter(r=>r.number===5)){
      const remapped=records(item.value).map(r=>r.number===4?field(4,0,r.value+offset):r.raw);
      strokes.push(field(5,2,Buffer.concat(remapped)));
    }
  }
  return Buffer.concat([Buffer.from('wrd'),...inks,...strokes]);
}
module.exports={handwriting,combineDrawings};

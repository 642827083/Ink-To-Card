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
  strokes.forEach(({color=[0,0,0,1],brush='com.apple.ink.pen'})=>{
    const rgba=Buffer.concat(color.map((channel,index)=>float(index+1,channel)));
    records.push(field(4,2,Buffer.concat([field(1,2,rgba),field(2,2,Buffer.from(brush)),field(3,0,3)])));
  });
  strokes.forEach(({pathMarker,layout=39},index)=>{
    const stride=layout===3?12:18,common=Buffer.alloc(layout===3?22:16),points=Buffer.alloc(stride*2);
    if(layout===3)common.writeFloatLE(3);
    for(let point=0;point<2;point++){points.writeFloatLE(10+point*30,point*stride);points.writeFloatLE(20+index*10,point*stride+4);if(stride>=16)points.writeFloatLE(3,point*stride+12);}
    const path=Buffer.concat([field(3,0,2),field(4,0,layout),field(6,2,common),field(7,2,points),...(pathMarker===undefined?[]:[field(9,0,pathMarker)])]);
    const transform=Buffer.concat([1,0,0,1,0,0].map((value,index)=>float(index+1,value)));
    records.push(field(5,2,Buffer.concat([field(4,0,index),field(5,2,path),field(7,2,transform)])));
  });
  return Buffer.concat(records);
}
module.exports={handwriting};

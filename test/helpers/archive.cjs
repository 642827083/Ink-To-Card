// 独立生成 Apple 二进制 plist，用于检验运行时读取器而非依赖 Node 解析库。
function binaryPlist(value) {
  const objects=[];
  function add(value) {
    const index=objects.length;objects.push(null);
    if(Array.isArray(value))objects[index]={array:value.map(add)};
    else if(value&&typeof value==='object'&&!Buffer.isBuffer(value)&&value.uid===undefined)
      objects[index]={dict:[Object.keys(value).map(add),Object.values(value).map(add)]};
    else objects[index]=value;
    return index;
  }
  const root=add(value),refSize=objects.length>255?2:1;
  function integer(n,size) { const bytes=Buffer.alloc(size);bytes.writeUIntBE(n,0,size);return bytes; }
  function header(type,count) {
    return count<15?Buffer.from([type|count]):Buffer.concat([Buffer.from([type|15,0x12]),integer(count,4)]);
  }
  function refs(items){return Buffer.concat(items.map(n=>integer(n,refSize)));}
  const data=objects.map(obj=>{
    if(Buffer.isBuffer(obj))return Buffer.concat([header(0x40,obj.length),obj]);
    if(typeof obj==='string')return Buffer.concat([header(0x50,obj.length),Buffer.from(obj,'ascii')]);
    if(typeof obj==='number')return Buffer.concat([Buffer.from([0x12]),integer(obj,4)]);
    if(obj?.uid!==undefined)return Buffer.concat([Buffer.from([0x81]),integer(obj.uid,2)]);
    if(obj?.array)return Buffer.concat([header(0xa0,obj.array.length),refs(obj.array)]);
    if(obj?.dict)return Buffer.concat([header(0xd0,obj.dict[0].length),...obj.dict.map(refs)]);
    throw Error('测试 plist 类型无效');
  });
  let cursor=8;const offsets=data.map(bytes=>{const offset=cursor;cursor+=bytes.length;return offset;});
  const trailer=Buffer.alloc(32);trailer[6]=4;trailer[7]=refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length),8);trailer.writeBigUInt64BE(BigInt(root),16);trailer.writeBigUInt64BE(BigInt(cursor),24);
  return Buffer.concat([Buffer.from('bplist00'),...data,...offsets.map(n=>integer(n,4)),trailer]);
}
function archiveObject(variants) {
  const entries=Object.entries(variants),objects=['$null',null],uid=uid=>({uid});
  const keys=entries.map(([name])=>{const index=objects.length;objects.push(name);return uid(index);});
  const values=entries.map(([,raw])=>{const index=objects.length;objects.push(raw);return uid(index);});
  objects[1]={'NS.keys':keys,'NS.objects':values,'$class':uid(objects.length)};
  objects.push({'$classname':'NSDictionary','$classes':['NSDictionary','NSObject']});
  return {$version:100000,$archiver:'NSKeyedArchiver',$top:{root:uid(1)},$objects:objects};
}
function archivedDrawing(variants) { return binaryPlist(archiveObject(variants)); }
module.exports={binaryPlist,archiveObject,archivedDrawing};

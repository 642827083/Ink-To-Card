const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {crc32} = require('./zip.cjs');
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function icon() {
  const width = 64, pixels = Buffer.alloc(width * width * 4);
  function polygon(vertices, color) {
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      let inside = false;
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const [xi, yi] = vertices[i], [xj, yj] = vertices[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) pixels.set(color, (y * width + x) * 4);
    }
  }
  polygon([[7,16],[46,16],[46,54],[7,54]], [67,155,141,255]);
  polygon([[12,22],[40,22],[40,25],[12,25]], [255,255,255,235]);
  polygon([[12,31],[29,31],[29,34],[12,34]], [255,255,255,235]);
  polygon([[18,40],[27,40],[27,46],[18,46]], [234,176,48,255]);
  polygon([[44,5],[59,20],[34,45],[20,47],[21,33]], [233,79,88,255]);
  polygon([[21,33],[34,45],[20,47]], [255,240,202,255]);
  polygon([[20,42],[25,47],[20,47]], [52,67,79,255]);
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(width,4); header[8]=8; header[9]=6;
  const raw = Buffer.alloc((width * 4 + 1) * width);
  for (let y = 0; y < width; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
if (require.main === module) fs.writeFileSync(path.resolve(__dirname,'../src/icon.png'), icon());
module.exports = icon;

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {pack, unpack} = require('./zip.cjs');
const root = path.resolve(__dirname, '..');
const release = process.argv.includes('--release');
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json')));
if (release && pkg.version === '0.0.0') throw new Error('请在用户真机确认成功并指定正式版本后发布');
const filename = release ? `Ink To Card ${pkg.version}.mnaddon` : 'Ink To Card Test.mnaddon';
const output = path.join(root, filename);
if (release && fs.existsSync(output)) throw new Error('正式包已存在，停止构建以避免覆盖');
execFileSync(process.execPath, [path.join(__dirname,'check.cjs')], {stdio:'inherit'});
const entries = [];
function collect(dir, prefix) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) collect(full,name+'/');
    else if (!['demo.js','InkToCardSceneAddon.js','inkFollow.js'].includes(entry.name)) entries.push({name, data:fs.readFileSync(full)});
  }
}
collect(path.join(root,'src'),''); collect(path.join(root,'web'),'web/');
// 本地 WebView 可能只允许读取 HTML 所在目录；共享算法从单一源码复制进该目录。
for (const name of ['InkToCardConfig.js','InkToCardCore.js']) {
  entries.push({name:'web/'+name, data:fs.readFileSync(path.join(root,'src',name))});
}
// 测试演示在浏览器单独使用，安装包不包含演示桥接。
const html = entries.find(entry=>entry.name==='web/index.html');
html.data = Buffer.from(html.data.toString().replace('  <script src="src/demo.js"></script>\n',''));
const archive = pack(entries), restored = unpack(archive);
if (restored.length !== entries.length) throw new Error('包文件数量不一致');
for (const entry of entries) {
  if (!restored.find(other=>other.name===entry.name)?.data.equals(entry.data)) throw new Error('包内容不一致：'+entry.name);
}
for (const required of ['main.js','mnaddon.json','icon.png','InkToCardConfig.js','InkToCardCore.js','InkToCardDrawing.js','InkToCardBatch.js','InkToCardAddon.js','InkToCardPanel.js','web/index.html','web/InkToCardConfig.js','web/InkToCardCore.js','web/src/startup.js','web/src/app.js','web/src/lib/mnBridge.js']) {
  if (!restored.some(entry=>entry.name===required)) throw new Error('包缺少 '+required);
}
fs.writeFileSync(output, archive, {flag:release?'wx':'w'});
console.log(`已生成 ${filename}（${restored.length} 个文件）`);
console.log('SHA-256 '+crypto.createHash('sha256').update(archive).digest('hex'));

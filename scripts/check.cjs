const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? files(path.join(dir,entry.name)) : [path.join(dir,entry.name)]);
}
for (const file of [...files(path.join(root,'src')), ...files(path.join(root,'web')), ...files(path.join(root,'scripts'))]) {
  if (/\.(?:js|cjs)$/.test(file)) execFileSync(process.execPath, ['--check',file], {stdio:'inherit'});
}
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(root,'src/mnaddon.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
if (manifest.version !== packageInfo.version || lock.version !== manifest.version) throw new Error('版本不一致');
console.log('JavaScript 语法与版本一致性检查通过');

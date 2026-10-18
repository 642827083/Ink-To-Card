const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
http.createServer((request,response)=>{
  let pathname;
  try {pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);} catch {response.writeHead(400).end();return;}
  if (pathname==='/web/InkToCardConfig.js'||pathname==='/web/InkToCardCore.js') pathname='/src/'+path.posix.basename(pathname);
  const file=path.resolve(root,'.'+pathname);
  if (!file.startsWith(root+path.sep)||!(/\.(html|js|css|png)$/.test(file))) {response.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{
    if (error) {response.writeHead(404).end();return;}
    response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});response.end(data);
  });
}).listen(4173,'127.0.0.1',()=>console.log('预览：http://127.0.0.1:4173/web/index.html?demo=1'));

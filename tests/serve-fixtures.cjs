const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
http.createServer((req,res) => {
  if(req.url === '/settings') {
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    return res.end(fs.readFileSync(path.join(__dirname,'../options.html'),'utf8').replace('<script src="shared.js">','<script src="options-fixture.js"></script><script src="shared.js">'));
  }
  const assets = {'/screenshot':'screenshot-fixture.html','/screenshot-selector.js':'../screenshot-selector.js','/screenshot-fixture.js':'screenshot-fixture.js','/options-fixture.js':'options-fixture.js','/category-settings.js':'../category-settings.js','/options.js':'../options.js','/options.css':'../options.css','/popup.css':'../popup.css','/shared.js':'../shared.js','/tag-editor.js':'../tag-editor.js','/editor-fixture.js':'editor-fixture.js','/editor':'editor-fixture.html','/sample.svg':'sample.svg'};
  if (Object.hasOwn(assets,req.url)) { res.writeHead(200,{'Content-Type':['/editor','/screenshot'].includes(req.url)?'text/html; charset=utf-8':req.url==='/sample.svg'?'image/svg+xml':req.url.endsWith('.css')?'text/css':'application/javascript; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,assets[req.url]))); }
  if(req.url === '/pixel.png') { res.writeHead(200,{'Content-Type':'image/png'}); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')); }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(fs.readFileSync(path.join(__dirname,'fixtures.html')));
}).listen(8765, '127.0.0.1', () => console.log('Open http://127.0.0.1:8765 — Ctrl+C to stop.'));

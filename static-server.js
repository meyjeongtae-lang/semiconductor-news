// 아주 단순한 로컬 웹서버. index.html, data.js 같은 파일을 브라우저에 보여주기 위한 용도.
// 실행: node static-server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5173;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, decodeURIComponent(filePath.split('?')[0]));

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}).listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

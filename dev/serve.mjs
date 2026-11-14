/*
 * 本地预览静态服务器。
 *
 * 为什么需要它：content.js 只会在 bgm.tv / bangumi.tv 域名下运行，
 * 直接用 file:// 打开预览页不会出现滑块。用 Chrome 的
 * --host-resolver-rules 把 bgm.tv 映射到 127.0.0.1，就能在真实域名
 * 环境下调试页面内滑块。
 *
 * 用法：
 *   node dev/serve.mjs
 *   # 另一个终端：
 *   chrome --host-resolver-rules="MAP bgm.tv 127.0.0.1" \
 *          http://bgm.tv:8137/dev/preview.html
 */
import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8137);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = path.resolve(ROOT, '.' + pathname);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + pathname);
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });

    const stream = createReadStream(filePath);
    stream.on('error', (error) => {
      console.error('[serve] 读取文件失败:', filePath, error.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
    });
    stream.pipe(res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error\n' + String(error));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('预览服务器已启动: http://bgm.tv:' + PORT + '/dev/preview.html');
  console.log('启动浏览器示例: chrome --host-resolver-rules="MAP bgm.tv 127.0.0.1" "http://bgm.tv:' + PORT + '/dev/preview.html"');
});

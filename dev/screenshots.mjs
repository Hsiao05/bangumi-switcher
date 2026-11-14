/*
 * 用 Chrome DevTools Protocol 截取本地预览页 / 设置页。
 *
 * 与 `chrome --screenshot` 的区别：不启用 virtual-time-budget，
 * 因此 CSS 入场动画会正常播放完毕，截图不会停在半透明状态。
 *
 * 前置：先启动预览服务器 node dev/serve.mjs
 * 运行：node dev/screenshots.mjs
 */
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'dev', 'screenshots');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const PROFILE = path.join(process.env.TEMP || '.', 'bgm-cdp-screenshots');
const BASE = 'http://bgm.tv:' + (process.env.PREVIEW_PORT || 8137);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDebugger() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (response.ok) return;
    } catch (error) {
      /* not ready yet */
    }
    await sleep(100);
  }
  throw new Error('Chrome DevTools 未就绪');
}

async function createPage(url) {
  const response = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(url), {
    method: 'PUT',
  });
  if (!response.ok) throw new Error('无法创建标签页: ' + response.status);
  return response.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    let socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve: done, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(JSON.stringify(message.error)));
        else done(message.result);
      }
    });

    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((done, fail) => {
            const id = (nextId += 1);
            pending.set(id, { resolve: done, reject: fail });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
          socket = null;
        },
      });
    });

    socket.addEventListener('error', reject);
  });
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
  }
  return result.result.value;
}

async function waitFor(send, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(send, expression)) return true;
    } catch (error) {
      /* 页面可能还在导航 */
    }
    await sleep(120);
  }
  return false;
}

async function capture(send, fileName) {
  await sleep(900); // 等入场动画与字体渲染完成
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(SHOTS, fileName);
  await writeFile(file, Buffer.from(result.data, 'base64'));
  console.log('  \u2713 ' + fileName);
}

async function openPage(url) {
  const page = await createPage(url);
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return client;
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-proxy-server',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--host-resolver-rules=MAP bgm.tv 127.0.0.1',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  try {
    await waitForDebugger();

    // 浅色预览
    {
      const client = await openPage(BASE + '/dev/preview.html');
      const mounted = await waitFor(client.send, "!!document.getElementById('bgm-domain-switcher-host')");
      console.log('浅色预览：滑块 ' + (mounted ? '已注入' : '未注入'));
      if (mounted) {
        const info = await evaluate(
          client.send,
          "(() => { const w = document.getElementById('bgm-domain-switcher-host').shadowRoot.querySelector('.bdsw'); return { theme: w.getAttribute('data-theme'), text: w.textContent.replace(/\\s+/g, ' ').trim() }; })()",
        );
        console.log('  data-theme=' + info.theme + ' text=' + JSON.stringify(info.text));
      }
      await capture(client.send, 'preview-light.png');
      client.close();
    }

    // 深色预览
    {
      const client = await openPage(BASE + '/dev/preview.html?theme=dark');
      const mounted = await waitFor(client.send, "!!document.getElementById('bgm-domain-switcher-host')");
      if (mounted) {
        const theme = await evaluate(
          client.send,
          "document.getElementById('bgm-domain-switcher-host').shadowRoot.querySelector('.bdsw').getAttribute('data-theme')",
        );
        console.log('深色预览：data-theme=' + theme);
      }
      await capture(client.send, 'preview-dark.png');
      client.close();
    }

    // 移动端宽度预览
    {
      const client = await openPage(BASE + '/dev/preview.html');
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await waitFor(client.send, "!!document.getElementById('bgm-domain-switcher-host')");
      await capture(client.send, 'preview-mobile.png');
      client.close();
    }

    // 说明：设置页截图由 dev/e2e-extension.mjs 在真实扩展环境中生成
    // （file:// 打开 options.html 时没有 chrome.storage，会显示失败兜底状态）。

    console.log('截图完成：' + SHOTS);
  } finally {
    await new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], () => resolve());
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/*
 * 真实浏览器端到端测试（需要网络）：
 *   1. 用 --load-extension 加载扩展；
 *   2. 打开真实 https://bgm.tv/，确认 content script 注入左下角滑块；
 *   3. 点击滑块上的 Bangumi，确认页面切到 https://bangumi.tv/ 并保留路径；
 *   4. 在后台 Service Worker 中调用真实的 handleToolbarAction()，确认点击图标逻辑能切回 bgm.tv；
 *   5. 点击滑块 × 隐藏，确认滑块消失且设置持久化；再从后台恢复显示，确认无需刷新即可重新出现。
 *
 * 运行：node dev/e2e-extension.mjs
 * 需要先启动预览服务器？不需要（这里访问真实站点）。
 */
import { spawn, execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = path.join(ROOT, 'extension');
const SHOTS = path.join(ROOT, 'dev', 'screenshots');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 注意：Chrome 137+ 已移除 --load-extension 命令行开关，因此本测试优先使用 Edge。
// 也可以手动指定：CHROME_PATH=... node dev/e2e-extension.mjs
const BROWSER = process.env.CHROME_PATH || (existsSync(EDGE) ? EDGE : CHROME);
const RUN_ID = process.pid + '-' + Date.now();
const PORT = Number(process.env.E2E_PORT || 9334 + (process.pid % 100));
const PROFILE = path.join(process.env.TEMP || '.', 'bgm-e2e-' + RUN_ID);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

// 带路径与查询参数的测试页，用来验证切换后 path/query 原样保留。
const TEST_PATH = '/anime/browser?sort=rank';
const BGM_URL = 'https://bgm.tv' + TEST_PATH;
const BANGUMI_URL = 'https://bangumi.tv' + TEST_PATH;

function pass(message) {
  console.log('  \u2713 ' + message);
}

function fail(message) {
  failures += 1;
  console.log('  \u2717 ' + message);
}

async function waitForDebugger() {
  for (let i = 0; i < 200; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (response.ok) return;
    } catch (error) {
      /* not ready */
    }
    await sleep(100);
  }
  throw new Error('Chrome DevTools 未就绪');
}

async function targets() {
  const response = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  return response.json();
}

async function createPage(url) {
  const response = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(url), {
    method: 'PUT',
  });
  if (!response.ok) throw new Error('无法创建页面: ' + response.status);
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
        const { resolve: done, reject: failed } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) failed(new Error(JSON.stringify(message.error)));
        else done(message.result);
      }
    });

    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((done, failed) => {
            const id = (nextId += 1);
            pending.set(id, { resolve: done, reject: failed });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        },
      });
    });

    socket.addEventListener('error', reject);
  });
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function poll(description, fn, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  if (lastError) console.log('    (最后一次错误: ' + lastError.message + ')');
  return null;
}

const widgetScript = `(() => {
  const host = document.getElementById('bgm-domain-switcher-host');
  if (!host || !host.shadowRoot) return null;
  const widget = host.shadowRoot.querySelector('.bdsw');
  if (!widget) return null;
  const active = Array.from(host.shadowRoot.querySelectorAll('.bdsw-opt')).find((button) => button.classList.contains('is-active'));
  return {
    url: location.href,
    theme: widget.getAttribute('data-theme'),
    active: active ? active.getAttribute('data-host') : null,
    text: widget.textContent.replace(/\\s+/g, ' ').trim(),
  };
})()`;

async function capture(client, fileName) {
  await sleep(600);
  const result = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(path.join(SHOTS, fileName), Buffer.from(result.data, 'base64'));
  console.log('  \u2713 截图 ' + fileName);
}

/**
 * 在多个 service_worker target 中找出属于本扩展的那个
 * （Edge 自带 WebRTC / Copilot 等扩展也有 service worker）。
 */
async function findExtensionWorker() {
  const list = await targets();
  const candidates = list.filter(
    (target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://'),
  );

  for (const candidate of candidates) {
    let client = null;
    try {
      client = await connect(candidate.webSocketDebuggerUrl);
      await client.send('Runtime.enable');
      const name = await evaluate(client, 'chrome.runtime.getManifest().name');
      if (typeof name === 'string' && name.indexOf('Bangumi') !== -1) {
        return { client, target: candidate };
      }
    } catch (error) {
      /* 不是我们的扩展，继续找 */
    }
    if (client) client.close();
  }
  return null;
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const chrome = spawn(
    BROWSER,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--load-extension=' + EXTENSION,
      '--disable-extensions-except=' + EXTENSION,
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  try {
    await waitForDebugger();

    // 等待本扩展的 Service Worker 出现（确认扩展真的被加载）
    const workerInfo = await poll('extension service worker', () => findExtensionWorker(), 30000);

    if (!workerInfo) {
      fail('扩展未加载成功（找不到本扩展的 Service Worker target）');
      return;
    }
    pass('扩展已加载：' + workerInfo.target.url);
    const background = workerInfo.client;
    await background.send('Runtime.enable');

    const hasHandler = await evaluate(background, "typeof handleToolbarAction === 'function'");
    if (hasHandler) pass('后台 handleToolbarAction 已就绪');
    else fail('后台找不到 handleToolbarAction');

    // ---------------------------------------------------------------- //
    // 1. 真实站点注入（带路径与查询参数）
    // ---------------------------------------------------------------- //
    console.log('\n[1] 打开真实 bgm.tv 带路径页面，检查滑块注入');
    const pageTarget = await createPage(BGM_URL);
    const page = await connect(pageTarget.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');

    const firstState = await poll('widget on bgm.tv', async () => evaluate(page, widgetScript), 45000);
    if (firstState) {
      pass('bgm.tv 上滑块已注入：' + JSON.stringify(firstState.text));
      pass('当前激活项：' + firstState.active + '，主题：' + firstState.theme);
    } else {
      fail('bgm.tv 上未找到滑块');
    }
    await capture(page, 'real-bgm.png');

    // ---------------------------------------------------------------- //
    // 2. 点击滑块切换到 bangumi.tv（验证 path / query 保留）
    // ---------------------------------------------------------------- //
    console.log('\n[2] 点击滑块上的 Bangumi，切换到 bangumi.tv（保留路径与参数）');
    if (firstState) {
      const clicked = await evaluate(
        page,
        `(() => {
          const host = document.getElementById('bgm-domain-switcher-host');
          const button = host && host.shadowRoot && host.shadowRoot.querySelector('.bdsw-opt[data-host="bangumi.tv"]');
          if (!button) return false;
          button.click();
          return true;
        })()`,
      );
      if (!clicked) fail('无法点击 Bangumi 按钮');

      const switched = await poll(
        'navigation to bangumi.tv',
        async () => {
          try {
            return await evaluate(page, 'location.href');
          } catch (error) {
            return null;
          }
        },
        30000,
      );

      if (switched === BANGUMI_URL) {
        pass('已切换到 ' + BANGUMI_URL + '（路径与参数完整保留）');
      } else {
        fail('切换结果不符：期望 ' + BANGUMI_URL + '，实际 ' + switched);
      }

      const secondState = await poll('widget on bangumi.tv', async () => evaluate(page, widgetScript), 30000);
      if (secondState) {
        pass('bangumi.tv 上滑块仍存在，激活项：' + secondState.active);
      } else {
        fail('bangumi.tv 上未找到滑块');
      }
      await capture(page, 'real-bangumi.png');
    }

    // ---------------------------------------------------------------- //
    // 3. 后台 handleToolbarAction（图标点击逻辑）切回 bgm.tv
    // ---------------------------------------------------------------- //
    console.log('\n[3] 在 Service Worker 中调用 handleToolbarAction()（等价于点击扩展图标）');
    const toolbarResult = await evaluate(
      background,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const target = tabs.find((tab) => tab.url && tab.url.startsWith(${JSON.stringify('https://bangumi.tv' + TEST_PATH)}));
        if (!target) return { result: 'no-tab', tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url, active: tab.active })) };
        const info = {
          tabId: target.id,
          swapUrl: typeof lib !== 'undefined' ? lib.swapUrl(target.url) : 'lib-missing',
          tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url, active: tab.active })),
        };
        try {
          await handleToolbarAction(target);
          info.ok = true;
        } catch (error) {
          info.error = String(error);
        }
        // 等待导航提交（真实站点可能较慢），最多等 10 秒。
        var expected = ${JSON.stringify(BGM_URL)};
        var deadline = Date.now() + 10000;
        info.after = target.url;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          try {
            var updated = await chrome.tabs.get(target.id);
            info.after = updated.url;
            if (updated.url === expected) break;
          } catch (error) {
            info.afterError = String(error);
            break;
          }
        }
        return info;
      })()`,
    );

    if (toolbarResult && String(toolbarResult.result) === 'no-tab') {
      fail('后台没有找到 bangumi.tv 标签页：' + JSON.stringify(toolbarResult.tabs));
    } else if (toolbarResult && String(toolbarResult.after) === BGM_URL) {
      pass('点击图标逻辑已把页面切回 ' + BGM_URL + '（路径与参数保留）');
    } else {
      fail('点击图标逻辑未切换页面：' + JSON.stringify(toolbarResult));
    }

    // ---------------------------------------------------------------- //
    // 4. 关闭滑块 + 持久化 + 后台恢复
    // ---------------------------------------------------------------- //
    console.log('\n[4] 点击滑块 × 隐藏，验证持久化与恢复');
    await poll('widget after toolbar switch', async () => evaluate(page, widgetScript), 20000);

    await evaluate(
      page,
      `(() => {
        const host = document.getElementById('bgm-domain-switcher-host');
        const close = host && host.shadowRoot && host.shadowRoot.querySelector('.bdsw-close');
        if (!close) return false;
        close.click();
        return true;
      })()`,
    );
    await capture(page, 'real-toast.png');

    const hidden = await poll(
      'widget removed',
      async () => (await evaluate(page, "!!document.getElementById('bgm-domain-switcher-host')")) === false,
      8000,
    );
    if (hidden) pass('滑块已从页面移除');
    else fail('滑块没有消失');

    const stored = await evaluate(background, "chrome.storage.local.get({ sliderHidden: false })");
    if (stored.sliderHidden === true) pass('sliderHidden=true 已持久化');
    else fail('sliderHidden 未持久化：' + JSON.stringify(stored));

    // 刷新页面，确认隐藏状态在刷新后依然生效
    await page.send('Page.reload', { ignoreCache: true });
    await sleep(3000);
    const stillHidden = await evaluate(page, "!!document.getElementById('bgm-domain-switcher-host')");
    if (stillHidden) fail('刷新后滑块不应出现');
    else pass('刷新后滑块保持隐藏');

    // 从后台恢复显示，页面无需刷新即可出现
    await evaluate(background, "chrome.storage.local.set({ sliderHidden: false })");
    const restored = await poll('widget restored', async () => evaluate(page, widgetScript), 8000);
    if (restored) pass('取消隐藏后滑块无需刷新即恢复显示');
    else fail('恢复显示失败');

    // 干净的文档截图（此时页面已完全加载）
    await sleep(1800);
    await capture(page, 'real-site-widget.png');

    // ---------------------------------------------------------------- //
    // 5. 设置页与页面实时联动
    // ---------------------------------------------------------------- //
    console.log('\n[5] 设置页与页面实时联动');
    const extensionId = new URL(workerInfo.target.url).host;
    const optionsTarget = await createPage('chrome-extension://' + extensionId + '/options.html');
    const options = await connect(optionsTarget.webSocketDebuggerUrl);
    await options.send('Page.enable');
    await options.send('Runtime.enable');

    const optionsReady = await poll(
      'options page ready',
      async () => evaluate(options, "!!document.getElementById('slider-visible')"),
      15000,
    );
    if (!optionsReady) {
      fail('设置页未能加载');
    } else {
      pass('设置页已加载');
      const version = await evaluate(options, "document.getElementById('version').textContent");
      if (version === '1.0.0') pass('设置页版本号正确：' + version);
      else fail('设置页版本号异常：' + version);

      // 切换为深色主题
      const clickedDark = await evaluate(
        options,
        `(() => {
          const input = document.querySelector('input[name="theme"][value="dark"]');
          if (!input) return false;
          input.click();
          return true;
        })()`,
      );
      if (!clickedDark) fail('无法点击深色主题');

      const themeStored = await poll(
        'theme stored as dark',
        async () => {
          const value = await evaluate(background, "chrome.storage.local.get({ theme: 'auto' })");
          return value.theme === 'dark';
        },
        5000,
      );
      if (themeStored) pass('设置已写入 storage：theme=dark');
      else fail('theme 未写入 storage');

      const pageDark = await poll(
        'page widget dark',
        async () => {
          const state = await evaluate(page, widgetScript);
          return state && state.theme === 'dark';
        },
        5000,
      );
      if (pageDark) pass('页面滑块已实时切换为深色（无需刷新）');
      else fail('页面滑块没有跟随主题变化');

      // 切回自动
      await evaluate(
        options,
        `(() => {
          const input = document.querySelector('input[name="theme"][value="auto"]');
          if (input) input.click();
        })()`,
      );
      await poll(
        'theme back to auto',
        async () => {
          const value = await evaluate(background, "chrome.storage.local.get({ theme: 'auto' })");
          return value.theme === 'auto';
        },
        5000,
      );

      // 在设置页隐藏 / 恢复滑块
      await evaluate(options, "document.getElementById('slider-visible').click()");
      const hiddenByOptions = await poll(
        'widget hidden by options',
        async () => (await evaluate(page, "!!document.getElementById('bgm-domain-switcher-host')")) === false,
        5000,
      );
      if (hiddenByOptions) pass('设置页关闭开关后，页面滑块立即消失');
      else fail('设置页关闭开关后滑块仍然存在');

      await evaluate(options, "document.getElementById('slider-visible').click()");
      const shownAgain = await poll('widget shown by options', async () => evaluate(page, widgetScript), 5000);
      if (shownAgain) pass('设置页重新开启后，滑块立即恢复');
      else fail('设置页重新开启后滑块没有恢复');

      await sleep(1900); // 等底部提示消失后再截图
      await capture(options, 'options-real.png');
    }

    console.log('\n' + '-'.repeat(60));
    console.log(failures === 0 ? '端到端测试全部通过' : '端到端测试失败 ' + failures + ' 项');
    process.exitCode = failures === 0 ? 0 : 1;
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

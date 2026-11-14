/*
 * lib.js 单元测试（不依赖浏览器）。
 *
 * 运行：node --test dev/lib.test.mjs
 * 或在项目根目录：node --test dev/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../extension/lib.js');

test('SITES：左侧 Bangumi(bangumi.tv)，右侧 Bgm(bgm.tv)', () => {
  assert.deepEqual(
    lib.SITES.map((site) => site.host),
    ['bangumi.tv', 'bgm.tv'],
  );
  assert.deepEqual(
    lib.SITES.map((site) => site.label),
    ['Bangumi', 'Bgm'],
  );
  assert.equal(lib.SITES.length, 2);
});

test('siteForHost：识别 Bangumi 域名及其大小写 / www / 末尾点', () => {
  assert.equal(lib.siteForHost('bgm.tv'), 'bgm.tv');
  assert.equal(lib.siteForHost('bangumi.tv'), 'bangumi.tv');
  assert.equal(lib.siteForHost('BGM.TV'), 'bgm.tv');
  assert.equal(lib.siteForHost(' www.bgm.tv '), 'bgm.tv');
  assert.equal(lib.siteForHost('www.bangumi.tv'), 'bangumi.tv');
  assert.equal(lib.siteForHost('bgm.tv.'), 'bgm.tv');
});

test('siteForHost：拒绝非 Bangumi 域名与子域', () => {
  assert.equal(lib.siteForHost('example.com'), null);
  assert.equal(lib.siteForHost('api.bgm.tv'), null);
  assert.equal(lib.siteForHost('bgm.tv.evil.com'), null);
  assert.equal(lib.siteForHost('notbgm.tv'), null);
  assert.equal(lib.siteForHost(''), null);
  assert.equal(lib.siteForHost(null), null);
  assert.equal(lib.siteForHost(undefined), null);
});

test('otherSite / siteLabel', () => {
  assert.equal(lib.otherSite('bgm.tv'), 'bangumi.tv');
  assert.equal(lib.otherSite('bangumi.tv'), 'bgm.tv');
  assert.equal(lib.otherSite('www.bgm.tv'), 'bangumi.tv');
  assert.equal(lib.otherSite('example.com'), null);

  assert.equal(lib.siteLabel('bgm.tv'), 'Bgm');
  assert.equal(lib.siteLabel('bangumi.tv'), 'Bangumi');
  assert.equal(lib.siteLabel('example.com'), null);
});

test('swapUrl：保留路径、查询参数与锚点', () => {
  assert.equal(
    lib.swapUrl('https://bgm.tv/anime/browser?sort=rank&page=2#item-3'),
    'https://bangumi.tv/anime/browser?sort=rank&page=2#item-3',
  );
  assert.equal(
    lib.swapUrl('https://bangumi.tv/subject/12345/ep'),
    'https://bgm.tv/subject/12345/ep',
  );
});

test('swapUrl：中文路径与编码保持不变', () => {
  const from = 'https://bgm.tv/user/%E5%B0%8F%E6%98%8E?from=home';
  assert.equal(lib.swapUrl(from), 'https://bangumi.tv/user/%E5%B0%8F%E6%98%8E?from=home');
});

test('swapUrl：http 自动升级为 https，且丢弃端口', () => {
  assert.equal(lib.swapUrl('http://bgm.tv/anime'), 'https://bangumi.tv/anime');
  assert.equal(lib.swapUrl('https://bgm.tv:8443/anime'), 'https://bangumi.tv/anime');
  assert.equal(
    lib.swapUrl('http://bgm.tv/anime', { forceHttps: false }),
    'http://bangumi.tv/anime',
  );
});

test('swapUrl：非 Bangumi 页面返回 null', () => {
  assert.equal(lib.swapUrl('https://example.com/'), null);
  assert.equal(lib.swapUrl('https://api.bgm.tv/v0/subjects'), null);
  assert.equal(lib.swapUrl('chrome://extensions/'), null);
  assert.equal(lib.swapUrl('not a url'), null);
});

test('buildSwitchedUrl：指定目标域名', () => {
  assert.equal(
    lib.buildSwitchedUrl('https://bgm.tv/anime', 'bangumi.tv'),
    'https://bangumi.tv/anime',
  );
  assert.equal(
    lib.buildSwitchedUrl('https://www.bgm.tv/user/a', 'bgm.tv'),
    'https://bgm.tv/user/a',
  );
  assert.equal(
    lib.buildSwitchedUrl('https://bgm.tv/anime', 'BANGUMI.TV'),
    'https://bangumi.tv/anime',
  );
});

test('buildSwitchedUrl：非法目标或当前页返回 null', () => {
  assert.equal(lib.buildSwitchedUrl('https://bgm.tv/anime', 'example.com'), null);
  assert.equal(lib.buildSwitchedUrl('https://bgm.tv/anime', 'api.bgm.tv'), null);
  assert.equal(lib.buildSwitchedUrl('https://example.com/', 'bgm.tv'), null);
  assert.equal(lib.buildSwitchedUrl('', 'bgm.tv'), null);
});

test('normalizeTheme：只接受 auto / light / dark', () => {
  assert.equal(lib.normalizeTheme('auto'), 'auto');
  assert.equal(lib.normalizeTheme('light'), 'light');
  assert.equal(lib.normalizeTheme('dark'), 'dark');
  assert.equal(lib.normalizeTheme('DARK'), 'auto');
  assert.equal(lib.normalizeTheme(undefined), 'auto');
  assert.equal(lib.normalizeTheme(null), 'auto');
  assert.equal(lib.normalizeTheme('system'), 'auto');
});

test('DEFAULT_SETTINGS：默认显示滑块、自动主题', () => {
  assert.equal(lib.DEFAULT_SETTINGS.sliderHidden, false);
  assert.equal(lib.DEFAULT_SETTINGS.theme, 'auto');
  assert.ok(Object.isFrozen(lib.DEFAULT_SETTINGS));
});

/*
 * Bangumi 域名切换 —— 共享工具函数
 *
 * 该文件同时被以下环境加载：
 *   - 后台 Service Worker（background.js 通过 importScripts 引入）
 *   - 页面内容脚本（manifest.json 中的 content_scripts）
 *   - Node.js 单元测试（dev/lib.test.mjs）
 *
 * 所有函数均为纯函数，不依赖 DOM 或 chrome.* API。
 */
(function (root, factory) {
  'use strict';

  var api = factory();

  // 浏览器扩展 / 内容脚本：挂到全局对象上供其他脚本使用
  if (root) {
    root.BgmDomainSwitcher = api;
  }

  // Node.js（单元测试）：同时导出 CommonJS 模块
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 表单顺序决定滑块左右两侧的顺序：左侧 Bangumi(bangumi.tv)，右侧 Bgm(bgm.tv)。 */
  var SITES = Object.freeze([
    Object.freeze({ host: 'bangumi.tv', label: 'Bangumi' }),
    Object.freeze({ host: 'bgm.tv', label: 'Bgm' }),
  ]);

  var SITE_HOSTS = Object.freeze(SITES.map(function (site) {
    return site.host;
  }));

  /** content script / options / background 共用的默认设置。 */
  var DEFAULT_SETTINGS = Object.freeze({
    /** 用户点过滑块上的 × 之后为 true，此时不再注入滑块。 */
    sliderHidden: false,
    /** auto：跟随 Bangumi 页面明暗；light / dark：强制指定。 */
    theme: 'auto',
  });

  var THEMES = Object.freeze(['auto', 'light', 'dark']);

  /**
   * 规范化主机名：去空格、转小写、去掉末尾的点。
   * @param {string} hostname
   * @returns {string}
   */
  function normalizeHost(hostname) {
    if (!hostname) return '';
    return String(hostname).trim().toLowerCase().replace(/\.+$/, '');
  }

  /**
   * 判断主机名是否属于 Bangumi 站点，是则返回规范化的站点域名，否则返回 null。
   * 同时兼容 www. 前缀和各处传入的大小写。
   * @param {string} hostname
   * @returns {'bangumi.tv'|'bgm.tv'|null}
   */
  function siteForHost(hostname) {
    var host = normalizeHost(hostname).replace(/^www\./, '');
    return SITE_HOSTS.indexOf(host) === -1 ? null : host;
  }

  /**
   * 返回另一个站点域名；当前不是 Bangumi 域名时返回 null。
   * @param {string} hostname
   * @returns {'bangumi.tv'|'bgm.tv'|null}
   */
  function otherSite(hostname) {
    var site = siteForHost(hostname);
    if (!site) return null;
    return site === SITE_HOSTS[0] ? SITE_HOSTS[1] : SITE_HOSTS[0];
  }

  /**
   * 返回站点在滑块上显示的文字。
   * @param {string} hostname
   * @returns {string|null}
   */
  function siteLabel(hostname) {
    var site = siteForHost(hostname);
    if (!site) return null;
    for (var i = 0; i < SITES.length; i += 1) {
      if (SITES[i].host === site) return SITES[i].label;
    }
    return null;
  }

  /**
   * 把 href 的主机名换成 targetHost，保留协议、路径、查询参数与锚点。
   * 不是 Bangumi 域名或目标域名非法时返回 null。
   *
   * @param {string} href 当前页面完整 URL
   * @param {string} targetHost 目标域名（bangumi.tv / bgm.tv）
   * @param {{ forceHttps?: boolean }} [options]
   * @returns {string|null}
   */
  function buildSwitchedUrl(href, targetHost, options) {
    var opts = options || {};
    var forceHttps = opts.forceHttps !== false;

    var url;
    try {
      url = new URL(href);
    } catch (error) {
      return null;
    }

    if (!siteForHost(url.hostname)) return null;

    var target = normalizeHost(targetHost).replace(/^www\./, '');
    if (SITE_HOSTS.indexOf(target) === -1) return null;

    if (forceHttps && (url.protocol === 'http:' || url.protocol === 'https:')) {
      url.protocol = 'https:';
    }

    url.hostname = target;
    url.port = '';
    return url.toString();
  }

  /**
   * 把当前页面 URL 切换到另一个站点。
   * @param {string} href
   * @param {{ forceHttps?: boolean }} [options]
   * @returns {string|null}
   */
  function swapUrl(href, options) {
    var url;
    try {
      url = new URL(href);
    } catch (error) {
      return null;
    }

    var target = otherSite(url.hostname);
    if (!target) return null;
    return buildSwitchedUrl(href, target, options);
  }

  /**
   * 校验设置里的主题值。
   * @param {unknown} value
   * @returns {'auto'|'light'|'dark'}
   */
  function normalizeTheme(value) {
    return THEMES.indexOf(value) === -1 ? 'auto' : /** @type {'auto'|'light'|'dark'} */ (value);
  }

  return Object.freeze({
    SITES: SITES,
    SITE_HOSTS: SITE_HOSTS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    THEMES: THEMES,
    normalizeHost: normalizeHost,
    siteForHost: siteForHost,
    otherSite: otherSite,
    siteLabel: siteLabel,
    buildSwitchedUrl: buildSwitchedUrl,
    swapUrl: swapUrl,
    normalizeTheme: normalizeTheme,
  });
});

/*
 * Bangumi 域名切换 —— 页面内滑块
 *
 * 在 bgm.tv / bangumi.tv 页面左下角注入一个与 Bangumi 原站风格一致的
 * “Bangumi / Bgm” 滑块：
 *   - 点击未选中的一侧，切换到对应域名（保留路径、查询参数与锚点）。
 *   - 点击右侧 × 可隐藏滑块，选择会保存在 chrome.storage.local。
 *   - 使用 Shadow DOM 隔离样式，既不被 Bangumi 的 CSS 影响，也不污染原站。
 *   - 自动模式下会根据页面实际背景明暗选择浅色 / 深色外观。
 */
(function () {
  'use strict';

  var lib = globalThis.BgmDomainSwitcher;
  if (!lib) return;
  if (window.top !== window.self) return; // 不在 iframe 内重复注入

  var currentSite = lib.siteForHost(location.hostname);
  if (!currentSite) return;

  var HOST_ID = 'bgm-domain-switcher-host';
  var DEFAULT_SETTINGS = lib.DEFAULT_SETTINGS;

  // 扩展重载 / 重复安装时，同一页面可能被注入两次，避免叠出两个滑块。
  if (document.getElementById(HOST_ID)) return;

  var settings = { sliderHidden: false, theme: 'auto' };
  var mounted = false;
  var closing = false;
  var hostEl = null;
  var refs = null;
  var observer = null;
  var bodyObserver = null;
  var themeObserver = null;
  var themeTimer = 0;
  var closeTimer = 0;
  var toastTimer = 0;

  var CSS = [
    '.bdsw, .bdsw * { box-sizing: border-box; }',
    '.bdsw {',
    '  --bdsw-pink: #f09199;',
    '  --bdsw-pink-deep: #e67e87;',
    '  --bdsw-bg: #ffffff;',
    '  --bdsw-track-bg: rgba(0, 0, 0, 0.055);',
    '  --bdsw-border: rgba(0, 0, 0, 0.10);',
    '  --bdsw-text: #3a3a3a;',
    '  --bdsw-muted: #6f6f6f;',
    '  --bdsw-shadow: 0 6px 18px rgba(0, 0, 0, 0.13), 0 1px 3px rgba(0, 0, 0, 0.08);',
    '  position: relative;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 3px;',
    '  padding: 3px 4px 3px 3px;',
    '  border: 1px solid var(--bdsw-border);',
    '  border-radius: 999px;',
    '  background: var(--bdsw-bg);',
    '  box-shadow: var(--bdsw-shadow);',
    '  color: var(--bdsw-text);',
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;",
    '  font-size: 12px;',
    '  font-weight: 500;',
    '  font-style: normal;',
    '  line-height: 1;',
    '  letter-spacing: normal;',
    '  text-align: left;',
    '  text-transform: none;',
    '  white-space: nowrap;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '  -webkit-tap-highlight-color: transparent;',
    '  animation: bdsw-in 260ms cubic-bezier(0.22, 0.8, 0.28, 1) both;',
    '}',
    '.bdsw[data-theme="dark"] {',
    '  --bdsw-bg: #2c2c31;',
    '  --bdsw-track-bg: rgba(255, 255, 255, 0.08);',
    '  --bdsw-border: rgba(255, 255, 255, 0.14);',
    '  --bdsw-text: #e6e6e6;',
    '  --bdsw-muted: #b8b8b8;',
    '  --bdsw-shadow: 0 6px 18px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.35);',
    '}',
    '.bdsw-track {',
    '  position: relative;',
    '  display: flex;',
    '  align-items: stretch;',
    '  width: 146px;',
    '  height: 32px;',
    '  padding: 2px;',
    '  border-radius: 999px;',
    '  background: var(--bdsw-track-bg);',
    '}',
    '.bdsw-thumb {',
    '  position: absolute;',
    '  top: 2px;',
    '  bottom: 2px;',
    '  left: 2px;',
    '  width: calc(50% - 2px);',
    '  border-radius: 999px;',
    '  background: linear-gradient(180deg, #f7a6ad 0%, var(--bdsw-pink) 55%, var(--bdsw-pink-deep) 100%);',
    '  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.35);',
    '  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);',
    '  pointer-events: none;',
    '}',
    '.bdsw-track.is-right .bdsw-thumb { transform: translateX(100%); }',
    '.bdsw-opt {',
    '  position: relative;',
    '  z-index: 1;',
    '  width: 50%;',
    '  height: 28px;',
    '  margin: 0;',
    '  padding: 0 6px;',
    '  border: 0;',
    '  border-radius: 999px;',
    '  background: transparent;',
    '  color: var(--bdsw-muted);',
    '  font: inherit;',
    '  font-size: 12px;',
    '  font-weight: 500;',
    '  letter-spacing: 0.01em;',
    '  text-align: center;',
    '  cursor: pointer;',
    '  appearance: none;',
    '  -webkit-appearance: none;',
    '  transition: color 160ms ease, background-color 160ms ease;',
    '}',
    '.bdsw-opt.is-active { color: #ffffff; cursor: default; text-shadow: 0 1px 0 rgba(0, 0, 0, 0.08); }',
    '.bdsw-opt:not(.is-active):hover { color: var(--bdsw-text); background: var(--bdsw-track-bg); }',
    '.bdsw-opt:not(.is-active):active { transform: scale(0.98); }',
    '.bdsw-close {',
    '  position: relative;',
    '  z-index: 1;',
    '  display: inline-flex;',
    '  flex: 0 0 auto;',
    '  align-items: center;',
    '  justify-content: center;',
    '  width: 22px;',
    '  height: 22px;',
    '  margin-left: 1px;',
    '  padding: 0;',
    '  border: 0;',
    '  border-radius: 50%;',
    '  background: transparent;',
    '  color: var(--bdsw-muted);',
    '  opacity: 0.62;',
    '  cursor: pointer;',
    '  appearance: none;',
    '  -webkit-appearance: none;',
    '  transition: opacity 160ms ease, color 160ms ease, background-color 160ms ease, transform 120ms ease;',
    '}',
    '.bdsw-close:hover { opacity: 1; color: var(--bdsw-pink-deep); background: var(--bdsw-track-bg); }',
    '.bdsw-close::before { content: ""; position: absolute; inset: -4px; border-radius: 50%; }',
    '.bdsw-close:active { transform: scale(0.9); }',
    '.bdsw button:focus-visible { outline: 2px solid rgba(240, 145, 153, 0.72); outline-offset: 1px; }',
    '.bdsw-toast {',
    '  position: absolute;',
    '  bottom: calc(100% + 9px);',
    '  left: 0;',
    '  max-width: 280px;',
    '  padding: 7px 10px;',
    '  border: 1px solid var(--bdsw-border);',
    '  border-radius: 8px;',
    '  background: var(--bdsw-bg);',
    '  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);',
    '  color: var(--bdsw-text);',
    '  font-size: 11px;',
    '  font-weight: 400;',
    '  line-height: 1.5;',
    '  white-space: nowrap;',
    '  opacity: 0;',
    '  transform: translateY(4px);',
    '  pointer-events: none;',
    '  transition: opacity 200ms ease, transform 200ms ease;',
    '}',
    '.bdsw.is-toast .bdsw-toast { opacity: 1; transform: translateY(0); }',
    '.bdsw.is-bump { animation: bdsw-bump 240ms ease; }',
    '.bdsw.is-switching { opacity: 0.72; }',
    '@keyframes bdsw-in {',
    '  from { opacity: 0; transform: translateY(6px) scale(0.98); }',
    '  to { opacity: 1; transform: translateY(0) scale(1); }',
    '}',
    '@keyframes bdsw-bump {',
    '  0%, 100% { transform: translateX(0); }',
    '  30% { transform: translateX(-2px); }',
    '  60% { transform: translateX(2px); }',
    '}',
    '@media (max-width: 480px) {',
    '  .bdsw { font-size: 11px; padding: 2px 3px 2px 2px; }',
    '  .bdsw-track { width: 132px; height: 30px; }',
    '  .bdsw-opt { height: 26px; font-size: 11px; padding: 0 4px; }',
    '  .bdsw-close { width: 20px; height: 20px; }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .bdsw, .bdsw-thumb { animation: none !important; transition: none !important; }',
    '}',
    '@media print {',
    '  .bdsw { display: none !important; }',
    '}',
  ].join('\n');

  init();

  /* ---------------------------------------------------------------- */
  /* 初始化与状态                                                      */
  /* ---------------------------------------------------------------- */

  async function init() {
    // 先注册监听再读取设置，最后再读一次，避免“读取完成 → 监听注册”之间
    // 其他标签页（或设置页）的修改被漏掉。
    watchStorage();
    watchColorScheme();
    watchThemeAttributes();
    watchPageShow();

    settings = await readSettings();
    settings = await readSettings();

    if (!settings.sliderHidden) {
      mount();
    }
  }

  async function readSettings() {
    var fallback = {
      sliderHidden: DEFAULT_SETTINGS.sliderHidden,
      theme: DEFAULT_SETTINGS.theme,
    };

    try {
      var storage = getStorage();
      if (storage && storage.local) {
        var stored = await storage.local.get(fallback);
        return {
          sliderHidden: Boolean(stored.sliderHidden),
          theme: lib.normalizeTheme(stored.theme),
        };
      }
    } catch (error) {
      // 扩展更新后旧页面会失去 chrome.* 上下文，静默降级为默认设置。
    }

    return fallback;
  }

  function getStorage() {
    try {
      if (typeof chrome !== 'undefined' && chrome && chrome.storage) {
        return chrome.storage;
      }
    } catch (error) {
      /* ignore */
    }
    return null;
  }

  /**
   * 写入设置。返回 Promise，供调用方确认保存成功后再做 UI 变更。
   * @param {object} patch
   * @returns {Promise<void>}
   */
  function persistSettings(patch) {
    try {
      var storage = getStorage();
      if (!storage || !storage.local) {
        return Promise.reject(new Error('chrome.storage 不可用'));
      }

      var result = storage.local.set(patch);
      return result && typeof result.then === 'function' ? result : Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function watchStorage() {
    try {
      var storage = getStorage();
      if (!storage || !storage.onChanged || typeof storage.onChanged.addListener !== 'function') return;

      storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'local' || !changes) return;

        if (changes.sliderHidden) {
          var hidden = Boolean(changes.sliderHidden.newValue);
          settings.sliderHidden = hidden;

          if (hidden) {
            if (!closing) unmount();
          } else {
            closing = false;
            window.clearTimeout(closeTimer);
            mount();
          }
        }

        if (changes.theme) {
          settings.theme = lib.normalizeTheme(changes.theme.newValue);
          if (mounted) applyTheme();
        }
      });
    } catch (error) {
      /* ignore */
    }
  }

  function watchColorScheme() {
    try {
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () {
        if (settings.theme === 'auto' && mounted) applyTheme();
      };
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange);
      } else if (typeof media.addListener === 'function') {
        media.addListener(onChange);
      }
    } catch (error) {
      /* ignore */
    }
  }

  /**
   * Bangumi 切换站内深色模式时通常只改 html / body 的 class 或样式，
   * 这里监听属性变化，让“自动”主题能跟着站内主题走。
   */
  function watchThemeAttributes() {
    try {
      var onChange = function () {
        if (settings.theme !== 'auto' || !mounted) return;
        window.clearTimeout(themeTimer);
        themeTimer = window.setTimeout(function () {
          if (mounted) applyTheme();
        }, 120);
      };

      themeObserver = new MutationObserver(onChange);
      var options = {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-theme-mode'],
      };

      if (document.documentElement) themeObserver.observe(document.documentElement, options);
      if (document.body) themeObserver.observe(document.body, options);
    } catch (error) {
      /* ignore */
    }
  }

  function watchPageShow() {
    window.addEventListener('pageshow', async function (event) {
      // 从 bfcache 返回时 DOM 被还原，重新读取设置并同步状态。
      if (!event.persisted) return;

      settings = await readSettings();

      if (settings.sliderHidden) {
        if (mounted) unmount();
        return;
      }

      if (!mounted) {
        mount();
      } else {
        syncActive();
        applyTheme();
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* DOM                                                               */
  /* ---------------------------------------------------------------- */

  function mount() {
    if (mounted) return;
    if (!document.body && !document.documentElement) return;

    mounted = true;
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.style.cssText = [
      'all: initial',
      'position: fixed',
      'left: 16px',
      'bottom: calc(16px + env(safe-area-inset-bottom, 0px))',
      'z-index: 2147483000',
      'display: block',
      'width: auto',
      'height: auto',
      'margin: 0',
      'padding: 0',
      'border: 0',
      'background: transparent',
      'box-sizing: border-box',
      'pointer-events: auto',
    ].join(';');

    var shadow = hostEl.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    var wrap = document.createElement('div');
    wrap.className = 'bdsw-wrap';
    wrap.innerHTML = [
      '<div class="bdsw" role="group" aria-label="Bangumi 域名切换">',
      '  <div class="bdsw-track">',
      '    <span class="bdsw-thumb" aria-hidden="true"></span>',
      '    <button type="button" class="bdsw-opt" data-host="bangumi.tv" title="切换到 bangumi.tv">Bangumi</button>',
      '    <button type="button" class="bdsw-opt" data-host="bgm.tv" title="切换到 bgm.tv">Bgm</button>',
      '  </div>',
      '  <button type="button" class="bdsw-close" aria-label="隐藏滑块" title="隐藏滑块（可在扩展设置中重新开启）">',
      '    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">',
      '      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
      '    </svg>',
      '  </button>',
      '  <div class="bdsw-toast" role="status" aria-live="polite"></div>',
      '</div>',
    ].join('\n');
    shadow.appendChild(wrap);

    var widget = wrap.querySelector('.bdsw');
    refs = {
      wrap: wrap,
      widget: widget,
      track: wrap.querySelector('.bdsw-track'),
      toast: wrap.querySelector('.bdsw-toast'),
      options: Array.prototype.slice.call(wrap.querySelectorAll('.bdsw-opt')),
      close: wrap.querySelector('.bdsw-close'),
    };

    refs.options.forEach(function (button) {
      button.addEventListener('click', function () {
        onOptionClick(button);
      });
    });
    refs.close.addEventListener('click', onClose);

    (document.body || document.documentElement).appendChild(hostEl);

    applyTheme();
    syncActive();
    watchRemoval();
  }

  function unmount() {
    if (!mounted) return;

    mounted = false;
    closing = false;
    window.clearTimeout(closeTimer);
    window.clearTimeout(toastTimer);
    window.clearTimeout(themeTimer);

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }

    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }

    hostEl = null;
    refs = null;
  }

  function watchRemoval() {
    if (observer) observer.disconnect();
    if (bodyObserver) bodyObserver.disconnect();

    try {
      // body 的直接子节点变化：站点重绘 body 内容时把滑块挂回去。
      bodyObserver = new MutationObserver(function () {
        ensureHostMounted();
      });
      if (document.body) {
        bodyObserver.observe(document.body, { childList: true, subtree: false });
      }

      // body 被整体替换（或 html 的子节点变化）时，重新绑定 bodyObserver。
      observer = new MutationObserver(function () {
        if (!mounted) return;
        if (bodyObserver) {
          bodyObserver.disconnect();
          if (document.body) {
            bodyObserver.observe(document.body, { childList: true, subtree: false });
          }
        }
        ensureHostMounted();
      });
      observer.observe(document.documentElement, { childList: true, subtree: false });
    } catch (error) {
      /* ignore */
    }
  }

  function ensureHostMounted() {
    if (!mounted || !hostEl) return;
    if (hostEl.isConnected) return;

    (document.body || document.documentElement).appendChild(hostEl);
    syncActive();
    applyTheme();
  }

  /* ---------------------------------------------------------------- */
  /* 交互                                                              */
  /* ---------------------------------------------------------------- */

  function onOptionClick(button) {
    var targetHost = button.getAttribute('data-host');
    if (!targetHost || !refs) return;

    var active = lib.siteForHost(location.hostname) || currentSite;
    if (targetHost === active) {
      refs.widget.classList.remove('is-bump');
      void refs.widget.offsetWidth; // 重启动画
      refs.widget.classList.add('is-bump');
      window.setTimeout(function () {
        if (refs) refs.widget.classList.remove('is-bump');
      }, 260);
      return;
    }

    var targetUrl = lib.buildSwitchedUrl(location.href, targetHost);
    if (!targetUrl) return;

    refs.widget.classList.add('is-switching');
    window.location.assign(targetUrl);

    // 如果 beforeunload 确认框被取消（页面没有跳转），把变暗状态恢复。
    window.setTimeout(function () {
      if (refs) refs.widget.classList.remove('is-switching');
    }, 4000);
  }

  async function onClose() {
    if (closing) return;
    closing = true;

    try {
      // 先确认隐藏状态真的写入成功，再移除滑块。
      await persistSettings({ sliderHidden: true });
    } catch (error) {
      closing = false;
      showToast('隐藏失败，请稍后重试');
      return;
    }

    // 等待期间如果已被其它入口重新打开，则不再隐藏。
    if (!closing) return;

    settings.sliderHidden = true;
    showToast('滑块已隐藏 · 可在扩展设置中重新开启');

    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(function () {
      unmount();
    }, 1900);
  }

  function showToast(text) {
    if (!refs) return;
    refs.toast.textContent = text;
    refs.widget.classList.add('is-toast');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      if (refs) refs.widget.classList.remove('is-toast');
    }, 2200);
  }

  function syncActive() {
    if (!refs) return;

    var active = lib.siteForHost(location.hostname) || currentSite;
    var isRight = active === lib.SITES[1].host;

    refs.track.classList.toggle('is-right', isRight);
    refs.options.forEach(function (button) {
      var on = button.getAttribute('data-host') === active;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.tabIndex = 0;
    });
  }

  /* ---------------------------------------------------------------- */
  /* 主题                                                              */
  /* ---------------------------------------------------------------- */

  function applyTheme() {
    if (!refs) return;
    refs.widget.setAttribute('data-theme', resolveTheme());
  }

  function resolveTheme() {
    if (settings.theme === 'light') return 'light';
    if (settings.theme === 'dark') return 'dark';

    // 页面背景能明确判断明暗时，以页面为准；只有无法判断时才跟随系统。
    var siteTheme = detectSiteTheme();
    if (siteTheme) return siteTheme;

    try {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (error) {
      /* ignore */
    }
    return 'light';
  }

  /**
   * 根据页面实际背景亮度判断站点主题。
   * @returns {'light'|'dark'|null} 无法判断（背景透明）时返回 null
   */
  function detectSiteTheme() {
    var elements = [document.body, document.documentElement];

    for (var i = 0; i < elements.length; i += 1) {
      var element = elements[i];
      if (!element) continue;

      var color = parseCssColor(window.getComputedStyle(element).backgroundColor);
      if (color && color.a > 0.5) {
        return relativeLuminance(color) < 0.4 ? 'dark' : 'light';
      }
    }

    return null;
  }

  function parseCssColor(value) {
    var text = String(value || '').trim();

    // 传统 rgb() / rgba()
    var rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
    if (rgb) {
      return buildColor(rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number), 1);
    }

    // 现代 color(srgb r g b / a)，各通道为 0–1
    var srgb = /^color\(srgb\s+([^)]+)\)$/i.exec(text);
    if (srgb) {
      return buildColor(srgb[1].split(/[\s/]+/).filter(Boolean).map(Number), 255);
    }

    return null;
  }

  function buildColor(parts, scale) {
    if (parts.length < 3) return null;
    if (Number.isNaN(parts[0]) || Number.isNaN(parts[1]) || Number.isNaN(parts[2])) return null;

    var alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
    return {
      r: parts[0] * scale,
      g: parts[1] * scale,
      b: parts[2] * scale,
      a: alpha,
    };
  }

  function srgbToLinear(channel) {
    var value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(color) {
    return (
      0.2126 * srgbToLinear(color.r) +
      0.7152 * srgbToLinear(color.g) +
      0.0722 * srgbToLinear(color.b)
    );
  }
})();

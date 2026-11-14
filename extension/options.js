/*
 * Bangumi 域名切换 —— 设置页逻辑
 * 所有设置项修改后立即写入 chrome.storage.local，内容脚本通过
 * storage.onChanged 实时响应，无需刷新页面。
 */
(function () {
  'use strict';

  var lib = globalThis.BgmDomainSwitcher;
  var DEFAULTS = lib.DEFAULT_SETTINGS;

  var state = {
    sliderHidden: DEFAULTS.sliderHidden,
    theme: DEFAULTS.theme,
  };

  var refs = {
    visible: document.getElementById('slider-visible'),
    themeInputs: Array.prototype.slice.call(document.querySelectorAll('input[name="theme"]')),
    preview: document.getElementById('slider-preview'),
    version: document.getElementById('version'),
    status: document.getElementById('status'),
    toast: document.getElementById('toast'),
    reset: document.getElementById('reset'),
  };

  var toastTimer = 0;
  var statusTimer = 0;

  init();

  async function init() {
    try {
      var manifest = chrome.runtime.getManifest();
      refs.version.textContent = manifest.version;
    } catch (error) {
      /* ignore */
    }

    bindEvents();
    await load();
    watchStorage();
  }

  async function load() {
    var loadFailed = false;

    try {
      var stored = await chrome.storage.local.get(DEFAULTS);
      state.sliderHidden = Boolean(stored.sliderHidden);
      state.theme = lib.normalizeTheme(stored.theme);
    } catch (error) {
      loadFailed = true;
    }

    render();
    setStatus(loadFailed ? '读取设置失败，已使用默认值' : '设置已自动保存');
  }

  function bindEvents() {
    refs.visible.addEventListener('change', function () {
      save({ sliderHidden: !refs.visible.checked }, refs.visible.checked ? '已显示左下角滑块' : '已隐藏左下角滑块');
    });

    refs.themeInputs.forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        save({ theme: lib.normalizeTheme(input.value) }, '已更新滑块主题');
      });
    });

    refs.reset.addEventListener('click', function () {
      refs.visible.checked = true;
      refs.themeInputs.forEach(function (input) {
        input.checked = input.value === DEFAULTS.theme;
      });
      save({ sliderHidden: DEFAULTS.sliderHidden, theme: DEFAULTS.theme }, '已恢复默认设置');
    });
  }

  async function save(patch, message) {
    var previous = { sliderHidden: state.sliderHidden, theme: state.theme };
    Object.assign(state, patch);

    try {
      await chrome.storage.local.set(patch);
    } catch (error) {
      // 保存失败时回滚界面，避免开关显示已保存但实际没写进去。
      state.sliderHidden = previous.sliderHidden;
      state.theme = previous.theme;
      render();
      showToast('保存失败，请重试');
      setStatus('保存失败，请重试', true);
      return;
    }

    render();
    showToast(message || '已保存');
    setStatus('设置已自动保存');
  }

  function render() {
    refs.visible.checked = !state.sliderHidden;

    refs.themeInputs.forEach(function (input) {
      input.checked = input.value === state.theme;
    });

    // 预览：auto 模式下设置页本身是浅色页面，按浅色展示。
    var previewTheme = state.theme === 'dark' ? 'dark' : 'light';
    refs.preview.setAttribute('data-theme', previewTheme);
  }

  function watchStorage() {
    try {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'local' || !changes) return;

        var changed = false;
        if (changes.sliderHidden) {
          state.sliderHidden = Boolean(changes.sliderHidden.newValue);
          changed = true;
        }
        if (changes.theme) {
          state.theme = lib.normalizeTheme(changes.theme.newValue);
          changed = true;
        }

        if (changed) render();
      });
    } catch (error) {
      /* ignore */
    }
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      refs.toast.classList.remove('show');
    }, 1600);
  }

  /**
   * @param {string} message
   * @param {boolean} [persistent] 为 true 时保持错误信息，不自动恢复成功文案
   */
  function setStatus(message, persistent) {
    refs.status.textContent = message;
    window.clearTimeout(statusTimer);
    if (persistent) return;
    statusTimer = window.setTimeout(function () {
      refs.status.textContent = '设置已自动保存';
    }, 2400);
  }
})();

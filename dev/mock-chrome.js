/*
 * 本地预览用的 chrome.storage 模拟实现。
 * 只实现 content.js 用到的 API：storage.local.get/set 与 storage.onChanged。
 * 打开 dev/preview.html 时在 lib.js / content.js 之前加载。
 */
(function () {
  'use strict';

  var store = {};
  var listeners = [];

  function buildResult(defaults) {
    var result = {};
    if (defaults && typeof defaults === 'object') {
      Object.keys(defaults).forEach(function (key) {
        result[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : defaults[key];
      });
    }
    return result;
  }

  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {
    id: 'local-preview',
    getManifest: function () {
      return { version: '1.0.0-preview' };
    },
    getURL: function (path) {
      return path;
    },
  };

  window.chrome.storage = {
    local: {
      get: function (defaults) {
        return Promise.resolve(buildResult(defaults));
      },
      set: function (patch) {
        var changes = {};
        Object.keys(patch).forEach(function (key) {
          changes[key] = { oldValue: store[key], newValue: patch[key] };
          store[key] = patch[key];
        });
        // 模拟 Chrome 的行为：只发出实际发生变化的键。
        var meaningful = false;
        Object.keys(changes).forEach(function (key) {
          if (changes[key].oldValue !== changes[key].newValue) meaningful = true;
        });
        // 模拟 Chrome 的行为：异步触发 onChanged（Chrome 不会在 set 内同步回调）。
        if (meaningful) {
          window.setTimeout(function () {
            listeners.forEach(function (listener) {
              try {
                listener(changes, 'local');
              } catch (error) {
                console.error('[mock-chrome] onChanged listener failed:', error);
              }
            });
          }, 0);
        }
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener: function (listener) {
        listeners.push(listener);
      },
      removeListener: function (listener) {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      },
    },
  };
})();

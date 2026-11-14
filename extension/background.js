/*
 * Bangumi 域名切换 —— 后台 Service Worker
 *
 * 职责：
 *   1. 点击工具栏图标：把当前标签页在 bgm.tv / bangumi.tv 之间切换（保留路径、参数、锚点）。
 *   2. 右键菜单：切换域名 / 显示或隐藏页面左下角滑块 / 打开设置。
 *   3. 初始化设置默认值。
 *   4. 根据当前标签页域名更新图标提示文字。
 */
'use strict';

importScripts('lib.js');

var lib = globalThis.BgmDomainSwitcher;

var MENU = Object.freeze({
  switchDomain: 'bgm-switch-domain',
  toggleSlider: 'bgm-toggle-slider',
  options: 'bgm-options',
  actionSwitch: 'bgm-action-switch',
  actionToggle: 'bgm-action-toggle',
  actionOptions: 'bgm-action-options',
});

var BADGE_COLOR = '#f09199';
var BADGE_DURATION = 2000;

var BANGUMI_PAGE_PATTERNS = Object.freeze([
  '*://bgm.tv/*',
  '*://www.bgm.tv/*',
  '*://bangumi.tv/*',
  '*://www.bangumi.tv/*',
]);

var ACTION_TITLE_DEFAULT = 'Bangumi 域名切换';

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(function () {
  ensureDefaultSettings();
  createContextMenus();
  refreshActiveTabTitle();
});

chrome.runtime.onStartup.addListener(function () {
  ensureDefaultSettings();
  refreshActiveTabTitle();
});

/* ------------------------------------------------------------------ */
/* 工具栏图标点击                                                      */
/* ------------------------------------------------------------------ */

chrome.action.onClicked.addListener(function (tab) {
  handleToolbarAction(tab);
});

/**
 * 点击图标 / 右键菜单“切换域名”时的处理。
 * @param {chrome.tabs.Tab|undefined} tab
 */
async function handleToolbarAction(tab) {
  if (!tab || typeof tab.id !== 'number') return;

  var url = tab.url;
  if (!url) {
    // activeTab 授权后一般都能拿到；拿不到时再尝试读取一次。
    try {
      var freshTab = await chrome.tabs.get(tab.id);
      url = freshTab && freshTab.url;
    } catch (error) {
      url = null;
    }
  }

  if (!url) {
    await flashBadge(tab.id, '?');
    return;
  }

  var target = lib.swapUrl(url);
  if (!target) {
    await flashBadge(tab.id, '!');
    return;
  }

  try {
    await chrome.tabs.update(tab.id, { url: target });
  } catch (error) {
    console.warn('[Bangumi 域名切换] 无法更新标签页地址：', error);
    await flashBadge(tab.id, '!');
  }
}

/* ------------------------------------------------------------------ */
/* 右键菜单                                                            */
/* ------------------------------------------------------------------ */

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  switch (info.menuItemId) {
    case MENU.switchDomain:
    case MENU.actionSwitch:
      handleToolbarAction(tab);
      break;
    case MENU.toggleSlider:
    case MENU.actionToggle:
      toggleSliderVisibility();
      break;
    case MENU.options:
    case MENU.actionOptions:
      chrome.runtime.openOptionsPage();
      break;
    default:
      break;
  }
});

// 读取-修改-写回串行化，避免快速连续切换菜单项时两次都读到旧值。
var sliderToggleQueue = Promise.resolve();

function toggleSliderVisibility() {
  sliderToggleQueue = sliderToggleQueue
    .then(async function () {
      var stored = await chrome.storage.local.get({ sliderHidden: false });
      await chrome.storage.local.set({ sliderHidden: !stored.sliderHidden });
    })
    .catch(function (error) {
      console.warn('[Bangumi 域名切换] 无法切换滑块显示状态：', error);
    });

  return sliderToggleQueue;
}

function createContextMenus() {
  chrome.contextMenus.removeAll(function () {
    createMenu({
      id: MENU.switchDomain,
      title: '切换 Bangumi ↔ Bgm 域名',
      contexts: ['page'],
      documentUrlPatterns: BANGUMI_PAGE_PATTERNS,
    });
    createMenu({
      id: MENU.toggleSlider,
      title: '显示/隐藏左下角域名滑块',
      contexts: ['page'],
      documentUrlPatterns: BANGUMI_PAGE_PATTERNS,
    });
    createMenu({
      id: 'bgm-menu-separator',
      type: 'separator',
      contexts: ['page'],
      documentUrlPatterns: BANGUMI_PAGE_PATTERNS,
    });
    createMenu({
      id: MENU.options,
      title: '扩展设置…',
      contexts: ['page'],
    });

    // 右键工具栏图标（Chrome 123+ / 新版 Edge 支持；旧版本通过 lastError 报错并被忽略）
    createMenu({
      id: MENU.actionSwitch,
      title: '切换当前页面域名',
      contexts: ['action'],
    });
    createMenu({
      id: MENU.actionToggle,
      title: '显示/隐藏域名滑块',
      contexts: ['action'],
    });
    createMenu({
      id: MENU.actionOptions,
      title: '扩展设置…',
      contexts: ['action'],
    });
  });
}

function createMenu(props) {
  try {
    // contextMenus.create 的错误（例如旧版浏览器不支持 contexts: ['action']）
    // 通过回调 + chrome.runtime.lastError 报告，而不是抛异常。
    chrome.contextMenus.create(props, function () {
      var error = chrome.runtime.lastError;
      if (error) {
        console.warn('[Bangumi 域名切换] 创建右键菜单失败：', props && props.id, error.message || error);
      }
    });
  } catch (error) {
    console.warn('[Bangumi 域名切换] 创建右键菜单失败：', props && props.id, error);
  }
}

/* ------------------------------------------------------------------ */
/* 图标提示文字                                                        */
/* ------------------------------------------------------------------ */

function refreshActiveTabTitle() {
  chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    if (tabs && tabs[0] && typeof tabs[0].id === 'number') {
      refreshActionTitle(tabs[0].id);
    }
  }).catch(function () {
    /* 忽略：没有可用标签页 */
  });
}

/**
 * 在图标悬停提示里显示当前域名与切换目标。
 * @param {number} tabId
 */
async function refreshActionTitle(tabId) {
  if (typeof tabId !== 'number') return;

  var title = ACTION_TITLE_DEFAULT;
  try {
    var tab = await chrome.tabs.get(tabId);
    var url = tab && tab.url;
    if (url) {
      var host = new URL(url).hostname;
      var site = lib.siteForHost(host);
      if (site) {
        title = '当前 ' + site + ' · 点击切换到 ' + lib.otherSite(site);
      }
    }
    await chrome.action.setTitle({ tabId: tabId, title: title });
  } catch (error) {
    // 标签页可能已关闭，或被浏览器保护页面阻止访问。
  }
}

chrome.tabs.onActivated.addListener(function (activeInfo) {
  refreshActionTitle(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    refreshActionTitle(tabId);
  }
});

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

async function ensureDefaultSettings() {
  try {
    var stored = await chrome.storage.local.get(lib.DEFAULT_SETTINGS);
    var patch = {};
    Object.keys(lib.DEFAULT_SETTINGS).forEach(function (key) {
      if (stored[key] === undefined) patch[key] = lib.DEFAULT_SETTINGS[key];
    });
    if (Object.keys(patch).length > 0) {
      await chrome.storage.local.set(patch);
    }
  } catch (error) {
    console.warn('[Bangumi 域名切换] 初始化设置失败：', error);
  }
}

/**
 * 在图标角标上短暂显示提示（当前页面不是 Bangumi 时使用）。
 * @param {number} tabId
 * @param {string} text
 */
async function flashBadge(tabId, text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: BADGE_COLOR });
    await chrome.action.setBadgeText({ tabId: tabId, text: text });
    setTimeout(function () {
      chrome.action.setBadgeText({ tabId: tabId, text: '' }).catch(function () {
        /* 标签页可能已关闭 */
      });
    }, BADGE_DURATION);
  } catch (error) {
    console.warn('[Bangumi 域名切换] 无法显示角标：', error);
  }
}

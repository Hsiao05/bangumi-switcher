# Bangumi 域名切换扩展

一个 Chrome / Edge 的 Manifest V3 扩展：在 `bgm.tv` 与 `bangumi.tv` 之间一键切换，并在页面左下角注入一个与 Bangumi 原站风格一致的 **Bangumi / Bgm** 滑块。


![真实页面中的左下角滑块](docs/screenshots/real-site.png)

## 功能

- **点击工具栏图标**：当前页面立即在 `bgm.tv` ↔ `bangumi.tv` 之间切换，路径、查询参数、锚点全部保留。
  例如 `https://bgm.tv/anime/browser?sort=rank#item-3` → `https://bangumi.tv/anime/browser?sort=rank#item-3`。
- **页面左下角滑块**：与 Bangumi 原站一致的粉白胶囊样式，点 **Bangumi** 前往 `bangumi.tv`，点 **Bgm** 前往 `bgm.tv`，当前域名高亮显示。
- **可手动关闭**：点击滑块右侧的 `×` 即可隐藏；选择会持久保存，之后不再出现。
- **随时恢复**：可在扩展设置页打开开关，或右键网页 →「显示/隐藏左下角域名滑块」。
- **自动深色适配**：滑块会检测 Bangumi 页面实际背景明暗并自动切换外观，也可在设置里强制浅色 / 深色。
- **只在 Bangumi 站点出现**：其他网站不会注入任何 UI；iframe 内不重复注入。
- 非 Bangumi 页面点击图标时不会跳转，只在图标上短暂显示提示角标（通常为 `!`，无法读取地址时为 `?`）。
- 无网络请求、无数据上传、无追踪。

| 关闭滑块时的提示 | 设置页 |
| --- | --- |
| ![隐藏提示](docs/screenshots/toast.png) | ![设置页](docs/screenshots/options.png) |


## 安装

1. 下载并解压 `dist/bangumi-domain-switcher-1.0.0.zip`，或直接使用本仓库的 `extension/` 目录。
2. **Chrome**： `chrome://extensions` → 打开右上角「开发者模式」→ 点击「加载已解压的扩展程序」→ 选择包含 `manifest.json` 的目录。
3. **Edge**： `edge://extensions` → 打开左侧「开发人员模式」→ 点击「加载解压缩的扩展」→ 选择包含 `manifest.json` 的目录。
4. 打开 <https://bgm.tv/> 或 <https://bangumi.tv/>，左下角应出现滑块。


## 使用

| 操作 | 效果 |
| --- | --- |
| 点击工具栏图标 | 当前标签页在 `bgm.tv` ↔ `bangumi.tv` 之间切换 |
| 点击滑块上的 **Bangumi** | 跳到 `bangumi.tv` + 当前路径 |
| 点击滑块上的 **Bgm** | 跳到 `bgm.tv` + 当前路径 |
| 点击滑块上的 `×` | 隐藏滑块（记住选择） |
| 右键网页 | 「切换 Bangumi ↔ Bgm 域名」/「显示/隐藏左下角域名滑块」/「扩展设置…」 |
| 右键工具栏图标 | 同上（需要较新的 Chrome / Edge） |
| 扩展设置页 | 显示/隐藏滑块、选择主题、恢复默认设置 |

### 关闭滑块后如何恢复

任选一种：

- 打开扩展设置页（`chrome://extensions` 中点「详情」→「扩展程序选项」，或右键网页 →「扩展设置…」），打开「页面左下角域名滑块」开关；
- 右键任意 Bangumi 网页 →「显示/隐藏左下角域名滑块」；
- 右键工具栏图标 →「显示/隐藏域名滑块」。

## 域名切换规则

- 只替换主机名，**保留** path、query、hash。
- `http://` 会自动升级为 `https://`，并去掉非标准端口。
- 兼容 `www.bgm.tv` / `www.bangumi.tv` 这类写法，切换后使用裸域名。
- 子域名（如 `api.bgm.tv`）和非 Bangumi 域名不处理；点击图标只会显示 `!` 角标。扩展只在 `bgm.tv` / `bangumi.tv` 及其 `www` 页面注入，不会注入到 `api` 等子域。
- 支持 `bangumi.tv` / `bgm.tv` 两个域名的任意页面，包括条目、人物、小组、日志等。

## 设置

- **页面左下角域名滑块**：总开关，关闭后不再注入滑块。
- **滑块主题**：
  - `自动`（默认）：检测页面背景亮度并自动选择浅色 / 深色；页面背景无法判断时跟随系统的浅色 / 深色偏好；
  - `浅色` / `深色`：强制指定。
- **恢复默认设置**：把以上两项恢复为「显示滑块 + 自动主题」。

所有设置自动保存（`chrome.storage.local`），修改后已打开的 Bangumi 页面会**实时响应，无需刷新**。

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存滑块开关与主题 |
| `contextMenus` | 提供右键菜单 |
| `activeTab` | 点击工具栏图标后读取并更新当前标签页地址 |
| `host_permissions`（bgm.tv / bangumi.tv 的裸域名与 www） | 在这两个站点的页面注入滑块、读取页面地址以完成切换 |

扩展不申请 `tabs`、`cookies`、`webRequest` 等权限，不访问其他网站，不发送任何网络请求。

## 常见问题

- **刷新页面后滑块不见了？** 检查设置页的开关，或右键网页重新打开。滑块状态保存在扩展本地存储中。
- **切换域名后登录状态不一致？** Bangumi 两个域名的登录 Cookie 在部分情况下并不共享；如果切换后发现未登录，在目标域名登录一次即可，之后通常保持。
- **点击图标没反应？** 当前页面不是 Bangumi 站点时不会跳转，只会在图标上短暂显示提示角标（`!`；浏览器保护页面等无法读取地址的页面为 `?`）。
- **左下角被其他脚本遮挡？** 可以关闭滑块，仅使用工具栏图标切换；滑块 z-index 已设置为页面最高层级。
- **需要重新加载扩展？** 修改代码后，在 `chrome://extensions` 点扩展卡片上的刷新按钮，并刷新已打开的 Bangumi 页面。

## 目录结构

```
bangumi-domain-switcher/
├─ extension/                 # 扩展本体（加载这个目录 / zip 内容）
│  ├─ manifest.json           # MV3 清单
│  ├─ lib.js                  # 纯函数：域名识别、URL 切换、默认设置
│  ├─ background.js           # Service Worker：图标点击、右键菜单、角标
│  ├─ content.js              # 左下角滑块（Shadow DOM + 自动主题）
│  ├─ options.html/css/js     # 设置页
│  └─ icons/                  # 16/32/48/128 图标
└─ dev/                       # 开发与测试工具（不进入扩展包）
   ├─ lib.test.mjs            # 纯函数单元测试
   ├─ validate.mjs            # manifest / 文件 / 图标 / 语法静态校验
   ├─ e2e-extension.mjs       # 真实浏览器 + 真实 bgm.tv 端到端测试
   ├─ screenshots.mjs         # CDP 截图（本地预览 / 设置页）
   ├─ serve.mjs               # 本地预览服务器（模拟 bgm.tv 域名）
   ├─ preview.html            # 仿 Bangumi 页面的本地预览页
   ├─ mock-chrome.js          # 预览页用的 chrome.storage 模拟
   └─ make_icons.py           # 图标生成脚本（Pillow）

```

## 开发与测试

环境要求：Node.js ≥ 18（本机 Node 24 已验证）。

```bash
# 纯函数单元测试（域名识别 / URL 保留路径等）
node --test dev/lib.test.mjs

# 扩展静态校验（manifest、文件存在性、图标尺寸、JS 语法）
node dev/validate.mjs

# 本地预览：启动静态服务器，再用 Chrome 的 host-resolver 映射到 bgm.tv
node dev/serve.mjs
# 另开终端（Chrome）：
chrome --host-resolver-rules="MAP bgm.tv 127.0.0.1" http://bgm.tv:8137/dev/preview.html
# 深色：http://bgm.tv:8137/dev/preview.html?theme=dark

# 用 CDP 截取预览页截图（需先启动 serve.mjs；设置页真实截图由 E2E 生成）
node dev/screenshots.mjs

# 真实浏览器端到端测试：加载扩展、打开真实 bgm.tv、
# 点击滑块切换、后台图标逻辑、关闭持久化、设置页联动
node dev/e2e-extension.mjs
```

> **关于 E2E 使用的浏览器**：较新的 Chrome 正式版已移除 `--load-extension` 命令行开关（本项目在 Chrome 157 上实测不再加载扩展），因此 `dev/e2e-extension.mjs` 默认优先使用仍支持该参数的 Edge Headless。手动「加载已解压的扩展程序」不受影响。也可以用 `CHROME_PATH` 指定其它 Chromium 内核浏览器。

## License

MIT

## 声明

本插件仅个人使用，与 Bangumi 番组计划 官方无关

/*
 * 扩展包静态校验：
 *   - manifest.json 结构与关键字段
 *   - manifest 引用的所有文件都存在
 *   - 图标确实是期望尺寸的 PNG
 *   - 所有 JS 通过 node --check（语法检查）
 *   - MV3 约束：没有 popup（否则点击图标不会触发 onClicked）
 *
 * 运行：node dev/validate.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');

let checks = 0;
let failures = 0;
const failuresLog = [];

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log('  \u2713 ' + name);
  } else {
    failures += 1;
    failuresLog.push(name + (detail ? ' — ' + detail : ''));
    console.log('  \u2717 ' + name + (detail ? ' — ' + detail : ''));
  }
}

async function exists(file) {
  try {
    const info = await stat(file);
    return info.isFile();
  } catch (error) {
    return false;
  }
}

async function readPngSize(file) {
  const buffer = await readFile(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function syntaxCheck(file) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

async function main() {
  console.log('manifest.json');
  const manifestPath = path.join(EXT, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  check('manifest_version 为 3', manifest.manifest_version === 3);
  check('name 不超过 45 字符', typeof manifest.name === 'string' && manifest.name.length <= 45);
  check('description 不超过 132 字符', typeof manifest.description === 'string' && manifest.description.length <= 132);
  check('version 符合 x.y.z', /^\d+\.\d+\.\d+$/.test(manifest.version || ''));
  check('没有 default_popup（点击图标才能直接切换域名）', !manifest.action || !manifest.action.default_popup);
  check(
    'permissions 包含 storage / contextMenus / activeTab',
    ['storage', 'contextMenus', 'activeTab'].every((permission) => (manifest.permissions || []).includes(permission)),
  );
  check(
    'host_permissions 覆盖两个域名的裸域名与 www',
    ['*://bgm.tv/*', '*://www.bgm.tv/*', '*://bangumi.tv/*', '*://www.bangumi.tv/*'].every((pattern) =>
      (manifest.host_permissions || []).includes(pattern),
    ),
  );
  check(
    'host_permissions 不包含多余子域通配',
    !(manifest.host_permissions || []).some((pattern) => pattern.includes('*.')),
  );

  console.log('\ncontent_scripts');
  const script = (manifest.content_scripts || [])[0] || {};
  check('只有一个 content_scripts 条目', (manifest.content_scripts || []).length === 1);
  check('先加载 lib.js 再加载 content.js', JSON.stringify(script.js) === JSON.stringify(['lib.js', 'content.js']));
  check('注入时机为 document_idle', script.run_at === 'document_idle');
  check(
    'matches 覆盖 www 与裸域名',
    ['*://bgm.tv/*', '*://www.bgm.tv/*', '*://bangumi.tv/*', '*://www.bangumi.tv/*'].every((pattern) => (script.matches || []).includes(pattern)),
  );
  check(
    'matches 不包含多余子域通配',
    !(script.matches || []).some((pattern) => pattern.includes('*.')),
  );

  const backgroundSource = await readFile(path.join(EXT, 'background.js'), 'utf8');
  for (const pattern of script.matches || []) {
    check('background.js 右键菜单域名模式与 manifest 同步：' + pattern, backgroundSource.includes(pattern));
  }

  console.log('\n文件存在性');
  const referencedFiles = new Set([
    manifest.background && manifest.background.service_worker,
    manifest.options_ui && manifest.options_ui.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action && manifest.action.default_icon) || {}),
    ...((manifest.content_scripts || [])[0].js || []),
    'options.css',
  ].filter(Boolean));

  for (const relative of referencedFiles) {
    check('存在 ' + relative, await exists(path.join(EXT, relative)));
  }

  console.log('\n图标尺寸');
  for (const size of [16, 32, 48, 128]) {
    const file = path.join(EXT, 'icons', 'icon' + size + '.png');
    const dimensions = (await readPngSize(file).catch(() => null));
    check(
      'icon' + size + '.png 尺寸正确',
      Boolean(dimensions && dimensions.width === size && dimensions.height === size),
      dimensions ? dimensions.width + 'x' + dimensions.height : '无法读取',
    );
  }

  console.log('\nJavaScript 语法');
  const jsFiles = [
    'lib.js',
    'background.js',
    'content.js',
    'options.js',
  ];
  for (const name of jsFiles) {
    try {
      syntaxCheck(path.join(EXT, name));
      check(name + ' 语法正确', true);
    } catch (error) {
      check(name + ' 语法正确', false, String(error.stderr || error.message).slice(0, 300));
    }
  }

  console.log('\noptions.html');
  const optionsHtml = await readFile(path.join(EXT, 'options.html'), 'utf8');
  check('options.html 引入 options.js', optionsHtml.includes('src="options.js"'));
  check('options.html 引入 options.css', optionsHtml.includes('href="options.css"'));
  check('options.html 引入 lib.js', optionsHtml.includes('src="lib.js"'));
  check('options.html 没有内联 script', !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(optionsHtml));

  console.log('\n目录结构');
  const allowedTopLevel = new Set([
    'manifest.json',
    'lib.js',
    'background.js',
    'content.js',
    'options.html',
    'options.css',
    'options.js',
    'icons',
  ]);
  const topLevel = await readdir(EXT);
  const unexpected = topLevel.filter((name) => !allowedTopLevel.has(name));
  check('extension 目录只包含扩展文件', unexpected.length === 0, unexpected.join(', '));
  check('不存在开发用目录', !(await exists(path.join(EXT, 'dev'))));

  console.log('\n' + '-'.repeat(60));
  if (failures === 0) {
    console.log('全部通过：' + checks + ' 项检查');
  } else {
    console.log('失败 ' + failures + ' / ' + checks + ' 项：');
    failuresLog.forEach((line) => console.log('  - ' + line));
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

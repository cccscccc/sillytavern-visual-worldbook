/**
 * 加载验证：把 index.js 放进一个模拟的酒馆目录树里，用真实 ES module 语义 import 一次。
 *
 * 为什么需要这个：扩展"加载失败"这类问题，光看代码文本是看不出来的。
 * 上一版就是靠"读代码觉得对"发布了，结果酒馆报 `[object Event]`。
 * 这个脚本能确定性回答三件事：
 *   1. 导入路径能否解析到真实文件
 *   2. manifest 里 hooks.activate 指向的函数是否真的被导出
 *   3. 调用 init 时会不会抛异常
 *
 * 用法：node _verify_load.mjs
 *
 * 注：这里用同进程动态 import，不启动子进程——沙箱环境禁止 spawn（会 EBUSY）。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_INDEX = path.join(HERE, 'index.js');
const SRC_MANIFEST = path.join(HERE, 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(SRC_MANIFEST, 'utf8'));
const hookFn = manifest?.hooks?.activate;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wbg-load-'));
const pub = path.join(tmp, 'public');
const extDir = path.join(pub, 'scripts', 'extensions', 'third-party', 'worldbook-gallery');

fs.mkdirSync(extDir, { recursive: true });

// ---- 桩模块：只提供 index.js 声明要用的导出 ----
const stubs = {
    [path.join(pub, 'script.js')]: `
        export const eventSource = { on(){}, off(){}, emit(){} };
        export const event_types = new Proxy({}, { get: (t, k) => 'ev:' + String(k) });
        export const getRequestHeaders = () => ({});
        export const getThumbnailUrl = () => '';
        export const characters = [];
        export const saveSettingsDebounced = () => {};
    `,
    [path.join(pub, 'scripts', 'world-info.js')]: `
        export const world_names = [];
        export const openWorldInfoEditor = () => {};
    `,
    [path.join(pub, 'scripts', 'extensions.js')]: `
        export const extension_settings = {};
    `,
};
for (const [p, code] of Object.entries(stubs)) {
    fs.writeFileSync(p, code, 'utf8');
}

fs.copyFileSync(SRC_INDEX, path.join(extDir, 'index.js'));
fs.copyFileSync(SRC_MANIFEST, path.join(extDir, 'manifest.json'));

// ---- 桩浏览器环境 ----
const mkEl = () => ({
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {},
    querySelector() { return mkEl(); },
    remove() {},
    innerHTML: '', textContent: '', title: '', value: '', checked: false,
});
globalThis.document = {
    readyState: 'complete',
    body: { contains() { return true; }, appendChild() {} },
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return mkEl(); },
};
globalThis.window = globalThis;
globalThis.jQuery = (fn) => fn();
globalThis.fetch = async () => ({ ok: true, json: async () => [] });
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

// ---- 跑 ----
console.log('=== 加载验证 ===');

let mod;
try {
    mod = await import(pathToFileURL(path.join(extDir, 'index.js')).href);
} catch (e) {
    console.log(`  ❌ 模块加载失败`);
    console.log(`     ${e.constructor.name}: ${e.message}`);
    console.log('');
    console.log('=== 判定 ===');
    console.log('  ❌ 导入路径或导入符号有问题，酒馆加载时会报错');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exit(1);
}

console.log('  ✅ 模块加载成功');
console.log(`     导出符号：${Object.keys(mod).sort().join(', ') || '(无)'}`);

if (hookFn && typeof mod[hookFn] !== 'function') {
    console.log(`  ❌ manifest 写的是 hooks.activate="${hookFn}"，但模块没有导出这个函数`);
    console.log('');
    console.log('=== 判定 ===');
    console.log('  ❌ 酒馆会因此加载失败。init 必须是 export function。');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exit(1);
}
console.log(`  ✅ hook 函数 "${hookFn}" 存在`);

try {
    await mod[hookFn]();
    console.log('  ✅ 调用 init 无异常');
} catch (e) {
    console.log(`  ❌ init 抛异常：${e.message}`);
    console.log('');
    console.log('=== 判定 ===');
    console.log('  ❌ init 执行出错，需要修');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    process.exit(1);
}

console.log('');
console.log('=== 判定 ===');
console.log('  ✅ 全部通过：可加载、hook 存在、init 无异常');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
process.exit(0);


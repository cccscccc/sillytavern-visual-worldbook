/**
 * 运行时 API 可用性验证
 *
 * 检查 index.js 里用到的每个导入名，是否真的从对应文件导出。
 * 光看代码容易漏，这里逐个符号确认。
 *
 * 支持两种导出写法：
 *   export const foo / export let foo / export function foo
 *   export { a, b, foo, c };   ← 多行块式导出，正则容易漏检
 *
 * 酒馆目录的找法：优先用环境变量 TAVERN_ROOT，其次从本脚本位置往上找。
 * 例如：TAVERN_ROOT="D:/SillyTavern" node _verify_api.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_INDEX = path.join(HERE, 'index.js');

/**
 * 找酒馆根目录：先看环境变量，再从常见位置猜。
 * 判据是「存在 public/scripts/world-info.js」。
 */
function findTavernRoot() {
    const isTavern = (p) => p && fs.existsSync(path.join(p, 'public', 'scripts', 'world-info.js'));

    if (process.env.TAVERN_ROOT && isTavern(process.env.TAVERN_ROOT)) {
        return path.resolve(process.env.TAVERN_ROOT);
    }

    const candidates = [];
    // 从脚本所在位置往上找
    let walk = HERE;
    for (let i = 0; i < 8; i++) {
        walk = path.dirname(walk);
        if (walk === path.dirname(walk)) break;
        candidates.push(walk);
    }
    // 常见盘符扫一遍
    for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:']) {
        const base = drive + path.sep;
        if (!fs.existsSync(base)) continue;
        let items = [];
        try { items = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
        for (const it of items) {
            if (it.isDirectory() && /sillytavern/i.test(it.name)) {
                candidates.push(path.join(base, it.name));
            }
        }
    }
    return candidates.find(isTavern) ?? null;
}

const TAVERN = findTavernRoot();

if (!TAVERN) {
    console.log('=== 运行时 API 可用性验证 ===');
    console.log('');
    console.log('没找到酒馆目录，跳过这项检查。');
    console.log('如果要用，指定一下：TAVERN_ROOT="D:/SillyTavern" node _verify_api.mjs');
    process.exit(0);
}

// 从 index.js 的每个 import 语句里抽出「文件名 → 符号清单」
const src = fs.readFileSync(SRC_INDEX, 'utf8');

const groups = [];
const re = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
let m;
while ((m = re.exec(src)) !== null) {
    const names = m[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => s.split(/\s+as\s+/)[0].trim());
    groups.push({ from: m[2], names });
}

// 取某文件里所有导出的名字（含块式 export {}）
function getExports(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    const out = new Set();

    // 形式一：export const/let/var/function/class NAME
    const re1 = /^\s*export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
    let x;
    while ((x = re1.exec(text)) !== null) out.add(x[1]);

    // 形式二：export { a, b, c }; 或 export { a as b };
    const re2 = /^\s*export\s*\{([\s\S]*?)\}\s*;?/gm;
    while ((x = re2.exec(text)) !== null) {
        x[1].split(',').forEach(part => {
            part = part.trim();
            if (!part) return;
            part = part.replace(/\/\*[\s\S]*?\*\//g, '').trim();
            const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)/);
            const name = asMatch ? asMatch[1] : part.replace(/^\s*type\s+/, '').trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
        });
    }
    return out;
}

// 模拟"装进酒馆后的扩展目录"，用于解析相对 import
const EXT_DIR = path.join(
    TAVERN, 'public', 'scripts', 'extensions', 'third-party', 'worldbook-gallery',
);

console.log('=== 运行时 API 可用性验证 ===');
console.log('酒馆目录：' + TAVERN);
console.log('');

let pass = 0, fail = 0;

for (const g of groups) {
    const target = path.resolve(EXT_DIR, g.from);
    const rel = target.slice(TAVERN.length + 1).replace(/\\/g, '/');
    console.log(`来源文件: ${rel}`);

    if (!fs.existsSync(target)) {
        console.log('  ❌ 文件不存在！（说明相对路径层数不对）');
        console.log('');
        fail += g.names.length;
        continue;
    }

    const exported = getExports(target);

    for (const name of g.names) {
        if (exported.has(name)) {
            pass++;
            console.log(`  ✅ ${name}`);
        } else {
            fail++;
            console.log(`  ❌ ${name}  —— 该文件并未导出此名称`);
        }
    }
    console.log('');
}

console.log(`=== 结果：${pass} 个符号可用，${fail} 个有问题 ===`);
process.exit(fail ? 1 : 0);

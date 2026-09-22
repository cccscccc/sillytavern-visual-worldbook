/**
 * 运行时 API 可用性验证
 *
 * 检查 index.js 里用到的每个导入名，是否真的从对应文件导出。
 * 上一版就是靠"看代码以为对"翻车的，所以这里逐个符号确认。
 *
 * 支持两种导出写法：
 *   export const foo / export let foo / export function foo
 *   export { a, b, foo, c };   ← 多行块式导出，容易漏检
 */

import fs from 'node:fs';
import path from 'node:path';

const TAVERN = 'F:/J/SillyTavern/SillyTavern-1.18.0/SillyTavern-1.18.0';

// 从 index.js 的每个 import 语句里抽出「文件名 → 符号清单」
const LOCAL = 'E:/ai/AI WORK/03_SillyTavern_MCP/worldbook-gallery/index.js';
const src = fs.readFileSync(LOCAL, 'utf8');

// 把 import { ... } from '...' 抽成组
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
            // `foo as bar` → 对外名是 bar；`/** 注释 */ foo` → 取 foo
            part = part.replace(/\/\*[\s\S]*?\*\//g, '').trim();
            const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)/);
            const name = asMatch ? asMatch[1] : part.replace(/^\s*type\s+/, '').trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
        });
    }
    return out;
}

// 把相对 import 路径解析成真实文件
function resolveInTavern(spec, extDir) {
    return path.resolve(extDir, spec);
}

const EXT_DIR = path.join(
    TAVERN, 'public', 'scripts', 'extensions', 'third-party',
    'sillytavern-visual-worldbook',
);

console.log('=== 运行时 API 可用性验证 ===\n');

let pass = 0, fail = 0;

for (const g of groups) {
    const target = resolveInTavern(g.from, EXT_DIR);
    const rel = target.slice(TAVERN.length + 1).replace(/\\/g, '/');
    console.log(`来源文件: ${rel}`);

    if (!fs.existsSync(target)) {
        console.log(`  ❌ 文件不存在！\n`);
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

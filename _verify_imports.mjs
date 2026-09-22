/**
 * 导入路径验证器
 *
 * 目的：不靠推理，直接对着真实酒馆的磁盘文件树，验证 index.js 里每一条
 * import 的相对路径，能不能真的解析到一个存在的文件。
 *
 * 这正是上一版翻车的地方：路径写出三四层之差，光看代码看不出来。
 * 这个方法能确定性回答"到底能不能解析"。
 */

import fs from 'node:fs';
import path from 'node:path';

const TAVERN = 'F:/J/SillyTavern/SillyTavern-1.18.0/SillyTavern-1.18.0';

// 模拟酒馆会把扩展装到哪个位置（按仓库名）
const PKG_NAME = 'sillytavern-visual-worldbook';
const EXT_DIR_IN_TAVERN = path.join(
    TAVERN, 'public', 'scripts', 'extensions', 'third-party', PKG_NAME,
);
// 本地源码目录（和装进酒馆后的相对层级相同）
const LOCAL_DIR = 'E:/ai/AI WORK/03_SillyTavern_MCP/worldbook-gallery';

const indexSrc = fs.readFileSync(path.join(LOCAL_DIR, 'index.js'), 'utf8');

// 抓出所有 import ... from '...' 的模块路径
const imports = [];
const re = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
let m;
while ((m = re.exec(indexSrc)) !== null) {
    imports.push(m[1]);
}

console.log('=== 导入路径解析验证 ===');
console.log('扩展在酒馆中的位置：');
console.log('  ' + EXT_DIR_IN_TAVERN.replace(TAVERN, '<SillyTavern>'));
console.log('');

let pass = 0, fail = 0;

for (const spec of imports) {
    if (!spec.startsWith('.')) {
        console.log(`  [跳过] ${spec}（非相对路径）`);
        continue;
    }
    // 在真实酒馆文件树里解析
    const resolved = path.resolve(EXT_DIR_IN_TAVERN, spec);
    const exists = fs.existsSync(resolved);
    // 转成相对酒馆根的显示形式
    const shown = resolved.startsWith(TAVERN)
        ? resolved.slice(TAVERN.length + 1).replace(/\\/g, '/')
        : resolved.replace(/\\/g, '/');

    if (exists) {
        pass++;
        console.log(`  ✅ ${spec}`);
        console.log(`     → ${shown}`);
    } else {
        fail++;
        console.log(`  ❌ ${spec}`);
        console.log(`     → ${shown}  【文件不存在】`);
        // 帮忙找找同名文件在哪
        const base = path.basename(spec);
        const found = [];
        const walk = (dir, depth) => {
            if (depth > 4) return;
            let items;
            try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const it of items) {
                if (it.name === 'node_modules' || it.name.startsWith('.')) continue;
                const full = path.join(dir, it.name);
                if (it.isDirectory()) walk(full, depth + 1);
                else if (it.name === base) found.push(full);
            }
        };
        walk(path.join(TAVERN, 'public'), 0);
        if (found.length) {
            console.log(`     同名文件实际位置：`);
            found.slice(0, 3).forEach(f =>
                console.log(`       ${f.slice(TAVERN.length + 1).replace(/\\/g, '/')}`));
        }
    }
}

console.log('');
console.log(`=== 结果：${pass} 条可解析，${fail} 条解析失败 ===`);
process.exit(fail ? 1 : 0);

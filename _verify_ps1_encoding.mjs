/**
 * PowerShell 脚本编码自检。
 *
 * 为什么需要这个：
 *   Windows PowerShell 5.1 读取 .ps1 时，**如果文件没有 UTF-8 BOM，
 *   就按系统 ANSI 代码页（中文系统是 GBK）解码**。
 *   install.ps1 里全是中文注释，一旦被当 GBK 解码就变成乱码，
 *   解析器会在奇怪的位置报错（比如"缺少右 }"），脚本直接跑不起来。
 *
 *   实测：同一个文件，按 UTF-8 读 → 0 个语法错误；
 *         按默认（无 BOM + ANSI）读 → 6 个语法错误。
 *
 * 这个脚本检查：install.ps1 有没有 BOM、有没有真的是合法 UTF-8。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, 'install.ps1');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const no = (m, e) => { fail++; console.log(`  ❌ ${m}${e ? ' → ' + e : ''}`); };

console.log('=== PowerShell 脚本编码自检 ===\n');

if (!fs.existsSync(TARGET)) {
    console.log('  ⚠️  没找到 install.ps1，跳过。');
    process.exit(0);
}

const buf = fs.readFileSync(TARGET);

// [1] BOM
console.log('[1] BOM 检查');
if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    ok('有 UTF-8 BOM（PowerShell 5.1 才能正确读中文）');
} else {
    no('缺 UTF-8 BOM',
        'PowerShell 5.1 会按 GBK 解码，中文注释变乱码 → 语法错误 → 脚本跑不起来');
}

// [2] 是不是合法 UTF-8（严格模式，非法字节会抛错）
console.log('\n[2] UTF-8 合法性');
try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    ok('是合法 UTF-8');

    // [3] 中文没坏（抽查几处必须存在的字）
    console.log('\n[3] 中文完整性抽查');
    const probes = [
        ['世界书', '顶部的中文说明'],
        ['安装', '安装相关的字'],
        ['卸载', '卸载相关的字'],
        ['更新', '新增的更新动作'],
    ];
    for (const [needle, why] of probes) {
        if (text.includes(needle)) ok(`找得到「${needle}」（${why}）`);
        else no(`找不到「${needle}」（${why}）`);
    }

    // [4] 关键动作都在
    console.log('\n[4] 动作齐全性');
    for (const action of ['install', 'update', 'uninstall', 'status']) {
        if (text.includes(`'${action}'`)) ok(`动作 ${action} 存在`);
        else no(`动作 ${action} 缺失`);
    }
} catch (e) {
    no('不是合法 UTF-8', String(e.message || e));
    console.log(`\n=== 结果：${pass} 项通过，${fail} 项失败 ===`);
    process.exit(1);
}

console.log(`\n=== 结果：${pass} 项通过，${fail} 项失败 ===`);
process.exit(fail ? 1 : 0);

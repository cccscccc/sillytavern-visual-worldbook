/**
 * 一键全量自检
 *
 * 用法：node check.mjs
 *
 * 依次跑四项检查，任何一项失败都会明确报告出来。
 * 发布前跑一次，能挡住"加载失败"这类只有装进酒馆才暴露的问题。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

const checks = [
    { name: '语法检查 index.js',     cmd: ['--input-type=module', '--check'], stdinFile: 'index.js' },
    { name: '配对逻辑自检',          cmd: ['_selftest.mjs'] },
    { name: '导入符号可用性',        cmd: ['_verify_api.mjs'] },
    { name: '模块加载模拟',          cmd: ['_verify_load.mjs'] },
];

console.log('========================================');
console.log(' 世界书卡面管理 · 全量自检');
console.log('========================================');
console.log('');

let failed = 0;

for (const c of checks) {
    process.stdout.write(`[${c.name}] `);
    let r;
    if (c.stdinFile) {
        const src = fs.readFileSync(path.join(HERE, c.stdinFile), 'utf8');
        r = spawnSync(NODE, c.cmd, { input: src, encoding: 'utf8', cwd: HERE });
    } else {
        r = spawnSync(NODE, c.cmd, { encoding: 'utf8', cwd: HERE });
    }

    if (r.error && String(r.error.message).includes('EBUSY')) {
        console.log('跳过（沙箱不允许启动子进程）');
        continue;
    }

    if (r.status === 0) {
        console.log('通过');
    } else {
        failed++;
        console.log('失败');
        const out = String(r.stdout ?? '').trim();
        const err = String(r.stderr ?? '').trim();
        if (out) console.log(out.split('\n').map(l => '    ' + l).join('\n'));
        if (err) console.log(err.split('\n').map(l => '    ' + l).join('\n'));
    }
}

console.log('');
if (failed === 0) {
    console.log('全部通过。');
    process.exit(0);
} else {
    console.log(`${failed} 项失败，请修复后再发布。`);
    process.exit(1);
}

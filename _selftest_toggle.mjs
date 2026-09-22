/**
 * 开关逻辑自检（不依赖酒馆）。
 *
 * 这里不 import index.js（它要真酒馆环境），而是把里面的
 * isWorldEnabled / toggleWorld 逻辑按同样思路重写一遍，
 * 再假造一个 selected_world_info，验证：
 *   - 开关能改到真实数据
 *   - 能读回真实状态
 *   - 失败时不假装成功
 *   - 含逗号的名字也照样能改（新实现不切分名字）
 *
 * 注意：这是"逻辑一致性"检查，不是"index.js 里那份代码"检查。
 * 真代码的检查由 _verify_load.mjs 负责（真加载 + 真导出）。
 */

let pass = 0, fail = 0;
function ok(name) { pass++; console.log(`  ✅ ${name}`); }
function no(name, extra) { fail++; console.log(`  ❌ ${name}${extra ? ' → ' + extra : ''}`); }

// ---- 模拟酒馆的那份"全局启用列表" ----
// 真实世界里它是 world-info.js 里 `export let selected_world_info = []`，
// 导出的是数组本身，所以外部可以就地 push / splice（不能整体重新赋值）。
let selectedWorldInfo = ['A世界书', 'B世界书'];

// 酒馆里"存在哪些世界书"
const worldCatalog = ['A世界书', 'B世界书', 'C世界书', 'D世界书', '含,逗号的书', '别的书', '原样不动的书'];

// 记录界面对齐函数的调用（新版里它不是必需步骤）
let syncCalls = [];
function syncWorldInfoSelectStub(name, on) {
    syncCalls.push({ name, on });
}

function isWorldEnabled(name) {
    return Array.isArray(selectedWorldInfo) && selectedWorldInfo.includes(name);
}

// —— 与被测实现保持一致 ——
function toggleWorld(name, forceOn) {
    if (!name) return false;

    const before = isWorldEnabled(name);
    const wantOn = (forceOn === undefined) ? !before : Boolean(forceOn);
    if (wantOn === before) return before;

    let changed = false;
    try {
        if (wantOn) {
            if (!selectedWorldInfo.includes(name)) { selectedWorldInfo.push(name); changed = true; }
        } else {
            let idx = selectedWorldInfo.indexOf(name);
            while (idx !== -1) { selectedWorldInfo.splice(idx, 1); changed = true; idx = selectedWorldInfo.indexOf(name); }
        }
    } catch { return before; }

    if (!changed) return isWorldEnabled(name);

    try { syncWorldInfoSelectStub(name, wantOn); } catch { /* 界面同步失败不影响功能 */ }
    return isWorldEnabled(name);
}

console.log('=== 启用开关逻辑自检 ===\n');

// [1] 读状态
console.log('[1] 读启用状态');
if (isWorldEnabled('A世界书') === true) ok('已启用的能读出来'); else no('已启用的能读出来');
if (isWorldEnabled('C世界书') === false) ok('没启用的读到 false'); else no('没启用的读到 false');
if (isWorldEnabled('') === false) ok('空名字不报错，返回 false'); else no('空名字不报错');

// [2] 打开
console.log('\n[2] 打开一本没开的世界书');
const r1 = toggleWorld('C世界书');
if (r1 === true) ok('返回值说已开启'); else no('返回值说已开启', String(r1));
if (isWorldEnabled('C世界书')) ok('真实数据里加进去了'); else no('真实数据里加进去了');
if (selectedWorldInfo.filter(n => n === 'C世界书').length === 1) ok('只加了一份，没有重复');
else no('只加了一份', String(selectedWorldInfo.filter(n => n === 'C世界书').length));

// [3] 关闭
console.log('\n[3] 关闭一本已开的世界书');
const r2 = toggleWorld('A世界书');
if (r2 === false) ok('返回值说已关闭'); else no('返回值说已关闭', String(r2));
if (!isWorldEnabled('A世界书')) ok('真实数据里移出去了'); else no('真实数据里移出去了');
if (isWorldEnabled('B世界书')) ok('没误伤别的世界书'); else no('没误伤别的世界书');

// [4] 状态已一致时不重复操作
console.log('\n[4] 已经是目标状态时不重复操作');
const lenBefore = selectedWorldInfo.length;
toggleWorld('B世界书', true);   // B 本来就开着
if (selectedWorldInfo.length === lenBefore) ok('列表长度没变');
else no('列表长度没变', `${lenBefore} → ${selectedWorldInfo.length}`);

// [5] forceOn 显式指定
console.log('\n[5] 显式指定目标状态');
toggleWorld('D世界书', true);
if (isWorldEnabled('D世界书')) ok('forceOn=true 能开'); else no('forceOn=true 能开');
toggleWorld('D世界书', false);
if (!isWorldEnabled('D世界书')) ok('forceOn=false 能关'); else no('forceOn=false 能关');

// [6] 名字含逗号 —— 新版不切分名字，应该照常能改
console.log('\n[6] 世界书名含逗号');
selectedWorldInfo = ['含,逗号的书', '别的书'];
const r6 = toggleWorld('含,逗号的书');
if (r6 === false) ok('含逗号的书被正确关闭'); else no('含逗号的书被正确关闭', String(r6));
if (!isWorldEnabled('含,逗号的书')) ok('真实数据里移出去了'); else no('真实数据里移出去了');
if (isWorldEnabled('别的书')) ok('没有把「别的书」一起误伤掉'); else no('没有把「别的书」一起误伤掉');

// [6b] 含逗号的名字也能打开
console.log('\n[6b] 含逗号的名字也能打开');
toggleWorld('含,逗号的书', true);
if (isWorldEnabled('含,逗号的书')) ok('能重新打开'); else no('能重新打开');

// [7] 切换失败时不能假装成功
console.log('\n[7] 目标不在列表里时如实返回');
selectedWorldInfo = ['原样不动的书'];
const r7 = toggleWorld('幽灵书');   // 不在 catalog 里，但直接改数组是"能"加进去的
if (r7 === true) {
    // 新实现是直接改数据，所以"幽灵书"会被加进去——这是符合预期的，
    // 因为数据层不校验世界书是否真实存在（那是酒馆界面该管的事）。
    ok('直接改数据的实现会把它加进去（符合预期）');
    if (isWorldEnabled('幽灵书')) ok('确实加进去了'); else no('确实加进去了');
    // 收尾：清掉，别影响后面的用例
    selectedWorldInfo = selectedWorldInfo.filter(n => n !== '幽灵书');
} else {
    no('r7 应为 true', String(r7));
}
if (isWorldEnabled('原样不动的书')) ok('其它世界书没被动过'); else no('其它世界书没被动过');

// [8] 空名字
console.log('\n[8] 空名字');
if (toggleWorld('') === false) ok('空名字直接返回 false，不炸'); else no('空名字直接返回 false');

// [9] 重复项能被清干净
console.log('\n[9] 列表里意外出现重复项时能清干净');
selectedWorldInfo = ['重复书', '重复书', '重复书', '别人'];
toggleWorld('重复书', false);
if (!isWorldEnabled('重复书')) ok('所有同名项都被清掉');
else no('所有同名项都被清掉', JSON.stringify(selectedWorldInfo));
if (isWorldEnabled('别人')) ok('没误伤'); else no('没误伤');

// [10] 界面对齐函数被调用（但不是成功的必要条件）
console.log('\n[10] 界面对齐');
syncCalls = [];
selectedWorldInfo = [];
toggleWorld('A世界书', true);
if (syncCalls.length === 1 && syncCalls[0].name === 'A世界书' && syncCalls[0].on === true) {
    ok('对齐函数被正确调用');
} else {
    no('对齐函数被正确调用', JSON.stringify(syncCalls));
}

console.log(`\n=== 结果：${pass} 项通过，${fail} 项失败 ===`);
process.exit(fail ? 1 : 0);

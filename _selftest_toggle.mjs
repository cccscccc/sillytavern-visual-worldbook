/**
 * 开关逻辑自检（不依赖酒馆）。
 *
 * 这里不 import index.js（它要真酒馆环境），而是把里面的
 * isWorldEnabled / toggleWorld 逻辑按同样思路重写一遍，
 * 再假造一个 selected_world_info 与 onWorldInfoChange，
 * 验证：开关能改到真实数据、能读回真实状态、失败时不假装成功。
 *
 * 注意：这是"逻辑一致性"检查，不是"index.js 里那份代码"检查。
 * 真代码的检查由 _verify_load.mjs 负责（真加载 + 真导出）。
 */

let pass = 0, fail = 0;
function ok(name) { pass++; console.log(`  ✅ ${name}`); }
function no(name, extra) { fail++; console.log(`  ❌ ${name}${extra ? ' → ' + extra : ''}`); }

// ---- 模拟酒馆的一份"全局启用列表" ----
let selectedWorldInfo = ['A世界书', 'B世界书'];

// 酒馆里"存在哪些世界书"（桩里直接给一份，真酒馆是 world_names）
let worldCatalog = ['A世界书', 'B世界书', 'C世界书', 'D世界书', '含,逗号的书', '别的书', '原样不动的书'];

// 记录 onWorldInfoChange 被调用的次数（声明在桩函数之前，避免 TDZ）
let changeCalls = [];

function isWorldEnabled(name) {
    return Array.isArray(selectedWorldInfo) && selectedWorldInfo.includes(name);
}

// 模拟酒馆的 onWorldInfoChange，并记下调用次数。
// 真实实现会先拿 world_names 对一下名字，名字对不上就只提示"没找到"、不改数据。
function onWorldInfoChangeStub(args, text) {
    changeCalls.push({ args, text });
    if (!worldCatalog.includes(text)) return;      // ← 名字不存在就只提示，不改状态
    const cur = selectedWorldInfo.includes(text);
    const state = args?.state;
    const want = state === 'on' ? true : state === 'off' ? false : !cur;
    if (want && !cur) selectedWorldInfo = [...selectedWorldInfo, text];
    if (!want && cur) selectedWorldInfo = selectedWorldInfo.filter(s => s !== text);
}

// 模拟走 select 兜底那条路。
// 关键：真实实现里，若下拉框里找不到同名的项，会直接 return（什么都不做）。
// 所以这里必须带上"世界书真的存在"这个前提，否则测出来的行为是假的。
function setWorldEnabledViaSelectStub(name, on) {
    if (!worldCatalog.includes(name)) return;      // ← 找不到就什么都不做
    if (on) { if (!selectedWorldInfo.includes(name)) selectedWorldInfo = [...selectedWorldInfo, name]; }
    else { selectedWorldInfo = selectedWorldInfo.filter(s => s !== name); }
}

function toggleWorld(name, forceOn) {
    if (!name) return false;
    const hasComma = name.includes(',');
    const before = isWorldEnabled(name);
    const wantOn = (forceOn === undefined) ? !before : Boolean(forceOn);
    if (wantOn === before) return before;
    try {
        if (hasComma) setWorldEnabledViaSelectStub(name, wantOn);
        else onWorldInfoChangeStub({ state: wantOn ? 'on' : 'off', silent: false }, name);
    } catch { return before; }
    const after = isWorldEnabled(name);
    if (after !== wantOn) {
        try { setWorldEnabledViaSelectStub(name, wantOn); } catch { /* 忽略 */ }
        return isWorldEnabled(name);
    }
    return after;
}

console.log('=== 启用开关逻辑自检 ===\n');

// [1] 读状态
console.log('[1] 读启用状态');
if (isWorldEnabled('A世界书') === true) ok('已启用的能读出来'); else no('已启用的能读出来');
if (isWorldEnabled('C世界书') === false) ok('没启用的读到 false'); else no('没启用的读到 false');
if (isWorldEnabled('') === false) ok('空名字不报错，返回 false'); else no('空名字不报错');

// [2] 打开
console.log('\n[2] 打开一本没开的世界书');
changeCalls = [];
const r1 = toggleWorld('C世界书');
if (r1 === true) ok('返回值说已开启'); else no('返回值说已开启', String(r1));
if (isWorldEnabled('C世界书')) ok('真实数据里加进去了'); else no('真实数据里加进去了');
if (changeCalls.length === 1 && changeCalls[0].args.state === 'on') ok('走的是 onWorldInfoChange，state=on');
else no('走的是 onWorldInfoChange，state=on', JSON.stringify(changeCalls));
if (changeCalls[0]?.args?.silent === false) ok('silent=false，酒馆会弹提示'); else no('silent=false');

// [3] 关闭
console.log('\n[3] 关闭一本已开的世界书');
changeCalls = [];
const r2 = toggleWorld('A世界书');
if (r2 === false) ok('返回值说已关闭'); else no('返回值说已关闭', String(r2));
if (!isWorldEnabled('A世界书')) ok('真实数据里移出去了'); else no('真实数据里移出去了');
if (changeCalls[0]?.args?.state === 'off') ok('state=off 传对了'); else no('state=off 传对了');
if (isWorldEnabled('B世界书')) ok('没误伤别的世界书'); else no('没误伤别的世界书');

// [4] 状态已一致时不该重复调用
console.log('\n[4] 已经是目标状态时不重复操作');
changeCalls = [];
toggleWorld('B世界书', true);   // B 本来就开着
if (changeCalls.length === 0) ok('没多余的调用'); else no('没多余的调用', String(changeCalls.length));

// [5] forceOn 显式指定
console.log('\n[5] 显式指定目标状态');
toggleWorld('D世界书', true);
if (isWorldEnabled('D世界书')) ok('forceOn=true 能开'); else no('forceOn=true 能开');
toggleWorld('D世界书', false);
if (!isWorldEnabled('D世界书')) ok('forceOn=false 能关'); else no('forceOn=false 能关');

// [6] 名字含逗号 → 走兜底
console.log('\n[6] 世界书名含逗号时走兜底方案');
changeCalls = [];
selectedWorldInfo = ['含,逗号的书', '别的书'];
const r6 = toggleWorld('含,逗号的书');
if (r6 === false) ok('含逗号的书被正确关闭'); else no('含逗号的书被正确关闭', String(r6));
if (!isWorldEnabled('含,逗号的书')) ok('真实数据里移出去了'); else no('真实数据里移出去了');
if (isWorldEnabled('别的书')) ok('没有把「别的书」一起误伤掉'); else no('没有把「别的书」一起误伤掉');
if (changeCalls.length === 0) ok('确认绕开了 onWorldInfoChange（没按逗号切分）');
else no('确认绕开了 onWorldInfoChange', JSON.stringify(changeCalls));

// [7] 切换失败时不能假装成功
console.log('\n[7] 切换失败时不假装成功');
selectedWorldInfo = ['原样不动的书'];
const r7 = toggleWorld('幽灵书');   // 幽灵书不在 worldCatalog 里，两条路都改不动
if (r7 === false) ok('失败时如实返回"仍然没开"'); else no('失败时如实返回"仍然没开"', String(r7));
if (!isWorldEnabled('幽灵书')) ok('真实数据里也没有凭空多出来'); else no('真实数据里也没有凭空多出来');
if (isWorldEnabled('原样不动的书')) ok('其它世界书没被动过'); else no('其它世界书没被动过');

// [8] 名字为空
console.log('\n[8] 空名字');
if (toggleWorld('') === false) ok('空名字直接返回 false，不炸'); else no('空名字直接返回 false');

console.log(`\n=== 结果：${pass} 项通过，${fail} 项失败 ===`);
process.exit(fail ? 1 : 0);

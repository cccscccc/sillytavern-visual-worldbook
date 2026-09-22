/**
 * 开关逻辑自检（不依赖酒馆）。
 *
 * 这里不 import index.js（它要真酒馆环境），而是把里面的
 * isWorldEnabled / toggleWorld / syncWorldInfoSelect / triggerWorldInfoChange
 * 逻辑按同样思路重写一遍，再假造一个 selected_world_info + 一个假的 #world_info 下拉框，
 * 验证：
 *   - 开关能改到真实数据
 *   - 能读回真实状态
 *   - 失败时不假装成功
 *   - 含逗号的名字也照样能改（新实现不切分名字）
 *   - ★ 能借酒馆自己的 change 通道把改动回写（0.2.1 修的 bug）
 *   - ★ 下拉框里没有这本书时，绝不能触发 change（否则会把状态清空）
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

// ---- 模拟 #world_info 下拉框 ----
// 真实世界里它是 <select multiple>，option 的 text = 世界书名。
// 酒馆的 onWorldInfoChange('__notSlashCommand__') 会：
//   val() → 读回所有被选中的 option（这里是它的 index）
//   → 映射成名字 → **整体覆盖** selected_world_info
//   → 存盘 + 发事件
// 我们这个桩就是把这个过程如实演一遍。
let dropdownOptions = [];      // [{ text, selected }]
let changeHandler = null;      // 酒馆绑在 change 上的处理函数
let changeTriggered = 0;       // 触发了几次
let saveCalls = 0;             // 酒馆那边存盘了几次

// ★ 这才是"酒馆界面/存盘实际读的东西"。
//   真实世界里是 world_info.globalSelect，只在 world-info.js 第 84 行那个
//   **私有** saveSettingsDebounced 里被同步（第 85 行 Object.assign）。
//   从 script.js 导入的那个同名函数不会碰它 —— 这正是上一版 bug 的根因。
//   所以这里单独建一个变量来代表它，用来验证"酒馆那侧到底跟没跟上"。
let globalSelectMirror = null;

function rebuildDropdown() {
    dropdownOptions = worldCatalog.map(t => ({ text: t, selected: selectedWorldInfo.includes(t) }));
}

/** 酒馆原生：把下拉框当前选中项读回来，覆盖真实数据 */
function onWorldInfoChangeNative() {
    if (worldCatalog.length === 0) return;   // 对应酒馆那句 early return
    const picked = dropdownOptions.filter(o => o.selected).map(o => o.text);
    selectedWorldInfo = picked;              // 覆盖
    saveCalls++;
    // 酒馆走的是它自己的私有 saveSettingsDebounced，里面会同步 globalSelect
    globalSelectMirror = selectedWorldInfo;
}

/** 桩：酒馆在 initWorldInfo 里绑的 '#world_info' change */
changeHandler = onWorldInfoChangeNative;

// 记录界面对齐函数的调用
let syncCalls = [];

// —— 与被测实现保持一致的四个函数 ——

function isWorldEnabled(name) {
    return Array.isArray(selectedWorldInfo) && selectedWorldInfo.includes(name);
}

function syncWorldInfoSelect(name, on) {
    let hit = 0;
    for (const o of dropdownOptions) {
        if (o.text === name) { o.selected = on; hit++; }
    }
    syncCalls.push({ name, on, hit });
    return hit;
}

function triggerWorldInfoChange() {
    if (worldCatalog.length === 0) return false;
    changeTriggered++;
    changeHandler();
    return true;
}

function toggleWorld(name, forceOn) {
    if (!name) return false;

    const before = isWorldEnabled(name);
    const wantOn = (forceOn === undefined) ? !before : Boolean(forceOn);
    if (wantOn === before) return before;

    // 1. 直接改数据
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

    // 2. 借酒馆通道回写：先对齐下拉框，再触发 change
    let hit = 0;
    try {
        hit = syncWorldInfoSelect(name, wantOn);
        if (hit > 0) triggerWorldInfoChange();
    } catch { /* 回写失败不影响第 1 步的结果 */ }

    // 3. 兜底存盘 + 发事件（这里用 saveCalls 代表）
    saveCalls++;

    return isWorldEnabled(name);
}

console.log('=== 启用开关逻辑自检 ===\n');

// [1] 读状态
console.log('[1] 读启用状态');
rebuildDropdown();
if (isWorldEnabled('A世界书') === true) ok('已启用的能读出来'); else no('已启用的能读出来');
if (isWorldEnabled('C世界书') === false) ok('没启用的读到 false'); else no('没启用的读到 false');
if (isWorldEnabled('') === false) ok('空名字不报错，返回 false'); else no('空名字不报错');

// [2] 打开
console.log('\n[2] 打开一本没开的世界书');
selectedWorldInfo = ['A世界书', 'B世界书'];
rebuildDropdown();
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
const trigBefore4 = changeTriggered;
toggleWorld('B世界书', true);   // B 本来就开着
if (selectedWorldInfo.length === lenBefore) ok('列表长度没变');
else no('列表长度没变', `${lenBefore} → ${selectedWorldInfo.length}`);
if (changeTriggered === trigBefore4) ok('也没多余地触发 change');
else no('也没多余地触发 change', `${trigBefore4} → ${changeTriggered}`);

// [5] forceOn 显式指定
console.log('\n[5] 显式指定目标状态');
toggleWorld('D世界书', true);
if (isWorldEnabled('D世界书')) ok('forceOn=true 能开'); else no('forceOn=true 能开');
toggleWorld('D世界书', false);
if (!isWorldEnabled('D世界书')) ok('forceOn=false 能关'); else no('forceOn=false 能关');

// [6] 名字含逗号 —— 新版不切分名字，应该照常能改
console.log('\n[6] 世界书名含逗号');
selectedWorldInfo = ['含,逗号的书', '别的书'];
rebuildDropdown();
const r6 = toggleWorld('含,逗号的书');
if (r6 === false) ok('含逗号的书被正确关闭'); else no('含逗号的书被正确关闭', String(r6));
if (!isWorldEnabled('含,逗号的书')) ok('真实数据里移出去了'); else no('真实数据里移出去了');
if (isWorldEnabled('别的书')) ok('没有把「别的书」一起误伤掉'); else no('没有把「别的书」一起误伤掉');

// [6b] 含逗号的名字也能打开
console.log('\n[6b] 含逗号的名字也能打开');
toggleWorld('含,逗号的书', true);
if (isWorldEnabled('含,逗号的书')) ok('能重新打开'); else no('能重新打开');

// [7] 目标不在下拉框里时，如实返回且**不触发 change**
console.log('\n[7] 目标不在下拉框里时的行为');
selectedWorldInfo = ['原样不动的书'];
rebuildDropdown();
const trigBefore7 = changeTriggered;
const saveBefore7 = saveCalls;
const r7 = toggleWorld('幽灵书');   // 不在 catalog 里
if (r7 === true) {
    ok('直接改数据的实现会把它加进去（符合预期）');
    if (isWorldEnabled('幽灵书')) ok('确实加进去了'); else no('确实加进去了');
} else {
    no('r7 应为 true', String(r7));
}
// ★ 关键：下拉框里没有它 → 绝不能触发 change，
//   否则酒馆会按下拉框内容覆盖数据，把"幽灵书"又抹掉。
if (changeTriggered === trigBefore7) ok('下拉框里没有此书 → 没有触发 change（防止状态被抹掉）');
else no('下拉框里没有此书 → 不应触发 change', `${trigBefore7} → ${changeTriggered}`);
if (isWorldEnabled('幽灵书')) ok('数据仍然保住了（没被 change 覆盖掉）');
else no('数据仍然保住了', JSON.stringify(selectedWorldInfo));
if (saveCalls > saveBefore7) ok('兜底存盘照常发生'); else no('兜底存盘照常发生');
if (isWorldEnabled('原样不动的书')) ok('其它世界书没被动过'); else no('其它世界书没被动过');

// [8] 空名字
console.log('\n[8] 空名字');
selectedWorldInfo = ['A世界书'];
rebuildDropdown();
if (toggleWorld('') === false) ok('空名字直接返回 false，不炸'); else no('空名字直接返回 false');

// [9] 重复项能被清干净
console.log('\n[9] 列表里意外出现重复项时能清干净');
selectedWorldInfo = ['重复书', '重复书', '重复书', '别人'];
rebuildDropdown();
toggleWorld('重复书', false);
if (!isWorldEnabled('重复书')) ok('所有同名项都被清掉');
else no('所有同名项都被清掉', JSON.stringify(selectedWorldInfo));
if (isWorldEnabled('别人')) ok('没误伤'); else no('没误伤');

// [10] 界面对齐函数被调用
console.log('\n[10] 界面对齐');
syncCalls = [];
selectedWorldInfo = [];
rebuildDropdown();
toggleWorld('A世界书', true);
if (syncCalls.length === 1 && syncCalls[0].name === 'A世界书' && syncCalls[0].on === true && syncCalls[0].hit === 1) {
    ok('对齐函数被正确调用，且确实改到了 1 个 option');
} else {
    no('对齐函数被正确调用', JSON.stringify(syncCalls));
}

// [11] ★ 回写通道真的把改动同步到了"酒馆那侧"
console.log('\n[11] 借酒馆 change 通道回写（0.2.1 修的 bug）');
selectedWorldInfo = ['A世界书'];
rebuildDropdown();
globalSelectMirror = ['A世界书'];   // 假装酒馆本来已经把 A 同步过去了
changeTriggered = 0; saveCalls = 0;

toggleWorld('C世界书', true);

if (changeTriggered === 1) ok('恰好触发了一次 change'); else no('恰好触发了一次 change', String(changeTriggered));
if (isWorldEnabled('C世界书')) ok('插件侧数据认为已开启');
else no('插件侧数据认为已开启', JSON.stringify(selectedWorldInfo));
// ★ 核心断言：酒馆界面/存盘读的是 globalSelectMirror，它必须也跟上
if (Array.isArray(globalSelectMirror) && globalSelectMirror.includes('C世界书')) {
    ok('★ 酒馆那侧（globalSelect）也同步了 —— 界面会跟着变');
} else {
    no('★ 酒馆那侧（globalSelect）也同步了', JSON.stringify(globalSelectMirror));
}
if (globalSelectMirror && globalSelectMirror.includes('A世界书')) ok('原有已开启的书在酒馆那侧也保住了');
else no('原有已开启的书在酒馆那侧也保住了', JSON.stringify(globalSelectMirror));
if (dropdownOptions.find(o => o.text === 'C世界书')?.selected === true) ok('下拉框里 C 的勾选也对了');
else no('下拉框里 C 的勾选也对了');

// [11b] 关闭时同样能同步
console.log('\n[11b] 关闭时同样能同步到酒馆那侧');
toggleWorld('C世界书', false);
if (!isWorldEnabled('C世界书')) ok('插件侧数据认为已关闭');
else no('插件侧数据认为已关闭', JSON.stringify(selectedWorldInfo));
if (Array.isArray(globalSelectMirror) && !globalSelectMirror.includes('C世界书')) ok('★ 酒馆那侧也取消了');
else no('★ 酒馆那侧也取消了', JSON.stringify(globalSelectMirror));
if (dropdownOptions.find(o => o.text === 'C世界书')?.selected === false) ok('下拉框里 C 的勾选也取消了');
else no('下拉框里 C 的勾选也取消了');

// [11c] ★ 下拉框里没有这本书时，酒馆那侧绝不能被"顺带清空"
console.log('\n[11c] 下拉框没这本书时，酒馆那侧不能被清空');
selectedWorldInfo = ['A世界书'];
rebuildDropdown();
globalSelectMirror = ['A世界书'];
toggleWorld('幽灵书2', true);
if (Array.isArray(globalSelectMirror) && globalSelectMirror.includes('A世界书')) {
    ok('★ 酒馆那侧原有的 A 没被清空');
} else {
    no('★ 酒馆那侧原有的 A 没被清空', JSON.stringify(globalSelectMirror));
}
// 收尾
selectedWorldInfo = selectedWorldInfo.filter(n => n !== '幽灵书2');
rebuildDropdown();
globalSelectMirror = selectedWorldInfo.slice();

// [12] ★ 列表没准备好时，先热身再改
console.log('\n[12] 世界书列表还没准备时的热身');
let ensureCalls = 0;
let listReady = false;

async function ensureWorldListReadyStub() {
    ensureCalls++;
    if (!listReady) {
        listReady = true;
        rebuildDropdown();   // 等价于 updateWorldInfoList 把下拉框填好
    }
}

async function toggleWorldAsync(name, forceOn) {
    if (!name) return false;
    const before = isWorldEnabled(name);
    const wantOn = (forceOn === undefined) ? !before : Boolean(forceOn);
    if (wantOn === before) return before;

    await ensureWorldListReadyStub();

    let changed = false;
    if (wantOn) {
        if (!selectedWorldInfo.includes(name)) { selectedWorldInfo.push(name); changed = true; }
    } else {
        let idx = selectedWorldInfo.indexOf(name);
        while (idx !== -1) { selectedWorldInfo.splice(idx, 1); changed = true; idx = selectedWorldInfo.indexOf(name); }
    }
    if (!changed) return isWorldEnabled(name);

    const hit = syncWorldInfoSelect(name, wantOn);
    if (hit > 0) triggerWorldInfoChange();
    saveCalls++;
    return isWorldEnabled(name);
}

// 模拟"用户从没打开过世界书面板"：下拉框是空的
selectedWorldInfo = [];
dropdownOptions = [];          // 空下拉框
worldCatalog.length = 0;       // 连名字列表都没有
globalSelectMirror = [];
ensureCalls = 0; changeTriggered = 0;

// 先把 catalog 恢复（真实世界里 /api/worldinfo/list 本来就能返回）
worldCatalog.push('A世界书', 'B世界书', 'C世界书', 'D世界书', '含,逗号的书', '别的书', '原样不动的书', '重复书', '别人');

const r12 = await toggleWorldAsync('C世界书', true);
if (ensureCalls === 1) ok('先调了一次热身（刷新世界书列表）');
else no('先调了一次热身', String(ensureCalls));
if (r12 === true) ok('热身之后开关照样成功');
else no('热身之后开关照样成功', String(r12));
if (isWorldEnabled('C世界书')) ok('数据改到了');
else no('数据改到了', JSON.stringify(selectedWorldInfo));
if (Array.isArray(globalSelectMirror) && globalSelectMirror.includes('C世界书')) {
    ok('★ 酒馆那侧也同步了（哪怕一开始下拉框是空的）');
} else {
    no('★ 酒馆那侧也同步了', JSON.stringify(globalSelectMirror));
}

// [13] 反复切换后状态自洽
console.log('\n[13] 反复切换后状态自洽');
selectedWorldInfo = [];
rebuildDropdown();
globalSelectMirror = [];
worldCatalog.length = 0;
worldCatalog.push('A世界书', 'B世界书', 'C世界书', 'D世界书', '含,逗号的书', '别的书', '原样不动的书', '重复书', '别人');
rebuildDropdown();

for (let i = 0; i < 5; i++) {
    await toggleWorldAsync('B世界书', true);
    await toggleWorldAsync('B世界书', false);
}
await toggleWorldAsync('B世界书', true);
if (selectedWorldInfo.filter(n => n === 'B世界书').length === 1) ok('反复切换后没有产生重复项');
else no('反复切换后没有产生重复项', JSON.stringify(selectedWorldInfo));
if (isWorldEnabled('B世界书')) ok('最终状态正确（开着）'); else no('最终状态正确（开着）');
if (selectedWorldInfo.length === 1) ok('列表里就只有这一本');
else no('列表里就只有这一本', JSON.stringify(selectedWorldInfo));

console.log(`\n=== 结果：${pass} 项通过，${fail} 项失败 ===`);
process.exit(fail ? 1 : 0);

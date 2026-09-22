/**
 * Worldbook Gallery — 世界书卡面管理
 *
 * 目的：把酒馆里"名字奇怪、认不出来"的世界书，用「绑定的那张角色卡的卡面」展示出来。
 *
 * 设计的硬性前提（已在酒馆 1.18.0 源码里核实）：
 *   每张角色卡的 PNG 里带有字段  data.extensions.world
 *   它的值就是"这张卡绑定哪本世界书"的名字——这是唯一权威的对应关系来源。
 *   参考：public/scripts/world-info.js 第 1127、4164、5567、6205 行附近。
 *
 * 本插件严格遵守「只看不改」：
 *   - 不写任何文件
 *   - 不改世界书名字、不改卡的名字
 *   - 不调用任何会改数据的接口
 *   面板里显示的名字是"拼好的展示名"，磁盘上的文件名一个字不动。
 */

// 路径基准说明（已按 SillyTavern 1.18.0 实测校准）：
// 本扩展位于 public/scripts/extensions/third-party/worldbook-gallery/index.js
//   script.js      实际在 public/script.js         → 须向上 4 层
//   world-info.js  实际在 public/scripts/           → 须向上 3 层
//   extensions.js  实际在 public/scripts/           → 须向上 3 层
// 注意：script.js 在 public/ 下，不在 public/scripts/ 下，两者层数不同。
import {
    eventSource,
    event_types,
    getRequestHeaders,
    getThumbnailUrl,
    characters,
    saveSettingsDebounced,
} from '../../../../script.js';
import {
    world_names,
    selected_world_info,
    openWorldInfoEditor,
    updateWorldInfoList,
} from '../../../world-info.js';
import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'worldbook-gallery';
const LOG_PREFIX = '[Worldbook Gallery]';

// ---------------------------------------------------------------------------
// 设置项
// ---------------------------------------------------------------------------

const defaultSettings = {
    // 展示名风格：'card'（卡名优先） | 'world'（世界书名优先） | 'both'（卡名 · 世界书名）
    displayStyle: 'both',
    // 是否在网格里显示没有绑定任何卡的世界书
    showOrphans: true,
    // 是否只看当前已开启的世界书
    onlyEnabled: false,
    // 缩略图尺寸（像素）
    thumbSize: 150,
};

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = defaultSettings[key];
        }
    }
    return extension_settings[MODULE_NAME];
}

// ---------------------------------------------------------------------------
// 数据采集
// ---------------------------------------------------------------------------

/**
 * 建立「世界书名 → 绑定它的角色卡列表」映射。
 *
 * 数据来源：characters 数组里每张卡的 data.extensions.world。
 * 另外还检查卡自带的 character_book（嵌入式世界书）——这种卡的世界书
 * 可能还没被导入成独立文件，属于"卡在世界书没在"的情况。
 */
function buildIndex() {
    const byWorld = new Map();   // 世界书名 -> [ {avatar, name, chid} ]
    const embedded = [];         // 卡自带世界书

    for (let chid = 0; chid < characters.length; chid++) {
        const ch = characters[chid];
        if (!ch) continue;

        const avatar = ch.avatar;
        const cardName = ch.name || (avatar ? avatar.replace(/\.png$/i, '') : '(无名)');

        // 主世界书绑定
        const worldName = ch?.data?.extensions?.world;
        if (worldName) {
            if (!byWorld.has(worldName)) byWorld.set(worldName, []);
            byWorld.get(worldName).push({ avatar, name: cardName, chid });
        }

        // 卡自带世界书（character_book）
        const book = ch?.data?.character_book;
        if (book) {
            embedded.push({
                avatar,
                name: cardName,
                chid,
                bookName: book?.name || '',
                entryCount: Array.isArray(book?.entries) ? book.entries.length : 0,
                linkedWorld: worldName || '',
            });
        }
    }

    return { byWorld, embedded };
}

/**
 * 读世界书列表。用酒馆自己的接口拿，保证和酒馆看到的一致。
 * 返回：[{ file_id, name, extensions }]
 */
async function fetchWorldList() {
    const res = await fetch('/api/worldinfo/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`世界书列表读取失败：HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

/**
 * 读某本世界书的详情，用来统计条目数。
 * 条目数可以让用户大致判断"这本是不是我要的那本"。
 */
async function fetchWorldDetail(name) {
    try {
        const res = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const entries = data?.entries;
        const count = entries
            ? (Array.isArray(entries) ? entries.length : Object.keys(entries).length)
            : 0;
        return { entryCount: count, raw: data };
    } catch (err) {
        console.warn(LOG_PREFIX, '读取世界书详情失败', name, err);
        return null;
    }
}

/**
 * 汇总成面板要用的行数据。
 * 每一行代表"一本世界书"，附带它的卡面。
 */
async function collectRows({ withDetails = false } = {}) {
    const { byWorld, embedded } = buildIndex();
    const worlds = await fetchWorldList();
    const settings = getSettings();

    const rows = [];
    const seen = new Set();

    for (const w of worlds) {
        const key = w.file_id ?? w.name;
        seen.add(key);

        const owners = byWorld.get(w.file_id) || byWorld.get(w.name) || [];
        const primary = owners[0] || null;

        rows.push({
            kind: 'world',
            worldFile: w.file_id ?? w.name,
            worldName: w.name || w.file_id,
            owners,
            primaryAvatar: primary ? primary.avatar : null,
            primaryCardName: primary ? primary.name : null,
            entryCount: null,
            raw: w,
        });
    }

    // 卡绑定了一本名字，但那本世界书并不存在 —— "卡在世界书没在"
    for (const [worldName, owners] of byWorld.entries()) {
        if (!seen.has(worldName)) {
            rows.push({
                kind: 'missing',
                worldFile: worldName,
                worldName,
                owners,
                primaryAvatar: owners[0]?.avatar ?? null,
                primaryCardName: owners[0]?.name ?? null,
                entryCount: null,
                raw: null,
            });
        }
    }

    if (withDetails) {
        for (const row of rows) {
            if (row.kind === 'world') {
                const detail = await fetchWorldDetail(row.worldFile);
                row.entryCount = detail ? detail.entryCount : null;
            }
        }
    }

    // 孤立世界书（没有任何卡绑定）
    if (!settings.showOrphans) {
        return { rows: rows.filter(r => r.owners.length > 0 || r.kind !== 'world'), embedded };
    }

    return { rows, embedded };
}

// ---------------------------------------------------------------------------
// 展示名拼装
// ---------------------------------------------------------------------------

/**
 * 拼一个"人看得懂"的名字。
 * 只看不改——这是面板里显示的字符串，磁盘文件名不动。
 */
function displayName(row) {
    const style = getSettings().displayStyle;
    const card = row.primaryCardName;
    const world = row.worldName;

    if (!card) {
        // 没卡绑定，只能显示世界书名本身，并标记出来
        return style === 'world' ? world : `${world}（未绑定卡）`;
    }

    switch (style) {
        case 'card': return card;
        case 'world': return world;
        case 'both':
        default:
            return card === world ? card : `${card} · ${world}`;
    }
}

// ---------------------------------------------------------------------------
// 启用 / 停用 世界书
// ---------------------------------------------------------------------------
//
// 酒馆里"世界书有没有开启"指的是「全局启用列表」——就是设置面板里
// 「已启用的世界书（全局有效）」那个多选框，对应内部变量 selected_world_info。
// 卡自带的世界书导入后就是加进这个全局列表的，所以这里控制的就是它。
//
// 为什么不用酒馆现成的 onWorldInfoChange(args, text) 那条"斜杠命令"入口：
//   第一版试过，实测点不动。那个入口内部是这样找世界书的
//   （world-info.js 第 5654~5660 行）：
//       text.trim().toLowerCase().split(',')   // 先转小写、再按逗号切
//       getWIElement(worldName)                // 再去 #world_info 下拉框里配对
//   而 getWIElement 是拿"下拉框里每一项的文字"跟名字逐字比（第 2090 行）。
//   这条链上任何一环不满足就静默失败：
//     - 下拉框没被填充（要打开过世界书面板才会填，见 updateWorldInfoList）
//     - 名字里有逗号 → 被切碎
//     - 名字匹配不上 → 直接"找不到这个世界书"
//   结果就是：点了开关，什么也没发生，只在右下角看到"没能改掉"。
//
//   注意：这里说的是**带参数**的那个入口（斜杠命令用）。
//   无参数的 onWorldInfoChange('__notSlashCommand__') 是另一回事——
//   它是酒馆自己下拉框 change 的处理函数，正是我们要借用的通道，见下面第二层。
//
// 现在的做法（直连数据 + 借酒馆自己的回写通道）：
//
//   第一层 —— 直接改数据：
//     selected_world_info 在 world-info.js 第 66 行是 `export let`，
//     导出的是**数组本身**。ES module 的 imported binding 不能整体重新赋值，
//     但**可以就地改数组内容**（push / splice），改的就是酒馆在用的那份数据。
//
//   第二层 —— 借酒馆自己的回写通道（关键，0.2.1 才补上）：
//     光改数组不够。酒馆存盘和界面渲染，读的都是 world_info.globalSelect，
//     而这个字段只在 world-info.js 第 84 行那个**私有**的 saveSettingsDebounced 里
//     才被同步（第 85 行 Object.assign(world_info, { globalSelect: selected_world_info })）。
//     我们从 script.js 导入的那个同名 saveSettingsDebounced 是**另一个函数**，
//     它只调 saveSettings() 存盘，压根不碰 globalSelect —— 这就是"开关拨过去了、
//     酒馆原生界面却没变"的根因。
//
//     酒馆自带的正确通道是这个（第 6057 行，initWorldInfo 里绑的）：
//         $('#world_info').on('mousedown change', ...) → onWorldInfoChange('__notSlashCommand__')
//     它会把下拉框里选中的项读回来、覆盖 selected_world_info，
//     再走第 5719~5723 行：改数组 + saveSettingsDebounced() + 发 WORLDINFO_SETTINGS_UPDATED。
//     所以我们的做法是：先把下拉框的勾选状态对齐好，再 trigger('change')，
//     剩下的全部交给酒馆自己完成。

/**
 * 这本书当前启用了没。
 */
function isWorldEnabled(worldName) {
    return Array.isArray(selected_world_info) && selected_world_info.includes(worldName);
}

/**
 * 切换一本书的启用状态。
 *
 * 这是异步的，因为可能要先补一次"世界书列表加载"。
 * 不 await 也能用（数据和存盘都会照做），只是 UI 刷新可能慢一拍。
 *
 * @param {string} worldName 世界书名
 * @param {boolean} [forceOn] 指定开启或关闭；不传则按当前状态取反
 * @returns {Promise<boolean>} 操作后是否处于启用状态（失败时返回原状态）
 */
async function toggleWorld(worldName, forceOn) {
    if (!worldName) return false;

    const before = isWorldEnabled(worldName);
    const wantOn = (forceOn === undefined) ? !before : Boolean(forceOn);

    if (wantOn === before) return before;   // 已经是目标状态，不用动

    // ---- 0. 先保证酒馆那个下拉框是"新鲜可用"的 ----
    //    没有这一步，如果用户从没打开过世界书面板，下拉框就是空的：
    //      a) 我们的回写通道会拿不到这本书（syncWorldInfoSelect 返回 0）
    //      b) 酒馆存盘时写进去的 globalSelect 也可能缺斤少两
    //    所以这里主动补一次列表（等价于酒馆打开面板时做的事）。
    try {
        await ensureWorldListReady();
    } catch (err) {
        console.warn(LOG_PREFIX, '刷新世界书列表失败，继续按现有状态操作', err);
    }

    // ---- 1. 直接改那份数据（这一步是必须成功的） ----
    let changed = false;
    try {
        if (wantOn) {
            // 先防重：万一里面已经有了，别加第二遍
            if (!selected_world_info.includes(worldName)) {
                selected_world_info.push(worldName);
                changed = true;
            }
        } else {
            // 用 while 把同名项全部清掉（理论上只有一个，稳一点）
            let idx = selected_world_info.indexOf(worldName);
            while (idx !== -1) {
                selected_world_info.splice(idx, 1);
                changed = true;
                idx = selected_world_info.indexOf(worldName);
            }
        }
    } catch (err) {
        console.error(LOG_PREFIX, '改写启用列表失败', worldName, err);
        return before;
    }

    if (!changed) {
        // 数据没变（极少见），如实返回真实状态
        return isWorldEnabled(worldName);
    }

    // ---- 2. 让酒馆自己把这次改动接管过去 ----
    // 顺序很重要：先对齐下拉框勾选，再触发 change。
    // 触发后酒馆会走 onWorldInfoChange('__notSlashCommand__')，
    // 从下拉框读回选中项 → 覆盖 selected_world_info → 同步 world_info.globalSelect
    // → 存盘 → 发事件刷新界面。这一整套是酒馆原生逻辑，比我们自己拼更可靠。
    try {
        syncWorldInfoSelect(worldName, wantOn);
        triggerWorldInfoChange();
    } catch (err) {
        console.warn(LOG_PREFIX, '借酒馆通道回写失败，已回退到插件自备路径（数据仍然是对的）', err);
    }

    // ---- 3. 兜底：无论上面成不成，存盘 + 通知都补一次 ----
    // 重复调用是安全的（debounce 会合并）。
    // 万一第 2 步因为下拉框还没填充而没生效，这里至少保证数据落盘。
    try {
        saveSettingsDebounced();
    } catch (err) {
        console.warn(LOG_PREFIX, '保存设置失败', err);
    }
    try {
        eventSource.emit(event_types.WORLDINFO_SETTINGS_UPDATED);
    } catch { /* 事件不存在就跳过 */ }

    // ---- 4. 以真实数据为准返回 ----
    return isWorldEnabled(worldName);
}

/**
 * 确保酒馆的「世界书列表 + 那个下拉框」是新鲜可用的。
 *
 * 为什么需要这一步（实测踩过）：
 *   酒馆的 #world_info 下拉框不是天生就有内容的，只有在
 *   updateWorldInfoList()（world-info.js 第 2061 行）跑过之后才会被填满。
 *   它是个 async 函数，内部会：
 *     - 从 /api/settings/get 重新拿一遍世界书名字列表
 *     - 清空并重建 #world_info 和 #world_editor_select 的 <option>
 *     - 按 selected_world_info 决定哪些 option 默认勾上
 *   所以我们先调它一次，等于"帮用户把世界书面板打开了一下"。
 *
 * 安全说明：
 *   updateWorldInfoList 只读文件列表、只重画下拉框，不会改世界书内容、
 *   不会写任何文件，也不会改 selected_world_info。属于纯刷新操作。
 */
async function ensureWorldListReady() {
    const $ = window.jQuery;
    if (!$) return;

    const $wi = $('#world_info');
    const hasOptions = $wi.length && $wi.find('option[value!=""]').length > 0;
    const hasNames = Array.isArray(world_names) && world_names.length > 0;

    if (hasOptions && hasNames) return;   // 已经是好的，不用动

    if (typeof updateWorldInfoList !== 'function') {
        console.warn(LOG_PREFIX, '拿不到 updateWorldInfoList，跳过热身（不影响直接改数据）');
        return;
    }

    console.log(LOG_PREFIX, '世界书列表还没准备好，先刷新一次');
    await updateWorldInfoList();
}

/**
 * 把酒馆界面上那个多选框（#world_info）里的勾选状态，对齐成我们改动后的样子。
 *
 * 这一步是「借酒馆通道回写」的前置动作，不是可有可无的装饰：
 * 酒馆的 onWorldInfoChange('__notSlashCommand__') 是**从下拉框读值**的
 * （world-info.js 第 5705 行 `$('#world_info').val()`），
 * 所以必须先把下拉框改成我们想要的样子，再触发 change。
 *
 * @returns {number} 改到了几个 option；为 0 说明下拉框里没有这本书（可能还没渲染）
 */
function syncWorldInfoSelect(worldName, on) {
    const $ = window.jQuery;
    if (!$) return 0;
    const $wi = $('#world_info');
    if (!$wi.length) return 0;

    let hit = 0;
    $wi.find('option').each(function () {
        if ($(this).text() === worldName) {
            $(this).prop('selected', on);
            hit++;
        }
    });
    if (hit === 0) {
        // 下拉框里没有这本书 → 后面 trigger('change') 会把它清空，
        // 所以这种情况必须提前拦住，别去触发。
        console.warn(LOG_PREFIX, '下拉框里没找到这本书，跳过回写通道：', JSON.stringify(worldName));
    }
    return hit;
}

/**
 * 触发 #world_info 的 change，把控制权交还给酒馆。
 *
 * 只在「下拉框确实非空」时才触发：因为 onWorldInfoChange 的第一句就是
 * `if (world_names.length === 0) { e.preventDefault(); return; }`，
 * 而且它拿 `val()` 读值——万一下拉框还是空的，触发一次等于把
 * selected_world_info 覆盖成空数组，反而把状态弄丢。
 *
 * @returns {boolean} 是否触发了
 */
function triggerWorldInfoChange() {
    const $ = window.jQuery;
    if (!$) return false;
    const $wi = $('#world_info');
    if (!$wi.length) return false;

    const names = Array.isArray(world_names) ? world_names : [];
    if (names.length === 0) {
        console.warn(LOG_PREFIX, '世界书列表还是空的（updateWorldInfoList 可能没跑过），跳过回写通道');
        return false;
    }

    $wi.trigger('change');
    return true;
}

// ---------------------------------------------------------------------------
// 面板渲染
// ---------------------------------------------------------------------------

let panelEl = null;
let lastRows = [];

function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;

    panelEl = document.createElement('div');
    panelEl.id = 'wbg-panel';
    panelEl.className = 'wbg-panel';
    panelEl.innerHTML = `
        <div class="wbg-header">
            <div class="wbg-title">
                <i class="fa-solid fa-images"></i>
                <span>世界书卡面管理</span>
            </div>
            <div class="wbg-header-actions">
                <button class="wbg-btn" id="wbg-refresh" title="重新扫描">
                    <i class="fa-solid fa-rotate"></i> 重新扫描
                </button>
                <button class="wbg-btn wbg-btn-close" id="wbg-close" title="关闭">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
        <div class="wbg-toolbar">
            <input type="search" id="wbg-search" class="text_pole" placeholder="搜索卡名或世界书名…" />
            <select id="wbg-style" class="text_pole">
                <option value="both">显示：卡名 · 世界书名</option>
                <option value="card">只显示卡名</option>
                <option value="world">只显示世界书名</option>
            </select>
            <label class="wbg-check">
                <input type="checkbox" id="wbg-orphans" checked />
                <span>显示未绑定的世界书</span>
            </label>
            <label class="wbg-check">
                <input type="checkbox" id="wbg-only-on" />
                <span>只看已开启</span>
            </label>
        </div>
        <div class="wbg-stats" id="wbg-stats"></div>
        <div class="wbg-body" id="wbg-body"></div>
    `;

    document.body.appendChild(panelEl);

    panelEl.querySelector('#wbg-close').addEventListener('click', () => closePanel());
    panelEl.querySelector('#wbg-refresh').addEventListener('click', () => refresh(true));
    panelEl.querySelector('#wbg-search').addEventListener('input', () => renderGrid());
    panelEl.querySelector('#wbg-style').addEventListener('change', (e) => {
        getSettings().displayStyle = e.target.value;
        saveSettingsDebounced();
        renderGrid();
    });
    panelEl.querySelector('#wbg-orphans').addEventListener('change', (e) => {
        getSettings().showOrphans = e.target.checked;
        saveSettingsDebounced();
        refresh(false);
    });
    panelEl.querySelector('#wbg-only-on').addEventListener('change', (e) => {
        getSettings().onlyEnabled = e.target.checked;
        saveSettingsDebounced();
        renderGrid();
    });

    return panelEl;
}

function openPanel() {
    ensurePanel();
    const s = getSettings();
    panelEl.querySelector('#wbg-style').value = s.displayStyle;
    panelEl.querySelector('#wbg-orphans').checked = s.showOrphans;
    panelEl.querySelector('#wbg-only-on').checked = Boolean(s.onlyEnabled);
    panelEl.classList.add('wbg-open');
    refresh(true);
}

function closePanel() {
    if (panelEl) panelEl.classList.remove('wbg-open');
}

function setStats(text) {
    ensurePanel().querySelector('#wbg-stats').textContent = text;
}

async function refresh(withDetails) {
    const body = ensurePanel().querySelector('#wbg-body');
    body.innerHTML = `<div class="wbg-loading"><i class="fa-solid fa-spinner fa-spin"></i> 正在扫描世界书与角色卡…</div>`;
    setStats('');

    try {
        const { rows, embedded } = await collectRows({ withDetails: Boolean(withDetails) });
        lastRows = rows;

        const bound = rows.filter(r => r.owners.length > 0).length;
        const orphan = rows.filter(r => r.kind === 'world' && r.owners.length === 0).length;
        const missing = rows.filter(r => r.kind === 'missing').length;

        const parts = [`共 ${rows.length} 本世界书`, `其中 ${bound} 本已绑定卡`];
        if (orphan) parts.push(`${orphan} 本没有卡绑定`);
        if (missing) parts.push(`${missing} 本卡里写了但文件不存在`);
        if (embedded.length) parts.push(`${embedded.length} 张卡自带世界书`);

        // 统计行分两段存：baseText 是不随开关变的部分，
        // 每次开合开关只要重拼后半段就行，不用重扫。
        const statsEl = ensurePanel().querySelector('#wbg-stats');
        statsEl.dataset.baseText = parts.join('　·　');
        const enabledCount = rows.filter(r => r.kind === 'world' && isWorldEnabled(r.worldName)).length;
        statsEl.textContent = `${statsEl.dataset.baseText}　·　${enabledCount} 本已开启`;

        renderGrid();
    } catch (err) {
        console.error(LOG_PREFIX, err);
        body.innerHTML = `<div class="wbg-error">扫描失败：${escapeHtml(String(err?.message || err))}</div>`;
    }
}

function renderGrid() {
    const panel = ensurePanel();
    const body = panel.querySelector('#wbg-body');
    const query = (panel.querySelector('#wbg-search').value || '').trim().toLowerCase();

    let rows = lastRows;
    if (getSettings().onlyEnabled) {
        rows = rows.filter(r => r.kind === 'world' && isWorldEnabled(r.worldName));
    }
    if (query) {
        rows = rows.filter(r =>
            (r.worldName || '').toLowerCase().includes(query) ||
            (r.primaryCardName || '').toLowerCase().includes(query) ||
            r.owners.some(o => (o.name || '').toLowerCase().includes(query)));
    }

    if (!rows.length) {
        body.innerHTML = `<div class="wbg-empty">没有匹配的世界书。</div>`;
        return;
    }

    // 排序：有卡的在前，同组内按展示名排
    rows = rows.slice().sort((a, b) => {
        const ao = a.owners.length ? 0 : 1;
        const bo = b.owners.length ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return displayName(a).localeCompare(displayName(b), 'zh');
    });

    const size = getSettings().thumbSize;
    const grid = document.createElement('div');
    grid.className = 'wbg-grid';
    grid.style.setProperty('--wbg-thumb', `${size}px`);

    for (const row of rows) {
        grid.appendChild(buildCard(row));
    }

    body.innerHTML = '';
    body.appendChild(grid);
}

function buildCard(row) {
    // 只有真实存在的世界书才有"启用/停用"这回事；卡里写了但文件丢了的不算。
    const canToggle = row.kind === 'world';
    const enabled = canToggle ? isWorldEnabled(row.worldName) : false;

    const card = document.createElement('div');
    card.className = 'wbg-card';
    if (row.kind === 'missing') card.classList.add('wbg-card-missing');
    if (!row.owners.length && row.kind === 'world') card.classList.add('wbg-card-orphan');
    if (canToggle) card.classList.add(enabled ? 'wbg-card-on' : 'wbg-card-off');

    // 卡面
    const thumb = document.createElement('div');
    thumb.className = 'wbg-thumb';
    if (row.primaryAvatar) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        // 用酒馆自带的缩略图接口，比直接取原图快很多（原图可能好几 MB）
        img.src = getThumbnailUrl('avatar', row.primaryAvatar);
        img.alt = row.primaryCardName || '';
        img.onerror = () => {
            img.remove();
            thumb.classList.add('wbg-thumb-broken');
        };
        thumb.appendChild(img);
    } else {
        thumb.innerHTML = `<div class="wbg-thumb-placeholder"><i class="fa-regular fa-file-lines"></i></div>`;
    }

    if (row.owners.length > 1) {
        const badge = document.createElement('div');
        badge.className = 'wbg-badge';
        badge.textContent = `${row.owners.length} 张卡`;
        badge.title = row.owners.map(o => o.name).join('\n');
        thumb.appendChild(badge);
    }

    // 状态标识：贴在卡面左下角，一眼看出开没开
    let stateTag = null;
    if (canToggle) {
        stateTag = document.createElement('div');
        stateTag.className = 'wbg-state';
        stateTag.textContent = enabled ? '已开启' : '已关闭';
        thumb.appendChild(stateTag);
    }

    // 文字区
    const meta = document.createElement('div');
    meta.className = 'wbg-meta';

    const nameEl = document.createElement('div');
    nameEl.className = 'wbg-name';
    nameEl.textContent = displayName(row);
    nameEl.title = displayName(row);
    meta.appendChild(nameEl);

    const sub = document.createElement('div');
    sub.className = 'wbg-sub';
    if (row.kind === 'missing') {
        sub.textContent = '卡里写了，但世界书文件不存在';
        sub.classList.add('wbg-sub-warn');
    } else if (!row.owners.length) {
        sub.textContent = '没有卡绑定这本世界书';
        sub.classList.add('wbg-sub-warn');
    } else {
        const n = row.entryCount === null || row.entryCount === undefined
            ? '条目数未知'
            : `${row.entryCount} 条`;
        sub.textContent = `${n}　·　${row.worldName}`;
    }
    meta.appendChild(sub);

    // 开关按钮列（单独一行，避免和"点击卡片打开编辑器"打架）
    if (canToggle) {
        const bar = document.createElement('div');
        bar.className = 'wbg-toggle-bar';

        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'wbg-switch' + (enabled ? ' wbg-switch-on' : '');
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', enabled ? 'true' : 'false');
        sw.title = enabled ? '点一下停用这本世界书' : '点一下启用这本世界书';
        sw.innerHTML = `<span class="wbg-switch-knob"></span>`;
        sw.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            void onToggleClick(row, sw, stateTag, card);
        });

        const label = document.createElement('span');
        label.className = 'wbg-toggle-label';
        label.textContent = enabled ? '已开启' : '已关闭';

        bar.appendChild(sw);
        bar.appendChild(label);
        meta.appendChild(bar);
    }

    card.appendChild(thumb);
    card.appendChild(meta);

    card.title = [
        `显示名：${displayName(row)}`,
        `世界书文件名：${row.worldName}`,
        row.owners.length ? `绑定卡：${row.owners.map(o => o.name).join('、')}` : '绑定卡：无',
        canToggle ? `当前状态：${enabled ? '已开启' : '已关闭'}` : '',
    ].filter(Boolean).join('\n');

    // 点一下打开世界书编辑器（只读查看，不写数据）
    if (row.kind === 'world' && typeof openWorldInfoEditor === 'function') {
        card.addEventListener('click', () => {
            try {
                openWorldInfoEditor(row.worldFile);
            } catch (err) {
                console.warn(LOG_PREFIX, '打开编辑器失败', err);
            }
        });
    }

    return card;
}

/**
 * 点了卡片上的开关之后要做的事。
 *
 * 顺序：先切状态 → 等酒馆那边也同步完 → 再把界面刷成真实状态 → 最后弹个提示。
 * 界面状态一律以 isWorldEnabled() 读到的真实数据为准，
 * 不拿"用户以为点了什么"当结果，免得界面和酒馆对不上。
 *
 * 注意 toggleWorld 是 async 的（可能要补一次世界书列表刷新），
 * 所以这里先乐观地把界面切成目标状态，等它返回后再用真实状态校正一次，
 * 这样点下去就有即时反馈，不会卡一下。
 */
async function onToggleClick(row, swEl, stateTagEl, cardEl) {
    const before = isWorldEnabled(row.worldName);

    // 先乐观预热一下界面：按"取反"来画，让人立刻看到反应
    const optimistic = !before;
    paintToggle(swEl, stateTagEl, cardEl, optimistic);

    let after;
    try {
        after = await toggleWorld(row.worldName);
    } catch (err) {
        console.error(LOG_PREFIX, '切换出错', row.worldName, err);
        after = isWorldEnabled(row.worldName);   // 出错就回到真实状态
    }

    // 用真实状态校正界面
    paintToggle(swEl, stateTagEl, cardEl, after);

    // 提示
    if (after === before) {
        // 没变化。新实现是直接改数据，正常不会走到这里；
        // 真走到了说明世界书名字跟酒馆里的对不上（比如名字里带了特殊字符）。
        console.warn(LOG_PREFIX, '状态没变，名字可能是', JSON.stringify(row.worldName),
            '当前启用列表是', JSON.stringify(selected_world_info));
        toastWarn(`没能改掉「${displayName(row)}」的状态。按 F12 看控制台有详细信息。`);
    } else if (after) {
        toastOk(`已开启：${displayName(row)}`);
    } else {
        toastOk(`已关闭：${displayName(row)}`);
    }

    refreshStatsOnly();
}

/**
 * 把开关相关的三处界面元素画成指定状态。
 * 抽出来是因为 onToggleClick 里要画两次（乐观一次、校正一次）。
 */
function paintToggle(swEl, stateTagEl, cardEl, on) {
    if (cardEl) {
        cardEl.classList.toggle('wbg-card-on', on);
        cardEl.classList.toggle('wbg-card-off', !on);
    }
    if (swEl) {
        swEl.classList.toggle('wbg-switch-on', on);
        swEl.setAttribute('aria-checked', on ? 'true' : 'false');
        swEl.title = on ? '点一下停用这本世界书' : '点一下启用这本世界书';
        const label = swEl.parentElement?.querySelector('.wbg-toggle-label');
        if (label) label.textContent = on ? '已开启' : '已关闭';
    }
    if (stateTagEl) stateTagEl.textContent = on ? '已开启' : '已关闭';
}

/**
 * 只重算顶部那行统计（"共 N 本…其中 M 本已开启"），不重扫整张网格。
 * 开关开合时用它，比整页刷新快，也不会把滚动位置弄丢。
 */
function refreshStatsOnly() {
    const panel = ensurePanel();
    const rows = lastRows;
    const enabledCount = rows.filter(r =>
        (r.kind === 'world') && isWorldEnabled(r.worldName)).length;
    const base = panel.querySelector('#wbg-stats').dataset.baseText || '';
    panel.querySelector('#wbg-stats').textContent =
        `${base}　·　${enabledCount} 本已开启`;
}

/**
 * 右下角飘一个小提示，1.6 秒后自己消失。
 * 用自己写的而不是酒馆的 toastr，是为了不依赖酒馆内部实现。
 */
let toastTimer = null;
function toast(msg, kind) {
    let el = document.getElementById('wbg-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wbg-toast';
        document.body.appendChild(el);
    }
    el.className = `wbg-toast wbg-toast-${kind} wbg-toast-show`;
    el.textContent = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('wbg-toast-show');
    }, 1600);
}
function toastOk(msg) { toast(msg, 'ok'); }
function toastWarn(msg) { toast(msg, 'warn'); }

/**
 * 当前总共开着一本世界书（用于顶部统计）。
 */
function countEnabledWorlds() {
    return lastRows.filter(r => r.kind === 'world' && isWorldEnabled(r.worldName)).length;
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ---------------------------------------------------------------------------
// 入口：在扩展设置里加一个按钮
// ---------------------------------------------------------------------------

function buildSettingsUI() {
    const container = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!container) return;

    const block = document.createElement('div');
    block.className = 'wbg-settings-block';
    block.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>世界书卡面管理</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="wbg-desc">
                    把世界书按「它绑定的角色卡的卡面」铺开显示，方便辨认哪本属于哪张卡。<br>
                    只读不改：不会修改任何文件名或卡片内容。<br>
                    卡片上的开关可以直接开启／停用世界书，和酒馆自己界面里的状态是同一份。
                </p>
                <div class="wbg-settings-actions">
                    <button class="menu_button" id="wbg-open-panel">
                        <i class="fa-solid fa-images"></i> 打开卡面面板
                    </button>
                </div>
                <label class="wbg-check">
                    <input type="checkbox" id="wbg-set-orphans" checked />
                    <span>面板里显示未绑定任何卡的世界书</span>
                </label>
            </div>
        </div>
    `;
    container.appendChild(block);

    block.querySelector('#wbg-open-panel').addEventListener('click', () => openPanel());

    const orphansBox = block.querySelector('#wbg-set-orphans');
    orphansBox.checked = getSettings().showOrphans;
    orphansBox.addEventListener('change', (e) => {
        getSettings().showOrphans = e.target.checked;
        saveSettingsDebounced();
        if (panelEl) panelEl.querySelector('#wbg-orphans').checked = e.target.checked;
    });
}

/**
 * 扩展入口。
 *
 * 必须具名导出 `init`，因为 manifest.json 里写的是：
 *     "hooks": { "activate": "init" }
 * 酒馆加载时会去模块里找这个导出的函数并调用它
 * （见 public/scripts/extensions.js 第 438 行附近的 callExtensionHook）。
 * 用 jQuery(...) 那种立即执行写法是找不到 init 的，会导致加载失败。
 */
export async function init() {
    getSettings();

    // 等界面上的扩展设置容器出现再往里塞按钮，避免抢跑
    await waitForSettingsContainer();
    buildSettingsUI();

    // 卡或世界书有变动时，如果面板正开着，自动重扫
    const softRefresh = () => {
        if (panelEl && panelEl.classList.contains('wbg-open')) refresh(false);
    };
    // 世界书的"启用/停用"变了（不管是在酒馆自己界面改的，还是在这插件里改的）
    // 就只把网格重画一遍，不重扫文件，省时间也不会跳滚动条。
    const restatOnly = () => {
        if (!panelEl || !panelEl.classList.contains('wbg-open')) return;
        if (!lastRows.length) return;
        renderGrid();
        refreshStatsOnly();
    };
    const events = [
        event_types.CHARACTER_EDITED,
        event_types.CHARACTER_DELETED,
        event_types.CHARACTER_RENAMED,
        event_types.CHARACTER_DUPLICATED,
        event_types.WORLDINFO_UPDATED,
        event_types.WORLDINFO_ENTRIES_LOADED,
    ];
    for (const ev of events) {
        try { eventSource.on(ev, softRefresh); } catch { /* 事件不存在就跳过 */ }
    }
    // 这几件事只影响"哪本开着"，不影响配对关系 → 只重画状态
    const stateEvents = [
        event_types.WORLDINFO_SETTINGS_UPDATED,
        event_types.WORLDINFO_UPDATED,
    ];
    for (const ev of stateEvents) {
        if (ev === undefined) continue;
        try { eventSource.on(ev, restatOnly); } catch { /* 事件不存在就跳过 */ }
    }

    // 防止同一帧里 softRefresh 和 restatOnly 都跑（WORLDINFO_UPDATED 两边都挂了）
    // 简单起见：restatOnly 先跑，softRefresh 会因为 panel 已重画而只是再刷新一次，
    // 开销很小，可以接受。

    console.log(LOG_PREFIX, '已加载');
}

/**
 * 等扩展设置容器出现。
 * 最多等约 10 秒；超时也不报错，因为可能只是这个酒馆版本用了别的容器 id。
 */
async function waitForSettingsContainer(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (document.getElementById('extensions_settings2')
            || document.getElementById('extensions_settings')) {
            return true;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.warn(LOG_PREFIX, '没等到扩展设置容器，按钮可能没挂上去');
    return false;
}

// 供浏览器控制台调试用：
//   WorldbookGallery.open()               打开面板
//   WorldbookGallery.refresh()            重扫
//   WorldbookGallery.index()              看配对结果
//   WorldbookGallery.isOn('世界书名')      看某本开着没
//   WorldbookGallery.toggle('世界书名')    开关某本
window.WorldbookGallery = {
    open: openPanel,
    refresh,
    collectRows,
    index: buildIndex,
    isOn: isWorldEnabled,
    toggle: toggleWorld,
};

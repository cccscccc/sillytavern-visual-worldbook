/**
 * 自检脚本：不依赖浏览器，纯用 Node 跑核心配对逻辑。
 * 目的：在把插件放进酒馆之前，先证明「卡↔世界书配对」算法是对的。
 *
 * 做法：把 index.js 里几个纯函数抠出来（buildIndex / displayName），
 * 用构造的假数据跑一遍，检查输出是否符合预期。
 */

// ---- 从 index.js 复制的纯逻辑（保持同步，改动时两边一起改）----

function buildIndex(characters) {
    const byWorld = new Map();
    const embedded = [];

    for (let chid = 0; chid < characters.length; chid++) {
        const ch = characters[chid];
        if (!ch) continue;

        const avatar = ch.avatar;
        const cardName = ch.name || (avatar ? avatar.replace(/\.png$/i, '') : '(无名)');

        const worldName = ch?.data?.extensions?.world;
        if (worldName) {
            if (!byWorld.has(worldName)) byWorld.set(worldName, []);
            byWorld.get(worldName).push({ avatar, name: cardName, chid });
        }

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

function displayName(row, style = 'both') {
    const card = row.primaryCardName;
    const world = row.worldName;

    if (!card) {
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

// ---- 构造测试数据 ----

// 场景 1：整卡导入 —— 卡的 extensions.world 指向自己的世界书
// 场景 2：一张卡导入多次，多个世界书（模拟"导入多了名字变奇怪"）
// 场景 3：卡自带 character_book 但世界书文件还没导入
// 场景 4：一本孤立世界书，没有卡绑定
const fakeCharacters = [
    {
        avatar: '莉莉丝.png',
        name: '莉莉丝',
        data: { extensions: { world: '莉莉丝·艾乌洛斯·格雷拉特' } },
    },
    {
        avatar: 'Seraphina.png',
        name: 'Seraphina',
        data: { extensions: { world: 'Seraphina-World' } },
    },
    {
        // 同一张卡又导了一次，世界书名字被酒馆加了后缀 → 名字变奇怪
        avatar: 'Seraphina 1.png',
        name: 'Seraphina',
        data: { extensions: { world: 'Seraphina-World-1' } },
    },
    {
        // 卡自带世界书，但还没导入成独立文件
        avatar: '艾莉丝.png',
        name: '艾莉丝',
        data: {
            extensions: {},
            character_book: {
                name: '艾莉丝的世界',
                entries: [{}, {}, {}],
            },
        },
    },
    {
        // 卡里写了世界书名，但那个文件不存在
        avatar: '幽灵卡.png',
        name: '幽灵卡',
        data: { extensions: { world: '已删除的世界书' } },
    },
];

// 磁盘上实际存在的世界书
const fakeWorldFiles = [
    { file_id: '莉莉丝·艾乌洛斯·格雷拉特', name: '莉莉丝·艾乌洛斯·格雷拉特' },
    { file_id: 'Seraphina-World', name: 'Seraphina-World' },
    { file_id: 'Seraphina-World-1', name: 'Seraphina-World-1' },
    { file_id: '某个奇怪名字_20240101', name: '某个奇怪名字_20240101' }, // 孤立
];

function collectRows(characters, worlds) {
    const { byWorld, embedded } = buildIndex(characters);
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
        });
    }

    for (const [worldName, owners] of byWorld.entries()) {
        if (!seen.has(worldName)) {
            rows.push({
                kind: 'missing',
                worldFile: worldName,
                worldName,
                owners,
                primaryAvatar: owners[0]?.avatar ?? null,
                primaryCardName: owners[0]?.name ?? null,
            });
        }
    }

    return { rows, embedded };
}

// ---- 断言 ----

let pass = 0, fail = 0;
function check(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { pass++; console.log(`  ✅ ${label}`); }
    else {
        fail++;
        console.log(`  ❌ ${label}`);
        console.log(`     期望: ${JSON.stringify(expected)}`);
        console.log(`     实际: ${JSON.stringify(actual)}`);
    }
}

console.log('=== 世界书卡面管理 · 核心配对逻辑自检 ===\n');

const { rows, embedded } = collectRows(fakeCharacters, fakeWorldFiles);

console.log('[1] 世界书 → 卡 配对');
const lilith = rows.find(r => r.worldName === '莉莉丝·艾乌洛斯·格雷拉特');
check('莉莉丝的世界书配到卡「莉莉丝」', lilith.owners.map(o => o.name), ['莉莉丝']);
check('卡面用的是卡的文件', lilith.primaryAvatar, '莉莉丝.png');

const s2 = rows.find(r => r.worldName === 'Seraphina-World-1');
check('带后缀的世界书也能配到「Seraphina」', s2.owners.map(o => o.name), ['Seraphina']);

console.log('\n[2] 孤立世界书（没有卡绑定）');
const orphan = rows.find(r => r.worldName === '某个奇怪名字_20240101');
check('孤立世界书 owners 为空', orphan.owners.length, 0);
check('孤立世界书展示名带「未绑定卡」标记', displayName(orphan), '某个奇怪名字_20240101（未绑定卡）');

console.log('\n[3] 卡在世界书没在');
const missing = rows.find(r => r.kind === 'missing');
check('识别出缺失的世界书', missing.worldName, '已删除的世界书');
check('缺失项仍能显示是哪张卡要它', missing.primaryCardName, '幽灵卡');

console.log('\n[4] 卡自带世界书');
check('识别出 1 张卡自带世界书', embedded.length, 1);
check('自带世界书归属正确', embedded[0].name, '艾莉丝');
check('自带世界书条目数正确', embedded[0].entryCount, 3);

console.log('\n[5] 展示名三种风格');
const row = { worldName: 'Seraphina-World', primaryCardName: 'Seraphina', owners: [{}] };
check('both 风格', displayName(row, 'both'), 'Seraphina · Seraphina-World');
check('card 风格', displayName(row, 'card'), 'Seraphina');
check('world 风格', displayName(row, 'world'), 'Seraphina-World');
const sameName = { worldName: '莉莉丝', primaryCardName: '莉莉丝', owners: [{}] };
check('卡名与世界书名相同时不重复', displayName(sameName, 'both'), '莉莉丝');

console.log('\n[6] 总行数');
check('4 本世界书 + 1 本缺失 = 5 行', rows.length, 5);

console.log(`\n=== 结果：${pass} 项通过，${fail} 项失败 ===`);
process.exit(fail ? 1 : 0);

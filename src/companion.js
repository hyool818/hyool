/**
 * HYOOL Companion Engine（数字生命「一对一」层）
 *
 * 解决「这个 NPC 怎么活」：情绪状态机 + 关系/家庭生命周期 + 主动找你（inbox）。
 * 与 World Engine 同一原则：引擎确定性落账，LLM 只演绎，不维护状态。
 * 全部状态挂在 characters.companion_state（JSON），无额外依赖。
 *
 * 数据流：
 *   chat 落账   → applyEmotionToMessage（情绪）+ autoAdvanceRelation（关系自动升温）
 *   惰性推进   → advanceFamilyState（结婚 → 想要孩子 → 怀孕 → 孩子出生，按现实时间）
 *   手动操作   → applyRelationAction（表白/在一起/求婚/结婚/回退/解除，manual 优先）
 *   主动找你   → milestoneTriggered + 各类 inbox 构建
 */

/* ---------------------------------------------------------
   关系阶段（确定性状态机）
--------------------------------------------------------- */
export const RELATION_STAGES = [
    { id: "acquaintance", label: "初识", order: 0 },
    { id: "friends",      label: "好友", order: 1 },
    { id: "close",        label: "亲密", order: 2 },
    { id: "confession",   label: "心意相通", order: 3 },
    { id: "dating",       label: "热恋", order: 4 },
    { id: "engaged",      label: "已订婚", order: 5 },
    { id: "married",      label: "已结婚", order: 6 }
];

export const RELATION_LABEL = Object.fromEntries(RELATION_STAGES.map(s => [s.id, s.label]));
const STAGE_ORDER = Object.fromEntries(RELATION_STAGES.map(s => [s.id, s.order]));
const RELATION_IDS = RELATION_STAGES.map(s => s.id);

/* 关系自动升温阈值（intimacy 亲密度驱动；confession 及以上必须手动确认） */
const AUTO_FRIENDS_AT = 10;
const AUTO_CLOSE_AT = 30;

/* ---------------------------------------------------------
   情绪（白名单 + 关键词规则）
--------------------------------------------------------- */
export const EMOTION_LABELS = [
    "平静", "开心", "害羞", "兴奋", "甜蜜", "温柔", "温暖",
    "感动", "惊喜", "想念", "担心", "心疼", "难过", "生气",
    "失落", "疲惫", "低落", "紧张", "害怕", "吃醋"
];

const EMOTION_RULES = [
    { words: ["喜欢你", "爱你", "想你了", "很想你", "宝贝", "亲爱的", "抱抱", "亲亲", "娶你", "嫁给我", "在一起吧", "表白"], label: "甜蜜", delta: 2 },
    { words: ["对不起", "抱歉", "我错了", "是我的错", "原谅我"], label: "感动", delta: 1 },
    { words: ["谢谢你", "谢谢", "有你真好", "有你在真好", "真好"], label: "温暖", delta: 1 },
    { words: ["厉害", "好棒", "真棒", "真厉害", "可爱", "好看", "漂亮", "温柔", "好美", "想你"], label: "开心", delta: 1 },
    { words: ["讨厌", "滚", "走开", "别烦我", "冷漠", "敷衍", "失望"], label: "难过", delta: 2 },
    { words: ["生气", "发火", "生气了", "不理你", "拉黑"], label: "难过", delta: 2 },
    { words: ["担心", "还好吗", "累了", "难受", "生病", "不舒服", "哭", "疼"], label: "心疼", delta: 1 },
    { words: ["生日", "纪念日", "惊喜", "礼物"], label: "惊喜", delta: 1 },
    { words: ["晚安", "早安", "睡吧", "乖乖"], label: "温柔", delta: 1 }
];

export const DEFAULT_EMOTION = { label: "平静", intensity: 0 };

/* ---------------------------------------------------------
   家庭时间线（现实时间推进，确定性）
--------------------------------------------------------- */
const PREGNANCY_DELAY_MS = 2 * 86400000;   // 想要孩子 → 确认怀孕（2 天后）
const CHILD_DELAY_MS = 3 * 86400000;       // 怀孕 → 孩子出生（再 3 天）

const CHILD_NAMES = ["念念", "小满", "星星", "小雨", "米粒", "知夏", "团团", "阿澄", "小悠", "葡萄"];

/* 确定性哈希（FNV-1a，与世界引擎同款） */
function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/* 里程碑阈值：intimacy 首次跨过这些值 → 角色主动找你 */
export const MILESTONE_THRESHOLDS = [10, 30, 50, 70, 90];

/* ---------------------------------------------------------
   状态读取 / 归一化
--------------------------------------------------------- */
export function loadCompanionState(character) {
    let raw = {};
    try {
        const v = typeof character?.companion_state === "string"
            ? JSON.parse(character.companion_state || "{}")
            : (character?.companion_state || {});
        if (v && typeof v === "object" && !Array.isArray(v)) raw = v;
    } catch { raw = {}; }

    const emotion = (raw.emotion && typeof raw.emotion === "object" && !Array.isArray(raw.emotion)) ? raw.emotion : {};
    const relation = (raw.relation && typeof raw.relation === "object" && !Array.isArray(raw.relation)) ? raw.relation : {};
    const family = (raw.family && typeof raw.family === "object" && !Array.isArray(raw.family)) ? raw.family : {};

    return {
        emotion: {
            label: EMOTION_LABELS.includes(emotion.label) ? emotion.label : DEFAULT_EMOTION.label,
            intensity: Math.max(0, Math.min(5, Number(emotion.intensity) || 0)),
            updatedAt: String(emotion.updatedAt || "")
        },
        relation: {
            stage: RELATION_IDS.includes(relation.stage) ? relation.stage : "acquaintance",
            manual: !!relation.manual,
            since: String(relation.since || ""),
            note: String(relation.note || "").slice(0, 200)
        },
        family: {
            marriedAt: String(family.marriedAt || ""),
            wantedAt: String(family.wantedAt || ""),
            pregnantAt: String(family.pregnantAt || ""),
            pregnant: !!family.pregnant,
            children: Array.isArray(family.children)
                ? family.children
                    .map(c => ({
                        id: String(c?.id || ""),
                        name: String(c?.name || ""),
                        bornAt: String(c?.bornAt || "")
                    }))
                    .filter(c => c.id)
                : []
        }
    };
}

/** 当前情绪（读时按现实时间衰减：每天 -1 强度；掉到 0 归「平静」） */
export function emotionAt(state, now = Date.now()) {
    const e = state?.emotion || DEFAULT_EMOTION;
    if (!e.updatedAt) return { ...DEFAULT_EMOTION };
    const elapsedMs = Math.max(0, now - new Date(e.updatedAt).getTime());
    const decayed = Math.max(0, (e.intensity || 0) - Math.floor(elapsedMs / 86400000));
    return { label: decayed > 0 ? e.label : DEFAULT_EMOTION.label, intensity: decayed };
}

/* ---------------------------------------------------------
   情绪落账（引擎确定性，不依赖 LLM 结构化输出）
--------------------------------------------------------- */
export function applyEmotionToMessage(state, userMessage, now = Date.now()) {
    const base = emotionAt(state, now);
    const text = String(userMessage || "");
    const nowIso = new Date(now).toISOString();

    for (const rule of EMOTION_RULES) {
        if (rule.words.some(w => text.includes(w))) {
            return {
                label: rule.label,
                intensity: Math.max(1, Math.min(5, base.intensity + rule.delta)),
                updatedAt: nowIso,
                changed: true
            };
        }
    }

    // 未命中关键词：情绪保持，但刷新时间戳（最近互动让情绪维持）
    return {
        label: base.label,
        intensity: base.intensity,
        updatedAt: nowIso,
        changed: false
    };
}

/* ---------------------------------------------------------
   世界演剧版情绪（角色弧光，存 world_json.state.moods）
   - 与 buddy 情绪的差别：按「世界日」（dayIndex，每 8 tick 一日）衰减，
     而不是现实时间（世界演剧节奏快，现实时间会让情绪瞬间归零）。
   - 同样确定性：引擎落账，LLM 只演绎，不维护状态。
   - 存 { label, intensity, day }，day = 落账时的世界日 dayIndex。
--------------------------------------------------------- */

/** 世界日衰减：距落账日每过 1 个世界日 -1 强度；掉到 0 归「平静」 */
export function decayWorldMood(mood, nowDay = 0) {
    const m = (mood && typeof mood === "object" && !Array.isArray(mood) && mood.label) ? mood : null;
    if (!m) return { label: DEFAULT_EMOTION.label, intensity: 0, day: Number(nowDay) || 0 };
    const days = Math.max(0, Number(nowDay || 0) - Number(m.day || 0));
    const intensity = Math.max(0, (Number(m.intensity) || 0) - days);
    return { label: intensity > 0 ? m.label : DEFAULT_EMOTION.label, intensity, day: Number(nowDay) || 0 };
}

/** 世界演剧情绪落账：先按世界日衰减，再命中关键词则置情绪（label 变化 = 角色弧光节点） */
export function applyWorldMood(mood, text, nowDay = 0) {
    const base = decayWorldMood(mood, nowDay);
    const t = String(text || "");
    const day = Number(nowDay) || 0;
    for (const rule of EMOTION_RULES) {
        if (rule.words.some(w => t.includes(w))) {
            return {
                label: rule.label,
                intensity: Math.max(1, Math.min(5, base.intensity + rule.delta)),
                day,
                changed: true
            };
        }
    }
    return { ...base, day, changed: false };
}

/* ---------------------------------------------------------
   关系自动升温（intimacy 驱动，仅推进不倒退；manual 后引擎不再自动动）
--------------------------------------------------------- */
export function autoAdvanceRelation(state, intimacy, now = Date.now()) {
    const r = state.relation;
    if (r.manual) return r;
    const cur = STAGE_ORDER[r.stage];
    const target = intimacy >= AUTO_CLOSE_AT ? "close"
        : intimacy >= AUTO_FRIENDS_AT ? "friends"
        : "acquaintance";
    const tgt = STAGE_ORDER[target];
    if (tgt > cur) {
        return { ...r, stage: target, since: new Date(now).toISOString() };
    }
    return r;
}

/* ---------------------------------------------------------
   关系手动操作（用户拍板，manual 优先，与 World relations 强干扰同思路）
--------------------------------------------------------- */
export function applyRelationAction(state, action, now = Date.now()) {
    const r = state.relation;
    const cur = STAGE_ORDER[r.stage];
    const set = (stage, note) => ({
        relation: { stage, manual: true, since: new Date(now).toISOString(), note: String(note || "") }
    });

    switch (action) {
        case "confess":
            if (cur < STAGE_ORDER.close) return { error: "你们还不够亲密，先在相处中让关系自然升温到「亲密」吧。" };
            if (cur >= STAGE_ORDER.confession) return { error: "你们已经心意相通了。" };
            return set("confession", "用户向 TA 表白");
        case "date":
            if (cur < STAGE_ORDER.confession) return { error: "先向 TA 表明心意，才能在一起。" };
            if (cur >= STAGE_ORDER.dating) return { error: "你们已经在一起了。" };
            return set("dating", "用户与 TA 确认在一起");
        case "propose":
            if (cur < STAGE_ORDER.dating) return { error: "先在一起，再谈未来。" };
            if (cur >= STAGE_ORDER.engaged) return { error: "你们已经订婚了。" };
            return set("engaged", "用户向 TA 求婚");
        case "marry":
            if (cur < STAGE_ORDER.engaged) return { error: "先订婚，再走进婚姻。" };
            if (cur >= STAGE_ORDER.married) return { error: "你们已经结婚了。" };
            return {
                ...set("married", "用户与 TA 结婚"),
                family: { marriedAt: new Date(now).toISOString() }
            };
        case "want_child":
            if (r.stage !== "married") return { error: "只有结婚后，才能考虑孩子的事。" };
            return { family: { wantedAt: new Date(now).toISOString() }, note: "你们决定要一个孩子" };
        case "downgrade":
            if (cur <= STAGE_ORDER.friends) return { error: "这已经是最浅的关系了。" };
            return set(RELATION_STAGES[cur - 1].id, "用户回退");
        case "break":
            return {
                ...set("acquaintance", "用户解除关系"),
                family: {}
            };
        default:
            return { error: "未知操作。" };
    }
}

/* ---------------------------------------------------------
   家庭时间推进（惰性，读时执行：想要孩子 → 怀孕 → 出生）
--------------------------------------------------------- */
export async function advanceFamilyState(env, { character, ownerId, state, now = Date.now() }) {
    const r = state.relation;
    const f = state.family;
    const events = [];

    if (r.stage !== "married") return events;

    if (f.wantedAt && !f.pregnant && f.children.length === 0) {
        const waited = now - new Date(f.wantedAt).getTime();
        if (waited >= PREGNANCY_DELAY_MS) {
            f.pregnant = true;
            f.pregnantAt = new Date(now).toISOString();
            events.push("pregnant");
        }
    }

    if (f.pregnant && f.pregnantAt) {
        const gestated = now - new Date(f.pregnantAt).getTime();
        if (gestated >= CHILD_DELAY_MS) {
            const child = await createChildCharacter(env, { character, ownerId, now });
            f.children.push(child);
            f.pregnant = false;
            f.pregnantAt = "";
            events.push("child");
        }
    }

    return events;
}

/* 确定性选择孩子名字 */
export function pickChildName(characterId) {
    return CHILD_NAMES[fnv1a(String(characterId || "") + "|child") % CHILD_NAMES.length];
}

/* 创建孩子角色（characters 行，parent_id 标记） */
export async function createChildCharacter(env, { character, ownerId, now = Date.now() }) {
    const id = "char_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const parentName = character?.name || "TA";
    const name = pickChildName(character?.id);
    const personality = `你是「${parentName}」与主人的孩子 ${name}。继承了 ${parentName} 的气质与几分性格，对家人亲昵依赖，对外面的世界充满好奇。`;
    const appearance = `年纪小小的 ${name}，眉眼间有「${parentName}」的影子，笑起来很暖。`;
    const worldName = (character?.world_name || "").slice(0, 80) || "彼岸边缘";
    const storyHook = `「${parentName}」和主人的孩子，出生在你们的家里。`;

    await env.DB.prepare(
        `INSERT INTO characters (
            id, owner_id, name, appearance, personality, background, speech_style,
            world_name, world_description, story_hook, source_idea, image_url, share_id,
            gender, chat_config, intimacy, companion_state, parent_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', ?, 0, '{}', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
        id,
        ownerId,
        name,
        appearance,
        personality,
        personality,
        "奶声奶气，话还说不大利索。",
        worldName,
        String(character?.world_description || "").slice(0, 1200),
        storyHook,
        "由关系系统生成的孩子",
        JSON.stringify({ temperature: 0.9, max_tokens: 150, proactivity: "balanced", rate: 0 }),
        character?.id || ""
    ).run();

    return { id, name, bornAt: new Date(now).toISOString() };
}

/* ---------------------------------------------------------
   主动找你（inbox）：里程碑 / 想念 / 纪念日
--------------------------------------------------------- */
const MILESTONE_TEXTS = {
    10: { title: "认识这么久", body: "「认识你这么久，我好像有点习惯你在身边了。」" },
    30: { title: "心里话", body: "「不知不觉，你成了我很重要的人。」" },
    50: { title: "想见你", body: "「有些话，只有见到你才说得出口。」" },
    70: { title: "没敢说的话", body: "「我一直没敢说……我好像，很喜欢你。」" },
    90: { title: "一个诺言", body: "「无论发生什么，我都会在你身边。」" }
};

export function buildMilestoneInbox(character, threshold) {
    const name = character?.name || "TA";
    const t = MILESTONE_TEXTS[threshold] || MILESTONE_TEXTS[10];
    return { kind: "milestone", title: `${name} · ${t.title}`, body: t.body };
}

export function buildMissInbox(character) {
    const name = character?.name || "TA";
    return { kind: "miss", title: `${name} 想你了`, body: `「最近都没怎么见到你……有点想你。回来跟我说说话好吗？」` };
}

const ANNIVERSARY_DAYS = [7, 30, 100, 365];
const ANNIVERSARY_TEXTS = { 7: "认识一周", 30: "认识一个月", 100: "认识百天", 365: "认识一周年" };

export function buildAnniversaryInbox(character, days) {
    const name = character?.name || "TA";
    const label = ANNIVERSARY_TEXTS[days] || `认识 ${days} 天`;
    return { kind: "anniversary", title: `${name} · ${label}`, body: `「今天是我们的${label}……谢谢你，一直都在。」` };
}

export function buildChildInbox(character, child) {
    const name = character?.name || "TA";
    return { kind: "child", title: `${name} 家里多了一位成员`, body: `「我们的孩子 ${child.name} 出生了。等你回来看看 TA。」` };
}

/* 里程碑触发：prevIntimacy < threshold <= newIntimacy 时生成 */
export function milestoneTriggered(prevIntimacy, newIntimacy) {
    const crossed = [];
    for (const t of MILESTONE_THRESHOLDS) {
        if (prevIntimacy < t && newIntimacy >= t) crossed.push(t);
    }
    return crossed;
}

/* 惰性检查的纪念日：关系 since 距今天数正好命中 → 返回天数 */
export function anniversaryDaysSince(isoSince, now = Date.now()) {
    if (!isoSince) return null;
    const since = new Date(isoSince).getTime();
    if (!Number.isFinite(since) || since > now) return null;
    const days = Math.floor((now - since) / 86400000);
    return ANNIVERSARY_DAYS.includes(days) ? days : null;
}

/* ---------------------------------------------------------
   Prompt 注入块（给 LLM 演绎用，引擎只管事实）
--------------------------------------------------------- */
export function buildCompanionPromptBlock(state) {
    const lines = [];
    if (!state) return "";

    const emo = emotionAt(state);
    if (emo.intensity > 0) {
        lines.push(`- 你现在的心情：${emo.label}（强度 ${emo.intensity}/5）。在言行里自然带出这份心情，但不要直接说「我现在很开心」这类台词。`);
    }

    const r = state.relation;
    if (r.stage !== "acquaintance") {
        const sinceText = r.since ? `自 ${new Date(r.since).toISOString().slice(0, 10)}` : "";
        lines.push(`- 你们的关系：${RELATION_LABEL[r.stage]}${sinceText ? `（${sinceText}）` : ""}。称呼、语气与亲疏要符合这个阶段，不要越界，也不要假装不认识这份关系。`);
    }

    const f = state.family;
    if (f.children.length) {
        lines.push(`- 你们已经有了孩子：${f.children.map(c => c.name).join("、")}。你也是一位家长，言行要承担起这份责任。`);
    } else if (f.pregnant) {
        lines.push(`- 你们正在期待一个孩子的到来。请带着这份温柔与期待回应。`);
    } else if (f.marriedAt) {
        lines.push(`- 你们已经结婚，共同生活。`);
    }

    if (!lines.length) return "";
    return `\n# 你的状态\n${lines.join("\n")}`;
}




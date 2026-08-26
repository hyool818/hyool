/**
 * HYOOL 中枢 · 数据模型层：Project Blueprint（企划书）
 *
 * 一条完整链路：用户一句话 → 规划器(planner)产出 Blueprint → 编排层(engine)
 * 按 Blueprint 派生任务 → 工具层(tools)执行 → composeStoryJSON 落地为
 * story-editor 可播放的作品数据（写入前端 hyool_stories_v1）。
 *
 * Blueprint 分两部分：
 *   1) 「创作内容」（LLM 产出）：meta / cast / chapters(blocks) / logic
 *   2) 「派生资产」（确定性代码产出，LLM 不参与）：deriveAssets()
 *      —— 每章 scene 块派生背景图任务、每个 dialogue 块派生配音任务
 *
 * 设计要点：LLM 只做创作决策与内容，控制流与素材任务全部由确定性代码派生，
 * 从而规避 LLM 多步工具调用漂移（详见 docs/hyool-brain-architecture.md）。
 */
import { TTS_VOICES } from "../tts.js";

export const SCHEMA_VERSION = "hyool.brain.v1";

/* ---------------- 常量 ---------------- */

/** 风格预设：确定性拼装进所有图生图提示词，是「跨资产风格一致性」的锚点 */
export const STYLE_PRESETS = {
    shuimo: {
        id: "shuimo",
        label: "水墨",
        base: "中国水墨画风格，青绿山水，宣纸质感，留白构图，淡墨晕染，宋画意境，写意笔法",
        negative: "油画,厚涂,赛璐璐,写实照片,水印,文字"
    }
    // 后续按需扩展：anime / guofeng / 3d ...
};

export const ORIENTATIONS = ["landscape", "portrait"];
export const BLOCK_TYPES = ["scene", "dialogue", "choice"];
export const GENDERS = ["female", "male"];

/** 图片默认画幅（按作品方向） */
export const IMG_SIZE = { landscape: { width: 1280, height: 720 }, portrait: { width: 720, height: 1280 } };

const ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const VOICE_IDS = new Set(TTS_VOICES.map((v) => v.id));
const GENDER_VOICES = { female: [], male: [] };
TTS_VOICES.forEach((v) => {
    if (GENDER_VOICES[v.gender]) GENDER_VOICES[v.gender].push(v.id);
});

/** 供规划器提示词使用的音色清单（按性别分组） */
export function voiceCatalogForPrompt() {
    return TTS_VOICES.map((v) => `${v.id}（${v.gender === "female" ? "女声" : "男声"}）`).join("、");
}

/* ---------------- 规范化（补默认值，容错 LLM 输出） ---------------- */

export function normalizeBlueprint(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const meta = src.meta || {};
    const cast = Array.isArray(src.cast) ? src.cast : [];
    const chapters = Array.isArray(src.chapters) ? src.chapters : [];

    const bp = {
        schema: SCHEMA_VERSION,
        meta: {
            title: String(meta.title || "未命名作品").slice(0, 40),
            concept: String(meta.concept || "").slice(0, 300),
            logline: String(meta.logline || "").slice(0, 200),
            style: STYLE_PRESETS[meta.style] ? meta.style : "shuimo",
            orientation: ORIENTATIONS.includes(meta.orientation) ? meta.orientation : "landscape"
        },
        cast: cast.map((c, i) => ({
            id: String(c.id || `cast_${i + 1}`).slice(0, 32),
            name: String(c.name || `角色${i + 1}`).slice(0, 20),
            gender: GENDERS.includes(c.gender) ? c.gender : "female",
            age: String(c.age || "young").slice(0, 16),
            role: String(c.role || "").slice(0, 40),
            appearance: String(c.appearance || "").slice(0, 300),
            personality: String(c.personality || "").slice(0, 200),
            voiceId: VOICE_IDS.has(c.voiceId) ? c.voiceId : (GENDER_VOICES[c.gender]?.[0] || "zh-CN-XiaoxiaoNeural")
        })),
        chapters: chapters.slice(0, 8).map((ch, ci) => ({
            id: ch.id || `ch_${ci + 1}`,
            title: String(ch.title || `第${ci + 1}章`).slice(0, 40),
            blocks: (Array.isArray(ch.blocks) ? ch.blocks : []).slice(0, 60).map((b, bi) => normalizeBlock(b, bi))
        })),
        logic: src.logic && typeof src.logic === "object" ? src.logic : { state: {}, rules: {} }
    };

    // 保证每个章节至少一块
    if (!bp.chapters.length) bp.chapters.push({ id: "ch_1", title: "第一章", blocks: [normalizeBlock(null, 0)] });

    return bp;
}

function normalizeBlock(b, bi) {
    b = b && typeof b === "object" ? b : {};
    const type = BLOCK_TYPES.includes(b.type) ? b.type : "scene";
    const block = {
        id: b.id || `b_${bi + 1}`,
        type,
        content: String(b.content || "").slice(0, 500)
    };
    if (type === "dialogue") {
        block.speaker = String(b.speaker || "cast_1").slice(0, 32);
    }
    if (type === "choice") {
        block.prompt = String(b.prompt || "你如何选择？").slice(0, 200);
        block.options = (Array.isArray(b.options) ? b.options : []).slice(0, 4).map((o, oi) => ({
            label: String(o?.label || `选项${oi + 1}`).slice(0, 40),
            target: String(o?.target || "").slice(0, 32),
            require: Array.isArray(o?.require) ? o.require : [],
            effect: Array.isArray(o?.effect) ? o.effect : []
        }));
        if (!block.options.length) block.options = [{ label: "继续", target: "", require: [], effect: [] }];
    }
    return block;
}

/* ---------------- 校验（规划器重试反馈、run 前置检查共用） ---------------- */

export function validateBlueprint(bp) {
    const errors = [];

    if (!bp.meta?.title?.trim()) errors.push({ path: "meta.title", msg: "缺少作品名" });
    if (!STYLE_PRESETS[bp.meta?.style]) errors.push({ path: "meta.style", msg: `未知风格 ${bp.meta.style}` });
    if (!bp.cast?.length) errors.push({ path: "cast", msg: "至少需要 1 个角色" });
    if (!bp.chapters?.length) errors.push({ path: "chapters", msg: "至少需要 1 个章节" });

    const castIds = new Set();
    bp.cast?.forEach((c) => {
        if (!ID_RE.test(c.id)) errors.push({ path: `cast.${c.id}`, msg: `角色 id 非法：${c.id}` });
        if (castIds.has(c.id)) errors.push({ path: `cast.${c.id}`, msg: "角色 id 重复" });
        castIds.add(c.id);
        if (!VOICE_IDS.has(c.voiceId)) errors.push({ path: `cast.${c.id}.voiceId`, msg: `音色不存在：${c.voiceId}` });
    });

    // 第一遍：收集全部积木 id（choice 的 target 允许指向后续积木，故先整体收集）
    const blockIds = new Set();
    const seenBlocks = new Set();
    bp.chapters?.forEach((ch) => {
        (ch.blocks || []).forEach((b) => {
            if (!b.id || !ID_RE.test(b.id)) {
                errors.push({ path: `blocks.${b.id}`, msg: "积木 id 非法" });
            } else if (seenBlocks.has(b.id)) {
                errors.push({ path: `blocks.${b.id}`, msg: "积木 id 重复" });
            } else {
                seenBlocks.add(b.id);
                blockIds.add(b.id);
            }
        });
    });

    // 第二遍：逐块完整性校验（对白角色引用 / 分支目标引用）
    bp.chapters?.forEach((ch) => {
        if (!ch.id || !ch.blocks?.length) {
            errors.push({ path: `chapters.${ch.title}`, msg: "章节缺少 id 或积木" });
            return;
        }
        ch.blocks.forEach((b) => {
            if (b.type === "dialogue" && !castIds.has(b.speaker)) {
                errors.push({ path: `blocks.${b.id}.speaker`, msg: `对白引用不存在的角色：${b.speaker}` });
            }
            if (b.type === "choice") {
                b.options.forEach((o) => {
                    if (!o.target || !blockIds.has(o.target)) {
                        errors.push({ path: `blocks.${b.id}.options.${o.label}`, msg: `分支目标不存在：${o.target}` });
                    }
                });
            }
        });
    });

    // 角色 id 与积木 id 必须分属不同命名空间（避免派生素材任务 id 冲突）
    blockIds.forEach((id) => {
        if (castIds.has(id)) {
            errors.push({ path: `id.${id}`, msg: "角色 id 与积木 id 冲突，需全局唯一" });
        }
    });

    return errors;
}

/* ---------------- 派生资产（确定性，LLM 不参与） ---------------- */

/** djb2 确定性哈希：同一作品 + 同一块 → 同一 seed（素材缓存 / 一致性基础） */
export function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h >>> 0;
}

function buildStylePrompt(bp, detail) {
    const style = STYLE_PRESETS[bp.meta.style] || STYLE_PRESETS.shuimo;
    return `${style.base}，${detail}`.slice(0, 500);
}

function buildCharacterPrompt(bp, cast) {
    const parts = [
        STYLE_PRESETS[bp.meta.style]?.base || STYLE_PRESETS.shuimo.base,
        `${cast.role || "角色"}${cast.name}，${cast.gender === "female" ? "女性" : "男性"}，${cast.age}岁`,
        cast.appearance,
        "全身像，主体居中，纯色浅底，人物完整"
    ].filter(Boolean);
    return parts.join("，").slice(0, 500);
}

/**
 * 从 Blueprint 派生素材任务清单：
 *   images[]：每角色一张立绘 + 每个 scene 块一张背景图
 *   voices[]：每个 dialogue 块一条配音（文本/音色/归属）
 */
export function deriveAssets(bp) {
    const images = [];
    const voices = [];

    (bp.cast || []).forEach((c) => {
        images.push({
            id: `img_${c.id}`,
            kind: "character",
            castId: c.id,
            prompt: buildCharacterPrompt(bp, c),
            seed: djb2(`${bp.meta.title}|${c.id}`),
            refs: []
        });
    });

    (bp.chapters || []).forEach((ch) => {
        (ch.blocks || []).forEach((b) => {
            if (b.type === "scene") {
                images.push({
                    id: `img_${b.id}`,
                    kind: "background",
                    blockId: b.id,
                    prompt: buildStylePrompt(bp, b.content || "空场景"),
                    seed: djb2(`${bp.meta.title}|${b.id}`),
                    refs: []
                });
            } else if (b.type === "dialogue") {
                const cast = (bp.cast || []).find((c) => c.id === b.speaker);
                voices.push({
                    id: `tts_${b.id}`,
                    blockId: b.id,
                    castId: b.speaker,
                    text: b.content,
                    voice: cast?.voiceId || "zh-CN-XiaoxiaoNeural"
                });
            }
        });
    });

    return { images, voices, sfx: [], bgm: [] };
}

/* ---------------- 落地：Blueprint → story-editor 作品 JSON ---------------- */

function slug(s) {
    return String(s || "story").slice(0, 20).replace(/[^\w\u4e00-\u9fa5]/g, "");
}

/**
 * 把 Blueprint + 素材结果（assetMap: 任务 id → {url}）组装成
 * story-editor（hyool_stories_v1）可直接读取的作品对象。
 * choice 块在 Phase 2 分支引擎上线前降级为对白，元数据以 _choice 保留。
 */
export function composeStoryJSON(bp, assetMap) {
    const castMap = {};
    (bp.cast || []).forEach((c) => {
        castMap[c.name] = { kind: "tts", voice: c.voiceId };
    });

    const chapters = (bp.chapters || []).map((ch) => ({
        id: ch.id,
        title: ch.title,
        blocks: (ch.blocks || []).map((b) => {
            if (b.type === "scene") {
                const img = assetMap[`img_${b.id}`];
                return {
                    id: b.id,
                    type: "scene",
                    content: b.content || "",
                    media: img?.url ? { url: img.url, type: "image" } : undefined,
                    subtitle: { on: true }
                };
            }
            if (b.type === "dialogue") {
                const cast = (bp.cast || []).find((c) => c.id === b.speaker);
                const tts = assetMap[`tts_${b.id}`];
                return {
                    id: b.id,
                    type: "dialogue",
                    speaker: cast ? cast.name : "旁白",
                    content: b.content,
                    audio: tts?.url ? { url: tts.url, type: "audio" } : undefined,
                    subtitle: { on: true }
                };
            }
            if (b.type === "choice") {
                const opts = Array.isArray(b.options) ? b.options : [];
                return {
                    id: b.id,
                    type: "choice",
                    content: b.prompt || b.content || "请选择：",
                    choices: opts.map((o, i) => ({
                        id: o.id || `${b.id}_opt_${i}`,
                        label: String(o.label || `选项${i + 1}`).slice(0, 40),
                        jump: String(o.target || "next").slice(0, 96),
                        require: Array.isArray(o.require) ? o.require : [],
                        effect: Array.isArray(o.effect) ? o.effect : []
                    })),
                    _choice: b
                };
            }
            // 未知类型：降级为场景文字，避免丢块
            return {
                id: b.id,
                type: "scene",
                content: b.content || b.prompt || "",
                subtitle: { on: true }
            };
        })
    }));

    return {
        id: `hub_${slug(bp.meta.title)}_${djb2(bp.meta.title).toString(36)}`,
        title: bp.meta.title,
        orientation: bp.meta.orientation === "portrait" ? "portrait" : "landscape",
        chapters,
        cast: castMap,
        logic: {
            state: bp.logic && bp.logic.state && typeof bp.logic.state === "object" ? { ...bp.logic.state } : {},
            rules: bp.logic && bp.logic.rules && typeof bp.logic.rules === "object" ? { ...bp.logic.rules } : {}
        }
    };
}
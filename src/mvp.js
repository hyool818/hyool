import {
    generateCharacterFromIdea,
    chatWithCharacter,
    compressHistory,
    generateCharacterImage,
    regenerateCharacterImage,
    buildPortraitSvg,
    generateScriptFromConversation,
    generateNativeCharacter,
    generateNpcBatch,
    randomWorldName,
    generateWorldLine,
    pickNextSpeakers,
    summarizeWorldGap,
    normalizeModelId,
    updateWorldState,
    generateStoryBeat,
    STORY_PHASES
} from "./ai/gateway.js";
import { listModelInfos } from "./ai/models.js";
import { TTS_VOICES } from "./tts.js";
import {
    loadCompanionState,
    emotionAt,
    applyEmotionToMessage,
    applyWorldMood,
    autoAdvanceRelation,
    applyRelationAction,
    advanceFamilyState,
    buildMilestoneInbox,
    buildMissInbox,
    buildAnniversaryInbox,
    buildChildInbox,
    milestoneTriggered,
    anniversaryDaysSince,
    RELATION_LABEL
} from "./companion.js";

// 所有可用语音 id（创建/保存角色时校验 voice）
const KNOWN_VOICE_IDS = new Set(TTS_VOICES.map(v => v.id));

// 收费/免费作品列：首次请求自动补列（幂等；正式迁移见 schema/migrate_monetization.sql）
let monetizationEnsured = false;
async function ensureMonetizationColumns(env) {
    if (monetizationEnsured) return;
    await env.DB.prepare("ALTER TABLE characters ADD COLUMN pricing TEXT DEFAULT 'free'").run().catch(() => {});
    await env.DB.prepare("ALTER TABLE characters ADD COLUMN price INTEGER DEFAULT 0").run().catch(() => {});
    await env.DB.prepare("ALTER TABLE worlds ADD COLUMN pricing TEXT DEFAULT 'free'").run().catch(() => {});
    await env.DB.prepare("ALTER TABLE worlds ADD COLUMN price INTEGER DEFAULT 0").run().catch(() => {});
    monetizationEnsured = true;
}

// Companion Engine 列/表：首次请求自动补（幂等；正式迁移见 schema/migrate_companion.sql）
let companionEnsured = false;
async function ensureCompanionColumns(env) {
    if (companionEnsured) return;
    await env.DB.prepare("ALTER TABLE characters ADD COLUMN companion_state TEXT NOT NULL DEFAULT '{}'").run().catch(() => {});
    await env.DB.prepare("ALTER TABLE characters ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''").run().catch(() => {});
    await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS companion_inbox (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            character_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            read_at TEXT
        )`
    ).run().catch(() => {});
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_companion_inbox_user ON companion_inbox(user_id, read_at)").run().catch(() => {});
    companionEnsured = true;
}

// voice id → 性别（用于“角色性别明确时，声音严格对应性别”）
const VOICE_GENDER = Object.fromEntries(TTS_VOICES.map(v => [v.id, v.gender]));

/** 声音是否匹配角色性别：空声音或性别未定（neutral/''）视为匹配 */
function voiceMatchesGender(characterGender, voiceId) {
    if (!voiceId) return true;
    if (!characterGender || characterGender === "neutral") return true;
    return VOICE_GENDER[voiceId] === characterGender;
}

/** 消息内容转纯文本（聊天内容可能是 {text, images} JSON 格式） */
function messageToPlainText(content) {
    if (!content) return "";
    if (typeof content === "string" && content.charAt(0) === "{") {
        try {
            const p = JSON.parse(content);
            if (p && typeof p === "object" && typeof p.text === "string") {
                const imgCount = Array.isArray(p.images) ? p.images.length : 0;
                return imgCount > 0 ? p.text + `（用户发送了 ${imgCount} 个附件）` : p.text;
            }
        } catch { /* 非 JSON 结构，按纯文本处理 */ }
    }
    return String(content);
}

export async function handleMvpRoutes(
    request,
    env,
    pathname,
    method,
    helpers
) {
    const { json, getAuthenticatedUser, serveHtml } = helpers;

    // 收费/免费作品列自动补列（首次请求）
    await ensureMonetizationColumns(env).catch(() => {});
    // Companion Engine 列/表自动补（首次请求）
    await ensureCompanionColumns(env).catch(() => {});

    /* ----- HTML routes ----- */

    if (pathname === "/create" || pathname === "/create.html") {
        return serveHtml("create.html");
    }

    if (pathname === "/create/character" || pathname === "/create/character/") {
        return serveHtml("create-character.html");
    }

    if (pathname === "/hub" || pathname === "/hub.html") {
        return serveHtml("hub.html");
    }

    if (pathname.startsWith("/buddy/") && pathname.length > 7) {
        return serveHtml("buddy.html");
    }

    if (pathname.startsWith("/s/") && pathname.length > 3) {
        return serveHtml("share.html");
    }

    /* ----- Portrait placeholder ----- */

    const portraitMatch = pathname.match(
        /^\/api\/characters\/(char_[a-z0-9]+)\/portrait$/
    );

    if (portraitMatch && method === "GET") {
        const character = await getCharacterById(env, portraitMatch[1]);

        if (!character) {
            return json({ success: false, error: "角色不存在。" }, 404);
        }

        return new Response(buildPortraitSvg(character), {
            headers: {
                "Content-Type": "image/svg+xml; charset=UTF-8",
                "Cache-Control": "public, max-age=3600"
            }
        });
    }

    /* ----- CREATE ----- */

    if (pathname === "/api/create" && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);

            if (!user) {
                return json({
                    success: false,
                    error: "请先登录后再创造数字生命。",
                    login_url: "/yonder.html?next=/create.html"
                }, 401);
            }

            const body = await request.json();
            const idea = String(body.idea || "").trim();
            const style = String(body.style || "realistic");
            const params = body.params || {};

            if (idea.length < 4 && Object.values(params).every(v => !v)) {
                return json({
                    success: false,
                    error: "请至少输入描述或选择参数。"
                }, 400);
            }

            if (idea.length > 2000) {
                return json({
                    success: false,
                    error: "脑洞描述过长。"
                }, 400);
            }

            const characterId = "char_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const shareId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);

            const generated = await generateCharacterFromIdea(idea || buildIdeaFromParams(params), env);

            const draftCharacter = {
                id: characterId,
                ...generated
            };

            const imageResult = await generateCharacterImage(
                draftCharacter,
                env,
                style,
                params
            );

            // 保存性别与初始语音（声音可选，按性别筛选）
            const gender = params.gender === "female" || params.gender === "male" ? params.gender : "";
            const voice = typeof params.voice === "string" && KNOWN_VOICE_IDS.has(params.voice) && voiceMatchesGender(gender, params.voice) ? params.voice : "";
            const chatConfigJson = JSON.stringify({
                temperature: 0.9,
                max_tokens: 150,
                proactivity: "balanced",
                rate: 0,
                ...(voice ? { voice } : {})
            });

            await env.DB.prepare(
                `INSERT INTO characters (
                    id, owner_id, name, appearance, personality, background,
                    speech_style, world_name, world_description, story_hook,
                    source_idea, image_url, share_id, gender, chat_config, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            ).bind(
                characterId,
                user.id,
                generated.name,
                generated.appearance,
                generated.personality,
                generated.background,
                generated.speech_style,
                generated.world_name,
                generated.world_description,
                generated.story_hook,
                idea,
                imageResult.url,
                shareId,
                gender,
                chatConfigJson
            ).run();

            if (imageResult.url && imageResult.provider !== "mock") {
                await env.DB.prepare(
                    `INSERT INTO assets (id, owner_id, character_id, type, url, meta_json, created_at)
                     VALUES (?, ?, ?, 'image', ?, ?, CURRENT_TIMESTAMP)`
                ).bind(
                    "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
                    user.id,
                    characterId,
                    imageResult.url,
                    JSON.stringify(imageResult.asset_meta || {})
                ).run();
            }

            const character = await getCharacterById(env, characterId);

            return json({
                success: true,
                character: formatCharacter(character),
                share_url: `/s/${shareId}`,
                buddy_url: `/buddy/${characterId}`,
                ai_mode: env.AI ? "workers-ai" : "mock",
                image_mode: "pollinations"
            });

        } catch (error) {
            console.error("CREATE ERROR:", error);

            return json({
                success: false,
                error: isMissingTableError(error)
                    ? "数据库尚未初始化 MVP 表，请先执行 schema/mvp.sql。"
                    : "创造失败，请稍后再试。"
            }, 500);
        }
    }

    /* ----- REGEN IMAGE ----- */

    if (pathname === "/api/create/regen-image" && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const body = await request.json();
            const characterId = String(body.character_id || "");
            const style = String(body.style || "realistic");
            const params = body.params || {};

            const character = await getCharacterById(env, characterId);
            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            const imageResult = await regenerateCharacterImage(character, env, style, params);

            await env.DB.prepare(
                "UPDATE characters SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(imageResult.url, characterId).run();

            return json({
                success: true,
                image_url: imageResult.url,
                image_mode: "pollinations"
            });

        } catch (error) {
            console.error("REGEN IMAGE ERROR:", error);
            return json({ success: false, error: "生成失败，请稍后再试。" }, 500);
        }
    }

    /* ----- CHARACTER create-advanced (7-step flow) ----- */

    if (pathname === "/api/character/create-advanced" && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const s = await request.json();

            const styleMap = {
                realistic: "realistic photorealistic portrait, cinematic lighting, detailed skin, 8k",
                "3d": "3D rendered character, game model, octane render, unreal engine style",
                anime: "anime style illustration, 2D cel shading, key visual, detailed eyes",
                guofeng: "Chinese guofeng art style, ink wash influence, oriental aesthetic, xianxia fantasy",
            };

            const raceMap = {
                human: "human", elf: "elf, pointed ears, ethereal",
                yao: "yokai, fox spirit, supernatural being",
                xianshen: "immortal deity, divine being, celestial",
                mo: "demon, dark aura, infernal",
                cyber: "cyborg, mechanical body, cyberpunk",
            };

            const genderMap = { female: "female", male: "male", neutral: "androgynous" };
            const ageMap = { teen: "teenager", young: "young adult", mature: "mature adult", immortal: "ageless immortal" };
            const skinMap = { fair: "fair skin", natural: "natural skin tone", wheat: "wheat skin", dark: "dark skin", special: "unusual skin color" };
            const eyeMap = { black: "black eyes", amber: "amber eyes", blue: "blue eyes", green: "green eyes", purple: "purple eyes", red: "red eyes", gold: "golden eyes", heterochromia: "heterochromia eyes" };
            const hairColorMap = { black: "black hair", white: "white hair", blonde: "blonde hair", brown: "brown hair", red: "red hair", blue: "blue hair", purple: "purple hair", silver: "silver hair" };
            const hairStyleMap = { long: "long hair", short: "short hair", ponytail: "ponytail", twin: "twin tails", braid: "braided hair", bun: "hair bun", wave: "wavy hair", pixie: "pixie cut" };
            const bodyMap = { slim: "slim body", balanced: "balanced body", athletic: "athletic body", curvy: "curvy figure", petite: "petite", tall: "tall stature" };
            const heightMap = { petite: "short height", medium: "medium height", tall: "tall height" };
            const bustMap = { small: "small chest", medium: "medium chest", large: "large chest" };
            const hipMap = { slim: "slim hips", medium: "medium hips", full: "full hips" };
            const outfitMap = {
                xianxia: "xianxia immortal robes, flowing sleeves, hanfu inspired",
                wuxia: "wuxia martial arts clothing, practical robes",
                modern: "modern casual clothing",
                fantasy: "fantasy mage robes, ornate magical outfit",
                armor: "battle armor, plated protection",
                ethnic: "ethnic traditional clothing",
                casual: "casual relaxed clothing",
                sleepwear: "sleepwear, loungewear",
            };
            const outfitColorMap = { dark: "dark colored", white: "white", red: "red", gold: "golden", blue: "blue", green: "green", purple: "purple", black: "black" };
            const accessoryMap = { none: "", hairpin: "hairpin", earrings: "earrings", necklace: "necklace", mask: "mask", veil: "veil", ribbon: "ribbon", hat: "hat" };

            const parts = [];
            if (s.style === "custom" && s.styleCustom) parts.push(s.styleCustom);
            else if (styleMap[s.style]) parts.push(styleMap[s.style]);

            parts.push("upper body portrait of a");
            if (raceMap[s.race]) parts.push(raceMap[s.race]);
            else if (s.race === "custom" && s.raceCustom) parts.push(s.raceCustom);
            else parts.push("character");

            if (genderMap[s.gender]) parts.push(genderMap[s.gender]);
            if (ageMap[s.age]) parts.push(ageMap[s.age]);
            if (skinMap[s.skin]) parts.push(skinMap[s.skin]);
            if (eyeMap[s.eyeColor]) parts.push(eyeMap[s.eyeColor]);
            if (hairColorMap[s.hairColor]) parts.push(hairColorMap[s.hairColor]);
            if (hairStyleMap[s.hairstyle]) parts.push(hairStyleMap[s.hairstyle]);
            if (bodyMap[s.bodyType]) parts.push(bodyMap[s.bodyType]);
            if (heightMap[s.height]) parts.push(heightMap[s.height]);
            if (bustMap[s.bust]) parts.push(bustMap[s.bust]);
            if (hipMap[s.hip]) parts.push(hipMap[s.hip]);
            if (outfitMap[s.outfit]) parts.push("wearing " + outfitMap[s.outfit]);
            if (outfitColorMap[s.outfitColor]) parts.push(outfitColorMap[s.outfitColor] + " colored");
            if (accessoryMap[s.accessory] && s.accessory !== "none") parts.push("with " + accessoryMap[s.accessory]);
            if (s.background) parts.push(s.background.slice(0, 150));
            if (s.personality && s.personality.length) parts.push(s.personality.join(", ") + " expression");

            parts.push("face clearly visible, looking at viewer, vertical portrait, centered composition, clean background, high quality, detailed");

            const imagePrompt = parts.join(", ");

            const ideaForAI = [
                s.style === "custom" && s.styleCustom ? s.styleCustom : s.style,
                s.race === "custom" && s.raceCustom ? s.raceCustom : s.race,
                s.gender, s.age, s.skin, s.eyeColor, s.hairColor, s.hairstyle,
                s.bodyType, s.height, s.bust, s.hip,
                s.outfit, s.outfitColor, s.accessory,
                s.personality ? s.personality.join("、") : "",
                s.background,
                s.name ? "名字：" + s.name : "",
            ].filter(Boolean).join("，");

            const generated = await generateCharacterFromIdea(ideaForAI || "一个神秘角色", env);

            if (s.name) generated.name = s.name;

            const characterId = "char_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const shareId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);

            let imageUrl = null;

            const aiModels = [
                { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", params: {
                    prompt: imagePrompt,
                    negative_prompt: "blurry, low quality, distorted, deformed, ugly, bad anatomy, extra fingers, watermark, text",
                    width: 1024,
                    height: 1024,
                    num_steps: 20,
                    guidance: 7.5,
                }},
            ];

            for (const model of aiModels) {
                if (!env.AI) break;
                try {
                    const aiResult = await Promise.race([
                        env.AI.run(model.id, model.params),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("图片生成超时。")), 25000))
                    ]);

                    if (aiResult && aiResult.image) {
                        imageUrl = "data:image/png;base64," + aiResult.image;
                        break;
                    }

                    let binaryData = null;
                    if (aiResult instanceof Response) {
                        const buffer = await aiResult.arrayBuffer();
                        binaryData = new Uint8Array(buffer);
                    } else if (aiResult instanceof ReadableStream) {
                        const buffer = await new Response(aiResult).arrayBuffer();
                        binaryData = new Uint8Array(buffer);
                    }

                    if (binaryData) {
                        // 分块转换，避免 String.fromCharCode.apply 对较大图片栈溢出
                        let binary = "";
                        for (let i = 0; i < binaryData.length; i += 32768) {
                            binary += String.fromCharCode.apply(null, binaryData.subarray(i, i + 32768));
                        }
                        imageUrl = "data:image/png;base64," + btoa(binary);
                        break;
                    }
                } catch (aiErr) {
                    console.error("Workers AI (" + model.id + ") failed:", aiErr.message || aiErr);
                }
            }

            if (!imageUrl) {
                const seed = Math.floor(Math.random() * 1000000);
                imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=768&height=1024&nologo=true&model=flux&seed=${seed}`;
            }

            const gender = ["female", "male", "neutral"].includes(s.gender) ? s.gender : "";
            const voice = typeof s.voice === "string" && KNOWN_VOICE_IDS.has(s.voice) ? s.voice : "";
            const chatConfigJson = JSON.stringify({
                temperature: 0.9,
                max_tokens: 150,
                proactivity: "balanced",
                rate: 0,
                ...(voice ? { voice } : {})
            });

            await env.DB.prepare(
                `INSERT INTO characters (
                    id, owner_id, name, appearance, personality, background,
                    speech_style, world_name, world_description, story_hook,
                    source_idea, image_url, share_id, gender, chat_config, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            ).bind(
                characterId,
                user.id,
                generated.name,
                generated.appearance,
                generated.personality,
                generated.background,
                generated.speech_style,
                generated.world_name,
                generated.world_description,
                generated.story_hook,
                ideaForAI.slice(0, 500),
                imageUrl,
                shareId,
                gender,
                chatConfigJson
            ).run();

            return json({
                success: true,
                character: {
                    id: characterId,
                    name: generated.name,
                    appearance: generated.appearance,
                    personality: generated.personality,
                    background: generated.background,
                    image_url: imageUrl,
                    share_id: shareId
                }
            });

        } catch (error) {
            console.error("ADVANCED CREATE ERROR:", error);
            return json({ success: false, error: "创建失败，请稍后再试。" }, 500);
        }
    }

    /* ----- CHARACTER save ----- */

    const saveMatch = pathname.match(
        /^\/api\/character\/(char_[a-z0-9]+)\/save$/
    );

    if (saveMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const characterId = saveMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            if (character.owner_id !== user.id) {
                return json({ success: false, error: "无权操作。" }, 403);
            }

            return json({ success: true });
        } catch (error) {
            console.error("CHARACTER SAVE ERROR:", error);
            return json({ success: false, error: "保存失败，请稍后再试。" }, 500);
        }
    }

    /* ----- HUB ----- */

    if (pathname === "/api/hub" && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);

            // 全站公开角色池（前 60）仅管理账户（333123）可见：游客 / 普通用户均不可见
            const isAdmin = !!(user && user.username === "333123");

            if (!user) {
                return json({
                    success: true,
                    guest: true,
                    characters: []
                });
            }

            if (isAdmin) {
                const result = await env.DB.prepare(
                    `SELECT id, name, appearance, personality, story_hook, image_url, share_id, world_name, pricing, price, created_at, updated_at
                     FROM characters
                     WHERE share_id IS NOT NULL AND share_id != ''
                     ORDER BY created_at DESC
                     LIMIT 60`
                ).all();

                return json({
                    success: true,
                    isAdminView: true,
                    characters: (result.results || []).map(formatCharacter)
                });
            }

            const result = await env.DB.prepare(
                `SELECT id, name, appearance, personality, story_hook, image_url, share_id, world_name, pricing, price, created_at, updated_at
                 FROM characters
                 WHERE owner_id = ?
                 ORDER BY created_at DESC`
            ).bind(user.id).all();

            return json({
                success: true,
                characters: (result.results || []).map(formatCharacter)
            });

        } catch (error) {
            console.error("HUB ERROR:", error);

            return json({
                success: false,
                error: isMissingTableError(error)
                    ? "数据库尚未初始化 MVP 表，请先执行 schema/mvp.sql。"
                    : "加载失败。"
            }, 500);
        }
    }

    /* ----- WORLDS (自定义世界) ----- */

    if (pathname === "/api/models" && method === "GET") {
        return json({ success: true, models: listModelInfos() });
    }

    if (pathname === "/api/worlds" && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const result = await env.DB.prepare(
                `SELECT id, name, description, type, cover_image, script_json, cast_ids, settings,
                        source_conversation, status, share_id, pricing, price, created_at, updated_at
                 FROM worlds
                 WHERE owner_id = ?
                 ORDER BY updated_at DESC`
            ).bind(user.id).all();

            const worlds = [];
            for (const row of (result.results || [])) {
                worlds.push(await formatWorld(env, row));
            }

            return json({ success: true, worlds });
        } catch (error) {
            console.error("WORLDS LIST ERROR:", error);
            return json({
                success: false,
                error: isMissingTableError(error)
                    ? "数据库尚未初始化 worlds 表，请先执行 schema/migrate_worlds.sql。"
                    : "加载失败。"
            }, 500);
        }
    }

    if (pathname === "/api/worlds" && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const body = await request.json();
            const name = String(body.name || "").trim().slice(0, 80);
            if (!name) {
                return json({ success: false, error: "请给世界一个名字。" }, 400);
            }

            const description = String(body.description || "").trim().slice(0, 1200);
            const type = ["story", "vn", "game", "mixed", "life"].includes(body.type) ? body.type : "story";
            const castRaw = Array.isArray(body.cast_ids) ? body.cast_ids.map(String) : [];
            const castIds = [...new Set(castRaw)].slice(0, 12);
            const coverImage = String(body.cover_image || "").trim().slice(0, 2000);
            const settings = (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings))
                ? {
                    genre: String(body.settings.genre || "").trim().slice(0, 40),
                    genreLabel: String(body.settings.genreLabel || "").trim().slice(0, 40)
                }
                : {};

            // 校验 cast 均属于当前用户（防注入他人角色 id）
            if (castIds.length) {
                const placeholders = castIds.map(() => "?").join(",");
                const rows = await env.DB.prepare(
                    `SELECT id FROM characters WHERE owner_id = ? AND id IN (${placeholders})`
                ).bind(user.id, ...castIds).all();
                const valid = new Set((rows.results || []).map(r => r.id));
                castIds.length = 0;
                castIds.push(...castRaw.filter(id => valid.has(id)));
            }

            const worldId = "world_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const shareId = "w" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

            // 收费 / 免费作品（暂未开通支付，仅记录与展示）
            const pricing = ["free", "paid"].includes(body.pricing) ? body.pricing : "free";
            const price = Math.max(0, Math.min(100000, Math.floor(Number(body.price) || 0)));

            // 生命世界：初始化 world_json（背景 / 原住民 / 关系 / 场景 / 运转配置）
            let worldJson = null;
            if (type === "life") {
                const rawWj = (body.world_json && typeof body.world_json === "object" && !Array.isArray(body.world_json))
                    ? body.world_json
                    : {};
                worldJson = {
                    background: sanitizeBackground(rawWj.background),
                    natives: [],
                    relations: [],
                    scenes: [],
                    life: { ...LIFE_DEFAULTS, ...sanitizeLifeSettings(rawWj.life) }
                };
                if (!worldJson.background.note && description) {
                    worldJson.background.note = description;
                }
                if (rawWj.background && typeof rawWj.background === "object") {
                    // 允许向导把简单描述映射进 note
                    if (!worldJson.background.note && String(rawWj.background.note || "").trim()) {
                        worldJson.background.note = String(rawWj.background.note).trim().slice(0, 800);
                    }
                }
            }

            await env.DB.prepare(
                `INSERT INTO worlds
                 (id, owner_id, name, description, type, cover_image, script_json, cast_ids, settings, source_conversation, status, share_id, world_json, pricing, price, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            ).bind(
                worldId, user.id, name, description, type, coverImage,
                JSON.stringify([]), JSON.stringify(castIds), JSON.stringify(settings),
                String(body.source_conversation || "").trim().slice(0, 60),
                "draft", shareId,
                JSON.stringify(worldJson || {}),
                pricing, price
            ).run();

            // 生命世界：创建初始「主线」线程并指向它（kind='main'，不可手动删除，删除整个世界除外）
            if (type === "life" && worldJson) {
                const threadId = "wt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
                await env.DB.prepare(
                    `INSERT INTO world_threads (id, world_id, kind, scene_id, title, status, turn, created_at, updated_at)
                     VALUES (?, ?, 'main', '', '主线', 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
                ).bind(threadId, worldId).run();
                worldJson.life.currentThreadId = threadId;
                await env.DB.prepare(
                    "UPDATE worlds SET world_json = ? WHERE id = ?"
                ).bind(JSON.stringify(worldJson), worldId).run();
            }

            const created = await getWorldById(env, worldId);
            return json({ success: true, world: await formatWorld(env, created) });
        } catch (error) {
            console.error("WORLD CREATE ERROR:", error);
            return json({
                success: false,
                error: isMissingTableError(error)
                    ? "数据库尚未初始化 worlds 表，请先执行 schema/migrate_worlds.sql。"
                    : "创建失败，请稍后再试。"
            }, 500);
        }
    }

    const worldDetailMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)$/);
    const worldDeleteMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/delete$/);

    /* =====================================================
       主站生命世界广场
       GET /api/plaza → 所有已发布（status='published'）的 life 世界
    ===================================================== */
    if (pathname === "/api/plaza" && method === "GET") {
        try {
            const result = await env.DB.prepare(
                `SELECT w.*, p.username, p.display_name, p.avatar_url
                 FROM worlds w
                 LEFT JOIN profiles p ON w.owner_id = p.id
                 WHERE w.status = 'published' AND w.type = 'life'
                 ORDER BY w.updated_at DESC LIMIT 100`
            ).all();
            const worlds = [];
            for (const row of (result.results || [])) {
                const w = await formatWorld(env, row);
                if (!w) continue;
                worlds.push({
                    ...w,
                    owner_username: row.username || "",
                    owner_display_name: row.display_name || row.username || "TA",
                    owner_avatar_url: row.avatar_url || ""
                });
            }

            // 幻灵世界广场同时收录已发布的故事作品（status='published' 且主页可见 share_id 非空）
            const sRes = await env.DB.prepare(
                `SELECT s.id, s.title, s.cover_image, s.status, s.data, s.updated_at,
                        p.username, p.display_name, p.avatar_url
                 FROM stories s
                 LEFT JOIN profiles p ON s.owner_id = p.id
                 WHERE s.status = 'published' AND s.share_id IS NOT NULL AND s.share_id != ''
                 ORDER BY s.updated_at DESC LIMIT 100`
            ).all();
            const stories = [];
            for (const row of (sRes.results || [])) {
                const data = parseStoryData(row.data);
                let chapters = 0;
                let blocks = 0;
                for (const c of (data.chapters || [])) {
                    chapters++;
                    blocks += Array.isArray(c.blocks) ? c.blocks.length : 0;
                }
                stories.push({
                    id: row.id,
                    title: row.title || "未名作品",
                    cover_image: row.cover_image || "",
                    orientation: data.orientation === "portrait" ? "portrait" : "landscape",
                    chapters_count: chapters,
                    blocks_count: blocks,
                    updated_at: row.updated_at,
                    owner_username: row.username || "",
                    owner_display_name: row.display_name || row.username || "TA",
                    owner_avatar_url: row.avatar_url || ""
                });
            }
            return json({ success: true, worlds, stories });
        } catch (error) {
            console.error("PLAZA ERROR:", error);
            return json({ success: false, error: "加载失败。" }, 500);
        }
    }

    /* =====================================================
       云端故事作品（作品编辑器）
       GET  /api/stories           → 我的作品列表（登录，含完整 data）
       POST /api/stories           → 创建作品 {title, orientation, imgQuality}
       GET  /api/stories/:id       → 单部作品（本人 或 已发布公开播放）
       PUT  /api/stories/:id       → 保存完整作品 {data}（本人）
       POST /api/stories/:id/publish → 发布/下架 {published}（本人）
       POST /api/stories/:id/delete  → 删除（本人）
    ===================================================== */

    const storyDetailMatch = pathname.match(/^\/api\/stories\/(st_[a-z0-9]+)$/);
    const storyPublishMatch = pathname.match(/^\/api\/stories\/(st_[a-z0-9]+)\/publish$/);
    const storyDeleteMatch = pathname.match(/^\/api\/stories\/(st_[a-z0-9]+)\/delete$/);

    if (pathname === "/api/stories" && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const result = await env.DB.prepare(
                `SELECT id, title, data, cover_image, status, share_id, created_at, updated_at
                 FROM stories
                 WHERE owner_id = ?
                 ORDER BY updated_at DESC`
            ).bind(user.id).all();

            const stories = [];
            for (const row of (result.results || [])) {
                const data = parseStoryData(row.data);
                stories.push({
                    id: row.id,
                    title: row.title,
                    cover_image: row.cover_image,
                    status: row.status,
                    share_id: row.share_id,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    // 直接展开 data（orientation/imgQuality/cast/chapters），前端结构不变
                    ...data
                });
            }

            return json({ success: true, stories });
        } catch (error) {
            console.error("STORIES LIST ERROR:", error);
            return json({
                success: false,
                error: isMissingTableError(error)
                    ? "数据库尚未初始化 stories 表，请先执行 schema/migrate_stories.sql。"
                    : "加载失败。"
            }, 500);
        }
    }

    if (pathname === "/api/stories" && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const body = await request.json();
            const title = String(body.title || "").trim().slice(0, 40);
            if (!title) {
                return json({ success: false, error: "请给作品一个名字。" }, 400);
            }

            const storyId = "st_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            // 创建即主页可见（share_id 恒非空），发布/下架仅切 status
            const shareId = "s" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
            const orientation = body.orientation === "portrait" ? "portrait" : "landscape";
            const imgQuality = body.imgQuality === "hd" ? "hd" : "standard";
            const data = {
                orientation,
                imgQuality,
                cast: {},
                chapters: [{
                    id: "ch_" + crypto.randomUUID().replace(/-/g, "").slice(0, 10),
                    title: "第一章",
                    blocks: []
                }]
            };

            await env.DB.prepare(
                `INSERT INTO stories (id, owner_id, title, data, cover_image, status, share_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, '', 'draft', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            ).bind(storyId, user.id, title, JSON.stringify(data), shareId).run();

            return json({
                success: true,
                story: { id: storyId, title, cover_image: "", status: "draft", share_id: shareId, ...data }
            });
        } catch (error) {
            console.error("STORY CREATE ERROR:", error);
            return json({
                success: false,
                error: isMissingTableError(error)
                    ? "数据库尚未初始化 stories 表，请先执行 schema/migrate_stories.sql。"
                    : "创建失败，请稍后再试。"
            }, 500);
        }
    }

    if (storyDetailMatch && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);
            const row = await env.DB.prepare(
                `SELECT * FROM stories WHERE id = ? LIMIT 1`
            ).bind(storyDetailMatch[1]).first();
            if (!row) {
                return json({ success: false, error: "作品不存在。" }, 404);
            }
            const isOwner = user && row.owner_id === user.id;
            if (!isOwner && row.status !== "published") {
                return json({ success: false, error: "无权查看这部作品。" }, 403);
            }
            const data = parseStoryData(row.data);
            return json({
                success: true,
                story: {
                    id: row.id,
                    title: row.title,
                    cover_image: row.cover_image,
                    status: row.status,
                    share_id: row.share_id,
                    owner_id: row.owner_id,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                    ...data
                }
            });
        } catch (error) {
            console.error("STORY GET ERROR:", error);
            return json({ success: false, error: "加载失败。" }, 500);
        }
    }

    if (storyDetailMatch && method === "PUT") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }
            const row = await env.DB.prepare(
                `SELECT * FROM stories WHERE id = ? LIMIT 1`
            ).bind(storyDetailMatch[1]).first();
            if (!row) {
                return json({ success: false, error: "作品不存在。" }, 404);
            }
            if (row.owner_id !== user.id) {
                return json({ success: false, error: "无权修改这部作品。" }, 403);
            }

            const body = await request.json();
            const data = parseStoryData(body.data);
            const title = String((data.title || row.title) || "").trim().slice(0, 40) || "未名作品";
            // 封面：优先显式传入，否则从 data 首张 scene 图提取
            const coverImage = (String(body.cover_image || "").trim().slice(0, 2000)) || extractStoryCover(data);

            await env.DB.prepare(
                `UPDATE stories SET title = ?, data = ?, cover_image = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`
            ).bind(title, JSON.stringify(data), coverImage, row.id).run();

            return json({
                success: true,
                story: {
                    id: row.id, title, cover_image: coverImage,
                    status: row.status, share_id: row.share_id, ...data
                }
            });
        } catch (error) {
            console.error("STORY SAVE ERROR:", error);
            return json({ success: false, error: "保存失败，请稍后再试。" }, 500);
        }
    }

    if (storyPublishMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }
            const row = await env.DB.prepare(
                `SELECT * FROM stories WHERE id = ? LIMIT 1`
            ).bind(storyPublishMatch[1]).first();
            if (!row) {
                return json({ success: false, error: "作品不存在。" }, 404);
            }
            if (row.owner_id !== user.id) {
                return json({ success: false, error: "无权操作这部作品。" }, 403);
            }

            const body = await request.json();
            const published = !!body.published;
            // 作品创建即主页可见（share_id 恒非空）；发布/下架只切换 status（广场可见性）
            const shareId = (row.share_id || "").trim() || ("s" + crypto.randomUUID().replace(/-/g, "").slice(0, 8));

            await env.DB.prepare(
                `UPDATE stories SET status = ?, share_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
            ).bind(published ? "published" : "draft", shareId, row.id).run();

            return json({
                success: true,
                story: {
                    id: row.id, title: row.title, status: published ? "published" : "draft", share_id: shareId
                }
            });
        } catch (error) {
            console.error("STORY PUBLISH ERROR:", error);
            return json({ success: false, error: "操作失败。" }, 500);
        }
    }

    if (storyDeleteMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }
            const row = await env.DB.prepare(
                `SELECT * FROM stories WHERE id = ? LIMIT 1`
            ).bind(storyDeleteMatch[1]).first();
            if (!row) {
                return json({ success: false, error: "作品不存在。" }, 404);
            }
            if (row.owner_id !== user.id) {
                return json({ success: false, error: "无权删除这部作品。" }, 403);
            }
            await env.DB.prepare(`DELETE FROM stories WHERE id = ?`).bind(row.id).run();
            return json({ success: true });
        } catch (error) {
            console.error("STORY DELETE ERROR:", error);
            return json({ success: false, error: "删除失败。" }, 500);
        }
    }

    if (worldDetailMatch && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);
            const world = await getWorldById(env, worldDetailMatch[1]);
            if (!world) {
                return json({ success: false, error: "世界不存在。" }, 404);
            }
            // 已发布的作品对游客公开可读（配合个人主页公开作品）
            const isOwner = user && world.owner_id === user.id;
            if (!isOwner && world.status !== "published") {
                return json({ success: false, error: "无权查看这个世界。" }, 403);
            }
            return json({ success: true, world: await formatWorld(env, world) });
        } catch (error) {
            console.error("WORLD GET ERROR:", error);
            return json({ success: false, error: "加载失败。" }, 500);
        }
    }

    if (worldDetailMatch && method === "PATCH") {
        try {
            const user = await getAuthenticatedUser(request);
            const world = await getWorldById(env, worldDetailMatch[1]);
            if (!world) {
                return json({ success: false, error: "世界不存在。" }, 404);
            }
            if (!user || world.owner_id !== user.id) {
                return json({ success: false, error: "无权修改这个世界。" }, 403);
            }

            const body = await request.json();
            const sets = [];
            const vals = [];
            if (typeof body.name === "string") {
                const name = body.name.trim().slice(0, 80);
                if (name) { sets.push("name = ?"); vals.push(name); }
            }
            if (typeof body.description === "string") {
                sets.push("description = ?");
                vals.push(body.description.trim().slice(0, 1200));
            }
            if (typeof body.cover_image === "string") {
                sets.push("cover_image = ?");
                vals.push(body.cover_image.trim().slice(0, 2000));
            }
            if (Array.isArray(body.cast_ids)) {
                const castIds = [...new Set(body.cast_ids.map(String))].slice(0, 12);
                sets.push("cast_ids = ?");
                vals.push(JSON.stringify(castIds));
            }
            if (body.script_json !== undefined) {
                if (!Array.isArray(body.script_json) && typeof body.script_json !== "object") {
                    return json({ success: false, error: "剧本格式错误。" }, 400);
                }
                sets.push("script_json = ?");
                vals.push(JSON.stringify(body.script_json));
            }
            if (body.settings !== undefined && body.settings && typeof body.settings === "object") {
                sets.push("settings = ?");
                vals.push(JSON.stringify(body.settings));
            }
            if (body.world_json !== undefined && body.world_json && typeof body.world_json === "object" && !Array.isArray(body.world_json)) {
                sets.push("world_json = ?");
                vals.push(JSON.stringify(body.world_json));
            }
            if (typeof body.status === "string" && ["draft", "published"].includes(body.status)) {
                sets.push("status = ?");
                vals.push(body.status);
            }
            if (typeof body.visible === "boolean") {
                // visible = 主页「显示/隐藏」（仅影响个人主页卡片，不影响主站发布）
                if (body.visible) {
                    const cur = (world.share_id || "").trim();
                    const shareId = cur || ("w" + crypto.randomUUID().replace(/-/g, "").slice(0, 8));
                    sets.push("share_id = ?");
                    vals.push(shareId);
                } else {
                    // 隐藏 = share_id 置 NULL（share_id 列有 UNIQUE 约束，空串 '' 全表只能有一行，
                    // 用 NULL 才能支持任意多个隐藏世界；公开判定统一按「非空」过滤，语义不变）
                    sets.push("share_id = ?");
                    vals.push(null);
                }
            }
            if (["free", "paid"].includes(body.pricing)) {
                sets.push("pricing = ?");
                vals.push(body.pricing);
            }
            if (body.price !== undefined) {
                sets.push("price = ?");
                vals.push(Math.max(0, Math.min(100000, Math.floor(Number(body.price) || 0))));
            }

            if (sets.length) {
                sets.push("updated_at = CURRENT_TIMESTAMP");
                await env.DB.prepare(
                    `UPDATE worlds SET ${sets.join(", ")} WHERE id = ?`
                ).bind(...vals, world.id).run();
            }

            const updated = await getWorldById(env, world.id);
            return json({ success: true, world: await formatWorld(env, updated) });
        } catch (error) {
            console.error("WORLD PATCH ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    if (worldDeleteMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            const world = await getWorldById(env, worldDeleteMatch[1]);
            if (!world) {
                return json({ success: false, error: "世界不存在。" }, 404);
            }
            if (!user || world.owner_id !== user.id) {
                return json({ success: false, error: "无权删除这个世界。" }, 403);
            }

            // 世界内资源一并删除：线程、消息、world_json（原住民/关系/场景/区域/背景随世界行删除）；
            // 公共角色（cast_ids）保留在角色库，不删除 characters 行
            const threads = await env.DB.prepare(
                "SELECT id FROM world_threads WHERE world_id = ?"
            ).bind(world.id).all();
            const threadIds = (threads.results || []).map((t) => t.id);
            if (threadIds.length) {
                const placeholders = threadIds.map(() => "?").join(",");
                await env.DB.prepare(
                    `DELETE FROM world_messages WHERE thread_id IN (${placeholders})`
                ).bind(...threadIds).run();
            }
            await env.DB.prepare("DELETE FROM world_threads WHERE world_id = ?").bind(world.id).run();
            await env.DB.prepare(
                "DELETE FROM worlds WHERE id = ?"
            ).bind(world.id).run();

            return json({ success: true, cast_preserved: true });
        } catch (error) {
            console.error("WORLD DELETE ERROR:", error);
            return json({ success: false, error: "删除失败。" }, 500);
        }
    }

    /* ----- LIFE WORLD (生命世界) ----- */

    const lifeMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life$/);
    const lifeNativesMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/natives$/);
    const lifeNativeMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/natives\/(wc_[a-z0-9]+)\/(update|delete)$/);
    const lifeNativePromoteMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/natives\/(wc_[a-z0-9]+)\/promote$/);
    const lifeBackgroundMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/background$/);
    const lifeRelationsMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/relations$/);
    const lifeScenesMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/scenes$/);
    const lifeThreadsMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/threads$/);
    const lifeChatMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/chat$/);
    const lifeTickMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/tick$/);
    const lifeMessagesMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/messages$/);
    const lifeSettingsMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/settings$/);
    const lifeSummaryMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/summary$/);
    const lifeCastMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/cast$/);
    const lifeCastMemberMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/cast\/(char_[a-z0-9]+)$/);
    const lifeAreasMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/areas$/);
    const lifeNpcBatchMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/npc-batch$/);
    const lifeThreadMetaMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/threads\/meta$/);
    const lifeNameMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/name$/);
    const lifeStoryMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/story$/);

    // 校验生命世界归属；返回 { user, world } 或直接返回错误 Response
    // opts.public=true 时，已发布（status='published'）的世界对游客放行，
    // user 兜底为 { username:'游客' }（聊天/发言等仅需要展示名的场合可用）
    async function requireOwnedLifeWorld(id, opts = {}) {
        const allowPublic = opts.public === true;
        const user = await getAuthenticatedUser(request);
        const world = await getWorldById(env, id);
        if (!world) {
            return json({ success: false, error: "世界不存在。" }, 404);
        }
        if (world.type !== "life") {
            return json({ success: false, error: "这个世界不是生命世界。" }, 400);
        }
        if (user && world.owner_id === user.id) {
            return { user, world };
        }
        if (allowPublic && world.status === "published") {
            return { user, world, isGuest: true };
        }
        if (!user) {
            return json({ success: false, error: "请先登录。" }, 401);
        }
        return json({ success: false, error: "无权操作这个世界。" }, 403);
    }

    /** 游客兜底身份（公开世界内展示用） */
    function guestIdentity(world, isGuest) {
        if (!isGuest) return null;
        return { id: "", username: "游客", display_name: "游客" };
    }

    if (lifeMatch && method === "GET") {
        try {
            const auth = await requireOwnedLifeWorld(lifeMatch[1], { public: true });
            if (!auth.world) return auth;
            return json(await formatLifeWorld(env, auth.world));
        } catch (error) {
            console.error("LIFE GET ERROR:", error);
            return json({ success: false, error: "世界加载失败。" }, 500);
        }
    }

    if (lifeNativesMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeNativesMatch[1]);
            if (!auth.world) return auth;
            const { world } = auth;
            const body = await request.json();
            const idea = String(body.idea || "").trim().slice(0, 2000);
            const mock = body.mock === true;
            let native = null;

            if (idea) {
                native = await generateNativeCharacter({ idea, world, env, mock });
            } else if (body.native && typeof body.native === "object") {
                const n = body.native;
                native = {
                    name: String(n.name || "").trim().slice(0, 40),
                    appearance: String(n.appearance || "").trim().slice(0, 800),
                    personality: String(n.personality || "").trim().slice(0, 800),
                    background: String(n.background || "").trim().slice(0, 2000),
                    speech_style: String(n.speech_style || "").trim().slice(0, 400),
                    gender: ["female", "male", "neutral"].includes(n.gender) ? n.gender : "",
                    age: sanitizeNativeAge(n.age),
                    tags: sanitizeNativeTags(n.tags),
                    chat_config: sanitizeNativeConfig(n.chat_config || {})
                };
            }

            if (!native || !native.name) {
                return json({ success: false, error: "请输入描述，或填写名字与人设。" }, 400);
            }

            const wj = await loadWorldJson(env, world.id);
            const full = {
                id: "wc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
                ...native,
                avatar: String(body.avatar || "").slice(0, 2000)
            };
            wj.natives.push(full);
            await saveWorldJson(env, world.id, wj);
            return json({ success: true, native: full, world_json: wj });
        } catch (error) {
            console.error("LIFE NATIVE CREATE ERROR:", error);
            return json({ success: false, error: "原住民生成失败，请稍后再试。" }, 500);
        }
    }

    /* __LIFE_P2__ */

    if (lifeNativeMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeNativeMatch[1]);
            if (!auth.world) return auth;
            const nativeId = lifeNativeMatch[2];
            const action = lifeNativeMatch[3];
            const wj = await loadWorldJson(env, auth.world.id);
            const idx = wj.natives.findIndex((n) => n.id === nativeId);
            if (idx < 0) {
                return json({ success: false, error: "原住民不存在。" }, 404);
            }

            if (action === "delete") {
                wj.natives.splice(idx, 1);
                wj.relations = (wj.relations || []).filter((r) => r.a !== nativeId && r.b !== nativeId);
                (wj.scenes || []).forEach((s) => {
                    if (Array.isArray(s.present)) s.present = s.present.filter((p) => p !== nativeId);
                });
            } else {
                const body = await request.json();
                const n = wj.natives[idx];
                if (typeof body.name === "string" && body.name.trim()) n.name = body.name.trim().slice(0, 40);
                if (typeof body.appearance === "string") n.appearance = body.appearance.slice(0, 800);
                if (typeof body.personality === "string") n.personality = body.personality.slice(0, 800);
                if (typeof body.background === "string") n.background = body.background.slice(0, 2000);
                if (typeof body.speech_style === "string") n.speech_style = body.speech_style.slice(0, 400);
                if (typeof body.avatar === "string") n.avatar = body.avatar.slice(0, 2000);
                if (["female", "male", "neutral"].includes(body.gender)) n.gender = body.gender;
                if (typeof body.age === "string") n.age = sanitizeNativeAge(body.age);
                if (Array.isArray(body.tags)) n.tags = sanitizeNativeTags(body.tags);
                if (body.chat_config && typeof body.chat_config === "object") {
                    n.chat_config = { ...(n.chat_config || {}), ...sanitizeNativeConfig(body.chat_config) };
                }
            }

            await saveWorldJson(env, auth.world.id, wj);
            return json({ success: true, natives: wj.natives });
        } catch (error) {
            console.error("LIFE NATIVE UPDATE ERROR:", error);
            return json({ success: false, error: "操作失败。" }, 500);
        }
    }

    /* 原住民转正：把世界里的角色复制进角色库（characters 行，companion_state 从零初始化）。
       原住民本身保留在世界里（复制而非移动）；转正后可在 buddy 一对一继续发展。
       方向与「角色库 → 世界（cast 邀请）」互补，构成世界 ↔ 角色库闭环。 */
    if (lifeNativePromoteMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeNativePromoteMatch[1]);
            if (!auth.world) return auth;
            const nativeId = lifeNativePromoteMatch[2];
            const wj = await loadWorldJson(env, auth.world.id);
            const native = (wj.natives || []).find((n) => n.id === nativeId);
            if (!native) {
                return json({ success: false, error: "原住民不存在。" }, 404);
            }

            // Companion Engine 列兜底（幂等；正式迁移见 schema/migrate_companion.sql）
            await ensureCompanionColumns(env);

            const characterId = "char_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const shareId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
            const storyHook = String(native.background || "").slice(0, 80) || `来自生命世界「${auth.world.name}」的原住民。`;
            const chatConfigJson = JSON.stringify({
                temperature: 0.9,
                max_tokens: 150,
                proactivity: "balanced",
                rate: 0,
                ...((native.chat_config && typeof native.chat_config === "object") ? native.chat_config : {})
            });

            await env.DB.prepare(
                `INSERT INTO characters (
                    id, owner_id, name, appearance, personality, background,
                    speech_style, world_name, world_description, story_hook,
                    source_idea, image_url, share_id, gender, chat_config,
                    intimacy, companion_state, parent_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '{}', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            ).bind(
                characterId,
                auth.user.id,
                String(native.name || "").trim().slice(0, 40),
                String(native.appearance || "").slice(0, 800),
                String(native.personality || "").slice(0, 800),
                String(native.background || "").slice(0, 2000),
                String(native.speech_style || "").slice(0, 400),
                String(auth.world.name || "").slice(0, 80),
                String(auth.world.description || "").slice(0, 1200),
                storyHook,
                "由生命世界转正的原住民",
                String(native.avatar || "").slice(0, 2000),
                shareId,
                ["female", "male", "neutral"].includes(native.gender) ? native.gender : "",
                chatConfigJson
            ).run();

            const character = await getCharacterById(env, characterId);

            return json({
                success: true,
                character: formatCharacter(character),
                buddy_url: `/buddy/${characterId}`,
                note: `「${native.name}」已转正进角色库，可与其一对一发展；原住民仍保留在这个世界里。`
            });
        } catch (error) {
            console.error("LIFE NATIVE PROMOTE ERROR:", error);
            return json({ success: false, error: "转正失败，请稍后再试。" }, 500);
        }
    }

    if (lifeBackgroundMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeBackgroundMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);
            const prev = wj.background || {};
            const next = sanitizeBackground(body.background || {});
            if (prev.locked) {
                // 已锁定的核心字段不允许改动其值；但可补填此前为空的字段（如新增的主要势力/力量体系）
                const lockedChanged = ["era", "tone", "rule", "faction", "power"].some(k => prev[k] && next[k] !== prev[k]);
                if (lockedChanged) {
                    return json({ success: false, error: "世界的时代背景、世界规则、主要势力、力量体系与氛围基调一经设定即锁定，无法二次修改。" }, 400);
                }
                next.locked = true;
            } else if (next.era || next.tone || next.rule || next.faction || next.power) {
                // 一经选择核心设定（时代背景/世界规则/主要势力/力量体系/氛围基调），立即锁死
                next.locked = true;
            }
            wj.background = next;
            await saveWorldJson(env, auth.world.id, wj);
            return json({ success: true, background: wj.background });
        } catch (error) {
            console.error("LIFE BACKGROUND ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    if (lifeRelationsMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeRelationsMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);

            if (body.delete && body.delete.a && body.delete.b) {
                wj.relations = (wj.relations || []).filter((r) =>
                    !(r.a === body.delete.a && r.b === body.delete.b) &&
                    !(r.a === body.delete.b && r.b === body.delete.a)
                );
                await saveWorldJson(env, auth.world.id, wj);
                return json({ success: true, relations: wj.relations });
            }

            const a = String(body.a || "").slice(0, 40);
            const b = String(body.b || "").slice(0, 40);
            if (!a || !b || a === b) {
                return json({ success: false, error: "请选择两个不同的角色。" }, 400);
            }
            const kind = LIFE_RELATION_KINDS.has(body.kind) ? body.kind : "neutral";
            const note = String(body.note || "").trim().slice(0, 200);
            // 羁绊值 0~100；初始建立关系即满值 100；再次提交同一对角色 = 用户强干扰覆盖
            const rawBond = parseInt(body.bond, 10);
            const bond = Number.isFinite(rawBond) ? Math.min(100, Math.max(0, rawBond)) : 100;

            const castIds = new Set((await resolveWorldCast(env, auth.world, wj)).map((c) => c.id));
            if (!castIds.has(a) || !castIds.has(b)) {
                return json({ success: false, error: "关系双方必须是这个世界里的角色。" }, 400);
            }

            wj.relations = (wj.relations || []).filter((r) =>
                !(r.a === a && r.b === b) && !(r.a === b && r.b === a)
            );
            wj.relations.push({ a, b, kind, note, bond });
            await saveWorldJson(env, auth.world.id, wj);
            return json({ success: true, relations: wj.relations });
        } catch (error) {
            console.error("LIFE RELATION ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    /* __LIFE_P3__ */

    if (lifeScenesMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeScenesMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);

            if (body.deleteScene) {
                const sid = String(body.deleteScene).slice(0, 40);
                wj.scenes = (wj.scenes || []).filter((s) => s.id !== sid);
                await env.DB.prepare(
                    "UPDATE world_threads SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE world_id = ? AND scene_id = ?"
                ).bind(auth.world.id, sid).run();
                await saveWorldJson(env, auth.world.id, wj);
                return json({ success: true, scenes: wj.scenes });
            }

            const sc = (body.scene && typeof body.scene === "object") ? body.scene : {};
            const name = String(sc.name || "").trim().slice(0, 60);
            if (!name) {
                return json({ success: false, error: "请给场景起个名字。" }, 400);
            }
            const present = Array.isArray(sc.present)
                ? [...new Set(sc.present.map(String).filter(Boolean))].slice(0, 12)
                : [];
            const sceneObj = {
                id: sc.id ? String(sc.id).slice(0, 40) : ("sc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12)),
                name,
                location: String(sc.location || "").trim().slice(0, 80),
                desc: String(sc.desc || "").trim().slice(0, 600),
                present,
                opening: String(sc.opening || "").trim().slice(0, 300),
                area_id: String(sc.area_id || "").trim().slice(0, 40)
            };

            const idx = (wj.scenes || []).findIndex((s) => s.id === sceneObj.id);
            if (idx >= 0) wj.scenes[idx] = sceneObj;
            else wj.scenes.push(sceneObj);

            await saveWorldJson(env, auth.world.id, wj);
            return json({ success: true, scenes: wj.scenes });
        } catch (error) {
            console.error("LIFE SCENE ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    if (lifeThreadsMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeThreadsMatch[1], { public: true });
            if (!auth.world) return auth;
            const body = await request.json();
            const kind = ["auto", "scene", "main"].includes(body.kind) ? body.kind : "auto";
            const sceneId = String(body.scene_id || "").slice(0, 40);
            const wj = await loadWorldJson(env, auth.world.id);

            let thread = null;
            if (kind === "scene" && sceneId) {
                const exist = await env.DB.prepare(
                    `SELECT * FROM world_threads WHERE world_id = ? AND kind = 'scene' AND scene_id = ? AND status = 'active' LIMIT 1`
                ).bind(auth.world.id, sceneId).first();
                if (exist) thread = exist;
            }

            if (!thread) {
                const title = (kind === "scene" && sceneId)
                    ? ((wj.scenes || []).find((s) => s.id === sceneId)?.name || "场景")
                    : (String(body.title || "").trim().slice(0, 60) || (kind === "auto" ? "日常" : "主线"));
                const id = "wt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
                await env.DB.prepare(
                    `INSERT INTO world_threads (id, world_id, kind, scene_id, title, status, turn, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
                ).bind(id, auth.world.id, kind, sceneId, title).run();
                thread = { id, world_id: auth.world.id, kind, scene_id: sceneId, title, status: "active", turn: 0 };
            }

            wj.life.currentThreadId = thread.id;
            await saveWorldJson(env, auth.world.id, wj);

            const threads = await loadWorldThreads(env, auth.world.id);
            return json({ success: true, thread: formatThread(thread), threads });
        } catch (error) {
            console.error("LIFE THREAD ERROR:", error);
            return json({ success: false, error: "创建失败。" }, 500);
        }
    }

    if (lifeThreadsMatch && method === "DELETE") {
        try {
            const auth = await requireOwnedLifeWorld(lifeThreadsMatch[1]);
            if (!auth.world) return auth;
            const url = new URL(request.url);
            const threadId = String(url.searchParams.get("thread") || "").slice(0, 40);
            if (!threadId) {
                return json({ success: false, error: "缺少线程参数。" }, 400);
            }
            const thread = await env.DB.prepare(
                "SELECT * FROM world_threads WHERE id = ? AND world_id = ? LIMIT 1"
            ).bind(threadId, auth.world.id).first();
            if (!thread) {
                return json({ success: false, error: "线程不存在。" }, 404);
            }
            // 默认主线程不可手动删除，除非删除整个世界
            if (thread.kind === "main") {
                return json({ success: false, error: "默认主线程不可删除；如需清理请删除整个世界。" }, 400);
            }

            await env.DB.prepare("DELETE FROM world_messages WHERE thread_id = ?").bind(threadId).run();
            await env.DB.prepare("DELETE FROM world_threads WHERE id = ?").bind(threadId).run();

            const wj = await loadWorldJson(env, auth.world.id);
            if (wj.life.currentThreadId === threadId) {
                const remaining = await env.DB.prepare(
                    "SELECT * FROM world_threads WHERE world_id = ? AND status = 'active' ORDER BY created_at ASC LIMIT 1"
                ).bind(auth.world.id).first();
                if (remaining) {
                    wj.life.currentThreadId = remaining.id;
                } else {
                    // 理论上不应发生：始终有一条主线线程兜底
                    const id = "wt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
                    await env.DB.prepare(
                        `INSERT INTO world_threads (id, world_id, kind, scene_id, title, status, turn, created_at, updated_at)
                         VALUES (?, ?, 'main', '', '主线', 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
                    ).bind(id, auth.world.id).run();
                    wj.life.currentThreadId = id;
                }
                await saveWorldJson(env, auth.world.id, wj);
            }

            const threads = await loadWorldThreads(env, auth.world.id);
            return json({ success: true, threads });
        } catch (error) {
            console.error("LIFE THREAD DELETE ERROR:", error);
            return json({ success: false, error: "删除失败。" }, 500);
        }
    }

    if (lifeThreadMetaMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeThreadMetaMatch[1], { public: true });
            if (!auth.world) return auth;
            const body = await request.json();
            const threadId = String(body.thread_id || "").slice(0, 40);
            const thread = await env.DB.prepare(
                "SELECT * FROM world_threads WHERE id = ? AND world_id = ? AND status = 'active' LIMIT 1"
            ).bind(threadId, auth.world.id).first();
            if (!thread) {
                return json({ success: false, error: "线程不存在。" }, 404);
            }
            const title = String(body.title || "").trim().slice(0, 60);
            if (title) {
                await env.DB.prepare(
                    "UPDATE world_threads SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).bind(title, threadId).run();
            }
            const wj = await loadWorldJson(env, auth.world.id);
            wj.threadMeta = (wj.threadMeta && typeof wj.threadMeta === "object" && !Array.isArray(wj.threadMeta)) ? wj.threadMeta : {};
            wj.threadMeta[threadId] = {
                desc: String(body.desc || "").trim().slice(0, 800),
                bg: String(body.bg || "").trim().slice(0, 1200)
            };
            await saveWorldJson(env, auth.world.id, wj);
            const fresh = await env.DB.prepare(
                "SELECT id, world_id, kind, scene_id, title, status, turn, created_at, updated_at FROM world_threads WHERE id = ?"
            ).bind(threadId).first();
            return json({ success: true, thread: formatThread(fresh), meta: wj.threadMeta[threadId] });
        } catch (error) {
            console.error("LIFE THREAD META ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    if (lifeNameMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeNameMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);
            const cast = await resolveWorldCast(env, auth.world, wj);
            const exclude = new Set(cast.map((c) => c.name).filter(Boolean));
            const gender = ["female", "male"].includes(body.gender) ? body.gender : "";
            const name = randomWorldName({ gender, exclude: [...exclude] });
            return json({ success: true, name });
        } catch (error) {
            console.error("LIFE NAME ERROR:", error);
            return json({ success: false, error: "起名失败。" }, 500);
        }
    }

    if (lifeStoryMatch && method === "GET") {
        try {
            const auth = await requireOwnedLifeWorld(lifeStoryMatch[1], { public: true });
            if (!auth.world) return auth;
            const wj = await loadWorldJson(env, auth.world.id);
            const state = wj.state || {};
            const cast = await resolveWorldCast(env, auth.world, wj);
            return json({
                success: true,
                story: state.story || {},
                chapters: Array.isArray(state.chapters) ? state.chapters : [],
                beats: Array.isArray(state.beats) ? state.beats : [],
                secrets: Array.isArray(state.secrets) ? state.secrets : [],
                plots: Array.isArray(state.plots) ? state.plots : [],
                timeline: Array.isArray(state.timeline) ? state.timeline : [],
                relations: wj.relations || [],
                lastPulseSeq: Number(state.lastPulseSeq) || 0,
                // 角色弧光：世界内情绪（引擎确定性落账；带名字供前端直接渲染）
                castMoods: cast
                    .map(c => ({ id: c.id, name: c.name, mood: c.mood || null }))
                    .filter(x => x.mood && x.mood.label && x.mood.label !== "平静")
            });
        } catch (error) {
            console.error("LIFE STORY ERROR:", error);
            return json({ success: false, error: "读取故事档案失败。" }, 500);
        }
    }

    if (lifeNpcBatchMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeNpcBatchMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const rawCount = parseInt(body.count, 10);
            const count = Number.isFinite(rawCount) ? Math.min(10, Math.max(1, rawCount)) : 3;
            const mock = body.mock === true;
            const { world } = auth;
            const wj = await loadWorldJson(env, world.id);
            const cast = await resolveWorldCast(env, world, wj);
            const excludeNames = new Set(cast.map((c) => c.name).filter(Boolean));

            const batch = await generateNpcBatch({
                world,
                env,
                mock,
                count,
                excludeNames: [...excludeNames]
            });

            const created = batch.map((n) => ({
                id: "wc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
                name: String(n.name || "未名").trim().slice(0, 40),
                appearance: String(n.appearance || "").trim().slice(0, 800),
                personality: String(n.personality || "").trim().slice(0, 800),
                background: String(n.background || "").trim().slice(0, 2000),
                speech_style: String(n.speech_style || "").trim().slice(0, 400),
                gender: ["female", "male", "neutral"].includes(n.gender) ? n.gender : "",
                age: sanitizeNativeAge(n.age),
                tags: sanitizeNativeTags(n.tags),
                chat_config: sanitizeNativeConfig(n.chat_config || {}),
                avatar: String(n.avatar || "").slice(0, 2000),
                source: "npc"
            }));
            wj.natives = (wj.natives || []).concat(created);
            await saveWorldJson(env, world.id, wj);

            const thread = await pickLifeThread(env, world.id, wj, String(body.thread_id || ""));
            let messages = [];
            let threadOut = null;
            if (thread) {
                threadOut = formatThread(thread);
                const names = created.map((x) => x.name).join("、");
                messages = await appendWorldMessages(env, thread.id, [
                    { actor: "narrator", name: "", content: `🎭 新面孔来到了「${thread.title || "这里"}」：${names}。` }
                ]);
                const activeCast = await activeCastForThread(env, world, wj, thread);
                const recent = await loadThreadMessages(env, thread.id, 24);
                const firstSpeakers = created.slice(0, 2).map((n) => ({
                    id: n.id, name: n.name, appearance: n.appearance, personality: n.personality,
                    background: n.background, speech_style: n.speech_style, gender: n.gender, age: n.age,
                    tags: n.tags, chat_config: n.chat_config, source: "native"
                }));
                const opening = !recent.some((m) => m.actor !== "narrator");
                const inserted = await runWorldTurn({
                    env, world, wj, thread, cast: activeCast, recent, speakers: firstSpeakers,
                    userName: auth.user.username, opening, mock
                });
                messages = messages.concat(inserted);
            }

            return json({ success: true, natives: wj.natives, messages, thread: threadOut });
        } catch (error) {
            console.error("LIFE NPC BATCH ERROR:", error);
            return json({ success: false, error: "NPC 生成失败，请稍后再试。" }, 500);
        }
    }

    /* __LIFE_P4__ */

    if (lifeChatMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeChatMatch[1], { public: true });
            if (!auth.world) return auth;
            const { world } = auth;
            const userName = auth.isGuest === true ? "游客" : (auth.user ? auth.user.username : "游客");
            const body = await request.json();
            const message = String(body.message || "").trim().slice(0, 2000);
            if (!message) {
                return json({ success: false, error: "请输入消息。" }, 400);
            }

            const wj = await loadWorldJson(env, world.id);
            const thread = await pickLifeThread(env, world.id, wj, String(body.thread_id || ""));
            if (!thread) {
                return json({ success: false, error: "还没有可用线程，请先创建线程。" }, 400);
            }
            // 发言所在的线程成为当前线程（世界页重开时直接回到这里）
            wj.life.currentThreadId = thread.id;

            // 用户发言
            const userMsg = await appendWorldMessages(env, thread.id, [
                { actor: "user", name: userName, content: message }
            ]);

            // 在场角色回应 1~2 名
            let recent = await loadThreadMessages(env, thread.id, 24);
            const activeCast = await activeCastForThread(env, world, wj, thread);
            const speakers = pickNextSpeakers(activeCast, recent, activeCast.length >= 3 ? 2 : 1);
            const replies = speakers.length
                ? await runWorldTurn({ env, world, wj, thread, cast: activeCast, recent, speakers, userName, opening: false, mock: body.mock === true })
                : [];
            await saveWorldJson(env, world.id, wj);

            return json({ success: true, messages: [...userMsg, ...replies] });
        } catch (error) {
            console.error("LIFE CHAT ERROR:", error);
            return json({ success: false, error: "发言失败，请稍后再试。" }, 500);
        }
    }

    if (lifeTickMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeTickMatch[1], { public: true });
            if (!auth.world) return auth;
            const { world } = auth;
            const userName = auth.isGuest === true ? "游客" : (auth.user ? auth.user.username : "游客");
            const body = await request.json();
            const wj = await loadWorldJson(env, world.id);
            if (wj.life.paused) {
                return json({ success: true, skipped: true, reason: "paused", messages: [] });
            }

            const result = await runWorldTickCore(
                env,
                world,
                wj,
                2,
                String(body.thread_id || ""),
                userName,
                body.mock === true
            );
            return json({ success: true, ...result });
        } catch (error) {
            console.error("LIFE TICK ERROR:", error);
            return json({ success: false, error: "世界运转出错了，请稍后再试。" }, 500);
        }
    }

    if (lifeMessagesMatch && method === "GET") {
        try {
            const auth = await requireOwnedLifeWorld(lifeMessagesMatch[1], { public: true });
            if (!auth.world) return auth;
            const url = new URL(request.url);
            const threadId = url.searchParams.get("thread") || "";
            const after = parseInt(url.searchParams.get("after"), 10) || 0;
            const wj = await loadWorldJson(env, auth.world.id);
            const thread = await pickLifeThread(env, auth.world.id, wj, threadId);
            if (!thread) {
                return json({ success: true, thread: null, messages: [] });
            }
            const result = await env.DB.prepare(
                `SELECT id, seq, actor, name, content, created_at
                 FROM world_messages
                 WHERE thread_id = ? AND seq > ?
                 ORDER BY seq ASC LIMIT 100`
            ).bind(thread.id, after).all();
            return json({ success: true, thread: formatThread(thread), messages: result.results || [] });
        } catch (error) {
            console.error("LIFE MESSAGES ERROR:", error);
            return json({ success: false, error: "消息加载失败。" }, 500);
        }
    }

    if (lifeSettingsMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeSettingsMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);
            const life = (body.life && typeof body.life === "object") ? body.life : {};
            wj.life = { ...wj.life, ...sanitizeLifeSettings(life) };
            await saveWorldJson(env, auth.world.id, wj);
            return json({ success: true, life: wj.life });
        } catch (error) {
            console.error("LIFE SETTINGS ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    if (lifeSummaryMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeSummaryMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);
            const thread = await pickLifeThread(env, auth.world.id, wj, String(body.thread_id || ""));
            if (!thread) {
                return json({ success: true, summary: "" });
            }
            const messages = await loadThreadMessages(env, thread.id, 60);
            const summary = await summarizeWorldGap({ world: auth.world, messages, modelId: wj.life.model, env });
            return json({ success: true, summary });
        } catch (error) {
            console.error("LIFE SUMMARY ERROR:", error);
            return json({ success: false, error: "摘要生成失败。" }, 500);
        }
    }

    /* ----- 角色库 ↔ 生命世界互通 ----- */

    if (lifeCastMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeCastMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const charId = String(body.char_id || "").trim().slice(0, 40);
            if (!/^char_[a-z0-9]+$/.test(charId)) {
                return json({ success: false, error: "角色参数无效。" }, 400);
            }
            const character = await env.DB.prepare(
                "SELECT id, owner_id FROM characters WHERE id = ? LIMIT 1"
            ).bind(charId).first();
            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }
            if (character.owner_id !== auth.user.id) {
                return json({ success: false, error: "只能邀请自己的角色库角色。" }, 403);
            }
            const world = await getWorldById(env, auth.world.id);
            let castIds = [];
            try { castIds = JSON.parse(world.cast_ids || "[]"); } catch { castIds = []; }
            castIds = castIds.map(String).filter(Boolean).slice(0, 12);
            if (!castIds.includes(charId)) {
                castIds.push(charId);
                await env.DB.prepare(
                    "UPDATE worlds SET cast_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).bind(JSON.stringify(castIds), world.id).run();
            }
            const freshWorld = await getWorldById(env, auth.world.id);
            const wj = await loadWorldJson(env, auth.world.id);
            const cast = await resolveWorldCast(env, freshWorld, wj);
            return json({ success: true, cast_ids: castIds, cast });
        } catch (error) {
            console.error("LIFE CAST INVITE ERROR:", error);
            return json({ success: false, error: "邀请失败。" }, 500);
        }
    }

    /* __LIFE_CAST_REMOVE__ */

    if (lifeCastMemberMatch && method === "DELETE") {
        try {
            const auth = await requireOwnedLifeWorld(lifeCastMemberMatch[1]);
            if (!auth.world) return auth;
            const charId = lifeCastMemberMatch[2];
            const world = await getWorldById(env, auth.world.id);
            let castIds = [];
            try { castIds = JSON.parse(world.cast_ids || "[]"); } catch { castIds = []; }
            castIds = castIds.map(String).filter((id) => id !== charId);
            await env.DB.prepare(
                "UPDATE worlds SET cast_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(JSON.stringify(castIds), world.id).run();

            // 角色离开世界：清理其参与的关系与场景出场（该角色仍留在角色库）
            const wj = await loadWorldJson(env, auth.world.id);
            wj.relations = (wj.relations || []).filter((r) => r.a !== charId && r.b !== charId);
            (wj.scenes || []).forEach((s) => {
                if (Array.isArray(s.present)) s.present = s.present.filter((p) => p !== charId);
            });
            await saveWorldJson(env, auth.world.id, wj);
            const freshWorld = await getWorldById(env, auth.world.id);
            const cast = await resolveWorldCast(env, freshWorld, wj);
            return json({ success: true, cast_ids: castIds, cast, relations: wj.relations });
        } catch (error) {
            console.error("LIFE CAST REMOVE ERROR:", error);
            return json({ success: false, error: "移出失败。" }, 500);
        }
    }

    /* ----- 世界封面更新（支持上传 /img/ 或外链）----- */

    const worldCoverMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/cover$/);
    if (worldCoverMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            const world = await getWorldById(env, worldCoverMatch[1]);
            if (!world) {
                return json({ success: false, error: "世界不存在。" }, 404);
            }
            if (!user || world.owner_id !== user.id) {
                return json({ success: false, error: "无权修改这个世界。" }, 403);
            }
            const body = await request.json();
            const cover = String(body.cover_image || "").trim().slice(0, 2000);
            if (!/^\/img\/img_[a-z0-9]+$/.test(cover) && !/^https?:\/\/[^\s]+$/.test(cover)) {
                return json({ success: false, error: "封面地址无效。" }, 400);
            }
            await env.DB.prepare(
                "UPDATE worlds SET cover_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(cover, world.id).run();
            return json({ success: true, cover_image: cover });
        } catch (error) {
            console.error("WORLD COVER ERROR:", error);
            return json({ success: false, error: "封面保存失败。" }, 500);
        }
    }

    /* ----- 地图 / 区域 ----- */

    /* __LIFE_AREAS__ */

    if (lifeAreasMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeAreasMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);

            if (body.deleteArea) {
                const aid = String(body.deleteArea).slice(0, 40);
                wj.areas = (wj.areas || []).filter((x) => x.id !== aid);
                (wj.scenes || []).forEach((s) => { if (s.area_id === aid) s.area_id = ""; });
                await saveWorldJson(env, auth.world.id, wj);
                return json({ success: true, areas: wj.areas });
            }

            const a = (body.area && typeof body.area === "object") ? body.area : {};
            const name = String(a.name || "").trim().slice(0, 40);
            if (!name) {
                return json({ success: false, error: "请给区域起个名字。" }, 400);
            }
            const areaObj = {
                id: a.id ? String(a.id).slice(0, 40) : ("ar_" + crypto.randomUUID().replace(/-/g, "").slice(0, 10)),
                name,
                desc: String(a.desc || "").trim().slice(0, 400),
                bg_image: String(a.bg_image || "").trim().slice(0, 2000)
            };
            const idx = (wj.areas || []).findIndex((x) => x.id === areaObj.id);
            if (idx >= 0) wj.areas[idx] = areaObj;
            else wj.areas.push(areaObj);

            await saveWorldJson(env, auth.world.id, wj);
            return json({ success: true, areas: wj.areas });
        } catch (error) {
            console.error("LIFE AREA ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    /* ----- CHARACTER detail ----- */


    const characterMatch = pathname.match(
        /^\/api\/characters\/(char_[a-z0-9]+)$/
    );

    if (characterMatch && method === "GET") {
        try {
            const character = await getCharacterById(
                env,
                characterMatch[1]
            );

            if (!character) {
                return json({
                    success: false,
                    error: "角色不存在。"
                }, 404);
            }

            return json({
                success: true,
                character: formatCharacter(character)
            });

        } catch (error) {
            console.error("CHARACTER GET ERROR:", error);

            return json({
                success: false,
                error: "加载失败。"
            }, 500);
        }
    }

    /* ----- CHARACTER delete ----- */

    const deleteMatch = pathname.match(
        /^\/api\/characters\/(char_[a-z0-9]+)\/delete$/
    );

    if (deleteMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const characterId = deleteMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            if (character.owner_id !== user.id) {
                return json({ success: false, error: "无权操作此角色。" }, 403);
            }

            const convs = await env.DB.prepare(
                "SELECT id FROM conversations WHERE character_id = ?"
            ).bind(characterId).all();

            const convIds = (convs.results || []).map(c => c.id);

            if (convIds.length > 0) {
                // Limit the number of conversations to delete to prevent abuse
                if (convIds.length > 100) {
                    return json({ success: false, error: "对话数量过多。" }, 400);
                }

                const placeholders = convIds.map(() => "?").join(",");
                // Verify placeholder count matches bind parameter count
                if (placeholders.split(",").length !== convIds.length) {
                    return json({ success: false, error: "数据错误。" }, 500);
                }

                await env.DB.prepare(
                    `DELETE FROM messages WHERE conversation_id IN (${placeholders})`
                ).bind(...convIds).run();
                await env.DB.prepare(
                    "DELETE FROM conversations WHERE character_id = ?"
                ).bind(characterId).run();
            }

            await env.DB.batch([
                env.DB.prepare("DELETE FROM memories WHERE character_id = ?").bind(characterId),
                env.DB.prepare("DELETE FROM assets WHERE character_id = ?").bind(characterId),
                env.DB.prepare("DELETE FROM characters WHERE id = ?").bind(characterId)
            ]);

            return json({ success: true });

        } catch (error) {
            console.error("CHARACTER DELETE ERROR:", error);
            return json({ success: false, error: "删除失败，请稍后再试。" }, 500);
        }
    }

    /* ----- CHARACTER update ----- */

    const updateMatch = pathname.match(
        /^\/api\/characters\/(char_[a-z0-9]+)\/update$/
    );

    if (updateMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const characterId = updateMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            if (character.owner_id !== user.id) {
                return json({ success: false, error: "无权操作此角色。" }, 403);
            }

            const body = await request.json();

            const fields = ["name", "appearance", "personality", "background", "speech_style", "world_name", "world_description", "story_hook"];
            const updates = [];
            const values = [];

            for (const f of fields) {
                if (body[f] !== undefined) {
                    updates.push(`${f} = ?`);
                    values.push(String(body[f]).slice(0, f === "background" || f === "world_description" ? 2000 : 800));
                }
            }

            // 收费 / 免费作品（暂未开通支付，仅记录与展示）
            if (["free", "paid"].includes(body.pricing)) {
                updates.push("pricing = ?");
                values.push(body.pricing);
            }
            if (body.price !== undefined) {
                updates.push("price = ?");
                values.push(Math.max(0, Math.min(100000, Math.floor(Number(body.price) || 0))));
            }

            // 公开 / 隐藏（主页角色卡「显示/隐藏」按钮）：
            // visible=true  → 确保 share_id 非空（公开，访客可见）
            // visible=false → 清空 share_id（隐藏，仅自己可见，分享链接失效）
            if (body.visible === true) {
                const keep = character.share_id && character.share_id !== "" ? character.share_id : "";
                updates.push("share_id = ?");
                values.push(keep || crypto.randomUUID().replace(/-/g, "").slice(0, 10));
            } else if (body.visible === false) {
                // 隐藏 = share_id 置 NULL（share_id 列有 UNIQUE 约束，空串 '' 全表只能有一行，
                // 用 NULL 才能支持任意多个隐藏角色；公开判定统一按「非空」过滤，语义不变）
                updates.push("share_id = ?");
                values.push(null);
            }

            if (updates.length === 0) {
                return json({ success: false, error: "没有需要更新的字段。" }, 400);
            }

            updates.push("updated_at = CURRENT_TIMESTAMP");
            values.push(characterId);

            await env.DB.prepare(
                `UPDATE characters SET ${updates.join(", ")} WHERE id = ?`
            ).bind(...values).run();

            const updated = await getCharacterById(env, characterId);

            return json({
                success: true,
                character: formatCharacter(updated)
            });

        } catch (error) {
            console.error("CHARACTER UPDATE ERROR:", error);
            return json({ success: false, error: "更新失败，请稍后再试。" }, 500);
        }
    }

    /* ----- SHARE public ----- */

    const shareMatch = pathname.match(
        /^\/api\/share\/([a-z0-9]+)$/
    );

    if (shareMatch && method === "GET") {
        try {
            const character = await env.DB.prepare(
                "SELECT * FROM characters WHERE share_id = ? LIMIT 1"
            ).bind(shareMatch[1]).first();

            if (!character) {
                return json({
                    success: false,
                    error: "分享不存在或已失效。"
                }, 404);
            }

            return json({
                success: true,
                character: formatCharacter(character),
                share_url: `/s/${character.share_id}`,
                buddy_url: `/buddy/${character.id}`
            });

        } catch (error) {
            console.error("SHARE ERROR:", error);

            return json({
                success: false,
                error: isMissingTableError(error)
                    ? "数据库尚未初始化 MVP 表，请先执行 schema/mvp.sql。"
                    : "加载失败，请稍后再试。"
            }, 500);
        }
    }

    /* ----- BUDDY messages ----- */

    const messagesMatch = pathname.match(
        /^\/api\/buddy\/(char_[a-z0-9]+)\/messages$/
    );

    if (messagesMatch && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);

            if (!user) {
                return json({
                    success: false,
                    error: "请先登录。",
                    login_url: "/yonder.html?next=" + encodeURIComponent(pathname.replace("/api", ""))
                }, 401);
            }

            const characterId = messagesMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({
                    success: false,
                    error: "角色不存在。"
                }, 404);
            }

            const conversation = await ensureConversation(
                env,
                characterId,
                user.id
            );

            const result = await env.DB.prepare(
                `SELECT id, role, content, created_at
                 FROM messages
                 WHERE conversation_id = ?
                 ORDER BY rowid DESC
                 LIMIT 100`
            ).bind(conversation.id).all();
            (result.results || []).reverse();

            const memories = await getMemories(
                env,
                characterId,
                user.id,
                8
            );

            return json({
                success: true,
                character: formatCharacter(character),
                messages: result.results || [],
                memories_count: memories.length,
                ai_mode: env.AI ? "workers-ai" : "mock"
            });

        } catch (error) {
            console.error("BUDDY MESSAGES ERROR:", error);

            return json({
                success: false,
                error: "加载对话失败，请稍后再试。"
            }, 500);
        }
    }

    /* ----- BUDDY 沉淀为剧本（对话 → 剧本 → worlds.script_json） ----- */

    const scriptMatch = pathname.match(/^\/api\/buddy\/(char_[a-z0-9]+)\/script$/);

    if (scriptMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);

            if (!user) {
                return json({
                    success: false,
                    error: "请先登录。",
                    login_url: "/yonder.html?next=" + encodeURIComponent("/buddy/" + scriptMatch[1])
                }, 401);
            }

            const characterId = scriptMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            if (character.owner_id !== user.id) {
                return json({ success: false, error: "只能沉淀你自己创造的角色。" }, 403);
            }

            const conversation = await ensureConversation(env, characterId, user.id);
            const result = await env.DB.prepare(
                `SELECT role, content, created_at
                 FROM messages
                 WHERE conversation_id = ?
                 ORDER BY rowid DESC
                 LIMIT 60`
            ).bind(conversation.id).all();
            const rows = (result.results || []).reverse();

            if (!rows.length) {
                return json({ success: false, error: "还没有对话可以沉淀，先和 TA 聊一会儿吧。" }, 400);
            }

            const transcript = rows.map(m => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: messageToPlainText(m.content)
            }));

            // 复用角色已有的世界（cast_ids 含该角色），否则新建一个
            const existing = await env.DB.prepare(
                `SELECT * FROM worlds WHERE owner_id = ? AND cast_ids LIKE ? LIMIT 1`
            ).bind(user.id, `%"${characterId}"%`).first();

            const script = await generateScriptFromConversation({ character, transcript }, env);

            let world;
            if (existing) {
                let prevScenes = [];
                try {
                    const prev = JSON.parse(existing.script_json || "[]");
                    prevScenes = Array.isArray(prev)
                        ? prev
                        : (prev && Array.isArray(prev.scenes) ? prev.scenes : []);
                } catch { prevScenes = []; }

                const offset = prevScenes.length;
                const extra = (Array.isArray(script.scenes) ? script.scenes : [])
                    .map((s, i) => ({ ...s, id: `scene_${offset + i + 1}` }));
                const merged = {
                    title: script.title || existing.name,
                    summary: script.summary || existing.description,
                    scenes: [...prevScenes, ...extra]
                };

                await env.DB.prepare(
                    "UPDATE worlds SET script_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).bind(JSON.stringify(merged), existing.id).run();
                world = await getWorldById(env, existing.id);
            } else {
                const worldId = "world_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
                const shareId = "w" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
                const worldName = (character.world_name || character.name + "的世界").slice(0, 80);

                await env.DB.prepare(
                    `INSERT INTO worlds
                     (id, owner_id, name, description, type, cover_image, script_json, cast_ids, settings, source_conversation, status, share_id, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
                ).bind(
                    worldId, user.id, worldName,
                    (character.world_description || `由与「${character.name}」的日常对话沉淀而成。`).slice(0, 1200),
                    "mixed",
                    character.image_url || "",
                    JSON.stringify(script),
                    JSON.stringify([character.id]),
                    JSON.stringify({ genre: "custom", genreLabel: "自定义", source: "buddy-script" }),
                    conversation.id,
                    "draft",
                    shareId
                ).run();
                world = await getWorldById(env, worldId);
            }

            let sceneCount = 0;
            try {
                const p = JSON.parse(world.script_json || "[]");
                sceneCount = Array.isArray(p) ? p.length : (Array.isArray(p.scenes) ? p.scenes.length : 0);
            } catch { sceneCount = 0; }

            return json({
                success: true,
                world: await formatWorld(env, world),
                script_count: sceneCount
            });
        } catch (error) {
            console.error("BUDDY SCRIPT ERROR:", error);
            return json({ success: false, error: "沉淀失败，请稍后再试。" }, 500);
        }
    }

    /* ----- BUDDY chat ----- */

    const chatMatch = pathname.match(
        /^\/api\/buddy\/(char_[a-z0-9]+)\/chat$/
    );

    if (chatMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);

            if (!user) {
                return json({
                    success: false,
                    error: "请先登录。",
                    login_url: "/yonder.html?next=" + encodeURIComponent("/buddy/" + chatMatch[1])
                }, 401);
            }

            const characterId = chatMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({
                    success: false,
                    error: "角色不存在。"
                }, 404);
            }

            const body = await request.json();
            const userMessage = String(body.message || "").trim();

            // 附件：最多 4 个 /img/ 引用（图片或视频），格式严格校验
            let images = [];
            if (Array.isArray(body.images)) {
                images = body.images
                    .filter(a => a && typeof a === "object"
                        && typeof a.url === "string"
                        && /^\/img\/img_[a-z0-9]+$/.test(a.url)
                        && (a.kind === "image" || a.kind === "video"))
                    .slice(0, 4)
                    .map(a => ({ url: a.url, kind: a.kind }));
            }

            if (!userMessage && images.length === 0) {
                return json({
                    success: false,
                    error: "请输入消息。"
                }, 400);
            }

            if (userMessage.length > 2000) {
                return json({
                    success: false,
                    error: "消息过长。"
                }, 400);
            }

            // 存储内容：带附件时存 JSON（前端据此重新展示图片/视频），否则存纯文本保持兼容
            const storedContent = images.length
                ? JSON.stringify({ text: userMessage, images })
                : userMessage;

            // 发给 AI 的纯文本：当前模型不支持看图，只传文字并注明有附件，避免 image_url 类型错误
            const aiUserMessage = images.length
                ? `${userMessage}\n（用户发送了 ${images.length} 个附件，你无法查看内容，请简短回应）`.trim()
                : userMessage;

            const conversation = await ensureConversation(
                env,
                characterId,
                user.id
            );

            const recentResult = await env.DB.prepare(
                `SELECT role, content
                 FROM messages
                 WHERE conversation_id = ?
                 ORDER BY rowid DESC
                 LIMIT 12`
            ).bind(conversation.id).all();

            const recentMessages = (recentResult.results || []).reverse().map(m => ({
                role: m.role,
                content: messageToPlainText(m.content)
            }));

            const d1Memories = await getMemories(
                env,
                characterId,
                user.id,
                8
            );

            const vectorMemories = await searchRelevantMemories(
                env,
                characterId,
                user.id,
                aiUserMessage,
                5
            );
            // ---- 超长历史自动摘要：防止上下文膨胀（conversations.summary / summarized_upto）----
            let summary = conversation.summary || "";
            const summarizedUpto = Number(conversation.summarized_upto) || 0;

            if (env.AI) {
                try {
                    const oldResult = await env.DB.prepare(
                        `SELECT role, content
                         FROM messages
                         WHERE conversation_id = ?
                         ORDER BY created_at DESC
                         LIMIT 500 OFFSET 12`
                    ).bind(conversation.id).all();

                    const oldMessages = (oldResult.results || [])
                        .reverse()
                        .map(m => ({ role: m.role, content: messageToPlainText(m.content) }));

                    const newUnsummarized = oldMessages.slice(summarizedUpto);
                    const newChars = newUnsummarized.reduce((s, m) => s + m.content.length, 0);

                    if (newUnsummarized.length > 0 && newChars > 20000) {
                        const merged = await compressHistory(env, {
                            existingSummary: summary,
                            newMessages: newUnsummarized
                        });

                        if (merged && merged !== summary) {
                            summary = merged;
                            await env.DB.prepare(
                                "UPDATE conversations SET summary = ?, summarized_upto = ? WHERE id = ?"
                            ).bind(merged, summarizedUpto + newUnsummarized.length, conversation.id).run();
                        }
                    }
                } catch (error) {
                    console.error("CONVERSATION SUMMARY ERROR:", error);
                }
            }



            const memories = [
                ...(summary ? [{ content: "【过往对话摘要】" + summary, importance: 3 }] : []),

                ...vectorMemories.map(m => ({
                    content: m.content,
                    importance: 2
                })),
                ...d1Memories
            ].slice(0, 12);

            // 读取 chat_config 和 intimacy
            let chatConfig = {};
            let intimacy = 0;
            try {
                chatConfig = character.chat_config
                    ? JSON.parse(character.chat_config)
                    : {};
            } catch { chatConfig = {}; }
            intimacy = typeof character.intimacy === "number"
                ? character.intimacy
                : (parseInt(character.intimacy, 10) || 0);

            // Companion Engine：加载情绪/关系/家庭状态
            const companionState = loadCompanionState(character);

            const aiResult = await chatWithCharacter(
                {
                    character,
                    memories,
                    recentMessages,
                    userMessage: aiUserMessage,
                    intimacy,
                    chatConfig,
                    userName: user.username,
                    companionState
                },
                env
            );

            const userMsgId = "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const assistantMsgId = "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const newIntimacy = intimacy + 1;

            // ---- Companion Engine：情绪落账 + 关系自动升温 + 家庭时间推进（惰性）----
            companionState.emotion = applyEmotionToMessage(companionState, aiUserMessage);
            companionState.relation = autoAdvanceRelation(companionState, newIntimacy);
            const familyEvents = await advanceFamilyState(env, { character, ownerId: user.id, state: companionState });
            const companionStateJson = JSON.stringify(companionState);

            // 主动找你：亲密里程碑跨过 / 孩子出生 → 生成 inbox 条目
            const inboxItems = [];
            for (const t of milestoneTriggered(intimacy, newIntimacy)) {
                inboxItems.push(buildMilestoneInbox(character, t));
            }
            if (familyEvents.includes("child")) {
                const child = companionState.family.children[companionState.family.children.length - 1];
                inboxItems.push(buildChildInbox(character, child));
            }

            await env.DB.batch([
                env.DB.prepare(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, CURRENT_TIMESTAMP)"
                ).bind(userMsgId, conversation.id, storedContent),
                env.DB.prepare(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, CURRENT_TIMESTAMP)"
                ).bind(assistantMsgId, conversation.id, aiResult.reply),
                env.DB.prepare(
                    "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).bind(conversation.id),
                env.DB.prepare(
                    "UPDATE characters SET intimacy = ?, companion_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).bind(newIntimacy, companionStateJson, characterId),
                ...inboxItems.map(item => env.DB.prepare(
                    "INSERT INTO companion_inbox (id, user_id, character_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
                ).bind(
                    "inb_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
                    user.id,
                    characterId,
                    item.kind,
                    item.title,
                    item.body
                ))
            ]);

            if (aiResult.memory_note) {
                await env.DB.prepare(
                    `INSERT INTO memories (id, character_id, user_id, content, importance, created_at)
                     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`
                ).bind(
                    "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
                    characterId,
                    user.id,
                    aiResult.memory_note
                ).run();

                await trimMemories(env, characterId, user.id, 30);
            }

            await storeConversationVector(
                env,
                characterId,
                user.id,
                aiUserMessage,
                aiResult.reply,
                aiResult.memory_note
            );

            const memCount = await env.DB.prepare(
                `SELECT COUNT(*) as cnt FROM memories WHERE character_id = ? AND user_id = ?`
            ).bind(characterId, user.id).first();

            return json({
                success: true,
                reply: aiResult.reply,
                message: {
                    id: assistantMsgId,
                    role: "assistant",
                    content: aiResult.reply
                },
                memories_count: memCount?.cnt || 0,
                intimacy: newIntimacy,
                emotion: { label: companionState.emotion.label, intensity: companionState.emotion.intensity },
                relation: { stage: companionState.relation.stage, label: RELATION_LABEL[companionState.relation.stage] },
                family: companionState.family,
                ai_mode: env.AI ? "workers-ai" : "mock"
            });

        } catch (error) {
            console.error("BUDDY CHAT ERROR:", error);

            return json({
                success: false,
                error: "对话失败，请稍后再试。"
            }, 500);
        }
    }

    /* ----- Companion Engine：角色状态（情绪/关系/家庭）----- */

    const companionStateMatch = pathname.match(
        /^\/api\/buddy\/(char_[a-z0-9]+)\/state$/
    );

    if (companionStateMatch && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const character = await getCharacterById(env, companionStateMatch[1]);
            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            const state = loadCompanionState(character);
            // 惰性推进家庭时间线（想要孩子 → 怀孕 → 孩子出生）
            const familyEvents = await advanceFamilyState(env, { character, ownerId: character.owner_id, state });
            if (familyEvents.length) {
                await saveCompanionState(env, character.id, state);
                if (familyEvents.includes("child")) {
                    const child = state.family.children[state.family.children.length - 1];
                    const inbox = buildChildInbox(character, child);
                    await env.DB.prepare(
                        "INSERT INTO companion_inbox (id, user_id, character_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
                    ).bind(
                        "inb_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
                        user.id,
                        character.id,
                        inbox.kind,
                        inbox.title,
                        inbox.body
                    ).run();
                }
            }

            const unread = await env.DB.prepare(
                `SELECT id, kind, title, body, created_at FROM companion_inbox
                 WHERE user_id = ? AND character_id = ? AND read_at IS NULL
                 ORDER BY created_at DESC LIMIT 10`
            ).bind(user.id, character.id).all();

            return json({
                success: true,
                state: publicCompanionState(state),
                unread: unread.results || []
            });
        } catch (error) {
            console.error("COMPANION STATE ERROR:", error);
            return json({ success: false, error: "加载失败。" }, 500);
        }
    }

    /* ----- Companion Engine：关系手动推进（表白/在一起/求婚/结婚/要孩子/回退/解除）----- */

    const relationMatch = pathname.match(
        /^\/api\/buddy\/(char_[a-z0-9]+)\/relation$/
    );

    if (relationMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const character = await getCharacterById(env, relationMatch[1]);
            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }
            if (character.owner_id !== user.id) {
                return json({ success: false, error: "只有 TA 的主人才可以推进关系。" }, 403);
            }

            const body = await request.json();
            const action = String(body.action || "");
            const state = loadCompanionState(character);
            const result = applyRelationAction(state, action);

            if (result.error) {
                return json({ success: false, error: result.error }, 400);
            }

            if (result.relation) state.relation = result.relation;
            if (result.family !== undefined) {
                state.family = action === "break" ? {} : { ...state.family, ...result.family };
            }

            await saveCompanionState(env, character.id, state);

            return json({
                success: true,
                state: publicCompanionState(state),
                note: result.note || ""
            });
        } catch (error) {
            console.error("COMPANION RELATION ERROR:", error);
            return json({ success: false, error: "操作失败，请稍后再试。" }, 500);
        }
    }

    /* ----- Companion Engine：主动找你 inbox ----- */

    if (pathname === "/api/companion/inbox" && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            // 惰性生成「想念」与「纪念日」（确定性规则，读取时落账）
            await maybeGenerateLazyInbox(env, user);

            const unread = await env.DB.prepare(
                `SELECT id, character_id, kind, title, body, created_at FROM companion_inbox
                 WHERE user_id = ? AND read_at IS NULL
                 ORDER BY created_at DESC LIMIT 50`
            ).bind(user.id).all();

            const total = await env.DB.prepare(
                `SELECT COUNT(*) as cnt FROM companion_inbox WHERE user_id = ? AND read_at IS NULL`
            ).bind(user.id).first();

            return json({
                success: true,
                unread: unread.results || [],
                unread_count: total?.cnt || 0
            });
        } catch (error) {
            console.error("COMPANION INBOX ERROR:", error);
            return json({ success: false, error: "加载失败。" }, 500);
        }
    }

    if (pathname === "/api/companion/inbox/read" && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const body = await request.json();
            const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : [];
            if (ids.length) {
                const placeholders = ids.map(() => "?").join(",");
                await env.DB.prepare(
                    `UPDATE companion_inbox SET read_at = CURRENT_TIMESTAMP
                     WHERE user_id = ? AND id IN (${placeholders}) AND read_at IS NULL`
                ).bind(user.id, ...ids).run();
            }

            return json({ success: true });
        } catch (error) {
            console.error("COMPANION INBOX READ ERROR:", error);
            return json({ success: false, error: "操作失败。" }, 500);
        }
    }

    /* ----- BUDDY chat-config save ----- */

    const chatConfigMatch = pathname.match(
        /^\/api\/buddy\/(char_[a-z0-9]+)\/chat-config$/
    );

    if (chatConfigMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const characterId = chatConfigMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            if (character.owner_id !== user.id) {
                return json({ success: false, error: "无权修改。" }, 403);
            }

            const body = await request.json();

            // 合并到现有 config，只允许更新白名单字段
            let existing = {};
            try { existing = JSON.parse(character.chat_config || "{}"); } catch { existing = {}; }

            const temperature = typeof body.temperature === "number"
                ? Math.min(1.1, Math.max(0.3, body.temperature))
                : existing.temperature ?? 0.9;

            const max_tokens = typeof body.max_tokens === "number"
                ? Math.min(300, Math.max(60, Math.round(body.max_tokens)))
                : existing.max_tokens ?? 150;

            const allowed = ["passive", "balanced", "active"];
            const proactivity = allowed.includes(body.proactivity)
                ? body.proactivity
                : (existing.proactivity ?? "balanced");

            // 语音：只接受已知声音 id 或空字符串；角色性别明确时严格对应性别（空 = 自动默认）
            const voice = typeof body.voice === "string" &&
                (body.voice === "" || (KNOWN_VOICE_IDS.has(body.voice) && voiceMatchesGender(character.gender, body.voice)))
                ? body.voice
                : (existing.voice && KNOWN_VOICE_IDS.has(existing.voice) && voiceMatchesGender(character.gender, existing.voice) ? existing.voice : "");

            // 语速：整数偏移 -50 ~ +50（对应 Edge rate 的 -50% ~ +50%）
            const rate = typeof body.rate === "number"
                ? Math.min(50, Math.max(-50, Math.round(body.rate)))
                : (existing.rate ?? 0);

            const newConfig = JSON.stringify({ temperature, max_tokens, proactivity, voice, rate });

            await env.DB.prepare(
                "UPDATE characters SET chat_config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(newConfig, characterId).run();

            return json({
                success: true,
                chat_config: { temperature, max_tokens, proactivity, voice, rate }
            });

        } catch (error) {
            console.error("CHAT CONFIG ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    /* ----- BUDDY portrait (image) update ----- */

    const buddyImageMatch = pathname.match(
        /^\/api\/buddy\/(char_[a-z0-9]+)\/image$/
    );

    if (buddyImageMatch && method === "POST") {
        try {
            const user = await getAuthenticatedUser(request);
            if (!user) {
                return json({ success: false, error: "请先登录。" }, 401);
            }

            const characterId = buddyImageMatch[1];
            const character = await getCharacterById(env, characterId);

            if (!character) {
                return json({ success: false, error: "角色不存在。" }, 404);
            }

            if (character.owner_id !== user.id) {
                return json({ success: false, error: "无权修改。" }, 403);
            }

            const body = await request.json();
            const imageUrl = String(body.image_url || "").trim();

            // 只接受本站上传的图片地址（/img/img_xxx），防止写入任意外链
            if (!/^\/img\/img_[a-z0-9]+$/.test(imageUrl)) {
                return json({ success: false, error: "图片地址无效。" }, 400);
            }

            await env.DB.prepare(
                "UPDATE characters SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(imageUrl, characterId).run();

            return json({ success: true, image_url: imageUrl });

        } catch (error) {
            console.error("BUDDY IMAGE ERROR:", error);
            return json({ success: false, error: "保存失败。" }, 500);
        }
    }

    /* ----- AI status (for debugging / UI badge) ----- */

    if (pathname === "/api/ai/status" && method === "GET") {
        return json({
            success: true,
            ai_provider: env.AI ? "workers-ai" : "mock",
            image_provider: "pollinations",
            chat_model: env.AI_CHAT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
        });
    }

    return null;
}

async function getCharacterById(env, id) {
    return await env.DB.prepare(
        "SELECT * FROM characters WHERE id = ? LIMIT 1"
    ).bind(id).first();
}

/* ---- Companion Engine helpers ---- */

function publicCompanionState(state) {
    const emo = emotionAt(state);
    return {
        emotion: emo,
        relation: {
            stage: state.relation.stage,
            label: RELATION_LABEL[state.relation.stage] || "初识",
            since: state.relation.since,
            note: state.relation.note
        },
        family: state.family
    };
}

async function saveCompanionState(env, characterId, state) {
    await env.DB.prepare("UPDATE characters SET companion_state = ? WHERE id = ?")
        .bind(JSON.stringify(state), characterId).run();
}

/**
 * 主动找你的惰性生成（读取 inbox 时落账，确定性规则）：
 *   1. 想念：角色与主人 >=3 天没聊 + 亲密度 >=10 + 7 天内未发过 miss
 *   2. 纪念日：关系阶段 since 命中 7/30/100/365 天
 */
async function maybeGenerateLazyInbox(env, user) {
    try {
        const now = Date.now();
        const chars = (await env.DB.prepare(
            `SELECT id, name, intimacy, companion_state FROM characters WHERE owner_id = ?`
        ).bind(user.id).all()).results || [];

        if (!chars.length) return;

        const convs = {};
        for (const r of (await env.DB.prepare(
            `SELECT character_id, MAX(updated_at) AS last_at FROM conversations WHERE user_id = ? GROUP BY character_id`
        ).bind(user.id).all()).results || []) {
            convs[r.character_id] = r.last_at;
        }

        const recentMiss = new Set((await env.DB.prepare(
            `SELECT character_id FROM companion_inbox WHERE user_id = ? AND kind = 'miss' AND created_at >= datetime('now', '-7 days')`
        ).bind(user.id).all()).results?.map(r => r.character_id) || []);
        const recentAnniv = new Set((await env.DB.prepare(
            `SELECT character_id FROM companion_inbox WHERE user_id = ? AND kind = 'anniversary' AND created_at >= datetime('now', '-2 days')`
        ).bind(user.id).all()).results?.map(r => r.character_id) || []);

        const inserts = [];
        const mk = (c, item) => env.DB.prepare(
            "INSERT INTO companion_inbox (id, user_id, character_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ).bind(
            "inb_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
            user.id,
            c.id,
            item.kind,
            item.title,
            item.body
        );

        for (const c of chars) {
            const state = loadCompanionState(c);
            const intimacy = Number(c.intimacy) || 0;

            // 想念
            if (intimacy >= 10 && !recentMiss.has(c.id)) {
                const lastMs = convs[c.id] ? new Date(convs[c.id]).getTime() : 0;
                if (Number.isFinite(lastMs) && lastMs > 0 && (now - lastMs) >= 3 * 86400000) {
                    inserts.push(mk(c, buildMissInbox(c)));
                }
            }

            // 纪念日
            if (!recentAnniv.has(c.id) && state.relation.since) {
                const days = anniversaryDaysSince(state.relation.since, now);
                if (days !== null) {
                    inserts.push(mk(c, buildAnniversaryInbox(c, days)));
                }
            }
        }

        if (inserts.length) await env.DB.batch(inserts);
    } catch (e) {
        console.error("LAZY INBOX ERROR:", e);
    }
}

function formatCharacter(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        owner_id: row.owner_id,
        name: row.name,
        appearance: row.appearance,
        personality: row.personality,
        background: row.background,
        speech_style: row.speech_style,
        world_name: row.world_name,
        world_description: row.world_description,
        story_hook: row.story_hook,
        source_idea: row.source_idea,
        image_url: row.image_url,
        share_id: row.share_id,
        share_url: row.share_id ? `/s/${row.share_id}` : null,
        pricing: row.pricing || "free",
        price: Number(row.price) || 0,
        buddy_url: `/buddy/${row.id}`,
        gender: row.gender || "",
        intimacy: row.intimacy ?? 0,
        chat_config: (() => {
            try { return JSON.parse(row.chat_config || "{}"); } catch { return {}; }
        })(),
        // Companion Engine：当前情绪标签 + 关系阶段标签（hub 卡片展示用）
        emotion_label: (() => {
            try { return emotionAt(loadCompanionState(row)).label; } catch { return "平静"; }
        })(),
        relation_label: (() => {
            try {
                const st = loadCompanionState(row);
                return st.relation.stage === "acquaintance" ? "" : (RELATION_LABEL[st.relation.stage] || "");
            } catch { return ""; }
        })(),
        parent_id: row.parent_id || "",
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function getWorldById(env, id) {
    return await env.DB.prepare(
        "SELECT * FROM worlds WHERE id = ? LIMIT 1"
    ).bind(id).first();
}

async function formatWorld(env, row) {
    if (!row) {
        return null;
    }

    let castIds = [];
    try { castIds = JSON.parse(row.cast_ids || "[]"); } catch { castIds = []; }
    let scriptJson = [];
    try { scriptJson = JSON.parse(row.script_json || "[]"); } catch { scriptJson = []; }
    let settings = {};
    try { settings = JSON.parse(row.settings || "{}"); } catch { settings = {}; }

    // 解析 cast 角色摘要（角色可能已被删除，过滤即可）
    let cast = [];
    if (castIds.length) {
        const placeholders = castIds.map(() => "?").join(",");
        try {
            const rows = await env.DB.prepare(
                `SELECT id, name, appearance, personality, story_hook, image_url, world_name, share_id, created_at
                 FROM characters WHERE id IN (${placeholders})`
            ).bind(...castIds).all();
            const byId = new Map((rows.results || []).map(r => [r.id, r]));
            cast = castIds
                .map(id => byId.get(id))
                .filter(Boolean)
                .map(r => ({
                    id: r.id,
                    name: r.name,
                    appearance: r.appearance,
                    personality: r.personality,
                    story_hook: r.story_hook,
                    image_url: r.image_url,
                    world_name: r.world_name,
                    share_id: r.share_id
                }));
        } catch { /* 角色可能已删除，忽略 */ }
    }

    const worldJson = row.type === "life" ? parseWorldJson(row) : null;

    return {
        id: row.id,
        owner_id: row.owner_id,
        name: row.name,
        description: row.description,
        type: row.type,
        cover_image: row.cover_image,
        script_json: scriptJson,
        cast_ids: castIds,
        cast,
        settings,
        source_conversation: row.source_conversation,
        status: row.status,
        share_id: row.share_id,
        pricing: row.pricing || "free",
        price: Number(row.price) || 0,
        play_url: (row.type === "game" || row.type === "mixed")
            ? `/game-workshop?world=${row.id}`
            : (row.type === "life" ? `/world?world=${row.id}` : null),
        world_json: worldJson,
        life_mode: worldJson ? worldJson.life.mode : null,
        life_paused: worldJson ? worldJson.life.paused : null,
        natives_count: worldJson ? (worldJson.natives || []).length : 0,
        relations_count: worldJson ? (worldJson.relations || []).length : 0,
        scenes_count: worldJson ? (worldJson.scenes || []).length : 0,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

/* ----- LIFE WORLD helpers ----- */

const LIFE_DEFAULTS = {
    mode: "watch",               // watch（在线运转）| hybrid（混合）| always（24h 后台）
    paused: false,
    model: "llama3-70b",         // 对话模型 id（见 src/ai/models.js）
    tickIntervalSec: 25,
    cronIntervalMin: 40,
    cronIntervalMinAway: 90,
    lastTickAt: 0,
    ticksToday: 0,
    tickDay: "",
    currentThreadId: ""
};

const LIFE_RELATION_KINDS = new Set([
    "friend", "rival", "enemy", "family", "lover", "mentor", "neutral",
    "crush", "soulmate", "hatred", "dependent", "reverent", "guilt", "betray",
    "sworn", "worship", "fear", "debt", "fated", "ally", "partner"
]);

/** 性格标签池（尽量全而多；前端 world.html 保持同表，选择后注入人设提示影响角色） */
const LIFE_CHAR_TAGS = new Set([
    "温柔", "活泼", "高冷", "神秘", "直率", "腹黑", "傲娇", "病娇", "热血", "冷静",
    "狡黠", "忠厚", "优雅", "狂野", "怯懦", "坚韧", "感性", "理性", "浪漫", "孤僻",
    "健谈", "毒舌", "可靠", "孩子气", "沧桑", "天真", "强势", "自卑", "洒脱", "偏执",
    "睿智", "阴郁", "开朗", "狡诈", "仁厚", "多疑"
]);

/** 年龄分段（前端 world.html 保持同表） */
const LIFE_AGE_OPTIONS = new Set(["幼童", "少年", "青年", "中年", "老年"]);

function sanitizeNativeAge(age) {
    return LIFE_AGE_OPTIONS.has(String(age || "")) ? String(age) : "";
}

function sanitizeNativeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags.map(String).filter((t) => LIFE_CHAR_TAGS.has(t)))].slice(0, 6);
}

function sanitizeNativeConfig(cfg) {
    const o = (cfg && typeof cfg === "object" && !Array.isArray(cfg)) ? cfg : {};
    const voice = typeof o.voice === "string" ? o.voice.slice(0, 120) : "";
    const rate = Math.min(50, Math.max(-50, parseInt(o.rate, 10) || 0));
    const temperature = Math.min(1.1, Math.max(0.3, parseFloat(o.temperature) || 0.9));
    const max_tokens = Math.min(300, Math.max(60, parseInt(o.max_tokens, 10) || 150));
    const proactivity = ["passive", "balanced", "active"].includes(o.proactivity) ? o.proactivity : "balanced";
    return { voice, rate, temperature, max_tokens, proactivity };
}

function sanitizeBackground(bg) {
    const o = (bg && typeof bg === "object" && !Array.isArray(bg)) ? bg : {};
    return {
        era: String(o.era || "").slice(0, 200),
        place: String(o.place || "").slice(0, 80),
        tone: String(o.tone || "").slice(0, 200),
        rule: String(o.rule || "").slice(0, 600),
        faction: String(o.faction || "").slice(0, 600),
        power: String(o.power || "").slice(0, 600),
        note: String(o.note || "").slice(0, 800),
        bg_image: String(o.bg_image || "").slice(0, 2000),
        locked: !!o.locked
    };
}

function sanitizeLifeSettings(life) {
    const o = (life && typeof life === "object" && !Array.isArray(life)) ? life : {};
    const mode = ["watch", "hybrid", "always"].includes(o.mode) ? o.mode : LIFE_DEFAULTS.mode;
    return {
        mode,
        paused: !!o.paused,
        model: normalizeModelId(o.model),
        tickIntervalSec: Math.min(120, Math.max(15, parseInt(o.tickIntervalSec, 10) || LIFE_DEFAULTS.tickIntervalSec)),
        cronIntervalMin: Math.min(480, Math.max(15, parseInt(o.cronIntervalMin, 10) || LIFE_DEFAULTS.cronIntervalMin)),
        cronIntervalMinAway: Math.min(720, Math.max(30, parseInt(o.cronIntervalMinAway, 10) || LIFE_DEFAULTS.cronIntervalMinAway))
    };
}

function parseWorldJson(row) {
    let wj = {};
    try { wj = JSON.parse(row?.world_json || "{}"); } catch { wj = {}; }
    if (!wj || typeof wj !== "object" || Array.isArray(wj)) wj = {};
    wj.background = sanitizeBackground(wj.background);
    wj.natives = Array.isArray(wj.natives) ? wj.natives : [];
    wj.relations = Array.isArray(wj.relations) ? wj.relations : [];
    wj.scenes = Array.isArray(wj.scenes) ? wj.scenes : [];
    wj.areas = Array.isArray(wj.areas) ? wj.areas : [];
    wj.threadMeta = (wj.threadMeta && typeof wj.threadMeta === "object" && !Array.isArray(wj.threadMeta)) ? wj.threadMeta : {};
    const prevThreadId = String((wj.life && wj.life.currentThreadId) || "");
    wj.life = { ...LIFE_DEFAULTS, ...sanitizeLifeSettings(wj.life) };
    wj.life.lastTickAt = Number(wj.life.lastTickAt) || 0;
    wj.life.ticksToday = Number(wj.life.ticksToday) || 0;
    wj.life.currentThreadId = prevThreadId;
    // 故事状态（Batch 3）：persist world_json.state
    wj.state = (wj.state && typeof wj.state === "object" && !Array.isArray(wj.state)) ? wj.state : {};
    wj.state.story = (wj.state.story && typeof wj.state.story === "object" && !Array.isArray(wj.state.story)) ? wj.state.story : {};
    wj.state.beats = Array.isArray(wj.state.beats) ? wj.state.beats : [];
    wj.state.secrets = Array.isArray(wj.state.secrets) ? wj.state.secrets : [];
    wj.state.plots = Array.isArray(wj.state.plots) ? wj.state.plots : [];
    wj.state.timeline = Array.isArray(wj.state.timeline) ? wj.state.timeline : [];
    wj.state.chapters = Array.isArray(wj.state.chapters) ? wj.state.chapters : [];
    wj.state.lastPulseSeq = Number(wj.state.lastPulseSeq) || 0;
    // World Engine 核心（Batch 4.5）：NPC 目标状态机 + 后果生命周期 + 累计 tick
    wj.state.npcs = (wj.state.npcs && typeof wj.state.npcs === "object" && !Array.isArray(wj.state.npcs)) ? wj.state.npcs : {};
    wj.state.consequences = Array.isArray(wj.state.consequences) ? wj.state.consequences : [];
    wj.state.tickCount = Number(wj.state.tickCount) || 0;
    // World Engine 扩展（Batch 4.6）：知识边界（witness 戳）+ NPC 日程/场景填充（确定性种子）
    wj.state.knowledge = Array.isArray(wj.state.knowledge) ? wj.state.knowledge : [];
    wj.state.seed = String(wj.state.seed || "");
    wj.state.dayIndex = Number(wj.state.dayIndex) || 0;
    wj.state.schedules = (wj.state.schedules && typeof wj.state.schedules === "object" && !Array.isArray(wj.state.schedules)) ? wj.state.schedules : {};
    wj.state.ambient = (wj.state.ambient && typeof wj.state.ambient === "object" && !Array.isArray(wj.state.ambient)) ? wj.state.ambient : {};
    // Companion 层·角色弧光（Batch 7）：世界内情绪，按角色 id 存 { label, intensity, day }
    wj.state.moods = (wj.state.moods && typeof wj.state.moods === "object" && !Array.isArray(wj.state.moods)) ? wj.state.moods : {};
    return wj;
}

async function loadWorldJson(env, worldId) {
    const row = await env.DB.prepare("SELECT world_json FROM worlds WHERE id = ?").bind(worldId).first();
    return parseWorldJson(row);
}

async function saveWorldJson(env, worldId, wj) {
    await env.DB.prepare(
        "UPDATE worlds SET world_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(JSON.stringify(wj), worldId).run();
}

/** 世界全体角色：原住民（wc_）+ 邀请的公共角色（char_） */
async function resolveWorldCast(env, world, wj) {
    const cast = [];
    // 角色弧光：世界内情绪（引擎确定性落账；attach 到 cast 供 prompt/前端读取）
    const moods = (wj.state && wj.state.moods && typeof wj.state.moods === "object" && !Array.isArray(wj.state.moods)) ? wj.state.moods : {};
    (wj.natives || []).forEach((n) => {
        cast.push({
            id: n.id,
            name: n.name || "未名",
            appearance: n.appearance || "",
            personality: n.personality || "",
            background: n.background || "",
            speech_style: n.speech_style || "",
            avatar: n.avatar || "",
            gender: n.gender || "",
            age: n.age || "",
            tags: Array.isArray(n.tags) ? n.tags : [],
            chat_config: (n.chat_config && typeof n.chat_config === "object") ? n.chat_config : {},
            mood: moods[n.id] || null,
            source: "native"
        });
    });

    let castIds = [];
    try { castIds = JSON.parse(world.cast_ids || "[]"); } catch { castIds = []; }
    const ids = castIds.map(String).filter(Boolean).slice(0, 12);
    if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const rows = await env.DB.prepare(
            `SELECT id, name, appearance, personality, background, speech_style, image_url, gender, chat_config
             FROM characters WHERE id IN (${placeholders})`
        ).bind(...ids).all();
        const byId = new Map((rows.results || []).map((r) => [r.id, r]));
        ids.forEach((id) => {
            const r = byId.get(id);
            if (r) {
                let cc = {};
                try { cc = JSON.parse(r.chat_config || "{}"); } catch { cc = {}; }
                cast.push({
                    id: r.id,
                    name: r.name || "未名",
                    appearance: r.appearance || "",
                    personality: r.personality || "",
                    background: r.background || "",
                    speech_style: r.speech_style || "",
                    avatar: r.image_url || "",
                    gender: r.gender || "",
                    age: (cc && cc.age) || "",
                    tags: Array.isArray(cc.tags) ? cc.tags : [],
                    chat_config: cc,
                    mood: moods[r.id] || null,
                    source: "global"
                });
            }
        });
    }
    return cast;
}

async function loadWorldThreads(env, worldId) {
    const result = await env.DB.prepare(
        "SELECT id, world_id, kind, scene_id, title, status, turn, created_at, updated_at FROM world_threads WHERE world_id = ? AND status = 'active' ORDER BY updated_at DESC"
    ).bind(worldId).all();
    return (result.results || []).map(formatThread);
}

function formatThread(t) {
    return {
        id: t.id,
        kind: t.kind,
        scene_id: t.scene_id || "",
        title: t.title || "",
        status: t.status || "active",
        turn: Number(t.turn) || 0,
        created_at: t.created_at,
        updated_at: t.updated_at
    };
}

async function loadThreadMessages(env, threadId, limit) {
    const result = await env.DB.prepare(
        `SELECT id, seq, actor, name, content, created_at
         FROM world_messages
         WHERE thread_id = ?
         ORDER BY seq DESC LIMIT ?`
    ).bind(threadId, limit || 60).all();
    return (result.results || []).reverse();
}

async function appendWorldMessages(env, threadId, items) {
    if (!Array.isArray(items) || !items.length) return [];
    const lastRow = await env.DB.prepare(
        "SELECT COALESCE(MAX(seq), 0) AS m FROM world_messages WHERE thread_id = ?"
    ).bind(threadId).first();
    let seq = Number(lastRow?.m) || 0;

    const inserts = items.map((item) => {
        seq += 1;
        const id = "wm_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        return env.DB.prepare(
            "INSERT INTO world_messages (id, thread_id, seq, actor, name, content, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ).bind(id, threadId, seq, String(item.actor || "narrator"), String(item.name || "").slice(0, 40), String(item.content || "").slice(0, 4000));
    });

    await env.DB.batch(inserts);
    await env.DB.prepare(
        "UPDATE world_threads SET turn = turn + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(inserts.length, threadId).run();

    const res = await env.DB.prepare(
        `SELECT id, seq, actor, name, content, created_at
         FROM world_messages
         WHERE thread_id = ? AND seq > ?
         ORDER BY seq ASC`
    ).bind(threadId, seq - items.length).all();
    return res.results || [];
}

/** 选定线程：优先指定 id，否则当前线程，否则最新活跃线程 */
async function pickLifeThread(env, worldId, wj, threadId) {
    const rows = await env.DB.prepare(
        "SELECT * FROM world_threads WHERE world_id = ? AND status = 'active' ORDER BY updated_at DESC"
    ).bind(worldId).all();
    const list = rows.results || [];
    if (!list.length) return null;

    if (threadId) {
        const hit = list.find((t) => t.id === threadId);
        if (hit) return hit;
    }
    if (wj.life.currentThreadId) {
        const cur = list.find((t) => t.id === wj.life.currentThreadId);
        if (cur) return cur;
    }
    return list[0];
}

/** 线程限定在场角色（场景线程按 scene.present 过滤；多地点世界按当日日程过滤） */
async function activeCastForThread(env, world, wj, thread, cast) {
    const all = cast || await resolveWorldCast(env, world, wj);
    if (thread.kind === "scene" && thread.scene_id) {
        const scene = (wj.scenes || []).find((s) => s.id === thread.scene_id);
        if (scene && Array.isArray(scene.present) && scene.present.length) {
            const filtered = all.filter((c) => scene.present.includes(c.id));
            if (filtered.length) return filtered;
        }
    }
    ensureWorldSchedule(wj, world.id, all);
    const scheduled = applySchedulePresence(wj, all, thread);
    return scheduled && scheduled.length ? scheduled : all;
}

/** 让 1~2 名角色在给定线程里各说一句（共享：chat 回应 / tick / cron） */
async function runWorldTurn({ env, world, wj, thread, cast, recent, speakers, userName, opening, mock }) {
    const scene = (thread.kind === "scene" && thread.scene_id)
        ? (wj.scenes || []).find((s) => s.id === thread.scene_id) || null
        : null;
    const threadCtx = (wj.threadMeta && wj.threadMeta[thread.id]) || null;
    const newMessages = [];
    for (const sp of speakers) {
        const line = await generateWorldLine({
            character: sp,
            world: { name: world.name, background: wj.background, description: world.description, areas: wj.areas, threadCtx },
            scene,
            relations: wj.relations || [],
            recent: [...recent, ...newMessages],
            userName,
            modelId: wj.life.model,
            env,
            mock
        });
        if (line) {
            newMessages.push({ actor: sp.id, name: sp.name, content: line });
        }
    }

    const inserted = await appendWorldMessages(env, thread.id, newMessages);
    // 角色弧光：发言台词 → 世界内情绪落账（chat 回应路径）
    recordWorldMoods(wj, new Map((Array.isArray(cast) ? cast : []).map(c => [c.id, c])),
        newMessages.map(m => ({ id: m.actor, text: m.content })));
    if (inserted.length) {
        const now = Date.now();
        const day = new Date().toISOString().slice(0, 10);
        if (wj.life.tickDay !== day) {
            wj.life.tickDay = day;
            wj.life.ticksToday = 0;
        }
        wj.life.lastTickAt = now;
        wj.life.ticksToday = (wj.life.ticksToday || 0) + 1;
        await saveWorldJson(env, world.id, wj);
    }
    return inserted;
}

/** 把故事状态脉动（updateWorldState 输出）合并进 world_json.state，并让 relations 增量落账 */
function applyStatePulse(wj, pulse) {
    if (!wj.state) wj.state = {};
    const state = wj.state;
    const now = new Date().toISOString();

    // relations：新增 / 升级 / 降级（标 manual 的关系不动）
    (Array.isArray(pulse.relations) ? pulse.relations : []).forEach((r) => {
        if (!r || !r.a || !r.b || r.a === r.b) return;
        const existing = (wj.relations || []).find((x) => (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a));
        if (existing) {
            if (!existing.manual) {
                existing.kind = r.kind || existing.kind;
                existing.bond = Math.max(0, Math.min(100, Number(r.bond) || existing.bond));
                if (r.note) existing.note = r.note;
                existing.updatedAt = now;
            }
        } else {
            wj.relations.push({
                a: r.a, b: r.b, kind: r.kind || "neutral",
                bond: Math.max(0, Math.min(100, Number(r.bond) || 50)),
                note: r.note || "", auto: true, updatedAt: now
            });
        }
    });

    // secrets：埋新秘密 + 揭晓
    state.secrets = Array.isArray(state.secrets) ? state.secrets : [];
    (Array.isArray(pulse.newSecrets) ? pulse.newSecrets : []).forEach((s) => {
        if (!s || !s.desc) return;
        state.secrets.push({
            id: String(s.id || "sec_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8)),
            desc: String(s.desc).slice(0, 200),
            revealed: !!s.revealed,
            createdAt: s.createdAt || now
        });
    });
    (Array.isArray(pulse.reveal) ? pulse.reveal : []).forEach((sid) => {
        const s = state.secrets.find((x) => x.id === sid);
        if (s && !s.revealed) { s.revealed = true; s.revealedAt = now; }
    });
    state.secrets = state.secrets.slice(-100);

    // plots：已有支线沿用原 id
    state.plots = Array.isArray(state.plots) ? state.plots : [];
    (Array.isArray(pulse.plots) ? pulse.plots : []).forEach((p) => {
        if (!p || !p.desc) return;
        const id = String(p.id || "").slice(0, 40);
        const existing = id ? state.plots.find((x) => x.id === id) : null;
        if (existing) {
            existing.desc = String(p.desc || existing.desc).slice(0, 200);
            existing.status = String(p.status || existing.status || "进行中").slice(0, 20);
            if (Array.isArray(p.involved)) existing.involved = p.involved.slice(0, 8);
        } else {
            state.plots.push({
                id: id || ("pl_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8)),
                desc: String(p.desc).slice(0, 200),
                status: String(p.status || "进行中").slice(0, 20),
                involved: Array.isArray(p.involved) ? p.involved.slice(0, 8) : []
            });
        }
    });
    state.plots = state.plots.slice(-50);

    // timeline：只收重大事件
    state.timeline = Array.isArray(state.timeline) ? state.timeline : [];
    (Array.isArray(pulse.timeline) ? pulse.timeline : []).forEach((t) => {
        const text = String(t && t.text ? t.text : t || "").trim().slice(0, 200);
        if (text) state.timeline.push({ at: (t && t.at) || now, text });
    });
    state.timeline = state.timeline.slice(-100);

    // story：主线标题 / 梗概 / 阶段 / 焦点
    if (pulse.story && typeof pulse.story === "object") {
        state.story = {
            title: String(pulse.story.title || (state.story && state.story.title) || "").trim().slice(0, 60),
            logline: String(pulse.story.logline || (state.story && state.story.logline) || "").trim().slice(0, 200),
            phase: STORY_PHASES.includes(pulse.story.phase) ? pulse.story.phase : ((state.story && state.story.phase) || "opening"),
            focus: String(pulse.story.focus || (state.story && state.story.focus) || "").trim().slice(0, 80)
        };
    }

    // chapters：封章
    state.chapters = Array.isArray(state.chapters) ? state.chapters : [];
    (Array.isArray(pulse.chapters) ? pulse.chapters : []).forEach((c) => {
        state.chapters.push({
            id: String(c.id || "ch_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8)),
            title: String(c.title || "").slice(0, 60),
            summary: String(c.summary || "").slice(0, 200),
            fromSeq: Number(c.fromSeq) || 0,
            toSeq: Number(c.toSeq) || 0,
            createdAt: c.createdAt || now
        });
    });
    state.chapters = state.chapters.slice(-20);

    if (Number(pulse.lastPulseSeq) > (Number(state.lastPulseSeq) || 0)) {
        state.lastPulseSeq = Number(pulse.lastPulseSeq);
    }
}

/* =========================================================
 * World Engine 核心（Batch 4.5）：NPC 目标状态机 + 后果生命周期
 * 引擎确定性维护状态，模型只在节拍里「演绎」——不靠模型自觉。
 * ========================================================= */

const NPC_GOAL_STATUSES = ["active", "blocked", "achieved", "abandoned"];

/** 为在场角色兜底初始化目标状态槽 */
function ensureNpcStates(wj, cast) {
    if (!wj.state) wj.state = {};
    if (!wj.state.npcs || typeof wj.state.npcs !== "object" || Array.isArray(wj.state.npcs)) wj.state.npcs = {};
    (Array.isArray(cast) ? cast : []).forEach((c) => {
        if (!c || !c.id) return;
        const ns = wj.state.npcs[c.id] || (wj.state.npcs[c.id] = {});
        if (!ns.goal) ns.goal = "";
        ns.progress = Math.max(0, Math.min(100, Number(ns.progress) || 0));
        if (!NPC_GOAL_STATUSES.includes(ns.status)) ns.status = "active";
    });
    return wj.state.npcs;
}

/** 把节拍声明的 NPC 目标增量落账到状态机（clamp + 白名单） */
function applyBeatNpcUpdates(wj, beat) {
    if (!beat || !Array.isArray(beat.goals) || !beat.goals.length) return;
    if (!wj.state) wj.state = {};
    if (!wj.state.npcs || typeof wj.state.npcs !== "object" || Array.isArray(wj.state.npcs)) wj.state.npcs = {};
    const now = Date.now();
    beat.goals.forEach((g) => {
        if (!g || !g.id) return;
        const ns = wj.state.npcs[g.id] || (wj.state.npcs[g.id] = { goal: "", progress: 0, status: "active" });
        if (g.goal) ns.goal = String(g.goal).slice(0, 80);
        if (g.progress !== undefined && g.progress !== null) ns.progress = Math.max(0, Math.min(100, Number(g.progress) || 0));
        if (g.status && NPC_GOAL_STATUSES.includes(g.status)) ns.status = g.status;
        if (ns.status === "achieved" || ns.status === "abandoned") ns.endedAt = now;
        ns.updatedAt = now;
    });
}

/** 后果生命周期：t=consequence 且带 consequence 声明时，新建或继续发酵 */
function applyBeatConsequence(wj, beat) {
    if (!beat || !beat.consequence || !beat.consequence.title) return;
    if (!wj.state) wj.state = {};
    if (!Array.isArray(wj.state.consequences)) wj.state.consequences = [];
    const title = String(beat.consequence.title).trim().slice(0, 120);
    if (!title) return;
    const severity = Math.max(0, Math.min(100, Number(beat.consequence.severity) || 50));
    const existing = wj.state.consequences.find((cn) => cn.state !== "resolved" && cn.title === title);
    if (existing) {
        existing.severity = severity;
        existing.updatedAt = Date.now();
    } else {
        wj.state.consequences.push({
            id: "cns_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8),
            title,
            severity,
            state: "created",
            turn: Number(wj.state.tickCount) || 0,
            updatedAt: Date.now()
        });
    }
    wj.state.consequences = wj.state.consequences.slice(-30);
}

/** 后果推进（每次 tick 调用）：created→active→escalating/decaying→resolved */
function advanceWorldConsequences(wj) {
    if (!wj.state) return;
    if (!Array.isArray(wj.state.consequences)) wj.state.consequences = [];
    if (!wj.state.consequences.length) return;
    const turn = Number(wj.state.tickCount) || 0;
    wj.state.consequences.forEach((cn) => {
        const age = turn - (Number(cn.turn) || turn);
        if (cn.state === "created") {
            cn.state = "active";
            cn.updatedAt = Date.now();
        } else if (cn.state === "active" && age >= 2) {
            cn.state = Number(cn.severity) >= 50 ? "escalating" : "decaying";
            cn.updatedAt = Date.now();
        } else if (cn.state === "escalating" && age >= 5) {
            cn.state = "resolved";
            cn.updatedAt = Date.now();
        } else if (cn.state === "decaying" && age >= 4) {
            cn.state = "resolved";
            cn.updatedAt = Date.now();
        }
    });
    // 发酵中的后果最多 8 条（按严重度保留），避免失控堆积
    const activeCount = wj.state.consequences.filter((cn) => cn.state !== "resolved").length;
    if (activeCount > 8) {
        const active = wj.state.consequences
            .filter((cn) => cn.state !== "resolved")
            .sort((a, b) => (Number(b.severity) || 0) - (Number(a.severity) || 0))
            .slice(0, 8);
        const resolved = wj.state.consequences.filter((cn) => cn.state === "resolved").slice(-20);
        wj.state.consequences = [...active, ...resolved];
    }
}

/* =========================================================
 * World Engine 扩展（Batch 4.6）：知识边界（witness 戳）+ NPC 日程/场景填充
 * 引擎确定性落账，LLM 只演绎；种子固定 → 同世界 reroll 可复现。
 * ========================================================= */

const SCHEDULE_DAY_TICKS = 8; // 每 8 个 tick 换一个「世界日」，日程随之轮换
const ACTIVITY_POOL = ["采买", "赶路", "议事", "静修", "巡查", "赴约", "小憩", "忙碌"];
const AMBIENT_ROLES = ["客栈掌柜", "跑堂伙计", "摊贩", "巡夜的更夫", "闲聊的老者", "赶路的货郎", "好奇的孩童", "路过的旅人", "打盹的猫", "凑热闹的闲汉"];

/** FNV-1a 字符串哈希（确定性种子，同世界 reroll 可复现） */
function worldHash(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** 当前线程归属的「日程地点」：场景线程=场景名，其余=主线 */
function scheduleLocationFor(wj, thread) {
    if (thread && thread.kind === "scene" && thread.scene_id) {
        const scene = (wj.scenes || []).find((s) => s.id === thread.scene_id);
        if (scene && String(scene.name || "").trim()) return String(scene.name).trim();
    }
    return "主线";
}

/** 生成（或沿用）当前世界日的日程 + 场景填充：确定性、纯引擎落账 */
function ensureWorldSchedule(wj, worldId, cast) {
    if (!wj.state) wj.state = {};
    const dayIndex = Math.floor((Number(wj.state.tickCount) || 0) / SCHEDULE_DAY_TICKS);
    if (!String(wj.state.seed || "").trim()) wj.state.seed = String(worldId || "hyool").slice(0, 40);
    if (wj.state.dayIndex === dayIndex && wj.state.schedules && wj.state.schedules[dayIndex]) return;
    const seed = wj.state.seed;
    wj.state.dayIndex = dayIndex;
    if (!wj.state.schedules || typeof wj.state.schedules !== "object" || Array.isArray(wj.state.schedules)) wj.state.schedules = {};
    if (!wj.state.ambient || typeof wj.state.ambient !== "object" || Array.isArray(wj.state.ambient)) wj.state.ambient = {};
    // 地点池 = 场景名 + 主线；无场景的世界只有「主线」一个地点 → 全员在场（维持现状）
    const sceneNames = [...new Set((wj.scenes || []).map((s) => String(s.name || "").trim()).filter(Boolean))];
    const pool = [...new Set([...sceneNames, "主线"])].sort();
    const today = {};
    (Array.isArray(cast) ? cast : []).forEach((c) => {
        if (!c || !c.id) return;
        const loc = pool[worldHash(`${seed}|${dayIndex}|${c.id}`) % pool.length];
        const activity = ACTIVITY_POOL[worldHash(`${seed}|act|${dayIndex}|${c.id}`) % ACTIVITY_POOL.length];
        today[c.id] = { location: loc, activity };
    });
    wj.state.schedules[dayIndex] = today;
    // 场景填充：每个地点确定性生成 1~2 名背景角色（不发言，只做环境）
    const ambient = {};
    [...new Set(Object.values(today).map((s) => s.location))].forEach((loc) => {
        const count = (worldHash(`${seed}|amb|${dayIndex}|${loc}`) % 2) + 1;
        const roles = [];
        for (let i = 0; i < count; i++) {
            roles.push(AMBIENT_ROLES[worldHash(`${seed}|amb|${dayIndex}|${i}|${loc}`) % AMBIENT_ROLES.length]);
        }
        ambient[loc] = [...new Set(roles)];
    });
    wj.state.ambient[dayIndex] = ambient;
    // 只保留最近 7 个世界日
    Object.keys(wj.state.schedules).forEach((d) => {
        if (Number(d) < dayIndex - 7) {
            delete wj.state.schedules[d];
            delete wj.state.ambient[d];
        }
    });
}

/** 多地点世界：按当日日程限定「此刻在场」；单地点世界返回 null（保持全员在场） */
function applySchedulePresence(wj, cast, thread) {
    const today = wj.state.schedules && wj.state.schedules[wj.state.dayIndex];
    if (!today) return null;
    const loc = scheduleLocationFor(wj, thread);
    const distinct = new Set(Object.values(today).map((s) => s && s.location));
    if (distinct.size < 2) return null;
    const here = (Array.isArray(cast) ? cast : []).filter((c) => today[c.id] && today[c.id].location === loc);
    return here.length ? here : null;
}

/** 节拍落账为知识条目（witness 戳）：事件 + 目击者；同场对话会传播消息 */
function recordBeatKnowledge(wj, beat, cast) {
    if (!wj.state) wj.state = {};
    if (!Array.isArray(wj.state.knowledge)) wj.state.knowledge = [];
    let text = String((beat && beat.narration) || "").trim();
    let secret = false;
    if (Array.isArray(beat && beat.reveal) && beat.reveal.length) {
        const s = (wj.state.secrets || []).find((x) => x.id === beat.reveal[0]);
        if (s && String(s.desc || "").trim()) {
            text = "秘密揭露：" + String(s.desc).trim().slice(0, 120);
            secret = true;
        }
    } else if (!text) {
        // 无旁白：以台词摘录作知识
        const parts = [];
        (Array.isArray(beat && beat.who) ? beat.who : []).forEach((cid, i) => {
            const c = (Array.isArray(cast) ? cast : []).find((x) => x.id === cid);
            const line = (Array.isArray(beat && beat.text) && beat.text[i]) || "";
            if (c && line) parts.push(`${c.name}：${String(line).slice(0, 60)}`);
        });
        text = parts.slice(0, 2).join("｜");
    }
    if (!text) return;
    // 目击者：具体互动=参与角色；纯旁白（无 who）=在场全体（环境性叙事大家共见）
    let witnesses = (Array.isArray(beat && beat.who) ? beat.who : []).map(String).slice(0, 4);
    if (!witnesses.length) {
        witnesses = (Array.isArray(cast) ? cast : []).map((c) => c.id).slice(0, 12);
    }
    // 消息传播：本场有目击者在场，则同场对话者也随之知晓
    const speakers = new Set(witnesses);
    wj.state.knowledge.forEach((entry) => {
        if (!entry || !Array.isArray(entry.seen) || !entry.seen.some((id) => speakers.has(id))) return;
        entry.seen = [...new Set([...entry.seen, ...speakers])].slice(0, 12);
    });
    wj.state.knowledge.push({
        id: "kn_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8),
        text: text.slice(0, 120),
        turn: Number(wj.state.tickCount) || 0,
        seen: witnesses,
        secret: !!secret,
        at: new Date().toISOString()
    });
    // 普通事件最多留 60 条；秘密条目保留（供「已揭露线索」追溯目击者）
    const normal = wj.state.knowledge.filter((k) => !k.secret);
    const keep = new Set(normal.slice(-60).map((k) => k.id));
    wj.state.knowledge = wj.state.knowledge.filter((k) => k.secret || keep.has(k.id)).slice(-120);
}

/**
 * 世界内情绪确定性落账（角色弧光）：
 * - applyWorldMood 用台词中文关键词规则置情绪，按世界日衰减
 * - 显著情绪变化（命中规则、强度≥2、label 变化且非平静）→ 记入 timeline（故事档案素材）
 * 存 world_json.state.moods[id] = { label, intensity, day }
 */
function recordWorldMoods(wj, castById, lines) {
    if (!wj.state) wj.state = {};
    const moods = (wj.state.moods && typeof wj.state.moods === "object" && !Array.isArray(wj.state.moods))
        ? wj.state.moods
        : (wj.state.moods = {});
    const day = Number(wj.state.dayIndex) || 0;
    wj.state.timeline = Array.isArray(wj.state.timeline) ? wj.state.timeline : [];
    let appended = false;
    (Array.isArray(lines) ? lines : []).forEach(({ id, text }) => {
        if (!id || !String(text || "").trim()) return;
        const prev = moods[id] || null;
        const next = applyWorldMood(prev, text, day);
        moods[id] = { label: next.label, intensity: next.intensity, day: next.day };
        const name = (castById && castById.get(id) && castById.get(id).name) || id;
        if (next.changed && next.label !== "平静" && next.intensity >= 2 && (!prev || prev.label !== next.label)) {
            wj.state.timeline.push({ at: new Date().toISOString(), text: `${name}的情绪转为「${next.label}」` });
            appended = true;
        }
    });
    if (appended) wj.state.timeline = wj.state.timeline.slice(-200);
    return appended;
}

/** 把一个故事节拍落为世界消息（旁白 narrator + 在场角色台词），并立即落账 affects/reveal/hide */
async function applyStoryBeat(env, world, wj, thread, cast, beat) {
    const castById = new Map((Array.isArray(cast) ? cast : []).map((c) => [c.id, c]));
    const msgs = [];
    if (beat.narration) msgs.push({ actor: "narrator", name: "旁白", content: String(beat.narration).slice(0, 400) });
    (Array.isArray(beat.who) ? beat.who : []).forEach((cid, i) => {
        const c = castById.get(cid);
        const line = (Array.isArray(beat.text) && beat.text[i]) || "";
        if (c && line) msgs.push({ actor: c.id, name: c.name, content: String(line).slice(0, 400) });
    });

    const inserted = await appendWorldMessages(env, thread.id, msgs);
    if (inserted.length) {
        const now = Date.now();
        const day = new Date().toISOString().slice(0, 10);
        if (wj.life.tickDay !== day) {
            wj.life.tickDay = day;
            wj.life.ticksToday = 0;
        }
        wj.life.lastTickAt = now;
        wj.life.ticksToday = (wj.life.ticksToday || 0) + 1;
    }

    // 节拍立即落账到 world_json.state.beats
    if (!wj.state) wj.state = {};
    wj.state.beats = Array.isArray(wj.state.beats) ? wj.state.beats : [];
    wj.state.beats.push({
        id: "bt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8),
        t: String(beat.t || "dialogue").slice(0, 20),
        who: (Array.isArray(beat.who) ? beat.who : []).slice(0, 2),
        text: (Array.isArray(beat.text) ? beat.text : []).slice(0, 2).map((s) => String(s).slice(0, 400)),
        narration: String(beat.narration || "").slice(0, 400),
        affects: Array.isArray(beat.affects) ? beat.affects.slice(0, 1) : [],
        reveal: Array.isArray(beat.reveal) ? beat.reveal.slice(0, 2) : [],
        hide: Array.isArray(beat.hide) ? beat.hide.slice(0, 2) : [],
        goals: Array.isArray(beat.goals) ? beat.goals.slice(0, 2) : [],
        consequence: beat.consequence || null,
        at: new Date().toISOString()
    });
    wj.state.beats = wj.state.beats.slice(-200);

    // affects → relations 立即落账（不靠模型自觉）
    (Array.isArray(beat.affects) ? beat.affects : []).forEach((r) => {
        if (!r || !r.a || !r.b || r.a === r.b) return;
        const existing = (wj.relations || []).find((x) => (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a));
        if (existing) {
            if (!existing.manual) {
                existing.kind = r.kind || existing.kind;
                existing.bond = Math.max(0, Math.min(100, Number(r.bond) || existing.bond));
                if (r.note) existing.note = r.note;
                existing.updatedAt = Date.now();
            }
        } else {
            wj.relations.push({
                a: r.a, b: r.b, kind: r.kind || "neutral",
                bond: Math.max(0, Math.min(100, Number(r.bond) || 50)),
                note: r.note || "", auto: true, updatedAt: Date.now()
            });
        }
    });

    // NPC 目标状态机 + 后果生命周期：引擎确定性落账（模型只演绎，不靠自觉）
    applyBeatNpcUpdates(wj, beat);
    applyBeatConsequence(wj, beat);

    // reveal → 揭晓秘密；hide → 埋新秘密
    wj.state.secrets = Array.isArray(wj.state.secrets) ? wj.state.secrets : [];
    (Array.isArray(beat.reveal) ? beat.reveal : []).forEach((sid) => {
        const s = wj.state.secrets.find((x) => x.id === sid);
        if (s && !s.revealed) { s.revealed = true; s.revealedAt = new Date().toISOString(); }
    });
    (Array.isArray(beat.hide) ? beat.hide : []).forEach((desc) => {
        wj.state.secrets.push({
            id: "sec_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8),
            desc: String(desc).slice(0, 200),
            revealed: false,
            createdAt: new Date().toISOString()
        });
    });
    wj.state.secrets = wj.state.secrets.slice(-100);

    // 角色弧光：节拍台词 → 世界内情绪落账（确定性规则；显著变化记入 timeline）
    recordWorldMoods(wj, castById, (Array.isArray(beat.who) ? beat.who : []).map((cid, i) => ({
        id: cid,
        text: (Array.isArray(beat.text) && beat.text[i]) || ""
    })));

    return inserted;
}

/** 增量脉动：消化各线程新消息 → updateWorldState → 合并进 world_json.state 并持久化 */
async function maybeRunStatePulse(env, world, wj, mock) {
    if (!wj.state) wj.state = {};
    const state = wj.state;
    const threads = await loadWorldThreads(env, world.id);
    const pulsedSeqs = (state.pulsedSeqs && typeof state.pulsedSeqs === "object" && !Array.isArray(state.pulsedSeqs))
        ? state.pulsedSeqs
        : (state.pulsedSeqs = {});

    const inc = [];
    for (const t of threads) {
        const after = Number(pulsedSeqs[t.id]) || 0;
        const res = await env.DB.prepare(
            "SELECT id, seq, actor, name, content FROM world_messages WHERE thread_id = ? AND seq > ? ORDER BY seq ASC"
        ).bind(t.id, after).all();
        (res.results || []).forEach((m) => inc.push({ threadId: t.id, ...m }));
    }
    if (!inc.length) return;

    // 成本控制：积压不足时不跑脉动
    if (inc.length < 4) return;

    const latestSeq = inc.reduce((mx, m) => Math.max(mx, Number(m.seq) || 0), 0);
    const pulse = await updateWorldState({ world, wj, messages: inc, modelId: wj.life.model, env, mock });
    if (!pulse) return;
    applyStatePulse(wj, pulse);

    // 记住各线程已消化到的 seq（对外只暴露全局 lastPulseSeq）
    for (const m of inc) {
        if (Number(m.seq) > (Number(pulsedSeqs[m.threadId]) || 0)) pulsedSeqs[m.threadId] = Number(m.seq);
    }
    state.lastPulseSeq = latestSeq;
    await saveWorldJson(env, world.id, wj);
}

/** 世界运转核心：tick（在线/cron 共用）。返回 { skipped, reason, messages, beat } */
async function runWorldTickCore(env, world, wj, speakerCount, threadId, userName, mock) {
    const now = Date.now();
    if (now - (Number(wj.life.lastTickAt) || 0) < 10000) {
        return { skipped: true, reason: "cooldown", messages: [] };
    }
    const cast = await resolveWorldCast(env, world, wj);
    if (!cast.length) {
        return { skipped: true, reason: "no-cast", messages: [] };
    }
    const thread = await pickLifeThread(env, world.id, wj, threadId);
    if (!thread) {
        return { skipped: true, reason: "no-thread", messages: [] };
    }
    // 运转的线程记为当前线程
    wj.life.currentThreadId = thread.id;
    ensureWorldSchedule(wj, world.id, cast);
    const activeCast = await activeCastForThread(env, world, wj, thread, cast);
    const offCast = cast.filter((c) => !activeCast.some((a) => a.id === c.id));
    const recent = await loadThreadMessages(env, thread.id, 24);
    // NPC 目标状态机：先兜底在场角色状态槽，节拍才能读到并演绎
    ensureNpcStates(wj, activeCast);

    // 节拍化运转：每个 tick 推进一个故事节拍（旁白 + 1~2 名在场角色），而非“挑人说一句”
    const beat = await generateStoryBeat({
        env, world, wj, thread, cast: activeCast, offCast, recent,
        modelId: wj.life.model, mock
    });
    const messages = await applyStoryBeat(env, world, wj, thread, activeCast, beat);

    // World Engine：累计 tick 推进 + 知识落账（witness 戳）+ 后果生命周期老化（有消息产出才算一 tick）
    if (messages.length) {
        wj.state.tickCount = (Number(wj.state.tickCount) || 0) + 1;
        recordBeatKnowledge(wj, beat, activeCast);
        advanceWorldConsequences(wj);
    }

    // 故事状态增量脉动：消化新消息，推进 world_json.state 并持久化
    await maybeRunStatePulse(env, world, wj, mock);
    await saveWorldJson(env, world.id, wj);

    return { skipped: !messages.length, reason: messages.length ? "" : "no-line", messages, beat };
}

/** 生命世界完整视图（world.html 首次加载用） */
async function formatLifeWorld(env, world) {
    const wj = parseWorldJson(world);
    const cast = await resolveWorldCast(env, world, wj);
    const threads = await loadWorldThreads(env, world.id);
    let thread = threads.find((t) => t.id === wj.life.currentThreadId) || threads[0] || null;
    const messages = thread ? await loadThreadMessages(env, thread.id, 60) : [];
    return {
        success: true,
        world: {
            id: world.id,
            owner_id: world.owner_id,
            name: world.name,
            description: world.description,
            cover_image: world.cover_image,
            status: world.status,
            type: world.type,
            background: wj.background,
            natives: wj.natives,
            relations: wj.relations,
            scenes: wj.scenes,
            areas: wj.areas,
            threadMeta: wj.threadMeta,
            life: wj.life,
            state: wj.state,
            cast,
            threads,
            currentThread: thread,
            messages
        }
    };
}

/** Cron 触发器：24h 后台 / 混合模式的世界按各自间隔自主运转 */
export async function handleWorldCron(env) {
    const result = await env.DB.prepare(
        "SELECT * FROM worlds WHERE type = 'life' ORDER BY updated_at DESC LIMIT 500"
    ).all();
    const now = Date.now();
    let ticked = 0;
    const errors = [];
    for (const world of (result.results || [])) {
        if (ticked >= 20) break; // 单次运行成本上限
        const wj = parseWorldJson(world);
        const life = wj.life;
        if (life.paused) continue;
        if (life.mode !== "always" && life.mode !== "hybrid") continue;
        const intervalMin = life.mode === "always" ? life.cronIntervalMin : life.cronIntervalMinAway;
        if (now - life.lastTickAt < intervalMin * 60000) continue;
        const day = new Date().toISOString().slice(0, 10);
        const ticksToday = (life.tickDay === day ? life.ticksToday : 0);
        if (ticksToday >= 60) continue; // 每日上限，控制成本
        try {
            const owner = await env.DB.prepare("SELECT username FROM profiles WHERE id = ?").bind(world.owner_id).first();
            await runWorldTickCore(env, world, wj, 1, "", owner?.username || "TA");
            ticked += 1;
        } catch (e) {
            errors.push(world.id + ": " + String(e?.message || e));
        }
    }
    return { success: true, ticked, errors };
}

async function ensureConversation(env, characterId, userId) {
    const existing = await env.DB.prepare(
        "SELECT * FROM conversations WHERE character_id = ? AND user_id = ? LIMIT 1"
    ).bind(characterId, userId).first();

    if (existing) {
        return existing;
    }

    const id = "conv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

    await env.DB.prepare(
        "INSERT INTO conversations (id, character_id, user_id, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    ).bind(id, characterId, userId).run();

    return { id, character_id: characterId, user_id: userId };
}

async function getMemories(env, characterId, userId, limit) {
    const result = await env.DB.prepare(
        `SELECT id, content, importance, created_at
         FROM memories
         WHERE character_id = ? AND user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
    ).bind(characterId, userId, limit).all();

    return (result.results || []).reverse();
}

async function generateEmbedding(text, env) {
    try {
        const truncated = String(text || "").slice(0, 500);
        const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
            text: [truncated]
        });
        if (result && result.data && result.data[0]) {
            return result.data[0];
        }
        return null;
    } catch (error) {
        console.error("EMBEDDING ERROR:", error);
        return null;
    }
}

async function searchRelevantMemories(env, characterId, userId, queryText, topK) {
    if (!env.VECTORIZE) return [];

    const embedding = await generateEmbedding(queryText, env);
    if (!embedding) return [];

    try {
        const results = await env.VECTORIZE.query(embedding, {
            topK: topK || 5,
            filter: {
                character_id: characterId,
                user_id: userId
            },
            returnMetadata: "all"
        });

        const matches = results.matches || results.results || [];

        return matches
            .filter(m => m.metadata && m.metadata.content)
            .map(m => ({
                content: m.metadata.content,
                score: m.score || 0
            }));
    } catch (error) {
        console.error("VECTORIZE SEARCH ERROR:", error);
        return [];
    }
}

async function storeConversationVector(env, characterId, userId, userMsg, aiReply, memoryNote) {
    if (!env.VECTORIZE) return;

    const combinedText = `用户：${String(userMsg || "").slice(0, 200)}\n回复：${String(aiReply || "").slice(0, 200)}`;
    const embedding = await generateEmbedding(combinedText, env);
    if (!embedding) return;

    try {
        const vectorId = "vec_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

        await env.VECTORIZE.upsert([{
            id: vectorId,
            values: embedding,
            metadata: {
                character_id: characterId,
                user_id: userId,
                content: String(memoryNote || combinedText).slice(0, 300),
                timestamp: Date.now()
            }
        }]);
    } catch (error) {
        console.error("VECTORIZE STORE ERROR:", error);
    }
}

async function trimMemories(env, characterId, userId, keep) {
    const result = await env.DB.prepare(
        `SELECT id FROM memories
         WHERE character_id = ? AND user_id = ?
         ORDER BY created_at DESC`
    ).bind(characterId, userId).all();

    const rows = result.results || [];

    if (rows.length <= keep) {
        return;
    }

    const toDelete = rows.slice(keep);

    for (const row of toDelete) {
        await env.DB.prepare(
            "DELETE FROM memories WHERE id = ?"
        ).bind(row.id).run();
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return message.includes("no such table") ||
        message.includes("does not exist");
}

/** 解析 stories.data（作品 JSON）。PUT 时 body.data 已是对象，行内 data 是字符串，两种都兼容 */
function parseStoryData(raw) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw;
    }
    try {
        const d = JSON.parse(raw || "{}");
        return (d && typeof d === "object" && !Array.isArray(d)) ? d : {};
    } catch {
        return {};
    }
}

/** 从作品 data 提取封面：第一个含图片的 scene 块 media url（无则空串） */
function extractStoryCover(data) {
    for (const c of (data.chapters || [])) {
        for (const b of (c.blocks || [])) {
            if (b && b.media && b.media.url && b.media.type === "image") {
                return String(b.media.url).trim().slice(0, 2000);
            }
        }
    }
    return "";
}

function buildIdeaFromParams(params) {
    const genderText = { female: "女性", male: "男性" }[params.gender] || "";
    const ageText = { teen: "少年", young: "青年", mature: "成熟", elder: "长者" }[params.age] || "";
    const vibeText = { gentle: "温柔", cool: "冷酷", energetic: "活泼", mysterious: "神秘", elegant: "优雅", wild: "狂野" }[params.vibe] || "";
    const outfitText = { casual: "日常休闲", formal: "正式", fantasy: "奇幻", tech: "科技感", traditional: "传统", gothic: "哥特" }[params.outfit] || "";

    const parts = [genderText, ageText, vibeText, outfitText].filter(Boolean);
    if (parts.length === 0) return "一个独特的数字生命";
    return `一个${parts.join("、")}的角色`;
}

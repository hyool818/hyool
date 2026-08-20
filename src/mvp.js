import {
    generateCharacterFromIdea,
    chatWithCharacter,
    compressHistory,
    generateCharacterImage,
    regenerateCharacterImage,
    buildPortraitSvg,
    generateScriptFromConversation,
    generateNativeCharacter,
    generateWorldLine,
    pickNextSpeakers,
    summarizeWorldGap,
    normalizeModelId
} from "./ai/gateway.js";
import { listModelInfos } from "./ai/models.js";
import { TTS_VOICES } from "./tts.js";

// 所有可用语音 id（创建/保存角色时校验 voice）
const KNOWN_VOICE_IDS = new Set(TTS_VOICES.map(v => v.id));

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

            if (!user) {
                const result = await env.DB.prepare(
                    `SELECT id, name, appearance, personality, story_hook, image_url, share_id, world_name, created_at, updated_at
                     FROM characters
                     WHERE share_id IS NOT NULL AND share_id != ''
                     ORDER BY created_at DESC
                     LIMIT 60`
                ).all();

                return json({
                    success: true,
                    guest: true,
                    characters: (result.results || []).map(formatCharacter)
                });
            }

            const result = await env.DB.prepare(
                `SELECT id, name, appearance, personality, story_hook, image_url, share_id, world_name, created_at, updated_at
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
                        source_conversation, status, share_id, created_at, updated_at
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
                 (id, owner_id, name, description, type, cover_image, script_json, cast_ids, settings, source_conversation, status, share_id, world_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
            ).bind(
                worldId, user.id, name, description, type, coverImage,
                JSON.stringify([]), JSON.stringify(castIds), JSON.stringify(settings),
                String(body.source_conversation || "").trim().slice(0, 60),
                "draft", shareId,
                JSON.stringify(worldJson || {})
            ).run();

            // 生命世界：创建初始「日常」线程并指向它
            if (type === "life" && worldJson) {
                const threadId = "wt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
                await env.DB.prepare(
                    `INSERT INTO world_threads (id, world_id, kind, scene_id, title, status, turn, created_at, updated_at)
                     VALUES (?, ?, 'auto', '', '日常', 'active', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
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

    if (worldDetailMatch && method === "GET") {
        try {
            const user = await getAuthenticatedUser(request);
            const world = await getWorldById(env, worldDetailMatch[1]);
            if (!world) {
                return json({ success: false, error: "世界不存在。" }, 404);
            }
            if (!user || world.owner_id !== user.id) {
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

            await env.DB.prepare(
                "DELETE FROM worlds WHERE id = ?"
            ).bind(world.id).run();

            return json({ success: true });
        } catch (error) {
            console.error("WORLD DELETE ERROR:", error);
            return json({ success: false, error: "删除失败。" }, 500);
        }
    }

    /* ----- LIFE WORLD (生命世界) ----- */

    const lifeMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life$/);
    const lifeNativesMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/natives$/);
    const lifeNativeMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/natives\/(wc_[a-z0-9]+)\/(update|delete)$/);
    const lifeBackgroundMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/background$/);
    const lifeRelationsMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/relations$/);
    const lifeScenesMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/scenes$/);
    const lifeThreadsMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/threads$/);
    const lifeChatMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/chat$/);
    const lifeTickMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/tick$/);
    const lifeMessagesMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/messages$/);
    const lifeSettingsMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/settings$/);
    const lifeSummaryMatch = pathname.match(/^\/api\/worlds\/(world_[a-z0-9_]+)\/life\/summary$/);

    // 校验生命世界归属；返回 { user, world } 或直接返回错误 Response
    async function requireOwnedLifeWorld(id) {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return json({ success: false, error: "请先登录。" }, 401);
        }
        const world = await getWorldById(env, id);
        if (!world) {
            return json({ success: false, error: "世界不存在。" }, 404);
        }
        if (world.owner_id !== user.id) {
            return json({ success: false, error: "无权操作这个世界。" }, 403);
        }
        if (world.type !== "life") {
            return json({ success: false, error: "这个世界不是生命世界。" }, 400);
        }
        return { user, world };
    }

    if (lifeMatch && method === "GET") {
        try {
            const auth = await requireOwnedLifeWorld(lifeMatch[1]);
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
                    speech_style: String(n.speech_style || "").trim().slice(0, 400)
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
            }

            await saveWorldJson(env, auth.world.id, wj);
            return json({ success: true, natives: wj.natives });
        } catch (error) {
            console.error("LIFE NATIVE UPDATE ERROR:", error);
            return json({ success: false, error: "操作失败。" }, 500);
        }
    }

    if (lifeBackgroundMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeBackgroundMatch[1]);
            if (!auth.world) return auth;
            const body = await request.json();
            const wj = await loadWorldJson(env, auth.world.id);
            wj.background = sanitizeBackground(body.background || {});
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

            const castIds = new Set((await resolveWorldCast(env, auth.world, wj)).map((c) => c.id));
            if (!castIds.has(a) || !castIds.has(b)) {
                return json({ success: false, error: "关系双方必须是这个世界里的角色。" }, 400);
            }

            wj.relations = (wj.relations || []).filter((r) =>
                !(r.a === a && r.b === b) && !(r.a === b && r.b === a)
            );
            wj.relations.push({ a, b, kind, note });
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
                opening: String(sc.opening || "").trim().slice(0, 300)
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
            const auth = await requireOwnedLifeWorld(lifeThreadsMatch[1]);
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

    /* __LIFE_P4__ */

    if (lifeChatMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeChatMatch[1]);
            if (!auth.world) return auth;
            const { user, world } = auth;
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

            // 用户发言
            const userMsg = await appendWorldMessages(env, thread.id, [
                { actor: "user", name: user.username, content: message }
            ]);

            // 在场角色回应 1~2 名
            let recent = await loadThreadMessages(env, thread.id, 24);
            const activeCast = await activeCastForThread(env, world, wj, thread);
            const speakers = pickNextSpeakers(activeCast, recent, activeCast.length >= 3 ? 2 : 1);
            const replies = speakers.length
                ? await runWorldTurn({ env, world, wj, thread, cast: activeCast, recent, speakers, userName: user.username, opening: false, mock: body.mock === true })
                : [];

            return json({ success: true, messages: [...userMsg, ...replies] });
        } catch (error) {
            console.error("LIFE CHAT ERROR:", error);
            return json({ success: false, error: "发言失败，请稍后再试。" }, 500);
        }
    }

    if (lifeTickMatch && method === "POST") {
        try {
            const auth = await requireOwnedLifeWorld(lifeTickMatch[1]);
            if (!auth.world) return auth;
            const { user, world } = auth;
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
                user.username,
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
            const auth = await requireOwnedLifeWorld(lifeMessagesMatch[1]);
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
                 ORDER BY created_at DESC
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
                 ORDER BY created_at DESC
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
                 ORDER BY created_at DESC
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

            const aiResult = await chatWithCharacter(
                {
                    character,
                    memories,
                    recentMessages,
                    userMessage: aiUserMessage,
                    intimacy,
                    chatConfig,
                    userName: user.username
                },
                env
            );

            const userMsgId = "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const assistantMsgId = "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const newIntimacy = intimacy + 1;

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
                    "UPDATE characters SET intimacy = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).bind(newIntimacy, characterId)
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
        buddy_url: `/buddy/${row.id}`,
        gender: row.gender || "",
        intimacy: row.intimacy ?? 0,
        chat_config: (() => {
            try { return JSON.parse(row.chat_config || "{}"); } catch { return {}; }
        })(),
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

const LIFE_RELATION_KINDS = new Set(["friend", "rival", "enemy", "family", "lover", "mentor", "neutral"]);

function sanitizeBackground(bg) {
    const o = (bg && typeof bg === "object" && !Array.isArray(bg)) ? bg : {};
    return {
        era: String(o.era || "").slice(0, 80),
        place: String(o.place || "").slice(0, 80),
        tone: String(o.tone || "").slice(0, 120),
        rule: String(o.rule || "").slice(0, 400),
        note: String(o.note || "").slice(0, 800)
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
    wj.life = { ...LIFE_DEFAULTS, ...sanitizeLifeSettings(wj.life) };
    wj.life.lastTickAt = Number(wj.life.lastTickAt) || 0;
    wj.life.ticksToday = Number(wj.life.ticksToday) || 0;
    wj.life.currentThreadId = String(wj.life.currentThreadId || "");
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
    (wj.natives || []).forEach((n) => {
        cast.push({
            id: n.id,
            name: n.name || "未名",
            appearance: n.appearance || "",
            personality: n.personality || "",
            background: n.background || "",
            speech_style: n.speech_style || "",
            avatar: n.avatar || "",
            source: "native"
        });
    });

    let castIds = [];
    try { castIds = JSON.parse(world.cast_ids || "[]"); } catch { castIds = []; }
    const ids = castIds.map(String).filter(Boolean).slice(0, 12);
    if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const rows = await env.DB.prepare(
            `SELECT id, name, appearance, personality, background, speech_style, image_url
             FROM characters WHERE id IN (${placeholders})`
        ).bind(...ids).all();
        const byId = new Map((rows.results || []).map((r) => [r.id, r]));
        ids.forEach((id) => {
            const r = byId.get(id);
            if (r) {
                cast.push({
                    id: r.id,
                    name: r.name || "未名",
                    appearance: r.appearance || "",
                    personality: r.personality || "",
                    background: r.background || "",
                    speech_style: r.speech_style || "",
                    avatar: r.image_url || "",
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

/** 线程限定在场角色（场景线程按 scene.present 过滤） */
async function activeCastForThread(env, world, wj, thread) {
    const cast = await resolveWorldCast(env, world, wj);
    if (thread.kind === "scene" && thread.scene_id) {
        const scene = (wj.scenes || []).find((s) => s.id === thread.scene_id);
        if (scene && Array.isArray(scene.present) && scene.present.length) {
            const filtered = cast.filter((c) => scene.present.includes(c.id));
            if (filtered.length) return filtered;
        }
    }
    return cast;
}

/** 让 1~2 名角色在给定线程里各说一句（共享：chat 回应 / tick / cron） */
async function runWorldTurn({ env, world, wj, thread, cast, recent, speakers, userName, opening, mock }) {
    const scene = (thread.kind === "scene" && thread.scene_id)
        ? (wj.scenes || []).find((s) => s.id === thread.scene_id) || null
        : null;
    const newMessages = [];
    for (const sp of speakers) {
        const line = await generateWorldLine({
            character: sp,
            world: { name: world.name, background: wj.background, description: world.description },
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

/** 世界运转核心：tick（在线/cron 共用）。返回 { skipped, reason, messages } */
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
    const activeCast = await activeCastForThread(env, world, wj, thread);
    const recent = await loadThreadMessages(env, thread.id, 24);
    const speakers = pickNextSpeakers(activeCast, recent, speakerCount || 1);
    if (!speakers.length) {
        return { skipped: true, reason: "no-speaker", messages: [] };
    }
    const opening = !recent.length;
    const inserted = await runWorldTurn({
        env, world, wj, thread, cast: activeCast, recent, speakers,
        userName: userName || "TA", opening, mock
    });
    return { skipped: !inserted.length, reason: inserted.length ? "" : "no-line", messages: inserted };
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
            name: world.name,
            description: world.description,
            cover_image: world.cover_image,
            status: world.status,
            type: world.type,
            background: wj.background,
            natives: wj.natives,
            relations: wj.relations,
            scenes: wj.scenes,
            life: wj.life,
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

function buildIdeaFromParams(params) {
    const genderText = { female: "女性", male: "男性" }[params.gender] || "";
    const ageText = { teen: "少年", young: "青年", mature: "成熟", elder: "长者" }[params.age] || "";
    const vibeText = { gentle: "温柔", cool: "冷酷", energetic: "活泼", mysterious: "神秘", elegant: "优雅", wild: "狂野" }[params.vibe] || "";
    const outfitText = { casual: "日常休闲", formal: "正式", fantasy: "奇幻", tech: "科技感", traditional: "传统", gothic: "哥特" }[params.outfit] || "";

    const parts = [genderText, ageText, vibeText, outfitText].filter(Boolean);
    if (parts.length === 0) return "一个独特的数字生命";
    return `一个${parts.join("、")}的角色`;
}

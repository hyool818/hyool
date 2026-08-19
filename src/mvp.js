import {
    generateCharacterFromIdea,
    chatWithCharacter,
    generateCharacterImage,
    regenerateCharacterImage,
    buildPortraitSvg
} from "./ai/gateway.js";
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
                        const binary = String.fromCharCode.apply(null, binaryData);
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

            const memories = [
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
                    chatConfig
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

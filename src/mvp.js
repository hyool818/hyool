import {
    generateCharacterFromIdea,
    chatWithCharacter,
    generateCharacterImage,
    buildPortraitSvg
} from "./ai/gateway.js";

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

            if (idea.length < 4) {
                return json({
                    success: false,
                    error: "请至少输入一句脑洞描述（4 字以上）。"
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

            const generated = await generateCharacterFromIdea(idea, env);

            const draftCharacter = {
                id: characterId,
                ...generated
            };

            const imageResult = await generateCharacterImage(
                draftCharacter,
                env
            );

            await env.DB.prepare(
                `INSERT INTO characters (
                    id, owner_id, name, appearance, personality, background,
                    speech_style, world_name, world_description, story_hook,
                    source_idea, image_url, share_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
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
                shareId
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
                ai_mode: (env.GEMINI_API_KEY || env.AI_API_KEY) ? "gemini" : "mock",
                image_mode: env.IMAGE_PROVIDER || "mock"
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
                    : "加载失败。"
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
                ai_mode: (env.GEMINI_API_KEY || env.AI_API_KEY) ? "gemini" : "mock"
            });

        } catch (error) {
            console.error("BUDDY MESSAGES ERROR:", error);

            return json({
                success: false,
                error: "加载对话失败。"
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

            if (!userMessage) {
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

            const recentMessages = (recentResult.results || []).reverse();

            const memories = await getMemories(
                env,
                characterId,
                user.id,
                8
            );

            const aiResult = await chatWithCharacter(
                {
                    character,
                    memories,
                    recentMessages,
                    userMessage
                },
                env
            );

            const userMsgId = "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
            const assistantMsgId = "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

            await env.DB.batch([
                env.DB.prepare(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, CURRENT_TIMESTAMP)"
                ).bind(userMsgId, conversation.id, userMessage),
                env.DB.prepare(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, CURRENT_TIMESTAMP)"
                ).bind(assistantMsgId, conversation.id, aiResult.reply),
                env.DB.prepare(
                    "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
                ).bind(conversation.id)
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
                ai_mode: (env.GEMINI_API_KEY || env.AI_API_KEY) ? "gemini" : "mock"
            });

        } catch (error) {
            console.error("BUDDY CHAT ERROR:", error);

            return json({
                success: false,
                error: "对话失败：" + (error.message || "未知错误")
            }, 500);
        }
    }

    /* ----- AI status (for debugging / UI badge) ----- */

    if (pathname === "/api/ai/status" && method === "GET") {
        return json({
            success: true,
            ai_provider: (env.GEMINI_API_KEY || env.AI_API_KEY) ? "gemini" : "mock",
            image_provider: env.IMAGE_PROVIDER || "mock",
            has_api_key: Boolean(env.GEMINI_API_KEY || env.AI_API_KEY),
            create_model: env.AI_CREATE_MODEL || env.AI_CHAT_MODEL || "gemini-flash-latest",
            chat_model: env.AI_CHAT_MODEL || "gemini-flash-latest",
            image_model: env.IMAGE_MODEL || null
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

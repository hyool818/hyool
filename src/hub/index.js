/**
 * HYOOL 中枢 · API 路由层（挂载于 src/index.js）
 *
 *   GET  /api/hub/meta          风格预设 + 音色目录（前端中枢页初始化）
 *   POST /api/hub/plan          { request } → { blueprint, assets, attempts }
 *   POST /api/hub/run           { blueprint, dryRun? } → { report, story, assetMap }
 *   POST /api/hub/live-line     表现层临场一句（不改剧情；失败由前端回退预设）
 *   POST /api/hub/novel-generate  { premise, genre?, chapterCount? } → 小说正文
 *   POST /api/hub/novel-extract   { text, title?, orientation? } → make 镜头作品 JSON
 *
 * 约定与 handleMvpRoutes 一致：helpers 注入 { json, getAuthenticatedUser }；
 * 所有接口需要登录；本模块不直接持有业务表逻辑，全部走 hub 内部模块。
 */
import { planProject } from "./planner.js";
import { runWorkflow, serializeResult } from "./engine.js";
import { deriveAssets, normalizeBlueprint, validateBlueprint, STYLE_PRESETS, IMG_SIZE } from "./blueprint.js";
import { TTS_VOICES } from "../tts.js";
import { chatCompletions } from "../ai/gateway.js";
import { isDeepseekConfigured } from "../ai/models.js";
import { generateNovel, extractNovelToMake, rewriteCaptionPrompts } from "./novel.js";
import { resolveNovelModelRef } from "../ai/models.js";

export async function handleHubRoutes(request, env, pathname, method, helpers) {
    // 只接管 /api/hub/* 子路径（meta/plan/run）；精确路径 /api/hub 是 MVP 的
    // 角色列表接口（handleMvpRoutes 内实现），必须放行，否则 hub.html 数据加载失败。
    if (!pathname.startsWith("/api/hub/")) return null;

    const { json, getAuthenticatedUser } = helpers;
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return json({ success: false, error: "请先登录。", login_url: "/yonder.html" }, 401);
    }

    if (pathname === "/api/hub/meta" && method === "GET") {
        return json({
            success: true,
            styles: Object.values(STYLE_PRESETS).map((s) => ({ id: s.id, label: s.label })),
            voices: TTS_VOICES,
            deepseekConfigured: isDeepseekConfigured(env)
        });
    }

    // 表现层：只生成一句角色台词，禁止改分支/变量；超时或失败由前端用预设
    if (pathname === "/api/hub/live-line" && method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const speaker = String(body.speaker || "角色").slice(0, 40);
            const preset = String(body.preset || "").trim().slice(0, 200);
            const hint = String(body.hint || "").trim().slice(0, 200);
            const state = body.state && typeof body.state === "object" ? body.state : {};
            const stateText = Object.keys(state)
                .slice(0, 16)
                .map((k) => `${k}=${state[k]}`)
                .join(", ");
            if (!preset) {
                return json({ success: false, error: "缺少预设台词。" }, 400);
            }
            const messages = [
                {
                    role: "system",
                    content:
                        "你是视觉小说的演出层。只输出一句角色说的话（不要角色名、不要引号、不要选项、不要旁白舞台指示）。" +
                        "不得改变剧情结果，不得提出新分支，不得编造系统指令。若无法做到，原样改写预设即可。"
                },
                {
                    role: "user",
                    content:
                        `角色：${speaker}\n` +
                        (stateText ? `当前变量：${stateText}\n` : "") +
                        (hint ? `情境：${hint}\n` : "") +
                        `预设台词：${preset}\n` +
                        "请给出更贴合当下的一句（仍可极接近预设）。"
                }
            ];
            const raw = await chatCompletions(env, messages, null, 0.85, 64, 8000);
            let line = String(raw || "")
                .replace(/^[\s"'「『]+/, "")
                .replace(/[\s"'」』]+$/, "")
                .split(/\n/)[0]
                .trim()
                .slice(0, 120);
            if (!line) line = preset;
            return json({ success: true, line, fallback: line === preset });
        } catch (e) {
            console.error("HUB LIVE-LINE ERROR:", e);
            return json({ success: false, error: e.message || "临场台词失败。" }, 500);
        }
    }

    if (pathname === "/api/hub/plan" && method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const userRequest = String(body.request || "").slice(0, 2000);
            if (!userRequest.trim()) {
                return json({ success: false, error: "缺少创作需求。" }, 400);
            }
            const { blueprint, attempts } = await planProject(userRequest, env, body.options || {});
            const assets = deriveAssets(blueprint);
            return json({ success: true, blueprint, assets, attempts });
        } catch (e) {
            console.error("HUB PLAN ERROR:", e);
            return json({ success: false, error: e.message || "规划失败。" }, 500);
        }
    }

    if (pathname === "/api/hub/novel-generate" && method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const result = await generateNovel(body, env);
            return json({ success: true, ...result });
        } catch (e) {
            console.error("HUB NOVEL-GENERATE ERROR:", e);
            return json({ success: false, error: e.message || "小说生成失败。" }, 500);
        }
    }

    if (pathname === "/api/hub/novel-extract" && method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const result = await extractNovelToMake(body, env);
            return json({ success: true, ...result });
        } catch (e) {
            console.error("HUB NOVEL-EXTRACT ERROR:", e);
            return json({ success: false, error: e.message || "剧情提取失败。" }, 500);
        }
    }

    // 单条/批量：字幕 → 中英生图词（禁止照抄）
    if (pathname === "/api/hub/novel-prompt-rewrite" && method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const modelRef = resolveNovelModelRef(env);
            let items = Array.isArray(body.items) ? body.items : null;
            if (!items && body.content) {
                items = [{ id: "0", content: body.content }];
            }
            if (!items || !items.length) {
                return json({ success: false, error: "缺少字幕 content / items。" }, 400);
            }
            const rewritten = await rewriteCaptionPrompts(items, env, modelRef);
            return json({
                success: true,
                provider: modelRef ? "deepseek" : "heuristic",
                items: rewritten,
            });
        } catch (e) {
            console.error("HUB NOVEL-PROMPT-REWRITE ERROR:", e);
            return json({ success: false, error: e.message || "提示词改写失败。" }, 500);
        }
    }

    if (pathname === "/api/hub/run" && method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const bp = normalizeBlueprint(body.blueprint);
            const errors = validateBlueprint(bp);
            if (errors.length) {
                return json({ success: false, error: "蓝图校验失败。", errors: errors.slice(0, 10) }, 400);
            }

            const tasks = buildTasks(bp, user.id);
            if (body.dryRun) {
                return json({
                    success: true,
                    dryRun: true,
                    taskCount: tasks.length,
                    tasks: tasks.map((t) => ({ id: t.id, tool: t.tool, dependsOn: t.dependsOn || [] }))
                });
            }

            const { results } = await runWorkflow(tasks, { env, userId: user.id });
            const report = {};
            results.forEach((res) => {
                report[res.id] = serializeResult(res);
            });

            const storyRes = results.get("story");
            return json({
                success: true,
                report,
                story: storyRes?.status === "ok" && storyRes.result?.story ? storyRes.result.story : null,
                assetCount: results.get("story")?.meta?.assets ?? 0
            });
        } catch (e) {
            console.error("HUB RUN ERROR:", e);
            return json({ success: false, error: e.message || "流水线执行失败。" }, 500);
        }
    }

    return json({ success: false, error: "未知接口。" }, 404);
}

/**
 * 从 Blueprint 派生确定性任务 DAG：
 *   每张图：hub.image 生成 → hub.store 入库
 *   每条配音：hub.tts 合成 → hub.store 入库
 *   全部入库完成后：hub.story 组装 story-editor 作品 JSON
 * 所有生成任务带 cacheKey（prompt+seed / voice+text），可跨请求复用素材。
 */
function buildTasks(bp, userId) {
    const assets = deriveAssets(bp);
    const size = IMG_SIZE[bp.meta.orientation] || IMG_SIZE.landscape;
    const tasks = [];

    assets.images.forEach((img) => {
        tasks.push({
            id: img.id,
            tool: "hub.image",
            input: { prompt: img.prompt, width: size.width, height: size.height, seed: img.seed },
            cacheKey: `img|${img.prompt}|${img.seed}`,
            retries: 2
        });
        tasks.push({
            id: `${img.id}_store`,
            tool: "hub.store",
            dependsOn: [img.id],
            input: { key: `${userId}_${img.id}`, mime: "image/jpeg", sourceDep: img.id },
            cacheKey: null
        });
    });

    assets.voices.forEach((v) => {
        tasks.push({
            id: v.id,
            tool: "hub.tts",
            input: { text: v.text, voice: v.voice },
            cacheKey: `tts|${v.voice}|${v.text}`,
            retries: 2
        });
        tasks.push({
            id: `${v.id}_store`,
            tool: "hub.store",
            dependsOn: [v.id],
            input: { key: `${userId}_${v.id}`, mime: "audio/mpeg", sourceDep: v.id },
            cacheKey: null
        });
    });

    const storeIds = tasks.filter((t) => t.tool === "hub.store").map((t) => t.id);
    tasks.push({
        id: "story",
        tool: "hub.story",
        dependsOn: storeIds,
        input: { blueprint: bp },
        cacheKey: null
    });

    return tasks;
}

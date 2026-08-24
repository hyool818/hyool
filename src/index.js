import { handleMvpRoutes, handleWorldCron } from "./mvp.js";
import { handleTtsRequest, TTS_VOICES } from "./tts.js";
import { handleHubRoutes } from "./hub/index.js";

// 收费/免费作品列自动补列（幂等；正式迁移见 schema/migrate_monetization.sql）
let monetizationEnsured = false;


export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);

        /* =====================================================
           INVITE CODE MANAGEMENT
        ===================================================== */

        if (pathname === "/api/invite-codes" && request.method === "GET") {
            try {
                const user = await getAuthenticatedUser(request, env);
                if (!user) {
                    return json({ success: false, error: "请先登录。" }, 401);
                }

                // Only allow user 333123 to manage invite codes
                if (user.username !== "333123") {
                    return json({ success: false, error: "无权访问。" }, 403);
                }

                const result = await env.DB.prepare(
                    "SELECT * FROM invite_codes ORDER BY created_at DESC"
                ).all();

                return json({
                    success: true,
                    invite_codes: result.results || []
                });
            } catch (error) {
                console.error("GET INVITE CODES ERROR:", error);
                return json({ success: false, error: "获取邀请码失败。" }, 500);
            }
        }

        if (pathname === "/api/invite-codes" && request.method === "POST") {
            try {
                const user = await getAuthenticatedUser(request, env);
                if (!user) {
                    return json({ success: false, error: "请先登录。" }, 401);
                }

                // Only allow user 333123 to generate invite codes
                if (user.username !== "333123") {
                    return json({ success: false, error: "无权生成邀请码。" }, 403);
                }

                const body = await request.json();
                const maxUses = body.max_uses !== undefined ? parseInt(body.max_uses) : null;
                const note = String(body.note || "").slice(0, 200);

                // Generate a random invite code
                const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();

                await env.DB.prepare(
                    `INSERT INTO invite_codes (code, created_by, max_uses, used_count, is_active, note, created_at)
                     VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)`
                ).bind(code, user.id, maxUses, 0, note).run();

                return json({
                    success: true,
                    invite_code: {
                        code: code,
                        max_uses: maxUses,
                        note: note
                    }
                });
            } catch (error) {
                console.error("CREATE INVITE CODE ERROR:", error);
                return json({ success: false, error: "生成邀请码失败。" }, 500);
            }
        }

        if (pathname.startsWith("/api/invite-codes/") && request.method === "DELETE") {
            try {
                const user = await getAuthenticatedUser(request, env);
                if (!user) {
                    return json({ success: false, error: "请先登录。" }, 401);
                }

                // Only allow user 333123 to delete invite codes
                if (user.username !== "333123") {
                    return json({ success: false, error: "无权删除邀请码。" }, 403);
                }

                const code = pathname.split("/").pop();

                await env.DB.prepare(
                    "DELETE FROM invite_codes WHERE code = ?"
                ).bind(code).run();

                return json({ success: true });
            } catch (error) {
                console.error("DELETE INVITE CODE ERROR:", error);
                return json({ success: false, error: "删除邀请码失败。" }, 500);
            }
        }

        if (pathname.startsWith("/api/invite-codes/") && pathname.endsWith("/toggle") && request.method === "POST") {
            try {
                const user = await getAuthenticatedUser(request, env);
                if (!user) {
                    return json({ success: false, error: "请先登录。" }, 401);
                }

                // Only allow user 333123 to toggle invite codes
                if (user.username !== "333123") {
                    return json({ success: false, error: "无权操作邀请码。" }, 403);
                }

                const code = pathname.split("/").slice(-2, -1)[0];

                const current = await env.DB.prepare(
                    "SELECT is_active FROM invite_codes WHERE code = ? LIMIT 1"
                ).bind(code).first();

                if (!current) {
                    return json({ success: false, error: "邀请码不存在。" }, 404);
                }

                await env.DB.prepare(
                    "UPDATE invite_codes SET is_active = ? WHERE code = ?"
                ).bind(current.is_active ? 0 : 1, code).run();

                return json({ success: true });
            } catch (error) {
                console.error("TOGGLE INVITE CODE ERROR:", error);
                return json({ success: false, error: "操作失败。" }, 500);
            }
        }

        /* =====================================================
           REGISTER
        ===================================================== */

        if (pathname === "/api/register" && request.method === "POST") {
            try {
                const body = await request.json();

                const username = String(body.username || "")
                    .trim()
                    .toLowerCase();

                const password = String(body.password || "");

                const displayName = String(body.display_name || "")
                    .trim();

                const inviteCode = String(body.invite_code || "").trim();

                if (!/^[a-z0-9_-]{3,20}$/.test(username)) {
                    return json({
                        success: false,
                        error: "账号格式不正确。"
                    }, 400);
                }

                if (password.length < 8) {
                    return json({
                        success: false,
                        error: "密码至少需要 8 位。"
                    }, 400);
                }

                // Validate invite code
                if (!inviteCode) {
                    return json({
                        success: false,
                        error: "需要邀请码才能注册。"
                    }, 400);
                }

                const inviteRecord = await env.DB.prepare(
                    "SELECT * FROM invite_codes WHERE code = ? AND is_active = 1 LIMIT 1"
                ).bind(inviteCode).first();

                if (!inviteRecord) {
                    return json({
                        success: false,
                        error: "邀请码无效或已过期。"
                    }, 400);
                }

                // Check if invite code has uses left
                if (inviteRecord.max_uses !== null && inviteRecord.used_count >= inviteRecord.max_uses) {
                    return json({
                        success: false,
                        error: "邀请码使用次数已达上限。"
                    }, 400);
                }

                const existing = await env.DB
                    .prepare(
                        "SELECT id, username, password_hash FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (existing) {
                    if (!existing.password_hash) {
                        // Validate invite code for existing users too
                        if (!inviteCode) {
                            return json({
                                success: false,
                                error: "需要邀请码才能完成注册。"
                            }, 400);
                        }

                        const inviteRecord = await env.DB.prepare(
                            "SELECT * FROM invite_codes WHERE code = ? AND is_active = 1 LIMIT 1"
                        ).bind(inviteCode).first();

                        if (!inviteRecord) {
                            return json({
                                success: false,
                                error: "邀请码无效或已过期。"
                            }, 400);
                        }

                        if (inviteRecord.max_uses !== null && inviteRecord.used_count >= inviteRecord.max_uses) {
                            return json({
                                success: false,
                                error: "邀请码使用次数已达上限。"
                            }, 400);
                        }

                        const passwordHash =
                            await hashPassword(password);

                        await env.DB
                            .prepare(
                                "UPDATE profiles SET password_hash = ?, display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?"
                            )
                            .bind(
                                passwordHash,
                                displayName || username,
                                username
                            )
                            .run();

                        await ensureYonderSettings(
                            env,
                            existing.id
                        );

                        // Increment invite code usage
                        await env.DB.prepare(
                            "UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?"
                        ).bind(inviteCode).run();

                        return createLoginResponse(
                            env,
                            existing.id,
                            username
                        );
                    }

                    return json({
                        success: false,
                        error: "这个账号已经存在。"
                    }, 409);
                }

                const userId = crypto.randomUUID();

                const passwordHash =
                    await hashPassword(password);

                await env.DB
                    .prepare(
                        "INSERT INTO profiles (id, username, display_name, bio, theme, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    )
                    .bind(
                        userId,
                        username,
                        displayName || username,
                        "这是我的彼岸。",
                        "dark",
                        passwordHash
                    )
                    .run();

                await ensureYonderSettings(
                    env,
                    userId
                );

                // Increment invite code usage
                await env.DB.prepare(
                    "UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?"
                ).bind(inviteCode).run();

                return createLoginResponse(
                    env,
                    userId,
                    username
                );

            } catch (error) {
                console.error("REGISTER ERROR:", error);

                return json({
                    success: false,
                    error: "注册失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           LOGIN
        ===================================================== */

        if (pathname === "/api/login" && request.method === "POST") {
            try {
                const body = await request.json();

                const username = String(body.username || "")
                    .trim()
                    .toLowerCase();

                const password = String(body.password || "");

                if (!username || !password) {
                    return json({
                        success: false,
                        error: "请输入账号和密码。"
                    }, 400);
                }

                const profile = await env.DB
                    .prepare(
                        "SELECT * FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (!profile) {
                    return json({
                        success: false,
                        error: "账号或密码错误。"
                    }, 401);
                }

                if (!profile.password_hash) {
                    return json({
                        success: false,
                        error: "这个账号尚未完成密码配置。"
                    }, 401);
                }

                const isValid = await verifyPassword(password, profile.password_hash);

                if (!isValid) {
                    return json({
                        success: false,
                        error: "账号或密码错误。"
                    }, 401);
                }

                // Migrate legacy SHA-256 hashes to PBKDF2 on successful login
                if (!profile.password_hash.includes(":")) {
                    const newHash = await hashPassword(password);
                    await env.DB.prepare(
                        "UPDATE profiles SET password_hash = ? WHERE id = ?"
                    ).bind(newHash, profile.id).run();
                }

                await ensureYonderSettings(
                    env,
                    profile.id
                );

                return createLoginResponse(
                    env,
                    profile.id,
                    profile.username
                );

            } catch (error) {
                console.error("LOGIN ERROR:", error);

                return json({
                    success: false,
                    error: "登录失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           CURRENT USER
           /api/me
        ===================================================== */

        if (pathname === "/api/me" && request.method === "GET") {
            try {
                const token = getSessionToken(request);

                if (!token) {
                    return json({
                        authenticated: false
                    });
                }

                const session = await env.DB
                    .prepare(
                        "SELECT * FROM sessions WHERE token = ? LIMIT 1"
                    )
                    .bind(token)
                    .first();

                if (!session) {
                    return json({
                        authenticated: false
                    });
                }

                if (
                    session.expires_at &&
                    new Date(session.expires_at).getTime() <= Date.now()
                ) {
                    await env.DB
                        .prepare(
                            "DELETE FROM sessions WHERE token = ?"
                        )
                        .bind(token)
                        .run();

                    return json({
                        authenticated: false
                    });
                }

                const profile = await env.DB
                    .prepare(
                        "SELECT id, username, display_name, avatar_url, bio, background_url, theme, created_at, updated_at FROM profiles WHERE id = ? LIMIT 1"
                    )
                    .bind(session.user_id)
                    .first();

                if (!profile) {
                    return json({
                        authenticated: false
                    });
                }

                return json({
                    authenticated: true,
                    user: {
                        id: profile.id,
                        username: profile.username,
                        profile: profile
                    }
                });

            } catch (error) {
                console.error("ME ERROR:", error);

                return json({
                    authenticated: false,
                    error: "服务器异常，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           LOGOUT
        ===================================================== */

        if (pathname === "/api/logout" && request.method === "POST") {
            try {
                const token = getSessionToken(request);

                if (token) {
                    await env.DB
                        .prepare(
                            "DELETE FROM sessions WHERE token = ?"
                        )
                        .bind(token)
                        .run();
                }

                return json(
                    {
                        success: true
                    },
                    200,
                    {
                        "Set-Cookie":
                            clearSessionCookie()
                    }
                );

            } catch (error) {
                console.error("LOGOUT ERROR:", error);

                return json({
                    success: false,
                    error: "退出登录失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           PUBLIC PROFILE
           /api/profile/:username
        ===================================================== */

        if (
            pathname.startsWith("/api/profile/") &&
            request.method === "GET" &&
            !pathname.endsWith("/update")
        ) {
            const username =
                pathname
                    .substring("/api/profile/".length)
                    .trim()
                    .toLowerCase();

            if (!username) {
                return json({
                    success: false,
                    error: "缺少用户名。"
                }, 400);
            }

            try {
                const profile = await env.DB
                    .prepare(
                        "SELECT id, username, display_name, avatar_url, bio, background_url, theme, created_at, updated_at FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (!profile) {
                    return json({
                        success: false,
                        error: "彼岸不存在。"
                    }, 404);
                }

                return json({
                    success: true,
                    profile: profile
                });

            } catch (error) {
                console.error("PROFILE ERROR:", error);

                return json({
                    success: false,
                    error: "加载失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           YONDER ALL DATA
           /api/yonder/:username
        ===================================================== */

        if (
            pathname.startsWith("/api/yonder/") &&
            !pathname.endsWith("/posts") &&
            !pathname.endsWith("/settings") &&
            !pathname.endsWith("/verify")
        ) {
            const username =
                pathname
                    .substring("/api/yonder/".length)
                    .trim()
                    .toLowerCase();

            if (!username) {
                return json({
                    success: false,
                    error: "缺少用户名。"
                }, 400);
            }

            try {
                const profile = await env.DB
                    .prepare(
                        "SELECT id, username, display_name, avatar_url, bio, background_url, theme, created_at, updated_at FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (!profile) {
                    return json({
                        success: false,
                        error: "彼岸不存在。"
                    }, 404);
                }

                const settings =
                    await getYonderSettings(
                        env,
                        profile.id
                    );

                const hasPassword =
                    settings.access_password &&
                    settings.access_password.length > 0;

                const visitor =
                    await getAuthenticatedUser(
                        request,
                        env
                    );

                const isOwner =
                    visitor &&
                    visitor.username &&
                    visitor.username.toLowerCase() ===
                        username;

                if (hasPassword && !isOwner) {
                    return json({
                        success: true,
                        requires_password: true
                    });
                }

                const postsResult = await env.DB
                    .prepare(
                        "SELECT * FROM yonder_posts WHERE user_id = ? ORDER BY created_at DESC"
                    )
                    .bind(profile.id)
                    .all();

                const safeSettings = {
                    ...settings
                };
                safeSettings.has_access_password =
                    hasPassword;
                delete safeSettings.access_password;

                const yonderPayload =
                    await buildYonderPayload(
                        env,
                        profile,
                        isOwner,
                        postsResult.results || [],
                        safeSettings
                    );

                return json({
                    success: true,
                    yonder: yonderPayload
                });

            } catch (error) {
                console.error("YONDER DATA ERROR:", error);

                return json({
                    success: false,
                    error: "彼岸加载失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           VERIFY YONDER PASSWORD
           POST /api/yonder/:username/verify
        ===================================================== */

        if (
            pathname.startsWith("/api/yonder/") &&
            pathname.endsWith("/verify") &&
            request.method === "POST"
        ) {
            const username =
                pathname
                    .substring("/api/yonder/".length)
                    .replace(/\/verify$/, "")
                    .trim()
                    .toLowerCase();

            if (!username) {
                return json({
                    success: false,
                    error: "缺少用户名。"
                }, 400);
            }

            try {
                const profile = await env.DB
                    .prepare(
                        "SELECT id, username, display_name, avatar_url, bio, background_url, theme, created_at, updated_at FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (!profile) {
                    return json({
                        success: false,
                        error: "彼岸不存在。"
                    }, 404);
                }

                const settings =
                    await getYonderSettings(
                        env,
                        profile.id
                    );

                const hasPassword =
                    settings.access_password &&
                    settings.access_password.length > 0;

                const body =
                    await request.json();

                if (body.owner_bypass) {
                    const visitor =
                        await getAuthenticatedUser(
                            request,
                            env
                        );

                    const isOwner =
                        visitor &&
                        visitor.username &&
                        visitor.username.toLowerCase() ===
                            username;

                    if (!isOwner) {
                        return json({
                            success: false,
                            error: "无权访问。"
                        }, 403);
                    }
                } else if (hasPassword) {
                    const password = String(
                        body.password || ""
                    );

                    if (!password) {
                        return json({
                            success: false,
                            error: "请输入密码。"
                        }, 400);
                    }

                    const isValid = await verifyPassword(password, settings.access_password);

                    if (!isValid) {
                        return json({
                            success: false,
                            error: "密码错误。"
                        }, 401);
                    }

                    // Migrate legacy SHA-256 hashes to PBKDF2 on successful verification
                    if (!settings.access_password.includes(":")) {
                        const newHash = await hashPassword(password);
                        await env.DB.prepare(
                            "UPDATE yonder_settings SET access_password = ? WHERE user_id = ?"
                        ).bind(newHash, profile.id).run();
                    }
                }

                const postsResult = await env.DB
                    .prepare(
                        "SELECT * FROM yonder_posts WHERE user_id = ? ORDER BY created_at DESC"
                    )
                    .bind(profile.id)
                    .all();

                const safeSettings = {
                    ...settings
                };
                safeSettings.has_access_password =
                    hasPassword;
                delete safeSettings.access_password;

                const yonderPayload =
                    await buildYonderPayload(
                        env,
                        profile,
                        true,
                        postsResult.results || [],
                        safeSettings
                    );

                return json({
                    success: true,
                    yonder: yonderPayload
                });

            } catch (error) {
                console.error(
                    "YONDER VERIFY ERROR:",
                    error
                );

                return json({
                    success: false,
                    error: "验证失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           YONDER POSTS
           /api/yonder/:username/posts
        ===================================================== */

        if (
            pathname.startsWith("/api/yonder/") &&
            pathname.endsWith("/posts")
        ) {
            const username =
                pathname
                    .substring("/api/yonder/".length)
                    .replace(/\/posts$/, "")
                    .trim()
                    .toLowerCase();

            try {
                const profile = await env.DB
                    .prepare(
                        "SELECT id, username FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (!profile) {
                    return json({
                        success: false,
                        error: "彼岸不存在。"
                    }, 404);
                }

                const result = await env.DB
                    .prepare(
                        "SELECT * FROM yonder_posts WHERE user_id = ? ORDER BY created_at DESC"
                    )
                    .bind(profile.id)
                    .all();

                return json({
                    success: true,
                    username: username,
                    posts: result.results || []
                });

            } catch (error) {
                console.error("YONDER POSTS ERROR:", error);

                return json({
                    success: false,
                    error: "内容加载失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           GET YONDER SETTINGS
           /api/yonder/:username/settings
        ===================================================== */

        if (
            pathname.startsWith("/api/yonder/") &&
            pathname.endsWith("/settings") &&
            request.method === "GET"
        ) {
            const username =
                pathname
                    .substring("/api/yonder/".length)
                    .replace(/\/settings$/, "")
                    .trim()
                    .toLowerCase();

            try {
                const profile = await env.DB
                    .prepare(
                        "SELECT id, username FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (!profile) {
                    return json({
                        success: false,
                        error: "彼岸不存在。"
                    }, 404);
                }

                const settings =
                    await getYonderSettings(
                        env,
                        profile.id
                    );

                const safeGetSettings = {
                    ...settings
                };
                safeGetSettings.has_access_password =
                    Boolean(
                        safeGetSettings.access_password &&
                        safeGetSettings.access_password.length > 0
                    );
                delete safeGetSettings.access_password;

                return json({
                    success: true,
                    username: username,
                    settings: safeGetSettings
                });

            } catch (error) {
                console.error("YONDER SETTINGS GET ERROR:", error);

                return json({
                    success: false,
                    error: "主页设置加载失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           SAVE YONDER SETTINGS
           POST /api/yonder/settings
        ===================================================== */

        if (
            pathname === "/api/yonder/settings" &&
            request.method === "POST"
        ) {
            try {
                const user =
                    await getAuthenticatedUser(
                        request,
                        env
                    );

                if (!user) {
                    return json({
                        success: false,
                        error: "请先登录。"
                    }, 401);
                }

                const body = await request.json();

                const backgroundType =
                    cleanSettingValue(
                        body.background_type,
                        "gradient",
                        30
                    );

                const backgroundValue =
                    cleanSettingValue(
                        body.background_value,
                        "",
                        900000
                    );

                const backgroundRegion =
                    cleanSettingValue(
                        body.background_region,
                        "",
                        500
                    );

                const accentColor =
                    cleanSettingValue(
                        body.accent_color,
                        "#8b8bff",
                        30
                    );

                const layout =
                    cleanSettingValue(
                        body.layout,
                        "default",
                        30
                    );

                const showProfile =
                    body.show_profile ? 1 : 0;

                const showPosts =
                    body.show_posts ? 1 : 0;

                const showWorks =
                    body.show_works ? 1 : 0;

                const showInfinite =
                    body.show_infinite ? 1 : 0;

                const customCss =
                    cleanSettingValue(
                        body.custom_css,
                        "",
                        20000
                    );

                // 自定义模块区：[{ id, name, content }]，最多 20 个
                const modules =
                    Array.isArray(body.modules)
                        ? body.modules
                            .slice(0, 20)
                            .map(m => ({
                                id: String((m && m.id) || crypto.randomUUID().replace(/-/g, "").slice(0, 8)),
                                name: String((m && m.name) || "").trim().slice(0, 40),
                                content: String((m && m.content) || "").slice(0, 5000)
                            }))
                        : null;

                const currentSettings =
                    await getYonderSettings(
                        env,
                        user.id
                    );

                let accessPassword =
                    currentSettings.access_password ||
                    "";

                if (
                    body.access_password ===
                    "__clear__"
                ) {
                    accessPassword = "";
                } else if (
                    body.access_password &&
                    typeof body.access_password ===
                        "string" &&
                    body.access_password.length >= 1
                ) {
                    accessPassword =
                        await hashPassword(
                            body.access_password
                        );
                }

                // 兼容旧库：background_region 列不存在时自动补充
                await env.DB
                    .prepare(
                        "ALTER TABLE yonder_settings ADD COLUMN background_region TEXT DEFAULT ''"
                    )
                    .run()
                    .catch(() => {});

                // 兼容旧库：modules 列不存在时自动补充
                await env.DB
                    .prepare(
                        "ALTER TABLE yonder_settings ADD COLUMN modules TEXT DEFAULT '[]'"
                    )
                    .run()
                    .catch(() => {});

                await env.DB
                    .prepare(
                        `INSERT INTO yonder_settings
                        (
                            user_id,
                            background_type,
                            background_value,
                            background_region,
                            accent_color,
                            layout,
                            show_profile,
                            show_posts,
                            show_works,
                            show_infinite,
                            custom_css,
                            modules,
                            access_password,
                            created_at,
                            updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT(user_id)
                        DO UPDATE SET
                            background_type = excluded.background_type,
                            background_value = excluded.background_value,
                            background_region = excluded.background_region,
                            accent_color = excluded.accent_color,
                            layout = excluded.layout,
                            show_profile = excluded.show_profile,
                            show_posts = excluded.show_posts,
                            show_works = excluded.show_works,
                            show_infinite = excluded.show_infinite,
                            custom_css = excluded.custom_css,
                            modules = excluded.modules,
                            access_password = excluded.access_password,
                            updated_at = CURRENT_TIMESTAMP`
                    )
                    .bind(
                        user.id,
                        backgroundType,
                        backgroundValue,
                        backgroundRegion,
                        accentColor,
                        layout,
                        showProfile,
                        showPosts,
                        showWorks,
                        showInfinite,
                        customCss,
                        modules === null ? "[]" : JSON.stringify(modules),
                        accessPassword
                    )
                    .run();

                const settings =
                    await getYonderSettings(
                        env,
                        user.id
                    );

                const safeSettings = {
                    ...settings
                };
                safeSettings.has_access_password =
                    Boolean(
                        safeSettings.access_password &&
                        safeSettings.access_password.length > 0
                    );
                delete safeSettings.access_password;

                return json({
                    success: true,
                    settings: safeSettings
                });

            } catch (error) {
                console.error("YONDER SETTINGS SAVE ERROR:", error);

                return json({
                    success: false,
                    error: "主页设置保存失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           UPDATE PROFILE
           POST /api/profile/update
        ===================================================== */

        if (
            pathname === "/api/profile/update" &&
            request.method === "POST"
        ) {
            try {
                const user =
                    await getAuthenticatedUser(
                        request,
                        env
                    );

                if (!user) {
                    return json({
                        success: false,
                        error: "请先登录。"
                    }, 401);
                }

                const body = await request.json();

                const displayName =
                    cleanSettingValue(
                        body.display_name,
                        "",
                        30
                    );

                const avatarUrl =
                    cleanSettingValue(
                        body.avatar_url,
                        "",
                        200000
                    );

                const bio =
                    cleanSettingValue(
                        body.bio,
                        "",
                        200
                    );

                await env.DB
                    .prepare(
                        `UPDATE profiles
                         SET display_name = ?,
                             avatar_url = ?,
                             bio = ?,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`
                    )
                    .bind(
                        displayName,
                        avatarUrl,
                        bio,
                        user.id
                    )
                    .run();

                const updatedProfile =
                    await env.DB
                        .prepare(
                            `SELECT id, username, display_name, avatar_url, bio, background_url, theme
                             FROM profiles WHERE id = ? LIMIT 1`
                        )
                        .bind(user.id)
                        .first();

                return json({
                    success: true,
                    profile: updatedProfile
                });

            } catch (error) {
                console.error("PROFILE UPDATE ERROR:", error);
                return json({
                    success: false,
                    error: "资料更新失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           UPLOAD FILE (chunked D1 storage)
           POST /api/upload
        ===================================================== */

        if (
            pathname === "/api/upload" &&
            request.method === "POST"
        ) {
            try {
                const user =
                    await getAuthenticatedUser(
                        request,
                        env
                    );

                if (!user) {
                    return json({
                        success: false,
                        error: "请先登录。"
                    }, 401);
                }

                const uploadAllowed = await checkRateLimit(
                    request,
                    env,
                    "upload",
                    10,
                    60
                );

                if (!uploadAllowed) {
                    return json({
                        success: false,
                        error: "上传过于频繁，请稍后再试。"
                    }, 429);
                }

                const formData =
                    await request.formData();

                const file =
                    formData.get("file");

                if (!file || !file.size) {
                    return json({
                        success: false,
                        error: "未选择文件。"
                    }, 400);
                }

                if (file.size > 5 * 1024 * 1024) {
                    return json({
                        success: false,
                        error: "文件过大（限 5MB 以内）。"
                    }, 400);
                }

                const allowedTypes = [
                    "image/jpeg",
                    "image/png",
                    "image/gif",
                    "image/webp",
                    "image/svg+xml",
                    "video/mp4",
                    "video/webm",
                    "audio/mpeg",
                    "audio/wav",
                    "audio/mp4",
                    "audio/x-m4a",
                    "audio/ogg"
                ];

                if (!allowedTypes.includes(file.type)) {
                    return json({
                        success: false,
                        error: "仅支持图片（JPG/PNG/GIF/WebP/SVG）、视频（MP4/WebM）与配音（MP3/WAV/M4A/OGG）。"
                    }, 400);
                }

                const arrayBuffer =
                    await file.arrayBuffer();

                const bytes =
                    new Uint8Array(arrayBuffer);

                // base64 转换必须分块：String.fromCharCode.apply 传参过多会栈溢出（RangeError），
                // 导致稍大的图片（> 几十 KB）上传必失败。分块拼接可安全处理 5MB 上限内的任意文件。
                let binaryStr = "";
                for (let i = 0; i < bytes.length; i += 32768) {
                    binaryStr += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
                }
                const base64 = btoa(binaryStr);

                const imageId =
                    "img_" +
                    crypto
                        .randomUUID()
                        .replace(/-/g, "")
                        .slice(0, 16);

                const chunkLen = 400000;
                const chunkCount = Math.ceil(
                    base64.length / chunkLen
                );

                await env.DB.prepare(
                    "INSERT INTO images (id, content_type, total_size, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)"
                )
                    .bind(imageId, file.type, file.size)
                    .run();

                for (let i = 0; i < chunkCount; i++) {
                    const chunkData = base64.substring(
                        i * chunkLen,
                        (i + 1) * chunkLen
                    );
                    await env.DB.prepare(
                        "INSERT INTO image_chunks (image_id, chunk_index, data) VALUES (?, ?, ?)"
                    )
                        .bind(imageId, i, chunkData)
                        .run();
                }

                const imgUrl = `/img/${imageId}`;

                return json({
                    success: true,
                    url: imgUrl,
                    size: file.size,
                    type: file.type
                });

            } catch (error) {
                console.error("UPLOAD ERROR:", error);
                return json({
                    success: false,
                    error: "上传失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           SERVE IMAGE
           GET /img/:id
        ===================================================== */

        const imgMatch = pathname.match(
            /^\/img\/(img_[a-z0-9]+)$/
        );

        if (imgMatch && request.method === "GET") {
            try {

                const allowed = await checkRateLimit(
                    request,
                    env,
                    "img",
                    60,
                    60
                );

                if (!allowed) {
                    return new Response(
                        "Too many requests",
                        {
                            status: 429,
                            headers: {
                                "Content-Type": "text/plain",
                                "Retry-After": "60"
                            }
                        }
                    );
                }
                const imageId = imgMatch[1];

                const imageMeta = await env.DB
                    .prepare(
                        "SELECT content_type, total_size FROM images WHERE id = ? LIMIT 1"
                    )
                    .bind(imageId)
                    .first();

                if (!imageMeta) {
                    return new Response("Not found", {
                        status: 404,
                        headers: { "Content-Type": "text/plain" }
                    });
                }

                const chunksResult = await env.DB
                    .prepare(
                        "SELECT data FROM image_chunks WHERE image_id = ? ORDER BY chunk_index ASC"
                    )
                    .bind(imageId)
                    .all();

                const base64Data = (chunksResult.results || [])
                    .map(r => r.data)
                    .join("");

                const binaryString = atob(base64Data);
                const uint8 = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    uint8[i] = binaryString.charCodeAt(i);
                }

                // 支持 Range 请求（视频播放/拖动进度必需），图片请求不受影响
                const rangeHeader = request.headers.get("Range") || "";
                const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
                if (rangeMatch) {
                    const total = uint8.length;
                    let start = rangeMatch[1] !== "" ? parseInt(rangeMatch[1], 10) : 0;
                    let end = rangeMatch[2] !== "" ? parseInt(rangeMatch[2], 10) : total - 1;
                    if (!(start >= 0) || isNaN(end)) { start = 0; end = total - 1; }
                    if (end >= total) end = total - 1;
                    if (start > end || start >= total) {
                        return new Response(null, {
                            status: 416,
                            headers: {
                                "Content-Type": imageMeta.content_type,
                                "Content-Range": `bytes */${total}`
                            }
                        });
                    }
                    const slice = uint8.slice(start, end + 1);
                    return new Response(slice, {
                        status: 206,
                        headers: {
                            "Content-Type": imageMeta.content_type,
                            "Content-Range": `bytes ${start}-${end}/${total}`,
                            "Accept-Ranges": "bytes",
                            "Content-Length": String(slice.length),
                            "Cache-Control": "public, max-age=86400"
                        }
                    });
                }

                return new Response(uint8.buffer, {
                    status: 200,
                    headers: {
                        "Content-Type": imageMeta.content_type,
                        "Accept-Ranges": "bytes",
                        "Cache-Control": "public, max-age=86400"
                    }
                });

            } catch (error) {
                return new Response("Image error", {
                    status: 500,
                    headers: { "Content-Type": "text/plain" }
                });
            }
        }


        /* =====================================================
           PERSONAL YONDER
           /@333123
        ===================================================== */

        if (
            pathname.startsWith("/@") &&
            pathname.length > 2
        ) {
            const username =
                pathname
                    .substring(2)
                    .trim()
                    .toLowerCase();

            try {
                const profile =
                    await env.DB
                        .prepare(
                            "SELECT id, username FROM profiles WHERE username = ? LIMIT 1"
                        )
                        .bind(username)
                        .first();

                if (!profile) {
                    return new Response(
                        "这个彼岸不存在",
                        {
                            status: 404,
                            headers: {
                                "Content-Type":
                                    "text/plain; charset=UTF-8"
                            }
                        }
                    );
                }

                const homeUrl =
                    new URL(
                        "/yonder-home.html",
                        request.url
                    );

                const assetRequest =
                    new Request(
                        homeUrl,
                        {
                            method: "GET",
                            headers: request.headers
                        }
                    );

                return await env.ASSETS.fetch(
                    assetRequest
                );

            } catch (error) {
                console.error("YONDER ERROR:", error);

                return json({
                    success: false,
                    error: "彼岸加载失败，请稍后再试。"
                }, 500);
            }
        }


        /* =====================================================
           TTS: EDGE 语音合成（微软 Edge 在线 TTS 代理）
        ===================================================== */

        if (pathname === "/api/tts" && (request.method === "POST" || request.method === "GET")) {
            try {
                const user = await getAuthenticatedUser(request, env);
                if (!user) {
                    return json({ success: false, error: "请先登录。", login_url: "/yonder.html" }, 401);
                }

                const allowed = await checkRateLimit(request, env, "tts", 20, 60);
                if (!allowed) {
                    return json({ success: false, error: "语音合成请求过于频繁，请稍后再试。" }, 429);
                }

                return await handleTtsRequest(request, env, user);
            } catch (error) {
                console.error("TTS ERROR:", error);
                return json({ success: false, error: "语音合成失败，请稍后再试。" }, 500);
            }
        }

        if (pathname === "/api/tts/voices" && request.method === "GET") {
            try {
                const user = await getAuthenticatedUser(request, env);
                if (!user) {
                    return json({ success: false, error: "请先登录。", login_url: "/yonder.html" }, 401);
                }
                return json({ success: true, voices: TTS_VOICES });
            } catch (error) {
                console.error("TTS VOICES ERROR:", error);
                return json({ success: false, error: "获取语音列表失败。" }, 500);
            }
        }


        /* =====================================================
           HYOOL 中枢（AI 大脑）：plan / run / meta
        ===================================================== */

        const hubResponse = await handleHubRoutes(
            request,
            env,
            pathname,
            request.method,
            {
                json,
                getAuthenticatedUser: (req) =>
                    getAuthenticatedUser(req, env)
            }
        );

        if (hubResponse) {
            return hubResponse;
        }


        /* =====================================================
           MVP: CREATE / BUDDY / HUB / SHARE
        ===================================================== */

        const mvpResponse = await handleMvpRoutes(
            request,
            env,
            pathname,
            request.method,
            {
                json,
                getAuthenticatedUser: (req) =>
                    getAuthenticatedUser(req, env),
                serveHtml: async (filename) => {
                    const assetUrl = new URL(
                        "/" + filename,
                        request.url
                    );

                    return env.ASSETS.fetch(
                        new Request(assetUrl, {
                            method: "GET",
                            headers: request.headers
                        })
                    );
                }
            }
        );

        if (mvpResponse) {
            return mvpResponse;
        }


        /* =====================================================
           STATIC FILES
        ===================================================== */

        return env.ASSETS.fetch(request);
    },

    /** 生命世界 24h 后台 / 混合模式自主运转（每 15 分钟触发一次，按各世界冷却间隔收敛） */
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleWorldCron(env));
    }
};


/* =========================================================
   AUTHENTICATED USER
========================================================= */

async function getAuthenticatedUser(
    request,
    env
) {
    const token =
        getSessionToken(request);

    if (!token) {
        return null;
    }

    const session =
        await env.DB
            .prepare(
                "SELECT * FROM sessions WHERE token = ? LIMIT 1"
            )
            .bind(token)
            .first();

    if (!session) {
        return null;
    }

    if (
        session.expires_at &&
        new Date(session.expires_at).getTime() <= Date.now()
    ) {
        await env.DB
            .prepare(
                "DELETE FROM sessions WHERE token = ?"
            )
            .bind(token)
            .run();

        return null;
    }

    // 游客身份已废弃（零数据浏览）：历史 guest_ 会话一律视为未登录
    if (session.username && String(session.username).indexOf("guest_") === 0) {
        return null;
    }

    return {
        id: session.user_id,
        username: session.username
    };
}


/* =========================================================
   ENSURE YONDER SETTINGS
========================================================= */

async function ensureYonderSettings(
    env,
    userId
) {
    await env.DB
        .prepare(
            `INSERT OR IGNORE INTO yonder_settings
            (
                user_id,
                background_type,
                background_value,
                accent_color,
                layout,
                show_profile,
                show_posts,
                show_works,
                show_infinite,
                custom_css,
                access_password,
                created_at,
                updated_at
            )
            VALUES (?, 'gradient', '', '#8b8bff', 'default', 1, 1, 1, 1, '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .bind(userId)
        .run();
}


/* =========================================================
   GET YONDER SETTINGS
========================================================= */

async function getYonderSettings(
    env,
    userId
) {
    await ensureYonderSettings(
        env,
        userId
    );

    const row = await env.DB
        .prepare(
            "SELECT * FROM yonder_settings WHERE user_id = ? LIMIT 1"
        )
        .bind(userId)
        .first();

    if (!row) {
        return null;
    }

    // 归一化：modules 以 JSON 数组形态返回（旧库可能无该列 → 空数组）
    row.modules = (() => {
        try {
            const arr = JSON.parse(row.modules || "[]");
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    })();

    return row;
}


/* =========================================================
   BUILD YONDER PAYLOAD（资料 + 设置 + 作品）
   isOwner=true 返回全部作品；访客只返回公开作品
   （角色：share_id 非空；世界：status='published'）
========================================================= */

async function buildYonderPayload(
    env,
    profile,
    isOwner,
    posts,
    safeSettings
) {
    // 收费/免费作品列自动补列（幂等；正式迁移见 schema/migrate_monetization.sql）
    try {
        if (!monetizationEnsured) {
            await env.DB.prepare("ALTER TABLE characters ADD COLUMN pricing TEXT DEFAULT 'free'").run().catch(() => {});
            await env.DB.prepare("ALTER TABLE characters ADD COLUMN price INTEGER DEFAULT 0").run().catch(() => {});
            await env.DB.prepare("ALTER TABLE worlds ADD COLUMN pricing TEXT DEFAULT 'free'").run().catch(() => {});
            await env.DB.prepare("ALTER TABLE worlds ADD COLUMN price INTEGER DEFAULT 0").run().catch(() => {});
            monetizationEnsured = true;
        }
    } catch { /* 忽略 */ }

    const works = {
        characters: [],
        worlds: []
    };

    const charSql =
        isOwner
            ? "SELECT id, name, image_url, world_name, share_id, pricing, price, created_at FROM characters WHERE owner_id = ? ORDER BY created_at DESC"
            : "SELECT id, name, image_url, world_name, share_id, pricing, price, created_at FROM characters WHERE owner_id = ? AND share_id IS NOT NULL AND share_id != '' ORDER BY created_at DESC";

    const charResult = await env.DB
        .prepare(charSql)
        .bind(profile.id)
        .all();

    works.characters = (charResult.results || []).map(c => ({
        id: c.id,
        name: c.name,
        image_url: c.image_url,
        world_name: c.world_name,
        share_id: c.share_id,
        pricing: c.pricing || "free",
        price: Number(c.price) || 0,
        created_at: c.created_at
    }));

    const worldSql =
        isOwner
            ? "SELECT id, name, description, type, cover_image, settings, status, share_id, pricing, price, created_at FROM worlds WHERE owner_id = ? ORDER BY created_at DESC"
            : "SELECT id, name, description, type, cover_image, settings, status, share_id, pricing, price, created_at FROM worlds WHERE owner_id = ? AND share_id IS NOT NULL AND share_id != '' ORDER BY created_at DESC";

    const worldResult = await env.DB
        .prepare(worldSql)
        .bind(profile.id)
        .all();

    works.worlds = (worldResult.results || []).map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        type: w.type,
        cover_image: w.cover_image,
        status: w.status,
        share_id: w.share_id,
        pricing: w.pricing || "free",
        price: Number(w.price) || 0,
        settings: (() => {
            try { return JSON.parse(w.settings || "{}"); } catch { return {}; }
        })(),
        created_at: w.created_at
    }));

    // 故事作品（作品编辑器产物）：主页显示 = share_id 非空；广场发布 = status='published'
    const storySql =
        isOwner
            ? "SELECT id, title, cover_image, status, share_id, created_at FROM stories WHERE owner_id = ? ORDER BY created_at DESC"
            : "SELECT id, title, cover_image, status, share_id, created_at FROM stories WHERE owner_id = ? AND share_id IS NOT NULL AND share_id != '' ORDER BY created_at DESC";

    const storyResult = await env.DB
        .prepare(storySql)
        .bind(profile.id)
        .all();

    works.stories = (storyResult.results || []).map(s => ({
        id: s.id,
        title: s.title,
        cover_image: s.cover_image,
        status: s.status,
        share_id: s.share_id,
        created_at: s.created_at
    }));

    return {
        profile: profile,
        settings: safeSettings,
        posts: posts,
        works: works
    };
}


/* =========================================================
   CREATE LOGIN SESSION
========================================================= */

async function createLoginResponse(
    env,
    userId,
    username
) {
    const token =
        crypto.randomUUID() +
        "-" +
        crypto.randomUUID();

    const expiresAt =
        new Date(
            Date.now() +
            30 * 24 * 60 * 60 * 1000
        ).toISOString();

    await env.DB
        .prepare(
            "INSERT INTO sessions (token, user_id, username, expires_at) VALUES (?, ?, ?, ?)"
        )
        .bind(
            token,
            userId,
            username,
            expiresAt
        )
        .run();

    const profile =
        await env.DB
            .prepare(
                "SELECT id, username, display_name, avatar_url, bio, background_url, theme, created_at, updated_at FROM profiles WHERE id = ? LIMIT 1"
            )
            .bind(userId)
            .first();

    return json(
        {
            success: true,
            token: token,
            user: {
                id: userId,
                username: username,
                profile: profile || {}
            }
        },
        200,
        {
            "Set-Cookie":
                createSessionCookie(token)
        }
    );
}


/* =========================================================
   PASSWORD HASH (PBKDF2)
========================================================= */

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    
    // Generate a random salt
    const salt = crypto.getRandomValues(new Uint8Array(16));
    
    // Derive key using PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        passwordData,
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    
    const derivedKey = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
    
    const rawKey = await crypto.subtle.exportKey("raw", derivedKey);
    const hashArray = Array.from(new Uint8Array(rawKey));
    const saltArray = Array.from(salt);
    
    // Combine salt and hash for storage
    const saltHex = saltArray.map(b => b.toString(16).padStart(2, "0")).join("");
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    
    return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password, storedHash) {
    try {
        // Check if this is a legacy SHA-256 hash (no salt separator)
        if (!storedHash.includes(":")) {
            // Legacy SHA-256 hash - verify with old method
            const data = new TextEncoder().encode(password);
            const hash = await crypto.subtle.digest("SHA-256", data);
            const legacyHash = Array.from(new Uint8Array(hash))
                .map(byte => byte.toString(16).padStart(2, "0"))
                .join("");
            return legacyHash === storedHash;
        }

        // New PBKDF2 hash
        const [saltHex, hashHex] = storedHash.split(":");
        const salt = new Uint8Array(saltHex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
        
        const encoder = new TextEncoder();
        const passwordData = encoder.encode(password);
        
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            passwordData,
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );
        
        const derivedKey = await crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
        
        const rawKey = await crypto.subtle.exportKey("raw", derivedKey);
        const hashArray = Array.from(new Uint8Array(rawKey));
        const computedHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        
        return computedHash === hashHex;
    } catch (error) {
        console.error("Password verification error:", error);
        return false;
    }
}


/* =========================================================
   GET SESSION TOKEN
========================================================= */

function getSessionToken(request) {
    const cookie =
        request.headers.get("Cookie") || "";

    const match =
        cookie.match(
            /(?:^|;\s*)hyool_session=([^;]+)/
        );

    if (match) {
        return decodeURIComponent(
            match[1]
        );
    }

    const auth =
        request.headers.get("Authorization") || "";

    const bearer =
        auth.match(/^Bearer\s+(.+)/);

    if (bearer) {
        return bearer[1].trim();
    }

    return null;
}


/* =========================================================
   CREATE COOKIE
========================================================= */

function createSessionCookie(token) {
    return [
        "hyool_session=" +
            encodeURIComponent(token),

        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Max-Age=2592000"
    ].join("; ");
}


/* =========================================================
   CLEAR COOKIE
========================================================= */

function clearSessionCookie() {
    return [
        "hyool_session=",
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Max-Age=0"
    ].join("; ");
}


/* =========================================================
   CLEAN SETTINGS
========================================================= */

function cleanSettingValue(
    value,
    fallback,
    maxLength
) {
    if (typeof value !== "string") {
        return fallback;
    }

    const result =
        value.trim();

    if (result.length > maxLength) {
        return fallback;
    }

    return result;
}


/* =========================================================
   RATE LIMIT
========================================================= */

async function checkRateLimit(
    request,
    env,
    route,
    limit,
    windowSec
) {
    const ip =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for") ||
        "unknown";

    const now = Date.now();
    const windowId = Math.floor(
        now / 1000 / windowSec
    );
    const key = `${ip}:${route}:${windowId}`;
    const expiresAt = (windowId + 1) * windowSec;

    const existing = await env.DB.prepare(
        "SELECT count FROM rate_limits WHERE key = ?"
    )
        .bind(key)
        .first();

    if (existing && existing.count >= limit) {
        return false;
    }

    if (existing) {
        await env.DB.prepare(
            "UPDATE rate_limits SET count = count + 1 WHERE key = ?"
        )
            .bind(key)
            .run();
    } else {
        await env.DB.prepare(
            "INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)"
        )
            .bind(key, expiresAt)
            .run();
    }

    if (Math.random() < 0.01) {
        const nowSec = Math.floor(now / 1000);
        env.DB.prepare(
            "DELETE FROM rate_limits WHERE expires_at < ?"
        )
            .bind(nowSec)
            .run();
    }

    return true;
}


/* =========================================================
   CSRF PROTECTION
========================================================= */

async function generateCsrfToken(env, userId) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours
    
    await env.DB.prepare(
        "INSERT INTO csrf_tokens (token, user_id, expires_at) VALUES (?, ?, ?)"
    ).bind(token, userId, expiresAt).run();
    
    return token;
}

async function verifyCsrfToken(env, token, userId) {
    if (!token) {
        return false;
    }
    
    const stored = await env.DB.prepare(
        "SELECT * FROM csrf_tokens WHERE token = ? AND user_id = ? LIMIT 1"
    ).bind(token, userId).first();
    
    if (!stored) {
        return false;
    }
    
    // Check if expired
    if (new Date(stored.expires_at).getTime() <= Date.now()) {
        await env.DB.prepare("DELETE FROM csrf_tokens WHERE token = ?").bind(token).run();
        return false;
    }
    
    // Delete after use (one-time token)
    await env.DB.prepare("DELETE FROM csrf_tokens WHERE token = ?").bind(token).run();
    
    return true;
}

/* =========================================================
   JSON RESPONSE
========================================================= */

function json(
    data,
    status = 200,
    extraHeaders = {}
) {
    return new Response(
        JSON.stringify(data),
        {
            status: status,
            headers: {
                "Content-Type":
                    "application/json; charset=UTF-8",

                "Cache-Control":
                    "no-store",

                ...extraHeaders
            }
        }
    );
}

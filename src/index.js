import { handleMvpRoutes } from "./mvp.js";

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);

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

                const existing = await env.DB
                    .prepare(
                        "SELECT id, username, password_hash FROM profiles WHERE username = ? LIMIT 1"
                    )
                    .bind(username)
                    .first();

                if (existing) {
                    if (!existing.password_hash) {
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

                return createLoginResponse(
                    env,
                    userId,
                    username
                );

            } catch (error) {
                console.error("REGISTER ERROR:", error);

                return json({
                    success: false,
                    error: "注册失败。",
                    message: error?.message || String(error)
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

                const passwordHash =
                    await hashPassword(password);

                if (passwordHash !== profile.password_hash) {
                    return json({
                        success: false,
                        error: "账号或密码错误。"
                    }, 401);
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
                    error: "服务器登录异常。",
                    message: error?.message || String(error)
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
                    error: "服务器返回异常。",
                    message: error?.message || String(error)
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
                    error: "退出登录失败。",
                    message: error?.message || String(error)
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
                    error: "数据库异常。",
                    message: error?.message || String(error)
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
            !pathname.endsWith("/settings")
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

                const postsResult = await env.DB
                    .prepare(
                        "SELECT * FROM yonder_posts WHERE user_id = ? ORDER BY created_at DESC"
                    )
                    .bind(profile.id)
                    .all();

                const settings =
                    await getYonderSettings(
                        env,
                        profile.id
                    );

                return json({
                    success: true,
                    yonder: {
                        profile: profile,
                        settings: settings,
                        posts: postsResult.results || []
                    }
                });

            } catch (error) {
                console.error("YONDER DATA ERROR:", error);

                return json({
                    success: false,
                    error: "彼岸加载异常。",
                    message: error?.message || String(error)
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
                    error: "内容加载失败。",
                    message: error?.message || String(error)
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

                return json({
                    success: true,
                    username: username,
                    settings: settings
                });

            } catch (error) {
                console.error("YONDER SETTINGS GET ERROR:", error);

                return json({
                    success: false,
                    error: "主页设置加载失败。",
                    message: error?.message || String(error)
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
                        2000
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

                await env.DB
                    .prepare(
                        `INSERT INTO yonder_settings
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
                            created_at,
                            updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT(user_id)
                        DO UPDATE SET
                            background_type = excluded.background_type,
                            background_value = excluded.background_value,
                            accent_color = excluded.accent_color,
                            layout = excluded.layout,
                            show_profile = excluded.show_profile,
                            show_posts = excluded.show_posts,
                            show_works = excluded.show_works,
                            show_infinite = excluded.show_infinite,
                            custom_css = excluded.custom_css,
                            updated_at = CURRENT_TIMESTAMP`
                    )
                    .bind(
                        user.id,
                        backgroundType,
                        backgroundValue,
                        accentColor,
                        layout,
                        showProfile,
                        showPosts,
                        showWorks,
                        showInfinite,
                        customCss
                    )
                    .run();

                const settings =
                    await getYonderSettings(
                        env,
                        user.id
                    );

                return json({
                    success: true,
                    settings: settings
                });

            } catch (error) {
                console.error("YONDER SETTINGS SAVE ERROR:", error);

                return json({
                    success: false,
                    error: "主页设置保存失败。",
                    message: error?.message || String(error)
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
                return json({
                    success: false,
                    error: "资料更新失败：" + (error.message || "未知错误")
                }, 500);
            }
        }


        /* =====================================================
           UPLOAD FILE
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

                if (file.size > 3 * 1024 * 1024) {
                    return json({
                        success: false,
                        error: "文件过大（限 3MB 以内）。"
                    }, 400);
                }

                const allowedTypes = [
                    "image/jpeg",
                    "image/png",
                    "image/gif",
                    "image/webp",
                    "image/svg+xml"
                ];

                if (!allowedTypes.includes(file.type)) {
                    return json({
                        success: false,
                        error: "仅支持 JPG/PNG/GIF/WebP/SVG 格式。"
                    }, 400);
                }

                const arrayBuffer =
                    await file.arrayBuffer();

                const bytes =
                    new Uint8Array(arrayBuffer);

                let binary = "";
                const chunkSize = 8192;
                for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(
                        null,
                        bytes.subarray(i, i + chunkSize)
                    );
                }

                const base64 = btoa(binary);

                const dataUrl =
                    `data:${file.type};base64,${base64}`;

                return json({
                    success: true,
                    url: dataUrl,
                    size: file.size,
                    type: file.type
                });

            } catch (error) {
                return json({
                    success: false,
                    error: "上传失败：" + (error.message || "未知错误")
                }, 500);
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
                    error: "彼岸加载异常。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);
            }
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
                created_at,
                updated_at
            )
            VALUES (?, 'gradient', '', '#8b8bff', 'default', 1, 1, 1, 1, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
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

    return await env.DB
        .prepare(
            "SELECT * FROM yonder_settings WHERE user_id = ? LIMIT 1"
        )
        .bind(userId)
        .first();
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
   PASSWORD HASH
========================================================= */

async function hashPassword(password) {
    const data =
        new TextEncoder()
            .encode(password);

    const hash =
        await crypto.subtle.digest(
            "SHA-256",
            data
        );

    return Array
        .from(new Uint8Array(hash))
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(2, "0")
        )
        .join("");
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
        "SameSite=None",
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
        "SameSite=None",
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

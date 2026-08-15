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


                return createLoginResponse(
                    env,
                    userId,
                    username
                );

            }

            catch (error) {

                console.error(
                    "REGISTER ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "注册失败。",
                    message:
                        error?.message ||
                        String(error)
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


                return createLoginResponse(
                    env,
                    profile.id,
                    profile.username
                );

            }

            catch (error) {

                console.error(
                    "LOGIN ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "服务器登录异常。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);

            }

        }


        /* =====================================================
           CURRENT USER
           /api/me
        ===================================================== */

        if (pathname === "/api/me" && request.method === "GET") {

            try {

                const token =
                    getSessionToken(request);


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

            }

            catch (error) {

                console.error(
                    "ME ERROR:",
                    error
                );


                return json({
                    authenticated: false,
                    error: "服务器返回异常。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);

            }

        }


        /* =====================================================
           LOGOUT
        ===================================================== */

        if (pathname === "/api/logout" && request.method === "POST") {

            try {

                const token =
                    getSessionToken(request);


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

            }

            catch (error) {

                console.error(
                    "LOGOUT ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "退出登录失败。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);

            }

        }


        /* =====================================================
           PUBLIC PROFILE
           /api/profile/333123
        ===================================================== */

        if (pathname.startsWith("/api/profile/")) {

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

            }

            catch (error) {

                console.error(
                    "PROFILE ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "数据库异常。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);

            }

        }


        /* =====================================================
           YONDER DATA
           GET /api/yonder/:username
           
           返回：
           profile
           posts
        ===================================================== */

        if (
            pathname.startsWith("/api/yonder/") &&
            pathname.split("/").length === 4 &&
            request.method === "GET"
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

                const profile =
                    await env.DB
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


                const posts =
                    await env.DB
                        .prepare(
                            "SELECT id, user_id, type, title, content, media_url, cover_url, visibility, created_at, updated_at FROM yonder_posts WHERE user_id = ? AND visibility = 'public' ORDER BY created_at DESC LIMIT 50"
                        )
                        .bind(profile.id)
                        .all();


                return json({

                    success: true,

                    yonder: {

                        profile: profile,

                        posts:
                            posts.results || []

                    }

                });

            }

            catch (error) {

                console.error(
                    "YONDER DATA ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "彼岸数据加载失败。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);

            }

        }


        /* =====================================================
           YONDER POSTS
           GET /api/yonder/:username/posts
        ===================================================== */

        if (
            pathname.startsWith("/api/yonder/") &&
            pathname.endsWith("/posts") &&
            request.method === "GET"
        ) {

            const parts =
                pathname.split("/");


            const username =
                parts[3]
                    ?.trim()
                    .toLowerCase();


            if (!username) {

                return json({
                    success: false,
                    error: "缺少用户名。"
                }, 400);

            }


            try {

                const profile =
                    await env.DB
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


                const posts =
                    await env.DB
                        .prepare(
                            "SELECT id, user_id, type, title, content, media_url, cover_url, visibility, created_at, updated_at FROM yonder_posts WHERE user_id = ? AND visibility = 'public' ORDER BY created_at DESC LIMIT 50"
                        )
                        .bind(profile.id)
                        .all();


                return json({

                    success: true,

                    username:
                        profile.username,

                    posts:
                        posts.results || []

                });

            }

            catch (error) {

                console.error(
                    "YONDER POSTS ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "彼岸内容加载失败。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);

            }

        }


        /* =====================================================
           CREATE YONDER POST
           POST /api/yonder/posts
        ===================================================== */

        if (
            pathname === "/api/yonder/posts" &&
            request.method === "POST"
        ) {

            try {

                const auth =
                    await getAuthenticatedUser(
                        request,
                        env
                    );


                if (!auth) {

                    return json({
                        success: false,
                        error: "请先登录。"
                    }, 401);

                }


                const body =
                    await request.json();


                const type =
                    String(
                        body.type ||
                        "thought"
                    ).trim();


                const allowedTypes = [
                    "thought",
                    "image",
                    "video",
                    "audio",
                    "project"
                ];


                if (
                    !allowedTypes.includes(type)
                ) {

                    return json({
                        success: false,
                        error: "内容类型不正确。"
                    }, 400);

                }


                const title =
                    String(
                        body.title ||
                        ""
                    ).trim();


                const content =
                    String(
                        body.content ||
                        ""
                    ).trim();


                const mediaUrl =
                    String(
                        body.media_url ||
                        ""
                    ).trim();


                const coverUrl =
                    String(
                        body.cover_url ||
                        ""
                    ).trim();


                const visibility =
                    String(
                        body.visibility ||
                        "public"
                    ).trim();


                if (
                    ![
                        "public",
                        "private"
                    ].includes(visibility)
                ) {

                    return json({
                        success: false,
                        error: "可见范围不正确。"
                    }, 400);

                }


                if (
                    !title &&
                    !content &&
                    !mediaUrl
                ) {

                    return json({
                        success: false,
                        error: "内容不能为空。"
                    }, 400);

                }


                const postId =
                    crypto.randomUUID();


                await env.DB
                    .prepare(
                        `INSERT INTO yonder_posts
                        (
                            id,
                            user_id,
                            type,
                            title,
                            content,
                            media_url,
                            cover_url,
                            visibility,
                            created_at,
                            updated_at
                        )
                        VALUES
                        (
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            CURRENT_TIMESTAMP,
                            CURRENT_TIMESTAMP
                        )`
                    )
                    .bind(
                        postId,
                        auth.user.id,
                        type,
                        title || null,
                        content || null,
                        mediaUrl || null,
                        coverUrl || null,
                        visibility
                    )
                    .run();


                const post =
                    await env.DB
                        .prepare(
                            "SELECT id, user_id, type, title, content, media_url, cover_url, visibility, created_at, updated_at FROM yonder_posts WHERE id = ? LIMIT 1"
                        )
                        .bind(postId)
                        .first();


                return json({

                    success: true,

                    post: post

                }, 201);

            }

            catch (error) {

                console.error(
                    "CREATE POST ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "发布失败。",
                    message:
                        error?.message ||
                        String(error)
                }, 500);

            }

        }


        /* =====================================================
           DELETE YONDER POST
           DELETE /api/yonder/posts/:id
        ===================================================== */

        if (
            pathname.startsWith("/api/yonder/posts/") &&
            request.method === "DELETE"
        ) {

            const postId =
                pathname
                    .substring(
                        "/api/yonder/posts/".length
                    )
                    .trim();


            if (!postId) {

                return json({
                    success: false,
                    error: "缺少内容 ID。"
                }, 400);

            }


            try {

                const auth =
                    await getAuthenticatedUser(
                        request,
                        env
                    );


                if (!auth) {

                    return json({
                        success: false,
                        error: "请先登录。"
                    }, 401);

                }


                const post =
                    await env.DB
                        .prepare(
                            "SELECT id, user_id FROM yonder_posts WHERE id = ? LIMIT 1"
                        )
                        .bind(postId)
                        .first();


                if (!post) {

                    return json({
                        success: false,
                        error: "内容不存在。"
                    }, 404);

                }


                if (
                    post.user_id !==
                    auth.user.id
                ) {

                    return json({
                        success: false,
                        error: "你没有权限删除这条内容。"
                    }, 403);

                }


                await env.DB
                    .prepare(
                        "DELETE FROM yonder_posts WHERE id = ?"
                    )
                    .bind(postId)
                    .run();


                /*
                 * 同步清理相关数据
                 */

                await env.DB
                    .prepare(
                        "DELETE FROM yonder_feed WHERE post_id = ?"
                    )
                    .bind(postId)
                    .run();


                await env.DB
                    .prepare(
                        "DELETE FROM yonder_collections WHERE post_id = ?"
                    )
                    .bind(postId)
                    .run();


                return json({

                    success: true,

                    deleted:
                        postId

                });

            }

            catch (error) {

                console.error(
                    "DELETE POST ERROR:",
                    error
                );


                return json({
                    success: false,
                    error: "删除失败。",
                    message:
                        error?.message ||
                        String(error)
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
                            method: "GET"
                        }
                    );


                return await env.ASSETS.fetch(
                    assetRequest
                );

            }

            catch (error) {

                console.error(
                    "YONDER ERROR:",
                    error
                );


                return json(
                    {
                        success: false,
                        error: "彼岸加载异常。",
                        message:
                            error?.message ||
                            String(error)
                    },
                    500
                );

            }

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


    const profile =
        await env.DB
            .prepare(
                "SELECT id, username, display_name, avatar_url, bio, background_url, theme, created_at, updated_at FROM profiles WHERE id = ? LIMIT 1"
            )
            .bind(session.user_id)
            .first();


    if (!profile) {

        return null;

    }


    return {
        session,
        user: profile
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


    if (!match) {

        return null;

    }


    return decodeURIComponent(
        match[1]
    );

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

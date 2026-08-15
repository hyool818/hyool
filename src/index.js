```javascript
/* =========================================================
   HYOOL WORKER
   Cloudflare Workers + D1 + Assets

   当前功能：

   /api/register
   /api/login
   /api/me
   /api/logout
   /api/profile/:username

   /@username
   ========================================================= */


export default {

    async fetch(request, env) {

        const url =
            new URL(request.url);

        const pathname =
            decodeURIComponent(
                url.pathname
            );


        /* =====================================================
           OPTIONS
        ===================================================== */

        if (
            request.method === "OPTIONS"
        ) {

            return json({

                success: true

            });

        }


        /* =====================================================
           REGISTER
        ===================================================== */

        if (
            pathname === "/api/register" &&
            request.method === "POST"
        ) {

            try {

                const body =
                    await request.json();


                const username =
                    String(
                        body.username || ""
                    )
                    .trim()
                    .toLowerCase();


                const password =
                    String(
                        body.password || ""
                    );


                const displayName =
                    String(
                        body.display_name || ""
                    )
                    .trim();


                /* ---------------------------------------------
                   USERNAME
                --------------------------------------------- */

                if (
                    !/^[a-z0-9_-]{3,20}$/
                        .test(username)
                ) {

                    return json(
                        {
                            success: false,
                            error:
                                "账号格式不正确。只能使用英文字母、数字、下划线和减号，长度 3-20 位。"
                        },
                        400
                    );

                }


                /* ---------------------------------------------
                   PASSWORD
                --------------------------------------------- */

                if (
                    password.length < 8
                ) {

                    return json(
                        {
                            success: false,
                            error:
                                "密码至少需要 8 位。"
                        },
                        400
                    );

                }


                /* ---------------------------------------------
                   CHECK USER
                --------------------------------------------- */

                const existing =
                    await env.DB
                        .prepare(`
                            SELECT
                                id,
                                username,
                                password_hash
                            FROM profiles
                            WHERE username = ?
                            LIMIT 1
                        `)
                        .bind(username)
                        .first();


                if (existing) {

                    /*
                     * 如果账号已经存在，
                     * 但没有密码，
                     * 说明是以前创建的测试账号。
                     *
                     * 允许重新配置密码。
                     */

                    if (
                        !existing.password_hash
                    ) {

                        const passwordHash =
                            await hashPassword(
                                password
                            );


                        await env.DB
                            .prepare(`
                                UPDATE profiles
                                SET
                                    password_hash = ?,
                                    display_name = ?,
                                    updated_at =
                                        CURRENT_TIMESTAMP
                                WHERE username = ?
                            `)
                            .bind(
                                passwordHash,

                                displayName ||
                                    username,

                                username
                            )
                            .run();


                        return createLoginResponse(
                            env,
                            existing.id,
                            username
                        );

                    }


                    return json(
                        {
                            success: false,
                            error:
                                "这个账号已经存在。"
                        },
                        409
                    );

                }


                /* ---------------------------------------------
                   CREATE USER
                --------------------------------------------- */

                const userId =
                    crypto.randomUUID();


                const passwordHash =
                    await hashPassword(
                        password
                    );


                await env.DB
                    .prepare(`
                        INSERT INTO profiles (
                            id,
                            username,
                            display_name,
                            bio,
                            theme,
                            password_hash,
                            created_at,
                            updated_at
                        )
                        VALUES (
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            ?,
                            CURRENT_TIMESTAMP,
                            CURRENT_TIMESTAMP
                        )
                    `)
                    .bind(

                        userId,

                        username,

                        displayName ||
                            username,

                        "这是我的彼岸。",

                        "dark",

                        passwordHash

                    )
                    .run();


                /*
                 * 注册成功后直接登录
                 */

                return createLoginResponse(
                    env,
                    userId,
                    username
                );

            }

            catch (error) {

                console.error(
                    "REGISTER ERROR",
                    error
                );


                return json(
                    {
                        success: false,
                        error:
                            "注册失败。",
                        message:
                            error.message
                    },
                    500
                );

            }

        }


        /* =====================================================
           LOGIN
        ===================================================== */

        if (
            pathname === "/api/login" &&
            request.method === "POST"
        ) {

            try {

                const body =
                    await request.json();


                const username =
                    String(
                        body.username || ""
                    )
                    .trim()
                    .toLowerCase();


                const password =
                    String(
                        body.password || ""
                    );


                if (
                    !username ||
                    !password
                ) {

                    return json(
                        {
                            success: false,
                            error:
                                "请输入账号和密码。"
                        },
                        400
                    );

                }


                /* ---------------------------------------------
                   FIND USER
                --------------------------------------------- */

                const profile =
                    await env.DB
                        .prepare(`
                            SELECT *
                            FROM profiles
                            WHERE username = ?
                            LIMIT 1
                        `)
                        .bind(username)
                        .first();


                if (!profile) {

                    return json(
                        {
                            success: false,
                            error:
                                "账号或密码错误。"
                        },
                        401
                    );

                }


                /* ---------------------------------------------
                   PASSWORD NOT CONFIGURED
                --------------------------------------------- */

                if (
                    !profile.password_hash
                ) {

                    return json(
                        {
                            success: false,
                            error:
                                "这个账号尚未完成密码配置，请重新注册。"
                        },
                        401
                    );

                }


                /* ---------------------------------------------
                   CHECK PASSWORD
                --------------------------------------------- */

                const passwordHash =
                    await hashPassword(
                        password
                    );


                if (
                    passwordHash !==
                    profile.password_hash
                ) {

                    return json(
                        {
                            success: false,
                            error:
                                "账号或密码错误。"
                        },
                        401
                    );

                }


                /* ---------------------------------------------
                   LOGIN
                --------------------------------------------- */

                return createLoginResponse(
                    env,
                    profile.id,
                    profile.username
                );

            }

            catch (error) {

                console.error(
                    "LOGIN ERROR",
                    error
                );


                return json(
                    {
                        success: false,
                        error:
                            "服务器登录异常。",
                        message:
                            error.message
                    },
                    500
                );

            }

        }


        /* =====================================================
           CURRENT USER
           /api/me
        ===================================================== */

        if (
            pathname === "/api/me" &&
            request.method === "GET"
        ) {

            try {

                const token =
                    getSessionToken(
                        request
                    );


                if (!token) {

                    return json({

                        authenticated:
                            false

                    });

                }


                /* ---------------------------------------------
                   FIND SESSION
                --------------------------------------------- */

                const session =
                    await env.DB
                        .prepare(`
                            SELECT *
                            FROM sessions
                            WHERE token = ?
                            LIMIT 1
                        `)
                        .bind(token)
                        .first();


                if (!session) {

                    return json({

                        authenticated:
                            false

                    });

                }


                /* ---------------------------------------------
                   CHECK EXPIRATION
                --------------------------------------------- */

                if (
                    session.expires_at &&
                    new Date(
                        session.expires_at
                    ).getTime()
                    <=
                    Date.now()
                ) {

                    await env.DB
                        .prepare(`
                            DELETE FROM sessions
                            WHERE token = ?
                        `)
                        .bind(token)
                        .run();


                    return json({

                        authenticated:
                            false

                    });

                }


                /* ---------------------------------------------
                   GET PROFILE
                --------------------------------------------- */

                const profile =
                    await env.DB
                        .prepare(`
                            SELECT
                                id,
                                username,
                                display_name,
                                avatar_url,
                                bio,
                                background_url,
                                theme,
                                created_at,
                                updated_at
                            FROM profiles
                            WHERE id = ?
                            LIMIT 1
                        `)
                        .bind(
                            session.user_id
                        )
                        .first();


                if (!profile) {

                    return json({

                        authenticated:
                            false

                    });

                }


                return json({

                    authenticated:
                        true,

                    user: {

                        id:
                            profile.id,

                        username:
                            profile.username,

                        profile:
                            profile

                    }

                });

            }

            catch (error) {

                console.error(
                    "ME ERROR",
                    error
                );


                return json(
                    {
                        authenticated:
                            false,

                        error:
                            "服务器返回异常。"
                    },
                    500
                );

            }

        }


        /* =====================================================
           LOGOUT
           /api/logout
        ===================================================== */

        if (
            pathname === "/api/logout" &&
            request.method === "POST"
        ) {

            try {

                const token =
                    getSessionToken(
                        request
                    );


                if (token) {

                    await env.DB
                        .prepare(`
                            DELETE FROM sessions
                            WHERE token = ?
                        `)
                        .bind(token)
                        .run();

                }


                return json(
                    {
                        success:
                            true
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
                    "LOGOUT ERROR",
                    error
                );


                return json(
                    {
                        success:
                            false,

                        error:
                            "退出登录失败。"
                    },
                    500
                );

            }

        }


        /* =====================================================
           PUBLIC PROFILE API

           /api/profile/333123
        ===================================================== */

        if (
            pathname.startsWith(
                "/api/profile/"
            )
        ) {

            const username =
                pathname
                    .substring(
                        "/api/profile/"
                            .length
                    )
                    .trim()
                    .toLowerCase();


            if (!username) {

                return json(
                    {
                        success:
                            false,

                        error:
                            "缺少用户名。"
                    },
                    400
                );

            }


            try {

                const profile =
                    await env.DB
                        .prepare(`
                            SELECT
                                id,
                                username,
                                display_name,
                                avatar_url,
                                bio,
                                background_url,
                                theme,
                                created_at,
                                updated_at
                            FROM profiles
                            WHERE username = ?
                            LIMIT 1
                        `)
                        .bind(username)
                        .first();


                if (!profile) {

                    return json(
                        {
                            success:
                                false,

                            error:
                                "彼岸不存在。"
                        },
                        404
                    );

                }


                return json({

                    success:
                        true,

                    profile:
                        profile

                });

            }

            catch (error) {

                console.error(
                    "PROFILE ERROR",
                    error
                );


                return json(
                    {
                        success:
                            false,

                        error:
                            "数据库异常。"
                    },
                    500
                );

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
                        .prepare(`
                            SELECT
                                id,
                                username
                            FROM profiles
                            WHERE username = ?
                            LIMIT 1
                        `)
                        .bind(username)
                        .first();


                if (!profile) {

                    return new Response(
                        "这个彼岸不存在",
                        {
                            status:
                                404,

                            headers: {

                                "Content-Type":
                                    "text/plain; charset=UTF-8"

                            }
                        }
                    );

                }


                /*
                 * 地址栏保持：
                 *
                 * https://hyool.com/@333123
                 *
                 * 实际页面：
                 *
                 * yonder-home.html
                 */

                const assetUrl =
                    new URL(
                        "/yonder-home.html",
                        request.url
                    );


                return env.ASSETS.fetch(

                    new Request(
                        assetUrl,
                        {
                            method:
                                "GET",

                            headers:
                                request.headers
                        }
                    )

                );

            }

            catch (error) {

                console.error(
                    "YONDER ERROR",
                    error
                );


                return json(
                    {
                        success:
                            false,

                        error:
                            "彼岸加载异常。"
                    },
                    500
                );

            }

        }


        /* =====================================================
           STATIC ASSETS
        ===================================================== */

        return env.ASSETS.fetch(
            request
        );

    }

};


/* =========================================================
   CREATE LOGIN SESSION
========================================================= */

async function createLoginResponse(
    env,
    userId,
    username
) {

    /*
     * 生成新的 Session Token
     */

    const token =
        crypto.randomUUID()
        +
        "-"
        +
        crypto.randomUUID();


    /*
     * 30 天
     */

    const expiresAt =
        new Date(
            Date.now()
            +
            30 *
            24 *
            60 *
            60 *
            1000
        )
        .toISOString();


    /*
     * 写入 sessions
     */

    await env.DB
        .prepare(`
            INSERT INTO sessions (
                token,
                user_id,
                username,
                expires_at
            )
            VALUES (
                ?,
                ?,
                ?,
                ?
            )
        `)
        .bind(
            token,
            userId,
            username,
            expiresAt
        )
        .run();


    /*
     * 获取完整 Profile
     */

    const profile =
        await env.DB
            .prepare(`
                SELECT
                    id,
                    username,
                    display_name,
                    avatar_url,
                    bio,
                    background_url,
                    theme,
                    created_at,
                    updated_at
                FROM profiles
                WHERE id = ?
                LIMIT 1
            `)
            .bind(userId)
            .first();


    return json(
        {

            success:
                true,

            user: {

                id:
                    userId,

                username:
                    username,

                profile:
                    profile || {}

            }

        },

        200,

        {

            "Set-Cookie":
                createSessionCookie(
                    token
                )

        }

    );

}


/* =========================================================
   PASSWORD HASH

   当前阶段使用 SHA-256。
   先保证 HYOOL 账户系统稳定运行。
========================================================= */

async function hashPassword(
    password
) {

    const data =
        new TextEncoder()
            .encode(password);


    const hash =
        await crypto.subtle.digest(
            "SHA-256",
            data
        );


    return Array
        .from(
            new Uint8Array(hash)
        )
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(
                        2,
                        "0"
                    )
        )
        .join("");

}


/* =========================================================
   GET SESSION TOKEN
========================================================= */

function getSessionToken(
    request
) {

    const cookie =
        request.headers
            .get("Cookie")
        || "";


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
   CREATE SESSION COOKIE
========================================================= */

function createSessionCookie(
    token
) {

    return [

        "hyool_session=" +
            encodeURIComponent(
                token
            ),

        "Path=/",

        "HttpOnly",

        "Secure",

        "SameSite=Lax",

        "Max-Age=2592000"

    ].join("; ");

}


/* =========================================================
   CLEAR SESSION COOKIE
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

        JSON.stringify(
            data
        ),

        {

            status,

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
```

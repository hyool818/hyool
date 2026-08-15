export default {

    async fetch(request, env) {

        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);


        /* =====================================================
           CORS / OPTIONS
        ===================================================== */

        if (request.method === "OPTIONS") {

            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": url.origin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods":
                        "GET,POST,PUT,OPTIONS"
                }
            });

        }


        /* =====================================================
           API：REGISTER
        ===================================================== */

        if (
            pathname === "/api/register" &&
            request.method === "POST"
        ) {

            try {

                const body =
                    await request.json();

                const username =
                    String(body.username || "")
                        .trim()
                        .toLowerCase();

                const password =
                    String(body.password || "");

                const displayName =
                    String(body.display_name || "")
                        .trim();


                /* -------------------------
                   检查账号
                ------------------------- */

                if (
                    !/^[a-z0-9_-]{3,20}$/
                        .test(username)
                ) {

                    return json({
                        success: false,
                        error:
                            "账号格式不正确。"
                    }, 400);

                }


                /* -------------------------
                   检查密码
                ------------------------- */

                if (
                    password.length < 8
                ) {

                    return json({
                        success: false,
                        error:
                            "密码至少需要 8 位。"
                    }, 400);

                }


                /* -------------------------
                   检查是否已经存在
                ------------------------- */

                const exists =
                    await env.DB
                        .prepare(`
                            SELECT id
                            FROM profiles
                            WHERE username = ?
                            LIMIT 1
                        `)
                        .bind(username)
                        .first();


                if (exists) {

                    return json({
                        success: false,
                        error:
                            "这个账号已经存在。"
                    }, 409);

                }


                /* -------------------------
                   密码哈希
                ------------------------- */

                const passwordHash =
                    await hashPassword(
                        password
                    );


                /* -------------------------
                   创建用户 ID
                ------------------------- */

                const id =
                    crypto.randomUUID();


                /* -------------------------
                   写入 D1
                ------------------------- */

                await env.DB
                    .prepare(`
                        INSERT INTO profiles (
                            id,
                            username,
                            display_name,
                            bio,
                            theme,
                            created_at,
                            updated_at
                        )
                        VALUES (
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
                        id,
                        username,
                        displayName ||
                            username,
                        "这是我的彼岸。",
                        "dark"
                    )
                    .run();


                /*
                 * 目前 passwordHash 还没有字段保存。
                 *
                 * 下一步我们会给 profiles 增加：
                 *
                 * password_hash
                 *
                 * 现在先返回成功。
                 */


                return json({
                    success: true,
                    message:
                        "彼岸创建成功。",
                    user: {
                        id,
                        username,
                        display_name:
                            displayName ||
                            username
                    }
                });

            }

            catch (error) {

                console.error(
                    "REGISTER ERROR:",
                    error
                );

                return json({
                    success: false,
                    error:
                        "注册失败。",
                    message:
                        error.message
                }, 500);

            }

        }


        /* =====================================================
           API：LOGIN
        ===================================================== */

        if (
            pathname === "/api/login" &&
            request.method === "POST"
        ) {

            try {

                const body =
                    await request.json();

                const username =
                    String(body.username || "")
                        .trim()
                        .toLowerCase();

                const password =
                    String(body.password || "");


                if (
                    !username ||
                    !password
                ) {

                    return json({
                        success: false,
                        error:
                            "请输入账号和密码。"
                    }, 400);

                }


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

                    return json({
                        success: false,
                        error:
                            "账号或密码错误。"
                    }, 401);

                }


                /*
                 * 当前数据库如果还没有
                 * password_hash 字段，
                 * 暂时无法验证密码。
                 */

                if (!profile.password_hash) {

                    return json({
                        success: false,
                        error:
                            "账号尚未完成密码配置，请重新注册。"
                    }, 401);

                }


                const passwordHash =
                    await hashPassword(
                        password
                    );


                if (
                    passwordHash !==
                    profile.password_hash
                ) {

                    return json({
                        success: false,
                        error:
                            "账号或密码错误。"
                    }, 401);

                }


                /*
                 * 登录成功
                 *
                 * 这里先使用 Cookie 保存
                 * 用户 ID。
                 */

                const cookie =
                    createSessionCookie(
                        profile.id
                    );


                return json(
                    {
                        success: true,

                        user: {
                            id:
                                profile.id,

                            username:
                                profile.username,

                            profile
                        }
                    },
                    200,
                    {
                        "Set-Cookie":
                            cookie
                    }
                );

            }

            catch (error) {

                console.error(
                    "LOGIN ERROR:",
                    error
                );

                return json({
                    success: false,
                    error:
                        "登录失败。",
                    message:
                        error.message
                }, 500);

            }

        }


        /* =====================================================
           API：ME
        ===================================================== */

        if (
            pathname === "/api/me" &&
            request.method === "GET"
        ) {

            try {

                const cookies =
                    parseCookies(
                        request.headers
                            .get("Cookie") || ""
                    );

                const userId =
                    cookies.hyool_session;


                if (!userId) {

                    return json({
                        authenticated:
                            false
                    });

                }


                const profile =
                    await env.DB
                        .prepare(`
                            SELECT *
                            FROM profiles
                            WHERE id = ?
                            LIMIT 1
                        `)
                        .bind(userId)
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

                        profile
                    }
                });

            }

            catch (error) {

                console.error(
                    "ME ERROR:",
                    error
                );

                return json({
                    authenticated:
                        false
                });

            }

        }


        /* =====================================================
           API：LOGOUT
        ===================================================== */

        if (
            pathname === "/api/logout" &&
            request.method === "POST"
        ) {

            return json(
                {
                    success: true
                },
                200,
                {
                    "Set-Cookie":
                        "hyool_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
                }
            );

        }


        /* =====================================================
           API：PROFILE
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
                    .trim();


            if (!username) {

                return json({
                    success: false,
                    error:
                        "missing_username"
                }, 400);

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

                    return json({
                        success: false,
                        error:
                            "profile_not_found"
                    }, 404);

                }


                return json({
                    success: true,
                    profile
                });

            }

            catch (error) {

                console.error(
                    "PROFILE ERROR:",
                    error
                );

                return json({
                    success: false,
                    error:
                        "database_error"
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
                    .trim();


            try {

                const profile =
                    await env.DB
                        .prepare(`
                            SELECT id, username
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
                            status: 404,

                            headers: {
                                "Content-Type":
                                    "text/plain; charset=UTF-8"
                            }
                        }
                    );

                }


            }

            catch (error) {

                console.error(
                    "YONDER ERROR:",
                    error
                );

                return json({
                    success: false,
                    error:
                        "database_error"
                }, 500);

            }


            const assetUrl =
                new URL(
                    "/yonder-home.html",
                    request.url
                );


            return env.ASSETS.fetch(
                new Request(
                    assetUrl.toString(),
                    {
                        method: "GET",
                        headers:
                            request.headers
                    }
                )
            );

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
   PASSWORD HASH
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
                    .padStart(2, "0")
        )
        .join("");

}


/* =========================================================
   SESSION COOKIE
========================================================= */

function createSessionCookie(
    userId
) {

    return [
        "hyool_session=" +
            encodeURIComponent(
                userId
            ),

        "Path=/",

        "HttpOnly",

        "Secure",

        "SameSite=Lax",

        "Max-Age=2592000"
    ].join("; ");

}


/* =========================================================
   COOKIE PARSER
========================================================= */

function parseCookies(
    cookieString
) {

    const cookies = {};

    cookieString
        .split(";")
        .forEach(
            part => {

                const index =
                    part.indexOf("=");

                if (
                    index === -1
                ) return;

                const key =
                    part
                        .slice(0,index)
                        .trim();

                const value =
                    part
                        .slice(index + 1)
                        .trim();

                cookies[key] =
                    decodeURIComponent(
                        value
                    );

            }
        );

    return cookies;

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

/*
=========================================================
HYOOL WORKER
=========================================================
*/

const SESSION_DAYS = 30;


/*
=========================================================
MAIN
=========================================================
*/

export default {

    async fetch(request, env) {

        const url = new URL(request.url);


        /*
        =====================================================
        CORS
        =====================================================
        */

        const corsHeaders = {
            "Access-Control-Allow-Origin": url.origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods":
                "GET, POST, OPTIONS"
        };


        /*
        =====================================================
        OPTIONS
        =====================================================
        */

        if (request.method === "OPTIONS") {

            return new Response(null, {
                headers: corsHeaders
            });

        }


        /*
        =====================================================
        API
        =====================================================
        */

        if (url.pathname.startsWith("/api/")) {

            try {

                /*
                =================================================
                HEALTH
                =================================================
                */

                if (
                    url.pathname === "/api/health" &&
                    request.method === "GET"
                ) {

                    const result =
                        await env.DB
                            .prepare(
                                "SELECT 1 AS ok"
                            )
                            .first();

                    return json({

                        success: true,

                        hyool: "alive",

                        database:
                            result?.ok === 1

                    }, 200, corsHeaders);

                }


                /*
                =================================================
                REGISTER
                =================================================
                */

                if (
                    url.pathname === "/api/register" &&
                    request.method === "POST"
                ) {

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


                    /*
                    ---------------------------------------------
                    USERNAME
                    ---------------------------------------------
                    */

                    if (
                        !/^[a-z0-9_-]{3,20}$/
                            .test(username)
                    ) {

                        return json({

                            success: false,

                            error:
                                "账号只能使用英文字母、数字、下划线和连字符，长度 3-20 位。"

                        }, 400, corsHeaders);

                    }


                    /*
                    ---------------------------------------------
                    PASSWORD
                    ---------------------------------------------
                    */

                    if (
                        password.length < 8 ||
                        password.length > 128
                    ) {

                        return json({

                            success: false,

                            error:
                                "密码长度需要在 8-128 位之间。"

                        }, 400, corsHeaders);

                    }


                    /*
                    ---------------------------------------------
                    CHECK EXISTING USER
                    ---------------------------------------------
                    */

                    const existing =
                        await env.DB
                            .prepare(`
                                SELECT id
                                FROM users
                                WHERE username = ?
                            `)
                            .bind(username)
                            .first();


                    if (existing) {

                        return json({

                            success: false,

                            error:
                                "这个账号已经存在。"

                        }, 409, corsHeaders);

                    }


                    /*
                    ---------------------------------------------
                    USER ID
                    ---------------------------------------------
                    */

                    const userId =
                        crypto.randomUUID();


                    /*
                    ---------------------------------------------
                    PASSWORD HASH
                    ---------------------------------------------
                    */

                    const passwordHash =
                        await hashPassword(
                            password
                        );


                    /*
                    ---------------------------------------------
                    CREATE USER
                    ---------------------------------------------
                    */

                    await env.DB
                        .prepare(`
                            INSERT INTO users
                            (
                                id,
                                username,
                                password_hash
                            )
                            VALUES (?, ?, ?)
                        `)
                        .bind(
                            userId,
                            username,
                            passwordHash
                        )
                        .run();


                    /*
                    ---------------------------------------------
                    CREATE PROFILE
                    ---------------------------------------------
                    */

                    await env.DB
                        .prepare(`
                            INSERT INTO profiles
                            (
                                id,
                                username,
                                display_name,
                                theme
                            )
                            VALUES (?, ?, ?, ?)
                        `)
                        .bind(
                            userId,
                            username,
                            username,
                            "dark"
                        )
                        .run();


                    /*
                    ---------------------------------------------
                    CREATE SESSION
                    ---------------------------------------------
                    */

                    const sessionToken =
                        generateToken();


                    await createSession(
                        env,
                        sessionToken,
                        userId
                    );


                    /*
                    ---------------------------------------------
                    RESPONSE
                    ---------------------------------------------
                    */

                    return json({

                        success: true,

                        user: {

                            id: userId,

                            username: username

                        }

                    }, 201, {

                        ...corsHeaders,

                        "Set-Cookie":
                            createSessionCookie(
                                sessionToken
                            )

                    });

                }


                /*
                =================================================
                LOGIN
                =================================================
                */

                if (
                    url.pathname === "/api/login" &&
                    request.method === "POST"
                ) {

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


                    /*
                    ---------------------------------------------
                    FIND USER
                    ---------------------------------------------
                    */

                    const user =
                        await env.DB
                            .prepare(`
                                SELECT
                                    id,
                                    username,
                                    password_hash
                                FROM users
                                WHERE username = ?
                            `)
                            .bind(username)
                            .first();


                    if (!user) {

                        return json({

                            success: false,

                            error:
                                "账号或密码错误。"

                        }, 401, corsHeaders);

                    }


                    /*
                    ---------------------------------------------
                    VERIFY PASSWORD
                    ---------------------------------------------
                    */

                    const valid =
                        await verifyPassword(
                            password,
                            user.password_hash
                        );


                    if (!valid) {

                        return json({

                            success: false,

                            error:
                                "账号或密码错误。"

                        }, 401, corsHeaders);

                    }


                    /*
                    ---------------------------------------------
                    CREATE SESSION
                    ---------------------------------------------
                    */

                    const sessionToken =
                        generateToken();


                    await createSession(
                        env,
                        sessionToken,
                        user.id
                    );


                    /*
                    ---------------------------------------------
                    RESPONSE
                    ---------------------------------------------
                    */

                    return json({

                        success: true,

                        user: {

                            id: user.id,

                            username:
                                user.username

                        }

                    }, 200, {

                        ...corsHeaders,

                        "Set-Cookie":
                            createSessionCookie(
                                sessionToken
                            )

                    });

                }


                /*
                =================================================
                CURRENT USER
                =================================================
                */

                if (
                    url.pathname === "/api/me" &&
                    request.method === "GET"
                ) {

                    const token =
                        getSessionToken(
                            request
                        );


                    if (!token) {

                        return json({

                            success: true,

                            authenticated: false,

                            user: null

                        }, 200, corsHeaders);

                    }


                    const session =
                        await getSession(
                            env,
                            token
                        );


                    if (!session) {

                        return json({

                            success: true,

                            authenticated: false,

                            user: null

                        }, 200, {

                            ...corsHeaders,

                            "Set-Cookie":
                                clearSessionCookie()

                        });

                    }


                    /*
                    ---------------------------------------------
                    GET PROFILE
                    ---------------------------------------------
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
                            `)
                            .bind(session.user_id)
                            .first();


                    return json({

                        success: true,

                        authenticated: true,

                        user: {

                            id:
                                session.user_id,

                            username:
                                session.username,

                            profile:
                                profile || null

                        }

                    }, 200, corsHeaders);

                }


                /*
                =================================================
                LOGOUT
                =================================================
                */

                if (
                    url.pathname === "/api/logout" &&
                    request.method === "POST"
                ) {

                    const token =
                        getSessionToken(
                            request
                        );


                    if (token) {

                        await deleteSession(
                            env,
                            token
                        );

                    }


                    return json({

                        success: true

                    }, 200, {

                        ...corsHeaders,

                        "Set-Cookie":
                            clearSessionCookie()

                    });

                }


                /*
                =================================================
                UNKNOWN API
                =================================================
                */

                return json({

                    success: false,

                    error:
                        "API not found."

                }, 404, corsHeaders);


            } catch (error) {

                console.error(error);


                return json({

                    success: false,

                    error:
                        "服务器发生错误。"

                }, 500, corsHeaders);

            }

        }


        /*
        =====================================================
        STATIC ASSETS
        =====================================================
        */

        return env.ASSETS.fetch(request);

    }

};


/*
=========================================================
JSON RESPONSE
=========================================================
*/

function json(
    data,
    status = 200,
    headers = {}
) {

    return new Response(
        JSON.stringify(data),
        {
            status,

            headers: {
                "Content-Type":
                    "application/json; charset=UTF-8",

                ...headers
            }
        }
    );

}


/*
=========================================================
GENERATE SESSION TOKEN
=========================================================
*/

function generateToken() {

    const bytes =
        crypto.getRandomValues(
            new Uint8Array(32)
        );


    return bytesToHex(bytes);

}


/*
=========================================================
CREATE SESSION
=========================================================
*/

async function createSession(
    env,
    token,
    userId
) {

    /*
    -----------------------------------------------------
    Session 暂时存 D1。
    
    后续用户量上来以后，
    可以迁移到 Cloudflare KV。
    -----------------------------------------------------
    */

    const expiresAt =
        new Date(
            Date.now() +
            SESSION_DAYS *
            24 *
            60 *
            60 *
            1000
        ).toISOString();


    const user =
        await env.DB
            .prepare(`
                SELECT username
                FROM users
                WHERE id = ?
            `)
            .bind(userId)
            .first();


    await env.DB
        .prepare(`
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        `)
        .run();


    await env.DB
        .prepare(`
            INSERT INTO sessions
            (
                token,
                user_id,
                username,
                expires_at
            )
            VALUES (?, ?, ?, ?)
        `)
        .bind(
            token,
            userId,
            user.username,
            expiresAt
        )
        .run();

}


/*
=========================================================
GET SESSION
=========================================================
*/

async function getSession(
    env,
    token
) {

    const session =
        await env.DB
            .prepare(`
                SELECT
                    token,
                    user_id,
                    username,
                    expires_at
                FROM sessions
                WHERE token = ?
            `)
            .bind(token)
            .first();


    if (!session) {

        return null;

    }


    /*
    -----------------------------------------------------
    EXPIRED
    -----------------------------------------------------
    */

    if (
        new Date(
            session.expires_at
        ).getTime()
        <= Date.now()
    ) {

        await deleteSession(
            env,
            token
        );

        return null;

    }


    return session;

}


/*
=========================================================
DELETE SESSION
=========================================================
*/

async function deleteSession(
    env,
    token
) {

    await env.DB
        .prepare(`
            DELETE FROM sessions
            WHERE token = ?
        `)
        .bind(token)
        .run();

}


/*
=========================================================
GET COOKIE
=========================================================
*/

function getSessionToken(
    request
) {

    const cookie =
        request.headers.get(
            "Cookie"
        );


    if (!cookie) {

        return null;

    }


    const match =
        cookie.match(
            /(?:^|;\s*)hyool_session=([^;]+)/
        );


    return match
        ? decodeURIComponent(match[1])
        : null;

}


/*
=========================================================
CREATE COOKIE
=========================================================
*/

function createSessionCookie(
    token
) {

    return [
        "hyool_session=" +
        encodeURIComponent(token),

        "Path=/",

        "Max-Age=" +
        (
            SESSION_DAYS *
            24 *
            60 *
            60
        ),

        "HttpOnly",

        "Secure",

        "SameSite=Lax"
    ].join("; ");

}


/*
=========================================================
CLEAR COOKIE
=========================================================
*/

function clearSessionCookie() {

    return [
        "hyool_session=",

        "Path=/",

        "Max-Age=0",

        "HttpOnly",

        "Secure",

        "SameSite=Lax"
    ].join("; ");

}


/*
=========================================================
PASSWORD HASH
PBKDF2 + SHA-256
=========================================================
*/

async function hashPassword(
    password
) {

    const encoder =
        new TextEncoder();


    const salt =
        crypto.getRandomValues(
            new Uint8Array(16)
        );


    const key =
        await crypto.subtle.importKey(
            "raw",

            encoder.encode(
                password
            ),

            "PBKDF2",

            false,

            ["deriveBits"]
        );


    const bits =
        await crypto.subtle.deriveBits(

            {
                name: "PBKDF2",

                salt,

                iterations: 100000,

                hash: "SHA-256"
            },

            key,

            256
        );


    return [

        "pbkdf2",

        "100000",

        bytesToHex(salt),

        bytesToHex(
            new Uint8Array(bits)
        )

    ].join("$");

}


/*
=========================================================
VERIFY PASSWORD
=========================================================
*/

async function verifyPassword(
    password,
    stored
) {

    const parts =
        stored.split("$");


    if (
        parts.length !== 4 ||
        parts[0] !== "pbkdf2"
    ) {

        return false;

    }


    const iterations =
        Number(parts[1]);


    const salt =
        hexToBytes(parts[2]);


    const expected =
        hexToBytes(parts[3]);


    const encoder =
        new TextEncoder();


    const key =
        await crypto.subtle.importKey(
            "raw",

            encoder.encode(
                password
            ),

            "PBKDF2",

            false,

            ["deriveBits"]
        );


    const bits =
        await crypto.subtle.deriveBits(

            {
                name: "PBKDF2",

                salt,

                iterations,

                hash: "SHA-256"
            },

            key,

            expected.length * 8
        );


    const actual =
        new Uint8Array(bits);


    if (
        actual.length !==
        expected.length
    ) {

        return false;

    }


    /*
    -----------------------------------------------------
    CONSTANT-TIME COMPARISON
    -----------------------------------------------------
    */

    let result = 0;


    for (
        let i = 0;
        i < actual.length;
        i++
    ) {

        result |=
            actual[i] ^
            expected[i];

    }


    return result === 0;

}


/*
=========================================================
BYTES → HEX
=========================================================
*/

function bytesToHex(
    bytes
) {

    return Array
        .from(bytes)
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(2, "0")
        )
        .join("");

}


/*
=========================================================
HEX → BYTES
=========================================================
*/

function hexToBytes(
    hex
) {

    const bytes =
        new Uint8Array(
            hex.length / 2
        );


    for (
        let i = 0;
        i < bytes.length;
        i++
    ) {

        bytes[i] =
            parseInt(
                hex.substr(
                    i * 2,
                    2
                ),
                16
            );

    }


    return bytes;

}

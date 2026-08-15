/*
=========================================================
HYOOL WORKER
=========================================================
*/

export default {

    async fetch(request, env) {

        const url = new URL(request.url);

        /*
        =====================================================
        CORS / 基础响应
        =====================================================
        */

        const corsHeaders = {
            "Access-Control-Allow-Origin": url.origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
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
                =============================================
                HEALTH
                =============================================
                */

                if (
                    url.pathname === "/api/health" &&
                    request.method === "GET"
                ) {

                    const result =
                        await env.DB
                            .prepare("SELECT 1 AS ok")
                            .first();

                    return Response.json({

                        success: true,

                        hyool: "alive",

                        database:
                            result?.ok === 1

                    }, {
                        headers: corsHeaders
                    });

                }


                /*
                =============================================
                REGISTER
                =============================================
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
                    -----------------------------------------
                    USERNAME VALIDATION
                    -----------------------------------------
                    */

                    if (
                        !/^[a-z0-9_-]{3,20}$/.test(
                            username
                        )
                    ) {

                        return Response.json({

                            success: false,

                            error:
                                "账号只能使用英文字母、数字、下划线和连字符，长度 3-20 位。"

                        }, {
                            status: 400,
                            headers: corsHeaders
                        });

                    }


                    /*
                    -----------------------------------------
                    PASSWORD VALIDATION
                    -----------------------------------------
                    */

                    if (password.length < 8) {

                        return Response.json({

                            success: false,

                            error:
                                "密码至少需要 8 位。"

                        }, {
                            status: 400,
                            headers: corsHeaders
                        });

                    }


                    /*
                    -----------------------------------------
                    CHECK USER
                    -----------------------------------------
                    */

                    const existing =
                        await env.DB
                            .prepare(
                                "SELECT id FROM users WHERE username = ?"
                            )
                            .bind(username)
                            .first();


                    if (existing) {

                        return Response.json({

                            success: false,

                            error:
                                "这个账号已经存在。"

                        }, {
                            status: 409,
                            headers: corsHeaders
                        });

                    }


                    /*
                    -----------------------------------------
                    CREATE USER ID
                    -----------------------------------------
                    */

                    const userId =
                        crypto.randomUUID();


                    /*
                    -----------------------------------------
                    PASSWORD HASH
                    -----------------------------------------
                    */

                    const passwordHash =
                        await hashPassword(
                            password
                        );


                    /*
                    -----------------------------------------
                    CREATE USER
                    -----------------------------------------
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
                    -----------------------------------------
                    CREATE PROFILE
                    -----------------------------------------
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
                    -----------------------------------------
                    RESPONSE
                    -----------------------------------------
                    */

                    return Response.json({

                        success: true,

                        user: {

                            id: userId,

                            username: username

                        }

                    }, {
                        status: 201,
                        headers: corsHeaders
                    });

                }


                /*
                =============================================
                LOGIN
                =============================================
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
                    -----------------------------------------
                    FIND USER
                    -----------------------------------------
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

                        return Response.json({

                            success: false,

                            error:
                                "账号或密码错误。"

                        }, {
                            status: 401,
                            headers: corsHeaders
                        });

                    }


                    /*
                    -----------------------------------------
                    VERIFY PASSWORD
                    -----------------------------------------
                    */

                    const valid =
                        await verifyPassword(
                            password,
                            user.password_hash
                        );


                    if (!valid) {

                        return Response.json({

                            success: false,

                            error:
                                "账号或密码错误。"

                        }, {
                            status: 401,
                            headers: corsHeaders
                        });

                    }


                    /*
                    -----------------------------------------
                    TEMPORARY SESSION
                    -----------------------------------------

                    第一版先返回用户身份。

                    下一阶段再接真正的
                    HttpOnly Session Cookie。
                    -----------------------------------------
                    */

                    return Response.json({

                        success: true,

                        user: {

                            id: user.id,

                            username:
                                user.username

                        }

                    }, {
                        headers: corsHeaders
                    });

                }


                /*
                =============================================
                UNKNOWN API
                =============================================
                */

                return Response.json({

                    success: false,

                    error: "API not found."

                }, {
                    status: 404,
                    headers: corsHeaders
                });


            } catch (error) {

                console.error(error);

                return Response.json({

                    success: false,

                    error:
                        "服务器发生错误。"

                }, {
                    status: 500,
                    headers: corsHeaders
                });

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
PASSWORD HASH
PBKDF2 + SHA-256
=========================================================
*/

async function hashPassword(password) {

    const encoder =
        new TextEncoder();


    const salt =
        crypto.getRandomValues(
            new Uint8Array(16)
        );


    const key =
        await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            "PBKDF2",
            false,
            ["deriveBits"]
        );


    const bits =
        await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",

                salt: salt,

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
PASSWORD VERIFY
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
            encoder.encode(password),
            "PBKDF2",
            false,
            ["deriveBits"]
        );


    const bits =
        await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",

                salt: salt,

                iterations: iterations,

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
HEX
=========================================================
*/

function bytesToHex(bytes) {

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


function hexToBytes(hex) {

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
                hex.substr(i * 2, 2),
                16
            );

    }


    return bytes;

}

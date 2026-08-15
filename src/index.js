export default {
    async fetch(request, env) {

        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);

        /* =====================================================
           API：获取个人资料
        ===================================================== */

        if (pathname.startsWith("/api/profile/")) {

            const username =
                pathname
                    .substring("/api/profile/".length)
                    .trim();

            if (!username) {

                return json({
                    success: false,
                    error: "missing_username"
                }, 400);

            }

            try {

                const result = await env.DB
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


                if (!result) {

                    return json({
                        success: false,
                        error: "profile_not_found"
                    }, 404);

                }


                return json({
                    success: true,
                    profile: result
                });

            }
            catch (error) {

                console.error(
                    "D1 profile error:",
                    error
                );

                return json({
                    success: false,
                    error: "database_error"
                }, 500);

            }

        }


        /* =====================================================
           个人彼岸
           
           /@333123
           /@Alice
           /@张三
        ===================================================== */

        if (
            pathname.startsWith("/@") &&
            pathname.length > 2
        ) {

            /*
             * 不让 Assets 去寻找：
             *
             * /@333123
             *
             * 而是统一返回：
             *
             * /yonder-home.html
             */

            return env.ASSETS.fetch(
                new Request(
                    new URL(
                        "/yonder-home.html",
                        request.url
                    ),
                    request
                )
            );

        }


        /* =====================================================
           首页 / 普通静态文件
        ===================================================== */

        return env.ASSETS.fetch(request);

    }
};


/* =========================================================
   JSON RESPONSE
========================================================= */

function json(data, status = 200) {

    return new Response(
        JSON.stringify(data),
        {
            status,

            headers: {
                "Content-Type":
                    "application/json; charset=UTF-8",

                "Cache-Control":
                    "no-store"
            }
        }
    );

}

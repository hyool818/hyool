export default {
    async fetch(request, env) {

        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);

        /* =====================================================
           1. API：获取个人资料
        ===================================================== */

        if (pathname.startsWith("/api/profile/")) {

            const username = pathname
                .substring("/api/profile/".length)
                .trim();

            if (!username) {
                return json({
                    success: false,
                    error: "missing_username"
                }, 400);
            }

            try {

                const profile = await env.DB
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
                        error: "profile_not_found"
                    }, 404);

                }

                return json({
                    success: true,
                    profile: profile
                });

            } catch (error) {

                console.error(
                    "D1 ERROR:",
                    error
                );

                return json({
                    success: false,
                    error: "database_error",
                    message: error.message
                }, 500);
            }
        }


        /* =====================================================
           2. 个人彼岸
           
           /@333123
           /@Alice
           /@张三
        ===================================================== */

        if (
            pathname.startsWith("/@") &&
            pathname.length > 2
        ) {

            const username = pathname
                .substring(2)
                .trim();

            /*
             * 先检查用户是否存在
             */

            try {

                const profile = await env.DB
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
                            status:404,

                            headers:{
                                "Content-Type":
                                    "text/plain; charset=UTF-8"
                            }
                        }
                    );

                }

            } catch (error) {

                console.error(
                    "PROFILE LOOKUP ERROR:",
                    error
                );

                return json({
                    success:false,
                    error:"database_error",
                    message:error.message
                },500);

            }


            /*
             * 用户存在
             *
             * 内部读取 yonder-home.html
             *
             * 浏览器地址栏仍然保持：
             *
             * /@333123
             */

            const assetUrl = new URL(
                "/yonder-home.html",
                request.url
            );

            return env.ASSETS.fetch(
                new Request(
                    assetUrl.toString(),
                    {
                        method:"GET",
                        headers:request.headers
                    }
                )
            );

        }


        /* =====================================================
           3. 普通静态文件
        ===================================================== */

        return env.ASSETS.fetch(request);

    }
};


/* =========================================================
   JSON
========================================================= */

function json(data, status = 200) {

    return new Response(
        JSON.stringify(data),
        {
            status:status,

            headers:{
                "Content-Type":
                    "application/json; charset=UTF-8",

                "Cache-Control":
                    "no-store"
            }
        }
    );

}

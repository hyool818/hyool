export default {
    async fetch(request, env) {

        const url = new URL(request.url);
        const pathname = url.pathname;


        /* =====================================================
           1. API：健康检查
        ===================================================== */

        if (pathname === "/api/health") {

            let database = false;

            try {

                await env.DB
                    .prepare("SELECT 1")
                    .first();

                database = true;

            } catch (error) {

                database = false;

            }

            return json({
                success: true,
                hyool: "alive",
                database
            });

        }


        /* =====================================================
           2. API：获取用户资料
           
           /api/profile/333123
        ===================================================== */

        if (pathname.startsWith("/api/profile/")) {

            const username =
                decodeURIComponent(
                    pathname
                        .replace("/api/profile/", "")
                );


            if (!username) {

                return json(
                    {
                        success:false,
                        error:"USERNAME_REQUIRED"
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
                            success:false,
                            error:"USER_NOT_FOUND"
                        },
                        404
                    );

                }


                return json({

                    success:true,

                    profile

                });


            } catch(error) {

                return json(
                    {
                        success:false,
                        error:"DATABASE_ERROR"
                    },
                    500
                );

            }

        }


        /* =====================================================
           3. @用户名 路由
           
           例如：
           
           /@333123
           
           /@hyool818
           
           /@小明
        ===================================================== */

        if (pathname.startsWith("/@")) {

            /*
             * 不在 Worker 这里直接查询页面内容。
             *
             * 我们先确认用户名存在，
             * 然后把页面交给 yonder-home.html。
             */

            const username =
                decodeURIComponent(
                    pathname.substring(2)
                );


            if (!username) {

                return new Response(
                    "User not found",
                    {
                        status:404,
                        headers:{
                            "content-type":
                                "text/plain;charset=UTF-8"
                        }
                    }
                );

            }


            /*
             * 查询 D1
             */

            try {

                const profile =
                    await env.DB
                        .prepare(`
                            SELECT
                                username
                            FROM profiles
                            WHERE username = ?
                            LIMIT 1
                        `)
                        .bind(username)
                        .first();


                /*
                 * 用户不存在
                 */

                if (!profile) {

                    return new Response(
                        "彼岸不存在",
                        {
                            status:404,
                            headers:{
                                "content-type":
                                    "text/plain;charset=UTF-8"
                            }
                        }
                    );

                }


                /*
                 * 用户存在。
                 *
                 * 加载 yonder-home.html
                 */

                const assetRequest =
                    new Request(
                        new URL(
                            "/yonder-home.html",
                            request.url
                        ),
                        request
                    );


                const response =
                    await env.ASSETS.fetch(
                        assetRequest
                    );


                /*
                 * 找不到页面
                 */

                if (!response.ok) {

                    return new Response(
                        "yonder-home.html not found",
                        {
                            status:500
                        }
                    );

                }


                /*
                 * 把用户名写进响应 Header。
                 *
                 * 前端可以读取：
                 *
                 * X-Hyool-Username
                 */

                const headers =
                    new Headers(
                        response.headers
                    );

                headers.set(
                    "X-Hyool-Username",
                    username
                );


                return new Response(
                    response.body,
                    {
                        status:response.status,
                        headers
                    }
                );


            } catch(error) {

                return new Response(
                    "Server Error",
                    {
                        status:500,
                        headers:{
                            "content-type":
                                "text/plain;charset=UTF-8"
                        }
                    }
                );

            }

        }


        /* =====================================================
           4. 其他请求
           
           交给 Cloudflare Assets
           
           index.html
           yonder.html
           yonder-home.html
           logo
           mp4
           等等
        ===================================================== */

        return env.ASSETS.fetch(request);

    }

};



/* =========================================================
   JSON RESPONSE
========================================================= */

function json(data, status = 200) {

    return new Response(
        JSON.stringify(data, null, 2),
        {
            status,

            headers:{
                "content-type":
                    "application/json;charset=UTF-8",

                "cache-control":
                    "no-store"
            }
        }
    );

}

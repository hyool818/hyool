export default {

    async fetch(request, env) {

        const url = new URL(request.url);


        /*
        =====================================================
        API
        =====================================================
        */

        if (url.pathname === "/api/health") {

            try {

                const result = await env.DB
                    .prepare("SELECT 1 AS ok")
                    .first();

                return Response.json({
                    success: true,
                    hyool: "alive",
                    database: result?.ok === 1
                });

            } catch (error) {

                return Response.json({

                    success: false,

                    hyool: "alive",

                    database: false,

                    error: error.message

                }, {
                    status: 500
                });

            }

        }


        /*
        =====================================================
        其他请求
        → 正常网站文件
        =====================================================
        */

        return env.ASSETS.fetch(request);

    }

};

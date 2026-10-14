# AI 伴侣（TA）· 独立产品线说明

> **本文件与 HYOOL 主站无关，是两个东西。**
>
> | | HYOOL 主站 | AI 伴侣（TA） |
> |---|---|---|
> | 文档 | `docs/MASTER_SPEC.md` + `docs/FEATURES.md` | **本文件** |
> | 页面 | `public/*.html`（几十个） | **只有** `public/ta.html` |
> | 后端 | `src/index.js` + `src/mvp.js` + `src/hub/`（D1/R2/Vectorize 全用） | **只有** `src/ta/`（免登录、不碰任何表） |
> | 账号 | 需要注册 / 登录 | **没有账号概念**（按 IP 限流） |
> | 数据 | D1 表 + R2 + 向量索引 | **只有浏览器 localStorage** |
> | 模型 | 多模型注册表 `src/ai/models.js` | **只有** Workers AI + DeepSeek（`src/ta/models.js`） |
> | 定位 | 内容平台（世界 / 角色 / 作品 / 社区） | **AI 实体伴侣的底层软件**（后期烧录进固件） |
>
> **刻意约定**：TA **不在** `docs/FEATURES.md` 登记，以免和 HYOOL 功能表混淆 —— 这不是遗漏，是刻意隔离。
> 做 TA 的活：**只读本文件 + `public/ta.html` + `src/ta/`**，不要顺带读/改 `src/` 里的其它文件。
> 做 HYOOL 的活：读 `MASTER_SPEC.md` + 对应 FEATURES 条目。

## 1. 定位（v2）

一个**可移植的 AI 伴侣底层软件**：页面能直接被浏览器打开（`https://hyool.com/ta`），后期也能整体烧进固件 —— 换掉「传输层」，引擎一行不改。

三件事构成它的全部：

1. **像人**：人设只允许改预设项（性别 / 音色 / 性格 / 预设名），台词由 LLM 生成，但经过「去 AI 味」提示词约束 + 输出清洗，禁止助手腔、客服腔、Markdown。
2. **不停**：断网 / 模型挂 / 超时 → 立刻回落本机模板台词库（预设量足够多），绝不出现「哑巴」或「网络错误」这类系统提示。
3. **不散**：TA 有独立后端 `src/ta/`、独立文档（本文件）、独立提交前缀（`feat(ta):` / `fix(ta):`）；删掉 TA，主站照常运行。

## 2. 红线（改 TA 时不允许做的事）

| 禁止 | 原因 |
|---|---|
| 调用主站业务接口：`/api/buddy/*`、`/api/companion/*`、`/api/hub/*`、`/api/me` 等 | 那是 HYOOL 后端；一调用就把 TA 和主站账号体系绑死 |
| 用需登录的 `/api/tts`（`src/index.js` 里那个） | TA 没有登录态；TA 的语音走自己的 `/api/ta/tts`（同实现，不同入口） |
| 读主站数据：D1 任何表、R2、Vectorize、`hyool_token` / session | TA 不与主站共享状态，TA 只用自己的 localStorage 键 `hyool-ta-v1` |
| 引用 `src/` 里除 `src/ta/` 之外的文件（**唯一例外：`src/tts.js`**，见 §7） | 「TA 的代码都在 `src/ta/`」是硬边界 |
| 修改 `docs/FEATURES.md`、`docs/MASTER_SPEC.md` 来「登记」TA | 本文件是 TA 的唯一登记处 |
| 把 TA 的改动混进 HYOOL 的 commit | 便于回滚与定位 |
| 做自由文本人设 / 形象上传 / 自定义提示词 | 产品上明确「只支持预设基础信息」，同时堵死提示词注入 |

**隔离自检**（主站业务接口应为 0 命中）：

```powershell
Select-String -Path public\ta.html -Pattern '/api/(buddy|companion|hub|me|invite|yonder|posts|tts/voices)'
```

## 3. 文件与地址

| 项 | 值 |
|---|---|
| 页面 | `public/ta.html`（单文件 HTML+CSS+JS，无外部依赖） |
| 后端 | `src/ta/models.js`（模型注册表）、`src/ta/prompt.js`（人设预设 + 提示词 + 去 AI 味）、`src/ta/index.js`（`/api/ta/*` 路由） |
| 挂载点 | `src/index.js` 顶部 `import { handleTaRoutes } from "./ta/index.js";`，在 TTS 段之前调用一次（约 20 行，主站逻辑零改动） |
| 线上地址 | **`https://hyool.com/ta`**（`/ta.html` → 307 → `/ta`） |
| 本地预览 | `python -m http.server 8099 --directory public` → `http://<局域网IP>:8099/ta.html`（此时没有后端，页面自动全量走本机模板 + 系统语音） |
| 上线 | push 到 `main` → `.github/workflows/deploy.yml` 自动 `wrangler deploy` |
| 索引 | `<meta name="robots" content="noindex,nofollow">` —— 搜索引擎不收录 |

> **`.html` 只是磁盘文件名，不是网址。** Cloudflare 静态资源 `html_handling = auto-trailing-slash`：`/ta` 直接 200 返回 `ta.html`。**不要**去 `src/index.js` 给 `/ta` 加页面路由，加了反而多此一举。

**状态（2026-10-14）**：v2 前后端都已落地 —— 后端 **52 项**断言全绿、页面 **45 项**沙箱断言全绿、真实浏览器冒烟 **26 项 SMOKE-OK**（本地没有后端时也会回落本机兜底，已验证）。下次改动前，先按 §12 跑这三份脚本。

## 4. 架构：三层 + 固件移植契约

| 层 | 在哪 | 规则 |
|---|---|---|
| **引擎层**（可移植核心） | `public/ta.html` 内 `TA_CORE` 段：意图识别、记忆抽取、心情、关系阶段、模板台词库、选句（防重复） | **纯函数**：不碰 DOM、不碰网络、不碰时间以外的全局。固件端可整段原样搬走 |
| **传输层**（唯一联网口） | `TA_API`：`/api/ta/chat`、`/api/ta/tts`、`/api/ta/asr`、`/api/ta/config` | 只有这一处允许 `fetch`。换成设备本地模型 = 只改这一处 |
| **表现层** | `public/ta.html` 其余部分（DOM / 语音播放 / 麦克风 / 设置） | 只调用引擎层与传输层，不直接发请求 |

**移植契约**（烧固件时必须满足）：

1. 引擎层函数签名不变，输入输出都是纯数据（`text` / `ctx` / `state`）。
2. 传输层对外只暴露 4 个方法：`chat()` / `tts()` / `asr()` / `config()`；固件版把 `chat()` 换成设备端模型推理即可。
3. 状态结构 = `localStorage` 里那一份 JSON（`hyool-ta-v1`），固件端换成 flash / NVS 读写，字段不变。
4. 所有「联网失败」的判定都收敛在传输层，引擎层永远只负责「有话说」。

## 5. 后端接口（`src/ta/index.js`）

免登录、免 D1：额度靠「每 IP 分钟窗口 + 当日上限」的内存限流（isolate 级，够挡顺手乱刷）。所有失败都是**软失败**，页面据此静默回落本机兜底。

| 接口 | 入参 | 出参 | 失败行为 |
|---|---|---|---|
| `GET /api/ta/config` | — | 模型清单 / 音色池 / 预设 / 功能开关 / 限额 / `tts.{chain,local,local_voices}` | 页面用内置预设继续跑 |
| `POST /api/ta/chat` | `message`、`persona`、`recent[]`、`memories[]`、`mood`、`intimacy`、`model?`、`channel?` | `{ reply, model, latency_ms }` | `success:false` + `code`，页面走模板 |
| `POST /api/ta/tts` | `text`(≤300)、`voice`、`rate`、`pitch`、`volume` | `audio/wav` 或 `audio/mpeg`（按命中的合成层）+ 响应头 `X-TA-TTS-Provider`（`gptsovits` / `melotts`）/ `X-TA-TTS-Voice` | 两层都失败 → **502 `TTS_UNAVAILABLE`**（`attempts[]` 带每层原因），页面改设备本地 `speechSynthesis` |
| `POST /api/ta/asr` | `audio`(base64)、`language?` | `{ text }`（Whisper） | 页面提示重说 / 用浏览器本地识别 |
| `POST /api/ta/image` | — | **501 `COMING_SOON`** | 页面按钮是锁定态 |

**限额**：chat 18/分、240/日；tts 24/分、320/日；asr 8/分、120/日；config 60/分。单请求上限：输入 500 字、回带 8 轮对话 + 12 条记忆、TTS 300 字、返回台词 ≤200 字。

**环境变量**（全部可选，都不填 TA 也能跑）：

| 变量 | 作用 |
|---|---|
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 复用 HYOOL 同一份 Secret（见 `.dev.vars.example`） |
| `TA_MODEL` | 默认模型 id（`cf-llama` / `ds-chat` / …），不填 = `cf-llama` |
| `TA_ASR_MODEL` | Whisper 模型覆盖（默认 `@cf/openai/whisper-large-v3-turbo` → 回退 `@cf/openai/whisper`） |
| `TA_TTS_MODEL` | 站内合成层模型（默认 `@cf/myshell-ai/melotts`） |
| `TA_TTS_LOCAL_URL` | **自建 GPT-SoVITS** 的地址（只填域名，`/tts` 路径由代码补）。不填 = 该层不参与链（见 §7） |
| `TA_TTS_LOCAL_REF` | 默认参考音频路径（**自建机器上的本地路径**，不是 URL）：没配 `TA_TTS_LOCAL_VOICES` 时所有音色共用它 |
| `TA_TTS_LOCAL_VOICES` | JSON：音色 id → `{ref, prompt, prompt_lang}`，给每个音色配各自的参考音频（写坏 = 当没配处理，不报错） |
| `TA_TTS_LOCAL_PROMPT_TEXT` / `TA_TTS_LOCAL_PROMPT_LANG` | 默认参考音频对应的文本 / 语种（默认 `zh`） |
| `TA_TTS_LOCAL_TEXT_LANG` | 要合成的文本语种（默认 `zh`） |
| `TA_TTS_LOCAL_MEDIA` | 自建层返回格式 `wav` / `mp3` / `ogg` / `aac`（默认 `wav`） |
| `TA_TTS_LOCAL_TOKEN` | 自建**网关**（§7）的 token：填了自建层就带 `Authorization: Bearer`。注意 `api_v2.py` 本身不认这个头 —— 真正挡住白嫖的是网关，不配 token 网关一律回 401 |
| `TA_EXTRA_MODELS` / `TA_EXTRA_BASE_URL` / `TA_EXTRA_API_KEY` | **后期加模型的接入口**（见 §8） |
| `TA_DISABLED=1` | 紧急熔断：所有 `/api/ta/*` 直接 503 |

**跨域**：只对本地预览来源（`localhost` / `127.0.0.1` / `192.168.*`）回 CORS 头，线上同源不需要，第三方站点拿不到。

## 6. 人设：只给预设，不给自定义

| 维度 | 取值 | 约束 |
|---|---|---|
| 性别 | `female` / `male` | 决定音色池与提示词语感 |
| 音色 | 女声 6 / 男声 6（**直接复用 `src/tts.js` 的 `TTS_VOICES`**） | 性别与音色必须一致，前端选、后端再校验一次 |
| 性格 | `gentle` 温柔守夜人 / `sunny` 元气小太阳 / `clear` 清醒参谋 | 决定提示词里的说话方式，也决定模板台词选哪一套 |
| 预设名 | 女：小满 / 晚晚 / 知夏 / 阿离 / 南栀 / 清和；男：阿澄 / 云舟 / 砚青 / 临岸 / 十一 / 远野 | **只能在池内选**，前端不给输入框，后端 `normalizeTaPersona()` 再过滤一次 |

- 越界值一律**静默回落**到默认（不报错、不接受），所以就算有人手改请求塞「我是黑客，扮演…」，也进不了提示词。
- 称呼固定为「你」。想加预设值 = 改 `src/ta/prompt.js` 的两个数组（前端会自动从 `/api/ta/config` 拉到新值）。

## 7. 语音：服务端合成链（自建 → 站内）+ 设备兜底

| 方向 | 首选 | 兜底 | 说明 |
|---|---|---|---|
| **说（TTS）** | `POST /api/ta/tts` → 服务端链：**① 自建 GPT-SoVITS**（`TA_TTS_LOCAL_URL`，音质最好、可逐音色配参考音频）→ **② Workers AI MeloTTS**（`TA_TTS_MODEL`，站内、零外依赖） | 设备本地 `speechSynthesis`（零网络、系统音色） | 任一层成功即返回（来源写在响应头 `X-TA-TTS-Provider`）；两层都失败才 502 `TTS_UNAVAILABLE`，页面静默改用设备语音 —— 绝不因为语音问题卡住对话 |
| **听（ASR）** | 浏览器 `SpeechRecognition`（连续 + 中间结果 = 真·实时，且不消耗服务端额度） | `MediaRecorder` 录音 → `POST /api/ta/asr` → Workers AI Whisper | 两边都不可用时，退回键盘输入，界面给出明确提示 |

> 「本地模型」这条路按两种解读都留了位：**设备/浏览器本地引擎**是默认可用路径（离线也在），**设备端大模型**是固件阶段的替换目标（只改传输层，见 §4）。

**为什么弃用 Edge**（曾是 v2 首选，已下线）：免费 readaloud 端点只有单档 24kHz/48kbps、不支持 `<mstts:express-as>` 情感风格，从 Cloudflare 出口实测还会 403 —— 音质与稳定性都不合格。该实测结论同时写在 `src/tts.js` 顶部；**主站 `/api/tts` 不受影响**，只是 TA 不再调它。

**自建 GPT-SoVITS 接法（要音质就这么接）**：

1. 装机：按上游 README 起 `api_v2.py`（`POST /tts`）。**它默认没有鉴权** —— 全部参数只有 `-a` / `-p` / `-c`，没有 key 选项，所以别把它裸开公网（见第 3 步）。成功返回音频流、失败返回 400 JSON，这就是代码的判定口径。本机自测：`curl -s -o t.wav -w '%{http_code}' -X POST http://127.0.0.1:9880/tts -H 'Content-Type: application/json' --data-binary @body.json`。
2. 参考音频：准备 3~10 秒干净人声（就是这个人设的语气样本），路径填 `TA_TTS_LOCAL_REF`（自建机器上的本地路径）。要一人一音色就用 `TA_TTS_LOCAL_VOICES`：

   ```json
   {"zh-CN-XiaoxiaoNeural":{"ref":"/opt/gptsovits/refs/xiaoman.wav","prompt":"今天有点累，早点休息。","prompt_lang":"zh"}}
   ```

3. **加一层鉴权网关**（必做）：`powershell -ExecutionPolicy Bypass -File .\scripts\start-ta-tts-proxy.ps1`

   - 网关监听 `127.0.0.1:9881`，只放行 `POST /tts`（其余 404 / 405，请求体上限 64 KiB），校验 `Authorization: Bearer <token>`，不对就 **401**；token 走常量时间比较，日志只记状态 / 耗时 / 大小（不记文本、不记 token）。
   - token 首次由脚本生成到 `scripts/.tools/ta-tts-token.txt`（已 gitignore），之后复用同一份；也可用环境变量 `TA_TTS_PROXY_TOKEN` 覆盖。
   - 自测口径：带 token 打 `http://127.0.0.1:9881/tts` → 200 + `audio/wav`；不带 token → 401。
4. 让 Worker 连得上：家里机器没公网 IP 就开隧道，**指向网关的 9881（不是裸 9880）**：`cloudflared tunnel --url http://127.0.0.1:9881` → 拿到 `https://xxxx.trycloudflare.com`，填 `TA_TTS_LOCAL_URL`（**只填域名**，`/tts` 由代码补；填完整端点也兼容），再 `npx wrangler secret put TA_TTS_LOCAL_TOKEN`（粘贴上面那串 token）。网关 / 隧道 / 本机任一环挂了都不影响 TA：自动落到 MeloTTS。
5. 开好了怎么确认：`/api/ta/config` 的 `tts.chain` 会变成 `["gptsovits","melotts"]`、`tts.local = true`、`tts.local_voices` 列出已配参考音频的音色 id；实测口径是 `POST /api/ta/tts` 的响应头 `X-TA-TTS-Provider: gptsovits`（没接通就是 `melotts`）。页面「音色来源 = 云端」时状态栏会显示实际命中的层。

**参数口径**：`rate`（`+20%` / `-60%`）会换算成自建层的 `speed_factor`（clamp 0.5~2）；`pitch` / `volume` 仍然接收并校验格式（前端契约不变），但当前链上没有支持 SSML prosody 的引擎，**不再改变合成结果**。

**谁在用哪条腿**：页面「音色来源」默认 = 本机（设备语音，不消耗额度）；显式切到云端才走服务端链（24/分、320/日 限额）。

**换行 / 打断**：TA 说话期间用户按下麦克风 → 立即停止播放与合成；新台词开始前会取消上一段语音，避免叠音。

## 8. 模型：固定两家 + 一个接入口

| 注册 id | 标签 | provider | 状态 |
|---|---|---|---|
| `cf-llama` | Cloudflare · llama3.3-70B | `workers-ai`（`env.AI.run`，免密钥） | 默认主力 |
| `ds-chat` | DeepSeek · chat | `deepseek`（OpenAI 兼容，`DEEPSEEK_API_KEY`） | 配了 Key 自动 online |
| `extra` | 扩展模型（预留） | `openai-compatible` | 配了 `TA_EXTRA_*` 才 online |

- **只认注册表 id**：请求里塞别的模型名一律回落默认，防止有人拿 TA 白嫖任意模型。
- **容灾链**：`taModelChain()` 把「用户选的 → DeepSeek → Workers AI」按序排好并去重，逐个尝试；某个挂了自动换下一个，全挂才软失败。没配 Key / 没绑 AI 的模型**不会**被放进链里（不白等一次网络超时）。
- **后期加模型 = 加一行**（`TA_MODELS` 或 `TA_EXTRA_MODELS`），调用方（`src/ta/index.js`、页面）都不用改。原生支持任何 OpenAI 兼容端点，所以自建 GPU / 其它云厂商都能直接接。

## 9. 图片生成：接口占位、界面锁定（后期待开放）

- `/api/ta/image` 已注册，固定返回 **501 + `code: COMING_SOON`**；`/api/ta/config` 里 `features.image === false`。
- 页面上的图片按钮是**锁定态**（点了给一句人话提示，不是报错弹窗）。
- 真开放时要做的事：实现该路由（`env.AI.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", …)` 或复用主站的 pollinations 直链）、把 `features.image` 翻成 `true`、在本文档记一笔。

## 10. 兜底策略（核心：不能变智障）

| 场景 | 表现 |
|---|---|
| 断网 / 离线 | 页面**不发请求**，直接用本机模板回应；`navigator.onLine` 变化会提示一次「我先离线记着」类台词 |
| 模型超时（9s）/ 报错 | 静默回落模板，回复里带一句自然的「刚走神了一下」式补丁，**不出现**「网络错误」「请求失败」 |
| LLM 回了 AI 腔 | 服务端 `humanizeTaReply()` 先擦（去 Markdown / 去助手腔 / 限长 / 限 emoji）；擦完为空则页面用模板 |
| 用户说的没模板 | 兜底台词库（`fallback` + `offline` + `confused` 三组）负责接住，且带「防重复窗口」，连回合不会复读同一句 |
| 记忆为空却问「还记得吗」 | 固定话术说明还没记录（**绝不编造**） |
| 语音合成失败 | 换设备本地语音引擎；再失败就只显示文字，不停对话 |

台词库要求：每个意图 × 每种语气 **≥5 条**，`fallback` / `offline` / `confused` **各 ≥12 条**；选句用 `(轮次 + 字数) % 条数` 的确定性取模 + 最近使用窗口，保证多样性可复现。

## 11. 数据与隐私

- 唯一存储键：**`hyool-ta-v1`**（localStorage）。键名里的 `hyool-` 只是命名前缀，**不代表与主站有数据往来**。
- 内容：人设预设、消息记录、记忆条目、心情值、亲密值、语音开关。
- 每次对话**只**把「最近 8 轮 + 12 条记忆 + 当前心情/亲密」发给 `/api/ta/chat`，不带设备标识、不写库、不落盘；服务端日志只有一行失败原因，密钥会被打码。
- 换键 / 改键名 = 老数据不再读取（等于清空）；「⟲」重新设置伴侣（二次确认，保留对话与记忆）；「清空全部本机数据」= 真删除（二次确认）。
- 除 `/api/ta/*` 之外没有任何读写入口，没有 Cookie、没有上报、没有跨页共享。

## 12. 自测

仓库内没有 TA 的测试文件（刻意不污染 `public/`）；两份临时脚本放 `%TEMP%`，跑完即可丢：

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `%TEMP%\ta-check\tests.mjs`（配合 `%TEMP%\ta-check\` 里 `src/ta/*` + `src/tts.js` 的镜像与 `package.json`） | **52 项**后端断言：人设越界回落（性别/名字/性格/跨性别音色）、提示词注入与去 AI 感约束、`humanizeTaReply` 去 Markdown/去 AI 腔/限长/限 emoji、模型注册表与容灾链去重、`TA_EXTRA_MODELS` 接入口、config 形状、chat 成功/失败/无 binding/空输入/越界人设不进提示词、**tts 合成链**（自建层优先 + 请求体逐字段透传、参考音频逐音色映射与默认回落 + Bearer、`+20%`→`speed_factor`、自建 400 自动降级 MeloTTS、未配地址不外呼、两层都挂 502 且 `attempts` 带原因、映射表写坏容错、`tts.{chain,local,local_voices}` 暴露）、tts 四类参数校验、asr 三态、image 501、非 `/api/ta` 放行、未知路径 404、方法 405、`TA_DISABLED` 503、同 IP 429、跨域白名单 | `=== ALL PASSED ===`（52 ok / 0 FAIL） |
| `%TEMP%\ta-page-check.mjs`（读 `d:/hyool/public/ta.html`，Node `vm` 沙箱 + 假 localStorage） | **45 项**页面断言：静态契约（单脚本单样式、无外链、只调 `/api/ta/*`、占位符集合、无 v1 遗留字段、锁定态按钮、音色来源文案已跟上合成链）、`vm.Script` 解析与执行、四大预设池、人设越界与 v1 迁移、13×3 台词条数与兜底三组 ≥12、39 条回复无空无占位符残留、`recall` 不编造、兜底两段式且无技术词、`pickFresh` 防复读、13 类意图边界、记忆抽取噪声、情绪打分、5 级阶段、传输层 11 种软失败（离线/网络错/HTTP 429/服务端软失败/成功透传/config 覆盖音色池/config 同步合成层/tts 成功记下来源与音色/响应无 headers/tts null/asr 空串） | `=== ALL PASSED ===`（45 ok / 0 FAIL） |
| `%TEMP%\ta-smoke\{server.mjs, smoke.html}` + 仓库自带 `run-browser-test.ps1`（headless Chrome + CDP，iframe 驱动真实页面） | **26 项**浏览器冒烟：预设渲染数量、切性别后音色/名字池联动、无自由输入框、开始对话后浮层关闭 + 顶栏名字 + 开场白、语音开关、图片锁定、状态栏人话、音色来源可切换且文案说明服务端合成、切换后状态栏同步、**无后端时仍回话**（本机兜底）、记忆抽屉与统计 | `TITLE: SMOKE-OK`（26 PASS / 0 FAIL） |

临时脚本的重建方法（每次改完代码先跑，别只靠浏览器手测）：

```powershell
$dst = Join-Path $env:TEMP 'ta-check'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'src\ta') | Out-Null
Copy-Item 'd:\hyool\src\ta\*.js' (Join-Path $dst 'src\ta') -Force
Copy-Item 'd:\hyool\src\tts.js' (Join-Path $dst 'src\tts.js') -Force
Set-Content (Join-Path $dst 'package.json') -Value '{"type":"module"}' -Encoding utf8
# 再把 tests.mjs 放进 $dst，然后：
cd $dst; node tests.mjs        # 期望 === ALL PASSED ===（52 项后端）

# 页面沙箱跑测（把 ta-page-check.mjs 放进 %TEMP%）：
node "$env:TEMP\ta-page-check.mjs"      # 期望 === ALL PASSED ===（45 项）

# 真实浏览器冒烟（本地静态服务器 + 仓库自带 CDP 驱动；ta.html 必须和 smoke.html 同源）：
#   建 %TEMP%\ta-smoke\：拷入 public\ta.html、smoke.html、server.mjs
Start-Process node -ArgumentList 'server.mjs' -WorkingDirectory "$env:TEMP\ta-smoke" -WindowStyle Hidden
powershell -NoProfile -File .\run-browser-test.ps1 -Url 'http://127.0.0.1:8123/smoke.html' `
  -OutFile "$env:TEMP\ta-smoke\smoke-out.txt" -TimeoutSec 90      # 期望 TITLE: SMOKE-OK（26 PASS / 0 FAIL）
```

## 13. 已完成 / 未做

**已完成（v2 全量）**

- **后端**：`src/ta/models.js`（Workers AI + DeepSeek 固定两家、`openai-compatible` 接入口、容灾链）、`src/ta/prompt.js`（四项人设预设、去 AI 味提示词、输出清洗）、`src/ta/index.js`（`/api/ta/config|chat|tts|asr|image`，免登录、按 IP 限流、`TA_DISABLED` 熔断、日志密钥打码），挂载进 `src/index.js`（约 20 行，主站逻辑零改动）。TTS 只从 `src/tts.js` 借音色表 `TTS_VOICES`，**不再复用它的 Edge 实现**（Edge 已从 TA 链上下线，主站 `/api/tts` 照旧）。
- **页面**：设置页改为四项预设选择器（性别 / 音色 / 性格 / 预设名，**取消自由输入**）；回复链路「LLM 优先 → 超时/失败/断网立刻回落本机模板」；语音输出三层（云端链「自建 GPT-SoVITS → 站内 MeloTTS」→ 设备 `speechSynthesis`，来源与命中层在状态栏可见）；语音输入两条路（浏览器本地识别 → `MediaRecorder` + Whisper）；说话打断（用户一开口就停播）；图片按钮锁定态 + 人话提示；台词库扩容（每意图每语气 ≥5 条，`fallback` / `offline` / `confused` 各 ≥12 条）+ 防复读窗口；底部状态栏用人话显示在线/离线。
- **测试**：后端 54 项、页面 45 项、真实浏览器冒烟 26 项，全绿。

**未做（按需再做，勿默认动手）**

1. **图片生成真开放**：实现 `/api/ta/image`、把 `features.image` 翻 `true`、按钮解锁。
2. **模型扩展**：填 `TA_EXTRA_*` 或 `TA_EXTRA_MODELS` 即可接第三方；要更深的多模型切换 UI 再说。
3. **收录与入口**：`noindex,nofollow` → `index,follow`（需补 canonical / og）；在主站加入口 —— **违背隔离原则，默认不做**。
4. **固件侧**：把 `TA_CORE` 段与传输层契约（§4）搬到设备端，`chat()` 换成设备模型推理；状态改用 flash / NVS。
5. **真机联调**：iOS Safari 的 `speechSynthesis` 首播需要用户手势、麦克风权限弹窗文案、弱网降级手感。

## 14. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-14 | 初版落地：`public/companion.html` → 定名 **TA**、改名 `public/ta.html`、存储键统一为 `hyool-ta-v1`，上线 `https://hyool.com/ta`。 |
| 2026-10-14 | 路由：把「改TA / TA / AI 伴侣」触发词写进 `AGENTS.md` 与 `.cursor/rules/hyool-agent.mdc`。 |
| 2026-10-14 | **v2 后端**：新增 `src/ta/`（模型注册表 / 人设预设与「去 AI 味」/ `/api/ta/*` 路由），挂载进 `src/index.js`；TTS 复用 `src/tts.js`；图片生成以 `COMING_SOON` 占位；43 项自测全绿。**隔离状态变更**：TA 从「零接口」变为「只连自己的 `/api/ta/*`」，本文件为该破例的唯一记录处。 |
| 2026-10-14 | **v2 页面**：`public/ta.html` 升级 —— 人设四项预设选择器（取消自由输入）、LLM 优先 + 模板兜底链路、语音输出/输入双层、说话打断、图片锁定态、台词库扩容（防复读窗口）、在线/离线人话状态栏、v1 存档自动迁移（同键 `hyool-ta-v1`）。页面 41 项沙箱 + 24 项浏览器冒烟全绿；顺手修掉「全新用户点开始对话后不开场」的静默缺陷。 |
| 2026-10-14 | **TTS 换链（弃用 Edge）**：TA 的合成不再走 Edge（免费 readaloud 只有单档 24kHz/48kbps、无 `<mstts:express-as>` 情感风格、CF 出口实测 403），改为「**自建 GPT-SoVITS → 站内 Workers AI MeloTTS → 设备语音**」；`/api/ta/tts` 返回真实 `Content-Type`（wav/mp3）+ 响应头 `X-TA-TTS-Provider` / `X-TA-TTS-Voice`，两层都失败才 502 `TTS_UNAVAILABLE`（`attempts[]` 带每层原因）；`rate` 换算成自建层 `speed_factor`，`pitch`/`volume` 仍校验但不再影响输出；`/api/ta/config` 新增 `tts.{chain,local,local_voices}`；新增 `TA_TTS_LOCAL_*` 一组环境变量（§5/§7）。文档 §7 补 GPT-SoVITS 装机 + 隧道接法。后端 52 项 / 页面 45 项 / 冒烟 26 项全绿。 |
| 2026-10-14 | **自建 GPT-SoVITS 落地 + 鉴权网关**：`api_v2.py` 端到端实测打通 —— Worker 的请求体原样可用（v2 底模 32 kHz / v2Pro 32 kHz / v4 48 kHz 三档都出音频，单句 1.4~2.7 s，`/set_gpt_weights` + `/set_sovits_weights` 可热切权重）；新增 `scripts/ta-tts-proxy.mjs` + `scripts/start-ta-tts-proxy.ps1`（token 校验反代：只放行 `POST /tts`、体上限 64 KiB、401 兜底，隧道指向网关而不是裸 9880）；修掉 `TA_TTS_LOCAL_URL`「只填域名」时代码没补 `/tts` 的文档/实现不一致（新增 `localTtsEndpoint()`，域名与完整端点都收，后端 52 → 54 项）。 |

## 15. 触发词（用户只会说这几个词）

| 用户说 | Agent 该做什么 |
|---|---|
| **「改TA」/「TA」/「AI 伴侣」** | 读本文件 + `public/ta.html` + `src/ta/` 后动手；不读 MASTER_SPEC / FEATURES，不碰 `src/` 的其它文件 |
| 其他任何说法 | 默认 HYOOL 主站（读 MASTER_SPEC + FEATURES），忽略本文件 |

该分流已写入 `AGENTS.md` 与 `.cursor/rules/hyool-agent.mdc`，每次开工自动可见，用户无需另行交代路径。



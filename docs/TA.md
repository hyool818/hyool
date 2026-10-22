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

**状态（2026-10-15）**：v2 前后端都已落地 —— 后端 **59 项**断言全绿、页面 **48 项**沙箱断言全绿、真实浏览器冒烟 **26 项 SMOKE-OK**（本地没有后端时也会回落本机兜底，已验证）。下次改动前，先按 §12 跑这三份脚本。

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

**本机模型就是这条契约的第一个实例**（2026-10-21，见 §8.1）：`TA_API.chat()` 里收口「本机优先 → 云端 → 模板」，引擎层（意图 / 记忆 / 心情 / 台词库）一行未改；页面新增的唯一联网点仍然在 `TA_API` 内部（`localChat` / `localProbe` / `localSystem`）。

## 5. 后端接口（`src/ta/index.js`）

免登录、免 D1：额度靠「每 IP 分钟窗口 + 当日上限」的内存限流（isolate 级，够挡顺手乱刷）。所有失败都是**软失败**，页面据此静默回落本机兜底。

| 接口 | 入参 | 出参 | 失败行为 |
|---|---|---|---|
| `GET /api/ta/config` | — | 模型清单 / 音色池 / 预设 / 功能开关 / 限额 / `tts.{chain,local,local_voices}` / `llm`（本机模型提示，不含密钥） | 页面用内置预设继续跑 |
| `POST /api/ta/chat` | `message`、`persona`、`recent[]`、`memories[]`、`mood`、`intimacy`、`model?`、`channel?` | `{ reply, model, latency_ms }` | `success:false` + `code`，页面走模板 |
| `POST /api/ta/prompt` | `persona`、`memories[]`、`mood`、`intimacy`、`channel?` | `{ system, persona, channel, max_out }`（**只出提示词，不调任何模型**） | 页面用上次缓存的提示词；再不行就走云端链路 |
| `POST /api/ta/polish` | `text`(≤1200)、`channel?` | `{ reply }`（**只做去 AI 味清洗，不调模型**；擦完为空 → `code:"AI_SPEAK"`） | 页面保留自己那份最低限度清洗的结果 |
| `POST /api/ta/tts` | `text`(≤300)、`voice`、`rate`、`pitch`、`volume` | `audio/wav` 或 `audio/mpeg`（按命中的合成层）+ 响应头 `X-TA-TTS-Provider`（`gptsovits` / `melotts`）/ `X-TA-TTS-Voice` /（降级时才有）`X-TA-TTS-Attempts`（ASCII 短码，如 `gptsovits=timeout; melotts=…`） | 两层都失败 → **502 `TTS_UNAVAILABLE`**（`attempts[]` 带每层原因，同样带 `X-TA-TTS-Attempts`），页面改设备本地 `speechSynthesis` |
| `POST /api/ta/asr` | `audio`(base64)、`language?` | `{ text }`（Whisper） | 页面提示重说 / 用浏览器本地识别 |
| `POST /api/ta/image` | — | **501 `COMING_SOON`** | 页面按钮是锁定态 |

**限额**：chat 18/分、240/日；prompt / polish 各 40/分、600/日（这两条不调模型，只给本机链路配提示词与清洗用）；tts 24/分、320/日；asr 8/分、120/日；config 60/分。单请求上限：输入 500 字、回带 8 轮对话 + 12 条记忆、TTS 300 字、返回台词 ≤200 字。

**环境变量**（全部可选，都不填 TA 也能跑）：

| 变量 | 作用 |
|---|---|
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 复用 HYOOL 同一份 Secret（见 `.dev.vars.example`） |
| `TA_MODEL` | 默认模型 id（`cf-llama` / `ds-chat` / `local-qwen` / …），不填 = `cf-llama` |
| `TA_LOCAL_LLM_URL` | **本机模型**地址（OpenAI 兼容 `/v1`）。**Worker 在边缘、到不了 `127.0.0.1`**：这里只能填隧道/公网地址；不填 = 服务端链路里没有本机模型（页面直连不受影响，见 §8） |
| `TA_LOCAL_LLM_MODEL` | 本机模型名（默认 `qwen3.6-35b-a3b-nothink`） |
| `TA_LOCAL_LLM_KEY` | 本机端点要 token 时才填（llama.cpp / LM Studio 默认不要） |
| `TA_LOCAL_LLM_TEMPERATURE` / `TA_LOCAL_LLM_MAX_TOKENS` | 本机模型的采样温度 / 单句上限（默认 0.95 / 320） |
| `TA_ASR_MODEL` | Whisper 模型覆盖（默认 `@cf/openai/whisper-large-v3-turbo` → 回退 `@cf/openai/whisper`） |
| `TA_TTS_MODEL` | 站内合成层模型（默认 `@cf/myshell-ai/melotts`） |
| `TA_TTS_LOCAL_URL` | **自建 GPT-SoVITS** 的地址（只填域名，`/tts` 路径由代码补）。不填 = 该层不参与链（见 §7） |
| `TA_TTS_LOCAL_REF` | **兜底**参考音频路径（**自建机器上的本地路径**，不是 URL）：逐音色表与性别档都没命中时用它（一份素材兜所有音色，女男会同一把嗓子） |
| `TA_TTS_LOCAL_FEMALE_REF` / `TA_TTS_LOCAL_MALE_REF` | **按性别兜底的参考音频**（推荐主力口径：女声 6 个共用一份、男声 6 个共用一份）。优先级低于逐音色映射、高于全局默认；**只配了女声档时男声不会偷用女声**（该层跳过 → MeloTTS / 设备语音） |
| `TA_TTS_LOCAL_FEMALE_PROMPT_TEXT` / `TA_TTS_LOCAL_MALE_PROMPT_TEXT` | 上面两条音频各自对应的原文（不填则回落 `TA_TTS_LOCAL_PROMPT_TEXT`；原文与音频不一致会带口音） |
| `TA_TTS_LOCAL_VOICES` | JSON：音色 id → `{ref, prompt, prompt_lang}`，给每个音色配各自的参考音频（最高优先；写坏 = 当没配处理，不报错） |
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
| **说（TTS）** | `POST /api/ta/tts` → 服务端链：**① 自建 GPT-SoVITS**（`TA_TTS_LOCAL_URL`，音质最好、可逐音色配参考音频）→ **② Workers AI MeloTTS**（`TA_TTS_MODEL`，站内、零外依赖） | 设备本地 `speechSynthesis`（零网络、系统音色） | 任一层成功即返回（来源写在响应头 `X-TA-TTS-Provider`）；发生过降级再带 `X-TA-TTS-Attempts`（ASCII 短码）。两层都失败才 502 `TTS_UNAVAILABLE`，页面静默改用设备语音 —— 绝不因为语音问题卡住对话 |
| **听（ASR）** | 浏览器 `SpeechRecognition`（连续 + 中间结果 = 真·实时，且不消耗服务端额度） | `MediaRecorder` 录音 → `POST /api/ta/asr` → Workers AI Whisper | 两边都不可用时，退回键盘输入，界面给出明确提示 |

> 「本地模型」这条路按两种解读都留了位：**设备/浏览器本地引擎**是默认可用路径（离线也在），**设备端大模型**是固件阶段的替换目标（只改传输层，见 §4）。

**为什么弃用 Edge**（曾是 v2 首选，已下线）：免费 readaloud 端点只有单档 24kHz/48kbps、不支持 `<mstts:express-as>` 情感风格，从 Cloudflare 出口实测还会 403 —— 音质与稳定性都不合格。该实测结论同时写在 `src/tts.js` 顶部；**主站 `/api/tts` 不受影响**，只是 TA 不再调它。

**自建 GPT-SoVITS 接法（要音质就这么接）**：

1. 装机：按上游 README 起 `api_v2.py`（`POST /tts`）。**它默认没有鉴权** —— 全部参数只有 `-a` / `-p` / `-c`，没有 key 选项，所以别把它裸开公网（见第 3 步）。成功返回音频流、失败返回 400 JSON，这就是代码的判定口径。本机自测：`curl -s -o t.wav -w '%{http_code}' -X POST http://127.0.0.1:9880/tts -H 'Content-Type: application/json' --data-binary @body.json`。

   Windows 整合包（本机实测口径，v2Pro 包自带 `runtime`，不用装 Python）：

   ```powershell
   cd D:\AI\GPT-SoVITS-v2pro-20250604-nvidia50
   $env:PATH = "$PWD\runtime;$env:PATH"   # 让 runtime 里的 ffmpeg 可被找到（mp3/m4a 参考音频要用）
   .\runtime\python.exe api_v2.py -a 127.0.0.1 -p 9880
   # 就绪口径：GET /openapi.json → 200；日志里出现 "Loading VITS weights from ... <All keys matched successfully>"
   ```

   默认配置走 `tts_infer.yaml` 的 `custom` 档 = **v4 + cuda + is_half**（48 kHz，音质最好那档）。**显存要腾出来**：16 GB 卡上同时挂 35B 大模型（llama-server ≈ 8.9 GB）+ ComfyUI（≈ 13 GB）时它会加载成功但合成被挤到 CUDA 争用；实测先关掉 ComfyUI（`Stop-Process -Id <comfyui-pid>`）再起，单句稳态 **2.7~3.0 s**。

2. 参考音频（**这一步决定「她」的声音**）：3~10 秒、单人、无背景音乐、不削波，**再配一句与音频逐字一致的原文**。路径填自建机器上的本地路径。三级优先（写坏的那级直接跳过，不报错）：

   | 优先级 | 变量 | 覆盖范围 | 什么时候用 |
   |---|---|---|---|
   | 1 | `TA_TTS_LOCAL_VOICES`（JSON） | 单个音色 | 有 12 份素材、真要做到一人一音色 |
   | 2 | `TA_TTS_LOCAL_FEMALE_REF` / `TA_TTS_LOCAL_MALE_REF` | 女声 6 / 男声 6 | **推荐**：两份素材就能让音色池分男女 |
   | 3 | `TA_TTS_LOCAL_REF` | 全部音色 | 只有一份素材时的兜底（女男同一把嗓子） |

   ```powershell
   # 先体检素材（时长 / 声道 / 采样率 / 削波 / 音量），不通过就别往上填
   node scripts\ta-tts-ref-check.mjs "D:\AI\refs\xiaoman.wav"
   ```

   为什么非要第 2 级：音色池是 6 女 6 男，只配一份默认参考音频时，用户把音色从「晓晓」换成「云希」听到的还是同一把嗓子 —— 人设直接塌掉；而要求 12 份素材对普通人过度。**只配了女声档时男声不会偷用女声**（该层跳过 → MeloTTS / 设备语音），宁可降级也不假装换过音色。

   要一人一音色就用 `TA_TTS_LOCAL_VOICES`：

   ```json
   {"zh-CN-XiaoxiaoNeural":{"ref":"D:\\AI\\refs\\xiaoman.wav","prompt":"今天有点累，早点休息。","prompt_lang":"zh"}}
   ```

3. **加一层鉴权网关**（必做）：`powershell -ExecutionPolicy Bypass -File .\scripts\start-ta-tts-proxy.ps1`

   > 懒人版：`powershell -ExecutionPolicy Bypass -File .\scripts\start-ta-tts-stack.ps1` 一条命令按顺序拉起「api_v2（缺就起，等模型加载完）→ 网关 → 临时隧道」，最后把 token、隧道域名和该设的 `wrangler secret put` 逐条打给你（`-NoTunnel` 只起本机、不建隧道）。它只补缺的，不会重复起已经在跑的那一层。

   - 网关监听 `127.0.0.1:9881`，只放行 `POST /tts`（其余 404 / 405，请求体上限 64 KiB），校验 `Authorization: Bearer <token>`，不对就 **401**；token 走常量时间比较，日志只记状态 / 耗时 / 大小（不记文本、不记 token）。
   - token 首次由脚本生成到 `scripts/.tools/ta-tts-token.txt`（已 gitignore），之后复用同一份；也可用环境变量 `TA_TTS_PROXY_TOKEN` 覆盖。
   - 自测口径：带 token 打 `http://127.0.0.1:9881/tts` → 200 + `audio/wav`；不带 token → 401。
4. 让 Worker 连得上：家里机器没公网 IP 就开隧道，**指向网关的 9881（不是裸 9880）**：`cloudflared tunnel --url http://127.0.0.1:9881` → 拿到 `https://xxxx.trycloudflare.com`，填 `TA_TTS_LOCAL_URL`（**只填域名**，`/tts` 由代码补；填完整端点也兼容），再 `npx wrangler secret put TA_TTS_LOCAL_TOKEN`（粘贴上面那串 token）。网关 / 隧道 / 本机任一环挂了都不影响 TA：自动落到 MeloTTS。

   - **临时域名每次重启就变**（`trycloudflare.com`），变一次就要重设一次 `TA_TTS_LOCAL_URL`。要长期用就建固定隧道（需一次浏览器登录）：`cloudflared tunnel login` → `cloudflared tunnel create ta-tts` → `cloudflared tunnel route dns ta-tts tts.hyool.com` → `cloudflared tunnel run --url http://127.0.0.1:9881 ta-tts`，之后 Secret 只设一次。
   - 三个 Secret 的口径：`TA_TTS_LOCAL_URL`（隧道域名）、`TA_TTS_LOCAL_TOKEN`（网关 token）、`TA_TTS_LOCAL_FEMALE_REF` / `TA_TTS_LOCAL_MALE_REF` + 对应 `*_PROMPT_TEXT`（**你机器上的本地路径与原文**，合成发生在你机器上，所以路径由你机器解析）。参考音频这类稳定配置也可以写进 `wrangler.toml` 的 `[vars]`（易变的 URL / token 才用 Secret）。
5. 开好了怎么确认：`/api/ta/config` 的 `tts.chain` 会变成 `["gptsovits","melotts"]`、`tts.local = true`、`tts.local_voices` 列出已配逐音色映射的 id、`tts.refs` 给出 `{by_voice,female,male,fallback}`（一眼看出「男声是不是还在共用兜底那份」）；实测口径是 `POST /api/ta/tts` 的响应头 `X-TA-TTS-Provider: gptsovits` + `X-TA-TTS-Voice: female-default`（没接通就是 `melotts`）。页面「音色来源 = 云端」时状态栏会显示实际命中的层；`tts.local = false` 时按钮上会直接写「自建 GPT-SoVITS 未接」，**不让人靠听感猜**。

   **本机实测（RTX 5060 Ti 16 GB / v4 档 / 关掉 ComfyUI）**：直连 `:9880` 单句 2.7~3.0 s；过网关 `:9881` 2.9 s 左右；过公网隧道 4.3~4.6 s（Worker 侧一次实测 5.1 s）。自建层单次超时是 **6 s**，隧道一跳就占了 1.5 s 左右 —— 换更慢的机器/更长的句子前先量一遍，不然会稳定超时降级到 MeloTTS。


**参数口径**：`rate`（`+20%` / `-60%`）会换算成自建层的 `speed_factor`（clamp 0.5~2）；`pitch` / `volume` 仍然接收并校验格式（前端契约不变），但当前链上没有支持 SSML prosody 的引擎，**不再改变合成结果**。

**谁在用哪条腿**：页面「音色来源」默认 = 本机（设备语音，不消耗额度）；显式切到云端才走服务端链（24/分、320/日 限额）。

**换行 / 打断**：TA 说话期间用户按下麦克风 → 立即停止播放与合成；新台词开始前会取消上一段语音，避免叠音。

**稳定性口径（2026-10-15 加固；主题是「一次抖动不该变成永久机械音」）**：

| 环节 | 规则 | 为什么 |
|---|---|---|
| 自建层单次超时 | **6 s**（`TTS_TIER_TIMEOUT_MS`） | 实测单句 1.4~2.7 s，给足余量；30 s 的长超时等于让用户干等 |
| 自建层重试 | 只在**快速失败**（<2.5 s）时同层立刻重试 **1 次** | 隧道冷连接 / 连接被掐断是一次性抖动，重试就救回来了；超时这种「贵的失败」不重试，免得白等两轮 |
| 4xx | 不重试，直接降级 | `401`（token 不对）/`400`（参考音频不存在）重试一百次也一样 |
| 整条链预算 | **20 s**（`TTS_TOTAL_BUDGET_MS`） | 硬性小于页面 `TTS_TIMEOUT_MS`（**22 s**）：页面先超时的话服务器白算一场、用户听到的永远是兜底音 —— 这是真实踩过的坑，两个常量要一起改 |
| 失败可见 | 每层失败写 `console.warn`（`wrangler tail` 可见）+ 降级时回 `X-TA-TTS-Attempts`；页面记进 `SERVER.ttsAttempts`、`console.warn` 一条、状态栏悬停可见 | 「声音怎么变了」必须一次查清，不能靠猜 |
| 页面请求 | **单飞 + 可中断**：新台词开始 / 说话打断 / 静音 / 切后台 / 断网都 `abort()` 掉在跑的合成，迟到的响应按序号作废 | 旧请求继续占着自建层与隧道、越堆越慢 —— 听感就是「越聊越机械」 |
| 降级提示 | 服务端合成失败时给一句人话（每会话一次，不刷屏）；`unconfigured`（这台部署没接自建层）不算故障，只写进悬停说明 | 既不静默骗人，也不念经 |

**语音听起来「变机械了」怎么查**（照顺序走，三步内定得到位）：

1. `GET /api/ta/config` → `tts.chain`：若只有 `["melotts"]` 且 `tts.local=false`，说明**自建层根本没启用**（`TA_TTS_LOCAL_URL` 这个 Secret 是空的）→ 按上面第 1~4 步接起来，再 `wrangler secret put TA_TTS_LOCAL_URL`。
2. 看 `POST /api/ta/tts` 的响应头：`X-TA-TTS-Provider: melotts` + `X-TA-TTS-Attempts: gptsovits=timeout`（或 `=net`）就是隧道那一段断了 —— 本机自测 `curl -s -o NUL -w '%{http_code}' -X POST http://127.0.0.1:9881/tts -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' --data-binary @body.json` 应回 200；`=http401` 是 token 不对；`=http400` 是参考音频路径写错。
3. 本机三件套是否都在跑：`api_v2.py`（`:9880`）、网关（`:9881`，`scripts\start-ta-tts-proxy.ps1`）、`cloudflared` 隧道。**只开 GPT-SoVITS WebUI（`webui.py`）是没用的** —— Worker 打的是 `api_v2.py` 的 `POST /tts`。

## 8. 模型：云端两家 + 本机一家 + 一个接入口

| 注册 id | 标签 | provider | 状态 |
|---|---|---|---|
| `cf-llama` | Cloudflare · llama3.3-70B | `workers-ai`（`env.AI.run`，免密钥） | 默认主力 |
| `ds-chat` | DeepSeek · chat | `deepseek`（OpenAI 兼容，`DEEPSEEK_API_KEY`） | 配了 Key 自动 online |
| `local-qwen` | 本机 · qwen3.6 | `local`（OpenAI 兼容端点） | 页面直连默认就是它；Worker 侧配了 `TA_LOCAL_LLM_URL`（隧道）才 online |
| `extra` | 扩展模型（预留） | `openai-compatible` | 配了 `TA_EXTRA_*` 才 online |

- **只认注册表 id**：请求里塞别的模型名一律回落默认，防止有人拿 TA 白嫖任意模型。
- **容灾链**：`taModelChain()` 把「用户选的 → 本机（有隧道时）→ DeepSeek → Workers AI」按序排好并去重，逐个尝试；某个挂了自动换下一个，全挂才软失败。没配 Key / 没绑 AI 的模型**不会**被放进链里（不白等一次网络超时）。
- **后期加模型 = 加一行**（`TA_MODELS` 或 `TA_EXTRA_MODELS`），调用方（`src/ta/index.js`、页面）都不用改。原生支持任何 OpenAI 兼容端点，所以自建 GPU / 其它云厂商都能直接接。

### 8.1 本机模型（qwen3.6 / llama.cpp）：为什么由页面直连

Worker 跑在 Cloudflare 边缘，**永远够不着 `127.0.0.1`**。所以「本机模型」这条腿分两种用法：

| 用法 | 走法 | 要配什么 |
|---|---|---|
| **页面直连**（默认，推荐） | 浏览器 → `http://127.0.0.1:8080/v1/chat/completions` | 什么都不用配：起好 llama.cpp（默认 8080）即可；地址/模型名可在页面上双击「台词模型」按钮改 |
| Worker 走隧道 | Worker → `TA_LOCAL_LLM_URL`（cloudflared / 公网反代）→ 本机 | `TA_LOCAL_LLM_URL`（+ 可选 `TA_LOCAL_LLM_KEY`），然后 `wrangler secret put` |

页面直连时的完整链路（每一步都有兜底，任何一步失败就退回云端链路 → 再退回本机台词库）：

```
/v1/models 探活(1.5s)  →  POST /api/ta/prompt（服务端出提示词）  →  本机 /chat/completions  →  POST /api/ta/polish（服务端去 AI 味）
```

- **提示词与清洗只有一份实现**：人设收紧在 `src/ta/prompt.js`，页面不写提示词、也不让用户写（红线见 §2）。
- 提示词按 `人设|心情|亲密|记忆尾条` 缓存；服务端拉不到时用 `state.localPrompt` 里上次那份，**本机模型因此能离线接着说话**。
- 探活结果缓存 15s；`auto` 模式下连不上就直接走云端，不会每句话都先等一次超时。
- 三种模式存在 `hyool-ta-v1` 里：`auto`（本机优先，默认）/ `cloud`（只用云端）/ `local`（只用本机）。状态栏与抽屉里的「台词模型」按钮会如实显示这句台词是谁说的。
- 本机模型的**单次上限 30s**（`LOCAL_LLM.chatMs`）；实测 35B-A3B 首字冷启动 ~40s（模型装载），热身后 1s 内出句 —— 冷启动那次会被判超时并回落云端，属预期。
- **浏览器策略**：`http://127.0.0.1` 属于「潜在可信来源」，https 页面 → 本机端点不算混合内容；llama.cpp 会按 `Origin` 回 CORS 头（实测 `Origin: https://hyool.com` → `Access-Control-Allow-Origin: https://hyool.com`），所以线上页面也能直连。若哪天被 Chrome 的本地网络访问（LNA）实验拦下，探活会失败并**自动回落云端** —— 那种情况改用下面的 Worker 隧道方式。

起本机端点（llama.cpp，端口与模型名跟 字字动画 里那份配置一致）：

```powershell
llama-server -m D:\AI\models\qwen3.6-35b-a3b-nothink.gguf --port 8080 --ctx-size 16384 -ngl 99
# 验证：curl.exe --noproxy "*" http://127.0.0.1:8080/v1/models
# 自测：node scripts/ta-local-llm-check.mjs
```

`.dev.vars.example` 里只有 TTS 的样例，本机模型**不需要密钥**；要试隧道再照 §5 的 `TA_LOCAL_LLM_*` 填。

## 9. 图片生成：接口占位、界面锁定（后期待开放）

- `/api/ta/image` 已注册，固定返回 **501 + `code: COMING_SOON`**；`/api/ta/config` 里 `features.image === false`。
- 页面上的图片按钮是**锁定态**（点了给一句人话提示，不是报错弹窗）。
- 真开放时要做的事：实现该路由（`env.AI.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", …)` 或复用主站的 pollinations 直链）、把 `features.image` 翻成 `true`、在本文档记一笔。

## 10. 兜底策略（核心：不能变智障）

| 场景 | 表现 |
|---|---|
| 断网 / 离线 | 页面**不发请求**，直接用本机模板回应；`navigator.onLine` 变化会提示一次「我先离线记着」类台词 |
| 模型超时（9s）/ 报错 | 静默回落模板，回复里带一句自然的「刚走神了一下」式补丁，**不出现**「网络错误」「请求失败」 |
| 本机模型连不上 / 冷启动超时（30s） | `auto` 模式当场改走云端链路（探活 1.5s、结果缓存 15s，不会每句都白等）；云端也挂才用模板。`local` 模式（用户明确「只用本机」）才直接回模板 |
| LLM 回了 AI 腔 | 服务端 `humanizeTaReply()` 先擦（去 Markdown / 去助手腔 / 限长 / 限 emoji）；擦完为空则页面用模板 |
| 用户说的没模板 | 兜底台词库（`fallback` + `offline` + `confused` 三组）负责接住，且带「防重复窗口」，连回合不会复读同一句 |
| 记忆为空却问「还记得吗」 | 固定话术说明还没记录（**绝不编造**） |
| 语音合成失败 | 换设备本地语音引擎；再失败就只显示文字，不停对话 |

台词库要求：每个意图 × 每种语气 **≥5 条**，`fallback` / `offline` / `confused` **各 ≥12 条**；选句用 `(轮次 + 字数) % 条数` 的确定性取模 + 最近使用窗口，保证多样性可复现。

## 11. 数据与隐私

- 唯一存储键：**`hyool-ta-v1`**（localStorage）。键名里的 `hyool-` 只是命名前缀，**不代表与主站有数据往来**。
- 内容：人设预设、消息记录、记忆条目、心情值、亲密值、语音开关。
- 每次对话**只**把「最近 8 轮 + 12 条记忆 + 当前心情/亲密」发给 `/api/ta/chat`，不带设备标识、不写库、不落盘；服务端日志只有一行失败原因，密钥会被打码。
- **本机模型**（§8.1）走的是同一个内容口径：`/api/ta/prompt` 只收人设 / 心情 / 亲密 / 记忆，台词由页面直接发到你填的端点（默认 `127.0.0.1`，不出机器）。系统提示词会缓存在同一个 `hyool-ta-v1` 里（离线时给本机模型用），可用「清空全部本机数据」一并删掉。
- 换键 / 改键名 = 老数据不再读取（等于清空）；「⟲」重新设置伴侣（二次确认，保留对话与记忆）；「清空全部本机数据」= 真删除（二次确认）。
- 除 `/api/ta/*` 之外没有任何读写入口，没有 Cookie、没有上报、没有跨页共享。

## 12. 自测

仓库里现在有两个**常驻**自测脚本（放 `scripts/`，不污染 `public/`）：`ta-local-llm-check.mjs`（后端 + 真机）与 `ta-local-page-check.mjs`（页面传输层，vm 沙箱）。其余历史脚本仍按临时文件处理，放 `%TEMP%`：

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| 仓库内 `scripts/ta-local-llm-check.mjs`（`node scripts/ta-local-llm-check.mjs`；`--offline` 只跑离线部分） | **24 项**本机模型接入断言：`local-qwen` 两种状态（没配 `TA_LOCAL_LLM_URL` = coming，配了 = online）、容灾链进出、模型名覆盖、`/config.llm` 提示不含密钥、`/prompt`（人设越界回落 + 关系阶段/心情/记忆进提示词 + 与 `buildTaSystemPrompt` 同源 + 方法 405）、`/polish`（去 Markdown 与助手腔、全是 AI 腔返回空 + `AI_SPEAK`、空输入 400）、**真机**：用同一份提示词问本机模型再过 `humanizeTaReply`（端点不在线时这两项自动 SKIP） | `=== ALL PASSED ===`（24 ok / 0 FAIL） |
| 仓库内 `scripts/ta-local-page-check.mjs`（`node scripts/ta-local-page-check.mjs`） | **21 项**页面传输层断言（vm 沙箱跑 `public/ta.html` 里的原始脚本 + 假 fetch）：默认 auto/默认端点、本机在线时台词来自本机、先取 `/prompt` 再问本机、最近对话角色映射、`temperature/max_tokens/stream` 请求体、台词过 `/polish`、手填模型名优先、探活 15s 缓存、提示词拉不到时用缓存照常说、本机挂了回落云端、`cloud` 模式不碰本机、`local` 模式不偷用云端、`polish` 挂了用页面侧清洗、两条链路都挂时软失败 | `=== ALL PASSED ===`（21 ok / 0 FAIL） |
| `%TEMP%\ta-check\tests.mjs`（配合 `%TEMP%\ta-check\` 里 `src/ta/*` + `src/tts.js` 的镜像与 `package.json`） | **59 项**后端断言：人设越界回落（性别/名字/性格/跨性别音色）、提示词注入与去 AI 感约束、`humanizeTaReply` 去 Markdown/去 AI 腔/限长/限 emoji、模型注册表与容灾链去重、`TA_EXTRA_MODELS` 接入口、config 形状、chat 成功/失败/无 binding/空输入/越界人设不进提示词、**tts 合成链**（自建层优先 + 请求体逐字段透传、参考音频逐音色映射与默认回落 + Bearer、`+20%`→`speed_factor`、自建 400 自动降级 MeloTTS、未配地址不外呼、两层都挂 502 且 `attempts` 带原因、映射表写坏容错、`tts.{chain,local,local_voices}` 暴露）、**语音稳定性**（快速失败同层重试一次后仍用自建层、401 不重试、连抖只试两次、没降级不带 `X-TA-TTS-Attempts`、未配自建层记 `unconfigured`、502 也带降级头、CORS expose 三个 TTS 头）、tts 四类参数校验、asr 三态、image 501、非 `/api/ta` 放行、未知路径 404、方法 405、`TA_DISABLED` 503、同 IP 429、跨域白名单 | `=== ALL PASSED ===`（59 ok / 0 FAIL） |
| `%TEMP%\ta-page-check.mjs`（读 `d:/hyool/public/ta.html`，Node `vm` 沙箱 + 假 localStorage） | **48 项**页面断言：静态契约（单脚本单样式、无外链、只调 `/api/ta/*`、占位符集合、无 v1 遗留字段、锁定态按钮、音色来源文案已跟上合成链、合成超时 > 服务端预算且带中断/作废机制）、`vm.Script` 解析与执行、四大预设池、人设越界与 v1 迁移、13×3 台词条数与兜底三组 ≥12、39 条回复无空无占位符残留、`recall` 不编造、兜底两段式且无技术词、`pickFresh` 防复读、13 类意图边界、记忆抽取噪声、情绪打分、5 级阶段、传输层软失败（离线/网络错/HTTP 429/服务端软失败/成功透传/config 覆盖音色池/config 同步合成层/tts 成功记下来源与音色/响应无 headers/tts null/asr 空串/tts 单飞打断后返回 null/降级原因记进 `SERVER` 且 `unconfigured` 不误报） | `=== ALL PASSED ===`（48 ok / 0 FAIL） |
| `%TEMP%\ta-smoke\{server.mjs, smoke.html}` + 仓库自带 `run-browser-test.ps1`（headless Chrome + CDP，iframe 驱动真实页面） | **26 项**浏览器冒烟：预设渲染数量、切性别后音色/名字池联动、无自由输入框、开始对话后浮层关闭 + 顶栏名字 + 开场白、语音开关、图片锁定、状态栏人话、音色来源可切换且文案说明服务端合成、切换后状态栏同步、**无后端时仍回话**（本机兜底）、记忆抽屉与统计 | `TITLE: SMOKE-OK`（26 PASS / 0 FAIL） |

> **真机联调（本机模型，2026-10-21 实测）**：起一个薄壳 node 服务（静态发 `ta.html`，并把 `/api/ta/*` 原样接到 `handleTaRoutes`），再用仓库自带 `run-browser-test.ps1` 跑无头 Chrome：断言「状态栏出现 `台词走本机模型`」「本机真回了台词」「无 JS 异常」。实测 5 项全过（qwen3.6-35b-a3b-nothink 热身后 <2s 出句；首字冷启动约 40s，属模型装载）。

临时脚本的重建方法（每次改完代码先跑，别只靠浏览器手测）：

```powershell
$dst = Join-Path $env:TEMP 'ta-check'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'src\ta') | Out-Null
Copy-Item 'd:\hyool\src\ta\*.js' (Join-Path $dst 'src\ta') -Force
Copy-Item 'd:\hyool\src\tts.js' (Join-Path $dst 'src\tts.js') -Force
Set-Content (Join-Path $dst 'package.json') -Value '{"type":"module"}' -Encoding utf8
# 再把 tests.mjs 放进 $dst，然后：
cd $dst; node tests.mjs        # 期望 === ALL PASSED ===（59 项后端）

# 页面沙箱跑测（把 ta-page-check.mjs 放进 %TEMP%）：
node "$env:TEMP\ta-page-check.mjs"      # 期望 === ALL PASSED ===（48 项）

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
- **测试**：后端 59 项、页面 48 项、真实浏览器冒烟 26 项，全绿。
- **本机模型（2026-10-21）**：`local-qwen` 注册项 + `TA_LOCAL_LLM_*`；页面直连 OpenAI 兼容端点（llama.cpp / LM Studio / vLLM / Ollama），台词模型三种模式（本机优先 / 只用云端 / 只用本机）、状态栏如实显示谁说的；提示词与「去 AI 味」仍只由服务端出（新增 `/api/ta/prompt`、`/api/ta/polish`）。本机模型接入自测 24 项全绿（`node scripts/ta-local-llm-check.mjs`）。

**未做（按需再做，勿默认动手）**

1. **图片生成真开放**：实现 `/api/ta/image`、把 `features.image` 翻 `true`、按钮解锁。
2. **更多云端模型**：填 `TA_EXTRA_*` / `TA_EXTRA_MODELS` 即可接第三方 —— 本机模型（`local-qwen`）已经在 §8.1 接入；要同时挂多台本机端点、或做更细的模型切换 UI 再说。
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
| 2026-10-15 | **语音稳定性加固（线上实测驱动）**：实测定位到「第一次好、后面变机械」的根因有两层 —— ① 线上 `/api/ta/config` 的 `tts.chain` 只有 `["melotts"]`、`local:false`（`TA_TTS_LOCAL_URL` Secret 为空，**自建层根本没启用**，听到的就是站内 MeloTTS）；② 代码里页面 `TTS_TIMEOUT_MS`(14s) 小于后端自建层超时(30s)，且页面合成请求从不中断/去重 —— 一次抖动就永久掉兜底音。修法：后端自建层单次超时 30s → **6s**、**快速失败（<2.5s）才同层重试一次**（4xx 不重试）、整条链预算 **20s**、每层失败写 `console.warn`（`wrangler tail` 可见）、降级时回 ASCII 头 `X-TA-TTS-Attempts`（`gptsovits=timeout` / `=net` / `=http401` / `=unconfigured`，502 也带），devCors 补 `Access-Control-Expose-Headers`（本地预览才读得到来源头）；页面 `TTS_TIMEOUT_MS` → **22s**、合成**单飞 + 可中断**（新台词/说话打断/静音/切后台/断网都 `abort()`，迟到响应按序号作废）、降级时给一句人话（每会话一次）、`tts.local=false` 时「音色来源」按钮直说「自建 GPT-SoVITS 未接」、状态栏悬停可看降级原因。文档 §7 补「稳定性口径」表 + 「变机械了怎么查」三步排查。后端 59 项 / 页面 48 项 / 冒烟 26 项全绿。**遗留：线上自建层仍未接（需先起 `api_v2.py` + 网关 + 隧道，再 `wrangler secret put TA_TTS_LOCAL_URL`）。** |
| 2026-10-21 | **本机模型接入（qwen3.6）**：新增注册项 `local-qwen`（provider `local`）+ `TA_LOCAL_LLM_URL/MODEL/KEY/TEMPERATURE/MAX_TOKENS`；Worker 到不了 `127.0.0.1`，因此「本机模型」由**页面直连**（`TA_API.localChat`：探活 `/v1/models` → 取提示词 → `/chat/completions` → 回服务端擦 AI 腔），服务端链路在配了隧道地址时也会把本机模型排到最前。新增 `POST /api/ta/prompt`（只出提示词）与 `POST /api/ta/polish`（只做去 AI 味），提示词与清洗保持单一实现；`/config` 新增 `llm` 提示（不含密钥）。页面新增「台词模型」按钮（自动 / 只用云端 / 只用本机，双击改地址与模型名）、状态栏如实显示台词由谁生成、系统提示词缓存在同一 `hyool-ta-v1` 里以支持离线本机对话。新增 `scripts/ta-local-llm-check.mjs`（24 项，含真机调用）全绿。 |
| 2026-10-22 | **自建语音真机打通 + 参考音频分性别**：本机 v2Pro 整合包（`tts_infer.yaml` 的 `custom` 档 = v4 + cuda）实测全链路 200 `audio/wav` —— 直连 `:9880` 单句 2.7~3.0 s、过网关 2.9 s、过公网隧道 4.3~4.6 s（自建层 6 s 预算内）；记录口径：**16 GB 卡上必须先把 ComfyUI 关掉**，否则 CUDA 争用让首句 8.6 s。参考音频改为**三级优先**：`TA_TTS_LOCAL_VOICES[voice]` → `TA_TTS_LOCAL_FEMALE_REF`/`TA_TTS_LOCAL_MALE_REF`（新增，两份素材即可让 6 女 6 男分嗓子）→ `TA_TTS_LOCAL_REF`（兜底）；**只配女声档时男声不偷用女声**（该层跳过 → MeloTTS / 设备语音），`X-TA-TTS-Voice` 会写明命中哪一级（`female-default` / `male-default` / `local-default` / 音色 id）。`/config` 的 `tts` 新增 `refs.{by_voice,female,male,fallback}`（只给布尔/计数，不泄露机器路径）。新增 `scripts/ta-tts-ref-check.mjs`（参考音频体检：时长/声道/采样率/削波/音量 + ffmpeg 规整命令）与 `scripts/ta-tts-local-check.mjs`（29 项离线断言：三级优先、请求体契约、400 不重试、空音频判失败、抖动重试一次、config 口径），页面 48 项与本机模型 22 项仍全绿。文档 §7 补 Windows 起法、显存口径、固定隧道与实测耗时。 |


## 15. 触发词（用户只会说这几个词）

| 用户说 | Agent 该做什么 |
|---|---|
| **「改TA」/「TA」/「AI 伴侣」** | 读本文件 + `public/ta.html` + `src/ta/` 后动手；不读 MASTER_SPEC / FEATURES，不碰 `src/` 的其它文件 |
| 其他任何说法 | 默认 HYOOL 主站（读 MASTER_SPEC + FEATURES），忽略本文件 |

该分流已写入 `AGENTS.md` 与 `.cursor/rules/hyool-agent.mdc`，每次开工自动可见，用户无需另行交代路径。



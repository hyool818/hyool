# AI 伴侣（TA）· 独立页面说明

> **本文件与 HYOOL 主站无关，是两个东西。**
>
> | | HYOOL 主站 | AI 伴侣（TA） |
> |---|---|---|
> | 入口文件 | `src/index.js` + `public/*.html` | **只有** `public/ta.html` |
> | 文档 | `docs/MASTER_SPEC.md` + `docs/FEATURES.md` | **本文件** |
> | 后端 | Workers + D1 + R2 + Vectorize + Workers AI | **无**（零接口） |
> | 账号 | 需要注册/登录 | **无**（连账号概念都没有） |
> | 数据 | D1 表 + R2 + 向量索引 | **只有浏览器 localStorage** |
> | 模型 | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | **未接入**（模板回复，见 §4） |
>
> **刻意约定**：TA **不在** `docs/FEATURES.md` 登记，以免和 HYOOL 功能表混淆 —— 这不是遗漏，是刻意保持隔离。
> 做 TA 的活：**只读本文件 + `public/ta.html`**，不要顺带去读/改 `src/`。做 HYOOL 的活：读 `MASTER_SPEC.md` + 对应 FEATURES 条目。

## 1. 定位

一个**单文件、纯前端、零依赖**的陪伴式对话原型页：没有服务器、没有账号、不联网，对话与"记忆"全部写在当前浏览器的本机存储里。

用途：移动端可用的情绪陪伴 Demo / 产品形态试验田。**不承载 HYOOL 的任何业务**，删掉它 HYOOL 照常运行。

## 2. 红线（改 TA 时不允许做的事）

| 禁止 | 原因 |
|---|---|
| 引入 `fetch` / `XMLHttpRequest` / `WebSocket` / 外部 CDN | 会破坏"不联网"承诺与隔离性 |
| 调用任何 `/api/*`（如 `/api/buddy/:id/messages`、`/api/companion/inbox`、`/api/hub`） | 那是 HYOOL 后端；一旦调用就"关联"了 |
| 引用 `src/*.js`、其他 `public/*.html`、共用 `localStorage` 键 | 同上；本页只用 `hyool-ta-v1` |
| 修改 `docs/FEATURES.md`、`docs/MASTER_SPEC.md` 来"登记"本页 | 保持两套文档物理分离（本文件即唯一登记处） |
| 把 TA 的改动混进 HYOOL 的 commit | 便于回滚与定位（提交前缀用 `feat(ta):` / `fix(ta):`） |

**隔离自检**（应无任何输出）：

```powershell
Select-String -Path public\ta.html -Pattern 'fetch|XMLHttpRequest|WebSocket|<a |href=|src=|/api/'
```

## 3. 文件与地址

| 项 | 值 |
|---|---|
| 源文件 | `public/ta.html`（单文件 HTML+CSS+JS，949 行） |
| 线上地址 | **`https://hyool.com/ta`** |
| 兼容地址 | `https://hyool.com/ta.html` → 307 → `/ta` |
| 移动端 | 同一地址，可直接「添加到主屏幕」 |
| 本地预览 | `python -m http.server 8099 --directory public` → `http://<局域网IP>:8099/ta.html` |
| 上线方式 | 提交并 push 到 `main` → `.github/workflows/deploy.yml` 自动 `wrangler deploy` |
| Worker 关系 | `[assets]` 未设 `run_worker_first`，静态资源由资源层直接返回，**不经过 Worker**（不消耗 D1/AI 额度） |
| 索引 | `<meta name="robots" content="noindex,nofollow">` —— 搜索引擎不收录 |

> **`.html` 只是磁盘文件名，不是网址。** Cloudflare 静态资源默认 `html_handling = auto-trailing-slash`：`/ta` 直接 200 返回 `ta.html`，`/ta.html` 反而 307 跳回 `/ta`。所以文件必须叫 `ta.html`，对外永远是 `https://hyool.com/ta`。
> 同时**不要**去 `src/index.js` 加 `/ta` 路由 —— 不需要，加了反而多此一举。

## 4. 技术实现（全部在一个文件里）

**⚠️ 没有接入任何模型。** TA 的回复 100% 来自页面内手写模板库 + 正则匹配，属于"规则回复机器人"，不是 LLM。它能"接住你的话"，靠的是关键词抽取填空，而不是理解语义；问到没写模板的内容会走兜底句，看起来会答非所问。

| 环节 | 实现 | 位置 |
|---|---|---|
| 人格 | 3 套手写文案 `PERSONAS`：`gentle` 温柔·守夜人 / `sunny` 元气·小太阳 / `clear` 清醒·参谋；换人格 = 换整套句库 | `PERSONAS` |
| 开场白 | 每语气一句固定开场（`INTROS[tone]`，含 `{name}` 占位） | `INTROS` + `fill()` |
| 意图识别 | **正则匹配** 13 类（`detectIntent` 顺序短路，先命中先返回）：remember / recall / love / thanks / night / farewell / tired / happy / about / greeting / question / boring，兜底 `fallback` | `detectIntent()` |
| 具体回复 | `LINES[意图][语气]`（语气键 `g` / `s` / `c`）按 `(轮次 + 字数) % 条数` 取一条 —— 是**确定性取模**不是随机，多样性靠轮次变化 | `buildReply()` + `pick()` |
| 关键词回填 | 从用户句里抠名词填入 `{k}`（兜底「这件事」） | `topicOf()` |
| 记忆 | 正则规则表 `MEM_RULES` 抽取 6 类：称呼 / 喜好 / 忌讳 / 日程 / 约定 / 作息；写入 localStorage，上限 `MAX_MEMORIES = 80`（隐私模式下写失败静默忽略） | `matchMemories()` |
| 情绪 / 亲密值 | `POS`/`NEG` 词典打分（−12 ~ +12，无命中记 +1）→ 心情值；互动累加 → **5 级**关系阶段：初识 / 熟悉 / 亲密 / 信赖 / 依赖（阈值 0 / 20 / 45 / 70 / 90） | `scoreMood()` + `stageOf()` |
| 追加规则 | 心情 < 35 追加一句安慰（tired / remember 除外）；亲密 ≥ 20 且 `turn % 3 === 0` 追加追问；心情 ≥ 80 且 `turn % 4 === 0` 追加俏皮话 | `buildReply()` 尾部 |
| 记忆引用 | `{m}` 取**最新一条**记忆（`memories[0]`；新记忆 `unshift`，有数量上限）；问"还记得吗"但**一条记忆都没有**时返回固定句 `NORECALL`，**绝不编造** | `fill()` + `NORECALL` |
| 表现层 | 逐字打字机、快捷话题（5 个）、记忆抽屉、主动问候（闲置 8 分钟或切回前台触发，15 秒轮询） | `CHIPS` + `maybeProactive` |
| 对外接口 | `window.AICompanion`（11 项纯函数，供调试/自测，用户不可见） | 文件末尾 |

模板占位符集合固定为 `{name}` `{call}` `{k}` `{m}`；新增文案若用到别的占位符，必须同时补进替换逻辑，否则会漏字。

## 5. 数据与隐私

- 唯一存储键：**`hyool-ta-v1`**（localStorage）。键名里的 `hyool-` 只是命名前缀，**不代表与主站有数据往来**。
- 存的内容：人格设置（名字/称呼/语气）、消息记录、记忆条目、心情与亲密值。
- 换键 / 改键名 = 老数据不再被读取（等于自动清空）；顶部「⟲」= 重新设置伴侣（二次确认，**保留**对话与记忆），设置页「清空全部本机数据」= 真删除（二次确认）。除此之外没有任何读写入口，也没有 Cookie / 上报 / 跨页共享。

## 6. 自测方法

仓库内没有 TA 的测试文件（刻意不污染 `public/`）；工程内一份临时断言脚本（`%TEMP%\companion-check.mjs`，node 直接跑，读 `d:/hyool/public/ta.html`）覆盖 **50 项**：

- 静态契约：`<script>` / `<style>` 各 1 个、无 `@@` 残留、无 `<a>` / `href=` / `src=`、脚本内无 `fetch(` / XHR / `http://`、无 `/api/`、模板占位符集合恰为 `{call}` `{k}` `{m}` `{name}`
- 语法与运行：`vm.Script` 解析通过；再在**无 DOM 沙箱**（假 `localStorage`）里真跑一遍，确认 `window.AICompanion` 暴露 11 项
- 13 类意图的 14 条用例（含"这周末要加班"→tired、'楼下的花开了'→fallback 等边界）、11 条记忆抽取用例（含"我在想你""我爱你"等**不该**抽成记忆的噪声用例）
- 情绪正负判断、关系阶段取值（初识 / 亲密 / 依赖）
- 39 条回复（13 触发 × 3 语气）非空且无未替换占位符；3 种语气各 ≥8 种不同首行（多样性）
- `recall` 必须引用真实记忆值、**无记忆时不得编造**、心情低落时追加安慰（多行）、回复里必须带称呼
- 契约：`STORE_KEY === 'hyool-ta-v1'`、`PERSONAS.length === 3`、`CHIPS.length === 5`、`defaultState()` 9 个字段

当前结果：`=== ALL PASSED ===`（50 ok / 0 FAIL）。改动 `ta.html` 后建议重跑，不要只看浏览器手测。

## 7. 已完成 / 未做

**已完成**：单文件页面（949 行；1 个 `<script>` + 1 个 `<style>`）、3 人格、13 类意图、本机记忆（≤ 80 条）、心情值与 5 级关系阶段、记忆抽屉与统计、480px 窄屏适配 + `prefers-reduced-motion` 降级、上线 `https://hyool.com/ta`。

**未做（按需再做，勿默认动手）**：

1. **接入模型** —— 两条路：
   - 走 HYOOL 后端：新增独立接口（如 `/api/ta/chat`）→ `env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {messages})`，页面只改"生成回复"那一处调用。**代价：破了零接口隔离**，需在本文档记一笔。
   - 走用户自带 Key：页面加输入框（存 localStorage），直连第三方 API。保持零后端，但要联网、用户自备 Key。
   - 建议保留模板作为**降级路径**（超时/失败/断网回落模板），否则纯联网页面会"卡住不说话"。
2. 收录：把 `noindex,nofollow` 改为 `index,follow`（需同时补 canonical / og 标签）。
3. 入口链接：在 HYOOL 某页加进入口 —— **违背隔离原则，默认不做**，要做需和本文档的边界重新对齐。
4. 音效 / TTS：可用浏览器 `speechSynthesis`（仍不联网）、或走 HYOOL 的 `/api/tts`（同样会破隔离）。

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-14 | 初版落地：`public/companion.html` → 定名 **TA**，文件改名 `public/ta.html`，标题/文案/存储键（`hyool-ai-companion-v1` → `hyool-ta-v1`）同步；push 到 `main` 经 CI 上线 `https://hyool.com/ta`（提交 `feat(ta): add standalone TA companion chat page`）。 |

**命名由来**：候选「小满 / 树洞 / 夜灯 / 回声 / TA / 陪伴」，最终选 **TA** —— 最短、性别中性、最贴"AI 伴侣"本意；页内默认角色名仍是「小满」（用户在设置页可改）。

## 9. 怎么让 AI（或新同事）不搞混

开工时明确说一句即可：

> 这次只改 AI 伴侣（TA）：先读 `docs/TA.md`，只动 `public/ta.html`，**不要碰** `src/` 和 `docs/FEATURES.md`。

改 HYOOL 时反过来：

> 这次是 HYOOL 主站需求：读 `docs/MASTER_SPEC.md` + `docs/FEATURES.md` 对应条目，**忽略** `docs/TA.md` 与 `public/ta.html`。

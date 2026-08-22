# HYOOL 项目上下文交接（AI 会话记忆）

> 用途：跨窗口/跨会话继续开发时，新 AI 会话先读本文件 + `git log --oneline -10` + 任务相关源码，即可恢复上下文并继续编码。所有已确认的架构决策都在这里，不要推翻。
> **历史归档**：已完成/已验证的详细记录全部在 `docs/history.md`，本文件只保留当前有效信息。收尾时详细记录追加到 `docs/history.md`，本文件只写一行摘要。

## 会话工作约定（每个接手本项目的 AI 会话必须遵守）

1. **开工前**：读本文件 + `git log --oneline -10` + 只读与任务相关的源码，不做全项目宽泛检索
2. **收尾时**：每次完成任务并 commit 后，必须同步更新本文件（已完成写一行摘要 + 详细追加 `docs/history.md`），保持文档与代码一致
3. **决策红线**：已确认的架构决策不得推翻；需要调整必须先问用户
4. **不做验证（2026-08-22 用户拍板）**：取消 node --check / dry-run / CDP 冒烟 / 线上验证等一切验证环节（太耗时太慢）；改完直接 commit + push main（CI 自动部署），线上不行再改。验证相关命令仍在「常用命令」备用，确有必要才用
5. **临时验证脚本**：放 `.wrangler/` 下，测完即删，不提交
6. **换窗口（硬性）**：每完成 1 个任务就主动提醒换窗口；长任务中途或上下文明显变长时立即提醒；换后说「读 CONTEXT.md 和 git log 继续」即可。禁止因怕丢对话而拖延。
7. **检索/读取纪律**：搜索用精准 pattern；`.wrangler/` 是构建产物不参与检索；大文件用小段 `read_files`（≤400 行）；冒烟输出写文件，只报 PASS/FAIL 计数，不拉全文

用户换窗口时只需说：读 `d:\hyool\CONTEXT.md` 和 git log，按文档约定继续。

## 项目一句话

HYOOL = Cloudflare Workers 上的「数字生命」聊天网站：用户脑洞生成角色（create.html）、与角色实时聊天（buddy.html）、主页（yonder.html）、无限世界工具箱（workspace.html + 音频工坊 + 游戏工坊）、生命世界（world.html，多 AI 角色自主运转的「故事孵化器」）、工坊 hub（/hub，我的彼岸）。

## 技术栈与入口

- Workers + **Workers AI**：`@cf/meta/llama-3.3-70b-instruct-fp8-fast`（聊天 + 角色生成，见 `src/ai/gateway.js` 的 `chatCompletions`）
- D1 数据库（messages / conversations / memories / characters / worlds + world_json / world_threads / world_messages / sessions 等，schema 见 `schema/`，migration = 一个 SQL 文件一次改动）
- Vectorize 向量记忆（`searchRelevantMemories`，中文是短板）；头像 Pollinations；语音内置 TTS
- 入口：`src/index.js`（路由分发 + getAuthenticatedUser）、`src/mvp.js`（核心 API：chat `/api/buddy/:id/chat`，生命世界 `/api/worlds/:id/life/*`）、`src/ai/gateway.js`（LLM 网关）
- CI：push main 自动部署（GitHub Actions）

## 已确认的架构决策（用户拍板，不要推翻）

- **三层分层**：内核层（后端固定 prompt，前端不可覆盖）/ 内容层（角色字段 + story_hook）/ 参数层（temperature/max_tokens/proactivity 后端 clamp）
- **成人话题**：后端零关键词拦截，system 授权「双方自愿成年人」，红线全交模型自判；红线清单：未成年性内容 / 极端暴力 / 歧视 / 涉政 / 违法活动 / 教唆自杀自残 / 真实人物恶意 / 非自愿性内容
- **回复规则**：短句 ≤50 字、禁文字拟态词、emoji 低频、绝不透露是 AI
- **摘要机制**：`compressHistory`（gateway.js 导出）增量合并摘要，chat 按 `summarized_upto` 增量触发
- **禁手改** `.wrangler/dry/index.js`（部署 bundle 自动生成）
- **生命世界 = 故事孵化器**（2026-08-21 拍板）：AI 让世界自主产生可导出的连续故事；世界状态由系统自动维护（`world_json.state`），用户不设置；目标导出：小说 / Ren'Py / 分镜 / 游戏。详见下方「生命世界·故事孵化器」。
- **前端架构**：编解码全浏览器本地 WASM、无构建步骤、图片不上传服务器（隐私卖点）；iframe + postMessage = 外部构建产物接入标准；入口划分：无限=工具类（workspace）、幻想=制作类（fantasy）

## Companion 层（数字生命·一对一，Batch 5 完成）

> 三层架构：Companion 层「NPC 怎么活」/ World 层「世界怎么活」/ Director 层「接下来发生什么」。用户定案：**Companion 层是核心，World 服务于 Companion**。原则与 World Engine 一致：**引擎确定性落账，LLM 只演绎，不维护状态**。

- **状态挂载**：全部挂在 `characters.companion_state`（JSON，无 migration 前置依赖）+ `companion_inbox` 表（主动找你）。引擎 = `src/companion.js`（情绪/关系/家庭/里程碑规则，纯函数可单测）。
- **情绪**：20 个白名单标签 + 中文关键词规则确定性落账；现实时间衰减（每天 -1 强度，掉 0 归「平静」），读时惰性计算。
- **关系**：acquaintance→friends（亲密≥10 自动）→close（≥30 自动）→confession/dating/engaged/married（手动确认，manual 优先引擎不再自动动）。API：`POST /api/buddy/:id/relation`。
- **家庭**：婚后「想要孩子」→2 天怀孕→再 3 天出生（`advanceFamilyState` 惰性推进）；孩子=characters 新行（`parent_id` 标记，FNV-1a 确定性取名），可与孩子聊天。
- **主动找你**：亲密里程碑 10/30/50/70/90（chat 落账即时生成）/ 3 天未聊想念 / 关系纪念日 7·30·100·365 天（读取时惰性生成）。API：`GET /api/companion/inbox`、`POST /api/companion/inbox/read`。
- **世界内情绪（角色弧光，Batch 7）**：世界原住民也有心情——`world_json.state.moods[id]={label,intensity,day}`，复用同一套中文关键词规则 + **世界日衰减**（dayIndex 每 8 tick 一日，非现实时间）；发言/节拍台词确定性落账，注入 `buildLifeSystemPrompt`（发言带心情）与 `buildStoryBeatPrompt`（心情驱动节拍走向）；显著情绪变化记入 story timeline 作为角色弧光素材（导出小说/VN/游戏可用）。world.html 角色卡片与「世界故事」面板显示情绪 chip。
- **原住民转正（世界 → 角色库）**：`POST /api/worlds/:id/life/natives/:id/promote`（仅 owner）把原住民复制进角色库（companion_state 从零初始化、世界观保留），buddy 可继续一对一发展；原住民仍留在世界。与「角色库→世界（cast 邀请）」互补成闭环。
- 前端：buddy.html 情绪/关系状态行 + 设置面板「你们的关系」按钮组 + 未读留言条；hub.html 角色卡片情绪 chip/关系 chip/💌 角标。

## 生命世界·故事孵化器（当前核心）

> 最高目标：**你创造世界，AI 让世界发生故事。** 故事链：世界 → 故事 → 小说 / 视觉小说(Ren'Py) / 分镜 / 游戏。四象限：幻想 → 生命 → 无限 → 彼岸。

**已完成（Batch 1/2/3，均已部署 + 线上验证，详细见 docs/history.md）：**
- Batch 1/2：仙侠题材、角色库互通、封面上传、羁绊系统（bond 0~100，manual 强干扰优先）、AI 批量 NPC、线程背景/主线锁死、双栏布局等
- Batch 3 故事引擎：`world_json.state` 自动世界状态（story/beats/chapters/secrets/plots/timeline/lastPulseSeq）、节拍化 tick（`generateStoryBeat` 替代「挑人说一句」）、增量脉动 `updateWorldState`（积压 ≥4 条才跑）、affects/reveal/hide 后端立即落账、`GET /api/worlds/:id/life/story` 故事档案、world.html「故事」tab

**衔接既有（不推翻）**：Batch 1 羁绊保留（manual 覆盖优先）；Batch 2 规则/时代/氛围锁死作为种子设定喂给世界状态；成人红线/回复规则不变。

### ★ Batch 4 一键导出（当前唯一核心待办，未开工）

- **gateway.js 四个新函数**（均带 `mock` 兜底 + `mock` 参数）：
  - `exportWorldAsNovel` → Markdown：章节 + 正文（旁白→叙述、对白→引号、场景→段落）
  - `exportWorldAsRenpy` → `.rpy`：scene / character / dialogue / menu 分支
  - `exportWorldAsStoryboard` → 分镜 JSON：镜头 / 台词 / 场景描述
  - `exportWorldAsGame` → 任务 / NPC / 对话 / 世界状态 / 事件 JSON（未来可接 game-workshop）
- **新增** `POST /api/worlds/:id/life/export`：`target = novel|renpy|storyboard|game`
- **world.html「生成作品」区**：类型选择 → 生成 → 预览 + Blob 下载
- **新增** `public/story-export-check.html` 冒烟
- 验证：不做验证（见约定 4），生成后直接部署，线上由用户确认

### ★ Batch 4.5 World Engine 核心：NPC 目标状态机 + 后果生命周期（已 commit，未线上验证）

- 只抽 Horde Studio World Engine 思想的最小移植：不碰 UI / 现有字段 / DB 表，无 migration
- `world_json.state` 新增 `npcs{}`（goal/progress/status=active|blocked|achieved|abandoned）+ `consequences[]`（created→active→escalating/decaying→resolved，按 tick 老化）+ `tickCount`
- `generateStoryBeat` 输出新增可选 `goals[]`/`consequence{}`（sanitize 白名单 + clamp）；`buildStoryBeatPrompt` 注入「在场角色状态」+「发酵中的后果」
- 引擎落账：`applyBeatNpcUpdates` / `applyBeatConsequence` / `advanceWorldConsequences`；LLM 只演绎不维护状态

### ★ Batch 4.6 World Engine：知识边界 + NPC 日程/场景填充（已 commit，未线上验证）

- **知识边界（治「NPC 全知」）**：`world_json.state` 新增 `knowledge[]`（text/turn/seen=目击者 id[]/secret）；引擎在 tick 后落账 witness 戳——具体互动（有 who）=参与角色，纯旁白=在场全体，同场对话自动传播消息；普通事件留 60 条、秘密条目永久保留
- `buildStoryBeatPrompt` 注入「近期世界动态 / 已揭露线索（带目睹者）/ 在场角色不知道的近期事」+ 硬性信息边界规则（不知情角色不得替其说出不可能知道的事；此刻不在角色不得进 who）
- **NPC 日程（确定性种子）**：`state.seed`（=world.id 锚定）+ `state.dayIndex`（每 8 tick 一世界日）+ `state.schedules[day]`（npcId→location/activity，FNV-1a 哈希，reroll 可复现）；多地点世界（场景名+主线 ≥2）按日程限定在场角色，单地点世界维持全员在场（现状不变）；`activeCastForThread` 支持预解析 cast 参数 + `offCast` 透传
- **场景填充**：`state.ambient[day][location]` 确定性生成 1~2 名背景角色，注入「现场还有…（只做环境不发言）」
- 无 migration、无 UI/DB 改动（全部在 `world_json.state`），向后兼容

## 最近已完成（2026-08-23）

- **★ 全站角色池（前 60）仅管理账户可见（2026-08-23）**：`GET /api/hub` 游客分支不再返回全站公开角色（改 `characters: []`），该公开角色池只在管理账户 `333123`（与邀请码管理同一判定）登录时返回（附 `isAdminView: true`）；普通用户仍只返回自己的角色。前端 `hub.html` `renderChars` 新增 `readOnly` 参数，管理全站视图下角色卡隐藏编辑/删除/创造按钮（后端 update/delete 本有 owner 校验，管理员操作他人角色仍 403）。详见 docs/history.md 末尾。
- **游客访问 /hub 直接重定向 /plaza（2026-08-23）**：个人创作库（我的彼岸）只对登录用户开放。`public/hub.html` DOMContentLoaded 中 `isGuest` → `location.replace("/plaza")` + return（用 replace 防历史栈残留）；`hub-check.html` 访客断言同步改为「重定向 /plaza + 幻灵世界大标题」；后端 `GET /api/hub` 游客分支保留。详见 docs/history.md 末尾。


- **★ 主站生命世界广场 + 发布/下架 + 显示/隐藏解耦（2026-08-23）**：新建 `public/plaza.html`（主站广场，聚合所有已发布 life 世界）+ `GET /api/plaza`（`status='published' AND type='life'` + 主人信息 + natives_count）；首页「生命」入口从 `/hub` 改跳 `/plaza`。语义解耦：**`status`=发布/下架**（published 进主站广场、draft 移除；`PATCH /api/worlds/:id` 原有字段），**主页显示/隐藏=share_id 非空**（世界 PATCH 新增 `visible` 字段，清空/生成 share_id；主页访客世界过滤从 `status='published'` 改为 `share_id IS NOT NULL AND share_id != ''`，与角色一致）。按钮：主页世界卡右上角「发布/下架」（绿/红）+ 右下角「显示/隐藏」，hub 世界卡右上角「发布/下架」。迁移 `schema/migrate_plaza_share.sql` 已对 remote 执行（存量 published 世界补 share_id）。详见 docs/history.md「生命世界广场」。

- **★ Companion Engine（数字生命「一对一」层，Batch 5，2026-08-23）**：情绪状态机（20 标签 + 关键词规则确定性落账 + 现实时间衰减）+ 主动找你 inbox（亲密里程碑 10/30/50/70/90 / 3 天未聊想念 / 关系纪念日 7·30·100·365 天）+ 恋爱/结婚/家庭生命周期（表白→在一起→求婚→结婚，用户手动拍板 manual 优先；婚后「想要孩子」→2 天后怀孕→再 3 天孩子出生，孩子=characters 新行 parent_id 标记可与 TA 聊天）。全部状态挂 `characters.companion_state`（JSON），`src/companion.js` 引擎确定性落账，LLM 只演绎。详见 docs/history.md「Companion Engine」。
- **★ 世界角色弧光 + 原住民转正（Batch 7，2026-08-23）**：世界内情绪（`world_json.state.moods`，关键词规则 + 世界日衰减，发言/节拍落账，注入发言与节拍 prompt，显著变化进 story timeline）+ 原住民转正 API（`POST /api/worlds/:id/life/natives/:id/promote`，世界 → 角色库，companion_state 从零）。world.html 情绪 chip + ⭐ 转正按钮 + 故事面板「角色情绪」。无 migration。详见 docs/history.md。
- **★ 世界 AI 发言/节拍多样性（Batch 8，2026-08-23）**：修「世界AI反复就那么两句引导词、NPC也差不多」——根因=超时/解析失败静默 fallback 到固定话术 mock + prompt 缺禁重复约束。改动全部在 `src/ai/gateway.js`：mock 话术全面多样化（6×6 模板确定性轮转）；`generateStoryBeat` 超时 25s→45s + max_tokens 600→500（降 fallback）；`buildStoryBeatPrompt` 注入「世界氛围」素材块 + 严禁复用最近节拍句式硬规则；`buildLifeSystemPrompt` 加「不复读」规则；`sanitizeStoryBeat` 剔除与最近节拍完全重复的台词。无 migration。详见 docs/history.md。
- **★ 世界后台输入丢失修复（Batch 8.1，2026-08-23）**：修「大世界背景所有输入栏无法输入/输入的字切栏即消失」= `world.html` 世界后台侧栏的 `change` 委托处理器在 try/catch 外无条件执行 `e.target.value=""`，导致 side 内**所有**输入控件（时代/规则/势力/力量/氛围/地点/补充/背景图 + 运转面板 tick 秒数 + 模型下拉）在失焦（change 冒泡）瞬间被清空。修复：仅对文件上传控件（bgCoverFile/bgImageFile）清空 value。无 migration。详见 docs/history.md。
- **★ 创角页生图风格动图预览（2026-08-23）**：新增 `public/create-art/`（realistic.mp4 / 3d.mp4 / anime.mp4 / guofeng.mp4，**4 种生图风格动图齐备**）；`create.html` 风格卡与 `create-character.html` STEP1 艺术风格卡片用 `<video autoplay muted loop playsinline>` 展示生图风格动图（缺图 onerror 移除，create.html 保留 emoji 兜底）；引用路径 `/create-art/*.mp4` 按风格 id（realistic/3d/anime/guofeng）。动图尺寸已放大（桌面 2 列 / 移动单列，对标角色卡观感，commit `58d72d4`）。已 commit `a759424` + anime 补全 `7d6b726`，CI 部署后线上生效。详见 docs/history.md。
- **★ 手机端邀请码 + 聊天错位修复（2026-08-23）**：① 手机端「编辑彼岸」看不到邀请码管理 = `yonder-home.html` 的 `checkAdminAccess` 与 4 个 invite-codes 请求未带 `Authorization` header（依赖 cookie，页面其它请求都从 `localStorage.hyool_token` 取），已新增 `authHeaders()` 并给 5 处请求统一补上；② 与角色聊天退出过会儿再进消息错位 = `messages.created_at` 秒级精度，同轮 user/assistant 同秒插入时 `ORDER BY created_at DESC` 不稳定（实测 assistant 排到 user 前），`src/mvp.js` 三处读取（列表 LIMIT 100 / 沉淀 LIMIT 60 / 上下文 LIMIT 12）改 `ORDER BY rowid DESC`。commit `efdc7f8` + `daf180c`，CI 部署后线上生效。详见 docs/history.md。
- **★ 角色卡/世界卡显示·隐藏按钮（2026-08-23）**：主页（yonder-home.html）主人视图下每张角色卡/世界卡新增「显示/隐藏」按钮——隐藏=卡片半透明 + 红色「已隐藏」角标（角色清空 `share_id`、世界置 `status='draft'`，访客视图即消失）；再点「显示」恢复公开（角色重新生成 `share_id`、世界 `status='published'`）。后端角色 update 路由新增 `visible` 字段支持（`src/mvp.js`），世界沿用已有 `PATCH /api/worlds/:id` 的 `status`。详见 docs/history.md。




- **World Engine 知识边界 + NPC 日程/场景填充（Batch 4.6）**：`state.knowledge[]`（witness 戳）+ `state.schedules/ambient`（确定性种子日程+背景填充）；`buildStoryBeatPrompt` 注入信息边界块。无 migration。详见 docs/history.md。

- **首页主 logo 放大 + 间距优化**：`public/index.html` `.world-logo-main img` 桌面 96px→**160px**→**800px**、移动 72px→**120px**→**600px**（`logo.png` 主 logo，`logo1.png` 左上角未动，`max-width:88vw` 防溢出）；随后上下间距拉开：logo `top:4%`（移 3.5%）、上入口 fantasy `top:28%`（移 26%）、下入口 life `bottom:28%`（移 27%）。已 commit `12f2939`，CI 部署后线上生效。详见 docs/history.md。
- **用户主页分享链路限定在主页（`3533a94`）**：规则=游客在用户主页无论怎么操作都留在主页，仅点 LOGO 可回主站。改动：`buddy.html` 分享链接/游客登录提示携带 `?from=/@…`；`share.html` 识别 `from`，「与 TA 相遇」带回 from，「创造我的」/header/错误页按钮改为返回主页；`yonder-home.html` 门禁下 LOGO 可见可点（header z 100→810 高于 gate 800），移除门禁非 LOGO 的「返回首页」。详见 docs/history.md。

## 当前待办

- **Batch 4 一键导出**：用户 2026-08-23 明确「不做」（Companion 层三项已另行完成）
- **收费作品支付（二维码收单）**：数据/徽章层已就绪（pricing/price 列），支付渠道未实现；用户拍板暂不开通，待主动提出再推进
- **观察期/暂缓**（用户主动提出再推进）：情绪/场景路由 Agent（注：Companion 情绪状态机已完成，路由 Agent 仍暂缓）；RAG 知识库（embedding 可换 `@cf/baai/bge-base-zh-v1.5` 但需重建索引）；QLoRA 微调（需另起 GPU 推理栈）；世界消息清洗/归档；TTS/Live2D/VN 编辑器（自研 VN 编辑器 = 必做项，Ren'Py 替代）；音乐工作室 / 视频剪辑升级 / 图像超分
- 历史需求细节与完成记录：`docs/history.md`

## 常用命令

- 语法检查：`node --check src/xxx.js`（ESM 前端文件先复制成 `.mjs` 再 `node --check`）
- 本地起服务：`.\\start-dev.ps1`（8787 端口）；停止：`.\\stop-dev.ps1`
- 前端冒烟：`.\\run-browser-test.ps1 -Url http://127.0.0.1:8787/xxx-check.html -OutFile test-out-xxx.txt`
- 零浏览器快检（纯文案）：`.\\check-home-fast.ps1`（.ps1 含中文须 UTF-8 BOM）
- dry-run：`npx wrangler deploy --dry-run`
- D1 迁移（远程）：`npx wrangler d1 execute hyool-db --remote --file schema/xxx.sql`
- 部署：commit + push main（CI 自动）
- 注意：PowerShell 5.1 读中文文件设 UTF8；`read_files` 对同一文件多次范围读有缓存问题，可用 `Get-Content -Encoding UTF8` 绕过

## 已知限制

- llama-3.3-70b 自带安全层，极端表述仍可能被模型自身拦截/拒答，代码无法完全关闭
- **Workers AI 自动套 Llama chat template，禁止在 messages 里手写 `<|start_header_id|>` 等特殊 token**（双重模板崩盘）
- 本地 dev 的 Workers AI 远程绑定可能因代理挂起（60s 超时）；冒烟测试已走 `mock:true` 钩子，不受影响
- 线上邀请码 `HUBTEST2026` 曾因被禁用影响测试，激活时注意 is_active=1

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
8. **先找对再动手（2026-08-23 用户拍板）**：禁止「找不到 → 猜 → 改 → 发现不对 → 换方法 → 再改 → 再验证 → 再改」的反复折腾流程。改代码前必须先精确找到并读通相关源码/结构、确认理解正确，再一次性改对；找不到或拿不准就停下来问用户，不要猜着改
9. **终端命令纪律（2026-08-23 环境复盘，见「已知限制」末条）**：run_commands 是管理员 PowerShell 5.1 逐条新起进程执行；本机 git/node 命令**间歇性卡死 300s**（autocrlf + Defender），命令一律尽量短、一条只做一件事；**禁止 here-string 传大段中文**（5.1 解析挂起，写文件用 editor 工具）；git 一律 `git --no-pager ...`。工具报「Command exited with code N」≠ 脚本真实退出码（PowerShell 退出码继承最后一条 native 命令，会误报）——以实际输出为准，勿因误报反复重跑

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

## 故事作品云端同步（2026-08-24 完成，详见 docs/history.md）

- 作品编辑器数据上云：D1 新表 `stories` + `/api/stories*` 全套 API（列表/创建/保存/单读/发布下架/删除）；`/api/plaza` 与个人主页 `works.stories` 收录作品；幻灵世界广场与个人主页新增「故事作品」卡片，点击直达 `story-editor.html?story=<id>&play=1` 播放。
- 存储模型：创建即主页可见（share_id 恒非空），发布/下架只切 status（广场可见性）。story-editor 本地 localStorage 降级为离线缓存 + 存量自动迁移；登录后防抖上传整部作品。
- 待办：线上验证（登录打开 /story-editor 创建 → 主页可见 → 发布 → /plaza 可播放；手机端同步）；CI 已加入 D1 migration step（schema/migrate_stories.sql 随部署自动建表）。
- 前端：buddy.html 情绪/关系状态行 + 设置面板「你们的关系」按钮组 + 未读留言条；hub.html 角色卡片情绪 chip/关系 chip/💌 角标。

## 生命世界·故事孵化器（当前核心）

> 最高目标：**你创造世界，AI 让世界发生故事。** 故事链：世界 → 故事 → 小说 / 视觉小说(Ren'Py) / 分镜 / 游戏。四象限：幻想 → 生命 → 无限 → 彼岸。

**已完成（Batch 1/2/3，均已部署 + 线上验证，详细见 docs/history.md）：**
- Batch 1/2：仙侠题材、角色库互通、封面上传、羁绊系统（bond 0~100，manual 强干扰优先）、AI 批量 NPC、线程背景/主线锁死、双栏布局等
- Batch 3 故事引擎：`world_json.state` 自动世界状态（story/beats/chapters/secrets/plots/timeline/lastPulseSeq）、节拍化 tick（`generateStoryBeat` 替代「挑人说一句」）、增量脉动 `updateWorldState`（积压 ≥4 条才跑）、affects/reveal/hide 后端立即落账、`GET /api/worlds/:id/life/story` 故事档案、world.html「故事」tab

**衔接既有（不推翻）**：Batch 1 羁绊保留（manual 覆盖优先）；Batch 2 规则/时代/氛围锁死作为种子设定喂给世界状态；成人红线/回复规则不变。

**Batch 4 一键导出：用户 2026-08-23 拍板暂缓**（详见「当前待办」）。

**Batch 4.5/4.6 World Engine（已完成，详细见 docs/history.md「Batch 4.5」「Batch 4.6」）**：
- 4.5 NPC 目标状态机 + 后果生命周期：`world_json.state.npcs{}`（goal/progress/status）+ `consequences[]`（created→active→escalating/decaying→resolved）+ `tickCount`；节拍输出可选 `goals[]/consequence{}`，引擎 `applyBeatNpcUpdates/applyBeatConsequence/advanceWorldConsequences` 落账。
- 4.6 知识边界 + NPC 日程/场景填充：`state.knowledge[]`（witness 戳）+ `state.schedules/ambient`（确定性种子日程 + 背景角色），`buildStoryBeatPrompt` 注入信息边界块。全部存 `world_json.state`，无 migration、无 UI/DB 改动。

## 最近已完成（2026-08-23，一行摘要，详细见 docs/history.md）

- 修复「隐藏第二个作品」UNIQUE 冲突（share_id 空串改 NULL + 幂等迁移已执行 remote）→ history.md 末尾
- 作品编辑器（文字剧情积木）第一阶段：新建/章节/场景·对白积木/排序/编辑/删除/播放，localStorage 自动保存 → history.md「作品编辑器」
- 作品编辑器·视觉素材（第二阶段）：积木可添加/更换/删除画面（图片/GIF/WebP/MP4），二进制走现有 `/api/upload`→D1，localStorage 只存 URL 引用；播放时媒体全屏背景 + 文字前景点击切换 → history.md「作品编辑器·视觉素材」
- 全站角色池（前 60）仅管理账户可见；游客 /hub 重定向 /plaza → history.md「全站角色池 / hub 重定向」
- 主站生命世界广场 + 发布/下架 + 显示/隐藏解耦 → history.md「生命世界广场」
- Companion Engine（Batch 5：情绪/主动找你/恋爱结婚家庭）→ history.md「Companion Engine」
- 世界角色弧光 + 原住民转正（Batch 7）；世界 AI 发言/节拍多样性（Batch 8）；后台输入丢失修复（8.1）→ history.md
- 创角页生图风格动图预览（4 风格 /create-art/）→ history.md「创角页生图风格动图」
- 手机端邀请码管理 header 补齐 + 聊天记录 rowid 排序修复 → history.md「手机端邀请码」
- 角色卡/世界卡显示·隐藏按钮 → history.md「角色卡/世界卡显示·隐藏按钮」
- World Engine 知识边界 + NPC 日程/场景填充（Batch 4.6）→ history.md「Batch 4.6」
- 首页主 logo 放大/间距优化；用户主页分享链路限定主页 → history.md
- 作品编辑器·配音（第三阶段）：每个剧情积木可单独添加配音（MP3/WAV/M4A/OGG），编辑器试听/更换/删除；播放进入该幕自动播、切幕先停旧配音、退出停止；localStorage 存引用 → history.md「作品编辑器·配音」
- 作品编辑器·字幕+BGM+音效（第四阶段）：对白积木字幕（默认角色名+对白、开/关、改文字/位置/大小，播放前景底部不遮画面）；章节级 BGM（试听/音量/更换/删除，进入章节自动循环播，同章节切幕连续不重启，跨章节才切换）；积木级音效（进入自动播、切幕停止）；本地 CDP 冒烟 37/37 PASS → history.md「作品编辑器·字幕+BGM+音效」
- 作品编辑器·修复：角色音频 / 时间轴音效 同类单例 input 闭包 bug（新增 castPickSp/tlSfxTarget + 新积木 sfxList 兜底），冒烟 93/93 → history.md「闭包 bug 补修」
- 作品编辑器·播放：切幕转场渐入淡出（交叉淡化）消除黑屏闪烁（tl-leave 淡出 + playFadeIn 渐入 + 下一幕媒体预取 + startPlay/stopPlay 清残留），冒烟 100/100 → history.md「转场渐入淡出」
- 作品编辑器·场景字幕：场景积木获得与对白相同的字幕能力（开启/关闭、自定义文字、位置、大小），场景缺省关闭避免存量作品文字双显 → history.md「场景字幕」
- 作品编辑器·场景字幕修复：场景幕改电影式字幕模式——去掉中间场景卡片/「点击文字进入下一条」提示/玻璃虚化框，画面文字仅由字幕层承担（关=无文字），整幅画幅点击推进 → history.md「场景字幕·电影式字幕模式」
- 作品编辑器·字幕交互合并：删「编辑」按钮——场景编辑移除（场景内容不再可编辑），对白角色编辑（角色名+对白内容）并入「💬 字幕」弹窗；字幕去独立开关（有 subtitle 字段=开、无=关），弹窗加「移除字幕」回关 → history.md「字幕交互合并」
- 作品编辑器·字幕改「对白框」（重定向）：去掉翻译字幕（底部小条）形态，播放文字统一用可移动对白框——对白=中间对白卡（角色名+对白内容自动加引号）始终显示，位置=三档预设（底/顶/中偏下）或播放中自由拖拽（存 x/y 百分比，`pos='custom'`），字号**自定义拉大小**（弹窗滑条 12~72px，或播放中按住文字右下角「拉大小」手柄拖动实时调、松手自动保存，对白角色名联动 1.3x；旧三档 sm/md/lg 兼容）；场景=场景文字纯文字无框（内容=b.content，卡片正常显示），播放时可自由拖拽位置（x/y 百分比自动保存、写回真实数据、触屏可用）+字号同上，留空不显示；弹窗无独立字幕文字输入 → history.md「字幕改对白框」
- 作品编辑器·对白框改「聊天框」样式 + 文字颜色：对白框固定**底部聊天框**（全宽贴底、半透明深色底、文字左对齐），**取消**三档位置（底/顶/中偏下）与「自由（播放中拖拽）」选项（存量 pos/x/y 忽略、一律底部聊天框）；对白/场景文字均新增**颜色调节**（弹窗取色器 `subtitle.color`——对白角色名与对白内容同色、场景文字直接着色，选默认色不存字段）；字号自定义拉大小保留（对白角色名联动 1.3x）→ history.md「对白框·聊天框样式」
- 作品编辑器·字号全局统一 + 删提示：所有对白/场景文字字号**全局统一**——默认 27px，可调范围固定 25~30px，弹窗滑条修改即更新全局默认（localStorage `hyool_story_subtitle_size_v1`，跨作品生效）并立即生效；删除逐块 `subtitle.size` 存储（存量 size 字段忽略）；**删除**对白幕中间「点击文字进入下一行」提示与播放中「拉大小」手柄 → history.md「字号全局统一 + 删提示」
- 修复 /hub 页面不显示：Phase 0 中枢路由 `handleHubRoutes` 前缀拦截吞掉 `/api/hub` 数据接口（改为只接管 `/api/hub/` 子路径，精确路径放行给 mvp）→ history.md「/hub 页面不显示修复」

## 当前待办

- **Batch 4 一键导出**：用户 2026-08-23 拍板**暂缓**（Companion 层三项已另行完成，用户主动提出再推进）
- **收费作品支付（二维码收单）**：数据/徽章层已就绪（pricing/price 列），支付渠道未实现；用户拍板暂不开通，待主动提出再推进
- **观察期/暂缓**（用户主动提出再推进）：情绪/场景路由 Agent（注：Companion 情绪状态机已完成，路由 Agent 仍暂缓）；RAG 知识库（embedding 可换 `@cf/baai/bge-base-zh-v1.5` 但需重建索引）；QLoRA 微调（需另起 GPU 推理栈）；世界消息清洗/归档；TTS/Live2D；VN 编辑器后续阶段（Cocos/Canvas/AI API/时间轴/分支等；作品编辑器文字积木 + 视觉素材 + 配音 + 字幕/BGM/音效 四阶段均已完成 → history.md）；音乐工作室 / 视频剪辑升级 / 图像超分
- 历史需求细节与完成记录：`docs/history.md`

## 常用命令

- 语法检查：`node --check src/xxx.js`（ESM 前端文件先复制成 `.mjs` 再 `node --check`）
- 本地起服务：`.\\start-dev.ps1`（8787 端口）；停止：`.\\stop-dev.ps1`
- 前端冒烟：`.\\run-browser-test.ps1 -Url http://127.0.0.1:8787/xxx-check.html -OutFile test-out-xxx.txt`
- 零浏览器快检（纯文案）：`.\\check-home-fast.ps1`（.ps1 含中文须 UTF-8 BOM）
- dry-run：`npx wrangler deploy --dry-run`
- D1 迁移（远程）：`npx wrangler d1 execute hyool-db --remote --file schema/xxx.sql`
- 部署：commit + push main（CI 自动）
- 注意：PowerShell 5.1 读中文文件设 UTF8；`read_files` 对同一文件多次范围读有缓存问题，可用 `Get-Content -Encoding UTF8` 绕过；git 一律加 `--no-pager`；git/node 命令偶发被 Defender 拖到 300s 超时属环境正常，重试或拆短命令即可，勿据此判断代码问题

## 已知限制

- llama-3.3-70b 自带安全层，极端表述仍可能被模型自身拦截/拒答，代码无法完全关闭
- **Workers AI 自动套 Llama chat template，禁止在 messages 里手写 `<|start_header_id|>` 等特殊 token**（双重模板崩盘）
- 本地 dev 的 Workers AI 远程绑定可能因代理挂起（60s 超时）；冒烟测试已走 `mock:true` 钩子，不受影响
- 线上邀请码 `HUBTEST2026` 曾因被禁用影响测试，激活时注意 is_active=1
- **本机终端环境（2026-08-23 复盘）**：PowerShell 5.1 + git `core.autocrlf=true`（已确认）+ Defender 实时扫描 → git/node 命令**间歇性挂起至 300s 超时**（`git log/status/diff`、`node --version` 都可能中招；`git --no-pager log` 秒回 = 非代码问题）。规避：命令短、一条一命令、`--no-pager`、here-string 传大段中文会解析挂起（改用 editor 写文件）。工具退出码会误报「Command exited with code N」：PowerShell 退出码继承**最后一条原生命令**（如 `git config --get` 查不存在的 key 返回 1），以实际输出判定成败

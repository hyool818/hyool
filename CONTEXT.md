# HYOOL 项目上下文交接（AI 会话记忆）

> 用途：跨窗口/跨会话继续开发时，新 AI 会话先读本文件 + `git log --oneline -10`，
> 即可恢复上下文并继续编码。所有已确认的架构决策都在这里，不要推翻。

## 会话工作约定（每个接手本项目的 AI 会话必须遵守）

1. **开工前**：读本文件 + `git log --oneline -15` + 相关源码，不要只凭文档就改代码
2. **收尾时**：每次完成任务并 commit 后，必须同步把本次改动摘要更新到本文件对应章节（已完成改造 / 架构决策 / 待办状态），保持文档与代码一致
3. **决策红线**：已确认的架构决策不得推翻；需要调整必须先问用户
4. **验证闭环**：代码改动必须经过 `node --check` + `npx wrangler deploy --dry-run`（涉及 DB 的改动用 `wrangler d1 execute --remote` 验证），再 commit + push main
5. **临时验证脚本**：放在 `.wrangler/` 下，测完即删，不提交
6. **主动提醒换窗口（硬性规定）**：当会话进入「不划算」区间——累计完成任务 ≥5 个、或已多次读大文件/长命令输出导致上下文明显偏长、或接下来仍有较长开发任务——必须主动提醒用户更换新窗口，并说明换后只需说一句「读 CONTEXT.md 和 git log 继续」。禁止因为怕丢当前对话而隐瞒或拖延提醒。

用户换窗口时只需说一句：读 `d:\hyool\CONTEXT.md` 和 git log，按文档约定继续。

## 项目一句话

HYOOL = Cloudflare Workers 上的「数字生命」聊天网站：用户脑洞生成角色（创建页 create.html）、与角色实时聊天（buddy.html）、主页（yonder.html）。AI 对话能力集中在 LLM 网关模块。

## 技术栈与入口

- Workers + **Workers AI**：`@cf/meta/llama-3.3-70b-instruct-fp8-fast`（聊天 + 角色生成，见 `src/ai/gateway.js` 的 `chatCompletions`）
- D1 数据库（messages / conversations / memories / characters / sessions 等表，schema 见 `schema/` 目录，migration 惯例 = 一个 SQL 文件一次改动）
- Vectorize 向量记忆检索（`searchRelevantMemories`，embedding 用 `@cf/baai/bge-base-en-v1.5`，中文是短板）
- 角色头像：Pollinations 图片 API；语音：内置 TTS
- 入口：`src/index.js`（路由分发 + getAuthenticatedUser），`src/mvp.js`（核心 API 路由，chat 在 `/api/buddy/:id/chat`），`src/ai/gateway.js`（LLM 网关）
- CI：push main 自动部署（GitHub Actions）

## 已完成的对话能力改造（近 3 次提交，均已部署）

1. **a877d6a** — System Prompt 分区模板重构：身份 / 对方（用户昵称）/ 关系阶段（intimacy 分档）/ 回复规则 / 话题边界 / 记忆；成人话题低审核 + 硬性红线；proactivity / story_hook / 昵称接线
2. **4dd0099** — emoji 低频化：默认无 emoji，每 3~4 条最多一次
3. **78d53a2** — 扣子式对话流程（共情优先→澄清梳理→客观拆解→分层方案→边界提醒+危机引导）；方案模式 max_tokens 默认 200；**超长对话自动摘要**（conversations 新增 summary / summarized_upto，增量合并压缩，最近 12 条永不摘要）

## 已完成的前端改造（无限世界 · 图片工作台，均已部署）

1. **1cce3c0** — FastEdit 图片工作台上线：`public/workspace.html` + `public/workspace/js/*`。纯前端本地处理（压缩/转换/动图/视频/打码/抠图/批量），vendored jsquash WASM 编解码（webp/avif/jpeg/png/oxipng/gif），修复 15 处 vendored import 路径错误；`public/index.html` 无限世界入口跳转 `/workspace.html`
2. **2d8991c** — 无限世界·工具总览入口页（hub）：`workspace.html` 新增 hub 首页（hero + 工具卡片 + 世界入口），新增 `hub.js`（hub/编辑器视图切换、`?tool=editor|ai|presets` 直达、返回按钮）；`app.js` 暴露 `window.enterWorkspaceTab`；修复 `switchTab('edit')` 无对应面板导致导入图片后控制面板空白
3. **8dfeb15** — 裁剪后「图片左右分离」bug 修复（第一轮，JS 层）：对比模式关闭时 `applyCompareClip()` 不再给 `canvasOut` 套 `clipPath`（旧代码在 layoutStage 无条件按 slider 裁掉左半、露出底下原图画布，一旦裁剪/旋转触发重排版即现形）；开关/滑块/重渲染统一走 `applyCompareClip()`。回归测试 `public/crop-compare-check.html` 上线
4. **cb304a0** — 「左右分离」bug 真正根因 + 顶栏导出按钮：① 根因其实在 CSS —— `workspace.css` `.compare-canvas.out{clip-path:inset(0 50% 0 0)}` 无条件裁掉 canvasOut 右半，即使 JS 清空内联 clip 仍生效（上一轮只测内联 style 漏掉 computed style）；现已删除该规则，对比关闭时 canvasOut 完整覆盖 canvasOrig。对比开启时由 applyCompareClip() 内联 `inset(0 0 0 pct%)` 控制分割，并新增分割线指示器（随滑块移动）+ 「原图/处理后」标签（compare-on 时显示）。② 顶栏新增常驻「↓ 保存/导出」按钮（`topExportBtn`），素材加载后可见，按静态图/动图/视频分派 exportStatic/exportAnim/exportVideo。回归测试扩至 14 断言（computed clip-path、分割线位置、标签可见性、裁剪后无 clip、裁剪后对比仍可用、顶栏按钮可见），本地 SMOKE-OK；`ui-check` SMOKE-OK
5. **c474ec1** — 裁剪交互重构 + 右键菜单：① 裁剪改为「草稿 → 确认」流程，修复「框选后无法再移动/只能重导素材」：框选后不再立即应用/退出裁剪模式，预览始终保持完整原图（`cropDraft` 草稿态 + `cropHitTest` 四角手柄/整框命中检测，`onStagePointerUp` 只更新草稿不 rerender）；裁剪框可整框拖动、拖四角缩放（`drawOverlay` 绘制遮罩+手柄，仅裁剪模式显示，确认后不遮挡预览）；新增「✓ 确认裁剪 / ✕ 取消 / 清除裁剪」按钮（applyCropDraft / cancelCropDraft / clearCrop），Esc 取消，框选过小自动还原。② 编辑器内右键弹出自定义菜单替代浏览器「检查」：新增 `#stageMenu`（更换图片 / 删除图片）+ `removeAsset()` 清空舞台回空状态（画布/顶栏导出/帧条/视频条/对比同步复位）。回归测试 `crop-compare-check.html` 扩至 18 断言（框选后画布未变、遮罩/确认/取消出现、框可继续移动、确认生效、右键菜单、删除清空），本地 SMOKE-OK；`ui-check` SMOKE-OK
6. **eb46fc3** — 瑕疵遮盖「跨图补丁 + 仿制图章」：① 顶栏按钮「↓ 保存/导出」改名「↓ 导出素材」（`topExportBtn`，文案同时同步到 `crop-compare-check.html` 断言）。② 新增「补丁」tab：`workspace.html` 补丁面板（`#patchPickBtn` 选补丁图 / `#patchOpacity` 透明度 / `#patchFeather` 羽化 / `#patchList` 列表，行含「补丁」标签 + `x%,y% · w×h%` 坐标 + 删除按钮），`app.js` 新增 `bindPatchEvents` / `addPatchFromImage` / `renderPatchList` / `syncPatchSliders` / `refreshPatchPreview` / `drawPatchedImage` 合成（engine.js）；预览管线缓存不含补丁（`state.baseCache`），补丁在 `drawPreviewComposite` 实时合成（拖动/调参不重跑 wasm）；选中态高亮 + 整框拖动/四角缩放（`patchHitTest`），透明度/羽化作用于当前选中补丁；导出走 `processImageData` 的 `applyPatches`（静态/动图/视频各帧合成）。③ 仿制图章：工具切换段（`patchToolSeg`）patch/stamp 面板互切；`enterStampMode` 生成工作底图（base+overlay），单击取样点 → 按住涂抹（软边蒙版融合，`rasterizeStroke`）→ `stampUndoBtn` 撤销单笔 → `stampDoneBtn` 完成合并。修复 bug：补丁列表删除按钮被行级 `data-select` 的 `closest` 分支先拦截导致永远删不掉（调整判断顺序：先 `[data-del]` 后 `[data-select]`）。新增回归测试 `public/patch-check.html` 22 断言（补丁 tab/面板、添加后列表与合成、整框拖动、四角缩放、透明度滑杆、删除恢复、图章面板互切、取样式笔触改色、撤销、完成合并保尺寸、顶栏文案、iframe 内无未捕获异常），本地 SMOKE-OK；`crop-compare-check` 18/18 SMOKE-OK；`ui-check` SMOKE-OK；线上 workers.dev 同 22/22

前端架构要点（勿推翻）：

- **编解码全部浏览器本地 WASM**（jsquash + pako/UPNG/omggif），图片不上传服务器（隐私卖点）
- **无构建步骤**：`public/workspace/vendor/` 全是 ESM/WASM 静态文件；`pako/UPNG/omggif` 为经典脚本须先于 app.js 加载，`wasm-feature-detect` 裸导入靠 importmap 解析到 `/workspace/vendor/wasm-feature-detect/index.js`
- **冒烟测试**：`public/smoke-test.html`（编解码/动图/批量/视频）、`public/ui-check.html`（hub/编辑器切换）、`public/crop-compare-check.html`（对比+裁剪回归 18 断言）、`public/patch-check.html`（补丁+图章回归 22 断言）；跑法：本地起静态服务（`start-dev.ps1`，8787 端口）+ `run-browser-test.ps1 <url> <out>`（CDP 真实帧驱动，等待 `document.title` = SMOKE-OK/FAIL，同时收集 console/网络错误）。注意：headless `--virtual-time-budget --dump-dom` 下 CSS 过渡帧不推进、computed style 读取会滞后，导致「再次关闭对比后标签隐藏」等断言偶发 FAIL——属环境伪影，改用 CDP 真实帧跑必过；视频 roundtrip 在 headless 下会 FAIL 属环境限制非代码 bug

## 已确认的架构决策（用户拍板，不要推翻）

- **三层分层**：内核层（后端固定 prompt，前端不可覆盖——防 prompt injection 绕过安全规则）/ 内容层（角色字段 + story_hook）/ 参数层（temperature/max_tokens/proactivity 由后端 clamp）
- **成人话题策略**：后端零关键词拦截，system 授权「双方自愿成年人」内容，红线全交给模型自判，拒绝时一句带过不教训
- **红线清单**：未成年性内容 / 虐杀极端暴力 / 种族·地域·性别·宗教歧视 / 涉政 / 违法活动 / 教唆自杀自残 / 真实可辨识人物恶意内容 / 非自愿性内容
- **回复规则**：短句 ≤50 字（对方抛具体问题可放宽到 150 字分点）、禁文字拟态词（（微笑）/*脸红*/～点头～等）、emoji 低频、绝不透露是 AI
- **禁手改 `.wrangler/dry/index.js`**（部署 bundle 自动生成）
- **摘要机制**：`compressHistory`（gateway.js 导出）增量合并摘要；chat 路由按 `summarized_upto` 增量触发（>20000 字符），摘要以【过往对话摘要】注入 # 记忆

## 新增工具规划（2026-08-20 拍板，多工具矩阵）

> 背景：无限世界·工具箱将扩展为「图片 / 音频 / 音乐 / 视频 / AI / 游戏」矩阵。均沿用现有架构约定：无构建步骤、浏览器端处理优先、CDN 懒加载 + IndexedDB 缓存、hub 卡片 + workspace/js 模块 + 冒烟测试。

### 入口划分（工具类 → 无限，制作类 → 幻想）——2026-08-20 追加拍板
- **无限入口**（`index.html` 无限世界 → `workspace.html` 工具箱）：处理素材的「工具类」——FastEdit 图片工作台（已上线）、音频工坊 `audio.html`、视频剪辑升级、图像超分、去水印、AI 扩图
- **幻想入口**（`index.html` 幻想世界 → `fantasy.html`，2026-08-20 激活）：创作产出的「制作类」——音乐工作室（MIDI+虚拟乐器）、游戏工坊（用户自建 H5 游戏，PixiJS B 路线）、自研 VN 编辑器、Live2D、TTS（GPT-SoVITS）
- **H5 游戏路线**：先走 B（PixiJS 做「游戏工坊」——用户在浏览器内自建轻量小游戏，无构建、与工作台同构）；A（Cocos Creator 独立源工程 → Web 产物 → iframe+postMessage 嵌入）暂存档
- **游戏工坊定位（2026-08-20 补正）**：工坊 = 用户自己完成游戏的制作工具（与音乐工作室 / VN 编辑器同性质），不是我们交付现成游戏；首版做模板化生成器（选模板 → 配置角色/背景/难度/音效 → 即时试玩 → 存档），跑通后升级更自由的编辑能力
- **速度优先级（哪些快做哪些）**：音频工坊（最快，纯前端）→ 幻想入口骨架 + 首款 PixiJS 游戏工坊 → 音乐工作室 → 视频剪辑升级 → 图像超分 → 其余按档

### ✅ 第一批（现在做，纯前端低风险）
1. **音频工坊 `public/audio.html`**：Web Audio API + Canvas 波形 + 裁剪/拼接/音量/淡入淡出/三频均衡/压缩器/反向 + 导出 WAV（原生 PCM）/ MP3（lamejs CDN 懒加载）；无限入口 hub 卡片直链
2. **幻想入口 `public/fantasy.html`**：制作类 hub 页，激活 index.html 幻想世界跳转 + workspace 世界链接
3. **首款 PixiJS 游戏工坊**（模板化小游戏生成器：用户选模板→配置角色/背景/难度/音效→即时试玩→存档；B 路线，PixiJS CDN 懒加载）

### ✅ 第二批（现在做，投入较大）
4. **音乐工作室（MIDI 编曲 + 虚拟乐器）**：@tonejs/midi 解析/生成 .mid + 自绘钢琴卷帘 + tone.js 回放；虚拟乐器用 Web Audio 合成 + WebAudioFonts 采样 + WebMIDI 输入（WebMIDI 仅 Chrome/Edge 且需用户手势，无 MIDI 设备时鼠标点卷帘兜底）
5. **视频剪辑升级**：主力 WebCodecs + mp4-muxer（硬件加速、无大包体；Chrome/Edge 94+、Safari 16.4+），复用现有 Canvas 打码/裁剪管线，新增 MP4 导出 / 音画合成；ffmpeg.wasm（~31MB，多线程需 COOP/COEP）仅做 WebCodecs 不可用或特殊格式时的兜底
6. **onnxruntime-web 图像超分**：Real-ESRGAN-x4 ONNX ~64MB，复用 ai.js 的 CDN 懒加载 + IndexedDB 缓存模式，ort-web wasm / WebGPU（Chrome 113+）双后端

### 🗄 存档后续（用户暂缓 / 需前置条件）
- **TTS 文字转语音**：目标 GPT-SoVITS（高质克隆音色），需 GPU，与 Workers 架构不兼容 → 与 QLoRA 微调一并归入「另起 GPU 推理栈」后做
- **onnxruntime-web 去水印（图片 / 动图 / 视频）**：LaMa inpainting ONNX ~200MB、浏览器 CPU 慢（需 WebGPU）、效果依赖水印类型；按 图片→动图→视频 顺序实验，视频逐帧在浏览器端可行性低（保留但不优先）
- **onnxruntime-web AI 扩图**：需生成式模型（SD 系），浏览器端不现实，且与隐私卖点冲突 → 暂缓
- **Live2D Cubism SDK for Web**：技术可行（纯前端 WebGL，SDK 免费、需展示版权声明）；瓶颈在模型资产（Cubism Editor 收费 / nizima 购买 / 官方样例），等用户提供模型文件后进第二批，用于 buddy 形象区呼吸 / 说话动画
- **自研 VN 编辑器（Ren'Py 替代，必做）**：剧本 JSON + Canvas/PixiJS 渲染 + 复用素材管线；不引入 Ren'Py 本体
- **H5 游戏路线 A（Cocos Creator）**：独立源工程 → CLI/CI 构建 Web 产物 → iframe + postMessage 双向通信嵌入站点（或独立路由）；暂存档

### ❌ 明确不做 / 已确认的可行方案
- **Ren'Py 本体**：Python 桌面引擎，无官方 Web 导出，renpy-web（Pyodide）实验性、体积大、体验差
- **Cocos Creator 作为工具箱原生工具**：独立 IDE/引擎工程，不嵌入；但其 H5 构建产物可 iframe 嵌入（路线 A）
- 已确认：**iframe 嵌入 + postMessage 双向通信 = 外部构建产物（H5 游戏/VN）接入站点的标准方式**，与页面是否用 Vue/React 无关，本项目原生静态 HTML 同样适用

## 观察期 / 待办（用户暂缓，用户主动提出再推进）

- 第三层：情绪/场景路由 Agent、RAG 知识库（若做：embedding 可换 `@cf/baai/bge-base-zh-v1.5`，但需重建向量索引）
- 第四层：QLoRA 微调——**与 Workers 架构不兼容**（Workers AI 不支持自定义权重），需另起 GPU 推理栈
- 前端文案（buddy.html / create.html）未动，属可选优化

## 已知限制

- llama-3.3-70b 自带安全层，极端表述仍可能被模型自身拦截/拒答，代码无法完全关闭
- **Workers AI 自动套 Llama 官方 chat template，禁止在 messages 里手写 `<|start_header_id|>` 等特殊 token**（会双重模板崩盘）

## 常用命令

- 语法检查：`node --check src/xxx.js`（ESM 前端文件先复制成 `.mjs` 再 `node --check`）
- 前端冒烟：`powershell -File .\run-browser-test.ps1 -Url http://127.0.0.1:8787/ui-check.html -OutFile test-out-ui.txt`（需先 `.\start-dev.ps1` 起本地 dev）
- dry-run：`npx wrangler deploy --dry-run`
- D1 迁移（远程）：`npx wrangler d1 execute hyool-db --remote --file schema/xxx.sql`
- 部署：commit + push main（CI 自动）
- 验证 prompt：可在 `.wrangler/` 下写临时脚本 + `node` 运行（用完删除）
- 注意：PowerShell 读中文文件设 `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8`；`read_files` 对同一文件多次范围读取有缓存问题，可用 `Get-Content -Encoding UTF8` 绕过

## 已完成的「对话→剧本→世界→工坊」最小闭环（本会话，已部署）

- **gateway.js**：`generateScriptFromConversation({character, transcript, existingScenes}, env)` —— LLM 生成 3~5 幕剧本 + mock 降级 + `normalizeScript`，返回 `{title, summary, scenes:[{id,type,speaker,text,choices}]}`。
- **mvp.js** `POST /api/buddy/:charId/script`：鉴权 → 最近 60 条消息 → 复用 `cast_ids` 含该角色的 world（追加场景并重排 scene id），否则新建 `type="mixed"` 世界（`settings {genre:"custom", genreLabel:"自定义", source:"buddy-script"}`、`source_conversation` 存 conversation_id、`cast_ids` 含角色）→ 写 `script_json` → 返回 `world + script_count`（实时统计 scenes，无 script_count 列）。
- **buddy.html**：头部「🎬 沉淀为剧本」按钮；成功后 toast「已沉淀为剧本《…》· N 幕」+「去工坊看看 →」跳 `/hub?world=id`；`.settings-overlay` 与 crop modal 已恢复。
- **hub.html**：剧本计数兼容 `{title,summary,scenes}` 对象与数组；「进入工坊」放行 `game/mixed` → `/game-workshop?world=id`；`?world=id` 直达世界详情弹窗。
- **game-workshop.html（新建）**：三态播放器（narration / dialogue / choice，上一幕/下一步/选项跳转、剧终页、空剧本提示）。
- **入口**：workspace/fantasy「生命」→ `/hub`；index 生命 650ms 后跳 /hub；yonder-home 新增 WORLDS section（`loadWorlds()/renderWorlds()`，卡片直达 `/hub?world=`）。

## 本会话修复（均已部署 + live 验证）

1. worlds 路由正则放行下划线：`/^\/api\/worlds\/(world_[a-z0-9_]+)$/`（GET/DELETE）—— 手动/演示 id 含下划线不再 404。
2. `formatWorld.play_url` 覆盖 `mixed`，URL 用无扩展名 `/game-workshop?world=id`（Cloudflare Static Assets 会把 `*.html` 301 到无扩展名形式）。
3. game-workshop「下一步」钳制 `Math.min(scenes.length, cursor+1)`，使剧终页可到达（旧代码钳到 len-1 永远停在最后一幕）。
4. yonder-home `renderWorlds()` 简化：去掉 `section:` 标签块，改普通 if + 提前 return。
5. `cdp-driver.js` 增加 `Network.setCacheDisabled`（消除浏览器缓存导致的冒烟误报）。
6. **远端 D1 worlds 表旧 schema 补列**：`schema/migrate_worlds_v2.sql`（ALTER TABLE ADD COLUMN type/cover_image/script_json/cast_ids/settings/source_conversation/status/share_id）已对 remote 执行成功；`migrate_worlds.sql`（CREATE IF NOT EXISTS）对已存在的旧表无效，勿再依赖。
7. 远端插入邀请码 `HUBTEST2026`（is_active=1, max_uses=100）供测试/演示注册。

## 验证记录

- `.wrangler/e2e-script-test.ps1`（seed→register→POST script→worlds list）：全绿（mock AI 路径，AI 绑定临时注释）。
- `public/workshop-smoke-check.html`（CDP，30 断言）：A 三态播放 / B `?world=` 直达 + 剧本计数 + 进入工坊 / C buddy 沉淀按钮 + toast 跳转 / D choice 选项跳转 / E yonder-home 世界卡片 —— 全部 PASS，console 无错误。
- 回归：patch-check / crop-compare-check（复跑后 OK）/ ui-check / hub-check / fantasy-check 全部 SMOKE-OK。
- Live：`https://hyool.w910227a.workers.dev`（v c63e567e）注册→建 mixed 世界→列表→详情→`/game-workshop?world=` 200 全通。

## 待办状态

- 本会话所有变更**尚未 commit / push**（需 `git add -A && git commit` 后 push main 触发 CI 部署）。
- 本地 dev 正常（AI 绑定已恢复）；`wrangler.toml` 无残留测试改动。


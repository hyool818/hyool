# HYOOL 历史归档（2026-08-22 瘦身快照）

> 这是文档瘦身前的 CONTEXT.md 完整快照，含所有历史完成记录、详细验证过程与旧版约定。
> **当前生效的会话约定 / 架构决策 / 待办以 `d:\hyool\CONTEXT.md` 为准**，本文件只用于查历史细节。
> 收尾约定：每次任务完成后，详细记录追加到本文件底部（CONTEXT.md 只写一行摘要 + 指向这里）。

---


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
- **生命世界 = 故事孵化器（2026-08-21 拍板）**：世界自主产生可导出的连续故事，而非多人聊天；世界状态由系统自动维护（`world_json.state`），用户不设置/不修改；目标导出：小说 / Ren'Py / 分镜 / 游戏。详见「已拍板：生命世界升级『故事孵化器』」章节。
- **摘要机制**：`compressHistory`（gateway.js 导出）增量合并摘要；chat 路由按 `summarized_upto` 增量触发（>20000 字符），摘要以【过往对话摘要】注入 # 记忆

## 新增工具规划（2026-08-20 拍板，多工具矩阵）

> 背景：无限世界·工具箱将扩展为「图片 / 音频 / 音乐 / 视频 / AI / 游戏」矩阵。均沿用现有架构约定：无构建步骤、浏览器端处理优先、CDN 懒加载 + IndexedDB 缓存、hub 卡片 + workspace/js 模块 + 冒烟测试。

### 入口划分（工具类 → 无限，制作类 → 幻想）——2026-08-20 追加拍板
- **无限入口**（`index.html` 无限世界 → `workspace.html` 工具箱）：处理素材的「工具类」——FastEdit 图片工作台（已上线）、音频工坊 `audio.html`、视频剪辑升级、图像超分、去水印、AI 扩图
- **幻想入口**（`index.html` 幻想世界 → `fantasy.html`，2026-08-20 激活）：创作产出的「制作类」——音乐工作室（MIDI+虚拟乐器）、游戏工坊（用户自建 H5 游戏，PixiJS B 路线）、自研 VN 编辑器、Live2D、TTS（GPT-SoVITS）
- **H5 游戏路线**：先走 B（PixiJS 做「游戏工坊」——用户在浏览器内自建轻量小游戏，无构建、与工作台同构）；A（Cocos Creator 独立源工程 → Web 产物 → iframe+postMessage 嵌入）暂存档
- **游戏工坊定位（2026-08-20 补正）**：工坊 = 用户自己完成游戏的制作工具（与音乐工作室 / VN 编辑器同性质），不是我们交付现成游戏；首版做模板化生成器（选模板 → 配置角色/背景/难度/音效 → 即时试玩 → 存档），跑通后升级更自由的编辑能力
- **速度优先级（哪些快做哪些）**：音频工坊（最快，纯前端）→ 幻想入口骨架 + 首款 PixiJS 游戏工坊 → 音乐工作室 → 视频剪辑升级 → 图像超分 → 其余按档

### ✅ 第一批（已完成，纯前端低风险）
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

## ✅ 已完成的新工具矩阵（首批 3 项，均已部署）

1. **音频工坊** `public/audio.html` + `workspace/js/audio.js`：Web Audio + Canvas 波形，裁剪/拼接/音量/淡入淡出/三频均衡/压缩器/反向，导出 WAV（原生 PCM）/MP3（lamejs CDN 懒加载）；无限 hub 卡片直链。冒烟 `public/audio-check.html` SMOKE-OK。
2. **幻想入口** `public/fantasy.html`：制作类 hub（音乐工作室 / 游戏工坊 / VN 编辑器 / Live2D / TTS 共 5 卡片），激活 index.html 幻想世界跳转 + workspace 世界链接。冒烟 `public/fantasy-check.html` SMOKE-OK。
3. **游戏工坊** `public/game-studio.html` + `workspace/js/game-studio.js`（740 行）：
   - 引擎：**PixiJS 8.6.6 jsDelivr 懒加载**（WebGL），加载/初始化失败自动回退 Canvas2D；`engineMode` = `pixi/canvas/idle`，顶部引擎徽章展示当前引擎。
   - 三模板：接水果 🧺 / 躲避 🐱 / 打地鼠 🔨。配置面板（角色 / 背景色 / 难度 / 时长 / 音效开关）→ 即时试玩（HUD：得分 / 命中数 / 剩余时间，Canvas 640×420 自适应缩放）；打地鼠为 3×3 宫格点击计分。
   - 存档：localStorage `hyool_games_v1`，「我的游戏」列表可载入/删除；音效全为 Web Audio 合成，无外部音频文件。
   - 对外暴露 `window.GameStudio` 测试 API（`start/stop/save/list/startSaved/deleteSaved/state/tapCell/engine` 等）。
   - 入口：fantasy.html 游戏工坊卡片 badge「已开放」+ CTA 直链 game-studio.html。
   - 冒烟 `public/game-studio-check.html` **28 断言全 PASS**（PixiJS 真引擎启动、模板切换、自定义角色保留、存档全流程、打地鼠点击得分），回归 audio-check / fantasy-check 均 SMOKE-OK。
   - **经验教训**：编辑器对中文大文件多次插入会偶发截断/错位（game-studio.js 曾因此损坏）；对策 = 拆 `.gs/part*.js` 小分片 + `copy /b` 拼接，校验后再删分片。下次改大 JS 沿用此法。

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

## 已完成的「生命世界」多角色自主共存（本会话，已部署）

用户对「自定义世界」的想象是**多 AI 角色自主共存的动态世界**，而非剧本容器。新增 `type="life"` 世界形态：

- **数据**（`schema/migrate_life_worlds.sql`，已对 remote + local 执行）：
  - `worlds` 加 `world_json` 列（背景 / 原住民 natives[] / 关系 relations[] / 场景 scenes[] / 运转 life{...}）
  - 新表 `world_threads`（线程：auto/scene/main，`scene_id` 关联场景）与 `world_messages`（多角色消息流，`actor` 归属 + 线程内 `seq` 递增序号用于增量拉取）
- **模型路由**（`src/ai/models.js` 新建）：四个可选对话模型 llama3-70B（现网）/ dsv4pro / XVERSE-Ent-25B / Qwen3-27B-Instruct（GPU 后端待上线）。`chatCompletions` 支持注册表 id 与原始 workers-ai id；provider `gpu` 走 OpenAI 兼容 `/chat/completions`，配置 `GPU_BASE_URL` + `GPU_API_KEY` 即启用，未配置自动回退 llama3-70B。前端选择器标注各模型「擅长领域建议」（`GET /api/models`）。
- **gateway.js**：`generateNativeCharacter`（原住民生成）、`buildLifeSystemPrompt`（身份=世界原住民+世界观+现场+关系+发言规则）、`generateWorldLine`（单角色发言）、`pickNextSpeakers`（启发式挑发言人）、`summarizeWorldGap`（离开期间摘要）；全部带 mock 降级 + `mock` 参数（冒烟测试钩子）。
- **mvp.js** `/api/worlds/:id/life/*`：`GET`（完整视图）/ `natives` 增改删 / `background` / `relations` / `scenes` / `threads` / `chat`（用户插话+回应）/ `tick`（自主运转，10s 冷却）/ `messages?after=`（增量拉取）/ `settings` / `summary`（补播摘要）。`POST /api/worlds` 放行 `life` 类型并初始化 world_json+初始线程；`formatWorld` 返回 `world_json`/`life_mode`/各计数，`play_url` → `/world?world=id`。
- **运转三模式**（创建时可选，后台可切换）：watch=在线运转（页面开着才 tick）、hybrid=在线实时+离线补播（cron 慢节奏 + 打开时「期间摘要」）、always=24h 后台（cron 持续）。Cron：`wrangler.toml [triggers] crons = ["*/15 * * * *"]`，`index.js` 新增 `scheduled` → `handleWorldCron(env)`（按各世界冷却间隔+每日 60 次上限+单次最多 20 世界收敛成本）。
- **前端**：`public/world.html`（新建）世界直播间——顶栏模式徽章/暂停/模型选择（带擅长领域提示）、线程栏、角色彩色气泡对话流、插话框（Enter 发送）、侧栏世界后台（背景/原住民 AI 生成+手动/关系/场景/运转设置）、watch/hybrid 在线 tick 循环 + visibilitychange 暂停 + 8s 轮询增量、always 仅轮询、hybrid 打开时补播摘要。

## World Engine 核心：NPC 目标状态机 + 后果生命周期（Batch 4.5，2026-08-23）

**背景**：调研 Horde Studio / Soul of Waifu / Shikigami 后确认，HYOOL 故事孵化器缺的是「World State → NPC State → Relationship → Goal → Event → Consequence」链条的中段：没有 per-NPC 持久状态，`consequence` 类型节拍是一次性旁白，关系只有 bond 无数值态度。用户拍板：只抽 Horde 的 World Engine 思想做最小移植，不整套套、不碰现有 UI / 数据结构 / DB 表；AGPL 代码只读思想、自己重实现。

**改动**（2 文件，+156/-4，无 migration）：
1. `src/ai/gateway.js`
   - `buildStoryBeatPrompt`：注入「在场角色状态」（`state.npcs` 里在场角色有 goal 时输出 目标/进展/状态）+「发酵中的后果」（`state.consequences` 未 resolved 的 title/严重度/阶段）；输出模板与规则新增 `goals[{id,goal,progress,status}]`（最多 2 条、只能是在场角色）+ `consequence{title,severity}`（仅 t=consequence 时输出）。
   - `sanitizeStoryBeat`：清洗 `goals`（castIds 白名单、progress clamp 0~100、status 白名单 active|blocked|achieved|abandoned）与 `consequence`（title/severity clamp）；空节拍 fallback 分支透传新字段。
2. `src/mvp.js`
   - `parseWorldJson`：兜底 `state.npcs = {}` / `state.consequences = []` / `state.tickCount = 0`（向后兼容，旧 world 无新键照常）。
   - 新增 4 个引擎函数（顶层模块作用域）：`ensureNpcStates`（在场角色状态槽兜底）、`applyBeatNpcUpdates`（beat.goals 落账：clamp + 白名单，achieved/abandoned 记 endedAt）、`applyBeatConsequence`（同标题未 resolved 合并、否则新建 created）、`advanceWorldConsequences`（每 tick 推进：created→active→severity≥50 escalating / <50 decaying→resolved；发酵中最多 8 条按严重度保留，resolved 保底 20 条）。
   - `applyStoryBeat`：beat 记录携带 `goals`/`consequence` 字段；affects 落账后调用 `applyBeatNpcUpdates` + `applyBeatConsequence`（引擎确定性落账，不靠模型自觉）。
   - `runWorldTickCore`：`generateStoryBeat` 前 `ensureNpcStates(wj, activeCast)`；有消息产出后 `tickCount++` + `advanceWorldConsequences(wj)`。

**设计要点**：
- 只加状态、不改任何现有字段/表/UI；旧世界照常运转。
- LLM 只负责「演绎」：prompt 给现状（目标/后果），模型在节拍里推进并声明增量，引擎校验后落账——不靠模型自觉。
- 后果生命周期解决「consequence 是一次性旁白」：严重度≥50 升级、<50 消退，最终 resolved；发酵中的后果持续注入节拍上下文让模型持续演绎。

**验证**：用户约定不做验证；仅临时 `.mjs` 语法 sanity（通过）。commit + push main（CI 自动部署），线上效果待用户确认。

- **hub.html**：载体新增「🌱 生命世界」；向导第 3 步在 life 形态显示「运转模式+对话模型」（标注建议）；卡片/详情徽章显示模式；详情「进入世界」→ `/world?world=id`。
- **冒烟测试**：`public/world-check.html`（CDP，31 断言）：创建 life 世界→原住民 AI/手动→背景→关系→场景→场景线程→tick 自主发言→用户插话→增量拉取→运转设置切换→world.html 页面渲染（模式徽章/线程栏/消息流/侧栏/模型选择器）→清理，**全部 PASS**（走 `mock:true` 测试钩子，不依赖真实 LLM）。

## 本会话修复（均已部署 + live 验证）

1. worlds 路由正则放行下划线：`/^\/api\/worlds\/(world_[a-z0-9_]+)$/`（GET/DELETE）—— 手动/演示 id 含下划线不再 404。
2. `formatWorld.play_url` 覆盖 `mixed`，URL 用无扩展名 `/game-workshop?world=id`（Cloudflare Static Assets 会把 `*.html` 301 到无扩展名形式）。
3. game-workshop「下一步」钳制 `Math.min(scenes.length, cursor+1)`，使剧终页可到达（旧代码钳到 len-1 永远停在最后一幕）。
4. yonder-home `renderWorlds()` 简化：去掉 `section:` 标签块，改普通 if + 提前 return。
5. `cdp-driver.js` 增加 `Network.setCacheDisabled`（消除浏览器缓存导致的冒烟误报）。
6. **远端 D1 worlds 表旧 schema 补列**：`schema/migrate_worlds_v2.sql`（ALTER TABLE ADD COLUMN type/cover_image/script_json/cast_ids/settings/source_conversation/status/share_id）已对 remote 执行成功；`migrate_worlds.sql`（CREATE IF NOT EXISTS）对已存在的旧表无效，勿再依赖。
7. 远端插入邀请码 `HUBTEST2026`（is_active=1, max_uses=100）供测试/演示注册。

## 个人主页优化（2026-08-22 本会话已完成）

1. **「记录」区块移除** —— 判断依据：全产品无任何「创建记录」入口（后端仅只读 `GET /api/yonder/:username/posts`，全库无 `INSERT INTO yonder_posts`），个人主页「记录」永远空态占位，无存在必要。已从 `yonder-home.html` 移除：记录区块 + 个人介绍下方数量统计（stats 行）+ 设置面板「动态」开关；同步清理 `postsSection`/`renderPosts`/`renderPost`/`state.posts`/`show_posts` 相关 JS。**数据表与接口保留**，日后做动态功能可随时恢复。
2. **文案改名** —— 「数字生命」→「角色库」（区块标题）、「创造数字生命」→「创造角色」（卡片 + 空态文案）；「世界」→「世界库」（区块标题）。
3. **世界库新增「创造世界」入口** —— worldGrid 最前加「＋创造世界」create-card（`/hub?create=world`）；登录态即使无世界也显示世界库区块；`hub.html` 支持 `?create=world` 直达自定义世界向导（`openWizard()`）。
4. **验证（已部署 6c3817b 后线上全绿）**：新增 `public/home-check.html`（16 断言：登录态 @smokews 角色库/世界库标题、创造角色/创造世界卡片 href 与文案、0 世界也显示世界库、无「记录」区块/统计容器/数字生命、`?create=world` 直达向导 5 步第 1 步激活）。**一键复验命令**（无需写临时脚本）：
   `.\run-browser-test.ps1 -Url https://hyool.w910227a.workers.dev/home-check.html -OutFile .\test-out-home.txt`
   实测约 2–10s 出结果；线上冒烟输出见 `test-out-home.txt`（TITLE: SMOKE-OK）。注意：断言用「可见文本遍历」判断文案（跳过 script/style），避免 `body.textContent` 包含内联脚本注释造成误报。
5. **零浏览器快检（秒级）**：只改静态文案/入口时无需起浏览器，直接查部署产物：
   `.\check-home-fast.ps1 -OutFile .\test-out-home-fast.txt`
   13 断言（`@smokews` 页文案/href/区块存在 + 旧文案与已删标识缺失 + hub 向导标识），实测约 1.7s。注意：`.ps1` 含中文须保持 **UTF-8 BOM**（Windows PowerShell 5.1 按 ANSI 读无 BOM 文件会乱码报错）；改脚本请用 .NET ReadAllText/WriteAllText 保留 BOM，勿用编辑器直接覆盖。

## 公开作品「零数据浏览」调整（2026-08-22 收尾，已部署 e2c5e7d）

1. **取消自动游客身份** —— 删除后端 `POST /api/guest` 路由与前端自动创建逻辑（`world.html`/`buddy.html` 不再请求 `/api/guest`，不建任何 profile/session）；`getAuthenticatedUser` 对历史 `guest_` 前缀会话一律视为未登录（旧游客 token 自然失效，访客变纯匿名）。「无需注册体验公开作品」收敛为「**零数据浏览**」：纯浏览/看公开作品不产生任何数据。
2. **浏览不受影响** —— 公开作品读取本就对匿名放行：主页 `GET /api/yonder/:username`、世界详情 `GET /api/worlds/:id`（published）、生命世界 `GET /life` / `messages` / `story`。
3. **生命世界互动保留** —— `requireOwnedLifeWorld(id,{public:true})` 对已发布世界继续放行匿名读+互动（chat / tick / 建线程），`user=null` 时发言署名「游客」；`world.html` 无 token 直接可进世界发言，仅主人后台按 `S.canManage`（`/api/me` 对比 `world.owner_id`）隐藏。
4. **角色页（buddy）访客只读** —— 未登录/游客会话已清理：隐藏聊天框与仅主人按钮（沉淀剧本/设置/退出/更换形象），经公开接口 `GET /api/characters/:id` 渲染角色卡（仅 `share_id` 非空的公开角色；未公开角色提示「这个角色没有公开」），聊天区显示「登录后与 TA 聊天 → 去登录」链接；不再跳转登录页。
5. **验证**：`node --check`（含 HTML 内联脚本抽取校验）全绿；`npx wrangler deploy --dry-run` 通过；线上验证记录见下方「验证记录」。

## 个人主页·公开作品大改造（2026-08-22 本会话已完成，已部署 e0f3244）

1. **公开作品游客可体验（无需注册）** —— ① 后端曾新增 `POST /api/guest` 自动创建游客 profile+session，**后已随「零数据浏览」调整移除**（见上方章节）：改为纯匿名放行；② `GET /api/yonder/:username` 经 `buildYonderPayload()` 返回 `works{characters[],worlds[]}`（主人=全部，访客=公开：角色 `share_id` 非空、世界 `status='published'`）；③ 生命世界 `requireOwnedLifeWorld(id,{public:true})`：已发布世界对匿名放行读（GET life / messages / story）与互动（tick / chat / threads / threads-meta），管理接口保持仅主人，匿名发言名显示「游客」；④ `GET /api/worlds/:id` 已发布世界对匿名可读（game/mixed 工坊页打通）；⑤ `buddy.html` 访客只读角色卡 + 「登录后聊天」提示，`world.html` 匿名可进已发布世界发言，二者都隐藏仅主人功能（沉淀剧本/设置/更换形象/世界后台/暂停/线程删除等），world 页按 `S.canManage`（对比 `world.owner_id` 与 `/api/me`）控制；`formatLifeWorld` 补 `owner_id`。hub 游客卡也直达 `/buddy/:id`。
2. **底部导航只留「编辑彼岸」** —— `yonder-home.html` 底栏删除 角色工坊/返回幻灵 两个链接，仅剩 `navEditBtn`；非主人不显示底栏。
3. **角色工坊 → 我的彼岸** —— hub 页 title/h1/副标题、wstep 文案、create/game-workshop/buddy/fantasy/workspace 站内链接、README、hub-check 断言全部改名；URL 仍为 `/hub`。「独立显示预览」= 访客也能看到角色+世界独立预览卡（并入①）。
4. **主页点世界直接进入** —— 世界卡 `href` 改为 `worldPlayUrl()`：life→`/world?world=`、game/mixed→`/game-workshop?world=`，不再弹详情卡二次选择；story/vn 无入口时回退 `/hub?world=`。
5. **无限模块 → 自定义模块区** —— 删除 `infiniteSection` 与「无限」开关；`yonder_settings` 新增 `modules` 列（JSON `[{id,name,content}]`，迁移 `schema/migrate_yonder_modules.sql`）；编辑器新增「自定义模块区」（`＋ 添加模块`，名字/内容可改可删，最多 20 个），主页 `renderModules()` 按序渲染为独立区块；保存走 `/api/yonder/settings`（含列兜底 ALTER）。
6. **收费 / 免费作品（暂不开通支付）** —— `characters`/`worlds` 新增 `pricing`('free'|'paid') + `price`(元) 列（迁移 `schema/migrate_monetization.sql`；`mvp.js ensureMonetizationColumns()` 与 index.js 均带幂等补列兜底）；hub 角色编辑弹窗与世界详情弹窗可设 免费/收费+价格（PATCH `/api/worlds/:id` 与 `/api/characters/:id/update` 支持）；角色/世界卡与主页卡显示 `免费` / `¥xx 收费` 徽章；**支付未开通，收费作品暂可直接体验**。二维码支付 → 待办（见「待办状态」）。
7. **验证（线上全绿）**：`check-home-fast.ps1` 20/20；`home-check.html` 22/22 SMOKE-OK；`hub-check.html` 37/37 SMOKE-OK；端到端游客验证（一次性 `works-guest-check.html`，已删）15/15 SMOKE-OK——游客打开 /@smokews 可见角色+世界公开预览卡、角色卡直达 /buddy/、世界卡直达 /world?world=、游客直接进世界页可发言、底栏/编辑按钮/创造入口对游客隐藏，测试数据自清理。`workshop-smoke-check` 因线上缺少夹具数据（W1/W2/CHAR1 需先种到 smokews 名下）无法跑，其改动的 Part E（世界卡直达 href）已由游客端到端验证覆盖。修复两处：主人 0 角色时创造卡被空态覆盖（03b369d）、hub-check iframe load 竞态（abd1a90）。

## 验证记录

- `.wrangler/e2e-script-test.ps1`（seed→register→POST script→worlds list）：全绿（mock AI 路径，AI 绑定临时注释）。
- `public/workshop-smoke-check.html`（CDP，30 断言）：A 三态播放 / B `?world=` 直达 + 剧本计数 + 进入工坊 / C buddy 沉淀按钮 + toast 跳转 / D choice 选项跳转 / E yonder-home 世界卡片 —— 全部 PASS，console 无错误。
- 回归：patch-check / crop-compare-check（复跑后 OK）/ ui-check / hub-check / fantasy-check 全部 SMOKE-OK。
- Live：`https://hyool.w910227a.workers.dev`（v c63e567e）注册→建 mixed 世界→列表→详情→`/game-workshop?world=` 200 全通。
- **生命世界（本会话）**：`public/world-check.html`（CDP，31 断言）全部 PASS；回归 hub-check 34 断言 PASS、game-studio-check 29 断言 PASS；`/cdn-cgi/local/scheduled` 触发 200；`npx wrangler deploy --dry-run` 通过；`schema/migrate_life_worlds.sql` 已对 remote（22 表）+ local 执行成功。
- **零数据浏览（本会话）**：一次性线上冒烟 `zero-browse-check.html`（CDP，35/35 SMOKE-OK，验证后已删）——smokelife 现场建 life 世界→PATCH 发布→登出零身份后：匿名 /@smokelife 见公开角色+世界卡且底栏/编辑按钮隐藏；匿名进 /world?world= 可读可发言、署名「游客」、rail/side 隐藏；匿名 buddy 只读卡（聊天框/沉淀剧本/设置/退出/更换形象隐藏+登录提示）；POST /api/guest→404、/api/me 未认证、无 token/无 cookie；测试世界已清理。遗留噪音：匿名世界页 `/api/tts/voices` 401（既有行为，不影响零数据浏览）。临时提交已 squash 清理，远端回到 e2c5e7d。

## 待办状态

- 首批剩余项 #3「游戏工坊」**已完成**：`game-studio.html` + `game-studio.js` + `game-studio-check.html`（28 断言 SMOKE-OK）+ fantasy 卡片激活 + 本文件同步。
- **生命世界（type="life"，多角色自主共存）已完成**：后端全链路 + 模型路由 + `world.html` 直播间 + hub 向导第 4 形态 + 三运转模式（watch/hybrid/always + cron）+ 31 断言冒烟 PASS。**已 commit + push（1ab7f51），线上部署确认**：`https://hyool.w910227a.workers.dev/world.html` 与 `/api/models` 均 200。体验路径：`/hub` →「＋ 创造」→ 自定义世界 → 选「生命世界」。
- 后续可做（用户主动提出再推进）：世界消息清洗/归档（保留最近 N 条）、GPU 后端上线后启用 dsv4pro / XVERSE-Ent-25B / Qwen3-27B-Instruct（配置 `GPU_BASE_URL` + `GPU_API_KEY` 即可，代码已就绪）。
- **★ 下一步：Batch 4 一键导出**（novel/renpy/storyboard/game）。**Batch 3 故事引擎已完成**（2026-08-21 冒烟全绿，见下方记录）；"关系自动演化"与"剧场回放"已被本设计覆盖，不再单列。
- **★ 收费作品支付（二维码）—— 用户拍板暂不开通，已加入待办**：数据/徽章层已就绪（`pricing`/`price` 列 + hub 与主页展示），支付渠道未实现。规划：微信/支付宝收款码 → 用户扫码付款 → 凭单号人工/自动解锁，或第三方聚合收单 API。待用户主动提出再推进。

## 新一批需求（2026-08-21 用户拍板，开发中 —— 本清单已完成「开发中」→每完成一批改标注）

目标：把「生命世界」升级为真正可运营的世界编辑器。用户原文需求拆解：

1. **世界题材增加「仙侠」选择** —— hub 向导 GENRES/GENRE_PROMPT 增加 xianxia（御剑与修真），封面与背景提示随题材。
2. **角色库 ↔ 生命世界互通** —— ① 向导第 3 步生命世界也能勾选现有角色库角色（当前被隐藏 wCastGrid），选中即 cast_ids 入库成为世界内角色；② 世界后台可再邀请/移出角色库角色（`/api/worlds/:id/life/cast`）；③ 世界内角色与角色库共用形象/性格/TTS 等字段。
3. **封面可上传图片** —— 向导第 4 步 + world.html 后台均支持「上传封面」（走 `/api/upload` 存 /img/），不再只能 AI 生成；「换一张」保留。
4. **线程可删除** —— 新增 `/life/threads/delete`（默认主线程 kind='main' 不可删，删除整个世界除外）；world.html 线程 chip 非 main 显示 ✕。
5. **删除世界语义** —— 除公共角色（cast_ids，回归角色库不删 character 行）外，世界内其他资源（原住民/线程/消息/场景/关系/背景图）一并删除；hub 删除确认文案必须提醒用户。
6. **关系升级为「羁绊」** —— 关系 kind 扩展为全而多的情感标签（爱慕/仇恨/依赖/敬重/愧疚…）；初始建立关系即羁绊满值 bond=100；用户可随时强干扰覆盖双方关系（重新选 kind/改 bond）；列表显示羁绊值条。
7. **地图/区域/场景** —— world_json 增加 `areas[]`（id/name/desc/bg_image）；区域可单独创建/删除/上传背景图；场景绑定 area_id；世界背景支持全局背景图 bg_image。
8. **世界内角色面板与角色库一致** —— 原住民增加 gender/age/tags（性格标签多选，尽量全而多，选择后影响人设提示与发言）/chat_config（voice/rate/temperature/max_tokens/proactivity）/形象上传；`/api/tts/voices` 提供音色列表；buildLifeSystemPrompt 注入 tags+bond+area 信息。

实现约定：全部存 world_json（natives/relations/scenes/areas/life/background/threadMeta），不新增 DB 表；关系存储 `{a,b,kind,note,bond}`；标签中文表前后端各维护一份常量（后端白名单校验）。<b>开发进度（Batch 1 完成 + 已部署 + 线上验证）：①仙侠题材已加；②角色库互通完成（向导放开勾选 + `/life/cast` 邀请/移出 + 世界内显示 source=global 角色）；③封面上传完成（hub 向导 + world.html 后台 `POST /cover`）；④线程删除完成（kind='main' 主线不可删，`DELETE /life/threads?thread=`）；⑤删除世界清理线程+消息+world_json，公共角色回归角色库（响应 cast_preserved）；⑥关系升级羁绊（21 标签 + bond 0~100 初始满值 + 强干扰覆盖 + 列表羁绊条）；⑦地图/区域完成（`/life/areas` + 场景 area_id + 背景 bg_image）；⑧原住民面板扩展 gender/tags（36 标签）/TTS 音色+语速/形象上传。冒烟 world-check 44 断言 PASS + hub-check 34 + game-studio-check 29 + dry-run 通过；角色库邀请成功路径用一次性 Node 脚本（本地 D1 直插角色）全链路验证；**已部署（b033b6c）并线上验证**：真实 LLM tick 产出 2 条消息、邀请 source=global、羁绊初始 100、区域/场景绑定、封面更新、主线线程 kind=main、删除世界后角色库保留均正常。线上验证期间发现 HUBTEST2026 邀请码被禁用（is_active=0）已重新激活并重置 used_count=0/max_uses=500。</b>

<b>Batch 2（已完成 + 已部署 + 线上验证）：</b>
1. **创建世界选角色改为弹窗** —— 向导第 3 步不再内嵌角色列表，改为「＋从角色库选择角色」按钮弹出角色库勾选弹窗（可多选，摘要 chips 显示已选）；world.html「从角色库邀请角色」也由 `window.prompt` 序号改为同一套弹窗勾选（`/api/hub` 拉取 + `POST /life/cast` 逐个邀请）。
2. **名字栏随机起名按钮** —— 手动表单名字栏旁「🎲 随机」，走 `POST /api/worlds/:id/life/name`（本地中文名库随机生成，排除世界已有角色名降低重名）。
3. **年龄选择列表** —— 性别下方新增年龄段 select（幼童/少年/青年/中年/老年），native 增 `age` 字段，`buildLifeSystemPrompt` 注入「- 年龄」。
4. **AI 生成 NPC 原住民** —— 原住民生成区新增「🎭 AI 生成 NPC 原住民」按钮 → 弹窗人数选择（1~10）→ `POST /api/worlds/:id/life/npc-batch` 批量生成（性别/年龄/性格/外貌/名字全随机，AI 生成 JSON 数组、mock 兜底；名字与已有 cast 去重），入场旁白写入当前线程，并让前 1~2 位 NPC 就地开口闲聊。
5. **下拉列表深色修复** —— `select { color-scheme: dark }` + `select option` 深底白字（world.html / hub.html）。
6. **删地图页，改线程背景属性** —— 移除地图/区域面板；`POST /api/worlds/:id/life/threads/meta` 支持线程改名 + 线程介绍(desc) + 背景钩子(bg)（存 `world_json.threadMeta[id]={desc,bg}`）；新线程弹窗可选常用背景 chips；`buildLifeSystemPrompt` 现场块注入线程背景。
7. **主线大世界背景锁死** —— 世界背景保存时代/氛围/规则后 `background.locked=true` 立即锁死（再次修改时代/氛围/规则返回 400，仅地点/补充/背景图可调）；world.html 右侧主线介绍卡对时代/氛围/规则 disabled + 🔒 徽章；向导第 2 步生命世界隐藏「一句话设定」栏（设定移到世界页锁定）。
8. **布局：角色/关系到页面右侧，后台只保留运转** —— world.html 双栏布局：左侧线程+聊天舞台（运转），右侧常驻「世界面板」（顶部线程/世界介绍卡 + 角色/关系/场景 tab）；「⚙ 世界后台」侧栏只保留运转（模式/模型/tick/暂停）。修复 parseWorldJson 丢弃 currentThreadId 的 bug（chat/tick 也会更新当前线程）。

<b>Batch 2 部署 + 验证（本次会话补全闭环）：</b>已 commit + push（2e69644），CI 自动部署生效；另提交 f8657fd（chore：run-browser-test 启动时清理残留 CDP 配置，修复中断/崩溃的 Chrome profile 残留导致冒烟误报）。验证全绿：node --check（gateway.js/mvp.js/index.js）通过；`npx wrangler deploy --dry-run` 通过；本地 CDP 冒烟 **world-check 44 断言 PASS**（含 Batch 2 新断言：角色选择弹窗开/关/摘要更新、随机起名返回名字、native 年龄字段保存、NPC 批量生成 5 名互不重名+入场消息写入线程、线程改名+背景钩子保存、`background.locked=true`、时代/规则 disabled、地图面板移除、后台仅保留运转）+ **hub-check 34 PASS**（含角色弹窗断言）+ **game-studio-check 29 PASS**。**线上已确认**：hub.html 第 3 步「＋从角色库选择角色」弹窗、world.html「🎲随机 / 年龄段 / 🎭AI 生成 NPC / 从角色库邀请角色弹窗 / 开启新线程（背景钩子+常用背景）/ 角色·关系·场景 tab / 主线介绍卡」、`/api/models` 均在线正常。
- 注意：本地 dev 的 Workers AI 远程绑定当前可能因代理挂起（60s 超时）；冒烟测试已走 `mock:true` 钩子，不受影响。

<b>Batch 3 故事引擎（已完成 + 已部署 + 线上验证）：</b>
1. **自动世界状态** `world_json.state`（不新增 DB 表）——`parseWorldJson` 兜底初始化 `state/story/beats/secrets/plots/timeline/chapters/lastPulseSeq`；`updateWorldState`（gateway）增量脉动只读 `lastPulseSeq` 之后的消息 → 输出结构化状态更新（关系 delta / 新秘密 / 支线 / 时间线 / story.focus·phase 演进 / 自动封章）。
2. **节拍化运转内核**——`runWorldTickCore` 由「挑人说一句」改为「推进一个节拍」：`generateStoryBeat`（t ∈ event|action|dialogue|decision|consequence|narration，mock 按类型轮转）→ `applyStoryBeat` 落为旁白（`actor='narrator'`）+ 1~2 名在场角色台词；beat 声明的 `affects/reveal/hide` **后端立即落账**：affects→relations（`manual` 强干扰优先，无则 `auto` 新建/更新 bond）、reveal→secrets 揭晓、hide→埋新秘密；节拍写入 `state.beats`（上限 200）。
3. **增量脉动 + 成本控制**——`maybeRunStatePulse` 在 tick 后消化各线程 `seq > pulsedSeqs[threadId]` 的增量消息，积压 <4 条不跑（成本控制）；`applyStatePulse` 合并 relations（保留 manual）/secrets(100)/plots(50)/timeline(100)/chapters(20)/story/lastPulseSeq；成功后更新 `pulsedSeqs` 与 `lastPulseSeq` 并 `saveWorldJson`。
4. **GET /api/worlds/:id/life/story**——返回 `{ story, chapters, beats, secrets, plots, timeline, relations, lastPulseSeq }` 故事档案；`formatLifeWorld` 的 `/life` 视图同步暴露 `state`。
5. **world.html「故事」tab**——世界面板 rail-tabs 新增「故事」，renderStory 拉取 `/life/story` 渲染主线卡（标题/阶段徽章/梗概/焦点）、秘密（🔒/☀）、支线、时间线、章节、节拍流（类型标签+旁白+台词）；随 8s refreshWorld 自动刷新。
6. **world-check 扩充 partH**（19 条断言）——`/life` 返回 `world.state` 对象；`state.story.phase` 合法阶段；`state.beats/secrets/plots/timeline` 落账；`lastPulseSeq` 推进；关系自动演化（`auto:true`）写入；节拍类型合法+含台词/旁白；`/life/story` 200 且 chapters/beats/secrets/plots/timeline 与 state 一致；partD 增「故事」tab/面板存在+可切换 3 条断言。
7. **验证**：`node --check`（mvp.js/gateway.js）通过；本地 dev 启动后 CDP 冒烟 **world-check 84 断言 PASS（SMOKE-OK）**——含节拍化 tick 产出「旁白+2 角色」3 条、pulse 后 state.story=opening、beats=2、secrets=1、lastPulseSeq=11、`/life/story` 档案与 state 一致；唯一 SKIP 为「角色创建失败/超时（本地 AI 挂起）」既有项。**已部署（35848a2，CI 自动）并线上验证通过**：`https://hyool.w910227a.workers.dev/world-check.html` CDP 冒烟 **91 断言 PASS（SMOKE-OK，0 SKIP）**——含此前线上失败的「关系自动演化（auto）写入 relations」、`lastPulseSeq=11`、`/life/story` 档案与 state 一致；修复为 partH 收敛循环（轮询 /life + 重复 mock tick，直到 N1-N2 auto 关系落账，≤120s），规避 iframe 真实 hybrid auto-tick 抢跑消耗积压消息导致脉动阈值不足的竞态。
---

## 游客访问 /hub 重定向到幻灵世界广场（2026-08-23）

**现象（用户报告）**：游客从幻灵世界广场（`/plaza`）点世界卡片进入 `/world`（带 `from=/plaza`），点「← 返回」后到达 `https://hyool.com/hub`，且游客在 `/hub` 看到「角色、世界全出来」。

**排查结论**：
1. **返回回 /hub**：`goWorldBack`（`world.html`）已在上轮修复（`f2d9635`）加入 `/plaza` 白名单（from 参数 + 同站 referrer 双保险），线上已验证包含修复；仅当入口 URL 无 `from` 参数（直接收藏/分享 `/world?world=xxx`）或浏览器缓存旧页面时，才走兜底回 `/hub`（设计行为）。
2. **游客在 /hub 看到角色**：`GET /api/hub` 游客分支（`src/mvp.js`）返回**全站 `share_id` 非空（主页显示开启）的前 60 个公开角色**，`hub.html` 游客态副标题本就是「浏览大家创造的角色，登录后即可定制你的世界。」；世界 tab 对游客实为空态+登录提示。每张角色卡下方的紫色小字是该角色所属世界名，故观感为「角色、世界全出来」——这是既定设计，非数据泄露。

**用户拍板**：游客访问 `/hub` 直接重定向到 `/plaza`（幻灵世界广场），个人创作库只对登录用户开放。

**改动**：
1. `public/hub.html`：DOMContentLoaded 中 `checkAuthSoft()` 后若 `isGuest` → `location.replace("/plaza")` + `return`（用 `replace` 避免历史栈残留 /hub，从世界返回再后退不会回到 /hub；原游客 UI 分支保留为防御但已不可达）。
2. `public/hub-check.html`：访客断言从「隐藏创造/退出按钮 + 显示登录链接」改为「iframe 内 /hub 重定向到 /plaza + 幻灵世界大标题」（`waitFor` 轮询 `contentDocument.location.pathname === '/plaza'`）。
3. 后端 `GET /api/hub` 游客分支**保留**（`guest: true` + share_id 非空角色），仅页面层重定向，其它 API 调用方（world.html 角色库弹窗等，均为登录态）不受影响。

**验证**：`hub.html` / `hub-check.html` 内联脚本 `node --check` 通过；commit + push main（CI 自动部署）。

---

## 全站角色池（前 60）仅管理账户可见（2026-08-23）

**决策**：`/api/hub` 此前游客分支返回全站 `share_id` 非空的前 60 个公开角色（游客在「我的彼岸」可浏览所有用户的角色卡）。用户拍板：**这个全站角色池只对管理账户可见，游客和普通用户都看不见**——普通登录用户在个人创作库只看到自己的作品；游客页面层已重定向 /plaza（见上一条）。

**后端（`src/mvp.js` `GET /api/hub`）**：
1. 未登录 → `{ success: true, guest: true, characters: [] }`（不再查询全站公开角色）
2. 管理账户（`user.username === '333123'`，与邀请码管理同一判定）→ 返回全站 `share_id` 非空前 60 角色 + `isAdminView: true`
3. 普通登录用户 → 仍只返回 `owner_id = 自己` 的角色（不变）

**前端（`public/hub.html`）**：`renderChars(chars, guest, readOnly)` 新增 `readOnly` 参数——管理全站视图（`res.isAdminView`）下角色卡不显示编辑/删除按钮、不追加「创造角色」卡，仅作浏览（点卡片仍可进入 /buddy；后端 update/delete 本身有 owner 校验，管理员操作他人角色仍返回 403「无权操作此角色」）。

**验证**：`node --check`（`mvp.js` + `hub.html` 内联脚本）通过；`node:sqlite` 内存表复现三分支——admin 视图只含 `share_id` 非空角色（隐藏角色被排除）、用户视图含自己全部角色（含隐藏）✓。



<b>world.html 页面布局优化（本次会话，已完成本地验证，commit 208fe2a）：</b>
1. **顶部右侧「世界X」tab** —— 移出导轨底部 tab 行，改为顶栏右侧常驻「世界角色 / 世界关系 / 世界故事」三个切换按钮（`.world-tab`，保留 `data-rail` 属性兼容 world-check 断言），切换世界面板分节；「世界后台」按钮（openSide）保留。
2. **隐藏对话模型选择** —— 顶栏 `modelSel` 用 `display:none` 隐藏（模型选择移到世界后台运转面板 `runModel`），`onModelChange` 绑定保留；world-check「模型选择器 4 项」断言仍通过。
3. **新线程·场景合一** —— 移除线程栏「＋新线程」chip 与场景分节，改为导轨底部常驻按钮「＋ 新线程 / 进入场景」→ 打开合一弹窗 `threadModal`（线程字段 + 常用背景 chips + 已有场景列表 `sceneList` + 创建场景表单），`newThread()` 打开并清空场景字段。
4. **世界后台与面板并排** —— 新增 `body.side-open` 使 `.wrap/.topbar/.composer` 右移 408px，世界后台（side）与世界面板（rail）并排显示，不再覆盖。
5. **介绍卡 ✕ 收起** —— 主线介绍卡新增 `.ic-close` ✕（`toggleIntro(false)` → rail 加 `hide-intro` 隐藏介绍卡并显示 📋 恢复按钮），修复此前 ✕ 无反应；`toggleIntro(true)` 恢复。
6. **验证**：`node --check` 通过；`npx wrangler deploy --dry-run` 通过；本地 CDP 冒烟 **world-check 93 断言 PASS（SMOKE-OK，2 SKIP 为既有「本地 AI 挂起 / 无邀请角色」项）**；另起一次性 CDP 脚本 **14 断言 ALL-PASS**（合一弹窗打开+含 sceneList、介绍卡 ✕ 收起/恢复）。

## 已拍板：生命世界升级「故事孵化器」（2026-08-21 用户拍板，设计已确认，待新窗口开工）

> **定位变更（最高目标）**：生命世界不是「多人 AI 聊天室」，而是 **AI 世界孵化器**——用户创造角色与世界，AI 让世界自主产生可导出的连续故事。**一句话最高目标：你创造世界，AI 让世界发生故事。**
> 故事链：世界 → 故事 → 小说 / 视觉小说(Ren'Py) / 动漫影视(分镜) / 游戏。全站四象限由此串通：**幻想**（用户提出想法）→ **生命**（角色拥有行为与关系）→ **无限**（世界不断产生新可能）→ **彼岸**（导出作品展示给别人）。

**为什么必须改（现状核对）**：`runWorldTickCore`（`src/mvp.js:2702`）每次 tick 的唯一产出是 `pickNextSpeakers`（启发式挑 1~2 人）+ `generateWorldLine`（每人"说一句话"≤60字，`src/ai/gateway.js:1029`），没有事件/行动/冲突/后果——这就是「原地打转」的根因。改造不是加功能，是**换运转内核**：从「挑人说一句」→「推进一个节拍」。

---

## 生命世界广场 + 发布/下架 + 显示/隐藏解耦（2026-08-23 本会话已完成）

### 背景
用户澄清产品语义：**「发布」= 进入主站生命世界广场**（所有用户发布的都在那）；**「显示/隐藏」= 只针对个人主页卡片**（不影响主站）；**「下架」= 主动从主站移除**。此前代码里 `worlds.status` 一个字段同时驱动主页访客可见性 + 匿名放行 + 详情访问，与「显示/隐藏」混用，且**主站没有任何生命世界聚合入口**（首页「生命」只跳 `/hub`）。

### 数据语义（最终定案）
| 维度 | 字段 | 取值 | 效果 |
|---|---|---|---|
| 发布/下架 | `worlds.status` | `published` | 进主站广场（`/api/plaza` 聚合）+ 世界详情匿名可读 + 生命世界互动匿名放行 |
| 发布/下架 | `worlds.status` | `draft` | 从广场消失，仅主人可见可进 |
| 主页显示/隐藏 | `worlds.share_id` | 非空 | 个人主页访客视图可见（与角色卡同语义） |
| 主页显示/隐藏 | `worlds.share_id` | 空 | 主页访客视图隐藏（世界本身照常运转） |

### 后端（`src/mvp.js` / `src/index.js`）
1. **`PATCH /api/worlds/:id` 新增 `visible` 字段**：`visible:true` 确保/生成 `share_id`（`w` + 8 hex），`visible:false` 清空。仅主人可调。
2. **新增 `GET /api/plaza`**：`SELECT w.*, p.username, p.display_name, p.avatar_url FROM worlds w LEFT JOIN profiles p ON w.owner_id = p.id WHERE w.status='published' AND w.type='life' ORDER BY updated_at DESC LIMIT 100`，逐条 `formatWorld`（复用 natives_count/scenes_count 等）+ 补主人字段。
3. **`buildYonderPayload` 访客世界过滤**：`status='published'` → `share_id IS NOT NULL AND share_id != ''`（与角色一致）。主人视图不变。
4. 世界详情匿名放行（`GET /api/worlds/:id`、`requireOwnedLifeWorld public:true`）保持看 `status='published'`：**下架才会锁访问，隐藏不影响**。Cron 运转不看 status（type=life 即 tick），发布/下架只控制广场展示。

### 前端
1. **`public/plaza.html`（新建）**：主站生命世界广场。header（LOGO/首页/我的彼岸）+ 卡片网格（封面 4:3、名字、「生命世界」徽章、描述 2 行截断、主人头像+@username、原住民/场景数、更新日期），点卡进 `/world?world=id`，空态引导去 hub 发布。
2. **`public/index.html`**：首页「生命」core-entry 从 `/hub` 改跳 `/plaza`（注释同步）。
3. **`public/yonder-home.html`**（主人视图世界卡）：
   - 右上角「发布/下架」按钮（`.vis-toggle.pub`，draft=绿色「发布」，published=红色「下架」，title 说明进主站广场）；
   - 右下角「显示/隐藏」按钮改为 `share_id` 维度；
   - 未发布世界加橙色「未发布」badge；隐藏卡保持半透明 + 红色「已隐藏」角标；
   - `toggleWorldVisible` 改 PATCH `{visible}`，`toggleWorldPublish` 新增 PATCH `{status}`。
4. **`public/hub.html`**：世界卡 card-actions 加「发布/下架」文字按钮（`.card-btn.pub`），新增 `toggleWorldPublish(idx)`。

### 迁移
- **`schema/migrate_plaza_share.sql`（新建，幂等）**：`UPDATE worlds SET share_id='w'||lower(hex(randomblob(4))) WHERE status='published' AND (share_id IS NULL OR share_id='')` —— 存量已发布但 share_id 为空的世界补 share_id，避免新过滤下从访客主页消失。
- **已对 remote D1 执行成功**（changes=1）。

### 验证
- `node --check src/mvp.js` + `src/index.js` 通过。
- `public/plaza.html` / `index.html` / `yonder-home.html` / `hub.html` 内联脚本抽取语法检查通过。
- `npx wrangler deploy --dry-run` 通过（242 文件含 plaza.html 已纳入静态托管）。
- node:sqlite 全链路模拟 **11/11 PASS**：广场 SQL 只含 published+life 且带主人信息；访客主页只见 share_id 非空（published 但隐藏的不见、draft 且未显示的不见）；主人见全部；隐藏=share_id 清空且 status 不变；显示=share_id 重新生成；发布/下架后广场成员变化正确。
- 迁移 SQL 本地验证：published+空 share_id 补 `w`+8hex，已非空保留，draft 不动。

### 行为要点
- 世界创建默认 `draft`（未发布）+ 有 `share_id`（主页显示）：**新建世界访客主页可见、但不在广场**，需点「发布」上广场。
- 显示/隐藏只影响主页卡片；发布/下架才影响主站广场与匿名访问。
- 主页角色卡/世界卡的显示/隐藏按钮是独立功能，不影响广场。


### 架构（已确认，不推翻既有决策）

**① 自动世界状态**（用户完全不用管，存 `world_json.state`，不新增 DB 表）：

```
state: {
  story: { title, logline, phase, focus },     // 主线：标题/一句话梗概/阶段/当前焦点
  beats:  [ { id, t, who[], where, text, seq } ],  // 最近节拍：t ∈ event|action|dialogue|decision|consequence|narration
  chapters: [ { id, title, summary, fromSeq, toSeq } ], // 自动封章
  secrets: [ { id, desc, knownBy[], revealed } ],   // 未揭露的秘密/悬念
  plots:   [ { id, desc, status, involved[] } ],    // 悬而未决的支线
  timeline:[ { at, text } ],                     // 重大事件时间线
  flags:   {},                                   // 谁知道什么
  lastPulseSeq: 0                                // 增量游标
}
```

系统自动维护，演变示例：`A与B关系：陌生 → B发现线索 → C隐瞒信息 → A误会B → 三人关系变化 → 新事件产生`（secrets 挂"秘密尚未揭露"，relations 自动降 bond，封章生成标题+摘要）。

**② gateway.js 新函数**（全部带 `mock` 兜底 + `mock` 参数，符合冒烟约定）：
- `updateWorldState({ world, wj, messages, modelId, env, mock })`：**增量脉动**（只读 `lastPulseSeq` 之后 ≤40 条）→ 输出结构化状态更新：关系 delta / secrets / plots / timeline / story.focus·phase / 封章触发。
- `generateStoryBeat({ world, wj, state, thread, cast, recent, modelId, env, mock })`：输入世界状态（主线/焦点/秘密/关系/最近节拍）+ 现场 → 输出 JSON `{ t, narration?, who[], text[], affects?[{a,b,kind,bond}], reveal?[id], hide?[desc] }`。
- `buildLifeSystemPrompt` 保留并注入世界状态块。

**③ mvp.js 改造**：
- `runWorldTickCore`：`generateWorldLine` 替换为 `generateStoryBeat`；beat 声明的 `affects/reveal/hide` **后端立即落账**到 relations/secrets/timeline（不靠模型自觉）；旁白走 `actor='narrator'`（world_messages 已支持）；消息带 `beat_type`（需一次 migration：`ALTER TABLE world_messages ADD COLUMN beat_type TEXT DEFAULT 'dialogue'`，一个 SQL 文件一次改动）。
- 新增 `GET /api/worlds/:id/life/story`：返回故事档案（story/chapters/beats/secrets/plots/timeline/关系变化日志）。
- 新增 `POST /api/worlds/:id/life/export`：`target = novel|renpy|storyboard|game`。
- 成本控制：pulse 只在积压 ≥8 条时跑；每 tick 1 个节拍；沿用 10s 冷却/每日上限/cron 收敛。

**④ 一键导出 = 彼岸**（gateway 四个新函数，均带 mock）：
- `exportWorldAsNovel` → Markdown：章节 + 正文（旁白→叙述、对白→引号、场景→段落）
- `exportWorldAsRenpy` → `.rpy`：scene / character / dialogue / menu 分支
- `exportWorldAsStoryboard` → 分镜 JSON：镜头 / 台词 / 场景描述
- `exportWorldAsGame` → 任务 / NPC / 对话 / 世界状态 / 事件 JSON（未来可接 game-workshop）

**⑤ 前端 world.html**：世界面板新增「故事」tab（主线卡 / 章节 / 节拍流带类型标签 / 秘密 / 时间线 / 关系变化日志）；「生成作品」区（类型选择 → 生成 → 预览 + Blob 下载）。

### 与既有决策的衔接（不推翻）
- **Batch 2 规则/时代/氛围锁死保留**：作为「种子设定」喂给世界状态，系统自动演进并超越；前端不再要求用户频繁改规则。
- **Batch 1 羁绊系统保留**：pulse 自动更新 relations（`auto` 标记），用户「强干扰手动覆盖」永远优先。
- 成人红线 / 三层分层 / 回复规则等全局决策不变。

### 落地批次（每批走完整验证闭环：node --check → dry-run → CDP 冒烟 → 部署 → 线上验证 → CONTEXT.md 同步）
- **Batch 3 故事引擎**：state 结构 + `updateWorldState` + 节拍化 tick + `GET /life/story` + 「故事」tab + world-check 扩充断言（节拍类型 / 状态更新 / 封章 / 关系自动变化）。
- **Batch 4 一键导出**：四个 export + `POST /life/export` + 前端预览下载 + story-export-check 冒烟。

---

## 主站首页补 logo（2026-08-22）

**背景**：上一会话因「对比 logo1.png 与 logo.png 图片差异」导致 AI 无法识别图片而中断，工作区遗留一批未提交的首页重构改动。用户本次明确指示：**不要对比图片差异，直接把 `logo.png` 用上**，且 **不修改原有的 `./logo1.png`**。

**改动（`public/index.html`）**：
1. 新增 `.world-logo-main`（CSS）：`position:absolute; left:50%; top:9%; transform:translateX(-50%)`，位于四个世界入口（`.light` 菱形布局：幻想上/彼岸左/无限右/生命下）正上方、顶部居中；`z-index:10`、`pointer-events:none`，随 `#world.show` 以 `opacity 1.5s` + `delay 2.5s` 淡入（与 `.world-logo` 同节奏）；`img` 桌面 96px、移动端 72px。
2. HTML：`#world` 内 `<!-- LOGO -->` 区块之后新增 `<!-- MAIN LOGO -->` → `<div class="world-logo-main"><img src="./logo.png" alt="HYOOL"></div>`。
3. 移动端（`@media(max-width:700px)`）：`.world-logo-main{top:6.5%}` + `img{width:72px}`。
4. **左上角原有 `.world-logo`（logo1.png）完全保留未动**。

**附带收尾**（上一会话遗留未提交批次，一并 `4b873f6` 提交）：
- `index.html` PAGE 1（ENTER HYOOL 入口页）CSS/HTML/JS 移除，首页直接进入世界选择页（注释已标明）。
- 各页 logo 链接 `/?entered=1` → `/`（create.html / hub.html / create-character.html）。
- 个人主页（`/@…`）回退导航：`yonder-home.html` 角色卡/世界卡带 `?from=/@用户名`；`buddy.html` `buddyBackTarget()`（优先 from 参数→同站 referrer→/hub）；`world.html` `goWorldBack()` 同逻辑；`yonder.html` 移除 GUEST 样式。

**验证闭环**：`npx wrangler deploy --dry-run` 通过（236 文件 / 257.20 KiB）→ commit + push main（`4b873f6`，CI 自动部署）→ 线上验证：`hyool.w910227a.workers.dev/` HTTP 200 且含 `world-logo-main` + `src="./logo.png"`，原 `src="./logo1.png"` 仍在；`/logo.png` HTTP 200。

---

## 首页主 logo 尺寸放大（2026-08-22）

**背景**：用户反馈首页主 logo（`logo.png`，`.world-logo-main`）太小，要求放大。明确指示：**不要对比/扫描图片差异，直接更换尺寸**；`logo1.png`（左上角小 logo）不修改。

**改动（`public/index.html`，仅 CSS 两处）**：
1. `.world-logo-main img` 桌面宽度：`96px` → **`160px`**（`height:auto` 保持比例不变）。
2. `@media(max-width:700px)` 下 `.world-logo-main img`：`72px` → **`120px`**。
3. 未改 HTML 结构、未动 `.world-logo`（logo1.png）及任何其他文件。

**验证闭环**：`npx wrangler deploy --dry-run` 通过（D1/Vectorize/AI/ASSETS 绑定正常）→ commit `d012362` + push main（CI 自动部署）。纯 CSS 尺寸改动，未跑浏览器冒烟（用户判定无必要）。

## 首页主 logo 尺寸再放大 5 倍（2026-08-22）

**背景**：用户反馈 160px 仍偏小，要求**至少扩大 5 倍**。

**改动（`public/index.html`，仅 CSS）**：
1. `.world-logo-main img` 桌面宽度：`160px` → **`800px`**（5 倍），新增 `max-width:88vw` 防止移动端小屏溢出（`height:auto` 保持比例）。
2. `@media(max-width:700px)` 下：`120px` → **`600px`**（继承 `max-width:88vw` 约束）。
3. 未动 `.world-logo`（logo1.png）、未改 HTML 结构。

**验证闭环**：`npx wrangler deploy --dry-run` 通过 → commit `9880706` + push main（CI 自动部署）。

## 首页主 logo 上下间距优化（2026-08-22）

**背景**：用户确认 800px/600px 大小合适，但 logo 与四个世界入口、以及下方文字之间上下太挤。

**改动（`public/index.html`，仅 6 处 CSS 定位）**：
| 元素 | 桌面改前 | 桌面改后 | 移动改前 | 移动改后 |
|---|---|---|---|---|
| `.world-logo-main`（主 logo） | top:9% | **top:4%** | top:6.5% | **top:3.5%** |
| `.light.fantasy`（上入口） | top:20% | **top:28%** | top:19% | **top:26%** |
| `.light.life`（下入口） | bottom:19% | **bottom:28%** | bottom:20% | **bottom:27%** |

- 效果：logo 上移、上下两个菱形入口向外移，`core` 中心文字（top:50%）与 slogan（top:50%+150px）位置不变，但与其上下入口的净间距均拉开约 8~9%。
- 左右入口（yonder/infinite，top 约 50%）不动；`logo1.png` 未动；HTML 结构未改。

**验证闭环**：`npx wrangler deploy --dry-run` 通过 → commit `12f2939` + push main（CI 自动部署）。

## 用户主页链路分享限定在主页、仅 LOGO 回主站（2026-08-22）

**背景**：用户反馈从用户主页（`/@…`）进入角色页后点击「分享」，最终返回到主站库（/hub）。规则明确：**游客在用户主页无论怎么操作，都限定在用户主页；唯一去往主站的入口只有点击 LOGO**。

**根因**：分享链路丢失「来自用户主页」的上下文。`buddy.html` 分享按钮直接跳 `/s/:id`（无 `from`），`share.html` 的「与 TA 相遇」又跳回 `/buddy/:id`（无 `from`），`buddyBackTarget()` 无法识别主页来源，默认回 `/hub`。此外 `share.html` 的「创造我的」/header 按钮/错误页直连主站，`yonder-home.html` 门禁页也有非 LOGO 的「返回首页」。

**改动**：
1. `public/buddy.html`
   - 分享链接：`renderCharacter` 中 `shareLink` 在 `buddyBackTarget()` 返回 `/@` 时追加 `?from=/@…`。
   - 游客登录提示：「去登录」的 `next` 由 `location.pathname` 追加 `?from=/@…`，登录后回角色页仍保持主页上下文。
2. `public/share.html`
   - 新增 `getFromHome()`：读取并校验 `from` 参数（仅接受 `/@…` 或 `/hub`）。
   - 「与 TA 相遇」→ `/buddy/:id?from=…`。
   - 「创造我的」与 header「创造我的数字生命」：有 `from` 时改为「返回主页」回用户主页。
   - 错误页：有 `from` 时只给「返回主页」；无 `from` 保持「返回首页 · 去创造」。
   - LOGO 仍指向 `/`（唯一主站入口）。
3. `public/yonder-home.html`
   - 门禁（gate）遮罩下 header 的 LOGO 可见可点：header `z-index` 100 → **810**（gate-overlay 800 之上）。
   - 移除门禁页非 LOGO 的「返回首页」链接，保留「登录账号」。

**验证**：用户指示不做验证、改完直接部署 → commit `3533a94` + push main（CI 自动部署）。线上效果待用户确认，不行再改。

## World Engine 知识边界 + NPC 日程/场景填充（Batch 4.6，2026-08-23）

**背景**：Batch 4.5（NPC 目标状态机 + 后果生命周期）上线后，用户按上轮候选清单指示「接着完成 2、3」：② 知识边界（witness 戳 + 「NPC 不知道的事」注入，治「NPC 全知/轮流说话」）；③ NPC 日程 + 场景填充（确定性种子，reroll 可复现）。延续定案：引擎确定性落账，LLM 只演绎；只加状态不碰 UI/DB（无 migration）。

**改动**（2 文件，+207/-14，无 migration）：
1. `src/mvp.js`
   - `parseWorldJson`：兜底新增 `state.knowledge = []` / `state.seed = ""` / `state.dayIndex = 0` / `state.schedules = {}` / `state.ambient = {}`（旧 world 无新键照常）。
   - 新增 5 个引擎函数（顶层模块作用域）：`worldHash`（FNV-1a 确定性哈希）、`scheduleLocationFor`（场景线程=场景名、其余=主线）、`ensureWorldSchedule`（每 8 tick 换「世界日」，seed=world.id 锚定，npcId→{location,activity}，地点池=场景名+主线；单地点世界全员在场；场景填充 `state.ambient[day][loc]` 确定性 1~2 名背景角色；只留最近 7 个世界日）、`applySchedulePresence`（多地点世界按日程限定在场，空则回退全员）、`recordBeatKnowledge`（witness 戳落账：有 who=参与角色、纯旁白=在场全体；同场对话自动传播消息；普通事件留 60 条、秘密条目永久保留供「已揭露线索」追溯目击者）。
   - `activeCastForThread`：支持预解析 cast 参数；场景线程仍按 scene.present 过滤；非场景线程按当日日程过滤（多地点世界）。
   - `runWorldTickCore`：`ensureWorldSchedule` → `activeCastForThread`（带 cast）→ `offCast = cast - activeCast` 透传给 `generateStoryBeat`；tick 后 `recordBeatKnowledge(wj, beat, activeCast)`。
2. `src/ai/gateway.js`
   - `buildStoryBeatPrompt`：注入「近期世界动态」（非秘密事件+目睹者）「已揭露线索」（秘密+目睹者，slice(-8)）「在场角色不知道的近期事」（每角色至多 2 条、全局 ≤6 行，信息边界）；「今日在场」（日程活动）「此刻不在（别处各有各事）」（offCast，≤6 行）；「现场还有」（背景角色，不发言）；规则新增硬性约束：不知情角色不得说出不可能知道的事（除非本幕当面告知）、此刻不在角色只进旁白不进 who。
   - `generateStoryBeat`：透传 `offCast`。

**设计要点**：
- 知识 witness 规则引擎化：具体互动只有参与者知情，纯旁白（环境叙事）在场共见；消息靠「同场对话」传播（有目击者在场则同场者知晓）——对应 Horde 思想「News travels by witness」。
- 日程确定性：`seed=world.id` + `dayIndex=floor(tickCount/8)`，FNV-1a 哈希逐 NPC 取地点/活动，同世界重开（reroll 新 id）前 8 个 tick 的日程序列完全一致。
- 单地点世界（无场景）日程不改变在场（维持 Batch 3/4 行为）；只有场景名+主线 ≥2 的世界才按日程切分在场，空则回退全员，杜绝空场卡死。

**验证**：用户约定不做验证；仅临时 `.mjs` 语法 sanity（gateway/mvp 均 exit=0，测完已删）。commit + push main（CI 自动部署），线上效果待用户确认。

## 工作约定变更：取消全部验证环节（2026-08-22）

**背景**：用户反馈验证流程（node --check → dry-run → CDP 冒烟 → 线上验证）太耗时太慢，明确拍板：**之后的任务一律不做验证**。

**新约定**：改完直接 commit + push main（CI 自动部署），线上不行再改；验证相关命令仅作备用（见 CONTEXT.md「常用命令」）。CONTEXT.md「会话工作约定」第 4 条已同步更新为「不做验证」。

## Companion Engine：情绪状态机 + 主动找你 + 恋爱/结婚/家庭生命周期（2026-08-23）

**背景**：用户给出三层架构对照（Companion 层「NPC 怎么活」/ World 层「世界怎么活」/ Director 层「接下来发生什么」），并指出 Companion 层是 HYOOL 的核心但最薄。指示：「除了 Batch 4（一键导出）不做，其他都完善完成」。本轮把 Companion 层三块全部落地，沿用 World Engine 同一原则：**引擎确定性落账，LLM 只演绎，不维护状态**。

**改动**（6 文件，+~490 行；正式迁移 1 文件）：

1. 新增 `src/companion.js`（Companion Engine）：
   - **情绪状态机**：20 个白名单标签 + 中文关键词规则 → `applyEmotionToMessage` 确定性落账（不依赖 LLM 结构化输出）；读时按现实时间衰减（每天 -1 强度，掉到 0 归「平静」）；`emotionAt` 惰性计算。
   - **关系状态机**：acquaintance → friends（亲密≥10 自动）→ close（≥30 自动）→ confession/dating/engaged/married（`applyRelationAction` 手动确认，用户拍板 manual 优先，引擎不再自动动；支持回退/解除）。
   - **家庭生命周期**：结婚后「想要孩子」→ 2 天后确认怀孕 → 再 3 天孩子出生（`advanceFamilyState` 惰性推进，读时执行）；孩子 = characters 新行（parent_id 标记，FNV-1a 确定性取名），可与孩子聊天（复用 buddy 链路）。
   - **主动找你 inbox**：里程碑（亲密跨 10/30/50/70/90，chat 落账即时生成）、想念（3 天未聊 + 亲密≥10，读取时惰性生成）、纪念日（关系 since 命中 7/30/100/365 天）。
   - `buildCompanionPromptBlock`：情绪/关系/家庭注入 system prompt（LLM 只按状态演绎）。
2. `src/ai/gateway.js`：`chatWithCharacter`/`callChatModel`/`mockChat` 透传 `companionState`；`buildBuddySystemPrompt` 在「话题边界」后注入「# 你的状态」块。
3. `src/mvp.js`：
   - `ensureCompanionColumns`（幂等补列/建表，兜底远程迁移；正式迁移 `schema/migrate_companion.sql`：`characters.companion_state` + `characters.parent_id` + `companion_inbox` 表 + 索引）。
   - chat 路由：加载状态 → 落账情绪 + 关系自动升温 + 家庭惰性推进 → 里程碑/孩子 inbox 同批 INSERT → 响应带 `emotion/relation/family`。
   - 新 API：`GET /api/buddy/:id/state`（状态 + 该角色未读留言）、`POST /api/buddy/:id/relation`（手动推进，仅 owner）、`GET /api/companion/inbox`（惰性生成 + 未读列表）、`POST /api/companion/inbox/read`。
   - `formatCharacter` 附 `emotion_label` / `relation_label` / `parent_id`；`maybeGenerateLazyInbox` 读取时按规则落账想念/纪念日。
4. `public/buddy.html`：header 下方「情绪 · 关系 · 家庭」状态行；设置面板新增「你们的关系」区（表白/在一起/求婚/结婚/想要孩子/回退/解除按钮，按阶段动态显示）；进入聊天时若有未读留言，聊天区顶部展示「💌 TA 曾主动找你」条并自动标记已读；chat 响应即时刷新情绪。
5. `public/hub.html`：角色卡片新增情绪 chip（开心/难过…）、关系 chip（热恋/已结婚…）、💌 未读留言角标（加载后拉 `/api/companion/inbox` 按 character_id 计数）。

**验证**：35 条逻辑单测全过（临时 `.wrangler/_test_companion.mjs`，覆盖情绪关键词/衰减/关系链/家庭时间线/里程碑/纪念日/prompt 注入，测完已删）；三个后端文件 node --check exit=0；两个前端 HTML 提取 script 语法检查通过；`wrangler deploy --dry-run` 通过（302 KiB，绑定正常）。commit + push main（CI 自动部署），线上效果待用户确认。

**待办状态**：Batch 4 一键导出按用户指示**暂缓**；「情绪/场景路由 Agent」中情绪状态机已完成，路由 Agent 仍观察期。



## Companion 层·世界角色弧光 + 原住民转正（Batch 7，2026-08-23）

**背景**：用户确认 Companion 改动覆盖范围（全部挂在 `characters` 表）后指出定位——**世界的主要目的是「完善故事，以便形成小说，为后续视觉小说/游戏剧情打底」**。据此修正方案：世界原住民（wc_）不吃 buddy 的恋爱/结婚/家庭/主动找你（那是「你与 TA」的私人叙事），而是把 **情绪作为「角色弧光」喂给故事引擎**，外加 **转正桥**（世界 → 角色库，让故事里出彩的角色走出来继续一对一发展）。方向：「情绪服务故事，转正连通 Companion」。

**改动**（4 文件，+210 行；无 migration）：

1. `src/companion.js`：新增世界演剧版情绪 API（与 buddy 情绪同规则集、不同衰减时钟）：
   - `decayWorldMood(mood, nowDay)`：按「世界日」（dayIndex，每 8 tick 一日）衰减，每天 -1，掉 0 归「平静」——不用现实时间（世界演剧节奏快，现实时间会让情绪瞬间归零）。
   - `applyWorldMood(mood, text, nowDay)`：先衰减再命中中文关键词置情绪（20 标签复用），返回 `{ label, intensity, day, changed }`。
2. `src/ai/gateway.js`：
   - `buildLifeSystemPrompt`：「身份」块加「- 当前心情：xx（心情是你的底色，让它自然流露在言行里）」，读 `character.mood`。
   - `buildStoryBeatPrompt`：新增「在场角色情绪」块（名字 + label + 强度提示），情绪直接驱动节拍走向（愤怒 → 冲突节拍、失意 → 低沉事件）。
3. `src/mvp.js`：
   - `parseWorldJson` 兜底 `state.moods = {}`；`resolveWorldCast` 给每个 cast 元素 attach `mood`（前端 + prompt 共用）。
   - 新增 `recordWorldMoods(wj, castById, lines)`：台词 → `applyWorldMood` 落账 `state.moods[id] = {label,intensity,day}`；显著变化（命中规则、强度≥2、label 变化且非平静）记入 `state.timeline`（「XX 的情绪转为「难过」」）作为角色弧光素材。
   - `applyStoryBeat`（节拍路径）与 `runWorldTurn`（chat 回应路径）发言后均落账情绪。
   - `GET /api/worlds/:id/life/story` 返回 `castMoods`（id/name/mood，过滤「平静」）。
   - 新 API `POST /api/worlds/:id/life/natives/:id/promote`（转正桥，仅 owner）：把原住民复制成 characters 行（companion_state='{}' 从零初始化，world_name/world_description 带世界名，chat_config 保留，share_id 生成）；原住民本身保留在世界（复制而非移动）。转正后 buddy 一对一即可享受完整 Companion（情绪/关系/家庭/主动找你）。
4. `public/world.html`：
   - 「世界角色」tab 原生民与角色库角色卡片均显示情绪 chip（`mood-chip` 样式）。
   - 原生民卡片新增 ⭐「转正」按钮（`promoteNative`，confirm 后调 API，成功后 toast + 自动跳转 buddy）。
   - 「世界故事」tab 新增「🎭 角色情绪」区块（来自 `/life/story` 的 castMoods）。

**设计要点**：
- 情绪 = 故事原料不是恋爱模拟：关系推进仍归 Director 层（pulse relations delta），恋爱/家庭/主动找你不进入世界原住民。
- 世界内情绪按世界日衰减、buddy 情绪按现实时间衰减——同一套关键词规则、两套时钟，互不污染。
- 转正 = 世界 ↔ 角色库闭环的另一半（原方向：角色库 → 世界 cast 邀请）；转正副本从零开始 Companion，不继承世界内情绪/关系（避免跨层状态耦合）。

**验证**：按用户约定不做验证；改完直接 commit + push main（CI 自动部署），线上效果待用户确认。

**待办**：Batch 4 一键导出暂缓；远程 D1 正式迁移（`migrate_companion.sql`）仍推荐补跑（运行时幂等兜底已存在）；换窗口后新会话读 CONTEXT.md + git log 继续。

## 世界 AI 发言/节拍多样性优化（Batch 8，2026-08-23）

**问题**：用户反馈「世界AI反复就那么两句引导词，NPC也差不多」。

**根因分析**：
1. **fallback 话术固定**（主因）：`mockStoryBeat` / `mockWorldLine` 只有固定几句话（「雾里的东西，今晚好像又近了一点」「那就按你说的办，先别声张」「环顾四周，像是在等谁先开口」）。llama-3.3-70b 生成 600 token 节拍 JSON 很慢，极易超过 `chatCompletions` 25s 超时（3 次重试共 ~75s）；超时 / `extractJsonObject` 解析失败 / 模型安全层拒答都会静默 fallback 到 mock——用户线上看到的就是这几句反复出现。
2. **prompt 无多样性约束**：`buildStoryBeatPrompt` 未注入世界背景素材（低信息量时模型只能套模板），也没有「禁重复句式」的硬规则；`buildLifeSystemPrompt` 同样缺「不复读」。
3. **token 上限偏高**：600 token 的 JSON 生成时长推高超时概率。

**改动**（1 文件，`src/ai/gateway.js`，+75/-17，无 migration）：
1. `chatCompletions`：新增第 6 个可选参数 `timeoutMs`（默认 25000 不变，其他调用无影响）。
2. `generateStoryBeat`：调用 `chatCompletions` 传 `timeoutMs=45000`（放宽超时，显著降低 fallback 概率）+ max_tokens 上限 600→500（缩短生成时长）。
3. `mockStoryBeat`：旁白 6 组 + 台词 6 组模板，按 beats 数量确定性轮转、双角色错位选词，不再连续复读同一句。
4. `mockWorldLine`：开场 6 组 + 接话 6 组模板，按最近消息数轮转。
5. `buildStoryBeatPrompt`：注入「# 世界氛围」块（时代背景/风土人情/氛围基调/世界规则/主要势力/力量体系/补充设定）作为新鲜意象素材；规则区新增硬约束——不得复用或近义改写最近节拍句式（『传来…响动』『望向…方向』『点点头』『压低声音』等套路开头）、t 尽量不与上一拍相同、旁白要有具体画面、对白必须推进新信息不许原地附和。
6. `buildLifeSystemPrompt`：回复规则新增第 6 条「不要重复你说过的话或相同句式，每次开口带新信息/新态度/新细节」（原第 6 条顺延为第 7 条）。
7. `sanitizeStoryBeat`：台词与最近 10 个节拍的旁白/台词完全重复时直接剔除（复读兜底）。

**设计要点**：
- 多样性兜底全部确定性（按 beats 数/消息数轮转），延续「引擎确定性落账」风格，mock 冒烟可复现。
- 放宽超时只作用于 story beat 调用，不影响 buddy 聊天等常规路径的响应时长。
- 信息边界（知识/日程/情绪）与多样性不冲突：约束的是「怎么说」，不放松「谁能知道什么」。

**验证**：按用户约定不做验证；改完直接 commit + push main（CI 自动部署），线上效果待用户确认。

**待办**：Batch 4 一键导出暂缓；远程 D1 正式迁移（`migrate_companion.sql`）仍推荐补跑；换窗口后新会话读 CONTEXT.md + git log 继续。

## 世界后台输入丢失修复（Batch 8.1，2026-08-23）

**问题**：用户反馈「大世界背景所有输入栏无法输入」，进一步澄清为「输入时代背景后切换到下一栏，上一栏输入的字自动消失、恢复 placeholder」。

**根因**（`public/world.html` 世界后台侧栏 `change` 委托处理器，1 处，+2/-1，无 migration）：

```js
sideEl.addEventListener("change", async e => {
  const id = e.target.id;
  try {
    if (id === "bgCoverFile") { ... }
    else if (id === "bgImageFile") { ... }
  } catch (err) { toast(err.message); }
  e.target.value = "";   // ← BUG
});
```

- 本意：文件上传后清空 file input 的 value，便于重复选择同一文件。
- 实际：`e.target.value = ""` 在 try/catch **之外无条件执行**——side 内**任何**输入控件失焦（值改变触发 `change`，冒泡到 sideEl）都会被立即清空。
- 受影响范围：`🌍 大世界背景` 面板全部输入（bgEra/bgRule/bgFaction/bgPower/bgTone/bgPlace/bgNote/bgImage）+ `⚙ 运转` 面板（runTickSec 数字、runModel 下拉、模式 radio）。用户看到的「无法输入」= 每输一个字段、切到下一栏时上一栏被清空（最后一个输入因未再失焦而保留）。
- 复现路径：CDP 真实 IME 输入（`Input.insertText`）+ 真实鼠标点击切换焦点；diag 显示 `change` 事件时 value 正常、紧接着 `blur` 时 value 已空，元素未被替换、无任何 render 调用——清空只来自该委托处理器。

**修复**：清空仅对文件上传控件生效：

```js
if (id === "bgCoverFile" || id === "bgImageFile") e.target.value = "";
```

**验证**（本次破例做真实浏览器验证以定位 bug）：CDP 无头 Chrome 真实输入后——bgEra「灵气枯竭的修炼世界」→ 点击 bgRule → 保留 ✓；bgRule「雾里藏着记忆」、bgPlace「雾港」均保留 ✓；runTickSec 数字输入与 runModel 下拉变更均不再被清空 ✓；`world-check.html` 冒烟 44 断言 PASS（含背景锁定 disabled 断言未受影响）✓。

**待办**：Batch 4 一键导出暂缓；远程 D1 正式迁移（`migrate_companion.sql`）仍推荐补跑；换窗口后新会话读 CONTEXT.md + git log 继续。


## 创角页生图风格动图预览（2026-08-23）

**背景**：用户制作了 3 张生图风格演示动图（MP4），希望放在创角页的艺术风格选择区，对应 4 种模型生图风格（写实 realistic / 3D / 动漫 anime / 国风 guofeng）；动漫暂无动图。用户强调 AI 不识别图片内容，只按文件名放置。

**改动**（2 个 HTML + 3 个 mp4，无 migration）：
1. 新增 `public/create-art/`：`realistic.mp4` / `3d.mp4` / `guofeng.mp4`（用户提供；初版命名 `guofen.mp4` 少了 g，已按风格 id 统一为 `guofeng.mp4`）。
2. `public/create.html`（快速创角）：4 张 `.style-card` 的 `.style-icon` 内新增 `<video class="style-img" src="/create-art/xxx.mp4" autoplay muted loop playsinline preload="metadata" onerror="this.remove()">`，emoji（`.style-emoji`）保留为兜底——video 加载失败自动移除、露出 emoji；anime 卡片无动图保持纯 emoji。CSS：`.style-icon` 改 flex 居中，新增 `.style-card .style-img { width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:10px }` 与 `.style-card .style-emoji { font-size:1.8rem }`。
3. `public/create-character.html`（高级创角）：STEP1 数据 realistic/3d/guofeng 三项新增 `video: "xxx.mp4"` 字段（anime 暂缺）；`renderCards` 渲染时若 `item.video` 存在则输出同样属性的 `<video class="art-img">`——复用通用渲染逻辑，其它网格条目无 video 字段不受影响。CSS：新增 `.option-card .art-img { width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:8px; background:var(--surface2) }`。

**待办**：动漫动图后补——届时 STEP1 加 `video: "anime.mp4"` + create.html anime 卡片加 video 即可。

**验证**：按用户约定不做验证；commit `a759424` + push main（CI 自动部署），线上效果待用户确认。


## 创角页艺术风格动图尺寸放大（2026-08-23）

**背景**：用户反馈风格动图「有点小」，要求「对标角色卡大小」。角色卡参考 = `create.html` 结果卡的 `.portrait`（`width:100%; aspect-ratio:3/4; max-height:520px`）。

**改动**（2 个 HTML，纯 CSS/class，无 migration）：
1. `create.html`：`.style-grid` 桌面 `repeat(4,1fr)` → **`repeat(2,1fr)`**、移动端（≤600px）`repeat(2,1fr)` → **`repeat(1,1fr)`**（单列）；`.style-card` padding `18px 8px 14px` → `12px 10px 14px`（大图减内边距）。动图 3:4 全宽，桌面单卡宽约 350px、高约 470px，接近角色立绘观感。
2. `create-character.html`：`#step1Grid` 加 `style-grid` 类 → 新增 `.option-grid.style-grid { grid-template-columns: repeat(2,1fr) }`（桌面 2 列大卡，5 张卡 2+2+1）；移动端媒体查询追加 `.option-grid.style-grid { grid-template-columns: repeat(1,1fr) }`（单列）。

**验证**：按用户约定不做验证；commit `58d72d4` + push main（CI 自动部署），线上效果待用户确认。

## 创角页 2D动漫风格动图补全（2026-08-23）

**背景**：用户补充日漫动图（`anime.mp4`），4 种生图风格动图齐备。

**改动**（2 个 HTML + 1 个 mp4，无 migration）：
1. `public/create-art/anime.mp4` 新增（960KB）。
2. `create.html` anime 风格卡 `.style-icon` 内补 `<video class="style-img" src="/create-art/anime.mp4" autoplay muted loop playsinline preload="metadata" onerror="this.remove()">`（emoji 🌸 兜底保留）。
3. `create-character.html` STEP1 anime 条目补 `video: "anime.mp4"`。

**至此 4 种生图风格（realistic/3d/anime/guofeng）动图全部接入，两页展示一致。**

**验证**：按用户约定不做验证；commit `7d6b726` + push main（CI 自动部署），线上效果待用户确认。

## 手机端邀请码不显示 + 聊天记录重进错位修复（2026-08-23）

**背景**：用户线上反馈两个 bug——① 手机端「编辑彼岸」页面看不到「邀请码管理/生成邀请码」；② 与角色聊天后退出，过一会儿再进，聊天消息顺序错位。

**修复 1：邀请码管理在手机端不显示（`public/yonder-home.html`）**
- 根因：`checkAdminAccess()` 的 `fetch('/api/me')` 与 4 个 `/api/invite-codes` 请求（load/generate/toggle/delete）都**不带 `Authorization` header**（只依赖 cookie），而该页其它所有请求都从 `localStorage.getItem("hyool_token")` 取 token 放 header。手机端浏览器 cookie 与桌面不一致时 `/api/me` 判定未登录 → `inviteCodeSection`（`user.username === '333123'` 才显示）永不出现。
- 改动：新增 `authHeaders()` 辅助函数，`checkAdminAccess` / `loadInviteCodes` / `generateInviteCode` / `toggleInviteCode` / `deleteInviteCode` 共 5 处请求统一补 `Authorization: Bearer <hyool_token>`（与页面其它请求一致）。
- 注意：邀请码管理仍为管理员专属（后端 `/api/invite-codes*` 均校验 `username === '333123'`，403）；手机若登录的是其它账号，仍不会显示入口。

**修复 2：聊天记录重进错位（`src/mvp.js`）**
- 根因：`messages.created_at` 是 SQLite `CURRENT_TIMESTAMP`（**秒级精度**）。一次 chat 里 user/assistant 两条消息在同一 batch 同秒写入，`ORDER BY created_at DESC LIMIT N` + `reverse()` 对同秒多行排序不确定——实测同秒时 assistant 会排到 user 前面，重进聊天即出现「角色回复出现在用户消息前」的错位。
- 改动：三处读取统一 `ORDER BY created_at DESC` → `ORDER BY rowid DESC`（SQLite 隐式自增 rowid = 物理插入顺序，稳定且与聊天先后天然一致）：
  1. `GET /api/buddy/:id/messages`（UI 聊天列表，LIMIT 100）——本次用户报告的错位点；
  2. `POST /api/buddy/:id/script`（沉淀剧本最近 60 条，LIMIT 60）；
  3. chat 路由 `recentMessages`（LLM 上下文，LIMIT 12）。
- 验证（node:sqlite 内存表复现）：同秒插入 user/assistant 两条——旧查询输出 `assistant | user`（错位复现）；新查询稳定输出 `user | assistant` ✓。

**提交**：`efdc7f8`（聊天排序）、`daf180c`（邀请码 header）。push main（CI 自动部署），线上待用户验证。

## 角色卡/世界卡显示·隐藏按钮（2026-08-23）

**背景**：用户需求——个人主页（`/@用户名`，yonder-home.html）的角色卡与世界卡各加一个「显示/隐藏」按钮，让主人可以直接控制每个作品对访客是否公开，不必去 hub 管理页。

**可见性模型（沿用现有公开规则，无新字段）**：
- 角色公开 = `characters.share_id` 非空（创建时自动生成）；访客查询 `WHERE share_id IS NOT NULL AND share_id != ''`
- 世界公开 = `worlds.status = 'published'`；访客查询 `AND status = 'published'`（draft = 草稿/隐藏）

**后端（`src/mvp.js`）**：`POST /api/characters/:id/update` 新增支持 `body.visible`：
- `visible: true` → 若当前 `share_id` 为空则生成新的 10 位随机 shareId，保证公开
- `visible: false` → `share_id = ''`，对访客立即隐藏、分享链接 `/s/xxx` 失效
- 世界不需要改后端：沿用已有 `PATCH /api/worlds/:id` 的 `body.status`（'published'/'draft'，仅 owner 可改）

**前端（`public/yonder-home.html`，仅主人视图 isOwner 显示按钮）**：
1. `renderCharacters()` / `renderWorlds()` 的卡片模板：公开卡右下角「隐藏」按钮；隐藏卡半透明（`.hidden-card`）+ 左上角红色「已隐藏」角标（`.hidden-tag`）+ 右下角橙色「显示」按钮（`.vis-toggle.off`）。按钮 `onclick` 传 `event`，handler 里 `preventDefault + stopPropagation` 阻止 `<a>` 卡片跳转。
2. 新增 `toggleCharVisible(id, targetVisible, ev)`（POST `/api/characters/:id/update` `{visible}`）与 `toggleWorldVisible(id, targetVisible, ev)`（PATCH `/api/worlds/:id` `{status}`），请求带 `authHeaders()`；成功后更新 `state` 并即时重渲染。
3. CSS：`.vis-toggle` 绝对定位右下、毛玻璃小圆按钮；`.hidden-card { opacity:.55; filter:grayscale(.25) }`；`.hidden-tag` 红色角标。

**边界情况**：访客视图完全看不到按钮与隐藏角标（后端也不返回隐藏作品）；隐藏的角色在 `buddy.html` 公开接口已按原逻辑提示「这个角色没有公开」；世界 draft 时主人仍可点卡进入管理，访客按原逻辑 403。

**验证**：`node --check src/mvp.js` ✓；yonder-home.html 内联脚本语法抽取校验 ✓；`npx wrangler deploy --dry-run` ✓；node:sqlite 内存表模拟「隐藏→访客 0 / 主人 1；显示→访客 1」全链路 PASS ✓。

**提交**：push main（CI 自动部署），线上待用户验证。

---

## 修复：角色库/世界库隐藏第二个作品报「更新失败」（2026-08-23）

**现象（用户报告）**：个人主页角色库，隐藏第一个角色成功，隐藏第二个角色时弹窗报错「更新失败，请稍后再试。」。

**排查结论（本地完整复现）**：
1. 后端日志根因：`D1_ERROR: UNIQUE constraint failed: characters.share_id: SQLITE_CONSTRAINT`。
2. `characters.share_id` / `worlds.share_id` 列均有 **UNIQUE 约束**（`schema/init.sql`、`schema/migrate_worlds.sql`）。SQLite 的 UNIQUE 约束**不允许同一表出现两行相同值**——而空字符串 `''` 也是「相同值」。
3. 隐藏逻辑（`src/mvp.js` 角色 update `body.visible=false` → `share_id=''`；世界 PATCH `visible:false` → `share_id=''`）把 share_id 写成空串。**一旦全库已有任意一个隐藏角色/世界（share_id=''），再隐藏任何角色/世界都会与已有空串冲突** → 500「更新失败」。孩子角色创建（`src/companion.js` `createChildCharacter`）也写 `share_id=''`，同样会被这个「唯一空串」卡住。
4. 线上 D1 查询确认：`worlds` 表已有 1 行 `share_id=''`（存量隐藏世界）——正是「再隐藏第二个就报错」的直接原因。

**修复（隐藏一律改用 NULL，而非空串）**：
- SQLite UNIQUE 约束**允许多个 NULL**（NULL ≠ NULL），可支持任意多个隐藏作品。
- 所有公开判定统一按「非空」过滤（后端 `share_id IS NOT NULL AND share_id != ''`、前端 `!!(share_id && share_id !== "")`），NULL 与空串语义一致（均为隐藏），无副作用。
1. `src/mvp.js` 角色 update `visible:false`：`values.push("")` → `values.push(null)`（附注释说明 UNIQUE 背景）。
2. `src/mvp.js` 世界 PATCH `visible:false`：`vals.push("")` → `vals.push(null)`。
3. `src/companion.js` `createChildCharacter`：孩子角色 `share_id` 从 `''` 改为 `NULL`（避免与隐藏作品抢唯一空串）。
4. 新增 `schema/migrate_share_null.sql`（幂等）：`UPDATE characters SET share_id=NULL WHERE share_id=''`；`UPDATE worlds SET share_id=NULL WHERE share_id=''`。**已对 remote D1 执行成功**（changes=3，存量空串清零）。

**验证**：
- `node --check`（mvp.js / companion.js / index.js）通过；`npx wrangler deploy --dry-run` 通过。
- 本地 D1 构造「1 隐藏 + 2 公开」数据：修复前隐藏任意公开角色均 500（复现）；修复后**角色隐藏×2 + 世界隐藏×2 全部 200**，显示恢复正常（角色生成新 10 位 shareId、世界生成 `w`+8 位）。
- 真实浏览器 CDP 冒烟（`vis-toggle-check.html`，一次性测试页已删）：**8/8 SMOKE-OK**——登录主人视图 → 隐藏第 2 张角色卡（出现 hidden-card + 已隐藏角标 + 按钮变「显示」）→ 再点显示恢复 → 连续隐藏两张角色卡均成功（回归），无 500 / 无 console error。
- 线上 D1 复查：`empty_chars=0`、`empty_worlds=0`，原空串世界已为 NULL。

**提交**：push main（CI 自动部署）。

---

## 作品编辑器（文字剧情积木 · 第一阶段）

**日期**：2026-08-23

**背景**：用户要求在幻想世界（`fantasy.html`）新增「作品编辑器」，让用户像搭积木一样制作文字剧情。第一阶段只做文字，不做图片/视频/音频/字幕/Canvas/Cocos/AI API。

**需求清单**（全部完成）：
1. 新建作品（名称 + 创建作品）
2. 作品编辑页面：作品标题 / 章节列表 / 当前章节内容
3. 「+ 添加内容」选择积木类型：场景 / 对白
4. 场景积木：可编辑、可删除（示例「长安城的雨下了一整夜。」）
5. 对白积木：可修改角色名字和对白内容（示例【安陌沫】“他应该不会来了。”）
6. 积木排序：上移 / 下移 / 编辑 / 删除
7. 自动保存：localStorage，刷新后作品仍在
8. 播放：按积木顺序显示文字内容，无动画/视频/音频
9. 数据结构：作品 `{id,title,chapters}` → 章节 `{id,title,blocks}` → 积木 `{id,type,content}`，对白额外 `speaker`
10. UI 保持 HYOOL 视觉风格，复用现有 CSS 与组件

**改动文件**：
- `public/story-editor.html`（新增）：作品编辑器页面。三个视图——作品库（新建/我的作品）、编辑器（章节列表 + 积木流）、播放覆盖层；通用弹窗（积木编辑/章节重命名/积木类型选择）；复用 `/workspace/css/workspace.css` 的 `.hub/.btn/.field/.toast` 等组件与 CSS 变量。
- `public/story-editor.js`（新增）：全部逻辑。localStorage key `hyool_stories_v1`；每次增删改即时持久化；对白渲染自动补 `“”`；播放跨章节按积木顺序展开；暴露 `window.StoryEditor` 测试 API；复用 `/workspace/js/ui.js` 的 `$`/`toast`。
- `public/fantasy.html`（修改）：制作工坊网格新增「作品编辑器」tool-card（live 徽章），链接 `story-editor.html`。

**验证**（本地，CDP 真实浏览器冒烟 `.wrangler/story-smoke.js`）：
- **62/62 PASS**，无 console error / 网络错误。
- 覆盖：新建作品 → 默认第一章 → 添加场景/对白积木 → 上移/下移排序 → 编辑内容/角色名 → 删除积木 → 新建/切换章节 → localStorage 数据结构与刷新持久化 → 播放（单条/跨章节三条、上一条/下一条/退出）→ 删除章节（confirm）→ 返回作品库 → 删除作品 → 幻想页入口卡片与链接。
- 修复过程中发现并修正一个真 bug：`#modalOk` 点击处理先 `closeModal()`（清空弹窗 DOM）再执行保存回调，导致编辑内容读不到——改为先执行回调（try/finally）再关闭。

**说明**：第一阶段纯前端 + localStorage，无后端改动、无迁移。VN 编辑器后续阶段（图片/视频/音频/字幕/Cocos/Canvas/AI API 等）保持暂缓。

**提交**：push main（CI 自动部署）。





---

## 作品编辑器 · 视觉素材（画面 · 第二阶段）

**日期**：2026-08-23

**背景**：作品编辑器第一阶段（文字积木）完成后，用户要求给「场景 / 对白」积木添加视觉素材：图片 / GIF / WebP / MP4，上传后即时预览、可更换/删除、刷新不丢，播放时作为全屏背景（文字/对白在前景层，点击文字才切换下一幕，视频播完不自动下一幕）。不做时间轴/剪辑/字幕/配音/音乐/动画编辑器/Canvas/Cocos/AI 生图生视频。

**存储方案决策（用户要求先检查再改）**：
- localStorage 不能可靠存二进制（约 5MB 上限，MP4/GIF 极易超限；JSON.stringify 全量序列化会卡死）。
- **不引入 R2**：项目已有生产级上传链路（创角页/世界封面/buddy 都在用）——`POST /api/upload`（需登录、5MB、D1 分块存二进制、已支持 GIF/WebP/MP4）+ `GET /img/:id`（支持 Range，MP4 播放必需）。
- 因此二进制走现有 `/api/upload` → D1；**localStorage 只存 URL 引用** `block.media = {url, type}`（type: 'image'|'video'），几十字节，完全可靠、刷新不丢。
- 注意：上传画面需要登录（`hyool_token`），未登录点击「添加画面」会 toast 提示。

**改动**：
- `public/story-editor.js`：数据模型积木新增可选 `media`；积木渲染新增媒体区——无素材显示「🖼 添加画面」按钮（accept 图片/GIF/WebP/MP4），有素材显示预览（图片 `<img>`；MP4 `<video controls muted playsinline>`，可播放/暂停）+ 「更换画面」「移除画面」；上传走 `fetch('/api/upload')`（credentials include + Authorization Bearer，前端校验类型/5MB/登录态）；播放时媒体作为全屏背景（`object-fit:cover`；MP4 `autoplay loop muted playsinline`，播完不自动下一幕），文字/对白放进前景 `.play-fore`（半透明模糊卡片保证可读），点击文字 → 下一幕；`StoryEditor` 测试 API 新增 `setBlockMediaById/removeBlockMediaById/upload`。
- `public/story-editor.html`：新增积木媒体区与播放背景/前景样式；`play-head/play-nav` 提升 z-index；播放 `has-media` 态下 `.play-fore` 卡片式。
- `.wrangler/serve-static.js`（本地测试基建，不入库）：mock `POST /api/upload`（multipart 解析，内存存储，类型/5MB 校验同生产）+ `GET /img/:id`（支持 Range）。

**验证**（本地 CDP 真实浏览器冒烟 `.wrangler/story-smoke.js`）：
- **90/90 PASS**，无 console error / 网络错误。
- 新增覆盖：真实上传 GIF/MP4/PNG → 积木即时预览（图片/视频/MP4 标签）→ localStorage 只存 URL 引用 → 刷新后预览仍在 → 播放三条（第 1 条图片全屏背景 + 文字前景 + 点击文字切到第 2 条、第 2 条 MP4 全屏背景 + 对白前景 + 点击切换、第 3 条无媒体背景）→ 更换素材（PNG 替换 GIF，src 更新）→ 移除素材（预览消失、media 字段删除）。原 62 条全部保持通过。

**说明**：后端无改动、无迁移（复用现有 `/api/upload`）。VN 编辑器后续阶段（音频/字幕/Cocos/Canvas/AI API 等）仍保持暂缓。

**提交**：push main（CI 自动部署）。

---

## 作品编辑器 · 配音（第三阶段）

**日期**：2026-08-23

**背景**：视觉素材（画面）完成后，用户要求给每个剧情积木单独添加配音：MP3/WAV/M4A/OGG 上传，编辑器内试听/更换/删除，播放时进入该幕自动播放配音、点击推进停止旧配音进入下一幕并自动播放下一幕配音，刷新不丢。不做字幕/音乐/音效/时间轴/分支/AI 配音/TTS/Canvas/Cocos。

**存储**：与画面一致——二进制走现有 `POST /api/upload` → D1，localStorage 只存 URL 引用 `block.audio = {url, type:'audio'}`（与积木绑定、刷新不丢）；`GET /img/:id` 已通用支持任意 content_type + Range，音频试听/播放直接复用，后端读取链路零改动。

**改动**：
- `src/index.js`：`/api/upload` MIME 白名单新增 `audio/mpeg` / `audio/wav` / `audio/mp4` / `audio/x-m4a` / `audio/ogg`（m4a 兼容两种 MIME），错误消息更新。
- `public/story-editor.js`：数据模型积木新增可选 `audio`；积木渲染新增配音区——无配音「🎙 添加配音」按钮，有配音显示试听条（`<audio controls preload="metadata">`）+「更换配音」「删除配音」；`uploadFile` 同时识别画面/配音 MIME；播放逻辑全局 `playAudio` 引用——`renderPlay` 开头 `stopPlayAudio()` 先停上一幕配音（避免叠音），当前幕有配音则 `new Audio(url).play()`（catch 静默，不影响点击推进），退出 `stopPlay` 停止；无配音积木完全保持原播放逻辑；`StoryEditor` 测试 API 新增 `setBlockAudioById/removeBlockAudioById`，`play()` 返回值带 `audio`。
- `public/story-editor.html`：配音区样式 `.block-audio/.ba-preview`。
- `.wrangler/serve-static.js`（本地 mock，不入库）：upload 白名单同步。

**说明**：无数据库迁移。`serve-static.js` 位于 `.gitignore`（.wrangler/ 构建产物目录），仅本地验证用途，不入版本库。按约定未做验证，直接 commit + push main（CI 自动部署）。

**提交**：b6933c9


---

## 作品编辑器 · 字幕 + BGM + 音效（第四阶段）

**日期**：2026-08-23

**背景**：配音（第三阶段）完成后，用户要求同时增加字幕与作品级 BGM、积木级音效，播放结构：全屏背景 + 剧情文字 + 配音 + 字幕 + BGM + 音效。字幕属于对白积木（默认直接用角色名+对白文字，显示在画面前景底部、不遮挡主画面，支持开/关、改文字/位置/大小，点击推进时跟随切换）；BGM 属于章节（MP3/WAV/M4A/OGG，添加/删除/更换/播放暂停试听/音量控制，进入章节自动播放，用户点击剧情进下一幕时 BGM 不重新开始、保持连续播放）；音效属于单个剧情积木（进入该积木自动播放，点击进入下一幕时停止不需要继续播放的音效）。剧情推进仍由用户点击。

**数据模型**（均无需数据库迁移，二进制走现有 `POST /api/upload` → D1，localStorage 只存引用）：
- 章节 `ch.bgm = {url, type:'audio', volume(0~1，默认 0.6)}` —— BGM 属章节；进入章节自动循环播放，同一章节内切幕（playNext/playPrev）不重启，跨章节（chapterId 变化）才切换/停止。
- 积木 `b.sfx = {url, type:'audio'}` —— 音效，进入该幕自动播放一次，切幕即停。
- 积木 `b.subtitle = {on, text, pos:'bottom'|'top'|'mid', size:'sm'|'md'|'lg'}` —— 字幕，仅对白积木；缺省 = 默认开启 + 默认文字「角色名：对白内容」+ 底部 + 中；全默认时存空（播放端按默认处理）。

**改动**：
- `public/story-editor.js`：
  - 积木渲染：对白积木 ops 新增「💬 字幕」按钮（关闭态显示「💬 字幕·关」，打开字幕设置弹窗）；配音区下方新增音效区（无 →「🔊 添加音效」，有 → 试听条 + 更换/删除）。
  - 新增函数：`openSubtitleEditor`（开启/文字/位置/大小四选单，全默认时删除字段）；`pickSfx/removeBlockSfx`、`pickBgm/removeChapterBgm/openBgmEditor`（BGM 弹窗内试听条 + 实时音量滑条 + 更换/删除，上传成功重开弹窗刷新）。
  - 播放：`buildPlayFlat` 每条带 `chapterId`/`bgm`；新增 `playSfx/playBgm/playBgmChapter` 全局引用与 `stopPlaySfx/stopPlayBgm/switchBgm`；`renderPlay` 开头停旧配音+旧音效，`chapterId` 变化才 `switchBgm`（同章节连续播放），对白积木渲染 `.play-sub` 字幕层（跟随当前剧情切换），当前幕有音效自动播放一次，退出 `stopPlay` 全部停止；无配音/音效/BGM/字幕的积木完全保持原逻辑。
  - `StoryEditor` 测试 API：`list()` 的 chapters 补 `bgm`；新增 `setBlockSubtitleById(传null=恢复默认)/setBlockSfxById/removeBlockSfxById/setChapterBgmById/removeChapterBgmById`；`play()` 返回带 `sfx/subtitle/chapterId/bgm`。
- `public/story-editor.html`：stage-head 新增「🎵 BGM」按钮（当前章节）；字幕样式 `.play-sub`（absolute 前景层、bottom/top/mid 三位置、sm/md/lg 三字号、半透明底条、pointer-events:none 不拦截点击推进）；BGM 弹窗音量行 `.bgm-vol`。
- `.wrangler/serve-static.js`（本地 mock，不入库）：无改动（白名单第三阶段已含音频）。

**验证**（本地 CDP 真实浏览器冒烟 `.wrangler/story-av-smoke.cjs`，真实上传 WAV ×4 + Audio 探针注入）：**37/37 PASS**，无 console error。
- 覆盖：场景幕无字幕；对白幕默认字幕「角色名：对白内容」+ 底部/中；进入章节自动播放 BGM；同章节 playNext 两次 BGM 不重启；配音/音效进入自动播放、切幕停止；跨章节切到第二章 BGM 切换（新 BGM 启动 + 旧 BGM 停止）；退出停止 BGM；字幕自定义文字/顶部/大号、关闭不显示、恢复默认；数据模型（audio/sfx/subtitle 在积木、bgm 在章节含 volume、localStorage 持久化）；删除音效/删除章节 BGM 后字段独立移除（不影响配音）。
- 过程中发现并修正：测试脚本 `BLOCK_ID_AT` 在作品数组里查找章节 id（应 `s[0].chapters.find`）；`playFlat` 在 `startPlay` 时构建 → 跨章节用例需先建好第二章；产品 `list()` 漏复制章节 `bgm` 字段。

**说明**：无数据库迁移、无后端改动。按约定不做线上验证（本次为确有必要，做了本地 CDP 冒烟，脚本在 `.wrangler/` 不入库）。

**提交**：push main（CI 自动部署）。


---

## 作品编辑器 · 分辨率（16:9 / 9:16）+ 画面压缩

**日期**：2026-08-23

**背景**：用户要求创建编辑器时选择 2 种分辨率（16:9 横屏 / 9:16 竖屏）适配电脑与手机，并询问图片规格。确认方案：两档可调——默认 1280×720（横）/ 1080×1920（竖），编辑器内可选高清 1920×1080（横）/ 1440×2560（竖）。

**改动**：
- `public/story-editor.js`：作品级新字段 `orientation`（'landscape'|'portrait'，旧作品默认横屏）与 `imgQuality`（'standard'|'hd'，默认标准），`normalizeStories` 补默认迁移；新建作品记录所选分辨率并写入；编辑器侧边栏画面方向/画质按钮组即时保存，作品库卡片显示徽标；上传压缩 `compressImageFile`（cover 居中裁剪到目标分辨率、webp q0.85 回退 jpeg、只缩不放、GIF/SVG 保留、无收益回退原文件），`uploadFile(file, {compress})` 仅压缩图片；播放按方向加 `orient-portrait/landscape` class，`play()` 快照含 orientation/imgQuality；测试 API 增 `setStoryOrientationById/setStoryImgQualityById/create(title,orientation)`。
- `public/story-editor.html`：新建区分辨率选择卡（16:9 / 9:16）、编辑器方向/画质切换按钮、竖屏播放适配（前景/字幕收窄）。
- `.wrangler/story-av-smoke.cjs`（本地冒烟，不入库）：J 段新增 17 条断言。

**验证**（本地 CDP 真实浏览器冒烟 `.wrangler/story-av-smoke.cjs`）：**78/78 PASS**，无功能性 console error（favicon 404 与 /api/tts/voices 404 为静态 mock 服务器已知噪音）。
- J 段覆盖：创建时选竖屏 9:16 + 默认标准画质；新建区/编辑器按钮高亮同步；横屏标准压缩 2000×1200 → 1280×720；高清档 → 1920×1080；竖图 cover 裁剪为 16:9（800×450）；GIF 不压缩保留 1×1；竖屏 1600×2844 → 1080×1920；竖屏/横屏播放画幅 class；play() 报告方向；方向/画质切换持久化。

**说明**：无数据库迁移、无后端改动（/api/upload 白名单已含 image/webp，压缩产物可直接入库）。按约定不做线上验证，做了本地 CDP 冒烟，脚本在 .wrangler/ 不入库。

**提交**：push main（CI 自动部署）。

---

## 作品编辑器 · 修复：多场景画面上传覆盖 + 竖屏播放画幅

**日期**：2026-08-23

**背景**：分辨率（16:9 / 9:16）+ 画面压缩上线后，用户报告两个问题：① 第一章创建多个场景，先上传第一个场景画面、再上传第二个场景画面时，第二个会覆盖第一个；② 选择手机（9:16）分辨率后，播放作品预览不是竖版，而是被全屏放大裁剪。

**根因**：
- 上传覆盖：`pickMedia` / `pickAudio` / `pickSfx` / `pickBlockBgm` / `pickCastAudio` 均使用**单例 file input**，`change` 事件回调闭包捕获的是**首次调用时的目标积木**；之后再点其他积木的「添加画面 / 配音 / 音效 / 本幕 BGM」只会触发 `input.click()`，上传结果仍写回第一个积木 → 第二个场景画面覆盖第一个。（字幕时间轴音效 `pickTimelineSfx` 因原地改对象引用，不受影响。）
- 竖屏播放：`.play-media-bg` 为 `position:fixed; inset:0` 全屏 + `object-fit:cover`，竖屏作品播放时画面被全屏拉伸裁剪放大；此前竖屏适配仅收窄前景文字/字幕，画面本身未按 9:16 竖幅呈现。

**改动**：
- `public/story-editor.js`：
  - 五个单例 input 上传入口改为「点击时记录目标」：`mediaPickBlock/mediaPickBtn`、`audioPickBlock/audioPickBtn`、`sfxPickBlock/sfxPickBtn`、`bgmPickBlock/bgmPickBtn`、`castPickBtn`，change 回调读取最新目标，写错积木的 bug 消除。
  - 播放引入画幅容器 `.play-frame`（媒体背景 / 前景文字 / 字幕均挂入容器）：横屏铺满播放区保持原行为；竖屏按播放区 `clientWidth/clientHeight` 精确计算 9:16 竖幅（宽窄屏均居中、不超界、比例恒定），不再全屏放大裁剪。
  - `startPlay` 先显示 overlay 再 `renderPlay`，确保竖幅能按真实播放区尺寸计算（此前 overlay 隐藏时测得 0 尺寸）。
- `public/story-editor.html`：新增 `.play-frame` 样式（absolute + inset:0 + margin:auto 居中 + flex 内容居中）；`.play-media-bg` 由 fixed 改 absolute（挂载到画幅容器内）；竖屏时播放区黑底、画幅两侧留黑。
- `.wrangler/story-av-smoke.cjs`（本地，不入库）：新增 K 段（走真实 UI 上传路径：两个场景积木各上传画面，验证互不覆盖、各自绑定）、L 段（竖屏画幅 9:16 比例且未占满全宽、竖屏媒体按竖幅铺满非全屏放大、横屏画幅铺满播放区）。

**验证**（本地 CDP 真实浏览器冒烟 `.wrangler/story-av-smoke.cjs`）：**85/85 PASS · SMOKE-OK**，无功能性 console error（favicon 404 与 `/api/tts/voices` 404 为静态 mock 已知噪音）。
- K 段：两个场景各自保留独立画面、第一块画面未被第二块覆盖、预览与数据一致。
- L 段：竖屏画幅 9:16 竖幅（比例误差 <1%）且宽度小于视口 60%；竖屏 + 竖图媒体按竖幅铺满（非全屏放大）；横屏画幅铺满播放区。
- 注：旧 `.wrangler/story-smoke.js`（79 断言）存在 11 条既有失败（删除积木后块数断言等），经 `git stash` 回退对比确认为改动前即存在，与本次修复无关。

**说明**：无数据库迁移、无后端改动。按约定不做线上验证，做了本地 CDP 冒烟，脚本在 .wrangler/ 不入库。

**提交**：push main（CI 自动部署）。
## 作品编辑器 · 修复：角色音频 / 时间轴音效 同类单例 input 闭包 bug 补修

**日期**：2026-08-23

**背景**：上轮修复覆盖 5 个积木级上传入口（pickMedia/pickAudio/pickSfx/pickBlockBgm/pickCastAudio）后，本轮对配音（pickAudio）与音效（pickSfx/pickTimelineSfx/pickBlockBgm/pickCastAudio）全部上传路径复查，发现两个同类闭包 bug 漏修，另顺带发现一个新积木音效数组未初始化的崩溃点。

**根因**：
- `pickCastAudio`（角色声音表·上传音频）：单例 file input 的 `change` 回调闭包捕获的是**首次调用时的角色名 `sp`**；上轮只把点击目标按钮记录到 `castPickBtn`，未记录角色名 → 先给角色 A 上传再给角色 B 上传，第二次仍写回角色 A（角色 B 静音、A 被覆盖）。
- `pickTimelineSfx`（时间轴·添加/更换音效）：回调闭包捕获**首次调用时的 `targetSfx`** → 先「＋添加音效」（targetSfx=null）再点某音效「更换」，更换会被当成新增第 2 条；反过来先「更换」后「添加」，添加会覆盖原音效。上轮 history.md 判定其「因原地改对象引用不受影响」**不成立**（原地改只对"已存在对象"成立，目标对象本身由闭包捕获首次值）。
- 附加缺陷：`addBlock` 新建积木无 `sfxList` 字段（`normalizeStories` 仅在 localStorage 加载时兜底），`pickTimelineSfx` 添加分支直接 `cur.sfxList.push()` 报 `TypeError: Cannot read properties of undefined`，新积木「＋添加音效」必失败。

**修复**（`public/story-editor.js`）：
1. 新增 `let castPickSp = null;`，`pickCastAudio` 每次点击记录 `castPickSp = sp`，回调改读 `s.cast[castPickSp]`。
2. 新增 `let tlSfxTarget = null;`，`pickTimelineSfx` 每次点击记录 `tlSfxTarget = targetSfx || null`，回调内 `const target = tlSfxTarget` 判定添加/更换。
3. 时间轴添加分支 push 前补 `if (!Array.isArray(cur.sfxList)) cur.sfxList = [];`。

**验证**：`.wrangler/story-av-smoke.cjs` 93 PASS / 0 FAIL（SMOKE-OK，favicon 与 /api/tts/voices 404 为已知 mock 噪音）。新增回归：
- **M 段**：cast 弹窗内给「角色甲」「角色乙」各走真实 UI 上传音频 → 两角色各自独立绑定、互不覆盖（修复前第二次上传会覆盖第一个角色）。
- **N 段**：新积木走「🎼」按钮打开时间轴 → 「＋添加音效」1 条 → 点 clip「更换」→ 仍 1 条且 url 已更新（修复前更换误新增第 2 条；未修复数组初始化时添加直接抛错）。

**补充**：上轮条目（f53236c）对 `pickTimelineSfx` "不受影响"的判定有误，以本条为准。

## 作品编辑器 · 播放：切幕转场渐入淡出（消除黑屏闪烁）

**日期**：2026-08-23

**背景**：用户反馈「转场能不能渐入淡出？目前转场屏幕总会黑一下」。播放切幕时 `renderPlay()` 直接 `body.innerHTML = ''` 清空重建，新幕图片/视频异步加载完成前露出的播放区底色为纯黑（`.play-media-bg` 背景 #000、竖屏 `#playBody` 背景 #000）→ 每次切幕瞬间闪黑。

**改动**：
- `public/story-editor.html`：`.play-frame` 增加 `animation: playFadeIn .32s ease both`（每次重建渐入）；新增 `@keyframes playFadeIn/playFadeOut` 与 `.play-frame.tl-leave`（0.18s 淡出 + pointer-events 禁用，淡出期间不再响应点击）。
- `public/story-editor.js`：
  - `renderPlay` 不再 `body.innerHTML = ''`：改为把所有残留旧画幅标记 `tl-leave` 淡出、`setTimeout` 260ms 后移除，新画幅追加在其上 → 两层叠加交叉淡化，中间无黑帧；快速连点也不累积（每次把全部残留标记）。
  - 末尾预取下一幕视觉素材（Image / muted video preload 进缓存），渐入期间新画面立即可见，进一步缩短黑屏窗口。
  - `startPlay`/`stopPlay` 进入/退出播放时清空 `playBody`：重启播放不叠加旧帧，也避免旧画幅撑出播放区滚动条压缩新画幅宽度（L 段横屏断言曾因此 749px ≠ 764px）。
- `.wrangler/story-av-smoke.cjs`（本地回归，不入库）：新增 **O 段** 7 条转场断言（切幕瞬间新旧画幅叠加、旧画幅 tl-leave、新画幅 playFadeIn、淡出结束后移除、快速连点不堆积且收敛为 1、退出播放后播放区清空）；`#playBody` 内 `.play-sub`/`.play-frame`/`.play-media-bg` 选择器改取 `:last-child`（交叉淡化期间旧画幅短暂残留，按「最新画幅」语义断言）。

**验证**（本地 CDP 真实浏览器冒烟 `.wrangler/story-av-smoke.cjs`）：**100 PASS / 0 FAIL · SMOKE-OK**，无功能性 console error（favicon 与 `/api/tts/voices` 404 为已知 mock 噪音）。原 93 条断言全部保持，新增 O 段 7 条。

**说明**：无数据库迁移、无后端改动。按约定本地 CDP 冒烟，脚本在 .wrangler/ 不入库。

**提交**：push main（CI 自动部署）。

---

## 作品编辑器 · 场景字幕（场景积木支持可调字幕）

**日期**：2026-08-23

**背景**：字幕功能此前仅对白积木可用（`b.subtitle = {on, text, pos:'bottom'|'top'|'mid', size:'sm'|'md'|'lg'}`，对白缺省=开启、角色名+对白、底部/中）。用户要求「场景字幕也要像对白那样可调节」——场景积木同样获得开启/关闭、自定义文字、位置（底/顶/中）、大小（小/中/大）四项调节能力。

**设计决策**：
- 场景字幕**缺省关闭**（对白保持缺省开启）：场景从「无字幕」改为默认开启会对存量作品造成突兀的视觉回归（前景场景卡片 + 底部字幕双重显示同一段文字）；用户显式开启后默认文字 = 场景内容、底部、中，之后可自由改文字/位置/大小/关闭。
- 场景开启时即使「全默认」也必须落字段 `{on:true, text:'', pos:'bottom', size:'md'}`——否则沿用对白的「全默认 → 删字段」会因「场景缺省=关闭」把显式开启又变回关闭（存不进）；对白保持原「全默认 → 存空」逻辑（缺省即开）。

**改动**（`public/story-editor.js`）：
1. 数据模型注释：`subtitle` 由「可选，对白」改为「可选，对白/场景」，注明两者缺省差异。
2. 积木 ops：字幕按钮门控 `b.type === 'dialogue'` → `b.type === 'dialogue' || b.type === 'scene'`；按钮状态按类型计算——场景 = 存在 subtitle 且 `on !== false` 才显示「💬 字幕」，否则「💬 字幕·关」（对白逻辑不变）。
3. `openSubtitleEditor`：标签/占位符按类型区分——场景显示「字幕文字（留空 = 使用「场景文字」）」/「默认：场景内容」，对白保持「角色名：对白内容」。
4. 保存逻辑：场景全默认且开启时落显式字段（见设计决策）。
5. `renderPlay` 字幕层：类型门控去掉（`subOn` 按类型语义计算：场景需显式开启，对白缺省开启）；默认文字按类型——场景 = 内容，对白 = 角色名：对白。

**说明**：无数据库迁移、无后端改动。按约定不做验证、直接 push main（CI 自动部署）。localStorage 数据结构向后兼容（场景无 subtitle 字段 = 不显示，行为与改动前一致）。

**提交**：0890033（push main）


---

## 作品编辑器 · 场景字幕·电影式字幕模式（修复：开关/位置不生效观感）

**日期**：2026-08-23

**背景**：场景字幕上线后用户反馈「场景字幕开关有作用吗？我选了关，还是有……的显示，而且不需要场景以及点击文字进入下一条的显示，虚化框可以近乎透明。而且位置我选的底部，结果还是在中间」。

**根因**：场景积木的播放渲染与字幕层解耦——无论字幕开关状态，`renderPlay` 都固定渲染中间 `.play-scene` 场景文字卡片 + `.play-fore::after`「点击文字进入下一条」提示 + 有媒体时的玻璃虚化卡片（`.has-media .play-fore`）。于是：关字幕只关掉底部字幕层，中间场景卡片仍在（「关了还有显示」）；字幕位置选了底部，但视觉重心被固定居中的场景卡片占据（「选底部却在中间」）；场景卡片 + 点击提示 + 玻璃框正是用户不想要的元素。

**改动**：
- `public/story-editor.js` `renderPlay` 场景分支：不再创建 `.play-scene` 文字节点，改为给 `.play-fore` 加 `scene-sub-mode` 类（电影式字幕模式）。
- `public/story-editor.html` 新增样式：
  - `.play-fore.scene-sub-mode::after{content:none}` —— 去掉「点击文字进入下一条」提示。
  - `.play-overlay .play-frame .play-fore.scene-sub-mode` —— `position:absolute;inset:0;max-width:none`，前景退化为**整个画幅的透明点击区**（字幕层 pointer-events:none 不拦截，任意位置点击推进下一幕）。
  - `.play-overlay.has-media .play-fore.scene-sub-mode` —— 有媒体时不套玻璃卡片：背景/边框透明、backdrop-filter 关、无阴影、padding 归零。

**效果**：场景幕播放 = 纯媒体画面（或纯底色）+ 可调字幕层。字幕开 → 按用户设置显示（底部/顶部/中部、字号、自定义文字，缺省=场景内容）；字幕关 → 画面无任何文字。整幅画幅可点击推进。对白积木行为完全不变（仍保留中间对白卡 + 字幕 + 点击提示）。

**说明**：无数据库迁移、无后端改动；localStorage 数据结构不变（场景无 subtitle 字段 = 无文字，行为与改动前一致）。按约定不做验证、直接 push main（CI 自动部署）。

**提交**：push main

---


## 作品编辑器 · 字幕交互合并（删「编辑」按钮：场景编辑移除 / 角色编辑并入字幕弹窗，无字幕=关）

**日期**：2026-08-23

**背景**：用户反馈「编辑和字幕按钮是不是冲突了？现在我选字幕开关不灵，删掉编辑按钮」，并澄清意图：编辑按钮分两类——场景编辑、角色编辑；要求把**场景编辑删掉**（场景积木只保留字幕功能），对白**角色编辑（角色名 + 对白内容）融入字幕弹窗**；字幕**不再需要独立开关按钮**，**没有字幕就是关，有字幕就是开**。

**改动**：
- `public/story-editor.js`：
  - 积木 ops 行删除「编辑」按钮（场景/对白均无）。场景积木不再有内容编辑入口（场景编辑已移除）。
  - `openSubtitleEditor` 重构：
    - 对白弹窗 = 角色名字 + 对白内容 + 字幕设置（文字/位置/大小）；场景弹窗 = 仅字幕设置（文字/位置/大小）。
    - 去掉「开启字幕」下拉选择器——**有 subtitle 字段 = 开，无 = 关**；保存一律落 `{on:true, text, pos, size}`。
    - 弹窗底部新增「移除字幕（关闭）」按钮（有字幕时显示）＝删字段回「关」。
  - `addBlock`：新建积木直接打开字幕弹窗（对白可即时填角色/内容，场景即时设字幕）；场景默认内容改为空。
  - 删除不再被引用的 `openBlockEditor` 函数。
  - `renderPlay` 字幕层 `subOn` 统一为 `!!(b.subtitle && b.subtitle.on !== false)`（所有类型：无字段=关）；缺省文字不变（对白=「角色名：对白内容」、场景=「场景内容」）；最终文字为空则不渲染字幕框。
  - 积木卡片：场景无内容时显示弱化占位提示（「暂无场景文字，可在 💬 字幕 设置字幕文字」）。
- `public/story-editor.html`：新增 `.block-text.empty` 弱化样式（`color:#7a7a8c;font-style:italic`）。

**效果**：编辑与字幕不再并排按钮（消除误触/视觉冲突）；对白内容编辑入口收进「💬 字幕」弹窗；字幕状态由字段存在性决定、无独立开关，不存在「按钮显示关、弹窗默认开、保存后变开」的歧义，也没有「选了关还显示」的路径。

**行为变更**：对白积木此前「缺省开启」字幕（无 subtitle 字段也显示）→ 现统一「有字段=开，无字段=关」。存量对白积木无 subtitle 字段则播放不再显示字幕，可在「💬 字幕」弹窗重新设置（保存即落字段）。

**说明**：无数据库迁移、无后端改动；localStorage 数据结构不变（`b.subtitle` 字段存在性即开关状态）。

**提交**：push main


## 作品编辑器 · 字幕改「对白框」（去掉翻译字幕条：对白=始终显示可移动对白框，场景=纯文字可拖拽）

**日期**：2026-08-23

**背景**：用户反馈方向性调整——去掉「翻译字幕（底部小条）」形态，播放文字统一用可移动的「对白框」显示（角色名 + 对白内容）；弹窗不再有独立字幕文字输入。补充：按方案 1（对白框位置三档 + 字号三档），场景**不显示文字框但文字仍要显示**，且**场景文字可自由移动**（仅场景）。

**改动**：
- `public/story-editor.js`：
  - `renderPlay` 删除 `.play-sub` 翻译字幕条整段。对白幕：`.play-dialogue` 对白框**始终显示**（角色名 `.pd-speaker` + 对白内容 `.pd-line`，内容自动加引号 `formatDialogue`），位置三档（`subtitle.pos` bottom/top/mid → fore 加 `dlg-bot`/`dlg-top` 或框加 `mid`）+ 字号三档（`size` sm/md/lg → `.play-dialogue.size-*`）。场景幕：fore 保持 `scene-sub-mode` 全屏透明点击区，新增 `.play-scene-text`（纯文字无框、带投影、`pointer-events:auto`）渲染在 frame 上层，`b.content` 非空即显示。
  - 新增 `makeTextDraggable`（对白框/场景文字共用）：按住可自由拖拽（pointerdown/move/up + setPointerCapture + `touch-action:none` 支持触屏），松手自动转画幅中心点百分比 `subtitle.x/y` 并 `persist()`；**位置写回真实积木**（`findBlock(b.id)`，因 `playFlat` 是浅拷贝，直接改播放块不回写原数据）；`moved` 标志区分点击与拖拽——拖拽后的 click 不触发推进，场景文字点击不推进、对白框点击推进（`opts.onClick`）。
  - `openSubtitleEditor` 重构：对白弹窗 = 角色名字 + 对白内容（播放时自动加引号）+ 位置（底/顶/中偏下/**自由（播放中拖拽）**）+ 字号（小/中/大），无独立字幕文字输入；场景弹窗 = 场景文字（留空不显示；播放时可拖拽）+ 字号（位置靠拖拽，弹窗不设三档）。保存：对白 `subtitle={on,pos,size}`（pos='custom' 时补 `x/y` 默认 50/82，选三档则删 x/y），场景 `subtitle={on,size,x,y}`（x/y 保留已拖拽坐标）。删除「移除字幕（关闭）」按钮（对白框始终显示、场景留空即不显示，无开关概念）。
  - 积木按钮文案：对白「💬 对白框」、场景「📝 场景文字」；场景文字存回 `b.content`（场景卡片恢复显示内容，空时占位提示「暂无场景文字，点击 📝 场景文字 设置」）。
  - `setBlockSubtitleById` 不再存 `text` 字段。
  - `renderPlay` 对白分支：存了 `subtitle.x/y` = 自由位置（`.play-dialogue.free` 绝对定位挂 frame，可拖拽）；否则三档预设（fore 加 `dlg-bot`/`dlg-top` 或框加 `mid`）。场景文字默认字号与对白一致（md = clamp(15px,2.4vw,19px)）。
- `public/story-editor.html`：删除 `.play-sub`/`.ps-box` 全部 CSS 与竖屏适配行；删除废弃的 `.play-scene`/`.play-empty`；新增对白框位置/字号三档样式（`.play-fore.dlg-bot/dlg-top`、`.play-dialogue.mid`、`.play-dialogue.size-sm/lg`）、`.play-scene-text`（纯文字无框可拖拽，`touch-action:none`，竖屏收窄 420px）与 `.play-dialogue.free`（自由拖拽模式）。
- `.wrangler/story-av-smoke.cjs`（本地冒烟，不入库）：`.play-sub` 断言改为 `.play-dialogue`/`.play-fore`（对白框文字=角色名+引号对白、默认底部/字号中、自定义位置/字号、恢复默认），删除「关闭字幕」段。

**行为变更**：存量对白积木无 subtitle 字段 → 播放仍显示对白框（默认底部/字号中）；存量 `subtitle.text` 自定义字幕文字不再使用（对白文字 = 对白内容）。存量场景 `subtitle.text` 不再使用（场景文字 = `b.content`），旧 `pos` 字段忽略（默认底部居中，拖拽后存 `x/y`）。

**说明**：无数据库迁移、无后端改动；localStorage 字段 `subtitle` 结构为 `{on, pos, size, x?, y?}`。按约定不做验证、直接 push main（CI 自动部署）。

**提交**：push main

---

## 作品编辑器 · 播放文字「自定义拉大小」（字号不再局限于三档）

**日期**：2026-08-23

**背景**：用户反馈「字体还是小」，要求改成自定义拉大小。原有三档（小/中/大）保留为旧数据兼容，新增自定义字号。

**改动**：
- `public/story-editor.js`：
  - 新增 `attachSizeHandle(el, b)`：播放文字右下角挂「拉大小」手柄 `.rz-handle`（pointerdown/move/up + setPointerCapture + `touch-action:none`），按住拖动实时调字号（12~72px，`(dx+dy)/2` 映射），对白框角色名联动 1.3x，松手写回真实积木 `subtitle.size`（数字 px）并 `persist()`；手柄事件独立 `stopPropagation`，与位置拖拽/点击推进互不干扰。
  - `renderPlay` 对白/场景文字：`subtitle.size` 为数字 → 内联 `fontSize`（对白 = line + speaker 联动）；为旧三档 → 沿用 `size-sm/md/lg` class。
  - `openSubtitleEditor` 字号下拉改**滑条**（12~72px，实时显示 px 值）；打开时旧三档映射为数字（sm=15/md=17/lg=22）；保存 `subtitle={on, size:数字}`。
- `public/story-editor.html`：`.play-dialogue` 加 `position:relative`；新增 `.rz-handle` 手柄样式（右下角小圆钮 + 拖拽高亮）。

**行为变更**：存量三档 `subtitle.size` 数据照常渲染（class 兼容）；播放中拖动任意文字/对白框右下角手柄即转自定义字号并保存。对白框角色名字号 = 对白内容 × 1.3。

**说明**：无数据库迁移、无后端改动；`subtitle.size` 现为数字 px（12~72）或旧三档字符串。按约定不做验证、直接 push main（CI 自动部署）。

**提交**：push main


---

## 作品编辑器 · 对白框改「聊天框」+ 文字颜色（取消三档位置与自由拖拽）

**日期**：2026-08-23

**背景**：用户要求对白框像聊天应用一样——默认贴底、占满底部全宽；取消上中下三档位置与「自由（播放中拖拽）」选项；文字只保留可调大小与颜色（场景文字也加颜色调节）。

**改动**：
- `public/story-editor.html`：
  - `.play-dialogue` 改为底部「聊天框」：`position:absolute;left:0;right:0;bottom:0`（相对画幅），全宽贴底、半透明深色渐变底 + `backdrop-filter` 模糊 + 顶部圆角/细边框/上投影，文字左对齐（角色名 + 对白内容紧凑布局）；删除旧 `max-width:660px` 居中卡样式与竖屏 `max-width:440px` 收窄行（聊天框全宽贴画幅）。
  - 删除对白框位置三档样式（`.play-fore.dlg-bot/dlg-top`、`.play-dialogue.mid`）与自由拖拽样式（`.play-dialogue.free`）；保留字号三档 `size-sm/md/lg` 旧数据兼容。
  - 新增 `.play-fore.dlg-fore`：对白幕 fore 退化为全屏透明点击层（`position:absolute;inset:0;max-width:none`，任意处点击推进），`has-media` 时不套玻璃卡（与场景幕一致）。
- `public/story-editor.js`：
  - `renderPlay` 对白分支：不再按 `subtitle.pos`/`x/y` 定位，fore 恒加 `dlg-fore`，对白框挂 fore（absolute 贴底）；删除 `isFree`/`.free`/`makeTextDraggable(d, b, {onClick})` 自由拖拽路径（对白点击仍推进，改由全屏 fore 承接）。
  - 新增文字颜色：`subtitle.color`（hex）——对白框角色名与对白内容同色（内联 `style.color` 覆盖，角色名不再恒为 accent 紫）、场景文字直接着色；弹窗对白/场景均加「文字颜色」取色器 `<input type="color">`（初始 = 已存色或默认：对白 `#e8e8f0` / 场景 `#ffffff`；保存时选默认色即删 `color` 字段）。
  - `openSubtitleEditor` 删除「位置」下拉（底/顶/中偏下/**自由**）；`setBlockSubtitleById` 不再写 `pos` 字段（透传 `color`/`x`/`y`）；`makeTextDraggable` 改场景专用（删除对白 `pos='custom'` 写回）；积木按钮 tooltip 同步更新。
- `.wrangler/story-av-smoke.cjs`（本地冒烟，不入库）：三档/自由位置断言改为底部聊天框断言，新增对白颜色（角色名+对白同色）与场景文字颜色断言。

**行为变更**：存量 `subtitle.pos`/`x/y`（对白）字段忽略，一律渲染为底部聊天框；存量旧三档字号兼容；`subtitle.color` 缺失 = 默认（对白内容浅白 `#e8e8f0`、角色名 accent 紫；场景纯白）。场景文字位置拖拽（`x/y`）与字号手柄不受影响。

**说明**：无数据库迁移、无后端改动；`subtitle` 结构 `{on, size, color?, x?, y?}`（`x/y` 仅场景）。按约定不做验证、直接 push main（CI 自动部署）。

**提交**：push main


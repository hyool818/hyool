# 数据结构

权威 schema 在 `schema/*.sql`。改表结构必须新迁移文件，不要改已执行过的 SQL 凑合。

## D1 主表（按域）

**账号 / 彼岸**

- `profiles` `sessions` `yonder_settings` `yonder_posts` `invite_codes`
- `rate_limits` `csrf_tokens`

**角色与聊天**

- `characters`（含 `companion_state` JSON、`parent_id`、`pricing`/`price`）
- `conversations`（含摘要字段）`messages` `memories`
- `companion_inbox`
- `assets`（角色相关元数据）

**上传（迁移中）**

- **目标**：二进制 → **R2**；D1 表 `file_objects` 只存 `r2_key` + 元数据（见 `ARCHITECTURE.md` 数据分区）。
- **现状（待迁移）**：`images` + `image_chunks`（`/api/upload` 把 base64 分块塞进 D1）。
- 对外 URL 统一 **`/img/:id`**，业务侧只保存该 path，不存 bytes。

**生命世界**

- `worlds`（`world_json` 大 JSON、`status` draft/published、`share_id` 主页显隐）
- `world_threads` `world_messages`

**作品编辑器**

- `stories`：`id` `owner_id` `title` `data` `cover_image` `status` `share_id`

可见性：创建即写 `share_id`（主页可见）；发布/下架只改 `status`（广场要 `published` 且 `share_id` 非空）。隐藏主页：`share_id` 置 **NULL**（不要空字符串，UNIQUE）。

## 作品 `stories.data`（摘要）

```
{
  kind: "story" | "card_rpg" | "gacha_rogue",
  title?, orientation: "landscape"|"portrait",
  imgQuality: "standard"|"hd",
  cast: { 角色名: { kind: "tts"|"audio", voice?, url?, volume? } },
  chapters: [{ id, title, bgm?, blocks: [Block] }],
  rpg?: { hero, cards, enemies },
  rogue?: { mode: "idle"|"queue"|"rogue", teamSize, floors, roster, skills, relics, events, enemies, bonds, stages }
}
```

积木常见字段：`id` `type` `content` `speaker` `media` `figure`/`figures` `transition` `audio` `subtitle` `sfxList`；`media`=全屏背景；`figures`=最多 3 个立绘 `{url,x,y,scale}`（旧 `figure` 自动迁入）；`transition`=`fade`|`fadeblack`|`none`；`type==="choice"` 另有 `choices:[{id,label,jump,require?,effect?}]`；`type==="perf"` 为表现层；`terminal:true` 播完即结束；作品级 `logic.state` 为变量初值。播放进入积木时自动写 `playState["v_"+积木id规范化]=1`。`type==="battle"` / `rogue` 见卡牌段。

前端缓存键：`localStorage.hyool_stories_v1`（离线 + 旧数据迁移，权威在云端）。
素材库键：`localStorage.hyool_assets_v1`（本机 URL 引用目录，非服务端素材库）。
播放存档键：`localStorage.hyool_play_saves_v1`（按作品 id · 3 槽 · 仅本机：`idx` + `playState`）。

## Companion / 世界状态

- 伴侣：`characters.companion_state`（情绪、关系、家庭）。规则在 `src/companion.js`。
- 世界：`worlds.world_json.state`（节拍、NPC 目标、后果、心情、知识边界等）。非任务不要展开。

## 中枢 Blueprint

`schema: "hyool.brain.v1"`：`meta` `cast` `chapters` `logic`；素材列表由代码派生。见 `src/hub/blueprint.js`。

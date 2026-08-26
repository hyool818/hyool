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

**上传**

- `images` + `image_chunks`（`/api/upload`）

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

积木常见字段：`id` `type` `content` `speaker` `media` `audio` `subtitle` `sfxList`；`type==="choice"` 另有 `choices:[{id,label,jump}]`（`jump`=`next`|`end`|积木id|`ch:`+章节id）；`terminal:true` 表示播完即结束（分支结局用）；`type==="battle"` 另有 `enemies` `party` `winContent` `loseContent`；`type==="rogue"` 为肉鸽入口。

前端缓存键：`localStorage.hyool_stories_v1`（离线 + 旧数据迁移，权威在云端）。

## Companion / 世界状态

- 伴侣：`characters.companion_state`（情绪、关系、家庭）。规则在 `src/companion.js`。
- 世界：`worlds.world_json.state`（节拍、NPC 目标、后果、心情、知识边界等）。非任务不要展开。

## 中枢 Blueprint

`schema: "hyool.brain.v1"`：`meta` `cast` `chapters` `logic`；素材列表由代码派生。见 `src/hub/blueprint.js`。

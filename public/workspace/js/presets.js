// presets.js — 平台导出预设
export const PRESETS = [
  { id: 'hyool-avatar', name: 'HYOOL 角色头像', meta: '512×512 · WebP · 圆形头像', w: 512, h: 512, format: 'webp', quality: 82, fit: 'cover', note: '方形裁切到 1:1' },
  { id: 'hyool-cover', name: 'HYOOL 主页背景', meta: '1920×1080 · WebP', w: 1920, h: 1080, format: 'webp', quality: 80, fit: 'cover', note: '16:9 背景图' },
  { id: 'wechat-moments', name: '微信朋友圈', meta: '1080×1440 · JPEG', w: 1080, h: 1440, format: 'jpeg', quality: 90, fit: 'cover', note: '3:4 竖图' },
  { id: 'gzh-cover', name: '公众号头图', meta: '900×383 · JPEG', w: 900, h: 383, format: 'jpeg', quality: 88, fit: 'cover', note: '头图 2.35:1' },
  { id: 'douyin-cover', name: '抖音封面', meta: '1125×633 · JPEG', w: 1125, h: 633, format: 'jpeg', quality: 90, fit: 'cover', note: '16:9 封面' },
  { id: 'bilibili-cover', name: 'B站封面', meta: '1920×1080 · JPEG', w: 1920, h: 1080, format: 'jpeg', quality: 85, fit: 'cover', note: '16:9' },
  { id: 'xhs-cover', name: '小红书封面', meta: '1242×1660 · JPEG', w: 1242, h: 1660, format: 'jpeg', quality: 90, fit: 'cover', note: '3:4 竖图' },
  { id: 'taobao-main', name: '淘宝主图', meta: '800×800 · JPEG', w: 800, h: 800, format: 'jpeg', quality: 88, fit: 'cover', note: '1:1 方图' },
  { id: 'avatar-square', name: '通用头像', meta: '256×256 · PNG', w: 256, h: 256, format: 'png', quality: 100, fit: 'contain', note: '等比缩放入内，透明背景' },
  { id: 'web-feed', name: '网页横幅', meta: '1200×630 · WebP', w: 1200, h: 630, format: 'webp', quality: 82, fit: 'cover', note: 'OG 分享图 1.9:1' },
];

/**
 * 计算预设的裁切/缩放参数。
 * cover：居中裁切到目标比例后缩放到目标尺寸（不留边）。
 * contain：等比缩放到最大内接矩形，剩余空间用透明/白色补齐。
 * @param {number} srcW 源宽（已应用旋转/翻转后）
 * @param {number} srcH 源高
 * @returns {{crop:{x,y,w,h}|null, resize:{width,height,enabled}}}
 */
export function presetGeometry(srcW, srcH, preset, padColor = 'transparent') {
  const tRatio = preset.w / preset.h;
  const sRatio = srcW / srcH;
  if (preset.fit === 'cover') {
    let crop = null;
    if (Math.abs(sRatio - tRatio) > 0.001) {
      if (sRatio > tRatio) {
        // 源更宽 → 裁掉左右（返回归一化 0-1 坐标，processImageData 按此解释）
        const cw = srcH * tRatio;
        const cropW = Math.round(cw);
        crop = { x: (srcW - cropW) / 2 / srcW, y: 0, w: cropW / srcW, h: 1 };
      } else {
        // 源更高 → 裁掉上下
        const ch = srcW / tRatio;
        const cropH = Math.round(ch);
        crop = { x: 0, y: (srcH - cropH) / 2 / srcH, w: 1, h: cropH / srcH };
      }
    }
    return {
      crop,
      resize: { enabled: true, width: preset.w, height: preset.h },
      aspect: 'fill',
    };
  }
  // contain：直接缩放到最大内接，pad 在管线外处理
  const scale = Math.min(preset.w / srcW, preset.h / srcH);
  const rw = Math.max(1, Math.round(srcW * scale));
  const rh = Math.max(1, Math.round(srcH * scale));
  return {
    crop: null,
    resize: { enabled: true, width: rw, height: rh },
    pad: { w: preset.w, h: preset.h, color: padColor },
    aspect: 'contain',
  };
}

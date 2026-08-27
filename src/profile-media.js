/** 个人资料 inline 媒体：大 data URL 改走独立 GET，避免 JSON 膨胀 */

export const INLINE_PROFILE_MEDIA_MAX = 8192;

export function profileMediaUrlForApi(url, username, kind) {
    if (!url || typeof url !== "string") return url || "";
    if (url.startsWith("data:") && url.length > INLINE_PROFILE_MEDIA_MAX) {
        return `/api/yonder/${encodeURIComponent(username)}/${kind}`;
    }
    return url;
}

export function profileForApi(profile) {
    const username = profile?.username || "";
    return {
        ...profile,
        avatar_url: profileMediaUrlForApi(profile.avatar_url, username, "avatar"),
        background_url: profileMediaUrlForApi(profile.background_url, username, "background")
    };
}

export function dataUrlToResponse(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
        return null;
    }
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const payload = dataUrl.slice(comma + 1);
    const mimeMatch = header.match(/^data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    try {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Response(bytes, {
            headers: {
                "Content-Type": mime,
                "Cache-Control": "public, max-age=86400"
            }
        });
    } catch {
        return null;
    }
}

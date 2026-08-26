/**
 * 作品/用户二进制：R2 本体 + D1 file_objects 元数据。
 * 旧数据仍可通过 images + image_chunks 读取（GET 回退）。
 */

const MIME_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/ogg": "ogg",
};

export function mimeToExt(mime) {
    return MIME_EXT[mime] || "bin";
}

export function categoryFromMime(mime) {
    if (!mime) return "other";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "other";
}

export function r2KeyForUpload(ownerId, fileId, mime) {
    const safeOwner = String(ownerId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    return `u/${safeOwner}/a/${fileId}.${mimeToExt(mime)}`;
}

export function assetsBucket(env) {
    return env.ASSETS_BUCKET || env.HUB_BUCKET || null;
}

export async function getFileObject(env, fileId) {
    try {
        return await env.DB.prepare(
            `SELECT id, owner_id, r2_key, content_type, byte_size
             FROM file_objects WHERE id = ? LIMIT 1`
        ).bind(fileId).first();
    } catch {
        return null;
    }
}

/** 从 R2 流式返回；无对象时返回 null（由调用方走 D1 chunk 回退）。 */
export async function serveFromR2(env, fileId, request) {
    const bucket = assetsBucket(env);
    if (!bucket) return null;

    const meta = await getFileObject(env, fileId);
    if (!meta?.r2_key) return null;

    const obj = await bucket.get(meta.r2_key, { range: request.headers });
    if (!obj) return null;

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=86400");
    headers.set("Accept-Ranges", "bytes");
    if (!headers.get("Content-Type")) {
        headers.set("Content-Type", meta.content_type || "application/octet-stream");
    }
    if (obj.httpEtag) headers.set("ETag", obj.httpEtag);

    let status = 200;
    if (obj.range) {
        status = 206;
        const offset = obj.range.offset ?? 0;
        const length = obj.range.length ?? Math.max(0, (obj.size || 0) - offset);
        const end = offset + length - 1;
        headers.set("Content-Range", `bytes ${offset}-${end}/${obj.size}`);
        headers.set("Content-Length", String(length));
    }

    return new Response(obj.body, { status, headers });
}

/**
 * 双写：R2 + file_objects。成功则不再写 image_chunks。
 * @returns {{ storedR2: boolean }}
 */
export async function storeUploadBytes(env, { fileId, ownerId, mime, bytes, scope, scopeId }) {
    const bucket = assetsBucket(env);
    if (!bucket) return { storedR2: false };

    const r2Key = r2KeyForUpload(ownerId, fileId, mime);
    await bucket.put(r2Key, bytes, {
        httpMetadata: { contentType: mime || "application/octet-stream" },
    });

    try {
        await env.DB.prepare(
            `INSERT INTO file_objects
             (id, owner_id, r2_key, content_type, byte_size, scope, scope_id, category, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
            fileId,
            String(ownerId),
            r2Key,
            mime,
            bytes.byteLength,
            scope || "upload",
            scopeId || null,
            categoryFromMime(mime)
        ).run();
        return { storedR2: true };
    } catch (err) {
        console.error("file_objects insert failed (run migrate_file_objects.sql):", err);
        try {
            await bucket.delete(r2Key);
        } catch {
            /* ignore */
        }
        return { storedR2: false };
    }
}

/** Uint8Array → base64（分块，避免栈溢出） */
export function bytesToBase64(bytes) {
    let binaryStr = "";
    for (let i = 0; i < bytes.length; i += 32768) {
        binaryStr += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return btoa(binaryStr);
}

export async function storeD1Chunks(env, fileId, mime, byteSize, base64) {
    await env.DB.prepare(
        "INSERT INTO images (id, content_type, total_size, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)"
    ).bind(fileId, mime, byteSize).run();

    const chunkLen = 400000;
    const chunkCount = Math.ceil(base64.length / chunkLen);
    for (let i = 0; i < chunkCount; i++) {
        const chunkData = base64.substring(i * chunkLen, (i + 1) * chunkLen);
        await env.DB.prepare(
            "INSERT INTO image_chunks (image_id, chunk_index, data) VALUES (?, ?, ?)"
        ).bind(fileId, i, chunkData).run();
    }
}

/**
 * 把仍只在 D1 chunks 的旧图搬到 R2（跳过已有 file_objects 的）。
 * @returns {{ migrated: string[], skipped: number, errors: { id: string, error: string }[] }}
 */
export async function backfillChunksToR2(env, { limit = 20, ownerId = "legacy" } = {}) {
    const bucket = assetsBucket(env);
    if (!bucket) {
        throw new Error("ASSETS_BUCKET 未绑定");
    }

    const rows = await env.DB.prepare(
        `SELECT i.id, i.content_type, i.total_size
         FROM images i
         LEFT JOIN file_objects f ON f.id = i.id
         WHERE f.id IS NULL
         ORDER BY i.created_at ASC
         LIMIT ?`
    ).bind(Math.max(1, Math.min(100, Number(limit) || 20))).all();

    const list = rows.results || [];
    const migrated = [];
    const errors = [];
    let skipped = 0;

    for (const row of list) {
        try {
            const chunks = await env.DB.prepare(
                "SELECT data FROM image_chunks WHERE image_id = ? ORDER BY chunk_index ASC"
            ).bind(row.id).all();
            const base64 = (chunks.results || []).map((c) => c.data).join("");
            if (!base64) {
                skipped += 1;
                continue;
            }
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            const r2Key = r2KeyForUpload(ownerId, row.id, row.content_type);
            await bucket.put(r2Key, bytes, {
                httpMetadata: { contentType: row.content_type || "application/octet-stream" },
            });
            await env.DB.prepare(
                `INSERT INTO file_objects
                 (id, owner_id, r2_key, content_type, byte_size, scope, scope_id, category, created_at)
                 VALUES (?, ?, ?, ?, ?, 'legacy', NULL, ?, CURRENT_TIMESTAMP)`
            ).bind(
                row.id,
                String(ownerId),
                r2Key,
                row.content_type,
                bytes.byteLength,
                categoryFromMime(row.content_type)
            ).run();
            migrated.push(row.id);
        } catch (err) {
            errors.push({ id: row.id, error: String(err && err.message ? err.message : err) });
        }
    }

    return { migrated, skipped, errors, remainingHint: list.length >= limit };
}

/** 列出当前用户的云端素材（file_objects / R2） */
export async function listUserVault(env, ownerId, { category, limit = 100 } = {}) {
    let sql = `SELECT id, content_type, byte_size, category, created_at
                 FROM file_objects WHERE owner_id = ?`;
    const binds = [String(ownerId)];
    if (category && category !== "all") {
        sql += " AND category = ?";
        binds.push(String(category));
    }
    sql += " ORDER BY datetime(created_at) DESC LIMIT ?";
    binds.push(Math.max(1, Math.min(200, Number(limit) || 100)));
    const rows = await env.DB.prepare(sql).bind(...binds).all();
    return (rows.results || []).map((row) => {
        const cat = categoryFromMime(row.content_type);
        return {
            id: row.id,
            url: `/img/${row.id}`,
            type: cat === "audio" ? "audio" : cat === "video" ? "video" : "image",
            contentType: row.content_type,
            byteSize: row.byte_size,
            category: row.category || cat,
            createdAt: row.created_at,
        };
    });
}

/** 删除用户自己的云端素材（R2 + 元数据；已挂在作品里的 URL 不会自动改） */
export async function deleteUserFileObject(env, ownerId, fileId) {
    const meta = await getFileObject(env, fileId);
    if (!meta || String(meta.owner_id) !== String(ownerId)) {
        return { ok: false, error: "not_found" };
    }
    const bucket = assetsBucket(env);
    if (bucket && meta.r2_key) {
        try {
            await bucket.delete(meta.r2_key);
        } catch (err) {
            console.error("R2 delete failed:", err);
        }
    }
    await env.DB.prepare("DELETE FROM file_objects WHERE id = ? AND owner_id = ?")
        .bind(fileId, String(ownerId)).run();
    try {
        await env.DB.prepare("DELETE FROM image_chunks WHERE image_id = ?").bind(fileId).run();
        await env.DB.prepare("DELETE FROM images WHERE id = ?").bind(fileId).run();
    } catch {
        /* ignore */
    }
    return { ok: true };
}

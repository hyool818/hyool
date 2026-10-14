#!/usr/bin/env node
/**
 * TA 自建 TTS 网关：http://127.0.0.1:9881/tts  ->  GPT-SoVITS api_v2.py（:9880）
 *
 * 为什么要有它：官方 api_v2.py **没有任何鉴权参数**（只有 -a / -p / -c），
 * 直接开公网隧道 = 把 GPU 白送给任何拿到地址的人。本网关只做三件事：
 *   1) 校验 `Authorization: Bearer <TA_TTS_PROXY_TOKEN>`（常量时间比较）
 *   2) 只放行 `POST /tts`（其余 404 / 405）；请求体上限 64 KiB
 *   3) 转发到本机 9880 并把音频流原样回传；日志只记状态/耗时/大小（不记文本、不记 token）
 *
 * 启动：powershell -ExecutionPolicy Bypass -File .\scripts\start-ta-tts-proxy.ps1
 * 隧道：cloudflared tunnel --url http://127.0.0.1:9881   （隧道指向**本网关**，不是 9880）
 */
import http from 'node:http';
import crypto from 'node:crypto';

const LISTEN_HOST = process.env.TA_TTS_PROXY_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.TA_TTS_PROXY_PORT || 9881);
const TARGET = new URL(process.env.TA_TTS_PROXY_TARGET || 'http://127.0.0.1:9880');
const TOKEN = String(process.env.TA_TTS_PROXY_TOKEN || '').trim();
const MAX_BODY = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;

if (!TOKEN) {
    console.error('[ta-tts] missing TA_TTS_PROXY_TOKEN (scripts/start-ta-tts-proxy.ps1 generates one)');
    process.exit(1);
}

const TOKEN_BUF = Buffer.from(TOKEN);

function sameToken(given) {
    if (typeof given !== 'string' || !given) return false;
    const buf = Buffer.from(given);
    return buf.length === TOKEN_BUF.length && crypto.timingSafeEqual(buf, TOKEN_BUF);
}

function bearerOf(req) {
    const raw = String(req.headers.authorization || '').trim();
    const m = /^Bearer\s+(\S+)$/i.exec(raw);
    return m ? m[1] : '';
}

function send(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.length)
    });
    res.end(body);
}

function proxyTts(req, res) {
    const started = Date.now();
    const chunks = [];
    let size = 0;
    let rejected = false;

    req.on('data', (chunk) => {
        if (rejected) return;
        size += chunk.length;
        if (size > MAX_BODY) {
            rejected = true;
            send(res, 413, { success: false, error: 'body too large' });
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });

    req.on('error', () => {
        if (!rejected) send(res, 400, { success: false, error: 'request stream error' });
    });

    req.on('end', () => {
        if (rejected) return;
        const body = Buffer.concat(chunks);
        const upstream = http.request({
            protocol: TARGET.protocol,
            hostname: TARGET.hostname,
            port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
            path: '/tts',
            method: 'POST',
            headers: {
                Host: TARGET.host,
                'Content-Type': 'application/json',
                'Content-Length': String(body.length)
            }
        }, (up) => {
            const status = up.statusCode || 502;
            res.writeHead(status, {
                'Content-Type': up.headers['content-type'] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            up.pipe(res);
            up.on('end', () => {
                console.log('[ta-tts] ' + status + ' ' + ((Date.now() - started) / 1000).toFixed(2) + 's ' +
                    (status === 200 ? Math.round(Number(up.headers['content-length'] || 0) / 1024) + 'KB' : 'json'));
            });
        });

        upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy(new Error('upstream timeout')));
        upstream.on('error', () => {
            console.error('[ta-tts] 502 upstream unreachable: ' + TARGET.origin);
            send(res, 502, { success: false, error: 'Cannot reach GPT-SoVITS at ' + TARGET.origin });
        });
        upstream.end(body);
    });
}

const server = http.createServer((req, res) => {
    const path = String(req.url || '').split('?')[0];

    if (req.method === 'GET' && path === '/healthz') {
        return send(res, 200, { ok: true, target: TARGET.origin });
    }
    if (path !== '/tts') {
        return send(res, 404, { success: false, error: 'not found' });
    }
    if (req.method !== 'POST') {
        return send(res, 405, { success: false, error: 'method not allowed' });
    }
    if (!sameToken(bearerOf(req))) {
        console.warn('[ta-tts] 401 unauthorized from ' + (req.socket.remoteAddress || '?'));
        return send(res, 401, { success: false, error: 'unauthorized' });
    }
    proxyTts(req, res);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.log('[ta-tts] http://' + LISTEN_HOST + ':' + LISTEN_PORT + '/tts  ->  ' + TARGET.origin + '/tts  (Bearer guarded)');
    console.log('[ta-tts] tunnel must point at this gateway: cloudflared tunnel --url http://' + LISTEN_HOST + ':' + LISTEN_PORT);
});

#!/usr/bin/env node
/**
 * HYOOL Comfy HTTPS bridge: https://127.0.0.1:8443 -> Comfy (:8188 / :8000)
 * Strips browser Origin/Referer so Comfy Desktop does not return 403 on cross-origin.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(__dirname, 'comfy-bridge-certs');
const LISTEN_HOST = process.env.HYOOL_BRIDGE_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.HYOOL_BRIDGE_PORT || 8443);
const TARGET = new URL(process.env.HYOOL_COMFY_TARGET || 'http://127.0.0.1:8188');

const certFile = path.join(CERT_DIR, '127.0.0.1+1.pem');
const keyFile = path.join(CERT_DIR, '127.0.0.1+1-key.pem');

if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
  console.error('[hyool-bridge] missing certs: ' + CERT_DIR);
  console.error('Run: powershell -File .\\scripts\\start-comfy-bridge.ps1');
  process.exit(1);
}

const DROP_HEADERS = new Set([
  'host',
  'connection',
  'origin',
  'referer',
  'referrer',
  'cookie',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform'
]);

function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Expose-Headers': '*',
    Vary: 'Origin'
  };
}

function buildUpstreamHeaders(req) {
  const headers = { host: TARGET.host };
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const k = String(key).toLowerCase();
    if (DROP_HEADERS.has(k)) continue;
    if (k.startsWith('sec-')) continue;
    headers[k] = value;
  }
  return headers;
}

function proxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const opts = {
    protocol: TARGET.protocol,
    hostname: TARGET.hostname,
    port: TARGET.port || (TARGET.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: buildUpstreamHeaders(req)
  };

  const upstream = http.request(opts, (up) => {
    const outHeaders = { ...up.headers, ...corsHeaders(req) };
    res.writeHead(up.statusCode || 502, outHeaders);
    up.pipe(res);
  });

  upstream.on('error', (err) => {
    const body = JSON.stringify({
      success: false,
      error: 'Cannot reach ComfyUI at ' + TARGET.origin + ': ' + (err.message || err)
    });
    res.writeHead(502, {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(req)
    });
    res.end(body);
  });

  req.pipe(upstream);
}

const server = https.createServer(
  {
    cert: fs.readFileSync(certFile),
    key: fs.readFileSync(keyFile)
  },
  proxy
);

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log('[hyool-bridge] https://' + LISTEN_HOST + ':' + LISTEN_PORT + '  ->  ' + TARGET.origin);
  console.log('[hyool-bridge] Keep this window open. In HYOOL pick local ComfyUI.');
});

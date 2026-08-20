'use strict';
// Zero-dependency CDP driver (Node >= 22 native WebSocket).
// Usage: node cdp-driver.js <page-url> <out-file>
//   env CDP_PORT = debugging port of a running Chrome instance.
const fs = require('fs');

const port = process.env.CDP_PORT;
const url = process.argv[2];
const outFile = process.argv[3];
const base = `http://127.0.0.1:${port}`;

const logs = [];
let resultsText = '';
let title = '';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + what + ' after ' + ms + 'ms')), ms)),
  ]);
}

async function run() {
  log('creating target for', url);
  let res;
  try {
    res = await withTimeout(fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }), 5000, 'json/new PUT');
  } catch (e) {
    log('PUT failed:', e.message, 'retrying GET');
    res = await withTimeout(fetch(`${base}/json/new?${encodeURIComponent(url)}`), 5000, 'json/new GET');
  }
  if (!res.ok) throw new Error('json/new failed: ' + res.status);
  const target = await res.json();
  log('target ws url:', target.webSocketDebuggerUrl);

  const ws = new WebSocket(target.webSocketDebuggerUrl);

  let id = 0;
  const pending = new Map();
  const send = (method, params) => withTimeout(new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  }), 8000, method);

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
      return;
    }
    switch (msg.method) {
      case 'Runtime.exceptionThrown': {
        const d = msg.params.exceptionDetails;
        const exc = d.exception;
        logs.push('EXCEPTION: ' + (exc ? (exc.description || exc.value) : d.text));
        break;
      }
      case 'Runtime.consoleAPICalled':
        if (msg.params.type === 'error') {
          logs.push('CONSOLE ERROR: ' + msg.params.args.map(a => a.value || a.description || '').join(' '));
        }
        break;
      case 'Log.entryAdded':
        if (msg.params.entry.level === 'error') {
          logs.push('LOG ERROR: ' + msg.params.entry.text);
        }
        break;
      case 'Network.loadingFailed': {
        const f = msg.params;
        logs.push(`NET FAIL: ${f.requestId} ${f.errorText}`);
        break;
      }
      case 'Network.responseReceived': {
        const r = msg.params.response;
        if (r.status >= 400) logs.push(`NET HTTP ${r.status}: ${r.url}`);
        break;
      }
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error('WS error: ' + (e.message || 'unknown')));
    ws.onclose = () => reject(new Error('WS closed before open'));
  });
  log('ws opened');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  log('domains enabled, navigating');
  await send('Page.navigate', { url });
  log('navigated');

  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    try {
      const t = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      title = (t.result && t.result.value) || '';
      const txt = await send('Runtime.evaluate', {
        expression: 'document.getElementById("results") ? document.getElementById("results").textContent : "(no results el)"',
        returnByValue: true,
      });
      resultsText = (txt.result && txt.result.value) || '';
    } catch (e) {
      if (!String(e.message).startsWith('TIMEOUT')) { /* mid-navigation context loss */ }
    }
    if (title === 'SMOKE-OK' || title === 'SMOKE-FAIL') break;
    if (Date.now() % 4000 < 700) log('waiting... title=' + JSON.stringify(title) + ' lines=' + resultsText.split('\n').length);
  }

  const out = [
    'TITLE: ' + title,
    '',
    resultsText,
    '',
    '--- console/errors ---',
    logs.length ? logs.join('\n') : '(none)',
  ].join('\n');
  log('writing output');
  fs.writeFileSync(outFile, out, 'utf8');
  process.exitCode = (title === 'SMOKE-OK') ? 0 : 1;
  log('done, exitCode=' + process.exitCode);
}

run().catch((e) => { console.error(new Date().toISOString().slice(11, 19), 'FATAL', e); process.exitCode = 3; });


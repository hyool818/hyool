// check-inline-html.js — 抽取 HTML 内联 <script>（无 src 的块）写入临时 js 并 node --check
// 用法: node check-inline-html.js [file.html ...]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const targets = process.argv.slice(2);
if (!targets.length) {
  console.log('usage: node check-inline-html.js <html...>');
  process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyool-inline-'));
let failed = false;

for (const file of targets) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, idx = 0, ok = true;
  while ((m = re.exec(html))) {
    idx++;
    const body = m[1];
    if (!body.trim()) continue;
    const tmp = path.join(tmpDir, path.basename(file) + '.' + idx + '.js');
    fs.writeFileSync(tmp, body, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      ok = false;
      console.error('SYNTAX FAIL: ' + file + ' inline#' + idx);
      console.error(String(e.stderr || e.message));
    }
  }
  if (ok) console.log('OK: ' + file + ' (' + idx + ' inline script(s))');
  else failed = true;
}

fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);

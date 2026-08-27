import fs from 'fs';
const h = fs.readFileSync('public/hub.html', 'utf8');
const start = h.indexOf('<!-- 自定义世界向导 -->');
const toastStart = h.indexOf('<div id="toast">');
const toastEnd = h.indexOf('</div>', toastStart) + 6;
fs.writeFileSync('public/profile-hub-modals.html', h.slice(start, toastEnd), 'utf8');
console.log('modals', fs.statSync('public/profile-hub-modals.html').size);

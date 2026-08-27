import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.join('public', 'hub.html'), 'utf8');
const start = html.indexOf('<script>') + 8;
const end = html.lastIndexOf('</script>');
let js = html.slice(start, end);

js = js.replace(/\/\* Tabs \*\/[\s\S]*?\/\* ---------- 角色区 ---------- \*\//, '/* ---------- 角色区 ---------- */');
js = js.replace(/function renderChars[\s\S]*?^function pricingBadgeHtml/m, 'function pricingBadgeHtml');
js = js.replace(/\/\* ---------- 世界区 ---------- \*\/\nfunction renderWorlds[\s\S]*?^function openWorldDetail/m, 'function openWorldDetail');
js = js.replace(/renderChars\(allChars, false\)/g, 'bridge.onCharsChanged()');
js = js.replace(/renderWorlds\(allWorlds\)/g, 'bridge.onWorldsChanged()');
js = js.replace(/switchTab\("world"\);\s*\n\s*toast/g, 'toast');
js = js.replace(/\/\* ---------- 初始化 ---------- \*\/[\s\S]*$/, '');
js = js.replace(/function openWizard\(\)[\s\S]*?^}/m, '');
js = js.replace(/document\.addEventListener\("click", e => \{[\s\S]*?toggleCreateMenu\(false\);\s*\}\);[\s\S]*$/m, '');

const header = `/** Profile hub UI — world wizard, char edit, world detail (yonder-home) */
let bridge = { getChars: () => [], getWorlds: () => [], onCharsChanged: () => {}, onWorldsChanged: () => {} };
function syncChars() { allChars = bridge.getChars() || []; }
function syncWorlds() { allWorlds = bridge.getWorlds() || []; }
`;

const footer = `
function openCharEdit(id) {
  syncChars();
  const idx = allChars.findIndex(c => c.id === id);
  if (idx >= 0) openEdit(idx);
}
function openWorldDetailById(id) {
  syncWorlds();
  const idx = allWorlds.findIndex(w => w.id === id);
  if (idx >= 0) openWorldDetail(idx);
}
function openWizardModal() {
  syncChars();
  wizardInit();
  showModal('wizardModal', true);
}
function handleProfileHubQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('create') === 'world') openWizardModal();
  const wid = q.get('world');
  if (wid) openWorldDetailById(wid);
}
window.ProfileHubUI = {
  init(cfg) {
    bridge = { ...bridge, ...cfg };
    syncChars();
    syncWorlds();
    import('/image-provider.js').then(m => {
      const el = document.getElementById('imgGenSettings');
      if (el) m.mountImageGenSettings(el);
    }).catch(() => {});
    window.wizardRegenCover = wizardRegenCover;
    window.pickGenre = pickGenre;
    window.pickForm = pickForm;
    window.pickLifeMode = pickLifeMode;
    window.pickLifeModel = pickLifeModel;
    window.toggleCast = toggleCast;
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('wizardPrev', wizardPrev);
    bind('wizardNext', wizardNext);
    bind('wCastPick', openCastPick);
    bind('castPickCancel', () => showModal('castPickModal', false));
    bind('castPickConfirm', confirmCastPick);
    bind('wizardUploadCover', () => document.getElementById('wizardCoverFile').click());
    const wcf = document.getElementById('wizardCoverFile');
    if (wcf) wcf.addEventListener('change', e => { wizardUploadCover(e.target.files[0]); e.target.value = ''; });
    bind('editCancel', closeEdit);
    bind('editSave', saveEdit);
    const ep = document.getElementById('editPricing');
    if (ep) ep.addEventListener('change', () => { document.getElementById('editPrice').style.display = ep.value === 'paid' ? '' : 'none'; });
    const dp = document.getElementById('detailPricing');
    if (dp) dp.addEventListener('change', () => { document.getElementById('detailPrice').style.display = dp.value === 'paid' ? '' : 'none'; });
    bind('detailPricingSave', saveWorldPricing);
    bind('deleteCancel', closeDelete);
    bind('deleteConfirm', confirmDelete);
    ['editModal', 'deleteModal', 'wizardModal', 'worldDetailModal', 'castPickModal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', e => { if (e.target.id === id) showModal(id, false); });
    });
    handleProfileHubQuery();
  },
  openWizard: openWizardModal,
  openCharEdit,
  openWorldDetail: openWorldDetailById,
};
`;

fs.writeFileSync(path.join('public', 'profile-hub-ui.js'), header + js + footer, 'utf8');
console.log('OK', fs.statSync(path.join('public', 'profile-hub-ui.js')).size);

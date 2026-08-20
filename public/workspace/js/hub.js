// hub.js — 无限世界 · 工具总览：入口首页与编辑器视图切换
import { toast } from './ui.js';

const hubView = document.getElementById('hubView');
const editorView = document.getElementById('editorView');

function showHub() {
  hubView.classList.remove('hidden');
  editorView.classList.add('hidden');
}

function enterTool(tab) {
  hubView.classList.add('hidden');
  editorView.classList.remove('hidden');
  if (tab && window.enterWorkspaceTab) window.enterWorkspaceTab(tab);
}

document.querySelectorAll('.tool-cta').forEach((btn) => {
  btn.addEventListener('click', () => {
    const go = btn.dataset.go;
    if (go === 'editor') enterTool();
    else if (go === 'ai') enterTool('ai');
    else if (go === 'presets') enterTool('presets');
    else if (go === 'soon') toast('该板块正在生长中，敬请期待', true);
  });
});

const backBtn = document.getElementById('backToHubBtn');
if (backBtn) backBtn.addEventListener('click', (e) => { e.preventDefault(); showHub(); });

// 支持 ?tool=editor|ai|presets 直达对应工具
const q = new URLSearchParams(location.search).get('tool');
if (q === 'editor') enterTool();
else if (q === 'ai') enterTool('ai');
else if (q === 'presets') enterTool('presets');
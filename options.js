const FREE_LIMIT = 5;
const extpay = ExtPay('prompt-snippets');

const state = {
  snippets: [],
  isPaid: false,
  search: '',
  editingId: null,
  pendingDelete: null
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  bindEvents();
  render();
  refreshPaidStatus();
  handleHash();
}

async function loadData() {
  const data = await chrome.storage.local.get(['snippets', 'isPaid']);
  state.snippets = Array.isArray(data.snippets) ? data.snippets : [];
  state.isPaid = data.isPaid || false;
}

async function refreshPaidStatus() {
  try {
    const user = await extpay.getUser();
    if (user.paid && !state.isPaid) {
      state.isPaid = true;
      await chrome.storage.local.set({ isPaid: true });
      render();
    }
  } catch (_) {}
}

async function saveSnippets() {
  await chrome.storage.local.set({ snippets: state.snippets });
}

function handleHash() {
  const m = location.hash.match(/edit=([^&]+)/);
  if (m) {
    const id = m[1];
    if (state.snippets.find(s => s.id === id)) {
      openEditor(id);
    }
  }
}

function render() {
  renderList();
  renderQuota();
  renderCatOptions();
}

function renderList() {
  const list = $('#snippet-list');
  const filtered = state.snippets.filter(s => {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q);
  });

  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">${
      state.snippets.length === 0 ? 'No snippets yet. Click <b>+ New Snippet</b>.' : 'No matches.'
    }</div>`;
    return;
  }

  for (const s of filtered) {
    const row = document.createElement('div');
    row.className = 'snip-row' + (s.id === state.editingId ? ' active' : '');
    row.dataset.id = s.id;
    row.innerHTML = `
      <div class="snip-row-name">${esc(s.name)}</div>
      <div class="snip-row-meta">
        ${s.category ? `<span>${esc(s.category)}</span>` : ''}
        <span>${countVars(s.content)} vars</span>
      </div>`;
    row.addEventListener('click', () => openEditor(s.id));
    list.appendChild(row);
  }
}

function renderQuota() {
  const q = $('#quota');
  if (state.isPaid) {
    q.innerHTML = `<span class="pro">Pro</span> · ${state.snippets.length} snippets`;
  } else {
    const cls = state.snippets.length >= FREE_LIMIT ? 'warn' : '';
    q.innerHTML = `<span class="${cls}">${state.snippets.length}/${FREE_LIMIT}</span> Free`;
  }
}

function renderCatOptions() {
  const dl = $('#cat-options');
  const cats = [...new Set(state.snippets.map(s => s.category).filter(Boolean))];
  dl.innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
}

function bindEvents() {
  $('#btn-add').addEventListener('click', () => {
    if (!state.isPaid && state.snippets.length >= FREE_LIMIT) {
      openUpgrade('You\'ve hit the Free 5-snippet limit.');
      return;
    }
    openEditor(null);
  });

  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderList();
  });

  $('#edit-form').addEventListener('submit', onSubmit);
  $('#btn-cancel').addEventListener('click', () => closeEditor());
  $('#btn-delete').addEventListener('click', onDeleteClick);

  for (const btn of $$('.var-btn')) {
    btn.addEventListener('click', () => insertVarToken(btn.dataset.var));
  }

  $('#btn-import').addEventListener('click', () => {
    if (!state.isPaid) {
      openUpgrade('Import / Export is a Pro feature.');
      return;
    }
    $('#file-import').click();
  });
  $('#file-import').addEventListener('change', onImportFile);

  // Export は Free でも開放（vendor lock-in 不安解消）
  $('#btn-export').addEventListener('click', () => {
    exportJSON();
  });

  $('#btn-upgrade').addEventListener('click', () => extpay.openPaymentPage());
  $('#btn-upgrade-close').addEventListener('click', closeUpgrade);

  $('#btn-confirm-ok').addEventListener('click', confirmDelete);
  $('#btn-confirm-cancel').addEventListener('click', closeConfirm);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#confirm-modal').classList.contains('hidden')) closeConfirm();
      else if (!$('#upgrade-modal').classList.contains('hidden')) closeUpgrade();
    }
  });

  extpay.onPaid.addListener(() => {
    state.isPaid = true;
    chrome.storage.local.set({ isPaid: true });
    closeUpgrade();
    render();
  });
}

function openEditor(id) {
  state.editingId = id;
  const snip = id ? state.snippets.find(s => s.id === id) : null;

  $('#edit-empty').classList.add('hidden');
  $('#edit-form').classList.remove('hidden');
  $('#f-name').value = snip ? snip.name : '';
  $('#f-category').value = snip ? (snip.category || '') : '';
  $('#f-content').value = snip ? snip.content : '';
  $('#btn-delete').style.visibility = snip ? 'visible' : 'hidden';

  renderList();
  setTimeout(() => $('#f-name').focus(), 30);
}

function closeEditor() {
  state.editingId = null;
  $('#edit-form').classList.add('hidden');
  $('#edit-empty').classList.remove('hidden');
  renderList();
}

async function onSubmit(e) {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  const category = $('#f-category').value.trim();
  const content = $('#f-content').value.trim();

  if (!name || !content) return;

  // Free 制限
  if (!state.isPaid && state.snippets.length >= FREE_LIMIT && !state.editingId) {
    openUpgrade('You\'ve hit the Free 5-snippet limit.');
    return;
  }

  const now = Date.now();
  if (state.editingId) {
    const idx = state.snippets.findIndex(s => s.id === state.editingId);
    if (idx >= 0) {
      state.snippets[idx] = {
        ...state.snippets[idx],
        name, category, content, updatedAt: now
      };
    }
  } else {
    const newSnip = {
      id: 's' + now,
      name, category, content,
      createdAt: now,
      updatedAt: now
    };
    state.snippets.push(newSnip);
    state.editingId = newSnip.id;
  }

  await saveSnippets();
  render();
}

function onDeleteClick() {
  if (!state.editingId) return;
  const snip = state.snippets.find(s => s.id === state.editingId);
  if (!snip) return;
  state.pendingDelete = snip.id;
  $('#confirm-msg').textContent = `Delete "${snip.name}"?`;
  $('#confirm-modal').classList.remove('hidden');
}

async function confirmDelete() {
  if (!state.pendingDelete) return;
  state.snippets = state.snippets.filter(s => s.id !== state.pendingDelete);
  state.pendingDelete = null;
  await saveSnippets();
  closeConfirm();
  closeEditor();
  render();
}

function closeConfirm() {
  state.pendingDelete = null;
  $('#confirm-modal').classList.add('hidden');
}

function insertVarToken(token) {
  const ta = $('#f-content');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  ta.value = val.slice(0, start) + token + val.slice(end);
  ta.focus();
  const pos = start + token.length;
  ta.setSelectionRange(pos, pos);
}

function exportJSON() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    snippets: state.snippets
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prompt-snippets-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = parseImport(data);
    if (incoming.length === 0) {
      alert('No valid snippets found in this file.');
      return;
    }
    const existingIds = new Set(state.snippets.map(s => s.id));
    const before = state.snippets.length;
    for (const s of incoming) {
      if (!existingIds.has(s.id)) state.snippets.push(s);
    }
    try {
      await saveSnippets();
    } catch (saveErr) {
      // chrome.storage.local の容量超過などをロールバック
      state.snippets = state.snippets.slice(0, before);
      alert('Could not save: storage limit exceeded. Try importing fewer snippets.');
      return;
    }
    render();
    alert(`Imported ${state.snippets.length - before} snippets.`);
  } catch (err) {
    alert('Could not parse this file. Expected JSON exported from Prompt Snippets.');
  }
}

function parseImport(data) {
  // 自分のJSON形式のみサポート（v1.0）
  if (Array.isArray(data?.snippets)) {
    return data.snippets
      .filter(s => s && typeof s.name === 'string' && typeof s.content === 'string')
      .map(s => normalize(s));
  }
  return [];
}

function normalize(s) {
  return {
    id: s.id || ('s' + Date.now() + Math.random().toString(36).slice(2, 6)),
    name: String(s.name).slice(0, 60),
    category: s.category ? String(s.category).slice(0, 30) : '',
    content: String(s.content),
    createdAt: s.createdAt || Date.now(),
    updatedAt: s.updatedAt || Date.now()
  };
}

function countVars(text) {
  const matches = text.match(/\{(\w+)\}/g) || [];
  return new Set(matches).size;
}

function openUpgrade(msg) {
  if (msg) $('#upgrade-msg').textContent = msg;
  $('#upgrade-modal').classList.remove('hidden');
}
function closeUpgrade() {
  $('#upgrade-modal').classList.add('hidden');
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

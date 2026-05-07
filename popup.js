const FREE_LIMIT = 5;
const extpay = ExtPay('prompt-snippets');

const state = {
  snippets: [],
  isPaid: false,
  search: '',
  category: 'All'
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  render();
  bindEvents();
  refreshPaidStatus();

  setTimeout(() => $('#search')?.focus(), 50);
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

function render() {
  renderCategories();
  renderList();
  renderQuota();
}

function renderCategories() {
  const bar = $('#cat-bar');
  const allCats = [...new Set(state.snippets.map(s => s.category || 'Uncategorized').filter(c => c !== 'Uncategorized'))];
  // カテゴリが2種類未満なら非表示（縦スペース節約、5件Free前提では大半のユーザはカテゴリ不要）
  if (allCats.length < 2) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const cats = ['All', ...allCats];
  bar.innerHTML = '';
  for (const c of cats) {
    const pill = document.createElement('button');
    pill.className = 'cat-pill' + (c === state.category ? ' active' : '');
    pill.textContent = c;
    pill.addEventListener('click', () => {
      state.category = c;
      render();
    });
    bar.appendChild(pill);
  }
}

function getFiltered() {
  return state.snippets.filter(s => {
    if (state.category !== 'All' && (s.category || 'Uncategorized') !== state.category) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    // 直近使用順 → 未使用は更新日時順
    const al = a.lastUsedAt || 0;
    const bl = b.lastUsedAt || 0;
    if (al !== bl) return bl - al;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function renderList() {
  const list = $('#snippet-list');
  const filtered = getFiltered();

  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">${
      state.snippets.length === 0
        ? 'No snippets yet.<br>Click <b>+ New</b> to create your first.'
        : 'No matches.'
    }</div>`;
    return;
  }

  for (const s of filtered) {
    const card = document.createElement('div');
    card.className = 'snip-card';
    card.innerHTML = `
      <div class="snip-card-header">
        <span class="snip-name">${esc(s.name)}</span>
        ${s.category ? `<span class="snip-cat">${esc(s.category)}</span>` : ''}
      </div>
      <div class="snip-preview">${esc(s.content)}</div>
      <div class="snip-actions">
        <button class="btn-edit" data-id="${s.id}">Edit</button>
      </div>`;

    // 行クリックで挿入
    card.addEventListener('click', (e) => {
      if (e.target.closest('.snip-actions')) return;
      insertSnippet(s.id);
    });
    card.querySelector('.btn-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openOptionsForEdit(s.id);
    });

    list.appendChild(card);
  }
}

function renderQuota() {
  const info = $('#quota-info');
  if (state.isPaid) {
    info.innerHTML = `<span class="pro">Pro</span> · ${state.snippets.length} snippets`;
  } else {
    const cls = state.snippets.length >= FREE_LIMIT ? 'warn' : '';
    info.innerHTML = `<span class="${cls}">${state.snippets.length}/${FREE_LIMIT}</span> Free`;
  }
}

function bindEvents() {
  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    renderList();
  });

  // Enter キーで先頭スニペットを即挿入
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const filtered = getFiltered();
      if (filtered.length > 0) insertSnippet(filtered[0].id);
      else showFailBanner('No matching snippets. Adjust search or add a new one.');
    }
  });

  $('#btn-add').addEventListener('click', () => {
    if (!state.isPaid && state.snippets.length >= FREE_LIMIT) {
      openUpgrade('You\'ve hit the Free 5-snippet limit.');
      return;
    }
    chrome.runtime.openOptionsPage();
  });

  $('#btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  $('#btn-upgrade').addEventListener('click', () => {
    extpay.openPaymentPage();
  });

  $('#btn-upgrade-close').addEventListener('click', closeUpgrade);

  extpay.onPaid.addListener(() => {
    state.isPaid = true;
    chrome.storage.local.set({ isPaid: true });
    closeUpgrade();
    render();
  });
}

async function insertSnippet(snippetId) {
  // background に挿入を依頼（scripting.executeScript で activeTab に注入）
  try {
    const res = await chrome.runtime.sendMessage({ type: 'insert-snippet', snippetId });
    if (res?.ok) {
      // 挿入成功 → popupを閉じる（ChatGPT/Claude 画面に戻る）
      window.close();
    } else {
      showFailBanner('Cannot insert here. Open ChatGPT, Claude, Gemini, or Perplexity and click the input field first.');
    }
  } catch (_) {
    showFailBanner('Insertion failed. This page may not support automatic insertion.');
  }
}

function showFailBanner(msg) {
  const banner = $('#fail-banner');
  if (!banner) return;
  banner.textContent = msg;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 4500);
}

function openOptionsForEdit(snippetId) {
  // options.html に編集対象IDをハッシュで渡す
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#edit=${snippetId}`) });
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

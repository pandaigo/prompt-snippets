importScripts('ExtPay.js');
const extpay = ExtPay('prompt-snippets');
extpay.startBackground();

// 課金完了でローカルフラグ更新
extpay.onPaid.addListener(() => {
  chrome.storage.local.set({ isPaid: true });
});

// インストール時・起動時に Pro 状態を再同期（service worker サスペンド対策）
chrome.runtime.onInstalled.addListener(async () => {
  syncPaidStatus();
  // 初回起動時にサンプルテンプレを投入
  const stored = await chrome.storage.local.get('snippets');
  if (!stored.snippets) {
    await chrome.storage.local.set({ snippets: getSampleSnippets() });
  }
  rebuildMenus();
});
chrome.runtime.onStartup?.addListener(syncPaidStatus);

async function syncPaidStatus() {
  try {
    const user = await extpay.getUser();
    if (user.paid) chrome.storage.local.set({ isPaid: true });
  } catch (_) {}
}

// テンプレ更新で右クリックメニューも更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.snippets) rebuildMenus();
});

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();
  const { snippets = [] } = await chrome.storage.local.get('snippets');

  chrome.contextMenus.create({
    id: 'ps-parent',
    title: 'Prompt Snippets',
    contexts: ['editable']
  });

  if (snippets.length === 0) {
    chrome.contextMenus.create({
      id: 'ps-empty',
      parentId: 'ps-parent',
      title: '(No snippets yet)',
      contexts: ['editable'],
      enabled: false
    });
  } else {
    for (const s of snippets.slice(0, 25)) {
      chrome.contextMenus.create({
        id: 'ps-snip-' + s.id,
        parentId: 'ps-parent',
        title: truncate(s.name, 40),
        contexts: ['editable']
      });
    }
  }

  chrome.contextMenus.create({
    id: 'ps-sep',
    parentId: 'ps-parent',
    type: 'separator',
    contexts: ['editable']
  });
  chrome.contextMenus.create({
    id: 'ps-manage',
    parentId: 'ps-parent',
    title: 'Manage Snippets...',
    contexts: ['editable']
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ps-manage') {
    chrome.runtime.openOptionsPage();
    return;
  }
  const id = String(info.menuItemId);
  if (!id.startsWith('ps-snip-')) return;
  const snippetId = id.slice(8);
  await insertSnippetIntoTab(snippetId, tab);
});

// popup からの挿入要求
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'insert-snippet' && msg.snippetId) {
    // lastFocusedWindow を優先（popup自身を誤って拾わない）
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
      const tab = tabs?.[0];
      if (!tab) {
        chrome.tabs.query({ active: true, currentWindow: true }, async (fallback) => {
          const ok = await insertSnippetIntoTab(msg.snippetId, fallback?.[0]);
          sendResponse({ ok });
        });
        return;
      }
      const ok = await insertSnippetIntoTab(msg.snippetId, tab);
      sendResponse({ ok });
    });
    return true; // 非同期応答
  }
});

async function insertSnippetIntoTab(snippetId, tab) {
  if (!tab?.id) return false;

  const stored = await chrome.storage.local.get(['snippets', 'varMemory', 'varRemember', 'isPaid']);
  const snippets = stored.snippets || [];
  const idx = snippets.findIndex(s => s.id === snippetId);
  if (idx < 0) return false;
  const snippet = snippets[idx];

  const text = expandAutoVars(snippet.content);
  const varMemory = stored.varMemory || {};
  const varRemember = stored.varRemember ?? false;
  const isPaid = stored.isPaid || false;

  // 対象タブをアクティブ化（popup閉じた後にフォーカスが入力欄に当たるよう）
  try {
    await chrome.tabs.update(tab.id, { active: true });
  } catch (_) {}

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: insertIntoActiveElement,
      args: [snippetId, text, varMemory, varRemember, isPaid]
    });
    const ret = results?.[0]?.result;
    if (ret?.save) {
      await chrome.storage.local.set({
        varMemory: ret.varMemory,
        varRemember: ret.varRemember
      });
    }
    // 挿入成功（クリップボードフォールバック含む）なら lastUsedAt 更新
    if (ret?.ok || ret?.copiedToClipboard) {
      const updated = [...snippets];
      updated[idx] = { ...snippet, lastUsedAt: Date.now() };
      await chrome.storage.local.set({ snippets: updated });
    }
    return ret?.ok !== false;
  } catch (_) {
    // chrome:// 等のページではスクリプト実行不可
    return false;
  }
}

function expandAutoVars(text) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return text
    .replace(/\{date\}/gi, `${yyyy}-${mm}-${dd}`)
    .replace(/\{today\}/gi, now.toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    }));
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function getSampleSnippets() {
  const now = Date.now();
  return [
    {
      id: 's' + now + '1',
      name: 'Blog Outline',
      content: 'Write a detailed SEO blog post outline about {topic} for {audience}. Include H2/H3 headings, key points, and a meta description.',
      category: 'Writing',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 's' + now + '2',
      name: 'Email Reply',
      content: 'Rewrite this email to be more {tone} (professional / friendly / concise):\n\n{email}',
      category: 'Email',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 's' + now + '3',
      name: 'Code Review',
      content: 'Review this {language} code for bugs, performance, readability, and security. Suggest improvements:\n\n{code}',
      category: 'Coding',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 's' + now + '4',
      name: 'Summarize',
      content: 'Summarize the following text in 3 bullet points, keeping the key facts:\n\n{text}',
      category: 'Writing',
      createdAt: now,
      updatedAt: now
    }
  ];
}

// content_script として注入される関数（DOM操作・変数ダイアログ）
async function insertIntoActiveElement(snippetId, text, allMemory, varRemember, isPaid) {
  const AUTO = ['date', 'today'];
  const customVars = [...new Set((text.match(/\{(\w+)\}/g) || []))]
    .filter(v => !AUTO.includes(v.slice(1, -1).toLowerCase()));

  // Free 制限：変数1個まで
  if (!isPaid && customVars.length > 1) {
    showToast('Free plan supports 1 variable. Upgrade for unlimited.', 'warn');
    return { ok: false };
  }

  // 入力欄ターゲットを取得（activeElement → URL別フォールバック）
  const isEditable = (node) => {
    if (!node) return false;
    return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' ||
      node.isContentEditable || node.getAttribute?.('contenteditable') === 'true';
  };

  let targetEl = document.activeElement;
  if (!isEditable(targetEl)) {
    const host = location.hostname;
    let candidate = null;
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
      candidate = document.querySelector('#prompt-textarea') ||
        document.querySelector('main [contenteditable="true"]') ||
        document.querySelector('div[role="textbox"]');
    } else if (host.includes('claude.ai')) {
      candidate = document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('[role="textbox"]');
    } else if (host.includes('gemini.google.com')) {
      candidate = document.querySelector('rich-textarea div[contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]');
    } else if (host.includes('perplexity.ai')) {
      candidate = document.querySelector('textarea') ||
        document.querySelector('[contenteditable="true"]');
    }
    if (isEditable(candidate)) targetEl = candidate;
  }

  let result = text;
  let saveResult = null;

  if (customVars.length > 0) {
    const dialogResult = await showVarDialog(snippetId, customVars, allMemory, varRemember, targetEl);
    if (!dialogResult) return { ok: false };
    for (const [v, val] of Object.entries(dialogResult.values)) {
      result = result.replaceAll(v, val);
    }
    saveResult = dialogResult.memoryUpdate;
  }

  if (targetEl) {
    try { targetEl.focus(); } catch (_) {}
  }

  let ok = false;
  let copiedToClipboard = false;
  const el = targetEl;

  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(result, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    ok = true;
  } else if (el && (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true')) {
    // execCommand insertText（ProseMirror, Slate.js, Lexical 等で動作）
    ok = document.execCommand('insertText', false, result);
    if (!ok) {
      // フォールバック: beforeinput イベント dispatch
      try {
        el.dispatchEvent(new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: result,
          bubbles: true,
          cancelable: true
        }));
        ok = true;
      } catch (_) {}
    }
  }

  if (!ok) {
    // 最終フォールバック: クリップボードにコピー（成功扱い）
    try {
      await navigator.clipboard.writeText(result);
      showToast('Copied to clipboard. Press Ctrl+V to paste.', 'info');
      copiedToClipboard = true;
    } catch (_) {
      showToast('Could not insert here. Try clicking the input field first.', 'error');
    }
  } else {
    showToast('Snippet inserted', 'success');
  }

  return { ...(saveResult || {}), ok: ok || copiedToClipboard, copiedToClipboard };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showVarDialog(sId, vars, memAll, remember, anchorEl) {
    const memory = memAll[sId] || {};

    return new Promise((resolve) => {
      const existing = document.getElementById('ps-var-dialog');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'ps-var-backdrop';
      Object.assign(backdrop.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.25)',
        zIndex: '2147483646'
      });

      const panel = document.createElement('div');
      panel.id = 'ps-var-dialog';
      // 画面中央上寄せ（サイドバー被り問題を回避、入力欄付近）
      const anchorRect = anchorEl?.getBoundingClientRect?.();
      const desiredTop = anchorRect
        ? Math.max(16, Math.min(anchorRect.top - 320, window.innerHeight - 360))
        : 80;
      Object.assign(panel.style, {
        position: 'fixed',
        top: desiredTop + 'px',
        left: '50%', transform: 'translateX(-50%)',
        width: '340px',
        background: '#fff', borderRadius: '12px', padding: '16px',
        boxShadow: '0 8px 30px rgba(0,0,0,0.35)', zIndex: '2147483647',
        fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#1a1a2e'
      });

      let html = '<div style="font-weight:700;margin-bottom:12px;font-size:15px;">Fill in variables</div>';
      html += '<div style="font-size:11px;color:#888;margin-bottom:10px;">Press Ctrl+Enter to insert, Esc to cancel.</div>';
      for (const v of vars) {
        const label = escapeHtml(v.slice(1, -1));
        const saved = remember ? (memory[v] || '') : '';
        html += `<div style="margin-bottom:8px;">
          <label style="display:block;font-size:12px;color:#666;margin-bottom:2px;">${label}</label>
          <textarea data-var="${escapeHtml(v)}" rows="2" style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit;outline:none;resize:vertical;color:#1a1a2e;background:#fff;"></textarea>
        </div>`;
      }
      // 値は textarea 構築後に value プロパティで設定（XSS安全）
      // ここでは saved を後でDOM経由で設定するため、html内には含めない
      html += `<div style="margin-top:10px;display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="ps-var-remember" ${remember ? 'checked' : ''} style="margin:0;">
        <label for="ps-var-remember" style="font-size:12px;color:#666;cursor:pointer;">Remember values</label>
      </div>`;
      html += `<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
        <button id="ps-var-cancel" style="padding:7px 18px;background:#fff;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
        <button id="ps-var-insert" style="padding:7px 18px;background:#4a90d9;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Insert</button>
      </div>`;

      panel.innerHTML = html;
      document.body.appendChild(backdrop);
      document.body.appendChild(panel);

      // value をDOM経由で安全に設定
      for (const ta of panel.querySelectorAll('textarea[data-var]')) {
        const v = ta.dataset.var;
        ta.value = remember ? (memory[v] || '') : '';
      }

      const cleanup = () => { panel.remove(); backdrop.remove(); };

      const firstInput = panel.querySelector('textarea[data-var]');
      if (firstInput) setTimeout(() => { firstInput.focus(); firstInput.select(); }, 50);

      backdrop.addEventListener('click', () => { cleanup(); resolve(null); });

      panel.querySelector('#ps-var-cancel').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      panel.querySelector('#ps-var-insert').addEventListener('click', () => {
        const values = {};
        for (const ta of panel.querySelectorAll('textarea[data-var]')) {
          values[ta.dataset.var] = ta.value;
        }
        const shouldRemember = panel.querySelector('#ps-var-remember').checked;
        let memoryUpdate;
        if (shouldRemember) {
          memoryUpdate = {
            save: true,
            varMemory: { ...memAll, [sId]: { ...memory, ...values } },
            varRemember: true
          };
        } else {
          memoryUpdate = { save: true, varMemory: memAll, varRemember: false };
        }
        cleanup();
        resolve({ values, memoryUpdate });
      });

      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          panel.querySelector('#ps-var-insert').click();
        }
        if (e.key === 'Escape') panel.querySelector('#ps-var-cancel').click();
      });
    });
  }

  function showToast(message, level) {
    const existing = document.getElementById('ps-toast');
    if (existing) existing.remove();
    const colors = {
      success: '#1a1a2e',
      info: '#2563eb',
      warn: '#d97706',
      error: '#dc2626'
    };
    const toast = document.createElement('div');
    toast.id = 'ps-toast';
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '20px', right: '20px',
      background: colors[level] || colors.success, color: '#fff',
      padding: '10px 20px', borderRadius: '8px', fontSize: '14px',
      fontFamily: 'system-ui, sans-serif', zIndex: '2147483647',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s', opacity: '1', maxWidth: '320px'
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, level === 'success' ? 1500 : 3000);
  }
}

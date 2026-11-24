// US6: the "Smart matching" card on Profile: switch, API key, privacy note, feedback stats.
import { loadApiKey, saveApiKey, clearApiKey, loadSmartSettings } from './store.js';
import { testKey, setSmartEnabled, smartStatus } from './smart-fit.js';
import { feedbackStats, feedbackJson } from './feedback.js';

const $ = (s) => document.querySelector(s);
let els;

export function initSmartSettings() {
  els = {
    toggle: $('#f-smart'),
    sub: $('#smart-sub'),
    key: $('#f-apikey'),
    save: $('#btn-key-save'),
    remove: $('#btn-key-remove'),
    notice: $('#smart-notice'),
    stats: $('#feedback-stats'),
    copy: $('#btn-copy-feedback'),
    copyBox: $('#feedback-copy'),
  };
  render();

  els.save.addEventListener('click', saveKey);
  els.key.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveKey();
    }
  });

  els.toggle.addEventListener('change', () => {
    if (els.toggle.checked && !loadApiKey()) {
      els.toggle.checked = false;
      notice('Add your API key first, then turn this on.', 'error');
      els.key.focus();
      return;
    }
    setSmartEnabled(els.toggle.checked);
    notice(els.toggle.checked ? 'Smart matching is on.' : 'Smart matching is off. You’ll see keyword matches.', 'info');
    render();
  });

  let armed = false;
  let timer;
  els.remove.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      els.remove.textContent = 'Tap again to remove key';
      timer = setTimeout(() => {
        armed = false;
        els.remove.textContent = 'Remove key';
      }, 4000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    els.remove.textContent = 'Remove key';
    clearApiKey();
    setSmartEnabled(false);
    notice('Key removed from this device. Smart matching is off.', 'info');
    render();
    els.key.focus();
  });

  els.copy.addEventListener('click', async () => {
    const json = feedbackJson();
    try {
      await navigator.clipboard.writeText(json);
      notice('Feedback copied. Paste it wherever you’re collecting results.', 'info');
    } catch {
      // Clipboard blocked: show the text, selected, so it can be copied by hand.
      els.copyBox.hidden = false;
      els.copyBox.value = json;
      els.copyBox.focus();
      els.copyBox.select();
      notice('Copy the selected text below.', 'info');
    }
  });

  window.addEventListener('jf:smart-status', (e) => {
    if (e.detail?.state === 'bad_key') notice(e.detail.message, 'error');
  });
}

/** Called when Profile is shown, so stats and status are current. */
export function showSmartSettings() {
  if (!els) return;
  render();
  const s = smartStatus();
  if (s.state === 'bad_key') notice(s.message, 'error');
}

async function saveKey() {
  const key = els.key.value.trim();
  if (!key) return notice('Paste your API key first.', 'error');
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return notice('That doesn’t look like an Anthropic API key. It starts with “sk-ant-”.', 'error');
  }
  els.save.disabled = true;
  notice('Checking your key…', 'info');
  const result = await testKey(key);
  els.save.disabled = false;
  if (!result.ok) return notice(result.message, 'error');
  saveApiKey(key);
  els.key.value = '';
  setSmartEnabled(true);
  notice('Key saved on this device. Smart matching is on.', 'info');
  render();
}

function render() {
  const key = loadApiKey();
  const enabled = loadSmartSettings().enabled && Boolean(key);
  els.toggle.checked = enabled;
  els.sub.textContent = key ? `Key saved on this device (ends ${key.slice(-4)}).` : 'Needs your Anthropic API key.';
  els.key.placeholder = key ? 'Paste a new key to replace it' : 'sk-ant-…';
  els.save.textContent = key ? 'Replace key' : 'Save key';
  els.remove.hidden = !key;

  const s = feedbackStats();
  els.stats.textContent = s.rated ? `Reasons rated: ${s.rated} · ${s.usefulPct}% useful` : 'Rate reasons with 👍 or 👎 in job details to measure how useful they are.';
  els.copy.hidden = !s.rated;
}

function notice(text, kind) {
  els.notice.textContent = text;
  els.notice.className = `notice ${text ? `is-${kind}` : ''}`;
}

const DEFAULT_SETTINGS = {
  endpoint: '',
  apiKey: '',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  requestMethod: 'POST',
  promptTemplate: '请将以下文本从{{sourceLanguage}}翻译成{{targetLanguage}}：\n\n{{text}}',
  requestBodyTemplate:
    '{\n  "text": "{{text}}",\n  "prompt": "{{prompt}}",\n  "sourceLanguage": "{{sourceLanguage}}",\n  "targetLanguage": "{{targetLanguage}}"\n}',
  customHeaders: '{\n  "Authorization": "Bearer {{apiKey}}"\n}',
  responsePath: 'translation',
  detectionMode: 'simple',
  detectionEndpoint: '',
  detectionRequestMethod: 'POST',
  detectionPromptTemplate:
    '请判断以下文本的语言并仅返回语言代码（如 en、zh-CN）：\n\n{{text}}',
  detectionRequestBodyTemplate: '{\n  "text": "{{text}}",\n  "prompt": "{{prompt}}"\n}',
  detectionCustomHeaders: '{}',
  detectionResponsePath: '',
  enablePageTranslation: true,
  autoDetectPageLanguage: true,
  autoShowFloatingPanel: true,
  pageTranslationBatchSize: 8
};

const BUBBLE_ID = 'safe-page-translator-bubble';
const PANEL_ID = 'safe-page-translator-panel';
const PANEL_STYLE_ID = 'safe-page-translator-style';
const TRANSLATOR_DATA_ATTRIBUTE = 'data-safe-page-translator';

const originalTextMap = new WeakMap();
let currentSettings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;
let detectedPageLanguage = '';
let translationInProgress = false;
let detectionTimer = null;
let mutationObserver = null;

const floatingPanelState = {
  panel: null,
  status: null,
  translateButton: null,
  placeholderButton: null,
  detectedLanguage: null,
  targetLanguage: null
};

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'META',
  'LINK',
  'TITLE',
  'IFRAME',
  'FRAME',
  'CANVAS',
  'SVG',
  'MATH',
  'CODE',
  'PRE',
  'SAMP',
  'KBD',
  'TT',
  'VAR',
  'TEXTAREA',
  'INPUT',
  'OBJECT',
  'EMBED',
  'AUDIO',
  'VIDEO',
  'PICTURE',
  'TRACK'
]);

init();

async function init() {
  if (document.readyState === 'loading') {
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  ensurePanelStyles();
  await loadSettings();

  if (currentSettings.enablePageTranslation) {
    scheduleLanguageDetection(800);
    observeDomMutations();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.settings) {
      return;
    }
    currentSettings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
    settingsLoaded = true;

    if (!currentSettings.enablePageTranslation) {
      hideFloatingPanel();
      return;
    }

    scheduleLanguageDetection(300);
  });
}

function ensurePanelStyles() {
  if (document.getElementById(PANEL_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = PANEL_STYLE_ID;
  style.setAttribute(TRANSLATOR_DATA_ATTRIBUTE, 'true');
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 288px;
      padding: 16px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
      display: none;
      flex-direction: column;
      gap: 12px;
      z-index: 2147483647;
    }
    #${PANEL_ID}[data-visible="true"] {
      display: flex;
    }
    #${PANEL_ID} .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    #${PANEL_ID} .title {
      font-size: 14px;
      font-weight: 600;
    }
    #${PANEL_ID} .close-btn {
      border: none;
      background: transparent;
      color: #94a3b8;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 4px;
    }
    #${PANEL_ID} .close-btn:hover {
      color: #e2e8f0;
    }
    #${PANEL_ID} .status {
      font-size: 13px;
      color: #e2e8f0;
      min-height: 18px;
    }
    #${PANEL_ID} .status.error {
      color: #fca5a5;
    }
    #${PANEL_ID} .status.success {
      color: #86efac;
    }
    #${PANEL_ID} .status.warning {
      color: #fcd34d;
    }
    #${PANEL_ID} .languages {
      display: flex;
      gap: 8px;
    }
    #${PANEL_ID} .language-chip {
      flex: 1;
      border-radius: 10px;
      padding: 6px 8px;
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.25);
      font-size: 12px;
      color: #cbd5f5;
    }
    #${PANEL_ID} .language-chip strong {
      display: block;
      font-size: 12px;
      color: #38bdf8;
      margin-bottom: 2px;
    }
    #${PANEL_ID} .actions {
      display: flex;
      gap: 8px;
    }
    #${PANEL_ID} button.translate-button {
      flex: 1;
      padding: 10px;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, #38bdf8, #0ea5e9);
      color: #0f172a;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #${PANEL_ID} button.translate-button:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 14px 28px rgba(14, 165, 233, 0.35);
    }
    #${PANEL_ID} button.translate-button[disabled] {
      opacity: 0.6;
      cursor: wait;
      transform: none;
      box-shadow: none;
    }
    #${PANEL_ID} button.placeholder-button {
      flex: 1;
      padding: 10px;
      border-radius: 10px;
      border: 1px dashed rgba(148, 163, 184, 0.5);
      background: transparent;
      color: #94a3b8;
      cursor: not-allowed;
    }
    #${PANEL_ID} .footer-hint {
      font-size: 12px;
      color: #94a3b8;
      margin: 4px 0 0;
    }
  `;

  document.head.appendChild(style);
}

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  currentSettings = { ...DEFAULT_SETTINGS, ...settings };
  settingsLoaded = true;
}

function observeDomMutations() {
  if (!document.body || mutationObserver) {
    return;
  }

  mutationObserver = new MutationObserver(() => {
    if (!currentSettings.enablePageTranslation || !currentSettings.autoDetectPageLanguage) {
      return;
    }
    if (translationInProgress) {
      return;
    }
    scheduleLanguageDetection(1500);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function scheduleLanguageDetection(delay = 800) {
  if (!currentSettings.enablePageTranslation || !document.body) {
    return;
  }

  if (!currentSettings.autoDetectPageLanguage) {
    hideFloatingPanel();
    return;
  }

  clearTimeout(detectionTimer);
  detectionTimer = setTimeout(runLanguageDetection, delay);
}

async function runLanguageDetection() {
  if (!currentSettings.enablePageTranslation || !currentSettings.autoDetectPageLanguage) {
    return;
  }

  const targetLanguage = currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
  const sample = extractSampleText(1600);

  if (!sample || sample.replace(/\s+/g, '').length < 12) {
    if (currentSettings.autoShowFloatingPanel) {
      showFloatingPanel({
        detectedLanguage: '未知',
        targetLanguage,
        status: '未检测到大段文本，网页可能主要由图片或自定义组件构成。',
        tone: 'warning'
      });
    }
    return;
  }

  try {
    const language = await detectLanguage(sample);
    detectedPageLanguage = language;
    const shouldShow = currentSettings.autoShowFloatingPanel
      ? languagesDiffer(language, targetLanguage) || language === 'auto'
      : false;

    if (shouldShow) {
      showFloatingPanel({
        detectedLanguage: language,
        targetLanguage,
        status: '检测到页面语言与目标语言不一致，可尝试整页翻译。',
        tone: 'info'
      });
    } else {
      hideFloatingPanel();
    }
  } catch (error) {
    showFloatingPanel({
      detectedLanguage: '未知',
      targetLanguage,
      status: `语言识别失败：${error.message}`,
      tone: 'error'
    });
  }
}

async function detectLanguage(text) {
  await ensureSettingsLoaded();
  const mode = currentSettings.detectionMode || 'simple';

  if (mode === 'manual') {
    return normalizeLanguageCode(currentSettings.sourceLanguage || 'auto');
  }

  if (mode === 'llm') {
    const response = await chrome.runtime.sendMessage({
      type: 'detect-language',
      payload: { text: text.slice(0, 4000) }
    });

    if (!response?.success) {
      throw new Error(response?.error || '接口未返回语言识别结果');
    }

    return normalizeLanguageCode(response.language || 'auto');
  }

  return simpleLanguageGuess(text);
}

function simpleLanguageGuess(text) {
  const counters = {
    han: 0,
    hiragana: 0,
    katakana: 0,
    hangul: 0,
    cyrillic: 0,
    arabic: 0,
    devanagari: 0,
    latin: 0
  };

  const normalized = text.slice(0, 4000);
  for (const char of normalized) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (isHan(code)) {
      counters.han += 1;
      continue;
    }
    if (isHiragana(code)) {
      counters.hiragana += 1;
      continue;
    }
    if (isKatakana(code)) {
      counters.katakana += 1;
      continue;
    }
    if (isHangul(code)) {
      counters.hangul += 1;
      continue;
    }
    if (isCyrillic(code)) {
      counters.cyrillic += 1;
      continue;
    }
    if (isArabic(code)) {
      counters.arabic += 1;
      continue;
    }
    if (isDevanagari(code)) {
      counters.devanagari += 1;
      continue;
    }
    if (isLatin(code)) {
      counters.latin += 1;
      continue;
    }
  }

  const entries = Object.entries(counters).sort(([, a], [, b]) => b - a);
  const [bestKey, bestValue] = entries[0] || [];

  if (!bestKey || bestValue < 5) {
    return 'auto';
  }

  if (bestKey === 'han') {
    if (counters.hiragana + counters.katakana > Math.max(5, counters.han * 0.1)) {
      return 'ja';
    }
    return 'zh-CN';
  }

  if (bestKey === 'hiragana' || bestKey === 'katakana') {
    return 'ja';
  }

  if (bestKey === 'hangul') {
    return 'ko';
  }

  if (bestKey === 'cyrillic') {
    return 'ru';
  }

  if (bestKey === 'arabic') {
    return 'ar';
  }

  if (bestKey === 'devanagari') {
    return 'hi';
  }

  if (bestKey === 'latin') {
    return guessLatinLanguage(normalized);
  }

  return 'auto';
}

function guessLatinLanguage(text) {
  if (/[¿¡ñáéíóúü]/i.test(text)) {
    return 'es';
  }
  if (/[äöüß]/i.test(text)) {
    return 'de';
  }
  if (/[êâîôûçéèàùœ]/i.test(text)) {
    return 'fr';
  }
  if (/[čšžćđ]/i.test(text)) {
    return 'hr';
  }
  return 'en';
}

function isHan(code) {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f)
  );
}

function isHiragana(code) {
  return code >= 0x3040 && code <= 0x309f;
}

function isKatakana(code) {
  return (code >= 0x30a0 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff);
}

function isHangul(code) {
  return (code >= 0xac00 && code <= 0xd7af) || (code >= 0x3130 && code <= 0x318f);
}

function isCyrillic(code) {
  return code >= 0x0400 && code <= 0x04ff;
}

function isArabic(code) {
  return (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0x08a0 && code <= 0x08ff)
  );
}

function isDevanagari(code) {
  return code >= 0x0900 && code <= 0x097f;
}

function isLatin(code) {
  return (
    (code >= 0x0041 && code <= 0x007a) ||
    (code >= 0x00c0 && code <= 0x024f) ||
    (code >= 0x1e00 && code <= 0x1eff)
  );
}

function normalizeLanguageCode(code) {
  if (!code) {
    return 'auto';
  }
  return String(code).trim();
}

function languagesDiffer(a, b) {
  if (!a || !b) {
    return true;
  }
  return a.toLowerCase() !== b.toLowerCase();
}

function extractSampleText(maxLength = 1600) {
  if (!document.body) {
    return '';
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      if (shouldSkipElement(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      const baseText = (originalTextMap.get(node) ?? node.textContent ?? '').trim();
      if (!baseText) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current;
  let collected = '';
  while ((current = walker.nextNode())) {
    const text = (originalTextMap.get(current) ?? current.textContent ?? '').trim();
    if (!text) {
      continue;
    }
    collected += text + ' ';
    if (collected.length >= maxLength) {
      break;
    }
  }

  return collected.slice(0, maxLength);
}

function shouldSkipElement(element) {
  if (!element) {
    return true;
  }

  if (element.hasAttribute(TRANSLATOR_DATA_ATTRIBUTE) || element.closest(`[${TRANSLATOR_DATA_ATTRIBUTE}]`)) {
    return true;
  }

  if (element.closest('[translate="no"], .notranslate')) {
    return true;
  }

  if (SKIP_TAGS.has(element.tagName)) {
    return true;
  }

  return false;
}

function getFloatingPanelElements() {
  if (floatingPanelState.panel) {
    return floatingPanelState;
  }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute(TRANSLATOR_DATA_ATTRIBUTE, 'true');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-busy', 'false');

  panel.innerHTML = `
    <div class="header">
      <span class="title">Safe Page Translator</span>
      <button type="button" class="close-btn" aria-label="关闭翻译悬浮窗">×</button>
    </div>
    <div class="status"></div>
    <div class="languages">
      <div class="language-chip"><strong>检测语言</strong><span class="detected">--</span></div>
      <div class="language-chip"><strong>目标语言</strong><span class="target">--</span></div>
    </div>
    <div class="actions">
      <button type="button" class="translate-button">翻译整页</button>
      <button type="button" class="placeholder-button" title="更多功能即将上线" disabled>更多功能</button>
    </div>
    <p class="footer-hint">当网页以图片或自定义渲染文字时，请结合截图或 OCR 获得更准确的翻译。</p>
  `;

  const status = panel.querySelector('.status');
  const translateButton = panel.querySelector('.translate-button');
  const placeholderButton = panel.querySelector('.placeholder-button');
  const detectedElement = panel.querySelector('.detected');
  const targetElement = panel.querySelector('.target');
  const closeButton = panel.querySelector('.close-btn');

  translateButton.addEventListener('click', () => {
    translateEntirePage({ forceShowPanel: true });
  });

  closeButton.addEventListener('click', () => {
    hideFloatingPanel();
  });

  document.body.appendChild(panel);

  floatingPanelState.panel = panel;
  floatingPanelState.status = status;
  floatingPanelState.translateButton = translateButton;
  floatingPanelState.placeholderButton = placeholderButton;
  floatingPanelState.detectedLanguage = detectedElement;
  floatingPanelState.targetLanguage = targetElement;

  return floatingPanelState;
}

function showFloatingPanel({ detectedLanguage, targetLanguage, status, tone = 'info' }) {
  const { panel } = getFloatingPanelElements();
  updateFloatingPanelLanguages(detectedLanguage, targetLanguage);
  updateFloatingPanelStatus(status, tone);
  panel.dataset.visible = 'true';
  panel.setAttribute('aria-hidden', 'false');
}

function hideFloatingPanel() {
  if (!floatingPanelState.panel) {
    return;
  }
  floatingPanelState.panel.dataset.visible = 'false';
  floatingPanelState.panel.setAttribute('aria-hidden', 'true');
}

function updateFloatingPanelStatus(text, tone = 'info') {
  const { status } = getFloatingPanelElements();
  status.textContent = text || '';
  status.className = `status ${tone}`;
}

function updateFloatingPanelLanguages(detectedLanguage, targetLanguage) {
  const { detectedLanguage: detectedElement, targetLanguage: targetElement } = getFloatingPanelElements();
  detectedElement.textContent = detectedLanguage || '--';
  targetElement.textContent = targetLanguage || '--';
}

async function translateEntirePage({ forceShowPanel = false } = {}) {
  await ensureSettingsLoaded();

  if (!currentSettings.enablePageTranslation) {
    showFloatingPanel({
      detectedLanguage: detectedPageLanguage || '未知',
      targetLanguage: currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
      status: '整页翻译功能已在设置中关闭，可在扩展选项中重新启用。',
      tone: 'warning'
    });
    return;
  }

  const nodes = collectTranslatableTextNodes();
  if (nodes.length === 0) {
    showFloatingPanel({
      detectedLanguage: detectedPageLanguage || '未知',
      targetLanguage: currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
      status: '未找到可翻译的文本。',
      tone: 'warning'
    });
    return;
  }

  const { panel, translateButton } = getFloatingPanelElements();
  if (forceShowPanel) {
    panel.dataset.visible = 'true';
    panel.setAttribute('aria-hidden', 'false');
  }

  const targetLanguage = currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
  const sourceLanguage = detectedPageLanguage || currentSettings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage;
  updateFloatingPanelLanguages(detectedPageLanguage || sourceLanguage, targetLanguage);

  if (translationInProgress) {
    updateFloatingPanelStatus('已有翻译任务正在执行，请稍候。', 'warning');
    return;
  }

  translationInProgress = true;
  translateButton.disabled = true;
  panel.setAttribute('aria-busy', 'true');

  const batchSize = Math.max(1, Number(currentSettings.pageTranslationBatchSize) || DEFAULT_SETTINGS.pageTranslationBatchSize);
  const chunks = chunkArray(nodes, batchSize);

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      updateFloatingPanelStatus(`整页翻译中... (${index + 1}/${chunks.length})`, 'info');

      const response = await requestBatchTranslation(
        chunk.map((item) => item.trimmedText),
        { targetLanguage, sourceLanguage }
      );

      if (!response?.success) {
        throw new Error(response?.error || '翻译接口返回错误');
      }

      const translations = response.translations || [];
      chunk.forEach((item, itemIndex) => {
        const translation = translations[itemIndex];
        if (typeof translation !== 'string') {
          return;
        }
        if (!originalTextMap.has(item.node)) {
          originalTextMap.set(item.node, item.originalText);
        }
        item.node.textContent = `${item.leading}${translation}${item.trailing}`;
      });
    }

    updateFloatingPanelStatus('整页翻译完成。', 'success');
    detectedPageLanguage = sourceLanguage;
    updateFloatingPanelLanguages(detectedPageLanguage, targetLanguage);
  } catch (error) {
    console.error('Failed to translate page', error);
    updateFloatingPanelStatus(`整页翻译失败：${error.message}`, 'error');
  } finally {
    translationInProgress = false;
    translateButton.disabled = false;
    panel.setAttribute('aria-busy', 'false');
  }
}

function collectTranslatableTextNodes() {
  if (!document.body) {
    return [];
  }

  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }

      if (shouldSkipElement(parent)) {
        return NodeFilter.FILTER_REJECT;
      }

      const baseText = originalTextMap.get(node) ?? node.textContent ?? '';
      const trimmed = baseText.trim();
      if (!trimmed || trimmed.length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      if (trimmed.length === 1 && /[\p{P}\p{Z}]/u.test(trimmed)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current;
  while ((current = walker.nextNode())) {
    const originalText = originalTextMap.get(current) ?? current.textContent ?? '';
    const trimmedText = originalText.trim();
    if (!trimmedText) {
      continue;
    }

    const leading = originalText.match(/^\s*/u)?.[0] ?? '';
    const trailing = originalText.match(/\s*$/u)?.[0] ?? '';

    nodes.push({
      node: current,
      originalText,
      trimmedText: trimmedText.slice(0, 4000),
      leading,
      trailing
    });
  }

  return nodes;
}

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function createTranslationBubble(text, tone = 'default') {
  const existing = document.getElementById(BUBBLE_ID);
  if (existing) {
    existing.remove();
  }

  const bubble = document.createElement('div');
  bubble.id = BUBBLE_ID;
  bubble.setAttribute(TRANSLATOR_DATA_ATTRIBUTE, 'true');
  bubble.style.position = 'absolute';
  bubble.style.zIndex = '2147483647';
  bubble.style.maxWidth = '320px';
  bubble.style.padding = '12px 16px';
  bubble.style.backgroundColor = tone === 'error' ? '#dc2626' : '#1f2937';
  bubble.style.color = '#f9fafb';
  bubble.style.fontSize = '14px';
  bubble.style.lineHeight = '1.5';
  bubble.style.borderRadius = '8px';
  bubble.style.boxShadow = '0 12px 30px rgba(15, 23, 42, 0.3)';
  bubble.style.fontFamily = 'system-ui, sans-serif';
  bubble.style.whiteSpace = 'pre-wrap';

  bubble.textContent = text;

  document.body.appendChild(bubble);

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    bubble.style.top = `${window.scrollY + 24}px`;
    bubble.style.left = `${window.scrollX + 24}px`;
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  bubble.style.top = `${rect.bottom + window.scrollY + 8}px`;
  bubble.style.left = `${rect.left + window.scrollX}px`;
}

async function requestTranslation(text, overrides = {}) {
  await ensureSettingsLoaded();
  const payload = {
    text,
    targetLanguage: overrides.targetLanguage || currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
    sourceLanguage: overrides.sourceLanguage || currentSettings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage
  };

  return chrome.runtime.sendMessage({
    type: 'translate-text',
    payload
  });
}

async function requestBatchTranslation(texts, overrides = {}) {
  await ensureSettingsLoaded();
  const payload = {
    texts,
    targetLanguage: overrides.targetLanguage || currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
    sourceLanguage: overrides.sourceLanguage || currentSettings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage
  };

  return chrome.runtime.sendMessage({
    type: 'translate-text-batch',
    payload
  });
}

async function ensureSettingsLoaded() {
  if (!settingsLoaded) {
    await loadSettings();
  }
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'translate-selection') {
    await ensureSettingsLoaded();
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString() : '';

    if (!selectedText.trim()) {
      createTranslationBubble('请先选择需要翻译的文本。', 'error');
      return;
    }

    createTranslationBubble('翻译中...');

    const response = await requestTranslation(selectedText);

    if (!response?.success) {
      createTranslationBubble(response?.error || '翻译失败，请稍后再试。', 'error');
      return;
    }

    createTranslationBubble(response.translation || '');
  }

  if (message?.type === 'translate-entire-page') {
    translateEntirePage({ forceShowPanel: true });
  }
});

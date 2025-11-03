const DEFAULT_GENERIC_TRANSLATION = {
  endpoint: '',
  apiKey: '',
  requestMethod: 'POST',
  promptTemplate: '请将以下文本从{{sourceLanguage}}翻译成{{targetLanguage}}：\n\n{{text}}',
  requestBodyTemplate:
    '{\n  "text": "{{text}}",\n  "prompt": "{{prompt}}",\n  "sourceLanguage": "{{sourceLanguage}}",\n  "targetLanguage": "{{targetLanguage}}"\n}',
  customHeaders: '{\n  "Authorization": "Bearer {{apiKey}}"\n}',
  responsePath: 'translation'
};

const DEFAULT_GENERIC_DETECTION = {
  mode: 'simple',
  endpoint: '',
  requestMethod: 'POST',
  promptTemplate: '请判断以下文本的语言并仅返回语言代码（如 en、zh-CN）：\n\n{{text}}',
  requestBodyTemplate: '{\n  "text": "{{text}}",\n  "prompt": "{{prompt}}"\n}',
  customHeaders: '{}',
  responsePath: ''
};

const DEFAULT_PROFILES = [
  createDefaultProfile('generic', '自定义 LLM 模板', 'profile-generic'),
  createDefaultProfile('google', 'Google 翻译 API', 'profile-google'),
  createDefaultProfile('baidu', '百度翻译 API', 'profile-baidu')
];

const DEFAULT_SETTINGS = {
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  enablePageTranslation: true,
  autoDetectPageLanguage: true,
  autoShowFloatingPanel: true,
  pageTranslationBatchSize: 8,
  activeProfileId: DEFAULT_PROFILES[0].id,
  profiles: DEFAULT_PROFILES
};

const BUBBLE_ID = 'safe-page-translator-bubble';
const PANEL_ID = 'safe-page-translator-panel';
const PANEL_STYLE_ID = 'safe-page-translator-style';
const SELECTION_BUBBLE_ID = 'safe-page-translator-selection';
const TRANSLATOR_DATA_ATTRIBUTE = 'data-safe-page-translator';

const originalTextMap = new WeakMap();
let currentSettings = deepClone(DEFAULT_SETTINGS);
let currentProfile = currentSettings.profiles[0];
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
  targetLanguage: null,
  fab: null,
  collapseTimer: null
};

const PANEL_COLLAPSE_DELAY = 5000;

const selectionBubbleState = {
  container: null,
  translateButton: null,
  hideTimer: null,
  initialized: false,
  currentSelection: ''
};

const SELECTION_BUBBLE_HIDE_DELAY = 3200;

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

  setupSelectionBubble();

  if (currentSettings.enablePageTranslation) {
    scheduleLanguageDetection(800);
    observeDomMutations();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.settings) {
      return;
    }
    applySettings(changes.settings.newValue);

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
      border-radius: 18px;
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
      display: none;
      flex-direction: column;
      gap: 12px;
      z-index: 2147483647;
      backdrop-filter: blur(12px);
      transition: width 0.2s ease, height 0.2s ease, padding 0.2s ease, border-radius 0.2s ease,
        box-shadow 0.2s ease;
    }
    #${PANEL_ID}[data-visible="true"] {
      display: flex;
    }
    #${PANEL_ID}[data-collapsed="true"] {
      width: 46px;
      height: 46px;
      padding: 4px;
      border-radius: 26px;
      align-items: center;
      justify-content: center;
      gap: 0;
      box-shadow: 0 12px 26px rgba(15, 23, 42, 0.3);
    }
    #${PANEL_ID} .panel-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
    }
    #${PANEL_ID}[data-collapsed="true"] .panel-content {
      display: none;
    }
    #${PANEL_ID} .fab {
      display: none;
      width: 100%;
      height: 100%;
      border-radius: 20px;
      border: none;
      background: linear-gradient(135deg, #38bdf8, #0ea5e9);
      color: #0f172a;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.1);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #${PANEL_ID} .fab:hover {
      transform: translateY(-1px);
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.2);
    }
    #${PANEL_ID} .fab-icon {
      display: inline-flex;
      width: 22px;
      height: 22px;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    #${PANEL_ID} .fab svg {
      width: 20px;
      height: 20px;
    }
    #${PANEL_ID}[data-collapsed="true"] .fab {
      display: flex;
    }
    #${PANEL_ID}[data-collapsed="true"] .fab:focus-visible {
      outline: 2px solid #f8fafc;
      outline-offset: 2px;
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
    #${SELECTION_BUBBLE_ID} {
      position: absolute;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 18px;
      background: rgba(15, 23, 42, 0.92);
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.35);
      color: #e2e8f0;
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      line-height: 1.2;
    }
    #${SELECTION_BUBBLE_ID}[data-visible="true"] {
      display: inline-flex;
    }
    #${SELECTION_BUBBLE_ID} button {
      border: none;
      background: linear-gradient(135deg, #38bdf8, #0ea5e9);
      color: #0f172a;
      border-radius: 999px;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #${SELECTION_BUBBLE_ID} button:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 10px 18px rgba(14, 165, 233, 0.3);
    }
    #${SELECTION_BUBBLE_ID} button[disabled] {
      opacity: 0.65;
      cursor: wait;
      transform: none;
      box-shadow: none;
    }
    #${SELECTION_BUBBLE_ID} .label {
      white-space: nowrap;
    }
  `;

  document.head.appendChild(style);
}

function setupSelectionBubble() {
  if (selectionBubbleState.initialized) {
    return;
  }

  selectionBubbleState.initialized = true;

  document.addEventListener('selectionchange', handleSelectionChangeForBubble);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (isNodeInsideSelectionBubble(event.target)) {
        return;
      }
      hideSelectionBubble();
    },
    true
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideSelectionBubble();
    }
  });
}

function ensureSelectionBubbleElements() {
  if (selectionBubbleState.container) {
    return selectionBubbleState;
  }

  const container = document.createElement('div');
  container.id = SELECTION_BUBBLE_ID;
  container.setAttribute(TRANSLATOR_DATA_ATTRIBUTE, 'true');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', '划词翻译工具');

  container.innerHTML = `
    <button type="button" aria-label="翻译选中文本">
      <span class="fab-icon" aria-hidden="true">译</span>
    </button>
    <span class="label">翻译选中文本</span>
  `;

  const button = container.querySelector('button');
  button.addEventListener('click', handleSelectionBubbleTranslate);

  document.body.appendChild(container);
  container.dataset.visible = 'false';

  selectionBubbleState.container = container;
  selectionBubbleState.translateButton = button;

  return selectionBubbleState;
}

function handleSelectionChangeForBubble() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    hideSelectionBubble();
    selectionBubbleState.currentSelection = '';
    return;
  }

  const text = selection.toString().trim();

  if (!text || text.length < 2) {
    hideSelectionBubble();
    selectionBubbleState.currentSelection = '';
    return;
  }

  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (isInsideTranslatorElement(anchorNode) || isInsideTranslatorElement(focusNode)) {
    hideSelectionBubble();
    return;
  }

  selectionBubbleState.currentSelection = text.slice(0, 2000);

  const range = selection.getRangeAt(0);
  showSelectionBubble(range.getBoundingClientRect());
}

function showSelectionBubble(rect) {
  const { container } = ensureSelectionBubbleElements();

  if (selectionBubbleState.hideTimer) {
    clearTimeout(selectionBubbleState.hideTimer);
    selectionBubbleState.hideTimer = null;
  }

  container.style.visibility = 'hidden';
  container.dataset.visible = 'true';

  requestAnimationFrame(() => {
    positionSelectionBubble(container, rect);
    container.style.visibility = '';
  });
}

function hideSelectionBubble(delay = 0) {
  if (!selectionBubbleState.container) {
    return;
  }

  if (delay > 0) {
    if (selectionBubbleState.hideTimer) {
      clearTimeout(selectionBubbleState.hideTimer);
    }
    selectionBubbleState.hideTimer = setTimeout(() => {
      selectionBubbleState.container.dataset.visible = 'false';
      selectionBubbleState.hideTimer = null;
    }, delay);
    return;
  }

  if (selectionBubbleState.hideTimer) {
    clearTimeout(selectionBubbleState.hideTimer);
    selectionBubbleState.hideTimer = null;
  }
  selectionBubbleState.container.dataset.visible = 'false';
}

function positionSelectionBubble(container, rect) {
  const verticalOffset = 8;
  const horizontalOffset = 0;

  const containerRect = container.getBoundingClientRect();
  const width = containerRect.width || container.offsetWidth || 0;
  const height = containerRect.height || container.offsetHeight || 0;

  const maxLeft = window.scrollX + window.innerWidth - width - 12;
  const proposedLeft = window.scrollX + rect.left + horizontalOffset;
  const left = Math.max(window.scrollX + 12, Math.min(proposedLeft, maxLeft));

  let top = window.scrollY + rect.top - height - verticalOffset;
  if (top < window.scrollY + 12) {
    container.style.top = `${window.scrollY + rect.bottom + verticalOffset}px`;
  } else {
    container.style.top = `${top}px`;
  }

  container.style.left = `${left}px`;
}

async function handleSelectionBubbleTranslate(event) {
  event.preventDefault();
  event.stopPropagation();

  const text = selectionBubbleState.currentSelection;
  if (!text) {
    createTranslationBubble('请选择需要翻译的文本。', 'error');
    return;
  }

  const { translateButton } = ensureSelectionBubbleElements();
  translateButton.disabled = true;
  const previousLabel = translateButton.textContent;
  translateButton.textContent = '…';

  try {
    const response = await requestTranslation(text);
    if (!response?.success) {
      createTranslationBubble(response?.error || '翻译失败，请稍后再试。', 'error');
    } else {
      createTranslationBubble(response.translation || '');
    }
  } catch (error) {
    console.error('Selection translation failed', error);
    createTranslationBubble('翻译失败，请检查接口配置。', 'error');
  } finally {
    translateButton.disabled = false;
    translateButton.textContent = previousLabel;
    hideSelectionBubble(SELECTION_BUBBLE_HIDE_DELAY);
  }
}

function isNodeInsideSelectionBubble(node) {
  if (!selectionBubbleState.container) {
    return false;
  }

  if (!node) {
    return false;
  }

  return selectionBubbleState.container.contains(node);
}

function isInsideTranslatorElement(node) {
  let current = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      if (current.getAttribute && current.getAttribute(TRANSLATOR_DATA_ATTRIBUTE) === 'true') {
        return true;
      }
    }
    current = current.parentNode;
  }
  return false;
}

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  applySettings(settings);
}

function applySettings(rawSettings) {
  currentSettings = normalizeSettings(rawSettings);
  currentProfile =
    currentSettings.profiles.find((profile) => profile.id === currentSettings.activeProfileId) ||
    currentSettings.profiles[0];
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
  const mode = getDetectionMode();

  if (mode === 'manual') {
    return normalizeLanguageCode(currentSettings.sourceLanguage || 'auto');
  }

  if (mode === 'llm' || mode === 'provider') {
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
  const normalized = String(code).trim();
  if (!normalized) {
    return 'auto';
  }
  return normalized;
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

function normalizeSettings(rawSettings = {}) {
  const migrated = migrateLegacySettings(rawSettings);
  const clone = deepClone(DEFAULT_SETTINGS);

  clone.sourceLanguage = migrated?.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage;
  clone.targetLanguage = migrated?.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
  clone.enablePageTranslation = Boolean(
    migrated?.enablePageTranslation ?? DEFAULT_SETTINGS.enablePageTranslation
  );
  clone.autoDetectPageLanguage = Boolean(
    migrated?.autoDetectPageLanguage ?? DEFAULT_SETTINGS.autoDetectPageLanguage
  );
  clone.autoShowFloatingPanel = Boolean(
    migrated?.autoShowFloatingPanel ?? DEFAULT_SETTINGS.autoShowFloatingPanel
  );
  clone.pageTranslationBatchSize = Number(
    migrated?.pageTranslationBatchSize ?? DEFAULT_SETTINGS.pageTranslationBatchSize
  );

  const profilesArray = Array.isArray(migrated?.profiles) && migrated.profiles.length > 0
    ? migrated.profiles
    : deepClone(DEFAULT_PROFILES);

  clone.profiles = profilesArray.map((profile) => normalizeProfile(profile));

  clone.activeProfileId = migrated?.activeProfileId;
  if (!clone.profiles.find((profile) => profile.id === clone.activeProfileId)) {
    clone.activeProfileId = clone.profiles[0].id;
  }

  return clone;
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return createDefaultProfile('generic');
  }

  if (profile.type === 'google') {
    return {
      id: profile.id || generateProfileId('google'),
      name: profile.name || 'Google 翻译 API',
      type: 'google',
      translation: {
        endpoint:
          profile.translation?.endpoint || 'https://translation.googleapis.com/language/translate/v2',
        apiKey: profile.translation?.apiKey || '',
        format: profile.translation?.format === 'html' ? 'html' : 'text',
        model: profile.translation?.model || ''
      },
      detection: {
        mode: profile.detection?.mode === 'manual'
          ? 'manual'
          : profile.detection?.mode === 'simple'
          ? 'simple'
          : 'provider',
        endpoint:
          profile.detection?.endpoint || 'https://translation.googleapis.com/language/translate/v2/detect'
      }
    };
  }

  if (profile.type === 'baidu') {
    return {
      id: profile.id || generateProfileId('baidu'),
      name: profile.name || '百度翻译 API',
      type: 'baidu',
      translation: {
        endpoint:
          profile.translation?.endpoint || 'https://fanyi-api.baidu.com/api/trans/vip/translate',
        appId: profile.translation?.appId || '',
        appSecret: profile.translation?.appSecret || '',
        domain: profile.translation?.domain || 'general'
      },
      detection: {
        mode: profile.detection?.mode === 'manual'
          ? 'manual'
          : profile.detection?.mode === 'simple'
          ? 'simple'
          : 'provider',
        endpoint:
          profile.detection?.endpoint || 'https://fanyi-api.baidu.com/api/trans/vip/language'
      }
    };
  }

  return {
    id: profile.id || generateProfileId('generic'),
    name: profile.name || '自定义 LLM 模板',
    type: 'generic',
    translation: {
      ...deepClone(DEFAULT_GENERIC_TRANSLATION),
      ...profile.translation
    },
    detection: {
      ...deepClone(DEFAULT_GENERIC_DETECTION),
      ...profile.detection
    }
  };
}

function migrateLegacySettings(rawSettings = {}) {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings.profiles)) {
    return rawSettings;
  }

  if (rawSettings.profiles) {
    return rawSettings;
  }

  const migratedProfile = createDefaultProfile('generic', rawSettings.profileName || '已迁移模板');
  migratedProfile.translation.endpoint = rawSettings.endpoint || '';
  migratedProfile.translation.apiKey = rawSettings.apiKey || '';
  migratedProfile.translation.requestMethod = rawSettings.requestMethod || 'POST';
  migratedProfile.translation.promptTemplate =
    rawSettings.promptTemplate || DEFAULT_GENERIC_TRANSLATION.promptTemplate;
  migratedProfile.translation.requestBodyTemplate =
    rawSettings.requestBodyTemplate || DEFAULT_GENERIC_TRANSLATION.requestBodyTemplate;
  migratedProfile.translation.customHeaders = rawSettings.customHeaders || '{}';
  migratedProfile.translation.responsePath =
    rawSettings.responsePath || DEFAULT_GENERIC_TRANSLATION.responsePath;

  migratedProfile.detection.mode = rawSettings.detectionMode || 'simple';
  migratedProfile.detection.endpoint = rawSettings.detectionEndpoint || '';
  migratedProfile.detection.requestMethod = rawSettings.detectionRequestMethod || 'POST';
  migratedProfile.detection.promptTemplate =
    rawSettings.detectionPromptTemplate || DEFAULT_GENERIC_DETECTION.promptTemplate;
  migratedProfile.detection.requestBodyTemplate =
    rawSettings.detectionRequestBodyTemplate || DEFAULT_GENERIC_DETECTION.requestBodyTemplate;
  migratedProfile.detection.customHeaders = rawSettings.detectionCustomHeaders || '{}';
  migratedProfile.detection.responsePath = rawSettings.detectionResponsePath || '';

  return {
    sourceLanguage: rawSettings.sourceLanguage || 'auto',
    targetLanguage: rawSettings.targetLanguage || 'zh-CN',
    enablePageTranslation:
      rawSettings.enablePageTranslation ?? DEFAULT_SETTINGS.enablePageTranslation,
    autoDetectPageLanguage:
      rawSettings.autoDetectPageLanguage ?? DEFAULT_SETTINGS.autoDetectPageLanguage,
    autoShowFloatingPanel:
      rawSettings.autoShowFloatingPanel ?? DEFAULT_SETTINGS.autoShowFloatingPanel,
    pageTranslationBatchSize:
      rawSettings.pageTranslationBatchSize ?? DEFAULT_SETTINGS.pageTranslationBatchSize,
    activeProfileId: migratedProfile.id,
    profiles: [migratedProfile]
  };
}

function createDefaultProfile(type, name, fixedId) {
  if (type === 'google') {
    return {
      id: fixedId || generateProfileId(type),
      name: name || 'Google 翻译 API',
      type: 'google',
      translation: {
        endpoint: 'https://translation.googleapis.com/language/translate/v2',
        apiKey: '',
        format: 'text',
        model: ''
      },
      detection: {
        mode: 'provider',
        endpoint: 'https://translation.googleapis.com/language/translate/v2/detect'
      }
    };
  }

  if (type === 'baidu') {
    return {
      id: fixedId || generateProfileId(type),
      name: name || '百度翻译 API',
      type: 'baidu',
      translation: {
        endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/translate',
        appId: '',
        appSecret: '',
        domain: 'general'
      },
      detection: {
        mode: 'provider',
        endpoint: 'https://fanyi-api.baidu.com/api/trans/vip/language'
      }
    };
  }

  return {
    id: fixedId || generateProfileId(type),
    name: name || '自定义 LLM 模板',
    type: 'generic',
    translation: deepClone(DEFAULT_GENERIC_TRANSLATION),
    detection: deepClone(DEFAULT_GENERIC_DETECTION)
  };
}

function generateProfileId(type) {
  return `${type}-${Math.random().toString(36).slice(2, 10)}`;
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
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
  panel.dataset.collapsed = 'true';
  panel.setAttribute('aria-expanded', 'false');

  panel.innerHTML = `
    <button type="button" class="fab" aria-label="展开翻译面板">
      <span class="fab-icon" aria-hidden="true">译</span>
    </button>
    <div class="panel-content">
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
    </div>
  `;

  const status = panel.querySelector('.status');
  const translateButton = panel.querySelector('.translate-button');
  const placeholderButton = panel.querySelector('.placeholder-button');
  const detectedElement = panel.querySelector('.detected');
  const targetElement = panel.querySelector('.target');
  const closeButton = panel.querySelector('.close-btn');
  const fabButton = panel.querySelector('.fab');

  translateButton.addEventListener('click', () => {
    translateEntirePage({ forceShowPanel: true });
  });

  closeButton.addEventListener('click', () => {
    hideFloatingPanel();
  });

  fabButton.addEventListener('click', () => {
    if (panel.dataset.collapsed === 'true') {
      expandFloatingPanel({ userInitiated: true });
      schedulePanelCollapse();
    } else {
      collapseFloatingPanel({ force: true });
    }
  });

  panel.addEventListener('focusin', (event) => {
    cancelPanelCollapse();
    if (event.target !== fabButton) {
      expandFloatingPanel();
    }
  });

  panel.addEventListener('focusout', () => {
    if (!panel.contains(document.activeElement)) {
      schedulePanelCollapse();
    }
  });

  document.body.appendChild(panel);

  floatingPanelState.panel = panel;
  floatingPanelState.status = status;
  floatingPanelState.translateButton = translateButton;
  floatingPanelState.placeholderButton = placeholderButton;
  floatingPanelState.detectedLanguage = detectedElement;
  floatingPanelState.targetLanguage = targetElement;
  floatingPanelState.fab = fabButton;

  return floatingPanelState;
}

function showFloatingPanel({ detectedLanguage, targetLanguage, status, tone = 'info', expand = false }) {
  const { panel } = getFloatingPanelElements();
  updateFloatingPanelLanguages(detectedLanguage, targetLanguage);
  updateFloatingPanelStatus(status, tone);
  panel.dataset.visible = 'true';
  panel.setAttribute('aria-hidden', 'false');
  if (expand) {
    expandFloatingPanel({ userInitiated: true });
    schedulePanelCollapse();
  } else {
    collapseFloatingPanel({ force: true });
  }
}

function hideFloatingPanel() {
  if (!floatingPanelState.panel) {
    return;
  }
  cancelPanelCollapse();
  floatingPanelState.panel.dataset.collapsed = 'false';
  floatingPanelState.panel.dataset.visible = 'false';
  floatingPanelState.panel.setAttribute('aria-hidden', 'true');
  floatingPanelState.panel.setAttribute('aria-expanded', 'false');
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

function getDetectionMode() {
  if (!currentProfile) {
    return 'simple';
  }

  if (currentProfile.type === 'generic') {
    return currentProfile.detection?.mode || 'simple';
  }

  if (currentProfile.type === 'google' || currentProfile.type === 'baidu') {
    return currentProfile.detection?.mode || 'provider';
  }

  return 'simple';
}

function expandFloatingPanel({ userInitiated = false } = {}) {
  if (!floatingPanelState.panel) {
    return;
  }
  floatingPanelState.panel.dataset.collapsed = 'false';
  floatingPanelState.panel.setAttribute('aria-expanded', 'true');
  if (userInitiated) {
    floatingPanelState.panel.dataset.visible = 'true';
    floatingPanelState.panel.setAttribute('aria-hidden', 'false');
  }
}

function collapseFloatingPanel({ force = false } = {}) {
  if (!floatingPanelState.panel) {
    return;
  }
  if (translationInProgress && !force) {
    return;
  }
  floatingPanelState.panel.dataset.visible = 'true';
  floatingPanelState.panel.dataset.collapsed = 'true';
  floatingPanelState.panel.setAttribute('aria-expanded', 'false');
}

function schedulePanelCollapse(delay = PANEL_COLLAPSE_DELAY) {
  const { panel } = getFloatingPanelElements();
  cancelPanelCollapse();
  if (!panel || panel.dataset.visible !== 'true' || translationInProgress) {
    return;
  }

  const timeout = Math.max(2000, delay);
  floatingPanelState.collapseTimer = setTimeout(() => {
    if (
      floatingPanelState.panel &&
      floatingPanelState.panel.dataset.visible === 'true' &&
      !translationInProgress
    ) {
      collapseFloatingPanel();
    }
  }, timeout);
}

function cancelPanelCollapse() {
  if (floatingPanelState.collapseTimer) {
    clearTimeout(floatingPanelState.collapseTimer);
    floatingPanelState.collapseTimer = null;
  }
}

async function translateEntirePage({ forceShowPanel = false } = {}) {
  await ensureSettingsLoaded();

  if (!currentSettings.enablePageTranslation) {
    showFloatingPanel({
      detectedLanguage: detectedPageLanguage || '未知',
      targetLanguage: currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
      status: '整页翻译功能已在设置中关闭，可在扩展选项中重新启用。',
      tone: 'warning',
      expand: true
    });
    return;
  }

  const nodes = collectTranslatableTextNodes();
  if (nodes.length === 0) {
    showFloatingPanel({
      detectedLanguage: detectedPageLanguage || '未知',
      targetLanguage: currentSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
      status: '未找到可翻译的文本。',
      tone: 'warning',
      expand: true
    });
    return;
  }

  const { panel, translateButton } = getFloatingPanelElements();
  if (forceShowPanel) {
    panel.dataset.visible = 'true';
    panel.setAttribute('aria-hidden', 'false');
  }

  expandFloatingPanel({ userInitiated: true });
  cancelPanelCollapse();

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
    schedulePanelCollapse(6000);
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

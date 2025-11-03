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
const SELECTION_DEBOUNCE_DELAY = 120;
const SELECTION_BUBBLE_OFFSET = 8;

const selectionBubbleState = {
  bubble: null,
  actionButton: null,
  closeButton: null,
  status: null,
  range: null,
  selectedText: '',
  visible: false,
  translating: false,
  requestId: 0,
  debounceTimer: null,
  viewportTimer: null
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
    applySettings(changes.settings.newValue);

    if (!currentSettings.enablePageTranslation) {
      hideFloatingPanel();
      return;
    }

    scheduleLanguageDetection(300);
  });

  document.addEventListener('selectionchange', handleSelectionChange);
  document.addEventListener('mousedown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleSelectionKeydown, true);
  window.addEventListener('scroll', handleViewportMovement, true);
  window.addEventListener('resize', handleViewportMovement, true);
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
      width: 280px;
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
      transition: width 0.2s ease, height 0.2s ease, padding 0.2s ease, border-radius 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
    }
    #${PANEL_ID}[data-visible="true"] {
      display: flex;
    }
    #${PANEL_ID}[data-collapsed="true"] {
      width: auto;
      height: auto;
      padding: 0;
      border-radius: 999px;
      align-items: center;
      justify-content: center;
      gap: 0;
      background: transparent;
      box-shadow: none;
    }
    #${PANEL_ID} .panel-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
    }
    #${PANEL_ID}[data-collapsed="true"] .panel-content,
    #${PANEL_ID}[data-collapsed="true"] .close-btn {
      display: none;
    }
    #${PANEL_ID} .fab {
      display: none;
      width: 44px;
      height: 44px;
      border-radius: 22px;
      border: none;
      background: linear-gradient(135deg, #38bdf8, #0ea5e9);
      color: #0f172a;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 12px 26px rgba(14, 165, 233, 0.35);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #${PANEL_ID} .fab:hover {
      transform: translateY(-1px);
      box-shadow: 0 18px 32px rgba(14, 165, 233, 0.4);
    }
    #${PANEL_ID} .fab svg {
      width: 22px;
      height: 22px;
    }
    #${PANEL_ID}[data-collapsed="true"] .fab {
      display: inline-flex;
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
    #${BUBBLE_ID} {
      position: absolute;
      z-index: 2147483647;
      display: none;
      align-items: flex-start;
      gap: 8px;
      pointer-events: auto;
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #${BUBBLE_ID}[data-visible="true"] {
      display: flex;
    }
    #${BUBBLE_ID} .bubble-action {
      width: 40px;
      height: 40px;
      border-radius: 20px;
      border: none;
      background: linear-gradient(135deg, #38bdf8, #0ea5e9);
      color: #0f172a;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 12px 28px rgba(14, 165, 233, 0.35);
      display: none;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #${BUBBLE_ID} .bubble-action:hover {
      transform: translateY(-1px);
      box-shadow: 0 16px 30px rgba(14, 165, 233, 0.35);
    }
    #${BUBBLE_ID} .bubble-icon {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    #${BUBBLE_ID} .bubble-card {
      display: none;
      flex-direction: column;
      min-width: 220px;
      max-width: 320px;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.96);
      color: #f8fafc;
      box-shadow: 0 18px 38px rgba(15, 23, 42, 0.35);
      backdrop-filter: blur(10px);
    }
    #${BUBBLE_ID}[data-state="ready"] .bubble-action {
      display: inline-flex;
    }
    #${BUBBLE_ID}[data-state="ready"] .bubble-card {
      display: none;
    }
    #${BUBBLE_ID}[data-state="ready"] .bubble-close {
      display: none;
    }
    #${BUBBLE_ID}[data-state="loading"] .bubble-card,
    #${BUBBLE_ID}[data-state="result"] .bubble-card,
    #${BUBBLE_ID}[data-state="error"] .bubble-card {
      display: flex;
    }
    #${BUBBLE_ID}[data-state="loading"] .bubble-action,
    #${BUBBLE_ID}[data-state="result"] .bubble-action,
    #${BUBBLE_ID}[data-state="error"] .bubble-action {
      display: none;
    }
    #${BUBBLE_ID} .bubble-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    #${BUBBLE_ID} .bubble-title {
      font-size: 13px;
      font-weight: 600;
    }
    #${BUBBLE_ID} .bubble-close {
      border: none;
      background: transparent;
      color: #cbd5f5;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      padding: 4px;
    }
    #${BUBBLE_ID} .bubble-close:hover {
      color: #f1f5f9;
    }
    #${BUBBLE_ID} .bubble-status {
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #${BUBBLE_ID}[data-state="loading"] .bubble-status {
      opacity: 0.85;
    }
    #${BUBBLE_ID}[data-state="error"] .bubble-card {
      background: rgba(185, 28, 28, 0.94);
      box-shadow: 0 18px 34px rgba(127, 29, 29, 0.4);
    }
    #${BUBBLE_ID}[data-state="error"] .bubble-status {
      color: #fef3c7;
    }
  `;

  document.head.appendChild(style);
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
  panel.setAttribute('aria-hidden', 'true');

  panel.innerHTML = `
    <button type="button" class="fab" aria-label="展开翻译面板">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M4 4h7v2H6.41l3.3 3.3-1.41 1.4L5 7.41V11H3V4zm9 0h8v2h-3.59l-2.7 2.7 1.41 1.4L20 7.41V11h2V4a1 1 0 0 0-1-1h-8zm6 9v7h-7v-2h3.59l-3.3-3.3 1.41-1.4L16 16.59V13zM4 13h2v3.59l2.7-2.7 1.41 1.4L7.41 18H11v2H4z"
        />
      </svg>
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
      collapseFloatingPanel();
    }
  });

  panel.addEventListener('mouseenter', () => {
    if (panel.dataset.collapsed === 'false') {
      cancelPanelCollapse();
    }
  });

  panel.addEventListener('mouseleave', () => {
    if (panel.dataset.collapsed === 'false') {
      schedulePanelCollapse();
    }
  });

  panel.addEventListener('focusin', () => {
    if (panel.dataset.collapsed === 'false') {
      cancelPanelCollapse();
    }
  });

  panel.addEventListener('focusout', () => {
    if (!panel.contains(document.activeElement) && panel.dataset.collapsed === 'false') {
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

function showFloatingPanel({ detectedLanguage, targetLanguage, status, tone = 'info', autoExpand = false }) {
  const { panel } = getFloatingPanelElements();
  updateFloatingPanelLanguages(detectedLanguage, targetLanguage);
  updateFloatingPanelStatus(status, tone);
  panel.dataset.visible = 'true';
  panel.setAttribute('aria-hidden', 'false');
  if (autoExpand) {
    expandFloatingPanel({ userInitiated: true });
    schedulePanelCollapse();
  } else {
    collapseFloatingPanel();
  }
}

function hideFloatingPanel() {
  if (!floatingPanelState.panel) {
    return;
  }
  cancelPanelCollapse();
  floatingPanelState.panel.dataset.collapsed = 'true';
  floatingPanelState.panel.dataset.visible = 'false';
  floatingPanelState.panel.setAttribute('aria-hidden', 'true');
  floatingPanelState.panel.setAttribute('aria-expanded', 'false');
  if (floatingPanelState.fab) {
    floatingPanelState.fab.setAttribute('aria-pressed', 'false');
  }
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
  floatingPanelState.panel.setAttribute('aria-hidden', 'false');
  if (floatingPanelState.fab) {
    floatingPanelState.fab.setAttribute('aria-pressed', 'true');
  }
  if (userInitiated) {
    floatingPanelState.panel.dataset.visible = 'true';
    floatingPanelState.panel.setAttribute('aria-hidden', 'false');
  }
}

function collapseFloatingPanel() {
  if (!floatingPanelState.panel || translationInProgress) {
    return;
  }
  floatingPanelState.panel.dataset.collapsed = 'true';
  floatingPanelState.panel.setAttribute('aria-expanded', 'false');
  floatingPanelState.panel.setAttribute('aria-hidden', 'false');
  if (floatingPanelState.fab) {
    floatingPanelState.fab.setAttribute('aria-pressed', 'false');
  }
}

function schedulePanelCollapse(delay = PANEL_COLLAPSE_DELAY) {
  const { panel } = getFloatingPanelElements();
  cancelPanelCollapse();
  if (!panel || panel.dataset.visible !== 'true' || translationInProgress || panel.dataset.collapsed === 'true') {
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
      autoExpand: true
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
      autoExpand: true
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

function ensureSelectionBubbleElements() {
  if (selectionBubbleState.bubble) {
    return selectionBubbleState;
  }

  const bubble = document.createElement('div');
  bubble.id = BUBBLE_ID;
  bubble.setAttribute(TRANSLATOR_DATA_ATTRIBUTE, 'true');
  bubble.dataset.visible = 'false';
  bubble.dataset.state = 'ready';
  bubble.setAttribute('aria-hidden', 'true');
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-live', 'polite');
  bubble.innerHTML = `
    <button type="button" class="bubble-action" aria-label="翻译选中文本">
      <span class="bubble-icon">译</span>
    </button>
    <div class="bubble-card" role="document">
      <div class="bubble-header">
        <span class="bubble-title">划词翻译</span>
        <button type="button" class="bubble-close" aria-label="关闭划词翻译">×</button>
      </div>
      <div class="bubble-status"></div>
    </div>
  `;

  document.body.appendChild(bubble);

  const actionButton = bubble.querySelector('.bubble-action');
  const closeButton = bubble.querySelector('.bubble-close');
  const status = bubble.querySelector('.bubble-status');

  actionButton.addEventListener('click', () => {
    startSelectionBubbleTranslation();
  });

  closeButton.addEventListener('click', () => {
    hideSelectionBubble();
  });

  selectionBubbleState.bubble = bubble;
  selectionBubbleState.actionButton = actionButton;
  selectionBubbleState.closeButton = closeButton;
  selectionBubbleState.status = status;

  return selectionBubbleState;
}

function captureCurrentSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { text: '', range: null };
  }

  if (isInsideTranslatorElement(selection.anchorNode) || isInsideTranslatorElement(selection.focusNode)) {
    return { text: '', range: null };
  }

  const text = selection.toString();
  if (!text.trim()) {
    return { text: '', range: null };
  }

  let range = null;
  try {
    range = selection.getRangeAt(0).cloneRange();
  } catch (error) {
    range = null;
  }

  return { text, range };
}

function showSelectionBubblePrompt(text, range) {
  const { bubble, actionButton, status } = ensureSelectionBubbleElements();
  selectionBubbleState.selectedText = text;
  selectionBubbleState.range = range || selectionBubbleState.range;
  selectionBubbleState.visible = true;
  selectionBubbleState.translating = false;
  bubble.dataset.visible = 'true';
  bubble.dataset.state = 'ready';
  bubble.setAttribute('aria-hidden', 'false');
  bubble.setAttribute('aria-busy', 'false');
  status.textContent = '';
  actionButton.disabled = false;
  positionSelectionBubble(range);
}

function showSelectionBubbleMessage(text, tone = 'result') {
  const { bubble, status, actionButton } = ensureSelectionBubbleElements();
  selectionBubbleState.visible = true;
  selectionBubbleState.translating = false;
  selectionBubbleState.selectedText = '';
  selectionBubbleState.range = null;
  bubble.dataset.visible = 'true';
  bubble.dataset.state = tone === 'error' ? 'error' : 'result';
  bubble.setAttribute('aria-hidden', 'false');
  bubble.setAttribute('aria-busy', 'false');
  status.textContent = text;
  actionButton.disabled = false;
  positionSelectionBubble();
}

async function startSelectionBubbleTranslation({ text, range } = {}) {
  await ensureSettingsLoaded();

  const captured =
    typeof text === 'string'
      ? { text, range: range || null }
      : captureCurrentSelection();

  const resolvedText = captured.text?.trim() || selectionBubbleState.selectedText?.trim() || '';
  const resolvedRange = captured.range || selectionBubbleState.range || null;

  if (!resolvedText) {
    showSelectionBubbleMessage('请先选择需要翻译的文本。', 'error');
    return;
  }

  const { bubble, actionButton, status } = ensureSelectionBubbleElements();
  selectionBubbleState.selectedText = resolvedText;
  selectionBubbleState.range = resolvedRange;
  selectionBubbleState.visible = true;
  selectionBubbleState.translating = true;
  selectionBubbleState.requestId += 1;
  const requestId = selectionBubbleState.requestId;

  bubble.dataset.visible = 'true';
  bubble.dataset.state = 'loading';
  bubble.setAttribute('aria-hidden', 'false');
  bubble.setAttribute('aria-busy', 'true');
  status.textContent = '翻译中...';
  actionButton.disabled = true;

  positionSelectionBubble(resolvedRange);

  try {
    const response = await requestTranslation(resolvedText);
    if (selectionBubbleState.requestId !== requestId) {
      return;
    }
    if (!response?.success) {
      throw new Error(response?.error || '翻译失败，请稍后再试。');
    }
    bubble.dataset.state = 'result';
    status.textContent = response.translation || '';
  } catch (error) {
    if (selectionBubbleState.requestId !== requestId) {
      return;
    }
    bubble.dataset.state = 'error';
    status.textContent = error.message || '翻译失败，请稍后再试。';
  } finally {
    if (selectionBubbleState.requestId === requestId) {
      bubble.setAttribute('aria-busy', 'false');
      selectionBubbleState.translating = false;
      actionButton.disabled = false;
      selectionBubbleState.visible = true;
      positionSelectionBubble(resolvedRange);
    }
  }
}

function positionSelectionBubble(range) {
  if (!selectionBubbleState.bubble) {
    return;
  }

  const bubble = selectionBubbleState.bubble;
  const targetRange = range || selectionBubbleState.range || null;
  let top = window.scrollY + 24;
  let left = window.scrollX + 24;
  let rect = null;

  if (targetRange) {
    try {
      rect = targetRange.getBoundingClientRect();
    } catch (error) {
      rect = null;
    }
  }

  if (rect && (rect.width || rect.height)) {
    top = rect.bottom + window.scrollY + SELECTION_BUBBLE_OFFSET;
    left = rect.left + window.scrollX;
  }

  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;

  requestAnimationFrame(() => {
    if (!selectionBubbleState.bubble || selectionBubbleState.bubble.dataset.visible !== 'true') {
      return;
    }

    const bubbleRect = bubble.getBoundingClientRect();
    const viewportPadding = 12;

    let adjustedLeft = bubbleRect.left + window.scrollX;
    let adjustedTop = bubbleRect.top + window.scrollY;
    const maxLeft = window.scrollX + window.innerWidth - bubbleRect.width - viewportPadding;
    const minLeft = window.scrollX + viewportPadding;
    const maxTop = window.scrollY + window.innerHeight - bubbleRect.height - viewportPadding;
    const minTop = window.scrollY + viewportPadding;

    adjustedLeft = Math.min(Math.max(adjustedLeft, minLeft), Math.max(minLeft, maxLeft));

    if (adjustedTop > maxTop && rect) {
      const above = rect.top + window.scrollY - bubbleRect.height - SELECTION_BUBBLE_OFFSET;
      if (above >= minTop) {
        adjustedTop = above;
      }
    }

    adjustedTop = Math.min(Math.max(adjustedTop, minTop), Math.max(minTop, maxTop));

    bubble.style.left = `${adjustedLeft}px`;
    bubble.style.top = `${adjustedTop}px`;
  });
}

function handleSelectionChange() {
  if (selectionBubbleState.debounceTimer) {
    clearTimeout(selectionBubbleState.debounceTimer);
  }
  selectionBubbleState.debounceTimer = setTimeout(() => {
    selectionBubbleState.debounceTimer = null;
    updateSelectionBubbleFromSelection();
  }, SELECTION_DEBOUNCE_DELAY);
}

function updateSelectionBubbleFromSelection() {
  const { text, range } = captureCurrentSelection();
  if (!text.trim()) {
    if (!selectionBubbleState.translating) {
      hideSelectionBubble();
    }
    return;
  }

  if (selectionBubbleState.translating) {
    return;
  }

  showSelectionBubblePrompt(text, range);
}

function handleDocumentPointerDown(event) {
  if (!selectionBubbleState.visible) {
    return;
  }

  const target = event.target;
  if (selectionBubbleState.bubble && selectionBubbleState.bubble.contains(target)) {
    return;
  }

  if (isInsideTranslatorElement(target)) {
    return;
  }

  if (selectionBubbleState.translating) {
    return;
  }

  hideSelectionBubble();
}

function handleSelectionKeydown(event) {
  if (event.key === 'Escape' && selectionBubbleState.visible) {
    hideSelectionBubble();
  }
}

function handleViewportMovement() {
  if (!selectionBubbleState.visible || !selectionBubbleState.bubble) {
    return;
  }

  if (selectionBubbleState.viewportTimer) {
    cancelAnimationFrame(selectionBubbleState.viewportTimer);
  }

  selectionBubbleState.viewportTimer = requestAnimationFrame(() => {
    selectionBubbleState.viewportTimer = null;
    positionSelectionBubble();
  });
}

function hideSelectionBubble() {
  if (!selectionBubbleState.bubble) {
    return;
  }

  if (selectionBubbleState.debounceTimer) {
    clearTimeout(selectionBubbleState.debounceTimer);
    selectionBubbleState.debounceTimer = null;
  }

  if (selectionBubbleState.viewportTimer) {
    cancelAnimationFrame(selectionBubbleState.viewportTimer);
    selectionBubbleState.viewportTimer = null;
  }

  selectionBubbleState.requestId += 1;
  selectionBubbleState.visible = false;
  selectionBubbleState.translating = false;
  selectionBubbleState.selectedText = '';
  selectionBubbleState.range = null;
  selectionBubbleState.bubble.dataset.visible = 'false';
  selectionBubbleState.bubble.dataset.state = 'ready';
  selectionBubbleState.bubble.setAttribute('aria-hidden', 'true');
  selectionBubbleState.bubble.setAttribute('aria-busy', 'false');
  if (selectionBubbleState.status) {
    selectionBubbleState.status.textContent = '';
  }
  if (selectionBubbleState.actionButton) {
    selectionBubbleState.actionButton.disabled = false;
  }
}

function isInsideTranslatorElement(node) {
  if (!node) {
    return false;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return (
      node.hasAttribute?.(TRANSLATOR_DATA_ATTRIBUTE) ||
      Boolean(node.closest?.(`[${TRANSLATOR_DATA_ATTRIBUTE}]`))
    );
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return isInsideTranslatorElement(node.parentElement);
  }

  return false;
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
    const captured = captureCurrentSelection();

    if (!captured.text.trim()) {
      showSelectionBubbleMessage('请先选择需要翻译的文本。', 'error');
      return;
    }

    showSelectionBubblePrompt(captured.text, captured.range);
    await startSelectionBubbleTranslation({ text: captured.text, range: captured.range });
  }

  if (message?.type === 'translate-entire-page') {
    translateEntirePage({ forceShowPanel: true });
  }
});

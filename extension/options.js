const form = document.getElementById('settings-form');
const profileSelect = document.getElementById('profile-select');
const profileNameInput = document.getElementById('profile-name');
const profileTypeSelect = document.getElementById('profile-type');
const addProfileButton = document.getElementById('add-profile');
const duplicateProfileButton = document.getElementById('duplicate-profile');
const removeProfileButton = document.getElementById('remove-profile');
const statusBox = document.getElementById('status');

// Generic inputs
const endpointInput = document.getElementById('endpoint');
const apiKeyInput = document.getElementById('api-key');
const requestMethodSelect = document.getElementById('request-method');
const promptTemplateInput = document.getElementById('prompt-template');
const requestBodyTemplateInput = document.getElementById('request-body-template');
const customHeadersInput = document.getElementById('custom-headers');
const responsePathInput = document.getElementById('response-path');
const detectionModeSelect = document.getElementById('detection-mode');
const detectionEndpointInput = document.getElementById('detection-endpoint');
const detectionRequestMethodSelect = document.getElementById('detection-request-method');
const detectionPromptTemplateInput = document.getElementById('detection-prompt-template');
const detectionRequestBodyTemplateInput = document.getElementById('detection-request-body-template');
const detectionCustomHeadersInput = document.getElementById('detection-custom-headers');
const detectionResponsePathInput = document.getElementById('detection-response-path');
const detectionTemplateFields = document.querySelectorAll('[data-detection-template]');

// Google inputs
const googleEndpointInput = document.getElementById('google-endpoint');
const googleApiKeyInput = document.getElementById('google-api-key');
const googleFormatSelect = document.getElementById('google-format');
const googleModelInput = document.getElementById('google-model');
const googleDetectionModeSelect = document.getElementById('google-detection-mode');
const googleDetectionEndpointInput = document.getElementById('google-detection-endpoint');

// Baidu inputs
const baiduEndpointInput = document.getElementById('baidu-endpoint');
const baiduAppIdInput = document.getElementById('baidu-app-id');
const baiduAppSecretInput = document.getElementById('baidu-app-secret');
const baiduDomainInput = document.getElementById('baidu-domain');
const baiduDetectionModeSelect = document.getElementById('baidu-detection-mode');
const baiduDetectionEndpointInput = document.getElementById('baidu-detection-endpoint');

// Global inputs
const sourceLanguageInput = document.getElementById('source-language');
const targetLanguageInput = document.getElementById('target-language');
const enablePageTranslationInput = document.getElementById('enable-page-translation');
const autoDetectPageLanguageInput = document.getElementById('auto-detect-page-language');
const autoShowFloatingPanelInput = document.getElementById('auto-show-floating-panel');
const pageTranslationBatchSizeInput = document.getElementById('page-translation-batch-size');

const profileSections = document.querySelectorAll('[data-profile-section]');

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

let currentSettings = structuredClone(DEFAULT_SETTINGS);

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
    translation: structuredClone(DEFAULT_GENERIC_TRANSLATION),
    detection: structuredClone(DEFAULT_GENERIC_DETECTION)
  };
}

function generateProfileId(type) {
  return `${type}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSettings(rawSettings = {}) {
  const migrated = migrateLegacySettings(rawSettings);
  const result = { ...structuredClone(DEFAULT_SETTINGS), ...migrated };

  const profilesArray = Array.isArray(migrated?.profiles) && migrated.profiles.length > 0
    ? migrated.profiles
    : structuredClone(DEFAULT_PROFILES);

  result.profiles = profilesArray.map((profile) => normalizeProfile(profile));

  if (!result.profiles.find((profile) => profile.id === result.activeProfileId)) {
    result.activeProfileId = result.profiles[0].id;
  }

  result.sourceLanguage = migrated?.sourceLanguage || 'auto';
  result.targetLanguage = migrated?.targetLanguage || 'zh-CN';
  result.enablePageTranslation = Boolean(
    migrated?.enablePageTranslation ?? DEFAULT_SETTINGS.enablePageTranslation
  );
  result.autoDetectPageLanguage = Boolean(
    migrated?.autoDetectPageLanguage ?? DEFAULT_SETTINGS.autoDetectPageLanguage
  );
  result.autoShowFloatingPanel = Boolean(
    migrated?.autoShowFloatingPanel ?? DEFAULT_SETTINGS.autoShowFloatingPanel
  );
  result.pageTranslationBatchSize = Number(
    migrated?.pageTranslationBatchSize ?? DEFAULT_SETTINGS.pageTranslationBatchSize
  );

  return result;
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
      ...structuredClone(DEFAULT_GENERIC_TRANSLATION),
      ...profile.translation
    },
    detection: {
      ...structuredClone(DEFAULT_GENERIC_DETECTION),
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

async function restoreOptions() {
  const { settings } = await chrome.storage.sync.get('settings');
  currentSettings = normalizeSettings(settings);

  populateGeneralFields();
  populateProfileSelect();
  loadProfileFields(getActiveProfile());
}

function populateGeneralFields() {
  sourceLanguageInput.value = currentSettings.sourceLanguage || 'auto';
  targetLanguageInput.value = currentSettings.targetLanguage || 'zh-CN';
  enablePageTranslationInput.checked = Boolean(currentSettings.enablePageTranslation);
  autoDetectPageLanguageInput.checked = Boolean(currentSettings.autoDetectPageLanguage);
  autoShowFloatingPanelInput.checked = Boolean(currentSettings.autoShowFloatingPanel);
  pageTranslationBatchSizeInput.value =
    Number(currentSettings.pageTranslationBatchSize) || DEFAULT_SETTINGS.pageTranslationBatchSize;
}

function populateProfileSelect() {
  profileSelect.innerHTML = '';
  currentSettings.profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || '未命名模板';
    profileSelect.appendChild(option);
  });
  profileSelect.value = currentSettings.activeProfileId;
}

function getActiveProfile() {
  return (
    currentSettings.profiles.find((profile) => profile.id === currentSettings.activeProfileId) ||
    currentSettings.profiles[0]
  );
}

function loadProfileFields(profile) {
  if (!profile) {
    return;
  }

  profileSelect.value = profile.id;
  profileNameInput.value = profile.name;
  profileTypeSelect.value = profile.type;

  profileSections.forEach((section) => {
    section.hidden = section.dataset.profileSection !== profile.type;
  });

  if (profile.type === 'generic') {
    endpointInput.value = profile.translation.endpoint || '';
    apiKeyInput.value = profile.translation.apiKey || '';
    requestMethodSelect.value = profile.translation.requestMethod || 'POST';
    promptTemplateInput.value = profile.translation.promptTemplate || '';
    requestBodyTemplateInput.value = profile.translation.requestBodyTemplate || '';
    customHeadersInput.value = profile.translation.customHeaders || '{}';
    responsePathInput.value = profile.translation.responsePath || 'translation';

    detectionModeSelect.value = profile.detection.mode || 'simple';
    detectionEndpointInput.value = profile.detection.endpoint || '';
    detectionRequestMethodSelect.value = profile.detection.requestMethod || 'POST';
    detectionPromptTemplateInput.value = profile.detection.promptTemplate || '';
    detectionRequestBodyTemplateInput.value = profile.detection.requestBodyTemplate || '';
    detectionCustomHeadersInput.value = profile.detection.customHeaders || '{}';
    detectionResponsePathInput.value = profile.detection.responsePath || '';

    syncGenericDetectionVisibility();
  }

  if (profile.type === 'google') {
    googleEndpointInput.value = profile.translation.endpoint || '';
    googleApiKeyInput.value = profile.translation.apiKey || '';
    googleFormatSelect.value = profile.translation.format || 'text';
    googleModelInput.value = profile.translation.model || '';

    googleDetectionModeSelect.value = profile.detection.mode || 'provider';
    googleDetectionEndpointInput.value = profile.detection.endpoint || '';

    syncGoogleDetectionVisibility();
  }

  if (profile.type === 'baidu') {
    baiduEndpointInput.value = profile.translation.endpoint || '';
    baiduAppIdInput.value = profile.translation.appId || '';
    baiduAppSecretInput.value = profile.translation.appSecret || '';
    baiduDomainInput.value = profile.translation.domain || 'general';

    baiduDetectionModeSelect.value = profile.detection.mode || 'provider';
    baiduDetectionEndpointInput.value = profile.detection.endpoint || '';

    syncBaiduDetectionVisibility();
  }
}

function captureCurrentProfileChanges() {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  profile.name = profileNameInput.value.trim() || profile.name;
  profile.type = profileTypeSelect.value;

  if (profile.type === 'generic') {
    profile.translation.endpoint = endpointInput.value.trim();
    profile.translation.apiKey = apiKeyInput.value.trim();
    profile.translation.requestMethod = requestMethodSelect.value;
    profile.translation.promptTemplate =
      promptTemplateInput.value.trim() || DEFAULT_GENERIC_TRANSLATION.promptTemplate;
    profile.translation.requestBodyTemplate =
      requestBodyTemplateInput.value.trim() || DEFAULT_GENERIC_TRANSLATION.requestBodyTemplate;
    profile.translation.customHeaders = customHeadersInput.value.trim() || '{}';
    profile.translation.responsePath = responsePathInput.value.trim() || 'translation';

    profile.detection.mode = detectionModeSelect.value;
    profile.detection.endpoint = detectionEndpointInput.value.trim();
    profile.detection.requestMethod = detectionRequestMethodSelect.value;
    profile.detection.promptTemplate =
      detectionPromptTemplateInput.value.trim() || DEFAULT_GENERIC_DETECTION.promptTemplate;
    profile.detection.requestBodyTemplate =
      detectionRequestBodyTemplateInput.value.trim() || DEFAULT_GENERIC_DETECTION.requestBodyTemplate;
    profile.detection.customHeaders = detectionCustomHeadersInput.value.trim() || '{}';
    profile.detection.responsePath = detectionResponsePathInput.value.trim();
  }

  if (profile.type === 'google') {
    profile.translation.endpoint = googleEndpointInput.value.trim() ||
      'https://translation.googleapis.com/language/translate/v2';
    profile.translation.apiKey = googleApiKeyInput.value.trim();
    profile.translation.format = googleFormatSelect.value;
    profile.translation.model = googleModelInput.value.trim();

    profile.detection.mode = googleDetectionModeSelect.value;
    profile.detection.endpoint =
      googleDetectionEndpointInput.value.trim() ||
      'https://translation.googleapis.com/language/translate/v2/detect';
  }

  if (profile.type === 'baidu') {
    profile.translation.endpoint = baiduEndpointInput.value.trim() ||
      'https://fanyi-api.baidu.com/api/trans/vip/translate';
    profile.translation.appId = baiduAppIdInput.value.trim();
    profile.translation.appSecret = baiduAppSecretInput.value.trim();
    profile.translation.domain = baiduDomainInput.value.trim() || 'general';

    profile.detection.mode = baiduDetectionModeSelect.value;
    profile.detection.endpoint =
      baiduDetectionEndpointInput.value.trim() ||
      'https://fanyi-api.baidu.com/api/trans/vip/language';
  }
}

function syncGenericDetectionVisibility() {
  const mode = detectionModeSelect.value;
  detectionTemplateFields.forEach((field) => {
    field.hidden = mode !== 'llm';
  });
}

function syncGoogleDetectionVisibility() {
  const mode = googleDetectionModeSelect.value;
  googleDetectionEndpointInput.closest('[data-google-detect]').hidden = mode !== 'provider';
}

function syncBaiduDetectionVisibility() {
  const mode = baiduDetectionModeSelect.value;
  baiduDetectionEndpointInput.closest('[data-baidu-detect]').hidden = mode !== 'provider';
}

function addNewProfile() {
  captureCurrentProfileChanges();
  const profile = createDefaultProfile('generic', `自定义模板 ${currentSettings.profiles.length + 1}`);
  currentSettings.profiles.push(profile);
  currentSettings.activeProfileId = profile.id;
  populateProfileSelect();
  loadProfileFields(profile);
}

function duplicateCurrentProfile() {
  captureCurrentProfileChanges();
  const active = getActiveProfile();
  if (!active) {
    return;
  }
  const clone = normalizeProfile({ ...structuredClone(active), id: generateProfileId(active.type) });
  clone.name = `${active.name}（副本）`;
  currentSettings.profiles.push(clone);
  currentSettings.activeProfileId = clone.id;
  populateProfileSelect();
  loadProfileFields(clone);
}

function removeCurrentProfile() {
  if (currentSettings.profiles.length <= 1) {
    alert('至少保留一个模板，无法全部删除。');
    return;
  }

  const active = getActiveProfile();
  if (!active) {
    return;
  }

  if (!confirm(`确定删除模板“${active.name}”吗？`)) {
    return;
  }

  currentSettings.profiles = currentSettings.profiles.filter((profile) => profile.id !== active.id);
  currentSettings.activeProfileId = currentSettings.profiles[0].id;
  populateProfileSelect();
  loadProfileFields(getActiveProfile());
}

profileSelect.addEventListener('change', () => {
  captureCurrentProfileChanges();
  currentSettings.activeProfileId = profileSelect.value;
  loadProfileFields(getActiveProfile());
});

profileNameInput.addEventListener('input', () => {
  const profile = getActiveProfile();
  if (!profile) return;
  profile.name = profileNameInput.value;
  populateProfileSelect();
  profileSelect.value = profile.id;
});

profileTypeSelect.addEventListener('change', () => {
  const profile = getActiveProfile();
  if (!profile) {
    return;
  }

  const newType = profileTypeSelect.value;
  if (profile.type === newType) {
    return;
  }

  if (!confirm('切换模板类型会重置该模板的专属字段，确定继续吗？')) {
    profileTypeSelect.value = profile.type;
    return;
  }

  const updated = createDefaultProfile(newType, profile.name, profile.id);
  const index = currentSettings.profiles.findIndex((item) => item.id === profile.id);
  currentSettings.profiles.splice(index, 1, updated);
  loadProfileFields(updated);
});

detectionModeSelect.addEventListener('change', syncGenericDetectionVisibility);
googleDetectionModeSelect.addEventListener('change', syncGoogleDetectionVisibility);
baiduDetectionModeSelect.addEventListener('change', syncBaiduDetectionVisibility);

addProfileButton.addEventListener('click', addNewProfile);
duplicateProfileButton.addEventListener('click', duplicateCurrentProfile);
removeProfileButton.addEventListener('click', removeCurrentProfile);

async function saveOptions(event) {
  event.preventDefault();

  captureCurrentProfileChanges();

  const batchSizeValue = Number(pageTranslationBatchSizeInput.value);
  const batchSize = Number.isFinite(batchSizeValue)
    ? Math.min(30, Math.max(1, Math.round(batchSizeValue)))
    : DEFAULT_SETTINGS.pageTranslationBatchSize;

  currentSettings.sourceLanguage = sourceLanguageInput.value.trim() || 'auto';
  currentSettings.targetLanguage = targetLanguageInput.value.trim() || 'zh-CN';
  currentSettings.enablePageTranslation = enablePageTranslationInput.checked;
  currentSettings.autoDetectPageLanguage = autoDetectPageLanguageInput.checked;
  currentSettings.autoShowFloatingPanel = autoShowFloatingPanelInput.checked;
  currentSettings.pageTranslationBatchSize = batchSize;

  await chrome.storage.sync.set({ settings: currentSettings });

  statusBox.textContent = '设置已保存。';
  statusBox.className = 'success';

  setTimeout(() => {
    statusBox.textContent = '';
    statusBox.className = '';
  }, 2000);
}

form.addEventListener('submit', saveOptions);

document.addEventListener('DOMContentLoaded', restoreOptions);

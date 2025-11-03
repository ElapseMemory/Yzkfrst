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

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  const normalized = normalizeSettings(settings);
  await chrome.storage.sync.set({ settings: normalized });

  chrome.contextMenus.create({
    id: 'safe-page-translator-selection',
    title: '翻译选中文本',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'safe-page-translator-selection' || !tab?.id) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, {
    type: 'translate-selection'
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'translate-text') {
    handleTranslationRequest(message.payload)
      .then(sendResponse)
      .catch((error) => {
        console.error('Translation failed', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message?.type === 'translate-text-batch') {
    handleBatchTranslationRequest(message.payload)
      .then(sendResponse)
      .catch((error) => {
        console.error('Batch translation failed', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message?.type === 'detect-language') {
    handleDetectionRequest(message.payload)
      .then(sendResponse)
      .catch((error) => {
        console.error('Language detection failed', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

async function handleTranslationRequest(payload = {}) {
  const { text, targetLanguage, sourceLanguage } = payload;
  if (!text?.trim()) {
    return { success: false, error: '没有可翻译的文本。' };
  }

  const { settings, profile } = await loadSettingsWithProfile();

  const resolvedSourceLanguage = normalizeLanguageCode(
    sourceLanguage || settings.sourceLanguage || 'auto'
  );
  const resolvedTargetLanguage = normalizeLanguageCode(
    targetLanguage || settings.targetLanguage || 'zh-CN'
  );

  if (profile.type === 'google') {
    return executeGoogleTranslation({ text, sourceLanguage: resolvedSourceLanguage, targetLanguage: resolvedTargetLanguage, profile });
  }

  if (profile.type === 'baidu') {
    return executeBaiduTranslation({ text, sourceLanguage: resolvedSourceLanguage, targetLanguage: resolvedTargetLanguage, profile });
  }

  return executeGenericTranslation({
    text,
    sourceLanguage: resolvedSourceLanguage,
    targetLanguage: resolvedTargetLanguage,
    profile,
    missingEndpointMessage: '请先在扩展设置中配置翻译服务端点。'
  });
}

async function handleBatchTranslationRequest(payload = {}) {
  const { texts, targetLanguage, sourceLanguage } = payload;
  if (!Array.isArray(texts) || texts.length === 0) {
    return { success: false, error: '没有需要翻译的文本。' };
  }

  const { settings, profile } = await loadSettingsWithProfile();

  const resolvedSourceLanguage = normalizeLanguageCode(
    sourceLanguage || settings.sourceLanguage || 'auto'
  );
  const resolvedTargetLanguage = normalizeLanguageCode(
    targetLanguage || settings.targetLanguage || 'zh-CN'
  );

  const results = [];
  for (const text of texts) {
    if (!text?.trim()) {
      results.push('');
      continue;
    }

    let response;
    if (profile.type === 'google') {
      response = await executeGoogleTranslation({
        text,
        sourceLanguage: resolvedSourceLanguage,
        targetLanguage: resolvedTargetLanguage,
        profile
      });
    } else if (profile.type === 'baidu') {
      response = await executeBaiduTranslation({
        text,
        sourceLanguage: resolvedSourceLanguage,
        targetLanguage: resolvedTargetLanguage,
        profile
      });
    } else {
      response = await executeGenericTranslation({
        text,
        sourceLanguage: resolvedSourceLanguage,
        targetLanguage: resolvedTargetLanguage,
        profile,
        missingEndpointMessage: '请先在扩展设置中配置翻译服务端点。'
      });
    }

    if (!response.success) {
      return response;
    }

    results.push(ensureString(response.translation ?? response.value));
  }

  return { success: true, translations: results };
}

async function handleDetectionRequest(payload = {}) {
  const { text } = payload;
  if (!text?.trim()) {
    return { success: false, error: '没有可分析的文本。' };
  }

  const { settings, profile } = await loadSettingsWithProfile();

  if (profile.type === 'google') {
    if (profile.detection.mode === 'manual') {
      return { success: true, language: normalizeLanguageCode(settings.sourceLanguage || 'auto') };
    }

    if (profile.detection.mode === 'simple') {
      return { success: false, error: '当前模板配置为简单检测，不需要调用接口。' };
    }

    return executeGoogleDetection({ text, profile });
  }

  if (profile.type === 'baidu') {
    if (profile.detection.mode === 'manual') {
      return { success: true, language: normalizeLanguageCode(settings.sourceLanguage || 'auto') };
    }

    if (profile.detection.mode === 'simple') {
      return { success: false, error: '当前模板配置为简单检测，不需要调用接口。' };
    }

    return executeBaiduDetection({ text, profile });
  }

  if (profile.detection.mode === 'manual') {
    return { success: true, language: normalizeLanguageCode(settings.sourceLanguage || 'auto') };
  }

  if (profile.detection.mode !== 'llm') {
    return { success: false, error: '当前模板配置为简单检测，不需要调用接口。' };
  }

  return executeGenericDetection({
    text,
    profile,
    sourceLanguage: settings.sourceLanguage || 'auto',
    targetLanguage: settings.targetLanguage || 'zh-CN',
    missingEndpointMessage: '尚未配置语言识别接口，请在设置中填写。'
  });
}

async function executeGenericTranslation({
  text,
  sourceLanguage,
  targetLanguage,
  profile,
  missingEndpointMessage
}) {
  const { endpoint, apiKey, requestMethod, promptTemplate, requestBodyTemplate, customHeaders, responsePath } =
    profile.translation;

  const response = await executeTemplatedRequest({
    text,
    sourceLanguage,
    targetLanguage,
    apiKey,
    endpoint,
    requestMethod,
    promptTemplate,
    requestBodyTemplate,
    customHeaders,
    responsePath,
    missingEndpointMessage
  });

  if (!response.success) {
    return response;
  }

  return { success: true, translation: ensureString(response.value), raw: response.raw };
}

async function executeGenericDetection({
  text,
  profile,
  sourceLanguage,
  targetLanguage,
  missingEndpointMessage
}) {
  const endpoint = (profile.detection.endpoint || profile.translation.endpoint || '').trim();
  if (!endpoint) {
    return { success: false, error: missingEndpointMessage };
  }

  const response = await executeTemplatedRequest({
    text,
    sourceLanguage,
    targetLanguage,
    apiKey: profile.translation.apiKey,
    endpoint,
    requestMethod: profile.detection.requestMethod || profile.translation.requestMethod,
    promptTemplate: profile.detection.promptTemplate || DEFAULT_GENERIC_DETECTION.promptTemplate,
    requestBodyTemplate:
      profile.detection.requestBodyTemplate || DEFAULT_GENERIC_DETECTION.requestBodyTemplate,
    customHeaders: profile.detection.customHeaders?.trim()
      ? profile.detection.customHeaders
      : profile.translation.customHeaders,
    responsePath: profile.detection.responsePath,
    missingEndpointMessage
  });

  if (!response.success) {
    return response;
  }

  return { success: true, language: ensureString(response.value).trim() };
}

async function executeGoogleTranslation({ text, sourceLanguage, targetLanguage, profile }) {
  const endpoint = profile.translation.endpoint || 'https://translation.googleapis.com/language/translate/v2';
  const apiKey = profile.translation.apiKey?.trim();
  if (!endpoint || !apiKey) {
    return { success: false, error: '请在设置中填写 Google 翻译的接口地址和 API Key。' };
  }

  const url = new URL(endpoint);
  url.searchParams.set('key', apiKey);

  const body = {
    q: text,
    target: targetLanguage || 'zh',
    format: profile.translation.format === 'html' ? 'html' : 'text'
  };

  if (sourceLanguage && sourceLanguage !== 'auto') {
    body.source = sourceLanguage;
  }

  if (profile.translation.model?.trim()) {
    body.model = profile.translation.model.trim();
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google 翻译接口返回异常：${response.status} ${errorText}`);
  }

  const data = await response.json();
  const translation = data?.data?.translations?.[0]?.translatedText;
  if (!translation) {
    throw new Error('未从 Google 翻译返回有效结果，请检查配额和参数。');
  }

  return { success: true, translation: ensureString(translation), raw: data };
}

async function executeGoogleDetection({ text, profile }) {
  const endpoint = profile.detection.endpoint || 'https://translation.googleapis.com/language/translate/v2/detect';
  const apiKey = profile.translation.apiKey?.trim();
  if (!endpoint || !apiKey) {
    return { success: false, error: '请在设置中填写 Google 翻译的 API Key。' };
  }

  const url = new URL(endpoint);
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ q: text.slice(0, 2048) })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google 语言检测接口返回异常：${response.status} ${errorText}`);
  }

  const data = await response.json();
  const language = data?.data?.detections?.[0]?.[0]?.language;
  if (!language) {
    throw new Error('未从 Google 语言检测返回结果。');
  }

  return { success: true, language: normalizeLanguageCode(language), raw: data };
}

async function executeBaiduTranslation({ text, sourceLanguage, targetLanguage, profile }) {
  const endpoint = profile.translation.endpoint || 'https://fanyi-api.baidu.com/api/trans/vip/translate';
  const appId = profile.translation.appId?.trim();
  const appSecret = profile.translation.appSecret?.trim();
  if (!endpoint || !appId || !appSecret) {
    return { success: false, error: '请在设置中填写百度翻译的 AppID 和密钥。' };
  }

  const salt = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const from = normalizeBaiduLanguage(sourceLanguage);
  const to = normalizeBaiduLanguage(targetLanguage, true);
  const signSource = `${appId}${text}${salt}${appSecret}`;
  const sign = await md5(signSource);

  const params = new URLSearchParams();
  params.set('q', text);
  params.set('from', from);
  params.set('to', to);
  params.set('appid', appId);
  params.set('salt', salt);
  params.set('sign', sign);
  if (profile.translation.domain && profile.translation.domain !== 'general') {
    params.set('domain', profile.translation.domain);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`百度翻译接口返回异常：${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (data.error_code) {
    throw new Error(`百度翻译错误 ${data.error_code}: ${data.error_msg}`);
  }

  const translation = data?.trans_result?.[0]?.dst;
  if (!translation) {
    throw new Error('未从百度翻译返回有效结果。');
  }

  return { success: true, translation: ensureString(translation), raw: data };
}

async function executeBaiduDetection({ text, profile }) {
  const endpoint = profile.detection.endpoint || 'https://fanyi-api.baidu.com/api/trans/vip/language';
  const appId = profile.translation.appId?.trim();
  const appSecret = profile.translation.appSecret?.trim();
  if (!endpoint || !appId || !appSecret) {
    return { success: false, error: '请在设置中填写百度翻译的 AppID 和密钥。' };
  }

  const salt = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const signSource = `${appId}${text}${salt}${appSecret}`;
  const sign = await md5(signSource);

  const params = new URLSearchParams();
  params.set('q', text.slice(0, 2000));
  params.set('appid', appId);
  params.set('salt', salt);
  params.set('sign', sign);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`百度语言检测接口返回异常：${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (data.error_code) {
    throw new Error(`百度语言检测错误 ${data.error_code}: ${data.error_msg}`);
  }

  const language = data?.data?.lan;
  if (!language) {
    throw new Error('未从百度语言检测返回结果。');
  }

  return { success: true, language: normalizeLanguageCode(language), raw: data };
}

async function executeTemplatedRequest({
  text,
  sourceLanguage,
  targetLanguage,
  apiKey,
  endpoint,
  requestMethod,
  promptTemplate,
  requestBodyTemplate,
  customHeaders,
  responsePath,
  missingEndpointMessage
}) {
  if (!endpoint) {
    return { success: false, error: missingEndpointMessage || '未配置接口端点。' };
  }

  const templateVariables = {
    text,
    sourceLanguage,
    targetLanguage,
    apiKey: apiKey || ''
  };

  const prompt = renderTemplate(promptTemplate, templateVariables);
  templateVariables.prompt = prompt;

  let requestBody;
  try {
    const requestBodyString = renderTemplate(requestBodyTemplate, templateVariables) || '{}';
    requestBody = JSON.parse(requestBodyString);
  } catch (error) {
    console.error('Failed to render request body template', error);
    return { success: false, error: '请求体模板不是有效的 JSON，请检查设置。' };
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  if (customHeaders?.trim()) {
    try {
      const renderedHeaders = renderTemplate(customHeaders, templateVariables);
      const extraHeaders = JSON.parse(renderedHeaders);
      Object.assign(headers, extraHeaders);
    } catch (error) {
      console.error('Failed to render header template', error);
      return { success: false, error: '请求头模板不是有效的 JSON，请检查设置。' };
    }
  }

  if (apiKey && !hasAuthorizationHeader(headers)) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const method = (requestMethod || 'POST').toUpperCase();
  let requestUrl = endpoint;
  const fetchOptions = {
    method,
    headers
  };

  if (method === 'GET') {
    try {
      const url = new URL(endpoint);
      appendQueryParams(url, requestBody);
      requestUrl = url.toString();
    } catch (error) {
      console.error('Failed to construct GET url', error);
      return { success: false, error: 'GET 请求无法解析接口地址，请确认填写了合法的 URL。' };
    }
  } else {
    fetchOptions.body = JSON.stringify(requestBody);
  }

  const response = await fetch(requestUrl, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`接口返回异常：${response.status} ${errorText}`);
  }

  const data = await response.json().catch(() => ({}));

  let value;
  if (responsePath?.trim()) {
    value = extractValueByPath(data, responsePath);
  }

  if (value === undefined || value === null) {
    value = data.translation ?? data.result ?? data.choices?.[0]?.message?.content ?? data;
  }

  if (value === undefined || value === null) {
    throw new Error('未从接口返回有效结果，请检查响应路径设置。');
  }

  return { success: true, value, raw: data };
}

async function loadSettingsWithProfile() {
  const { settings } = await chrome.storage.sync.get('settings');
  const normalized = normalizeSettings(settings);
  const profile =
    normalized.profiles.find((item) => item.id === normalized.activeProfileId) ||
    normalized.profiles[0];
  return { settings: normalized, profile };
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

function ensureString(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function renderTemplate(template, variables) {
  if (!template) {
    return '';
  }

  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const value = getVariableValue(variables, key);
    return value === undefined || value === null ? '' : String(value);
  });
}

function getVariableValue(variables, key) {
  if (Object.prototype.hasOwnProperty.call(variables, key)) {
    return variables[key];
  }

  if (key.includes('.')) {
    return key.split('.').reduce((acc, segment) => {
      if (acc === undefined || acc === null) {
        return undefined;
      }
      return acc[segment];
    }, variables);
  }

  return undefined;
}

function hasAuthorizationHeader(headers) {
  const lowerKeys = Object.keys(headers).map((key) => key.toLowerCase());
  return lowerKeys.includes('authorization');
}

function appendQueryParams(url, params) {
  if (!params || typeof params !== 'object') {
    return;
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === 'object') {
      url.searchParams.set(key, JSON.stringify(value));
    } else {
      url.searchParams.set(key, String(value));
    }
  });
}

function extractValueByPath(obj, path) {
  if (!path?.trim()) {
    return obj;
  }

  return path
    .split('.')
    .map((segment) => segment.trim())
    .reduce((acc, segment) => {
      if (acc === undefined || acc === null) {
        return undefined;
      }

      if (/^\d+$/.test(segment)) {
        return acc[Number(segment)];
      }

      return acc[segment];
    }, obj);
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

async function md5(message) {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('MD5', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeLanguageCode(language = '') {
  if (!language) {
    return 'auto';
  }
  const normalized = String(language).trim();
  return normalized || 'auto';
}

function normalizeBaiduLanguage(language = '', isTarget = false) {
  const normalizedValue = normalizeLanguageCode(language);
  const normalized = normalizedValue.toLowerCase();
  if (!normalized || normalized === 'auto') {
    return 'auto';
  }

  if (normalized === 'zh-cn' || normalized === 'zh') {
    return isTarget ? 'zh' : 'zh';
  }
  if (normalized === 'zh-tw') {
    return 'cht';
  }
  if (normalized === 'en-us' || normalized === 'en') {
    return 'en';
  }
  if (normalized === 'ja' || normalized === 'jp') {
    return 'jp';
  }
  if (normalized === 'ko' || normalized === 'kr') {
    return 'kor';
  }
  if (normalized === 'fr') {
    return 'fra';
  }
  if (normalized === 'es') {
    return 'spa';
  }
  if (normalized === 'ru') {
    return 'ru';
  }
  if (normalized === 'de') {
    return 'de';
  }
  if (normalized === 'it') {
    return 'it';
  }
  if (normalized === 'pt') {
    return 'pt';
  }
  if (normalized === 'vi') {
    return 'vie';
  }
  if (normalized === 'th') {
    return 'th';
  }
  if (normalized === 'ms' || normalized === 'id') {
    return 'id';
  }
  if (normalized === 'ar') {
    return 'ara';
  }
  if (normalized === 'hi') {
    return 'hi';
  }

  return normalized;
}

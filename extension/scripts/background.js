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
  detectionRequestBodyTemplate:
    '{\n  "text": "{{text}}",\n  "prompt": "{{prompt}}"\n}',
  detectionCustomHeaders: '{}',
  detectionResponsePath: '',
  enablePageTranslation: true,
  autoDetectPageLanguage: true,
  autoShowFloatingPanel: true,
  pageTranslationBatchSize: 8
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get();
  await chrome.storage.sync.set({
    settings: { ...DEFAULT_SETTINGS, ...stored.settings }
  });

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

async function handleTranslationRequest(payload) {
  const { text, targetLanguage, sourceLanguage } = payload;
  if (!text?.trim()) {
    return { success: false, error: '没有可翻译的文本。' };
  }

  const mergedSettings = await loadMergedSettings();

  const resolvedSourceLanguage =
    sourceLanguage || mergedSettings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage;
  const resolvedTargetLanguage =
    targetLanguage || mergedSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;

  const response = await executeTemplatedRequest({
    text,
    sourceLanguage: resolvedSourceLanguage,
    targetLanguage: resolvedTargetLanguage,
    apiKey: mergedSettings.apiKey,
    endpoint: mergedSettings.endpoint,
    requestMethod: mergedSettings.requestMethod,
    promptTemplate: mergedSettings.promptTemplate,
    requestBodyTemplate: mergedSettings.requestBodyTemplate,
    customHeaders: mergedSettings.customHeaders,
    responsePath: mergedSettings.responsePath,
    missingEndpointMessage: '请先在扩展设置中配置翻译服务端点。'
  });

  return {
    success: response.success,
    translation: response.success ? ensureString(response.value) : undefined,
    error: response.success ? undefined : response.error
  };
}

async function handleBatchTranslationRequest(payload = {}) {
  const { texts, targetLanguage, sourceLanguage } = payload;
  if (!Array.isArray(texts) || texts.length === 0) {
    return { success: false, error: '没有需要翻译的文本。' };
  }

  const mergedSettings = await loadMergedSettings();

  const resolvedSourceLanguage =
    sourceLanguage || mergedSettings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage;
  const resolvedTargetLanguage =
    targetLanguage || mergedSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;

  const results = [];
  for (const text of texts) {
    const response = await executeTemplatedRequest({
      text,
      sourceLanguage: resolvedSourceLanguage,
      targetLanguage: resolvedTargetLanguage,
      apiKey: mergedSettings.apiKey,
      endpoint: mergedSettings.endpoint,
      requestMethod: mergedSettings.requestMethod,
      promptTemplate: mergedSettings.promptTemplate,
      requestBodyTemplate: mergedSettings.requestBodyTemplate,
      customHeaders: mergedSettings.customHeaders,
      responsePath: mergedSettings.responsePath,
      missingEndpointMessage: '请先在扩展设置中配置翻译服务端点。'
    });

    if (!response.success) {
      return response;
    }

    results.push(ensureString(response.value));
  }

  return { success: true, translations: results };
}

async function handleDetectionRequest(payload = {}) {
  const { text } = payload;
  if (!text?.trim()) {
    return { success: false, error: '没有可分析的文本。' };
  }

  const mergedSettings = await loadMergedSettings();

  const endpoint = (mergedSettings.detectionEndpoint || mergedSettings.endpoint || '').trim();
  if (!endpoint) {
    return { success: false, error: '尚未配置语言识别接口，请在设置中填写。' };
  }

  const response = await executeTemplatedRequest({
    text,
    sourceLanguage: mergedSettings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage,
    targetLanguage: mergedSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage,
    apiKey: mergedSettings.apiKey,
    endpoint,
    requestMethod: mergedSettings.detectionRequestMethod || mergedSettings.requestMethod,
    promptTemplate:
      mergedSettings.detectionPromptTemplate || DEFAULT_SETTINGS.detectionPromptTemplate,
    requestBodyTemplate:
      mergedSettings.detectionRequestBodyTemplate ||
      DEFAULT_SETTINGS.detectionRequestBodyTemplate,
    customHeaders:
      mergedSettings.detectionCustomHeaders?.trim()
        ? mergedSettings.detectionCustomHeaders
        : mergedSettings.customHeaders,
    responsePath: mergedSettings.detectionResponsePath,
    missingEndpointMessage: '尚未配置语言识别接口，请在设置中填写。'
  });

  if (!response.success) {
    return response;
  }

  return { success: true, language: ensureString(response.value).trim() };
}

async function loadMergedSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
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

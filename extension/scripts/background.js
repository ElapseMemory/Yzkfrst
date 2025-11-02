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
  responsePath: 'translation'
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
    return true; // Keep the message channel open for async response.
  }
});

async function handleTranslationRequest(payload) {
  const { text, targetLanguage, sourceLanguage } = payload;
  if (!text?.trim()) {
    return { success: false, error: '没有可翻译的文本。' };
  }

  const { settings } = await chrome.storage.sync.get('settings');
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };
  const {
    endpoint,
    apiKey,
    requestMethod,
    promptTemplate,
    requestBodyTemplate,
    customHeaders,
    responsePath
  } = mergedSettings;

  if (!endpoint) {
    return { success: false, error: '请先在扩展设置中配置翻译服务端点。' };
  }

  const resolvedSourceLanguage = sourceLanguage || mergedSettings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage;
  const resolvedTargetLanguage = targetLanguage || mergedSettings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;

  const templateVariables = {
    text,
    sourceLanguage: resolvedSourceLanguage,
    targetLanguage: resolvedTargetLanguage,
    apiKey: apiKey || ''
  };

  const prompt = renderTemplate(promptTemplate, templateVariables);
  templateVariables.prompt = prompt;

  let requestBody;
  try {
    const requestBodyString = renderTemplate(requestBodyTemplate, templateVariables);
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

  let requestUrl = endpoint;
  const method = (requestMethod || DEFAULT_SETTINGS.requestMethod || 'POST').toUpperCase();
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
    throw new Error(`翻译接口返回异常：${response.status} ${errorText}`);
  }

  const data = await response.json().catch(() => ({ translation: null }));

  let translation;
  if (responsePath) {
    translation = extractValueByPath(data, responsePath);
  }

  if (translation === undefined || translation === null) {
    translation = data.translation;
  }

  if (translation === undefined || translation === null) {
    throw new Error('未从接口返回翻译结果，请检查响应路径设置。');
  }

  return {
    success: true,
    translation: typeof translation === 'string' ? translation : JSON.stringify(translation)
  };
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

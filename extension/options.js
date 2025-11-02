const form = document.getElementById('settings-form');
const endpointInput = document.getElementById('endpoint');
const apiKeyInput = document.getElementById('api-key');
const sourceLanguageInput = document.getElementById('source-language');
const targetLanguageInput = document.getElementById('target-language');
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
const enablePageTranslationInput = document.getElementById('enable-page-translation');
const autoDetectPageLanguageInput = document.getElementById('auto-detect-page-language');
const autoShowFloatingPanelInput = document.getElementById('auto-show-floating-panel');
const pageTranslationBatchSizeInput = document.getElementById('page-translation-batch-size');
const detectionTemplateFields = document.querySelectorAll('[data-detection-template]');
const statusBox = document.getElementById('status');

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

async function restoreOptions() {
  const { settings } = await chrome.storage.sync.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  endpointInput.value = merged.endpoint;
  apiKeyInput.value = merged.apiKey;
  sourceLanguageInput.value = merged.sourceLanguage;
  targetLanguageInput.value = merged.targetLanguage;
  requestMethodSelect.value = merged.requestMethod;
  promptTemplateInput.value = merged.promptTemplate;
  requestBodyTemplateInput.value = merged.requestBodyTemplate;
  customHeadersInput.value = merged.customHeaders;
  responsePathInput.value = merged.responsePath;
  detectionModeSelect.value = merged.detectionMode;
  detectionEndpointInput.value = merged.detectionEndpoint || '';
  detectionRequestMethodSelect.value = merged.detectionRequestMethod || DEFAULT_SETTINGS.detectionRequestMethod;
  detectionPromptTemplateInput.value =
    merged.detectionPromptTemplate || DEFAULT_SETTINGS.detectionPromptTemplate;
  detectionRequestBodyTemplateInput.value =
    merged.detectionRequestBodyTemplate || DEFAULT_SETTINGS.detectionRequestBodyTemplate;
  detectionCustomHeadersInput.value = merged.detectionCustomHeaders || '{}';
  detectionResponsePathInput.value = merged.detectionResponsePath || '';
  enablePageTranslationInput.checked = Boolean(merged.enablePageTranslation);
  autoDetectPageLanguageInput.checked = Boolean(merged.autoDetectPageLanguage);
  autoShowFloatingPanelInput.checked = Boolean(merged.autoShowFloatingPanel);
  pageTranslationBatchSizeInput.value =
    merged.pageTranslationBatchSize || DEFAULT_SETTINGS.pageTranslationBatchSize;

  syncDetectionTemplateVisibility();
}

async function saveOptions(event) {
  event.preventDefault();

  const batchSizeValue = Number(pageTranslationBatchSizeInput.value);
  const batchSize = Number.isFinite(batchSizeValue)
    ? Math.min(30, Math.max(1, Math.round(batchSizeValue)))
    : DEFAULT_SETTINGS.pageTranslationBatchSize;

  const settings = {
    endpoint: endpointInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    sourceLanguage: sourceLanguageInput.value.trim() || 'auto',
    targetLanguage: targetLanguageInput.value.trim() || 'zh-CN',
    requestMethod: requestMethodSelect.value,
    promptTemplate: promptTemplateInput.value.trim() || DEFAULT_SETTINGS.promptTemplate,
    requestBodyTemplate:
      requestBodyTemplateInput.value.trim() || DEFAULT_SETTINGS.requestBodyTemplate,
    customHeaders: customHeadersInput.value.trim() || '{}',
    responsePath: responsePathInput.value.trim() || DEFAULT_SETTINGS.responsePath,
    detectionMode: detectionModeSelect.value,
    detectionEndpoint: detectionEndpointInput.value.trim(),
    detectionRequestMethod: detectionRequestMethodSelect.value,
    detectionPromptTemplate:
      detectionPromptTemplateInput.value.trim() || DEFAULT_SETTINGS.detectionPromptTemplate,
    detectionRequestBodyTemplate:
      detectionRequestBodyTemplateInput.value.trim() ||
      DEFAULT_SETTINGS.detectionRequestBodyTemplate,
    detectionCustomHeaders: detectionCustomHeadersInput.value.trim() || '{}',
    detectionResponsePath: detectionResponsePathInput.value.trim(),
    enablePageTranslation: enablePageTranslationInput.checked,
    autoDetectPageLanguage: autoDetectPageLanguageInput.checked,
    autoShowFloatingPanel: autoShowFloatingPanelInput.checked,
    pageTranslationBatchSize: batchSize
  };

  await chrome.storage.sync.set({ settings });

  statusBox.textContent = '设置已保存。';
  statusBox.className = 'success';

  setTimeout(() => {
    statusBox.textContent = '';
    statusBox.className = '';
  }, 2000);
}

form.addEventListener('submit', saveOptions);

function syncDetectionTemplateVisibility() {
  const shouldShow = detectionModeSelect.value === 'llm';
  detectionTemplateFields.forEach((field) => {
    field.hidden = !shouldShow;
  });
}

detectionModeSelect.addEventListener('change', syncDetectionTemplateVisibility);

document.addEventListener('DOMContentLoaded', restoreOptions);

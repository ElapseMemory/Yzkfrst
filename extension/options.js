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
  responsePath: 'translation'
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
}

async function saveOptions(event) {
  event.preventDefault();

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
    responsePath: responsePathInput.value.trim() || DEFAULT_SETTINGS.responsePath
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

document.addEventListener('DOMContentLoaded', restoreOptions);

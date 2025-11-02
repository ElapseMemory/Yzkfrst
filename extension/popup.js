const sourceText = document.getElementById('source-text');
const translateButton = document.getElementById('translate-button');
const targetLanguageInput = document.getElementById('target-language');
const resultSection = document.getElementById('result');
const translationOutput = document.getElementById('translation-output');
const openOptionsButton = document.getElementById('open-options');

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  if (settings?.targetLanguage) {
    targetLanguageInput.value = settings.targetLanguage;
  }
}

loadSettings();

translateButton.addEventListener('click', async () => {
  const text = sourceText.value.trim();
  const targetLanguage = targetLanguageInput.value.trim();

  if (!text) {
    resultSection.hidden = false;
    translationOutput.textContent = '请先输入需要翻译的文本。';
    return;
  }

  resultSection.hidden = false;
  translationOutput.textContent = '翻译中...';

  const response = await chrome.runtime.sendMessage({
    type: 'translate-text',
    payload: { text, targetLanguage }
  });

  if (!response?.success) {
    translationOutput.textContent = response?.error || '翻译失败，请检查设置。';
    return;
  }

  translationOutput.textContent = response.translation;
});

openOptionsButton.addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

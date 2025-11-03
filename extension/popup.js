const sourceText = document.getElementById('source-text');
const translateButton = document.getElementById('translate-button');
const targetLanguageInput = document.getElementById('target-language');
const resultSection = document.getElementById('result');
const translationOutput = document.getElementById('translation-output');
const openOptionsButton = document.getElementById('open-options');
const translatePageButton = document.getElementById('translate-page');
const profileSelect = document.getElementById('profile-select');

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  if (settings?.targetLanguage) {
    targetLanguageInput.value = settings.targetLanguage;
  }

  populateProfileSelect(settings);
}

loadSettings();

function populateProfileSelect(settings) {
  if (!profileSelect) {
    return;
  }

  const profiles = Array.isArray(settings?.profiles) && settings.profiles.length
    ? settings.profiles
    : [{ id: 'default', name: '默认模板' }];

  profileSelect.innerHTML = '';
  profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || '未命名模板';
    profileSelect.appendChild(option);
  });

  const activeId = profiles.some((profile) => profile.id === settings?.activeProfileId)
    ? settings.activeProfileId
    : profiles[0].id;
  profileSelect.value = activeId;
}

profileSelect?.addEventListener('change', async () => {
  const selectedId = profileSelect.value;
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings || typeof settings !== 'object') {
    return;
  }
  if (settings.activeProfileId === selectedId) {
    return;
  }
  await chrome.storage.sync.set({ settings: { ...settings, activeProfileId: selectedId } });
});

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

translatePageButton.addEventListener('click', async () => {
  translatePageButton.disabled = true;
  const originalText = translatePageButton.textContent;
  translatePageButton.textContent = '请求中...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('未找到当前标签页。');
    }

    await chrome.tabs.sendMessage(tab.id, { type: 'translate-entire-page' });

    resultSection.hidden = false;
    translationOutput.textContent = '已发送整页翻译请求，请在页面右下角的悬浮窗查看进度。';
  } catch (error) {
    const message = chrome.runtime.lastError?.message || error.message;
    resultSection.hidden = false;
    translationOutput.textContent = `无法触发整页翻译：${message}`;
  } finally {
    translatePageButton.textContent = originalText;
    translatePageButton.disabled = false;
  }
});

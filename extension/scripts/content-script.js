function createTranslationBubble(text) {
  const existing = document.getElementById('safe-page-translator-bubble');
  if (existing) {
    existing.remove();
  }

  const bubble = document.createElement('div');
  bubble.id = 'safe-page-translator-bubble';
  bubble.style.position = 'absolute';
  bubble.style.zIndex = 999999;
  bubble.style.maxWidth = '320px';
  bubble.style.padding = '12px 16px';
  bubble.style.backgroundColor = '#1f2937';
  bubble.style.color = '#f9fafb';
  bubble.style.fontSize = '14px';
  bubble.style.lineHeight = '1.4';
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

async function requestTranslation(text) {
  return await chrome.runtime.sendMessage({
    type: 'translate-text',
    payload: { text }
  });
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message?.type === 'translate-selection') {
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString() : '';

    if (!selectedText.trim()) {
      createTranslationBubble('请先选择需要翻译的文本。');
      return;
    }

    createTranslationBubble('翻译中...');

    const response = await requestTranslation(selectedText);

    if (!response?.success) {
      createTranslationBubble(response?.error || '翻译失败，请稍后再试。');
      return;
    }

    createTranslationBubble(response.translation);
  }
});

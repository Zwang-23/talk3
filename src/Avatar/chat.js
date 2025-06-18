import { showErrorOverlay, appendMessage } from './utils.js';

// Tracks current mode: false for ChatGPT, true for Direct Speak
export let isDirectSpeakMode = false;

// Base URL for the API: in dev this will hit localhost:5000,
// in prod override by setting REACT_APP_API_BASE_URL
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

export async function sendChatMessage(message) {
  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      credentials: "include",
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!response.ok) throw new Error('Chat endpoint error');
    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Chat message error:', error);
    return "Sorry, I couldn't get a response.";
  }
}

function setupToggleListener(toggleElement) {
  if (!toggleElement) {
    console.error("Error: Toggle element not found");
    return;
  }
  // Clone the element to remove existing listeners
  const newToggle = toggleElement.cloneNode(true);
  newToggle.id = toggleElement.id;
  newToggle.className = toggleElement.className;
  toggleElement.parentNode.replaceChild(newToggle, toggleElement);

  newToggle.addEventListener('click', () => {
    isDirectSpeakMode = !isDirectSpeakMode;
    newToggle.textContent = isDirectSpeakMode
      ? 'Direct Speak Mode'
      : 'ChatGPT Mode';
  });
}

// --- Core Functions ---
export function initializeChat({ speakText }) {
  const input = document.getElementById('user-input');
  let sendButton = document.getElementById('send-button');
  const toggleMode = document.getElementById('mode-toggle');

  if (!input || !sendButton || !toggleMode) {
    console.error("Error: Missing required chat interface elements");
    return;
  }
  if (!speakText) {
    showErrorOverlay('Speech functionality is not available');
    return;
  }
  input.disabled = false;
  sendButton.disabled = false;

  setupToggleListener(toggleMode);

  // Clone send-button to remove existing listeners
  const newSendButton = sendButton.cloneNode(true);
  sendButton.parentNode.replaceChild(newSendButton, sendButton);
  sendButton = newSendButton;

  sendButton.addEventListener('click', async () => {
    const message = input.value.trim();
    if (!message) return;

    appendMessage('user', message);
    input.value = '';
    try {
      if (isDirectSpeakMode) {
        appendMessage('assistant', message);
        speakText(message);
      } else {
        const assistantReply = await sendChatMessage(message);
        appendMessage('assistant', assistantReply);
        speakText(assistantReply);
      }
    } catch {
      showErrorOverlay('Error processing message');
    }
  });

  input.addEventListener('keypress', e => {
    if (e.key === 'Enter') sendButton.click();
  });
}

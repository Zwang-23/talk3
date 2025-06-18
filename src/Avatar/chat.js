import { showErrorOverlay, appendMessage } from './utils.js';
 // Tracks current mode: false for ChatGPT, true for Direct Speak
// --- Global State ---
export let isDirectSpeakMode = false;
export async function sendChatMessage(message) {
  try {
    const response = await fetch('/chat', {
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
    isDirectSpeakMode = !isDirectSpeakMode; // Toggle mode
    newToggle.textContent = isDirectSpeakMode ? 'Direct Speak Mode' : 'ChatGPT Mode'; // Update button text
    console.log("DEBUG: Mode switched to", isDirectSpeakMode ? 'Direct Speak' : 'ChatGPT');
    });
  }
// --- Core Functions ---
export function initializeChat({ speakText }) {
  const input = document.getElementById('user-input');
  let sendButton = document.getElementById('send-button');
  const toggleMode = document.getElementById('mode-toggle');
  
  console.log('DEBUG: DOM state - user-input:', !!input, 
              'send-button:', !!sendButton, 
              'mode-toggle:', !!toggleMode);
  console.log("DEBUG: Header content:", document.querySelector('header')?.innerHTML || "Header not found");
  if (!input || !sendButton || !toggleMode) {
    console.error("Error: Missing required chat interface elements (user-input, send-button, or mode-toggle)");
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
    if (message) {
      console.log("User message:", message);
      appendMessage('user', message);
      input.value = '';
      try {
        if (isDirectSpeakMode) {
          appendMessage('assistant', message);
          speakText(message); // Likely line 82, causing error
        } else {
          const assistantReply = await sendChatMessage(message);
          console.log("Assistant reply:", assistantReply); // Line ~80
          appendMessage('assistant', assistantReply);
          speakText(assistantReply); // Or here, line 82
        }
      } catch (error) {
        showErrorOverlay('Error processing message');
      }
    }
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendButton.click();
  });
}
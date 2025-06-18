import { TalkingHead } from './modules/talkinghead.js';
import { initializeChat } from './chat.js';
import { setupTTS } from './tts.js';
import * as config from './config.js';
import { showErrorOverlay } from './utils.js';

const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
let talkingHeadInstance;
let audioContext;

export async function init() {
  const modelSelector = document.getElementById('model-selector');
  modelSelector.addEventListener('change', (e) => resetConversation(e.target.value));

  // Initialize with default model
  const initialModel = modelSelector?.value || 'pro.glb';
  try{
    await initializeSystem(initialModel);
    await greetUser();
  } catch(err) {
    showErrorOverlay(err.message);
  }
}

export async function initializeSystem(selectedModel) {
  try {
    if (talkingHeadInstance) {
      talkingHeadInstance = null;
    }
    if (audioContext) {
      await audioContext.close();
    }
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const container = document.getElementById('scene-container');
    if (!container) throw new Error('Scene container not found');
    container.innerHTML = '';

    talkingHeadInstance = new TalkingHead(container, {
      modelRoot: "Armature",
      lipsyncModules: ["en"],
      modelFPS: 30,
      ttsEndpoint: config.TTS_WS_ENDPOINT,
      ttsAudioEncoding: "PCM",
      ttsBOS: config.elevenBOS
    });

    await talkingHeadInstance.showAvatar({
      url: `/models/${selectedModel}?morphTargets=ARKit,Oculus+Visemes,mouthOpen`,
      textureFormat: 'png',
      textureSizeLimit: 1024
    });

    const renderer = talkingHeadInstance.renderer;
    if (renderer && renderer.setClearColor) {
      // 0xffffff is white, 1.0 is fully opaque
      renderer.setClearColor(0xffffff, 1.0);
    }
    // also ensure the canvas CSS background is white, in case of any transparency:
    const canvas = document.querySelector('#scene-container canvas');
    if (canvas) {
      canvas.style.background = '#ffffff';
    }

    setupTTS(talkingHeadInstance, config, audioContext);

    initializeChat({
      speakText: (text) => {
        if (!talkingHeadInstance || !talkingHeadInstance.speakText) {
          throw new Error('talkingHeadInstance or speakText is undefined');
        }
        talkingHeadInstance.speakText(text);
      }
    });

    // Test server connectivity first
    await testServerConnection();
    
    // Greet the recognized user by name - with proper error handling
    await greetUser();
  } catch (error) {
    showErrorOverlay(`Initialization failed: ${error.message}`);
  }
}

async function testServerConnection() {
  try {
    const response = await fetch('/api/health');
    if (response.ok) {
      const data = await response.json();
      console.log('Server connection successful:', data);
    } else {
      console.error('Server health check failed:', response.status);
    }
  } catch (error) {
    console.error('Server connection failed:', error.message);
    showErrorOverlay('Cannot connect to server. Please ensure Flask backend is running on port 5000.');
  }
}

async function greetUser() {
  try {
    const response = await fetch(`${API_BASE}/api/username`, {
      method: 'GET',
      credentials: 'include', // Include session cookies
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    // Check if response is actually JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.warn('Username endpoint returned non-JSON response, user likely not authenticated');
      return;
    }
    
    if (response.ok) {
      const data = await response.json();
      if (data.name && talkingHeadInstance && talkingHeadInstance.speakText) {
        talkingHeadInstance.speakText(`Hello, ${data.name}!`);
      }
    } else if (response.status === 401) {
      console.log('User not authenticated, skipping greeting');
    } else {
      console.warn('Failed to get username:', response.status, response.statusText);
    }
  } catch (error) {
    console.warn('User greeting failed:', error.message);
    // Don't throw - this is non-critical functionality
  }
}

export function resetConversation(selectedModel) {
  initializeSystem(selectedModel);
}
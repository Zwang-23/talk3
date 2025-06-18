import { TalkingHead } from './modules/talkinghead.mjs';
import { initializeChat } from './chat.js';
import { setupTTS } from './tts.js';
import * as config from './config.js';
import { showErrorOverlay, toggleRecordingMode } from './utils.js';


let talkingHeadInstance;
let audioContext;

export function init() {
  const modelSelector = document.getElementById('model-selector');
  modelSelector.addEventListener('change', (e) => resetConversation(e.target.value));

  const recBtn = document.getElementById('record-video');
  recBtn.addEventListener('click', () => {
    const mode = toggleRecordingMode();
    recBtn.textContent = mode ? 'Stop Recording' : 'Record Video';
  });

  // Initialize with default model
  const initialModel = modelSelector?.value || 'pro.glb';
  initializeSystem(initialModel);
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
  } catch (error) {
    showErrorOverlay(`Initialization failed: ${error.message}`);
  }
}

export function resetConversation(selectedModel) {
  initializeSystem(selectedModel);
}
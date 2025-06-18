export function showErrorOverlay(message) {
  const overlay = document.createElement('div');
  overlay.className = 'error-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
  overlay.style.color = 'white';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '9999';
  overlay.innerHTML = `<h2>Error</h2><p>${message}</p>`;
  document.body.appendChild(overlay);
}

export function appendMessage(sender, message) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) {
    console.error("Chat messages element not found");
    return;
  }
  const messageDiv = document.createElement('div');
  messageDiv.className = sender === 'user' ? 'user-message' : 'assistant-message';
  messageDiv.textContent = message;
  chatMessages.appendChild(messageDiv);
}

export function createWavFile(pcmBuffer, sampleRate = 22050, numChannels = 1, bitsPerSample = 16) {
  const pcmData = new Uint8Array(pcmBuffer);
  const byteLength = pcmData.length - (pcmData.length % 2);
  const wavBuffer = new ArrayBuffer(44 + byteLength);
  const view = new DataView(wavBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + byteLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
  view.setUint16(32, numChannels * bitsPerSample / 8, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, byteLength, true);

  for (let i = 0; i < byteLength; i++) {
    view.setUint8(44 + i, pcmData[i]);
  }

  return wavBuffer;
}

export function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

export function remapToOculus(label) {
  const mapping = {
    "sil": "viseme_sil", "PP": "viseme_PP", "FF": "viseme_FF", "TH": "viseme_TH",
    "DD": "viseme_DD", "kk": "viseme_kk", "CH": "viseme_CH", "SS": "viseme_SS",
    "nn": "viseme_nn", "RR": "viseme_RR", "aa": "viseme_aa", "E": "viseme_E",
    "I": "viseme_I", "O": "viseme_O", "U": "viseme_U"
  };
  return mapping[label] || label;
}

export function computeWordsFromAlignment(timepoints) {
  const words = [];
  const wtimes = [];
  const wdurations = [];
  let currentWord = "";
  let startTime = null;
  let endTime = null;
  for (let i = 0; i < timepoints.length; i++) {
    const tp = timepoints[i];
    if (tp.char === ' ') {
      if (currentWord !== "") {
        endTime = timepoints[i - 1].time + timepoints[i - 1].duration;
        words.push(currentWord);
        wtimes.push(startTime);
        wdurations.push(endTime - startTime);
        currentWord = "";
        startTime = null;
      }
    } else {
      if (currentWord === "") startTime = tp.time;
      currentWord += tp.char;
    }
  }
  if (currentWord !== "") {
    endTime = timepoints[timepoints.length - 1].time + timepoints[timepoints.length - 1].duration;
    words.push(currentWord);
    wtimes.push(startTime);
    wdurations.push(endTime - startTime);
  }
  return { words, wtimes, wdurations };
}






export function createAudioBufferFromPCM(audioContext, pcmData, sampleRate, numChannels) {
  if (!audioContext) {
    throw new Error('createAudioBufferFromPCM: audioContext is required');
  }
  
  const bytesPerSample = 2; // 16-bit PCM
  const numSamples = pcmData.length / bytesPerSample;
  
  try {
    const audioBuffer = audioContext.createBuffer(numChannels, numSamples, sampleRate);
    
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      const dataView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.length);
      
      for (let i = 0, j = 0; i < pcmData.length; i += 2, j++) {
        const int16 = dataView.getInt16(i, true);
        channelData[j] = Math.max(-1, Math.min(1, int16 / 32768));
      }
    }
    
    return audioBuffer;
  } catch (e) {
    console.error('createAudioBufferFromPCM error:', e);
    throw new Error(`Failed to create audio buffer: ${e.message}`);
  }
}
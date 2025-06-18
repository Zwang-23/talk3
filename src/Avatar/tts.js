/* tts.js — hot‑fix 2025‑06‑21b
 *
 * 🩹  Fix crash & missing visemes
 *      • Removed stray `scheduleVisemePacket(vData)` call that referenced
 *        undefined `vData`, causing runtime error and stopping all
 *        later viseme animation.
 *      • Implemented **immediate viseme scheduling** the right way:
 *          ‑ When each alignment packet arrives we call
 *            `scheduleVisemePacket(vObj)` *outside* flushBatch.
 *      • Consolidated helper using `talkingHeadInstance` instead of
 *        undefined `talker`.
 */

import {
  createWavFile,
  remapToOculus,
  showErrorOverlay,
  isRecordingMode,
  startRecording,
  stopRecording
} from './utils.js';

export function setupTTS(talkingHeadInstance, config = {}, audioContext) {
  if (!talkingHeadInstance || !audioContext) {
    console.error('Missing TalkingHead or AudioContext');
    showErrorOverlay('TTS setup error');
    return;
  }

  /* ─── Config ─── */
  const {
    TTS_WS_ENDPOINT,
    elevenBOS,
    gestureMap = {},
    preBufferTime = 3,
    minChunkMs = 600,
    shortTextThresholdChars = 50
  } = config;

  const SR = 22_050, BPS = 2, CH = 1;
  const MIN_BYTES = Math.floor(SR * BPS * CH * (minChunkMs / 1000));

  const overlay = document.getElementById('processing-overlay');

  talkingHeadInstance.speakText = function speakText(text) {
    const isShort = text.replace(/\s+/g, '').length <= shortTextThresholdChars;
    const delaySec = isShort ? 0 : preBufferTime;

    /* Runtime state */
    const ws = new WebSocket(TTS_WS_ENDPOINT);
    const pcmBufs = [];
    let pcmBytes = 0;
    const visQueue = [];
    let charClock = 0;

    let nextPlay = audioContext.currentTime + delaySec;
    const utterStart = nextPlay;

    overlay.style.display = 'flex';

    /* helper: schedule single viseme packet */
    function scheduleVisemePacket(vObj) {
      const launchAt = utterStart + vObj.vtimes[0] / 1000; // ACtx seconds
      const delayMs = Math.max(0, (launchAt - audioContext.currentTime) * 1000 - 2);
      const silentDur = (vObj.vtimes[vObj.vtimes.length - 1] + vObj.vdurations[vObj.vdurations.length - 1]) - vObj.vtimes[0];
      const silentBuf = audioContext.createBuffer(1, Math.ceil(SR * silentDur / 1000), SR);

      setTimeout(() => {
        talkingHeadInstance.speakAudio({
          audio: silentBuf,
          visemes: vObj.visemes,
          vtimes: vObj.vtimes.map(t => t - vObj.vtimes[0]),
          vdurations: vObj.vdurations,
          words: [], wtimes: [], wdurations: []
        });
      }, delayMs);
    }

    ws.onopen = () => {
      ws.send(JSON.stringify(elevenBOS));
      ws.send(JSON.stringify({ text: text + ' ', flush: true }));
    };

    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (!msg.audio) return;

      /* collect PCM */
      const raw = talkingHeadInstance.b64ToArrayBuffer(msg.audio);
      pcmBufs.push(raw); pcmBytes += raw.byteLength;

      /* alignment → visemes */
      if (msg.alignment) {
        const { chars, charStartTimesMs, charDurationsMs } = msg.alignment;
        const pts = chars.map((c, i) => ({
          char: c,
          t: (charStartTimesMs[i] / 1000) + charClock,
          d: charDurationsMs[i] / 1000
        }));
        const m = {
          a: 'viseme_aa', e: 'viseme_E', i: 'viseme_I', o: 'viseme_O', u: 'viseme_U',
          p: 'viseme_PP', b: 'viseme_PP', m: 'viseme_PP', f: 'viseme_FF', v: 'viseme_FF',
          s: 'viseme_SS', t: 'viseme_TH', d: 'viseme_DD', n: 'viseme_nn', r: 'viseme_RR',
          k: 'viseme_kk', g: 'viseme_kk', ' ': 'viseme_sil'
        };
        const vObj = { visemes: [], vtimes: [], vdurations: [] };
        pts.forEach(pt => {
          vObj.visemes.push(remapToOculus(m[pt.char.toLowerCase()] || 'viseme_sil'));
          vObj.vtimes.push(pt.t * 1000);
          vObj.vdurations.push(pt.d * 1000);
        });
        visQueue.push(vObj);
        scheduleVisemePacket(vObj); // immediate scheduling
        const last = pts[pts.length - 1];
        charClock = last.t + last.d;
      }

      if (pcmBytes >= MIN_BYTES || msg.isFinal) {
        const buffers = pcmBufs.splice(0);
        flushAudioBatch(buffers).catch(console.error);
        pcmBytes = 0;
      }
      if (msg.isFinal) ws.close();
    };

    async function flushAudioBatch(buffers) {
      if (!buffers.length) return;
      const total = buffers.reduce((s, b) => s + b.byteLength, 0);
      const merged = new Uint8Array(total); let off = 0; buffers.forEach(b => { merged.set(new Uint8Array(b), off); off += b.byteLength; });
      const audio = await audioContext.decodeAudioData(createWavFile(merged, SR, CH, 16));

      const start = nextPlay;
      const src = audioContext.createBufferSource();
      src.buffer = audio; src.connect(audioContext.destination); src.start(start);
      nextPlay += audio.duration;
    }

    ws.onerror = e => { console.error('[TTS] ws', e); overlay.style.display='none'; showErrorOverlay('TTS error'); };
    ws.onclose = () => { overlay.style.display = 'none'; };
  };
}

//This module centralizes all configuration constants, making it easy to update settings without touching other parts of the code.
export const DEBUG = true;
export const VOICE_ID = 'h0ohITIKDySy6v3xOg7H';
export const ELEVEN_API_KEY = 'sk_7a1627f0a3546e05cdfeb262cc3df8a5e2b45b365e9a93ad';
export const TTS_WS_ENDPOINT = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=eleven_multilingual_v2&output_format=pcm_22050`;
export const VOICE_STABILITY = 0.6;
export const VOICE_SIMILARITY = 0.7;

export const elevenBOS = {
  text: " ",
  voice_settings: { stability: VOICE_STABILITY, similarity_boost: VOICE_SIMILARITY },
  generation_config: { chunk_length_schedule: [500, 500, 500, 500] },
  xi_api_key: ELEVEN_API_KEY,
  sync_alignment: true
};
export const gestureMap = {
  'hello': 'handup', 'hi': 'handup', 'good': 'thumbup', 'yes': 'yes', 'no': 'no',
  'thanks': 'namaste', 'welcome': 'handup', 'sorry': 'shrug', 'awesome': 'ok',
  'how': 'index', 'you': 'handup', 'today': 'thumbup', 'help': 'namaste'
};


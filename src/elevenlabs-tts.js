// backend/elevenlabs-tts.js
import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

// Ensure your .env file includes valid keys:
// ELEVENLABS_API_KEY and VOICE_ID
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID;
if (!ELEVENLABS_API_KEY || !VOICE_ID) {
  console.error('Missing ELEVENLABS_API_KEY or VOICE_ID in .env');
}

const WS_ENDPOINT = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=eleven_flash_v2_5`;

// Set up a WebSocketServer that will handle TTS requests
const wss = new WebSocketServer({ noServer: true });
const router = express.Router();
router.use(cors());

wss.on('connection', (clientWs) => {
  console.log('Client connected to TTS WebSocket');

  // Create a connection to the ElevenLabs TTS API using the new endpoint
  const elevenWs = new WebSocket(WS_ENDPOINT, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY }
  });

  // Forward messages from client to ElevenLabs
  clientWs.on('message', (data) => {
    try {
      elevenWs.send(data);
    } catch (err) {
      console.error('Forwarding error:', err);
    }
  });

  // Forward ElevenLabs responses back to the client
  elevenWs.on('message', (data) => {
    try {
      const response = JSON.parse(data);

      // If alignment info is provided, process it
      if (response.alignment) {
        response.words = response.alignment
          .filter(item => item.type === 'word')
          .map(word => ({
            word: word.value,
            start: word.start / 10000000, // Convert nanoseconds to seconds
            end: word.end / 10000000
          }));
      }
      clientWs.send(JSON.stringify(response));
    } catch (err) {
      console.error('Message processing error:', err);
      clientWs.send(JSON.stringify({ error: 'Invalid server response' }));
    }
  });

  // Close both connections when one closes
  elevenWs.on('close', () => clientWs.close());
  clientWs.on('close', () => elevenWs.close());
});

// HTTP TTS endpoint (not implemented)
router.post('/', (req, res) => {
  res.status(501).json({ error: 'HTTP TTS not implemented' });
});

export { router as ttsRouter, wss as ttsWebSocketServer };

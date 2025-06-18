// backend/server.js
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import cors from 'cors';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from "openai";
import { ttsRouter, ttsWebSocketServer } from './elevenlabs-tts.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = createServer(app);


// WebSocket Server Setup for TTS
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;
  if (pathname === '/tts-ws') {
    ttsWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
      ttsWebSocketServer.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Middleware
app.use(morgan('combined'));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static File Serving
const staticPath = path.join(__dirname, 'public');
app.use(express.static(staticPath));

// Serve models with proper headers
app.use('/models', express.static(
  path.join(staticPath, 'models'), {
    setHeaders: (res) => {
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
  }
));

// Serve modules with proper headers
app.use('/modules', express.static(
  path.join(staticPath, 'modules'), {
    setHeaders: (res) => {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'no-store');
    }
  }
));

// TTS HTTP Endpoint (if needed)
app.use('/tts', ttsRouter);

// ---------------------------
// New TTS Proxy Endpoint for TalkingHead
// ---------------------------
app.post('/tts-proxy', async (req, res) => {
  try {
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const VOICE_ID = process.env.VOICE_ID;
    if (!ELEVENLABS_API_KEY || !VOICE_ID) {
      return res.status(500).json({ error: 'Missing API credentials' });
    }
    // Expect the TTS payload from TalkingHead
    const ttsPayload = req.body;
    // Call the ElevenLabs HTTP TTS API (adjust URL per documentation)
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`;
    const fetchResponse = await fetch(url, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY
      },
      body: JSON.stringify(ttsPayload)
    });
    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      return res.status(fetchResponse.status).json({ error: errorText });
    }
    const responseData = await fetchResponse.json();
    res.json(responseData);
  } catch (err) {
    console.error('TTS Proxy error:', err);
    res.status(500).json({ error: 'TTS Proxy failed' });
  }
});

// ---------------------------
// New Chat Endpoint for ChatGPT
// ---------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
app.post('/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;
    if (!userMessage) {
      return res.status(400).json({ error: 'Message is required' });
    }
    // Call ChatGPT (using gpt-3.5-turbo)
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: userMessage }],
      temperature: 0.7,
    });

    const assistantResponse = response.choices[0].message.content;
    res.json({ response: assistantResponse });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    res.status(500).json({ error: 'ChatGPT request failed' });
  }
});

// Error Handling
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Server Startup
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`
  Server running on port ${PORT}
  WebSocket: ws://localhost:${PORT}/tts-ws
  Modules:   http://localhost:${PORT}/modules/
  Models:    http://localhost:${PORT}/models/pro.glb
  `);
});

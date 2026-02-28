import { Hono } from 'hono';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { cors } from 'hono/cors';
import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  Modality,
  StartSensitivity,
} from '@google/genai';
import { config } from 'dotenv';

config();

const app = new Hono();
const corsConfig = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
});
app.use('/session', corsConfig);
app.use('/session/*', corsConfig);

const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-native-audio';
const VERTEX_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT || '';
const VERTEX_LOCATION =
  process.env.GOOGLE_CLOUD_LOCATION || process.env.VERTEX_LOCATION || '';

if (!VERTEX_PROJECT || !VERTEX_LOCATION) {
  throw new Error(
    'Vertex AI config missing. Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (or VERTEX_PROJECT/ VERTEX_LOCATION).',
  );
}

const ai = new GoogleGenAI({
  vertexai: true,
  project: VERTEX_PROJECT,
  location: VERTEX_LOCATION,
});

interface LiveSession {
  session: any;
}

const liveSessions = new Map<string, LiveSession>();
const lastAudioLogMs = new Map<string, number>();

app.get('/ws', upgradeWebSocket((c) => {
  let sessionId = '';
  let session: any | null = null;
  let closed = false;

  return {
    async onOpen(_event, ws) {
      sessionId = crypto.randomUUID();

      const sendJson = (payload: Record<string, unknown>) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(payload));
        }
      };

      const sendBinary = (data: Uint8Array) => {
        if (ws.readyState === 1) {
          ws.send(data);
        }
      };

      const cfg = {
        responseModalities: [Modality.AUDIO] as const,
        systemInstruction:
          'You are a helpful and friendly AI assistant. Always respond in English (en-US), even if the user speaks another language. Speak at a calm, moderate pace.',
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
            prefixPaddingMs: 30,
            silenceDurationMs: 350,
          },
          activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        },
      };

      console.log(`[${sessionId}] Connecting to Gemini Live API (WS)...`);
      sendJson({ type: 'log', message: 'Connecting to Gemini Live API...' });

      try {
        session = await ai.live.connect({
          model: MODEL,
          config: cfg,
          callbacks: {
            onopen: () => {
              console.log(`[${sessionId}] ✓ Connected to Gemini Live API`);
              sendJson({ type: 'log', message: 'Connected to Gemini Live API' });
            },
            onmessage: (message: any) => {
              if (closed) return;

              if (message.serverContent?.interrupted) {
                console.log(`[${sessionId}] ⚠ Interrupted`);
                sendJson({ type: 'interrupted' });
                sendJson({ type: 'log', message: 'Interrupted' });
                return;
              }

              if (message.serverContent?.modelTurn?.parts) {
                for (const part of message.serverContent.modelTurn.parts) {
                  if (part.inlineData?.data) {
                    const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
                    sendBinary(audioBuffer);
                  }
                }
              }

              if (message.serverContent?.turnComplete) {
                console.log(`[${sessionId}] ✓ Turn complete`);
                sendJson({ type: 'log', message: 'Turn complete' });
              }
            },
            onerror: (e: any) => {
              console.error(`[${sessionId}] ✗ Error:`, e.message);
              sendJson({ type: 'error', message: e.message || 'Gemini Live error' });
            },
            onclose: (e: any) => {
              console.log(`[${sessionId}] ○ Closed:`, e.reason);
              sendJson({
                type: 'log',
                message: `Gemini Live closed: ${e.reason || 'unknown'}`,
              });
            },
          },
        });

        liveSessions.set(sessionId, { session });
        sendJson({ type: 'session', sessionId });
        sendJson({ type: 'log', message: 'Session ready' });
        console.log(`[${sessionId}] Session ready`);
      } catch (err: any) {
        console.error(`[${sessionId}] ✗ Failed to connect:`, err?.message || err);
        sendJson({ type: 'error', message: err?.message || 'Failed to connect' });
        ws.close();
      }
    },
    onMessage(event, ws) {
      if (!session) return;

      if (event.data instanceof ArrayBuffer || event.data instanceof Uint8Array) {
        const now = Date.now();
        const last = lastAudioLogMs.get(sessionId) || 0;
        if (now - last > 1000) {
          lastAudioLogMs.set(sessionId, now);
          const byteLength =
            event.data instanceof ArrayBuffer ? event.data.byteLength : event.data.byteLength;
          console.log(`[${sessionId}] 🎤 Audio chunk received (bytes=${byteLength})`);
        }
        const audioBuffer =
          event.data instanceof ArrayBuffer ? Buffer.from(event.data) : Buffer.from(event.data);
        session.sendRealtimeInput({
          audio: {
            data: audioBuffer.toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          },
        });
        return;
      }

      let msg: any = null;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }

      if (msg?.type === 'audio' && msg.audio) {
        const now = Date.now();
        const last = lastAudioLogMs.get(sessionId) || 0;
        if (now - last > 1000) {
          lastAudioLogMs.set(sessionId, now);
          console.log(`[${sessionId}] 🎤 Audio chunk received (base64 length=${msg.audio.length})`);
        }
        session.sendRealtimeInput({
          audio: {
            data: msg.audio,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
        return;
      }

      if (msg?.type === 'text' && typeof msg.text === 'string') {
        session.sendClientContent({ turns: msg.text, turnComplete: true });
        return;
      }

      if (msg?.type === 'ping') {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }));
      }
    },
    onClose() {
      closed = true;
      if (session) {
        session.close();
      }
      if (sessionId) {
        liveSessions.delete(sessionId);
        lastAudioLogMs.delete(sessionId);
        console.log(`[${sessionId}] Session stopped`);
      }
    },
  };
}));

app.post('/session', async (c) => {
  const sessionId = crypto.randomUUID();

  const cfg = {
    responseModalities: [Modality.AUDIO] as const,
    systemInstruction:
      'You are a helpful and friendly AI assistant. Always respond in English (en-US), even if the user speaks another language. Speak at a calm, moderate pace.',
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
        prefixPaddingMs: 30,
        silenceDurationMs: 350,
      },
      activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
    },
  };

  console.log(`[${sessionId}] Connecting to Gemini Live API...`);

  const session = await ai.live.connect({
    model: MODEL,
    config: cfg,
    callbacks: {
      onopen: () => console.log(`[${sessionId}] ✓ Connected to Gemini Live API`),
      onmessage: (message: any) => {
        if (message.serverContent?.interrupted) {
          console.log(`[${sessionId}] ⚠ Interrupted`);
          return;
        }

        if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              console.log(`[${sessionId}] 🎵 Audio chunk received`);
            }
          }
        }

        if (message.serverContent?.turnComplete) {
          console.log(`[${sessionId}] ✓ Turn complete`);
        }
      },
      onerror: (e: any) => console.error(`[${sessionId}] ✗ Error:`, e.message),
      onclose: (e: any) => console.log(`[${sessionId}] ○ Closed:`, e.reason),
    },
  });

  liveSessions.set(sessionId, { session });
  console.log(`[${sessionId}] Session ready`);
  return c.json({ sessionId, message: 'Session started' });
});

app.delete('/session/:id', (c) => {
  const sessionId = c.req.param('id');
  const session = liveSessions.get(sessionId);
  if (session) {
    session.session.close();
    liveSessions.delete(sessionId);
    console.log(`[${sessionId}] Session stopped`);
    return c.json({ message: 'Session stopped' });
  }
  return c.json({ error: 'Session not found' }, 404);
});

app.get('/session/:id/status', (c) => {
  const sessionId = c.req.param('id');
  const exists = liveSessions.has(sessionId);
  return c.json({ sessionId, active: exists });
});

app.post('/session/:id/audio', async (c) => {
  const sessionId = c.req.param('id');
  const session = liveSessions.get(sessionId);
  if (!session?.session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const contentType = c.req.header('content-type') || '';
  
  if (contentType.includes('application/json')) {
    const body = await c.req.json();
    if (body.audio) {
      const now = Date.now();
      const last = lastAudioLogMs.get(sessionId) || 0;
      if (now - last > 1000) {
        lastAudioLogMs.set(sessionId, now);
        console.log(`[${sessionId}] 🎤 Audio chunk received (base64 length=${body.audio.length})`);
      }
      session.session.sendRealtimeInput({
        audio: {
          data: body.audio,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    }
  } else {
    const arrayBuffer = await c.req.arrayBuffer();
    const audioData = Buffer.from(arrayBuffer);
    const now = Date.now();
    const last = lastAudioLogMs.get(sessionId) || 0;
    if (now - last > 1000) {
      lastAudioLogMs.set(sessionId, now);
      console.log(`[${sessionId}] 🎤 Audio chunk received (bytes=${audioData.byteLength})`);
    }
    session.session.sendRealtimeInput({
      audio: {
        data: audioData.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  }

  return c.json({ message: 'Audio sent' });
});

app.post('/session/:id/text', async (c) => {
  const sessionId = c.req.param('id');
  const session = liveSessions.get(sessionId);
  if (!session?.session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const { text } = await c.req.json();
  session.session.sendClientContent({ turns: text, turnComplete: true });

  return c.json({ message: 'Text sent' });
});

const PORT = process.env.PORT || 3000;
console.log(`Starting server on port ${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};

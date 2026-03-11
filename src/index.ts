import { Hono } from 'hono';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { cors } from 'hono/cors';
import {
  ActivityHandling,
  EndSensitivity,
  GoogleGenAI,
  MediaResolution,
  Modality,
  StartSensitivity,
} from '@google/genai';
import { config } from 'dotenv';
import {
  completeSession,
  createDefaultGoalInput,
  generateGoalBlueprint,
  isGoalBlueprint,
  prepareSession,
  type GoalBootstrapInput,
} from './planner';

config();

const app = new Hono();
const corsConfig = cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
});

app.use('*', corsConfig);

const MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-live-2.5-flash-native-audio';
const VERTEX_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT || '';
const VERTEX_LOCATION =
  process.env.GOOGLE_CLOUD_LOCATION || process.env.VERTEX_LOCATION || '';
const HAS_VERTEX_CONFIG = Boolean(VERTEX_PROJECT && VERTEX_LOCATION);

const ai = HAS_VERTEX_CONFIG
  ? new GoogleGenAI({
      vertexai: true,
      project: VERTEX_PROJECT,
      location: VERTEX_LOCATION,
    })
  : null;

interface LiveSession {
  session: any;
}

const liveSessions = new Map<string, LiveSession>();
const lastAudioLogMs = new Map<string, number>();
const lastVideoLogMs = new Map<string, number>();

function createTutorSystemInstruction() {
  return [
    'You are Vidya, a calm, high-agency AI tutor companion.',
    'You support one active study session at a time.',
    'Always greet the learner personally when session context is provided.',
    'Start by restating today’s objective and asking the learner to begin the first step.',
    'Use Socratic guidance by default.',
    'Do not immediately give the answer; let the learner think and attempt first.',
    'Only give direct solutions when the learner explicitly asks for them or is completely blocked.',
    'When the learner is coding, behave like a pair programmer who hints before fixing.',
    'When the learner is studying academic material, behave like a thoughtful tuition teacher.',
    'If the learner shares their screen, only comment on what is actually visible.',
    'Keep responses concise, supportive, and oriented around today’s session plan.',
    'Always respond in English (en-US).',
  ].join(' ');
}

function createLiveConfig() {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: createTutorSystemInstruction(),
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
        prefixPaddingMs: 30,
        silenceDurationMs: 350,
      },
      activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
    },
  };
}

function parseList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeGoalInput(payload: unknown): GoalBootstrapInput {
  const defaults = createDefaultGoalInput();
  if (!payload || typeof payload !== 'object') {
    return defaults;
  }

  const body = payload as Record<string, unknown>;
  return {
    learnerName: String(body.learnerName || defaults.learnerName).trim() || defaults.learnerName,
    learnerStage: (body.learnerStage as GoalBootstrapInput['learnerStage']) || defaults.learnerStage,
    goal: String(body.goal || defaults.goal).trim(),
    currentLevel: String(body.currentLevel || defaults.currentLevel).trim() || defaults.currentLevel,
    timelineWeeks: Number(body.timelineWeeks || defaults.timelineWeeks) || defaults.timelineWeeks,
    studyMinutesPerDay:
      Number(body.studyMinutesPerDay || defaults.studyMinutesPerDay) || defaults.studyMinutesPerDay,
    subjects: parseList(body.subjects),
    interests: parseList(body.interests),
    supportStyle:
      String(body.supportStyle || defaults.supportStyle).trim() || defaults.supportStyle,
  };
}

function arrayBufferFromNodeBuffer(buffer: Buffer) {
  return Uint8Array.from(buffer).buffer;
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    liveAvailable: HAS_VERTEX_CONFIG,
  }),
);

app.post('/api/goals/bootstrap', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const normalized = normalizeGoalInput(payload);

  if (!normalized.goal) {
    return c.json({ error: 'Goal is required' }, 400);
  }

  const blueprint = generateGoalBlueprint(normalized);
  return c.json({ blueprint });
});

app.post('/api/sessions/:id/prepare', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const blueprint = body.blueprint;

  if (!isGoalBlueprint(blueprint)) {
    return c.json({ error: 'Valid blueprint is required' }, 400);
  }

  try {
    const preparedSession = prepareSession(blueprint, c.req.param('id'));
    return c.json({ preparedSession });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to prepare session' }, 404);
  }
});

app.post('/api/sessions/:id/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const blueprint = body.blueprint;
  const answers =
    body.answers && typeof body.answers === 'object'
      ? (body.answers as Record<string, string>)
      : {};

  if (!isGoalBlueprint(blueprint)) {
    return c.json({ error: 'Valid blueprint is required' }, 400);
  }

  try {
    const result = completeSession(blueprint, c.req.param('id'), answers);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to complete session' }, 404);
  }
});

app.get('/ws', upgradeWebSocket(() => {
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

      const sendBinary = (data: ArrayBuffer) => {
        if (ws.readyState === 1) {
          ws.send(data);
        }
      };

      if (!ai) {
        sendJson({
          type: 'error',
          message:
            'Live tutor is unavailable because Vertex AI config is missing. Planning and roadmap features still work.',
        });
        ws.close();
        return;
      }

      console.log(`[${sessionId}] Connecting to Gemini Live API (WS)...`);
      sendJson({ type: 'log', message: 'Connecting to tutor companion...' });

      try {
        session = await ai.live.connect({
          model: MODEL,
          config: createLiveConfig(),
          callbacks: {
            onopen: () => {
              console.log(`[${sessionId}] Connected to Gemini Live API`);
              sendJson({ type: 'log', message: 'Tutor companion connected' });
            },
            onmessage: (message: any) => {
              if (closed) return;

              if (message.serverContent?.interrupted) {
                sendJson({ type: 'interrupted' });
                sendJson({ type: 'log', message: 'Tutor interrupted current response' });
                return;
              }

              if (message.serverContent?.modelTurn?.parts) {
                for (const part of message.serverContent.modelTurn.parts) {
                  if (part.inlineData?.data) {
                    const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
                    sendBinary(arrayBufferFromNodeBuffer(audioBuffer));
                  }
                }
              }

              if (message.serverContent?.turnComplete) {
                sendJson({ type: 'log', message: 'Tutor turn complete' });
              }
            },
            onerror: (error: any) => {
              console.error(`[${sessionId}] Live error:`, error?.message || error);
              sendJson({ type: 'error', message: error?.message || 'Gemini Live error' });
            },
            onclose: (event: any) => {
              sendJson({
                type: 'log',
                message: `Tutor companion closed: ${event?.reason || 'unknown'}`,
              });
            },
          },
        });

        liveSessions.set(sessionId, { session });
        sendJson({ type: 'session', sessionId });
        sendJson({ type: 'log', message: 'Tutor companion ready' });
      } catch (error: any) {
        console.error(`[${sessionId}] Failed to connect:`, error?.message || error);
        sendJson({ type: 'error', message: error?.message || 'Failed to connect' });
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
          const byteLength = event.data.byteLength;
          console.log(`[${sessionId}] Audio chunk received (bytes=${byteLength})`);
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

      if (msg?.type === 'session_init' && msg.context) {
        const context = msg.context as {
          learnerName?: string;
          goal?: string;
          sessionTitle?: string;
          objective?: string;
          howToStudy?: string[];
          prepList?: string[];
          successCriteria?: string[];
        };

        const bootstrapPrompt = [
          `Learner: ${context.learnerName || 'Learner'}`,
          `Goal: ${context.goal || 'Active study goal'}`,
          `Today session: ${context.sessionTitle || 'Current session'}`,
          `Objective: ${context.objective || 'Guide the learner through the session.'}`,
          `Prep list: ${(context.prepList || []).join(' | ')}`,
          `How to study: ${(context.howToStudy || []).join(' | ')}`,
          `Success criteria: ${(context.successCriteria || []).join(' | ')}`,
          'Start by welcoming the learner, restating the session plan, and asking them to begin step one.',
        ].join('\n');

        session.sendClientContent({
          turns: bootstrapPrompt,
          turnComplete: true,
        });

        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'log', message: 'Session plan sent to tutor companion' }));
        }
        return;
      }

      if (msg?.type === 'text' && typeof msg.text === 'string') {
        session.sendClientContent({ turns: msg.text, turnComplete: true });
        return;
      }

      if (msg?.type === 'video' && typeof msg.data === 'string') {
        const now = Date.now();
        const last = lastVideoLogMs.get(sessionId) || 0;
        if (now - last > 5000) {
          lastVideoLogMs.set(sessionId, now);
          console.log(`[${sessionId}] Screen frame received (base64 length=${msg.data.length})`);
        }

        session.sendRealtimeInput({
          video: {
            data: msg.data,
            mimeType: typeof msg.mimeType === 'string' ? msg.mimeType : 'image/jpeg',
          },
        });
        return;
      }

      if (msg?.type === 'ping') {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
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
        lastVideoLogMs.delete(sessionId);
      }
    },
  };
}));

app.post('/session', async (c) => {
  if (!ai) {
    return c.json(
      {
        error: 'Live tutor is unavailable because Vertex AI config is missing.',
      },
      503,
    );
  }

  const sessionId = crypto.randomUUID();
  const session = await ai.live.connect({
    model: MODEL,
    config: createLiveConfig(),
    callbacks: {
      onopen: () => {},
      onmessage: () => {},
      onerror: () => {},
      onclose: () => {},
    },
  });

  liveSessions.set(sessionId, { session });
  return c.json({ sessionId, message: 'Session started' });
});

app.delete('/session/:id', (c) => {
  const sessionId = c.req.param('id');
  const session = liveSessions.get(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  session.session.close();
  liveSessions.delete(sessionId);
  lastAudioLogMs.delete(sessionId);
  lastVideoLogMs.delete(sessionId);
  return c.json({ message: 'Session stopped' });
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
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.audio === 'string') {
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

  const body = await c.req.json().catch(() => ({}));
  if (typeof body.text === 'string') {
    session.session.sendClientContent({ turns: body.text, turnComplete: true });
  }

  return c.json({ message: 'Text sent' });
});

const PORT = Number(process.env.PORT || 3000);
console.log(`Starting server on port ${PORT}`);
if (!HAS_VERTEX_CONFIG) {
  console.log('Vertex AI config missing. Live tutor routes will be unavailable until credentials are set.');
}

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};

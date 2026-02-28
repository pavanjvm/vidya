import { GoogleGenAI, Modality } from '@google/genai';
import { config } from 'dotenv';
import mic from 'mic';
import Speaker from 'speaker';

config();

const ai = new GoogleGenAI({});
const MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

const audioQueue: Buffer[] = [];
let speaker: any = null;

function createSpeaker() {
  if (speaker) {
    speaker.end();
  }
  speaker = new Speaker({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000,
  });
  speaker.on('error', (err: any) => console.error('Speaker error:', err));
}

async function playbackLoop() {
  while (true) {
    if (audioQueue.length === 0) {
      if (speaker) {
        speaker.end();
        speaker = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    } else {
      if (!speaker) createSpeaker();
      const chunk = audioQueue.shift();
      if (chunk) {
        await new Promise<void>((resolve) => {
          speaker.write(chunk, () => resolve());
        });
      }
    }
  }
}

async function main() {
  const config = {
    responseModalities: [Modality.AUDIO] as const,
    systemInstruction: 'You are a helpful and friendly AI assistant.',
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
      },
    },
  };

  console.log('Connecting to Gemini Live API...');

  const session = await ai.live.connect({
    model: MODEL,
    config,
    callbacks: {
      onopen: () => console.log('✓ Connected to Gemini Live API'),
      onmessage: (message: any) => {
        if (message.serverContent?.interrupted) {
          audioQueue.length = 0;
          console.log('⚠ Interrupted');
          return;
        }

        if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              const audioBuffer = Buffer.from(part.inlineData.data, 'base64');
              audioQueue.push(audioBuffer);
            }
          }
        }

        if (message.serverContent?.turnComplete) {
          console.log('✓ Turn complete');
        }
      },
      onerror: (e: any) => console.error('✗ Error:', e.message),
      onclose: (e: any) => console.log('○ Closed:', e.reason),
    },
  });

  console.log('Starting microphone...');

  const micInstance = mic({
    rate: '16000',
    bitwidth: '16',
    channels: '1',
  });

  const micStream = micInstance.getAudioStream();

  micStream.on('data', (data: Buffer) => {
    session.sendRealtimeInput({
      audio: {
        data: data.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  });

  micStream.on('error', (err: any) => {
    console.error('Microphone error:', err);
  });

  micInstance.start();
  console.log('✓ Microphone started. Speak now...');

  playbackLoop();

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    session.close();
    if (speaker) speaker.end();
    process.exit(0);
  });
}

main().catch(console.error);

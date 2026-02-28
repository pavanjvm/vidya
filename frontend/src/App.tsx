import { useState, useRef } from 'react';
import './App.css';

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [messages, setMessages] = useState<string[]>([]);
  const [textInput, setTextInput] = useState('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playheadRef = useRef(0);
  const playbackDoneTimerRef = useRef<number | null>(null);
  const lastAudioLogMsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);

  const addMessage = (msg: string) => {
    setMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      playheadRef.current = audioContextRef.current.currentTime;
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const schedulePlayback = () => {
    ensureAudioContext();
    const ctx = audioContextRef.current;
    if (!ctx) return;

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (!chunk) continue;

      try {
        const buffer = ctx.createBuffer(1, chunk.length, 24000);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < chunk.length; i++) {
          channelData[i] = Math.max(-1, Math.min(1, chunk[i] / 32768));
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        activeSourcesRef.current.add(source);
        source.onended = () => {
          activeSourcesRef.current.delete(source);
          if (currentSourceRef.current === source) {
            currentSourceRef.current = null;
          }
        };

        const startAt = Math.max(ctx.currentTime + 0.02, playheadRef.current);
        source.start(startAt);
        playheadRef.current = startAt + buffer.duration;
        currentSourceRef.current = source;
      } catch (e) {
        console.error('Error scheduling chunk:', e);
      }
    }

    isPlayingRef.current = playheadRef.current > ctx.currentTime;
    if (playbackDoneTimerRef.current) {
      window.clearTimeout(playbackDoneTimerRef.current);
    }
    const endInMs = Math.max(0, (playheadRef.current - ctx.currentTime) * 1000);
    playbackDoneTimerRef.current = window.setTimeout(() => {
      if (audioContextRef.current && audioContextRef.current.currentTime >= playheadRef.current - 0.02) {
        isPlayingRef.current = false;
      }
    }, endInMs + 20);
  };

  const clearPlayback = (reason: string) => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current.clear();
    currentSourceRef.current = null;
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    if (audioContextRef.current) {
      playheadRef.current = audioContextRef.current.currentTime;
    }
    addMessage(reason);
  };

  const playAudioChunk = (base64Data: string) => {
    try {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const int16Array = new Int16Array(bytes.buffer);
      audioQueueRef.current.push(int16Array);
      
      addMessage('🎵 Received audio response');
      schedulePlayback();
    } catch (err) {
      console.error('Error playing audio:', err);
    }
  };

  const playAudioBytes = (bytes: ArrayBuffer) => {
    try {
      const int16Array = new Int16Array(bytes);
      audioQueueRef.current.push(int16Array);

      addMessage('🎵 Received audio response');
      schedulePlayback();
    } catch (err) {
      console.error('Error playing audio:', err);
    }
  };

  const connectWebSocket = () => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      addMessage('WebSocket connected');
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playAudioBytes(event.data);
        return;
      }

      let msg: any = null;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg?.type === 'session' && msg.sessionId) {
        setSessionId(msg.sessionId);
        setIsConnected(true);
        setStatus('Connected - Speak or type!');
        addMessage(`Session started: ${msg.sessionId}`);
        startAudioCapture();
        return;
      }

      if (msg?.type === 'interrupted') {
        clearPlayback('⏸️ Model interrupted (cleared playback)');
        return;
      }

      if (msg?.type === 'log' && msg.message) {
        addMessage(msg.message);
        return;
      }

      if (msg?.type === 'error' && msg.message) {
        addMessage(`Error: ${msg.message}`);
      }
    };

    ws.onerror = () => {
      addMessage('WebSocket error');
    };

    ws.onclose = () => {
      addMessage('WebSocket disconnected');
      setIsConnected(false);
      setStatus('Disconnected');

      if (!shouldReconnectRef.current) return;
      const attempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = attempt;
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
      addMessage(`Retrying WebSocket in ${Math.round(delay / 1000)}s (attempt ${attempt})`);
      reconnectTimerRef.current = window.setTimeout(() => {
        connectWebSocket();
      }, delay);
    };
  };

  const sendAudioChunk = async (PCMData: Int16Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    try {
      const now = Date.now();
      if (now - lastAudioLogMsRef.current > 1000) {
        lastAudioLogMsRef.current = now;
        addMessage(`🎤 Sending audio (${PCMData.length} samples)`);
      }

      ws.send(PCMData.buffer);
    } catch (err) {
      console.error('Failed to send audio:', err);
    }
  };

  const sendTextMessage = async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !textInput.trim()) return;
    
    try {
      addMessage(`You: ${textInput}`);
      ws.send(JSON.stringify({ type: 'text', text: textInput }));
      setTextInput('');
    } catch (err) {
      addMessage(`Error sending text: ${err}`);
    }
  };

  const startAudioCapture = async () => {
    try {
      if (processorRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true } 
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(512, 1, 1);
      
      processor.onaudioprocess = (e) => {
        const inputBuffer = e.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        let peak = 0;
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          int16Data[i] = sample * 0x7FFF;
          const abs = Math.abs(sample);
          if (abs > peak) peak = abs;
        }

        // No local barge-in. Let the model decide when to interrupt.

        sendAudioChunk(int16Data);
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      processorRef.current = processor;
      
      addMessage('Microphone capture started (16kHz PCM)');
    } catch (err) {
      addMessage(`Mic error: ${err}`);
    }
  };

  const stopAudioCapture = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const startSession = async () => {
    try {
      setStatus('Connecting...');
      addMessage('Starting session...');
      shouldReconnectRef.current = true;
      connectWebSocket();
    } catch (err) {
      setStatus('Error connecting');
      addMessage(`Error: ${err}`);
    }
  };

  const stopSession = async () => {
    shouldReconnectRef.current = false;
    stopAudioCapture();

    setSessionId(null);
    setIsConnected(false);
    setStatus('Idle');
    addMessage('Session stopped');
  };

  return (
    <div className="app">
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">V</div>
            <div>
              <h1>Vidya Live</h1>
              <p>Audio input + Text input → Audio output</p>
            </div>
          </div>
          <div className={`status-pill ${isConnected ? 'on' : 'off'}`}>
            <span className="status-dot" />
            <span>{status}</span>
          </div>
        </header>

        <section className="control-card">
          <div className="control-row">
            <div className="control-copy">
              <h2>Session Control</h2>
              <p>Start a Live session, then speak or type to interact.</p>
            </div>
            {!isConnected ? (
              <button className="btn btn-primary" onClick={startSession}>
                Start Session
              </button>
            ) : (
              <button className="btn btn-danger" onClick={stopSession}>
                Stop Session
              </button>
            )}
          </div>
        </section>

        <section className="input-card">
          <label className="input-label">Message</label>
          <div className="input-row">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendTextMessage()}
              placeholder="Type a message..."
              disabled={!isConnected}
              className="text-input"
            />
            <button
              onClick={sendTextMessage}
              disabled={!isConnected || !textInput.trim()}
              className="btn btn-ghost"
            >
              Send
            </button>
          </div>
        </section>

        <section className="log-card">
          <div className="log-header">
            <h3>Activity</h3>
            <span className="log-hint">Real-time session log</span>
          </div>
          <div className="log-body">
            {messages.map((msg, i) => (
              <div key={i} className="log-line">{msg}</div>
            ))}
            {messages.length === 0 && <div className="log-empty">Waiting for activity...</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;

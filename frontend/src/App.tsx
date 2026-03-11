import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import './App.css';
import { loadAppState, saveAppState } from './storage';
import type {
  GoalBlueprint,
  GoalFormState,
  PreparedSession,
  SessionCompletionResult,
} from './types';

const SCREEN_FRAME_INTERVAL_MS = 1000;
const SCREEN_FRAME_MAX_WIDTH = 1280;
const SCREEN_FRAME_QUALITY = 0.72;

const DEFAULT_GOAL_FORM: GoalFormState = {
  learnerName: '',
  learnerStage: 'self_learner',
  goal: '',
  currentLevel: 'Beginner',
  timelineWeeks: 4,
  studyMinutesPerDay: 45,
  subjects: '',
  interests: '',
  supportStyle: 'Guide me with hints before giving direct answers.',
};

function splitCommaValues(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sessionStatusLabel(status: GoalBlueprint['sessions'][number]['status']) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'retry':
      return 'Retry required';
    case 'ready':
      return 'Ready now';
    default:
      return 'Locked';
  }
}

function App() {
  const persisted = useMemo(() => loadAppState(), []);

  const [goalForm, setGoalForm] = useState<GoalFormState>(DEFAULT_GOAL_FORM);
  const [blueprint, setBlueprint] = useState<GoalBlueprint | null>(persisted.blueprint);
  const [preparedSession, setPreparedSession] = useState<PreparedSession | null>(null);
  const [lastPreparedSessionId, setLastPreparedSessionId] = useState<string | null>(
    persisted.lastPreparedSessionId,
  );
  const [knowledgeAnswers, setKnowledgeAnswers] = useState<Record<string, string>>({});
  const [knowledgeResult, setKnowledgeResult] = useState<SessionCompletionResult | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [isSubmittingCheck, setIsSubmittingCheck] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [messages, setMessages] = useState<string[]>([]);
  const [textInput, setTextInput] = useState('');

  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const captureAudioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const preparedSessionRef = useRef<PreparedSession | null>(preparedSession);
  const blueprintRef = useRef<GoalBlueprint | null>(blueprint);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenCaptureTimerRef = useRef<number | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playheadRef = useRef(0);
  const playbackDoneTimerRef = useRef<number | null>(null);
  const lastAudioLogMsRef = useRef(0);
  const lastVideoLogMsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const isSendingScreenFrameRef = useRef(false);

  useEffect(() => {
    preparedSessionRef.current = preparedSession;
  }, [preparedSession]);

  useEffect(() => {
    blueprintRef.current = blueprint;
  }, [blueprint]);

  useEffect(() => {
    saveAppState({ blueprint, lastPreparedSessionId });
  }, [blueprint, lastPreparedSessionId]);

  const activeSession = blueprint?.sessions.find((session) => session.id === blueprint.activeSessionId) ?? null;
  const completedSessions = blueprint?.sessions.filter((session) => session.status === 'completed').length ?? 0;
  const completionPercent = blueprint
    ? Math.round((completedSessions / Math.max(1, blueprint.sessions.length)) * 100)
    : 0;

  const addMessage = (message: string) => {
    setMessages((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const ensurePlaybackAudioContext = () => {
    if (!playbackAudioContextRef.current) {
      playbackAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
      playheadRef.current = playbackAudioContextRef.current.currentTime;
    }
    if (playbackAudioContextRef.current.state === 'suspended') {
      void playbackAudioContextRef.current.resume();
    }
  };

  const schedulePlayback = () => {
    ensurePlaybackAudioContext();
    const ctx = playbackAudioContextRef.current;
    if (!ctx) return;

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (!chunk) continue;

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
      };

      const startAt = Math.max(ctx.currentTime + 0.02, playheadRef.current);
      source.start(startAt);
      playheadRef.current = startAt + buffer.duration;
    }

    if (playbackDoneTimerRef.current) {
      window.clearTimeout(playbackDoneTimerRef.current);
    }

    const endInMs = Math.max(0, (playheadRef.current - ctx.currentTime) * 1000);
    playbackDoneTimerRef.current = window.setTimeout(() => {
      const playbackContext = playbackAudioContextRef.current;
      if (playbackContext) {
        playheadRef.current = playbackContext.currentTime;
      }
    }, endInMs + 20);
  };

  const clearPlayback = (reason?: string) => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // ignore
      }
    });
    activeSourcesRef.current.clear();
    audioQueueRef.current = [];
    if (playbackDoneTimerRef.current) {
      window.clearTimeout(playbackDoneTimerRef.current);
      playbackDoneTimerRef.current = null;
    }
    if (playbackAudioContextRef.current) {
      playheadRef.current = playbackAudioContextRef.current.currentTime;
    }
    if (reason) {
      addMessage(reason);
    }
  };

  const closePlaybackAudioContext = () => {
    const playbackContext = playbackAudioContextRef.current;
    playbackAudioContextRef.current = null;
    if (playbackContext && playbackContext.state !== 'closed') {
      void playbackContext.close().catch(() => {
        // ignore
      });
    }
  };

  const playAudioBytes = (bytes: ArrayBuffer) => {
    audioQueueRef.current.push(new Int16Array(bytes));
    addMessage('Tutor audio received');
    schedulePlayback();
  };

  const sendJsonMessage = (payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  };

  const sendCurrentSessionContext = useEffectEvent(() => {
    const currentPreparedSession = preparedSessionRef.current;
    const currentBlueprint = blueprintRef.current;
    if (!currentPreparedSession || !currentBlueprint) return;

    const sent = sendJsonMessage({
      type: 'session_init',
      context: {
        learnerName: currentBlueprint.learnerName,
        goal: currentBlueprint.goal,
        sessionTitle: currentPreparedSession.title,
        objective: currentPreparedSession.objective,
        howToStudy: currentPreparedSession.howToStudy,
        prepList: currentPreparedSession.prepList,
        successCriteria: currentPreparedSession.successCriteria,
      },
    });

    if (sent) {
      addMessage('Study plan synced to the tutor companion');
    }
  });

  useEffect(() => {
    if (preparedSession && isConnected) {
      sendCurrentSessionContext();
    }
  }, [preparedSession, isConnected]);

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
      addMessage('Companion websocket connected');
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playAudioBytes(event.data);
        return;
      }

      let msg: unknown = null;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!msg || typeof msg !== 'object') {
        return;
      }

      const payload = msg as Record<string, unknown>;

      if (payload.type === 'session' && typeof payload.sessionId === 'string') {
        setSessionId(payload.sessionId);
        setIsConnected(true);
        setStatus('Companion live');
        addMessage(`Tutor session started: ${payload.sessionId}`);
        void startAudioCapture();
        return;
      }

      if (payload.type === 'interrupted') {
        clearPlayback('Tutor interrupted the current response');
        return;
      }

      if (payload.type === 'log' && typeof payload.message === 'string') {
        addMessage(payload.message);
        return;
      }

      if (payload.type === 'error' && typeof payload.message === 'string') {
        addMessage(`Error: ${payload.message}`);
        setApiError(payload.message);
      }
    };

    ws.onerror = () => {
      addMessage('Companion websocket error');
    };

    ws.onclose = () => {
      addMessage('Companion websocket disconnected');
      setIsConnected(false);
      setStatus('Disconnected');

      if (!shouldReconnectRef.current || !preparedSessionRef.current) return;
      const attempt = reconnectAttemptsRef.current + 1;
      reconnectAttemptsRef.current = attempt;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      reconnectTimerRef.current = window.setTimeout(() => {
        connectWebSocket();
      }, delay);
    };
  };

  const sendAudioChunk = (pcmData: Int16Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (now - lastAudioLogMsRef.current > 1000) {
      lastAudioLogMsRef.current = now;
      addMessage('Streaming microphone audio');
    }
    ws.send(pcmData.buffer);
  };

  const sendTextMessage = () => {
    if (!textInput.trim()) return;
    const sent = sendJsonMessage({ type: 'text', text: textInput });
    if (!sent) return;
    addMessage(`You: ${textInput}`);
    setTextInput('');
  };

  const sendVideoFrame = (base64Data: string, mimeType = 'image/jpeg') => {
    const sent = sendJsonMessage({ type: 'video', data: base64Data, mimeType });
    if (!sent) return;

    const now = Date.now();
    if (now - lastVideoLogMsRef.current > 5000) {
      lastVideoLogMsRef.current = now;
      addMessage('Streaming screen context');
    }
  };

  const captureAndSendScreenFrame = () => {
    const video = screenPreviewRef.current;
    const canvas = screenCanvasRef.current;
    if (!video || !canvas || isSendingScreenFrameRef.current) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (!video.videoWidth || !video.videoHeight) return;

    isSendingScreenFrameRef.current = true;
    try {
      const scale = Math.min(1, SCREEN_FRAME_MAX_WIDTH / video.videoWidth);
      const targetWidth = Math.max(1, Math.round(video.videoWidth * scale));
      const targetHeight = Math.max(1, Math.round(video.videoHeight * scale));

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const context = canvas.getContext('2d');
      if (!context) return;

      context.drawImage(video, 0, 0, targetWidth, targetHeight);
      const dataUrl = canvas.toDataURL('image/jpeg', SCREEN_FRAME_QUALITY);
      const [, base64Data = ''] = dataUrl.split(',', 2);
      if (base64Data) {
        sendVideoFrame(base64Data);
      }
    } finally {
      isSendingScreenFrameRef.current = false;
    }
  };

  const stopScreenCaptureLoop = () => {
    if (screenCaptureTimerRef.current) {
      window.clearInterval(screenCaptureTimerRef.current);
      screenCaptureTimerRef.current = null;
    }
  };

  const startScreenCaptureLoop = () => {
    stopScreenCaptureLoop();
    captureAndSendScreenFrame();
    screenCaptureTimerRef.current = window.setInterval(captureAndSendScreenFrame, SCREEN_FRAME_INTERVAL_MS);
  };

  const stopScreenShare = (reason = 'Screen sharing stopped') => {
    const hadActiveShare = Boolean(displayStreamRef.current || screenCaptureTimerRef.current);
    if (!hadActiveShare) return;

    stopScreenCaptureLoop();
    isSendingScreenFrameRef.current = false;

    const stream = displayStreamRef.current;
    displayStreamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (screenPreviewRef.current) {
      screenPreviewRef.current.pause();
      screenPreviewRef.current.srcObject = null;
      screenPreviewRef.current.onloadedmetadata = null;
    }

    if (screenCanvasRef.current) {
      const context = screenCanvasRef.current.getContext('2d');
      context?.clearRect(0, 0, screenCanvasRef.current.width, screenCanvasRef.current.height);
    }

    setIsScreenSharing(false);
    addMessage(reason);
  };

  const startScreenShare = async () => {
    if (displayStreamRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 5 } },
        audio: false,
      });
      const [videoTrack] = stream.getVideoTracks();
      if (!videoTrack) {
        throw new Error('No screen video track available');
      }

      displayStreamRef.current = stream;
      setIsScreenSharing(true);

      if (screenPreviewRef.current) {
        screenPreviewRef.current.srcObject = stream;
        screenPreviewRef.current.onloadedmetadata = () => {
          void screenPreviewRef.current?.play();
          startScreenCaptureLoop();
        };
      } else {
        startScreenCaptureLoop();
      }

      videoTrack.addEventListener(
        'ended',
        () => {
          stopScreenShare('Screen sharing ended');
        },
        { once: true },
      );

      addMessage('Screen sharing started');
    } catch (error) {
      addMessage(`Screen share error: ${error}`);
    }
  };

  const startAudioCapture = async () => {
    if (processorRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
      });
      micStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      captureAudioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(512, 1, 1);
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          int16Data[i] = sample * 0x7fff;
        }
        sendAudioChunk(int16Data);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      processorRef.current = processor;
      addMessage('Microphone capture started');
    } catch (error) {
      addMessage(`Mic error: ${error}`);
    }
  };

  const stopAudioCapture = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    const captureContext = captureAudioContextRef.current;
    captureAudioContextRef.current = null;
    if (captureContext && captureContext.state !== 'closed') {
      void captureContext.close().catch(() => {
        // ignore
      });
    }
  };

  const stopLiveCompanion = (reason = 'Tutor companion stopped') => {
    shouldReconnectRef.current = false;
    stopScreenShare('Screen sharing stopped');
    stopAudioCapture();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearPlayback(reason);
    closePlaybackAudioContext();
    setSessionId(null);
    setIsConnected(false);
    setStatus('Idle');
  };

  const startLiveCompanion = () => {
    if (wsRef.current) return;
    shouldReconnectRef.current = true;
    setStatus('Connecting tutor...');
    addMessage('Starting tutor companion');
    connectWebSocket();
  };

  const bootstrapGoal = async () => {
    setIsBootstrapping(true);
    setApiError(null);

    try {
      const response = await fetch('/api/goals/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerName: goalForm.learnerName.trim() || 'Learner',
          learnerStage: goalForm.learnerStage,
          goal: goalForm.goal.trim(),
          currentLevel: goalForm.currentLevel.trim(),
          timelineWeeks: goalForm.timelineWeeks,
          studyMinutesPerDay: goalForm.studyMinutesPerDay,
          subjects: splitCommaValues(goalForm.subjects),
          interests: splitCommaValues(goalForm.interests),
          supportStyle: goalForm.supportStyle.trim(),
        }),
      });

      const data = (await response.json()) as { blueprint?: GoalBlueprint; error?: string };
      if (!response.ok || !data.blueprint) {
        throw new Error(data.error || 'Failed to create roadmap');
      }

      setBlueprint(data.blueprint);
      setPreparedSession(null);
      setLastPreparedSessionId(null);
      setKnowledgeResult(null);
      setKnowledgeAnswers({});
      setMessages([]);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to create roadmap');
    } finally {
      setIsBootstrapping(false);
    }
  };

  const prepareStudySession = async (sessionIdToPrepare: string) => {
    if (!blueprint) return;

    setIsPreparingSession(true);
    setApiError(null);
    setKnowledgeResult(null);
    setKnowledgeAnswers({});

    try {
      const response = await fetch(`/api/sessions/${sessionIdToPrepare}/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint }),
      });
      const data = (await response.json()) as { preparedSession?: PreparedSession; error?: string };
      if (!response.ok || !data.preparedSession) {
        throw new Error(data.error || 'Failed to prepare session');
      }

      setPreparedSession(data.preparedSession);
      setLastPreparedSessionId(sessionIdToPrepare);
      setMessages([`[${new Date().toLocaleTimeString()}] ${data.preparedSession.coachOpening}`]);

      if (!isConnected) {
        startLiveCompanion();
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to prepare session');
    } finally {
      setIsPreparingSession(false);
    }
  };

  const submitKnowledgeCheck = async () => {
    if (!blueprint || !preparedSession) return;

    setIsSubmittingCheck(true);
    setApiError(null);

    try {
      const response = await fetch(`/api/sessions/${preparedSession.sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blueprint,
          answers: knowledgeAnswers,
        }),
      });
      const data = (await response.json()) as SessionCompletionResult & { error?: string };
      if (!response.ok || !data.updatedBlueprint) {
        throw new Error(data.error || 'Failed to complete knowledge check');
      }

      setBlueprint(data.updatedBlueprint);
      setKnowledgeResult(data);

      if (data.passed) {
        stopLiveCompanion('Session completed and companion stopped');
        setPreparedSession(null);
        setLastPreparedSessionId(data.updatedBlueprint.activeSessionId);
      } else {
        const retryResponse = await fetch(`/api/sessions/${preparedSession.sessionId}/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blueprint: data.updatedBlueprint }),
        });
        const retryData = (await retryResponse.json()) as {
          preparedSession?: PreparedSession;
          error?: string;
        };
        if (retryResponse.ok && retryData.preparedSession) {
          setPreparedSession(retryData.preparedSession);
          addMessage('Knowledge check not passed yet. Session plan refreshed for reinforcement.');
        }
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Failed to complete knowledge check');
    } finally {
      setIsSubmittingCheck(false);
    }
  };

  const resetAll = () => {
    stopLiveCompanion('Tutor companion stopped');
    setBlueprint(null);
    setPreparedSession(null);
    setLastPreparedSessionId(null);
    setKnowledgeAnswers({});
    setKnowledgeResult(null);
    setGoalForm(DEFAULT_GOAL_FORM);
    setMessages([]);
    setApiError(null);
  };

  useEffect(() => {
    const screenPreview = screenPreviewRef.current;
    const screenCanvas = screenCanvasRef.current;
    const activeSources = activeSourcesRef.current;

    return () => {
      shouldReconnectRef.current = false;

      stopScreenCaptureLoop();
      isSendingScreenFrameRef.current = false;
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach((track) => track.stop());
        displayStreamRef.current = null;
      }
      if (screenPreview) {
        screenPreview.pause();
        screenPreview.srcObject = null;
        screenPreview.onloadedmetadata = null;
      }
      if (screenCanvas) {
        const context = screenCanvas.getContext('2d');
        context?.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
      }

      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((track) => track.stop());
        micStreamRef.current = null;
      }
      const captureContext = captureAudioContextRef.current;
      captureAudioContextRef.current = null;
      if (captureContext && captureContext.state !== 'closed') {
        void captureContext.close().catch(() => {
          // ignore
        });
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      activeSources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // ignore
        }
      });
      activeSources.clear();
      audioQueueRef.current = [];
      if (playbackDoneTimerRef.current) {
        window.clearTimeout(playbackDoneTimerRef.current);
        playbackDoneTimerRef.current = null;
      }
      const playbackContext = playbackAudioContextRef.current;
      playbackAudioContextRef.current = null;
      if (playbackContext && playbackContext.state !== 'closed') {
        void playbackContext.close().catch(() => {
          // ignore
        });
      }
    };
  }, []);

  return (
    <div className="app">
      <div className="app-shell app-shell-wide">
        <header className="app-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">V</div>
            <div>
              <h1>Vidya Companion</h1>
              <p>Goal-driven tutoring sessions with a persistent AI study partner</p>
            </div>
          </div>
          <div className="header-actions">
            <div className={`status-pill ${isConnected ? 'on' : 'off'}`}>
              <span className="status-dot" />
              <span>{status}</span>
            </div>
            {blueprint && (
              <button className="btn btn-subtle" onClick={resetAll}>
                Reset Goal
              </button>
            )}
          </div>
        </header>

        {apiError && (
          <section className="alert-card">
            <strong>Issue:</strong> {apiError}
          </section>
        )}

        {!blueprint && (
          <section className="goal-grid">
            <section className="hero-card">
              <div className="eyebrow">Goal-first tutoring</div>
              <h2>Enter a goal. The app builds the roadmap, sessions, and daily study plan.</h2>
              <p>
                Every session will tell you exactly what to study, how to study it, and will only
                complete after you pass the session knowledge check.
              </p>
              <div className="hero-points">
                <div>Roadmap broken into structured sessions</div>
                <div>Persistent tutor companion during study</div>
                <div>Knowledge-check gate before session completion</div>
              </div>
            </section>

            <section className="form-card">
              <div className="section-heading">
                <h2>Set Your Goal</h2>
                <p>This creates your first roadmap and active sprint.</p>
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Name</span>
                  <input
                    value={goalForm.learnerName}
                    onChange={(event) =>
                      setGoalForm((prev) => ({ ...prev, learnerName: event.target.value }))
                    }
                    placeholder="Pavan"
                  />
                </label>

                <label className="field">
                  <span>Learner Type</span>
                  <select
                    value={goalForm.learnerStage}
                    onChange={(event) =>
                      setGoalForm((prev) => ({
                        ...prev,
                        learnerStage: event.target.value as GoalFormState['learnerStage'],
                      }))
                    }
                  >
                    <option value="school_student">School student</option>
                    <option value="college_student">College student</option>
                    <option value="engineer">Engineer</option>
                    <option value="career_switcher">Career switcher</option>
                    <option value="self_learner">Self learner</option>
                  </select>
                </label>

                <label className="field field-wide">
                  <span>Main Goal</span>
                  <textarea
                    value={goalForm.goal}
                    onChange={(event) =>
                      setGoalForm((prev) => ({ ...prev, goal: event.target.value }))
                    }
                    placeholder="Learn React deeply enough to build and debug real apps in 6 weeks."
                    rows={4}
                  />
                </label>

                <label className="field">
                  <span>Current Level</span>
                  <input
                    value={goalForm.currentLevel}
                    onChange={(event) =>
                      setGoalForm((prev) => ({ ...prev, currentLevel: event.target.value }))
                    }
                    placeholder="Beginner"
                  />
                </label>

                <label className="field">
                  <span>Timeline (weeks)</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={goalForm.timelineWeeks}
                    onChange={(event) =>
                      setGoalForm((prev) => ({
                        ...prev,
                        timelineWeeks: Number(event.target.value) || 1,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Minutes per day</span>
                  <input
                    type="number"
                    min={15}
                    max={240}
                    step={5}
                    value={goalForm.studyMinutesPerDay}
                    onChange={(event) =>
                      setGoalForm((prev) => ({
                        ...prev,
                        studyMinutesPerDay: Number(event.target.value) || 15,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Subjects or focus areas</span>
                  <input
                    value={goalForm.subjects}
                    onChange={(event) =>
                      setGoalForm((prev) => ({ ...prev, subjects: event.target.value }))
                    }
                    placeholder="React, JavaScript, frontend"
                  />
                </label>

                <label className="field field-wide">
                  <span>Interests</span>
                  <input
                    value={goalForm.interests}
                    onChange={(event) =>
                      setGoalForm((prev) => ({ ...prev, interests: event.target.value }))
                    }
                    placeholder="building apps, solving problems, interview prep"
                  />
                </label>

                <label className="field field-wide">
                  <span>Support style</span>
                  <textarea
                    value={goalForm.supportStyle}
                    onChange={(event) =>
                      setGoalForm((prev) => ({ ...prev, supportStyle: event.target.value }))
                    }
                    rows={3}
                  />
                </label>
              </div>

              <button
                className="btn btn-primary btn-large"
                onClick={() => void bootstrapGoal()}
                disabled={isBootstrapping || !goalForm.goal.trim()}
              >
                {isBootstrapping ? 'Building roadmap...' : 'Create My Roadmap'}
              </button>
            </section>
          </section>
        )}

        {blueprint && !preparedSession && (
          <>
            <section className="dashboard-hero">
              <div className="dashboard-copy">
                <div className="eyebrow">Active Goal</div>
                <h2>{blueprint.goal}</h2>
                <p>{blueprint.roadmapSummary}</p>
              </div>
              <div className="dashboard-stats">
                <div className="metric-card">
                  <span className="metric-label">Progress</span>
                  <strong>{completionPercent}%</strong>
                  <span>{completedSessions}/{blueprint.sessions.length} sessions passed</span>
                </div>
                <div className="metric-card">
                  <span className="metric-label">Daily Focus</span>
                  <strong>{blueprint.studyMinutesPerDay} min</strong>
                  <span>{blueprint.timelineWeeks} week timeline</span>
                </div>
              </div>
            </section>

            <section className="today-card">
              <div className="section-heading">
                <h2>Today&apos;s Session</h2>
                <p>Press start and the app will show you exactly what to study and how to study it.</p>
              </div>
              {activeSession && (
                <div className="today-layout">
                  <div className="today-main">
                    <div className={`session-badge session-${activeSession.status}`}>
                      {sessionStatusLabel(activeSession.status)}
                    </div>
                    <h3>{activeSession.title}</h3>
                    <p>{activeSession.objective}</p>
                    <div className="chip-row">
                      {activeSession.focusAreas.map((focusArea) => (
                        <span key={focusArea} className="chip">{focusArea}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-large"
                    onClick={() => void prepareStudySession(activeSession.id)}
                    disabled={isPreparingSession}
                  >
                    {isPreparingSession ? 'Preparing session...' : 'Start Session'}
                  </button>
                </div>
              )}
            </section>

            <section className="dashboard-grid">
              <section className="panel-card">
                <div className="section-heading">
                  <h2>Roadmap</h2>
                  <p>Each phase unlocks through session completion, not just attendance.</p>
                </div>
                <div className="phase-list">
                  {blueprint.phases.map((phase) => (
                    <div key={phase.id} className="phase-card">
                      <h3>{phase.title}</h3>
                      <p>{phase.goal}</p>
                      <span>{phase.sessionIds.length} sessions</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel-card">
                <div className="section-heading">
                  <h2>Current Sprint</h2>
                  <p>Daily tickets stay tied to the roadmap so you always know what comes next.</p>
                </div>
                <div className="ticket-list">
                  {blueprint.sprints.map((sprint) => (
                    <div key={sprint.id} className="sprint-card">
                      <div className="sprint-head">
                        <h3>{sprint.title}</h3>
                        <span>{sprint.goal}</span>
                      </div>
                      {sprint.tickets.map((ticket) => (
                        <div key={ticket.id} className={`ticket ticket-${ticket.status}`}>
                          <strong>{ticket.title}</strong>
                          <span>{ticket.outcome}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            </section>

            <section className="panel-card">
              <div className="section-heading">
                <h2>Session Ladder</h2>
                <p>Only a passed knowledge check moves a session to done and unlocks the next one.</p>
              </div>
              <div className="session-list">
                {blueprint.sessions.map((session) => (
                  <button
                    key={session.id}
                    className={`session-card session-card-${session.status}`}
                    disabled={session.status === 'locked'}
                    onClick={() => void prepareStudySession(session.id)}
                  >
                    <div className="session-card-top">
                      <span className="session-index">Session {session.index}</span>
                      <span className={`session-badge session-${session.status}`}>
                        {sessionStatusLabel(session.status)}
                      </span>
                    </div>
                    <h3>{session.title}</h3>
                    <p>{session.objective}</p>
                    {session.lastScore !== undefined && (
                      <span className="session-score">Last score: {session.lastScore}%</span>
                    )}
                  </button>
                ))}
              </div>
              {lastPreparedSessionId && (
                <div className="resume-row">
                  <button
                    className="btn btn-subtle"
                    onClick={() => void prepareStudySession(lastPreparedSessionId)}
                  >
                    Resume Last Prepared Session
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {blueprint && preparedSession && (
          <>
            <section className="workspace-hero">
              <div>
                <div className="eyebrow">Active Session</div>
                <h2>{preparedSession.title}</h2>
                <p>{preparedSession.objective}</p>
                {sessionId && <p className="session-meta">Tutor session ID: {sessionId}</p>}
              </div>
              <div className="workspace-actions">
                {!isConnected ? (
                  <button className="btn btn-primary" onClick={startLiveCompanion}>
                    Start Companion
                  </button>
                ) : (
                  <button className="btn btn-danger" onClick={() => stopLiveCompanion()}>
                    Stop Companion
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={isScreenSharing ? () => stopScreenShare() : () => void startScreenShare()}
                >
                  {isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
                </button>
                <button
                  className="btn btn-subtle"
                  onClick={() => {
                    stopLiveCompanion('Companion paused');
                    setPreparedSession(null);
                  }}
                >
                  Back to Dashboard
                </button>
              </div>
            </section>

            <section className="workspace-grid">
              <section className="session-plan-card">
                <div className="section-heading">
                  <h2>What To Study</h2>
                  <p>Start here before you ask for help.</p>
                </div>
                <ul className="detail-list">
                  {preparedSession.whatToStudy.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>

                <div className="section-heading section-heading-tight">
                  <h2>How To Study</h2>
                </div>
                <ol className="detail-list ordered">
                  {preparedSession.howToStudy.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>

              <section className="session-plan-card">
                <div className="section-heading">
                  <h2>Prep and Success Criteria</h2>
                  <p>This session only closes when the check below is passed.</p>
                </div>
                <h3 className="mini-title">Prep</h3>
                <ul className="detail-list">
                  {preparedSession.prepList.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <h3 className="mini-title">Success</h3>
                <ul className="detail-list">
                  {preparedSession.successCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <h3 className="mini-title">Resources</h3>
                <ul className="detail-list">
                  {preparedSession.recommendedResources.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="preview-card workspace-preview">
                <div className="preview-header">
                  <div>
                    <h2>Screen Context</h2>
                    <p>The companion can watch what you are doing when you share a tab or screen.</p>
                  </div>
                  <div className={`share-pill ${isScreenSharing ? 'on' : 'off'}`}>
                    {isScreenSharing ? 'Live' : 'Inactive'}
                  </div>
                </div>
                <div className={`preview-frame ${isScreenSharing ? 'active' : 'idle'}`}>
                  <video ref={screenPreviewRef} className="screen-preview" autoPlay muted playsInline />
                  {!isScreenSharing && (
                    <div className="preview-empty">
                      Share your study tab, chapter, editor, or problem statement for live guidance.
                    </div>
                  )}
                </div>
                <canvas ref={screenCanvasRef} className="screen-canvas" aria-hidden="true" />
              </section>

              <section className="coach-card">
                <div className="section-heading">
                  <h2>Ask The Tutor</h2>
                  <p>Use voice or type a doubt. The tutor should guide first, answer later.</p>
                </div>
                <div className="input-row">
                  <input
                    type="text"
                    value={textInput}
                    onChange={(event) => setTextInput(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && sendTextMessage()}
                    placeholder="Ask for a hint, ask for an explanation, or describe what you tried..."
                    className="text-input"
                    disabled={!isConnected}
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={sendTextMessage}
                    disabled={!isConnected || !textInput.trim()}
                  >
                    Send
                  </button>
                </div>

                <div className="log-body workspace-log">
                  {messages.map((message, index) => (
                    <div key={`${message}-${index}`} className="log-line">{message}</div>
                  ))}
                  {messages.length === 0 && (
                    <div className="log-empty">Session activity and tutor updates will appear here.</div>
                  )}
                </div>
              </section>
            </section>

            <section className="knowledge-card">
              <div className="section-heading">
                <h2>Knowledge Check</h2>
                <p>{preparedSession.knowledgeCheck.intro}</p>
              </div>
              <div className="knowledge-grid">
                {preparedSession.knowledgeCheck.questions.map((question) => (
                  <label key={question.id} className="field field-wide">
                    <span>{question.prompt}</span>
                    <textarea
                      rows={4}
                      value={knowledgeAnswers[question.id] ?? ''}
                      onChange={(event) =>
                        setKnowledgeAnswers((prev) => ({
                          ...prev,
                          [question.id]: event.target.value,
                        }))
                      }
                      placeholder="Write your answer in your own words..."
                    />
                  </label>
                ))}
              </div>

              <div className="knowledge-actions">
                <button
                  className="btn btn-primary btn-large"
                  onClick={() => void submitKnowledgeCheck()}
                  disabled={isSubmittingCheck}
                >
                  {isSubmittingCheck ? 'Checking understanding...' : 'Submit Knowledge Check'}
                </button>
                <span className="knowledge-threshold">
                  Passing score: {preparedSession.knowledgeCheck.passThreshold}%
                </span>
              </div>

              {knowledgeResult && (
                <div className={`result-card ${knowledgeResult.passed ? 'pass' : 'retry'}`}>
                  <div className="result-head">
                    <strong>{knowledgeResult.passed ? 'Session Passed' : 'Session Needs Retry'}</strong>
                    <span>{knowledgeResult.score}%</span>
                  </div>
                  <p>{knowledgeResult.summary}</p>
                  <div className="result-columns">
                    <div>
                      <h3>Strengths</h3>
                      <ul className="detail-list">
                        {knowledgeResult.strengths.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3>Gaps</h3>
                      <ul className="detail-list">
                        {knowledgeResult.gaps.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3>Next Actions</h3>
                      <ul className="detail-list">
                        {knowledgeResult.nextActions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default App;

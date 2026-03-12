export type LearnerStage =
  | 'school_student'
  | 'college_student'
  | 'engineer'
  | 'career_switcher'
  | 'self_learner';

export type SessionStatus = 'ready' | 'locked' | 'completed' | 'retry';
export type GoalTrack = 'school' | 'coding' | 'professional' | 'general';

export interface GoalBootstrapInput {
  learnerName: string;
  learnerStage: LearnerStage;
  goal: string;
  currentLevel: string;
  timelineWeeks: number;
  studyMinutesPerDay: number;
  subjects: string[];
  interests: string[];
  supportStyle: string;
}

export interface KnowledgeCheckQuestion {
  id: string;
  prompt: string;
  expectedKeywords: string[];
  minWords: number;
}

export interface KnowledgeCheck {
  intro: string;
  passThreshold: number;
  questions: KnowledgeCheckQuestion[];
}

export interface LearningSession {
  id: string;
  sprintId: string;
  index: number;
  title: string;
  objective: string;
  whyItMatters: string;
  focusAreas: string[];
  studySteps: string[];
  prepList: string[];
  successCriteria: string[];
  recommendedResources: string[];
  knowledgeCheck: KnowledgeCheck;
  status: SessionStatus;
  retries: number;
  completedAt?: string;
  lastScore?: number;
}

export interface RoadmapPhase {
  id: string;
  title: string;
  goal: string;
  sessionIds: string[];
}

export interface SprintTicket {
  id: string;
  sessionId: string;
  title: string;
  outcome: string;
  status: 'pending' | 'active' | 'done';
}

export interface Sprint {
  id: string;
  title: string;
  goal: string;
  sessionIds: string[];
  tickets: SprintTicket[];
}

export interface GoalBlueprint {
  learnerName: string;
  learnerStage: LearnerStage;
  goal: string;
  goalTrack: GoalTrack;
  currentLevel: string;
  timelineWeeks: number;
  studyMinutesPerDay: number;
  subjects: string[];
  interests: string[];
  supportStyle: string;
  roadmapSummary: string;
  phases: RoadmapPhase[];
  sprints: Sprint[];
  sessions: LearningSession[];
  activeSessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreparedSession {
  sessionId: string;
  title: string;
  objective: string;
  coachOpening: string;
  whatToStudy: string[];
  howToStudy: string[];
  prepList: string[];
  successCriteria: string[];
  recommendedResources: string[];
  knowledgeCheck: KnowledgeCheck;
}

export interface SessionCompletionResult {
  passed: boolean;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  nextActions: string[];
  updatedBlueprint: GoalBlueprint;
}

const DEFAULT_PASS_THRESHOLD = 70;

const TRACK_KEYWORDS: Record<GoalTrack, string[]> = {
  coding: [
    'leetcode',
    'dsa',
    'algorithm',
    'react',
    'javascript',
    'typescript',
    'system design',
    'coding',
    'programming',
    'frontend',
    'backend',
  ],
  school: [
    'class',
    'board',
    'exam',
    'math',
    'physics',
    'chemistry',
    'biology',
    'history',
    'science',
    'english',
    'school',
    'chapter',
  ],
  professional: [
    'interview',
    'job',
    'career',
    'promotion',
    'presentation',
    'management',
    'product',
  ],
  general: [],
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function cloneBlueprint(blueprint: GoalBlueprint) {
  return JSON.parse(JSON.stringify(blueprint)) as GoalBlueprint;
}

function normalizeList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function detectGoalTrack(goal: string, subjects: string[]) {
  const haystack = `${goal} ${subjects.join(' ')}`.toLowerCase();
  for (const [track, keywords] of Object.entries(TRACK_KEYWORDS) as [GoalTrack, string[]][]) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return track;
    }
  }
  return 'general';
}

function splitGoalIntoKeywords(goal: string) {
  return goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 3)
    .slice(0, 8);
}

function formatTrackLabel(track: GoalTrack) {
  switch (track) {
    case 'coding':
      return 'coding';
    case 'school':
      return 'school study';
    case 'professional':
      return 'career learning';
    default:
      return 'goal-based learning';
  }
}

function buildSessionTemplates(track: GoalTrack, goal: string) {
  if (track === 'coding') {
    return [
      {
        title: 'Baseline and problem map',
        objective: `Clarify the problem space for "${goal}" and identify the few core patterns that will matter most.`,
        focusAreas: ['problem framing', 'baseline understanding', 'pattern map'],
      },
      {
        title: 'Foundations and mental models',
        objective: `Build the core mental models and primitives needed to make progress on "${goal}".`,
        focusAreas: ['concept building', 'terminology', 'core mechanics'],
      },
      {
        title: 'Guided worked examples',
        objective: `Study one or two guided examples connected to "${goal}" and extract the reusable pattern.`,
        focusAreas: ['example walkthrough', 'pattern extraction', 'explain-back'],
      },
      {
        title: 'Independent attempt with hints',
        objective: `Attempt an original task related to "${goal}" with the tutor guiding only when needed.`,
        focusAreas: ['independent attempt', 'debugging', 'hint ladder'],
      },
      {
        title: 'Application sprint',
        objective: `Apply the ideas from "${goal}" in a timed, realistic practice block.`,
        focusAreas: ['applied practice', 'speed and accuracy', 'mistake review'],
      },
      {
        title: 'Review and mastery check',
        objective: `Review what you learned for "${goal}" and prove you can explain and apply it independently.`,
        focusAreas: ['retrieval', 'transfer', 'mastery'],
      },
    ];
  }

  if (track === 'school') {
    return [
      {
        title: 'Diagnosis and chapter map',
        objective: `Map what you already know for "${goal}" and identify the exact chapter or topic gaps.`,
        focusAreas: ['prior knowledge', 'topic map', 'confidence check'],
      },
      {
        title: 'Concept foundations',
        objective: `Build the foundation concepts required for "${goal}" with clear intuition and examples.`,
        focusAreas: ['concepts', 'intuition', 'definitions'],
      },
      {
        title: 'Visual explanation and notes',
        objective: `Teach the core idea for "${goal}" visually and turn it into crisp notes.`,
        focusAreas: ['diagrams', 'notes', 'recall cues'],
      },
      {
        title: 'Guided practice',
        objective: `Solve guided questions for "${goal}" and learn how to approach them step by step.`,
        focusAreas: ['worked questions', 'method', 'error spotting'],
      },
      {
        title: 'Independent practice set',
        objective: `Solve a mixed practice set for "${goal}" with help only when truly needed.`,
        focusAreas: ['independent solving', 'self-checking', 'accuracy'],
      },
      {
        title: 'Revision and test simulation',
        objective: `Consolidate "${goal}" with retrieval, short testing, and a final explanation check.`,
        focusAreas: ['revision', 'memory', 'exam readiness'],
      },
    ];
  }

  return [
    {
      title: 'Orientation and baseline',
      objective: `Clarify the target outcome for "${goal}" and identify what success should look like.`,
      focusAreas: ['goal clarity', 'baseline', 'scope'],
    },
    {
      title: 'Core foundations',
      objective: `Build the essential concepts and vocabulary needed for "${goal}".`,
      focusAreas: ['concepts', 'vocabulary', 'examples'],
    },
    {
      title: 'Guided learning block',
      objective: `Move through a guided lesson for "${goal}" and convert it into reusable notes.`,
      focusAreas: ['guided learning', 'notes', 'reflection'],
    },
    {
      title: 'Independent practice',
      objective: `Attempt meaningful practice tied to "${goal}" and surface the remaining weak spots.`,
      focusAreas: ['practice', 'self-explanation', 'feedback'],
    },
    {
      title: 'Application and transfer',
      objective: `Apply the skills from "${goal}" in a realistic mini-project or problem set.`,
      focusAreas: ['application', 'transfer', 'decision-making'],
    },
    {
      title: 'Review and mastery',
      objective: `Review and verify that you can now explain and apply "${goal}" independently.`,
      focusAreas: ['retrieval', 'review', 'mastery'],
    },
  ];
}

function buildPrepList(track: GoalTrack, title: string, goal: string) {
  const common = [
    'Bring your notebook or notes area so you can write down the final takeaways.',
    `Keep your focus on this session only: ${title.toLowerCase()}.`,
  ];

  if (track === 'coding') {
    return [
      'Open your editor and the problem statement before starting.',
      'Have the runtime or playground ready so you can test ideas quickly.',
      `Share your screen so the tutor can watch how you approach "${goal}".`,
      ...common,
    ];
  }

  if (track === 'school') {
    return [
      'Open the relevant chapter, worksheet, or class notes.',
      'Keep rough paper ready for working through examples.',
      `Share the tab or material connected to "${goal}" so the tutor can guide from what you see.`,
      ...common,
    ];
  }

  return [
    'Open the main material or resource you plan to study from.',
    'Keep a place for quick notes and a short recap at the end.',
    `Share the working surface related to "${goal}" so the tutor can stay in context.`,
    ...common,
  ];
}

function buildStudySteps(track: GoalTrack, title: string, objective: string) {
  const intro = `Start with a 2 minute recall: say out loud what you already know about ${title.toLowerCase()}.`;
  const reflection = 'Pause after each chunk and explain the idea back in your own words before moving on.';

  if (track === 'coding') {
    return [
      intro,
      `Read the task carefully and restate the objective: ${objective}`,
      'Try a solution or approach yourself before asking for implementation help.',
      'When stuck, ask for the smallest hint that unlocks the next step rather than the full answer.',
      reflection,
    ];
  }

  if (track === 'school') {
    return [
      intro,
      `Study the concept block for this session: ${objective}`,
      'Use examples, diagrams, and your own notes to build intuition before solving questions.',
      'Attempt one question independently before asking for full explanation.',
      reflection,
    ];
  }

  return [
    intro,
    `Work through the main concept or task for this session: ${objective}`,
    'Keep the tutor as a guide, not a replacement for your own attempt.',
    'After each task, summarize the pattern or lesson you want to remember tomorrow.',
    reflection,
  ];
}

function buildSuccessCriteria(track: GoalTrack, goal: string, focusAreas: string[]) {
  const base = [
    `You can explain the key idea behind "${goal}" without reading from notes.`,
    'You can complete at least one fresh task or example with minimal help.',
  ];

  if (track === 'coding') {
    return [
      ...base,
      'You can point out where your solution could fail and how you would debug it.',
      `You can name the main pattern or technique behind ${focusAreas[0] ?? 'today’s work'}.`,
    ];
  }

  return [
    ...base,
    'You can identify the common mistake to avoid in this topic.',
    `You can summarize the session in 3 to 4 bullet points around ${focusAreas.join(', ')}.`,
  ];
}

function buildRecommendedResources(track: GoalTrack, goal: string, subjects: string[]) {
  if (track === 'coding') {
    return [
      `Open the task or problem statement related to "${goal}".`,
      'Keep official docs or reference notes open for the concepts you are using.',
      'Use the whiteboard when a flow, recursion tree, or data-structure diagram would help.',
    ];
  }

  if (track === 'school') {
    return [
      `Keep the chapter or textbook section for "${goal}" open.`,
      `Bring any worksheet or solved example for ${subjects[0] || 'the topic'}.`,
      'Use the whiteboard for concept maps, derivations, or visual explanations.',
    ];
  }

  return [
    `Gather the main material for "${goal}".`,
    'Use the whiteboard when the concept needs to be visualized.',
    'Search for a current reference only when the material is time-sensitive or unclear.',
  ];
}

function buildKnowledgeCheck(goal: string, title: string, focusAreas: string[]): KnowledgeCheck {
  const keywords = normalizeList([...splitGoalIntoKeywords(goal), ...focusAreas]);
  const baseKeywords = keywords.length > 0 ? keywords : ['concept', 'approach', 'reasoning'];

  return {
    intro: `You only finish this session after you show understanding for ${title.toLowerCase()}.`,
    passThreshold: DEFAULT_PASS_THRESHOLD,
    questions: [
      {
        id: 'q1',
        prompt: `In your own words, what was the main idea behind ${title.toLowerCase()}?`,
        expectedKeywords: baseKeywords.slice(0, 3),
        minWords: 18,
      },
      {
        id: 'q2',
        prompt: 'What is one mistake or misconception you should avoid next time?',
        expectedKeywords: ['mistake', 'avoid', ...baseKeywords.slice(0, 2)],
        minWords: 14,
      },
      {
        id: 'q3',
        prompt: 'How would you apply today’s learning in a fresh example or real task?',
        expectedKeywords: ['apply', 'example', ...baseKeywords.slice(0, 2)],
        minWords: 18,
      },
    ],
  };
}

function buildRoadmapSummary(input: GoalBootstrapInput, track: GoalTrack) {
  return `${input.learnerName || 'Learner'} is following a ${input.timelineWeeks}-week ${formatTrackLabel(track)} roadmap for "${input.goal}". Each session starts with a clear study plan, keeps the tutor available during work, and ends with a knowledge check before the next session unlocks.`;
}

function buildSprintGoal(goal: string, index: number) {
  return index === 0
    ? `Build the base needed to make ${goal} feel doable.`
    : `Convert the foundation from ${goal} into independent performance.`;
}

function buildSessionFromTemplate(
  template: ReturnType<typeof buildSessionTemplates>[number],
  input: GoalBootstrapInput,
  track: GoalTrack,
  index: number,
): LearningSession {
  const sprintId = index < 3 ? 'sprint-1' : 'sprint-2';
  const sessionId = `session-${index + 1}`;

  return {
    id: sessionId,
    sprintId,
    index: index + 1,
    title: template.title,
    objective: template.objective,
    whyItMatters: `This session moves ${input.goal} forward by focusing on ${template.focusAreas.join(', ')}.`,
    focusAreas: template.focusAreas,
    studySteps: buildStudySteps(track, template.title, template.objective),
    prepList: buildPrepList(track, template.title, input.goal),
    successCriteria: buildSuccessCriteria(track, input.goal, template.focusAreas),
    recommendedResources: buildRecommendedResources(track, input.goal, input.subjects),
    knowledgeCheck: buildKnowledgeCheck(input.goal, template.title, template.focusAreas),
    status: index === 0 ? 'ready' : 'locked',
    retries: 0,
  };
}

function recalculateTickets(sessions: LearningSession[], sprint: Sprint): Sprint {
  const tickets = sprint.tickets.map((ticket) => {
    const session = sessions.find((item) => item.id === ticket.sessionId);
    if (!session) return ticket;

    let status: SprintTicket['status'] = 'pending';
    if (session.status === 'completed') {
      status = 'done';
    } else if (session.status === 'ready' || session.status === 'retry') {
      status = 'active';
    }

    return { ...ticket, status };
  });

  return { ...sprint, tickets };
}

export function generateGoalBlueprint(input: GoalBootstrapInput): GoalBlueprint {
  const track = detectGoalTrack(input.goal, input.subjects);
  const templates = buildSessionTemplates(track, input.goal);
  const sessions = templates.map((template, index) =>
    buildSessionFromTemplate(template, input, track, index),
  );

  const phases: RoadmapPhase[] = [
    {
      id: 'phase-1',
      title: 'Foundation',
      goal: `Understand the core ideas behind "${input.goal}".`,
      sessionIds: sessions.slice(0, 2).map((session) => session.id),
    },
    {
      id: 'phase-2',
      title: 'Guided Practice',
      goal: `Use the tutor to practice and strengthen "${input.goal}".`,
      sessionIds: sessions.slice(2, 4).map((session) => session.id),
    },
    {
      id: 'phase-3',
      title: 'Mastery',
      goal: `Perform independently and retain "${input.goal}".`,
      sessionIds: sessions.slice(4).map((session) => session.id),
    },
  ];

  const sprints: Sprint[] = [
    {
      id: 'sprint-1',
      title: 'Sprint 1',
      goal: buildSprintGoal(input.goal, 0),
      sessionIds: sessions.slice(0, 3).map((session) => session.id),
      tickets: sessions.slice(0, 3).map((session) => ({
        id: `ticket-${session.id}`,
        sessionId: session.id,
        title: session.title,
        outcome: session.objective,
        status: session.status === 'ready' ? 'active' : 'pending',
      })),
    },
    {
      id: 'sprint-2',
      title: 'Sprint 2',
      goal: buildSprintGoal(input.goal, 1),
      sessionIds: sessions.slice(3).map((session) => session.id),
      tickets: sessions.slice(3).map((session) => ({
        id: `ticket-${session.id}`,
        sessionId: session.id,
        title: session.title,
        outcome: session.objective,
        status: 'pending',
      })),
    },
  ];

  const createdAt = new Date().toISOString();
  return {
    learnerName: input.learnerName,
    learnerStage: input.learnerStage,
    goal: input.goal,
    goalTrack: track,
    currentLevel: input.currentLevel,
    timelineWeeks: input.timelineWeeks,
    studyMinutesPerDay: input.studyMinutesPerDay,
    subjects: normalizeList(input.subjects),
    interests: normalizeList(input.interests),
    supportStyle: input.supportStyle,
    roadmapSummary: buildRoadmapSummary(input, track),
    phases,
    sprints,
    sessions,
    activeSessionId: sessions[0]?.id ?? 'session-1',
    createdAt,
    updatedAt: createdAt,
  };
}

export function prepareSession(blueprint: GoalBlueprint, sessionId: string): PreparedSession {
  const session = blueprint.sessions.find((item) => item.id === sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  if (session.status === 'locked') {
    throw new Error('Session is locked until previous sessions are completed');
  }

  const phase = blueprint.phases.find((item) => item.sessionIds.includes(session.id));
  const previousSession = blueprint.sessions.find((item) => item.index === session.index - 1);

  return {
    sessionId: session.id,
    title: session.title,
    objective: session.objective,
    coachOpening: `${blueprint.learnerName}, welcome back. Today we are working on "${session.title}" for your goal "${blueprint.goal}". I will first help you get set up, then I will stay with you while you study, and we will only close this session after you pass the knowledge check.`,
    whatToStudy: [
      phase ? `Roadmap phase: ${phase.title}` : 'Roadmap phase: active session',
      session.objective,
      previousSession?.status === 'completed'
        ? `Use what you learned previously in "${previousSession.title}" as the starting point.`
        : 'Start from the current session objective and do not rush ahead to later topics.',
    ],
    howToStudy: session.studySteps,
    prepList: session.prepList,
    successCriteria: session.successCriteria,
    recommendedResources: session.recommendedResources,
    knowledgeCheck: session.knowledgeCheck,
  };
}

function scoreAnswer(answer: string, question: KnowledgeCheckQuestion) {
  const normalizedAnswer = answer.toLowerCase();
  const words = normalizedAnswer.split(/\s+/).filter(Boolean);
  const keywordMatches = question.expectedKeywords.filter((keyword) =>
    normalizedAnswer.includes(keyword.toLowerCase()),
  ).length;

  const wordRatio = Math.min(1, words.length / question.minWords);
  const keywordRatio = question.expectedKeywords.length
    ? keywordMatches / question.expectedKeywords.length
    : 1;

  return Math.round(((wordRatio * 0.45) + (keywordRatio * 0.55)) * 100);
}

function unlockNextSession(sessions: LearningSession[], completedIndex: number) {
  const next = sessions.find((session) => session.index === completedIndex + 1);
  if (next && next.status === 'locked') {
    next.status = 'ready';
  }
}

function firstOpenSessionId(sessions: LearningSession[]) {
  const readySession = sessions.find((session) => session.status === 'ready' || session.status === 'retry');
  return readySession?.id ?? sessions.at(-1)?.id ?? 'session-1';
}

export function completeSession(
  blueprint: GoalBlueprint,
  sessionId: string,
  answers: Record<string, string>,
): SessionCompletionResult {
  const updatedBlueprint = cloneBlueprint(blueprint);
  const session = updatedBlueprint.sessions.find((item) => item.id === sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  if (session.status === 'locked') {
    throw new Error('Session is locked until previous sessions are completed');
  }

  const questionResults = session.knowledgeCheck.questions.map((question) => {
    const answer = answers[question.id] ?? '';
    return {
      question,
      answer,
      score: scoreAnswer(answer, question),
    };
  });

  const score =
    questionResults.reduce((total, result) => total + result.score, 0) /
    Math.max(1, questionResults.length);
  const passed = score >= session.knowledgeCheck.passThreshold;

  session.lastScore = Math.round(score);
  session.retries += passed ? 0 : 1;

  const strengths = questionResults
    .filter((result) => result.score >= 75)
    .map((result) => `Clear understanding shown in: ${result.question.prompt}`);
  const gaps = questionResults
    .filter((result) => result.score < 75)
    .map((result) => `Needs reinforcement on: ${result.question.prompt}`);

  if (passed) {
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    unlockNextSession(updatedBlueprint.sessions, session.index);
  } else {
    session.status = 'retry';
    session.studySteps = [
      'Start with a short recap of the concepts you missed in the knowledge check.',
      'Try one more fresh example with the tutor giving only hints.',
      'Explain the corrected approach back in your own words before re-attempting the check.',
      ...session.studySteps.slice(0, 2),
    ].slice(0, 5);
  }

  updatedBlueprint.activeSessionId = passed
    ? firstOpenSessionId(updatedBlueprint.sessions)
    : session.id;
  updatedBlueprint.sprints = updatedBlueprint.sprints.map((sprint) =>
    recalculateTickets(updatedBlueprint.sessions, sprint),
  );
  updatedBlueprint.updatedAt = new Date().toISOString();

  return {
    passed,
    score: Math.round(score),
    summary: passed
      ? `Knowledge check passed for ${session.title}. The next session is ready.`
      : `Knowledge check not passed yet for ${session.title}. Reinforcement is required before moving on.`,
    strengths:
      strengths.length > 0
        ? strengths
        : ['You showed enough understanding to move the session forward.'],
    gaps:
      gaps.length > 0
        ? gaps
        : ['No major gaps were detected in this check.'],
    nextActions: passed
      ? [
          'Write down the 3 ideas you want to remember tomorrow.',
          'Start the next ready session when you are fresh.',
        ]
      : [
          'Review the missed parts before retrying the knowledge check.',
          'Ask the tutor for a hint instead of a full answer if you get stuck.',
          'Retry this same session after one focused reinforcement block.',
        ],
    updatedBlueprint,
  };
}

export function createDefaultGoalInput(): GoalBootstrapInput {
  return {
    learnerName: 'Learner',
    learnerStage: 'self_learner',
    goal: '',
    currentLevel: 'Beginner',
    timelineWeeks: 4,
    studyMinutesPerDay: 45,
    subjects: [],
    interests: [],
    supportStyle: 'Guide me with hints before giving direct answers.',
  };
}

export function isGoalBootstrapInput(value: unknown): value is GoalBootstrapInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.goal === 'string' && typeof candidate.learnerName === 'string';
}

export function isGoalBlueprint(value: unknown): value is GoalBlueprint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.goal === 'string' && Array.isArray(candidate.sessions);
}

export function safeGoalId(goal: string) {
  return slugify(goal) || 'learning-goal';
}

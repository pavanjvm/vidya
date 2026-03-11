export type LearnerStage =
  | 'school_student'
  | 'college_student'
  | 'engineer'
  | 'career_switcher'
  | 'self_learner';

export type SessionStatus = 'ready' | 'locked' | 'completed' | 'retry';

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
  goalTrack: 'school' | 'coding' | 'professional' | 'general';
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

export interface GoalFormState {
  learnerName: string;
  learnerStage: LearnerStage;
  goal: string;
  currentLevel: string;
  timelineWeeks: number;
  studyMinutesPerDay: number;
  subjects: string;
  interests: string;
  supportStyle: string;
}

export interface PersistedAppState {
  blueprint: GoalBlueprint | null;
  lastPreparedSessionId: string | null;
}

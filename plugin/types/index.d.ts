export type Confidence = 'low' | 'medium' | 'high'
export type Reversibility = 'easy' | 'moderate' | 'hard'

/** What the person asked of a decision: explain it, or defend it. */
export type ReviewKind = 'clarify' | 'challenge'

/** How the agent closed a review: it explained, or recommends keeping or changing the choice. */
export type ReviewOutcome = 'explained' | 'keep' | 'change'

export type Alternative = { option: string; whyNot?: string }

export type Review = {
  kind: ReviewKind
  /** The person's own question or concern, when they typed one. */
  note?: string
  sentAt: number
  /** `prompt` started a turn; `turn` was slipped into the running one. */
  route: 'prompt' | 'turn'
  /** A `turn` review the agent left unanswered, re-sent once as a prompt. */
  isFollowedUp?: boolean
  outcome?: ReviewOutcome
  reply?: string
}

export type Decision = {
  /** `D1`, `D2`, ... in the order recorded. */
  id: string
  summary: string
  choice: string
  why: string
  alternatives: Alternative[]
  assumptions: string[]
  confidence: Confidence
  reversibility: Reversibility
  /** What prompted the choice, in the agent's words. */
  situation?: string
  files: string[]
  /** The prompt of the turn the decision was made in. */
  turnPrompt?: string
  /** The subagent that made it; absent for the main agent. */
  agentId?: string
  supersedes?: string
  at: number
  reviews: Review[]
}

/** The main loop's running turn, if any. */
export type Turn = { id: string; prompt: string }

/** The decision last taken off the list, and where it stood, for Undo. */
export type Acknowledged = { decision: Decision; index: number }

/** What a row's surface module posts: a click toggles, a right-click acknowledges. */
export type RowMessage = { id: string; action: 'toggle' | 'acknowledge' }

declare module 'claude-code' {
  interface PluginState {
    'decision-tracker': {
      decisions: Decision[]
      seq: number
      openId: string | null
      turn: Turn | null
      isDismissed: boolean
      lastAcknowledged: Acknowledged | null
    }
  }
}

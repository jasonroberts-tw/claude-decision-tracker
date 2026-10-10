import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Alternative,
  Confidence,
  Decision,
  Review,
  ReviewKind,
  ReviewOutcome,
  Reversibility,
  RowMessage,
} from '../types'

const PANE = 'decisions'
const TITLE = 'Decisions'
const RECORD_TOOL = 'mcp__decision-tracker__record_decision'
const ANSWER_TOOL = 'mcp__decision-tracker__answer_review'

const decisions = atom({ plugin: 'decision-tracker', key: 'decisions' } as const, [])
const seq = atom({ plugin: 'decision-tracker', key: 'seq' } as const, 0)
const openId = atom({ plugin: 'decision-tracker', key: 'openId' } as const, null)
const turn = atom({ plugin: 'decision-tracker', key: 'turn' } as const, null)
const isDismissed = atom({ plugin: 'decision-tracker', key: 'isDismissed' } as const, false)
const lastAcknowledged = atom({ plugin: 'decision-tracker', key: 'lastAcknowledged' } as const, null)

const CONFIDENCE: readonly Confidence[] = ['low', 'medium', 'high']
const REVERSIBILITY: readonly Reversibility[] = ['easy', 'moderate', 'hard']
const OUTCOMES: readonly ReviewOutcome[] = ['explained', 'keep', 'change']

const OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  explained: 'Agent explained:',
  keep: 'Agent recommends keeping it:',
  change: 'Agent recommends changing it:',
}

const GUIDE = `# Decision log

The person reviews your judgement calls in a Decisions pane and can ask you to clarify or defend any of them. Whenever you commit to a non-trivial choice the person did not specify, call ${RECORD_TOOL} before acting on it. This matters most when you work autonomously (auto mode, long unattended runs), where the person cannot weigh in as you go.

Record: choosing between viable approaches, tools, libraries, formats or structures; resolving an ambiguous request one way; assuming something about intent, scope or data; deliberately skipping, deferring or simplifying part of the work; departing from the request or from convention; anything costly to undo. Do not record mechanical steps, choices the person already made, or the obvious reading of a clear instruction. Aim for the handful of choices a careful reviewer would want to see, not a play-by-play.

Recording is not asking: log the call once and keep working. If you later reverse a logged decision, record the new one with \`supersedes\`.

When the person sends a message starting "[decision-tracker]" to clarify or challenge a decision, answer it in the conversation, then call ${ANSWER_TOOL} so the pane shows your reply.`

const RECORD_SPEC = {
  name: 'record_decision',
  description:
    "Log a judgement call you are making (one the person did not specify) to the person's Decisions pane, where they can review it and ask you about it. Call it as you commit to the choice, then carry on: it does not wait for approval. Returns the decision's id (D1, D2, ...).",
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'The decision in at most 80 characters, e.g. "Read the budget sheet with openpyxl, not pandas".',
      },
      choice: { type: 'string', description: 'What you decided, concretely, in a sentence or two.' },
      why: { type: 'string', description: 'The evidence and reasoning that drove it.' },
      alternatives: {
        type: 'array',
        description: 'Options you considered and rejected.',
        items: {
          type: 'object',
          properties: {
            option: { type: 'string' },
            why_not: { type: 'string' },
          },
          required: ['option'],
        },
      },
      assumptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'What you assumed that, if wrong, would change the decision.',
      },
      confidence: { type: 'string', enum: CONFIDENCE },
      reversibility: {
        type: 'string',
        enum: REVERSIBILITY,
        description: 'How costly it would be to undo later.',
      },
      situation: {
        type: 'string',
        description: 'What prompted the choice: the ambiguity, constraint or finding you hit.',
      },
      files: { type: 'array', items: { type: 'string' }, description: 'Files the decision affects.' },
      supersedes: { type: 'string', description: 'The id of an earlier decision this one replaces.' },
    },
    required: ['summary', 'choice', 'why', 'confidence', 'reversibility'],
  },
}

const ANSWER_SPEC = {
  name: 'answer_review',
  description:
    'Record your answer to the person\'s Clarify or Challenge of a logged decision, so their Decisions pane shows it. Call it after answering in the conversation. Outcome: "explained" for a clarification; "keep" or "change" for your recommendation on a challenged decision.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The decision id, e.g. "D3".' },
      outcome: { type: 'string', enum: OUTCOMES },
      reply: { type: 'string', description: 'Your answer in a short paragraph.' },
    },
    required: ['id', 'outcome', 'reply'],
  },
}

// Typed but unsent questions, per decision; a reload losing one is harmless.
const drafts = new Map<string, string>()

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const strs = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter(text => text !== '') : []

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.find(option => option === value) ?? fallback

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

const isAwaiting = (decision: Decision): boolean =>
  decision.reviews.some(review => review.outcome === undefined)

const alternativesOf = (value: unknown): Alternative[] =>
  Array.isArray(value)
    ? value.flatMap(item => {
        const option = str(item?.option ?? item)
        const whyNot = str(item?.why_not)

        return option === '' ? [] : [whyNot === '' ? { option } : { option, whyNot }]
      })
    : []

async function refreshStatus($: EngineInterface): Promise<void> {
  const list = await read($, decisions)
  const awaiting = list.filter(isAwaiting).length

  $.ui.status(
    list.length === 0
      ? undefined
      : `◆ ${plural(list.length, 'decision')}${awaiting > 0 ? ` · ${awaiting} awaiting reply` : ''}`,
  )
}

function reviewText(decision: Decision, kind: ReviewKind, note?: string): string {
  // The agent's own text goes out in the person's name, so it stays on one
  // quoted line: a newline in it could pass for something the person said.
  const logged = `You logged it as (your words, quoted): “${clip(oneLine(decision.choice), 300)}” Reason given: “${clip(oneLine(decision.why), 300)}”`

  if (kind === 'clarify') {
    return [
      `[decision-tracker] Clarify ${decision.id}: "${decision.summary}"`,
      note ? `My question: ${note}` : 'Walk me through this choice.',
      '',
      logged,
      '',
      'Explain what you knew when you decided, which alternatives you weighed and why you rejected them, what you assumed, and how confident you are. This is a question, not a request to change course: keep your current approach unless explaining it shows it was wrong.',
      `Then call ${ANSWER_TOOL} with id "${decision.id}", outcome "explained" (or "change" if you now think it should change), and a short reply.`,
    ].join('\n')
  }

  return [
    `[decision-tracker] Challenge ${decision.id}: "${decision.summary}"`,
    `I want to scrutinize this choice before you build further on it.${note ? ` My concern: ${note}` : ''}`,
    '',
    logged,
    '',
    '1. Pause any work that depends on it.',
    '2. Make the strongest honest case against it, and compare it with the alternatives, including any you did not consider at the time.',
    '3. Say what evidence would settle it, and check whatever you cheaply can now.',
    '4. Recommend keeping or changing it, and say what changing would cost at this point.',
    `Then call ${ANSWER_TOOL} with id "${decision.id}", outcome "keep" or "change", and a short reply, and stop for my verdict before continuing work that depends on it. Do not apply a change until I agree.`,
  ].join('\n')
}

// Whether the running turn took the text as a row it reads at its next step.
async function slipIntoTurn($: EngineInterface, text: string): Promise<boolean> {
  const appended = await $.session
    .append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    .catch(() => undefined)

  return appended !== undefined && appended.deny === undefined
}

// Puts a decision back to the agent: into the running turn when there is one
// that takes it, else as a prompt of its own (queued until any turn ends).
async function send(
  $: EngineInterface,
  id: string,
  kind: ReviewKind,
  typed?: string,
): Promise<void> {
  const decision = (await read($, decisions)).find(one => one.id === id)
  if (decision === undefined) return

  const note = (typed ?? drafts.get(id) ?? '').trim()
  drafts.delete(id)

  const text = reviewText(decision, kind, note === '' ? undefined : note)
  const verb = kind === 'clarify' ? 'Clarify' : 'Challenge'
  const isRunning = (await read($, turn)) !== null
  const isInTurn = isRunning && (await slipIntoTurn($, text))
  const review: Review = {
    kind,
    sentAt: await $.clock.now(),
    route: isInTurn ? 'turn' : 'prompt',
    ...(note === '' ? {} : { note }),
  }
  await update($, decisions, list =>
    list.map(one => (one.id === id ? { ...one, reviews: [...one.reviews, review] } : one)),
  )
  await refreshStatus($)

  if (isInTurn) {
    await $.session
      .append({
        message: {
          type: 'system',
          content: [{ type: 'text', text: `decision-tracker: ${verb} ${id} sent into the running turn` }],
        },
      })
      .catch(() => undefined)
    $.ui.toast(`${verb} ${id} sent; the agent reads it at its next step`)

    return
  }

  if (isRunning) {
    $.ui.toast(`${verb} ${id} queued; it goes to the agent when this turn ends`)
  }
  await $.prompt.submit({ text, asUser: true })
}

const toggle = ($: EngineInterface, id: string) =>
  update($, openId, current => (current === id ? null : id))

// Takes a decision the person accepts off the list, keeping it for Undo; ids
// are not reused.
async function acknowledge($: EngineInterface, id: string): Promise<void> {
  const list = await read($, decisions)
  const index = list.findIndex(one => one.id === id)
  const decision = list[index]
  if (decision === undefined) return

  drafts.delete(id)
  await update($, lastAcknowledged, () => ({ decision, index }))
  await update($, decisions, all => all.filter(one => one.id !== id))
  await update($, openId, current => (current === id ? null : current))
  await refreshStatus($)
}

// Puts the last acknowledged decision back where it stood. Only appends
// happen in between (a clear drops it), so its index still holds.
async function undo($: EngineInterface): Promise<void> {
  const last = await read($, lastAcknowledged)
  if (last === null) return

  await update($, lastAcknowledged, () => null)
  await update($, decisions, list =>
    list.some(one => one.id === last.decision.id) ? list : list.toSpliced(last.index, 0, last.decision),
  )
  await refreshStatus($)
}

async function clear($: EngineInterface): Promise<void> {
  await update($, decisions, () => [])
  await update($, openId, () => null)
  await update($, lastAcknowledged, () => null)
  await refreshStatus($)
}

// Reviews slipped into a turn that ended without an answer go again, once, as
// a prompt of their own.
async function followUp($: EngineInterface): Promise<void> {
  const isOwed = (review: Review) =>
    review.route === 'turn' && review.outcome === undefined && review.isFollowedUp !== true
  const list = await read($, decisions)
  const owed = list.flatMap(decision =>
    decision.reviews.filter(isOwed).map(review => reviewText(decision, review.kind, review.note)),
  )
  if (owed.length === 0) return

  await update($, decisions, all =>
    all.map(decision => ({
      ...decision,
      reviews: decision.reviews.map(review =>
        isOwed(review) ? { ...review, isFollowedUp: true } : review,
      ),
    })),
  )

  const text = [
    `(Sent while you were mid-task and not yet answered. If you already dealt with one, just record it with ${ANSWER_TOOL}.)`,
    ...owed,
  ].join('\n\n')
  $.clock.after(250, () => void $.prompt.submit({ text, asUser: true }).catch(() => undefined))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'decisions',
      description: "Open the pane of the agent's logged decisions (`/decisions clear` empties it)",
      argumentHint: '[clear]',
    })
    await $.tool.register(RECORD_SPEC)
    await $.tool.register(ANSWER_SPEC)
    await update($, turn, () => null)
    await refreshStatus($)

    if (!(await read($, isDismissed))) {
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await clear($)

    return next(e)
  })

  on('command.run', { command: 'decisions' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await clear($)

      return { text: 'Decision log cleared.' }
    }

    await update($, isDismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Decision log opened.' }
  })

  on('ui.close', { id: 'decisions' }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      await update($, isDismissed, () => true)
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(RECORD_TOOL)) return composed

    return {
      sections: [
        ...composed.sections,
        { id: 'decision-tracker:guide', text: GUIDE, scope: 'session' as const },
      ],
    }
  })

  // Listed up front rather than behind ToolSearch, so logging costs no lookup.
  on('tool.describe', { tool: 'mcp__decision-tracker__record_decision' }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: false,
  }))

  on('tool.describe', { tool: 'mcp__decision-tracker__answer_review' }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: false,
  }))

  on('turn.start', async ($, e, next) => {
    await update($, turn, () => ({ id: e.turnId, prompt: e.text }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined) {
      await update($, turn, () => null)
      if (!e.isAborted) await followUp($)
    }

    return done
  })

  on('tool.call', { tool: 'mcp__decision-tracker__record_decision' }, async ($, e) => {
    const summary = str(e.summary)
    const choice = str(e.choice)
    const why = str(e.why)

    if (summary === '' || choice === '' || why === '') {
      return { deny: 'record_decision needs a summary, a choice and a why.' }
    }

    const n = await update($, seq, value => value + 1)
    const running = await read($, turn)
    const situation = str(e.situation)
    const supersedes = str(e.supersedes).toUpperCase()
    const decision: Decision = {
      id: `D${n}`,
      summary: clip(oneLine(summary), 100),
      choice,
      why,
      alternatives: alternativesOf(e.alternatives),
      assumptions: strs(e.assumptions),
      confidence: oneOf(e.confidence, CONFIDENCE, 'medium'),
      reversibility: oneOf(e.reversibility, REVERSIBILITY, 'moderate'),
      files: strs(e.files),
      at: await $.clock.now(),
      reviews: [],
      ...(situation === '' ? {} : { situation }),
      ...(supersedes === '' ? {} : { supersedes }),
      ...(running === null || running.prompt === '' ? {} : { turnPrompt: running.prompt }),
      ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
    }

    await update($, decisions, list => [...list, decision])
    await refreshStatus($)

    if (!(await read($, isDismissed))) {
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }

    return { result: `Logged as ${decision.id}. Carry on; the person can review it in their Decisions pane.` }
  })

  on('tool.call', { tool: 'mcp__decision-tracker__answer_review' }, async ($, e) => {
    const id = str(e.id).toUpperCase()
    const outcome = oneOf(e.outcome, OUTCOMES, 'explained')
    const reply = str(e.reply)
    const sentAt = await $.clock.now()
    let isFound = false

    await update($, decisions, list =>
      list.map(decision => {
        if (decision.id !== id) return decision

        isFound = true
        const reviews = [...decision.reviews]
        const at = reviews.findLastIndex(review => review.outcome === undefined)
        const asked = reviews[at]
        const answer = reply === '' ? { outcome } : { outcome, reply }

        if (asked === undefined) {
          const kind: ReviewKind = outcome === 'explained' ? 'clarify' : 'challenge'
          reviews.push({ kind, sentAt, route: 'prompt', ...answer })
        } else {
          reviews[at] = { ...asked, ...answer }
        }

        return { ...decision, reviews }
      }),
    )

    if (!isFound) return { deny: `No logged decision has the id "${id}".` }

    await refreshStatus($)

    return { result: `Recorded your "${outcome}" answer on ${id}.` }
  })

  // A row's summary posts here (row.tsx): a click toggles, a right-click acknowledges.
  on('ui.message', { requestId: 'decisions' }, async ($, e, next) => {
    const { id, action } = (e.data ?? {}) as Partial<RowMessage>

    if (typeof id === 'string' && action === 'toggle') await toggle($, id)
    if (typeof id === 'string' && action === 'acknowledge') await acknowledge($, id)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'decisions' }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const list = await read($, decisions)
    const open = await read($, openId)
    const last = await read($, lastAcknowledged)
    const width = Math.max(24, e.props.bodyColumns)

    const undoRow = last !== null && (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{`Acknowledged ${last.decision.id}`}</Text>
        <Button key="undo" label="Undo" onPress={() => undo($)} />
      </Box>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>No decisions yet</Text>
          <Text dimColor>
            Judgement calls the agent makes show up here as it works, most usefully in auto
            mode. Select one to see its reasoning, then Clarify, Challenge or Acknowledge it,
            or right-click one to acknowledge it.
          </Text>
          {undoRow}
        </Box>
      )
    }

    const supersededBy = new Map<string, string>()
    for (const decision of list) {
      if (decision.supersedes) supersededBy.set(decision.supersedes, decision.id)
    }
    const awaiting = list.filter(isAwaiting).length

    const markOf = (decision: Decision) => {
      const last = decision.reviews[decision.reviews.length - 1]

      if (supersededBy.has(decision.id)) return { glyph: '↺', color: 'inactive' }
      if (last !== undefined && last.outcome === undefined) {
        return last.kind === 'challenge'
          ? { glyph: '!', color: 'warning' }
          : { glyph: '?', color: 'suggestion' }
      }
      if (last?.outcome === 'change') return { glyph: '↻', color: 'warning' }
      if (last !== undefined) return { glyph: '✓', color: 'success' }
      if (decision.confidence === 'low' || decision.reversibility === 'hard') {
        return { glyph: '◆', color: 'warning' }
      }

      return { glyph: '•', color: 'subtle' }
    }

    // Where a Client draws, the summary is one so it hears right-clicks; the
    // arrow stays a Button so the pane's focus ring still reaches every row.
    const row = (decision: Decision, isOpen: boolean) => {
      const mark = markOf(decision)
      const isReplaced = supersededBy.has(decision.id)
      const arrow = isOpen ? '▾' : '▸'
      const label = `${decision.id}  ${decision.summary}`
      const toggleButton = (text: string) => (
        <Button
          plain
          key={`toggle:${decision.id}`}
          label={text}
          dimColor={isReplaced}
          onPress={() => toggle($, decision.id)}
        />
      )

      const glyph = <Text color={mark.color}>{mark.glyph} </Text>

      // Only the terminal's and the desktop's tables have Client.
      if (e.surface !== 'terminal' && e.surface !== 'desktop') {
        return (
          <Box flexDirection="row">
            {glyph}
            {toggleButton(clip(`${arrow} ${label}`, width - 3))}
          </Box>
        )
      }

      // Called in place with its module path, never bound to a name: the
      // directory refuses any Client it sees without a fixed path beside it.
      return (
        <Box flexDirection="row">
          {glyph}
          <Box flexDirection="row" gap={1}>
            {toggleButton(arrow)}
            {$.ui.resolve(e).Client({
              key: `row:${decision.id}`,
              module: './row.tsx',
              props: { id: decision.id, label: clip(label, width - 5), isDim: isReplaced },
            })}
          </Box>
        </Box>
      )
    }

    const field = (label: string, text: string) => (
      <Text>
        <Text dimColor>{label} </Text>
        {text}
      </Text>
    )

    const reviewView = (review: Review) => (
      <Box flexDirection="column" marginTop={1}>
        <Text color={review.kind === 'challenge' ? 'warning' : 'suggestion'}>
          {review.kind === 'challenge' ? 'You challenged this' : 'You asked for clarification'}
          {review.route === 'turn' ? ' (mid-turn)' : ''}
        </Text>
        {review.note !== undefined && <Text dimColor>{`“${review.note}”`}</Text>}
        {review.outcome === undefined ? (
          <Text dimColor>Waiting for the agent…</Text>
        ) : (
          <Text>
            <Text bold>{OUTCOME_LABEL[review.outcome]}</Text>
            {review.reply === undefined ? '' : ` ${review.reply}`}
          </Text>
        )}
      </Box>
    )

    const card = (decision: Decision) => {
      const replacedBy = supersededBy.get(decision.id)

      return (
        <Box flexDirection="column" marginBottom={1}>
          {row(decision, true)}
          <Box flexDirection="column" paddingLeft={2}>
            {field('Chose', decision.choice)}
            {field('Why', decision.why)}
            {decision.situation !== undefined && field('Prompted by', decision.situation)}
            {decision.alternatives.length > 0 && (
              <Box flexDirection="column">
                <Text dimColor>Instead of</Text>
                {decision.alternatives.map(alt => (
                  <Text>{`  – ${alt.option}${alt.whyNot === undefined ? '' : `: ${alt.whyNot}`}`}</Text>
                ))}
              </Box>
            )}
            {decision.assumptions.length > 0 && (
              <Box flexDirection="column">
                <Text dimColor>Assuming</Text>
                {decision.assumptions.map(assumption => (
                  <Text>{`  – ${assumption}`}</Text>
                ))}
              </Box>
            )}
            <Text dimColor>
              {`${decision.confidence} confidence · ${decision.reversibility} to undo`}
              {decision.agentId === undefined ? '' : ' · by a subagent'}
            </Text>
            {decision.files.length > 0 && field('Files', decision.files.join(', '))}
            {decision.turnPrompt !== undefined && (
              <Text dimColor>{`During “${clip(oneLine(decision.turnPrompt), 160)}”`}</Text>
            )}
            {decision.supersedes !== undefined && (
              <Text dimColor>{`Replaces ${decision.supersedes}`}</Text>
            )}
            {replacedBy !== undefined && <Text color="warning">{`Replaced by ${replacedBy}`}</Text>}
            {decision.reviews.map(reviewView)}
            <Box flexDirection="column" marginTop={1}>
              {Input !== undefined && (
                <Input
                  key={`note:${decision.id}`}
                  placeholder="Optional: your question or concern"
                  value={drafts.get(decision.id) ?? ''}
                  submitLabel="clarify"
                  onInput={value => {
                    drafts.set(decision.id, value)
                  }}
                  onSubmit={value => send($, decision.id, 'clarify', value)}
                />
              )}
              <Box flexDirection="row" gap={1}>
                <Button
                  key={`clarify:${decision.id}`}
                  label="Clarify"
                  onPress={() => send($, decision.id, 'clarify')}
                />
                <Button
                  key={`challenge:${decision.id}`}
                  label="Challenge"
                  onPress={() => send($, decision.id, 'challenge')}
                />
                <Button
                  key={`acknowledge:${decision.id}`}
                  label="Acknowledge"
                  onPress={() => acknowledge($, decision.id)}
                />
              </Box>
            </Box>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {plural(list.length, 'decision')}
          {awaiting > 0 ? ` · ${awaiting} awaiting reply` : ''}
        </Text>
        {undoRow}
        {[...list].reverse().map(decision =>
          decision.id === open ? card(decision) : row(decision, false),
        )}
        <Text dimColor>◆ worth a look · ? asked · ! challenged · ✓ answered · ↺ replaced</Text>
      </Box>
    )
  })
}

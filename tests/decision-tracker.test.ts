import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RECORD = 'mcp__decision-tracker__record_decision'
const ANSWER = 'mcp__decision-tracker__answer_review'
const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'decision-tracker',
  component: 'Pane',
  requestId: 'decisions',
  props: {
    title: 'Decisions',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const DECISION = {
  summary: 'Read the budget sheet with openpyxl, not pandas',
  choice: 'Use openpyxl to read cell values and formulas.',
  why: 'pandas drops formulas, and the report traces figures to them.',
  alternatives: [{ option: 'pandas', why_not: 'loses formulas' }],
  assumptions: ['The sheet has no macros'],
  confidence: 'low',
  reversibility: 'easy',
}

// The engine beneath the plugin: prompts, toasts and opened panes are
// kept for the test to read; registrations and turns are echoed.
function world(on: On) {
  const clock = mock.clock(on)
  const prompts: string[] = []
  const toasts: string[] = []
  const opened: string[] = []

  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__decision-tracker__${e.name}` } }))
  on('ui.open', ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  return { clock, prompts, toasts, opened }
}

const start = { cwd: '/tmp/project', surface: 'terminal', isInteractive: true } as const

test('a logged decision lists, expands, is challenged and shows the answer', async ($, on) => {
  const { prompts, opened } = world(on)
  await $.session.start(start)

  const logged = await $.tool.call({ tool: RECORD, ...DECISION })
  expect(String(logged.result)).toContain('Logged as D1')
  expect(opened).toContain('decisions')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'toggle:D1' }))?.text).toContain('D1  Read the budget sheet')
    expect(await ui.find({ key: 'challenge:D1' })).toBeUndefined()
    await ui.unmount()
  }

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await terminal.press({ key: 'toggle:D1' })
  expect(await terminal.find({ text: /pandas drops formulas/ })).toBeDefined()
  expect(await terminal.find({ text: /loses formulas/ })).toBeDefined()

  await terminal.press({ key: 'challenge:D1' })
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('[decision-tracker] Challenge D1')
  expect(prompts[0]).toContain('stop for my verdict')
  expect(await terminal.find({ text: /Waiting for the agent/ })).toBeDefined()
  await terminal.unmount()

  const answered = await $.tool.call({
    tool: ANSWER,
    id: 'd1',
    outcome: 'keep',
    reply: 'Formulas are the audit trail.',
  })
  expect(String(answered.result)).toContain('D1')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /Agent recommends keeping it/ })).toBeDefined()
    expect(await ui.find({ text: /Waiting for the agent/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a question typed mid-turn that the turn refuses is queued as a prompt', async ($, on) => {
  const { clock, prompts, toasts } = world(on)
  await $.session.start(start)

  await $.turn.start({ text: 'build the report', turnId: 't1' })
  await $.tool.call({ tool: RECORD, ...DECISION })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') await ui.press({ key: 'toggle:D1' })
    expect(await ui.find({ text: /During “build the report”/ })).toBeDefined()
    expect(await ui.find({ key: 'note:D1' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'note:D1', text: 'Why not keep both?' })

  // The kit's session.append has no store beneath it and rejects, as a turn
  // refusing the row would: the plugin falls back to a prompt of its own.
  expect(toasts).toEqual(['Clarify D1 queued; it goes to the agent when this turn ends'])
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('[decision-tracker] Clarify D1')
  expect(prompts[0]).toContain('My question: Why not keep both?')
  expect(await ui.find({ text: /You asked for clarification/ })).toBeDefined()
  expect(await ui.find({ text: /mid-turn/ })).toBeUndefined()
  expect(await ui.find({ text: /“Why not keep both\?”/ })).toBeDefined()

  // A queued review is not followed up when the turn ends.
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1000)
  expect(prompts).toHaveLength(1)
  await ui.unmount()
})

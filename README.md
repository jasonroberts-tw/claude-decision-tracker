# decision-tracker

A Claude Code mod that logs the agent's judgement calls in a side pane, so you can see what it decided while you weren't watching and push back on the ones that matter.

It is most useful in auto mode and long unattended runs, where the agent makes choices you never get asked about.

## What it does

**The agent logs its decisions.** The mod gives the agent a `record_decision` tool and adds instructions to its system prompt telling it when to use it. It should log choices you didn't specify: picking between approaches or libraries, reading an ambiguous request one way, assuming something about scope or data, skipping or simplifying part of the work, departing from convention, or doing anything costly to undo. It should not log mechanical steps. Logging never waits for approval; the agent carries on.

Each decision gets an id (`D1`, `D2`, ...) and records:

- a one-line summary, the choice and why it was made
- what prompted it, the alternatives it rejected and why, and the assumptions it rests on
- confidence (low / medium / high) and how hard it would be to undo (easy / moderate / hard)
- the files it affects, the prompt it was made during, and whether a subagent made it
- which earlier decision it replaces, if the agent changed its mind

**You review them in the Decisions pane.** The pane opens on its own when a session starts or a decision is logged, unless you've closed it. Decisions are listed newest first; select one to expand it. The status line shows the count and how many are awaiting a reply.

| Mark | Meaning |
| ---- | ------- |
| `◆` | Worth a look: low confidence or hard to undo |
| `?` | You asked for clarification; waiting for the agent |
| `!` | You challenged it; waiting for the agent |
| `✓` | The agent answered |
| `↻` | The agent recommends changing it |
| `↺` | Replaced by a later decision |

**Each decision has three actions:**

- **Clarify** asks the agent to explain what it knew, what it weighed and how confident it is. It's a question, not a request to change course.
- **Challenge** tells the agent to pause work that depends on the decision, make the strongest case against it, recommend keeping or changing it, and wait for your verdict before applying any change.
- **Acknowledge** removes the decision from the pane without telling the agent. Right-clicking a row does the same. **Undo** puts back the last one you acknowledged.

You can type a question or concern before pressing Clarify or Challenge. The agent answers in the conversation and records its answer with an `answer_review` tool, so the reply appears under the decision in the pane.

If the agent is mid-turn when you press Clarify or Challenge, the message goes into the running turn and the agent reads it at its next step. If that turn ends without an answer, the mod sends the question again once as a new prompt. If the running turn won't take the message, it's queued and sent when the turn ends.

## Commands

- `/decisions` opens the pane.
- `/decisions clear` empties it. `/clear` empties it too.

## Install

```powershell
./deploy.ps1 [-Destination <folder>]
```

This validates the plugin, then copies `.claude-plugin/plugin.json`, `hooks/` and `types/` into `<folder>`. The default is `~/.claude-global/decision-tracker`. Claude Code must load plugins from that folder, so it has to be listed in `CLAUDE_CODE_PLUGIN_DIRS`.

## Develop

| Path | Contents |
| ---- | -------- |
| `hooks/register.tsx` | Tools, prompt guidance, the pane, commands and turn handling |
| `hooks/row.tsx` | A row's summary, which handles click to expand and right-click to acknowledge |
| `types/index.d.ts` | The decision and review types and the plugin's stored state |
| `tests/` | Tests for the plugin |

```sh
claude plugin test .
claude plugin validate .
```

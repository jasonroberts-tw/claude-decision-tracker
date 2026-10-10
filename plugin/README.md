<!-- prettier-ignore -->
<div align="center">

# ◆ Decision Tracker

See the judgement calls Claude made while you weren't watching, and push back on the ones that matter.

[Overview](#overview) • [Install](#install) • [Usage](#usage) • [What the agent is told](#what-the-agent-is-told) • [Data and privacy](#data-and-privacy)

</div>

## Overview

Decision Tracker is a Claude Code plugin that has the agent log its own judgement calls as it works: picking a library, reading an ambiguous request one way, skipping part of the job. They collect in a **Decisions** pane beside the conversation. Each one shows what the agent chose, why, what it rejected and what it assumed. One click asks the agent to explain the choice or defend it.

> [!TIP]
> It's most useful in auto mode and long unattended runs, where the agent makes choices you're never asked about.

### Features

- **Logs as it goes.** The agent records a decision with the `record_decision` tool and carries on. Logging never waits for approval.
- **The reasoning, not just the outcome.** Each decision records the choice, why, what prompted it, the alternatives it rejected, its assumptions, confidence, how hard it is to undo, the files it touches and the prompt it was made during.
- **Clarify or Challenge** any decision, with an optional note. The agent's reply appears under the decision.
- **Works mid-turn.** If the agent is busy, your question goes into the running turn. If the turn ends without an answer, it's sent once more.
- **Flags what needs a look.** Decisions with low confidence or that are hard to undo get a mark, and the status line counts decisions awaiting a reply.
- **Tracks changes of mind.** A decision that replaces an earlier one is linked to it, and decisions made by subagents are labelled.
- **Acknowledge** clears the decisions you're happy with, and Undo brings the last one back.

## Install

You need Claude Code 2.1.287 or later (built and tested with 2.1.296), in the terminal or the Code tab of the Claude Desktop app. The pane doesn't show in the VS Code extension's chat panel or with `claude -p`, and the plugin does nothing in claude.ai chat or Cowork.

### From the plugin directory

Once Decision Tracker is listed in Anthropic's plugin directory, run `/plugin directory` in Claude Code and install it from there. You can also add it from **Customize > Plugins > Discover** on claude.ai, and it reaches Claude Code at the next session start.

### From source

To run it from a clone of [the repository](https://github.com/jasonroberts-tw/claude-decision-tracker), see [Run from source](https://github.com/jasonroberts-tw/claude-decision-tracker#run-from-source) in its README.

## Usage

There's nothing to configure. The agent is told when to log decisions, and the **Decisions** pane opens when a session starts or a decision comes in. If you close the pane it stays closed until you run `/decisions`.

### The pane

Decisions are listed newest first. Select one to expand it:

```text
3 decisions · 1 awaiting reply
! ▸ D3  Chart the totals with matplotlib
◆ ▾ D2  Read the budget sheet with openpyxl, not pandas
  Chose Use openpyxl to read cell values and formulas.
  Why pandas drops formulas, and the report traces figures to them.
  Instead of
    – pandas: loses formulas
  Assuming
    – The sheet has no macros
  low confidence · easy to undo
  During “build the quarterly report”

  Optional: your question or concern
  [ Clarify ]  [ Challenge ]  [ Acknowledge ]

✓ ▸ D1  Keep the report in Markdown
◆ worth a look · ? asked · ! challenged · ✓ answered · ↺ replaced
```

| Mark | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| `◆`  | Worth a look: low confidence, or hard to undo            |
| `?`  | You asked for clarification and the agent hasn't replied |
| `!`  | You challenged it and the agent hasn't replied           |
| `✓`  | The agent answered                                       |
| `↻`  | The agent recommends changing it                         |
| `↺`  | A later decision replaced it                             |
| `•`  | Nothing to flag                                          |

### Reviewing a decision

Expand a decision and pick an action. You can type a question or concern in the box first. Pressing Enter in the box sends it as a Clarify.

- **Clarify** asks the agent what it knew, what it weighed and how sure it is. It's a question, not a request to change course: the agent carries on unless explaining shows the choice was wrong.
- **Challenge** has the agent pause work that depends on the decision, make the strongest case against it, check what it cheaply can, and recommend keeping or changing it. The agent then waits for your verdict and doesn't apply a change until you agree.
- **Acknowledge** takes the decision off the list. You can also right-click a row to acknowledge it without expanding it. **Undo** brings back the last one you acknowledged.

The agent answers in the conversation, then records its answer with the `answer_review` tool. The pane shows it under the decision as *explained*, *recommends keeping it* or *recommends changing it*.

> [!NOTE]
> Acknowledging doesn't tell the agent anything. It only tidies your list. Ids are never reused, so `D4` always means the same decision.

**If the agent is busy:** a Clarify or Challenge sent during a turn goes straight into that turn, and the agent reads it at its next step. If the turn ends without an answer, the question is sent once more as a new prompt. If the running turn won't accept the question, it's queued and sent when the turn ends.

### Commands

| Command            | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `/decisions`       | Opens the pane, and lets it open automatically again            |
| `/decisions clear` | Empties the log                                                 |
| `/clear`           | Clears the conversation, which empties the log too              |

## What the agent is told

When the `record_decision` tool is available, the plugin adds a short *Decision log* section to the system prompt. It tells the agent to log a non-trivial choice you didn't specify before acting on it. That covers choosing between approaches, tools or libraries; resolving an ambiguous request; assuming something about intent, scope or data; skipping or simplifying part of the work; departing from convention; and anything costly to undo. Mechanical steps and the obvious reading of a clear instruction aren't logged. Both tools are always listed for the agent rather than hidden behind tool search, so logging never needs a lookup first.

<details>
<summary>Example: what a Challenge sends to the agent</summary>

```text
[decision-tracker] Challenge D2: "Read the budget sheet with openpyxl, not pandas"
I want to scrutinize this choice before you build further on it. My concern: The sheet is 40 MB; is openpyxl fast enough?

You logged it as (your words, quoted): “Use openpyxl to read cell values and formulas.” Reason given: “pandas drops formulas, and the report traces figures to them.”

1. Pause any work that depends on it.
2. Make the strongest honest case against it, and compare it with the alternatives, including any you did not consider at the time.
3. Say what evidence would settle it, and check whatever you cheaply can now.
4. Recommend keeping or changing it, and say what changing would cost at this point.
Then call mcp__decision-tracker__answer_review with id "D2", outcome "keep" or "change", and a short reply, and stop for my verdict before continuing work that depends on it. Do not apply a change until I agree.
```

</details>

## Data and privacy

Decision Tracker runs entirely inside Claude Code. It writes no files, makes no network requests, starts no processes and makes no model calls of its own. To check, run `claude plugin validate ./plugin` in a clone: it lists every hook the plugin registers and every Claude Code call it makes.

**What it keeps.** The decisions the agent records, your Clarify and Challenge notes, the agent's replies, and the prompt of the turn each decision was made in. They're held in the plugin's session state, which Claude Code discards when the session ends or when you run `/clear`, `/resume` or `/branch`. `/decisions clear` empties it sooner.

**What it adds to your conversation.** Everything it sends goes to the agent in your own session, the way your own prompts do:

- The *Decision log* section of the system prompt, and the `record_decision` and `answer_review` tools, which it keeps out of tool search so they're always listed.
- A Clarify or Challenge message when you press one of those buttons. It's submitted as your prompt, or added to the running turn if the agent is busy, with a line in the transcript saying so.
- One follow-up prompt, also in your name, that repeats any Clarify or Challenge the agent left unanswered when its turn ended.

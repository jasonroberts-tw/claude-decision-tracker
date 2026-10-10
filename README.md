<!-- prettier-ignore -->
<div align="center">

# ◆ Decision Tracker

[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757?style=flat-square&logo=claude&logoColor=white)](https://claude.com/claude-code)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fjasonroberts-tw%2Fclaude-decision-tracker%2Fmain%2Fplugin%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=blue&style=flat-square)](plugin/.claude-plugin/plugin.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

See the judgement calls Claude made while you weren't watching, and push back on the ones that matter.

[Install and use](plugin/README.md) • [Run from source](#run-from-source) • [Development](#development)

</div>

Decision Tracker is a Claude Code plugin that has the agent log its own judgement calls as it works, in a **Decisions** pane beside the conversation, where one click asks the agent to explain a choice or defend it.

[plugin/README.md](plugin/README.md) covers installing it, using it, what the agent is told, and what it keeps and sends. It's also the plugin's listing in Anthropic's plugin directory. This README is for running it from a clone and working on it.

## Run from source

You need Claude Code 2.1.287 or later (built and tested with 2.1.296). To try it for one session:

```sh
git clone https://github.com/jasonroberts-tw/claude-decision-tracker.git
claude --plugin-dir ./claude-decision-tracker/plugin
```

To install it for every session, run the deploy script, which needs PowerShell 7 or later:

```powershell
./deploy.ps1                          # installs to ~/.claude-global/decision-tracker
./deploy.ps1 -Destination <folder>    # or to a folder you choose
```

The script runs `claude plugin validate` on `plugin/` first and stops if it fails. It then copies `.claude-plugin/plugin.json`, `hooks/` and `types/` from `plugin/` into the destination, overwriting files but never deleting any.

> [!IMPORTANT]
> Claude Code only loads the plugin from the destination if that folder is listed in `CLAUDE_CODE_PLUGIN_DIRS`. Set it in your shell profile, then start a new session. For example, `export CLAUDE_CODE_PLUGIN_DIRS="$HOME/.claude-global/decision-tracker"` in sh/zsh, or `$env:CLAUDE_CODE_PLUGIN_DIRS = "$HOME/.claude-global/decision-tracker"` in your PowerShell `$PROFILE`.

## Development

Everything in `plugin/` except `tests/` and `tsconfig.json` ships to people who install the plugin, by way of the `release` branch, and nothing outside it does.

| Path                        | Contents                                                             |
| --------------------------- | -------------------------------------------------------------------- |
| `plugin/hooks/register.tsx` | The tools, system prompt guidance, pane, commands and turn handling  |
| `plugin/hooks/row.tsx`      | A row's summary: click to expand, right-click to acknowledge         |
| `plugin/types/index.d.ts`   | Decision and review types, and the plugin's stored state             |
| `plugin/tests/`             | Tests written with the `claude-code/testing` kit                     |
| `plugin/README.md`          | The user guide, shown as the directory listing                       |
| `deploy.ps1`                | Validates the plugin and installs it into a plugin folder            |
| `release.ps1`               | Builds and pushes the `release` branch the plugin directory tracks   |
| `.github/workflows/`        | Runs `release.ps1` on GitHub: by hand to release, as a dry run on push |
| `.claude/`, `docs/agents/`  | Instructions for agents working on this repository                   |

`LICENSE` is copied into `plugin/` so it ships with the plugin. Keep the two copies the same.

```sh
claude plugin test ./plugin       # run the tests
claude plugin validate ./plugin   # check the manifest and hooks
```

To run the tests before every push and stop the push when they fail, add a
pre-push hook to the clone's git config (needs Git 2.54 or later):

```sh
git config set hook.plugin-test.command "claude plugin test ./plugin"
git config set --append hook.plugin-test.event pre-push
```

## Releasing

Anthropic's plugin directory tracks the `release` branch, not `main`. That branch holds the plugin at its root, without `tests/` or `tsconfig.json`, so the directory scans only what people install. Don't commit to it directly: each release replaces its contents with `plugin/`.

To release, raise `version` in `plugin/.claude-plugin/plugin.json` and merge it to `main`. Then run the **Release** workflow from `main`, either from the repository's **Actions** tab (**Release > Run workflow**) or with:

```sh
gh workflow run release.yml          # release main as it stands
gh workflow run release.yml -f dry-run=true   # say what would be released, and change nothing
```

The workflow runs `release.ps1`, which you can also run yourself from a clean clone (PowerShell 7.2 or later):

```powershell
./release.ps1            # validates, tests, commits plugin/ as at HEAD to release and pushes it
./release.ps1 -DryRun    # says what it would release, and changes nothing
```

The script stops if `plugin/` has uncommitted changes, if validation or the tests fail, or if `version` matches the one already released. Every push that touches `plugin/`, `release.ps1` or the workflow also runs the workflow as a dry run. If the shipped files changed but `version` didn't, that run warns instead of failing.

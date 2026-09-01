# Instructions

## Setting Up a New Extension Repository

Use this repo as a template. Quick steps (full reference below):

1. `npm init -y`
2. `npm install --save-dev typescript vitest @types/node @earendil-works/pi-coding-agent` and `npm install typebox`. The pi package ships docs and examples under `node_modules/@earendil-works/pi-coding-agent/`.
3. Keep/adjust `tsconfig.json` (ESNext, NodeNext, strict). No build step needed; pi loads TS via jiti. Use `npx tsc --noEmit` for typechecking only.
4. `package.json` must have `main`/`pi.extensions` pointing at the entry point (default `extensions/index.ts`), `keywords: ["pi-package"]`, `typebox` in `dependencies`, and `@earendil-works/pi-coding-agent` as a peer.
5. Extension entry point exports a default factory receiving `ExtensionAPI` (see `extensions/index.ts` in this repo). Package names: `@earendil-works/pi-coding-agent` and `typebox`; `@mariozechner/pi-coding-agent` and `@sinclair/typebox` are obsolete.
6. Test with `npx tsc --noEmit` then `pi -e ./extensions/index.ts` (quick tests only). For auto-discovery and `/reload`, place extensions in `~/.pi/agent/extensions/` or project `.pi/extensions/`.
7. Publish: `npm publish` after version bump; users run `pi install npm:<name>`. Runtime deps must be in `dependencies` (pi installs with `--omit=dev`).

Key APIs: `pi.registerTool()`, `pi.on(event, handler)` (`session_start`, `session_shutdown`, `before_agent_start`, `tool_call`, `tool_result`, `turn_start`/`turn_end`, ...), `pi.registerCommand("name", {...})`, `ctx.ui` (notify, setStatus, setWidget, select, confirm, input, editor).

## Examples Reference

All examples in `node_modules/@earendil-works/pi-coding-agent/examples/extensions/` (after `npm install`; they ship inside the pi package).

| Example | Description | Key APIs |
|---------|-------------|----------|
| **Tools** |||
| `hello.ts` | Minimal tool registration | `registerTool` |
| `question.ts` | Tool with user interaction | `registerTool`, `ui.select` |
| `questionnaire.ts` | Multi-step wizard tool | `registerTool`, `ui.custom` |
| `todo.ts` | Stateful tool with persistence | `registerTool`, `appendEntry`, `renderResult`, session events |
| `dynamic-tools.ts` | Register tools after startup and during commands | `registerTool`, `session_start`, `registerCommand` |
| `truncated-tool.ts` | Output truncation example | `registerTool`, `truncateHead` |
| `tool-override.ts` | Override built-in read tool | `registerTool` (same name as built-in) |
| **Commands** |||
| `pirate.ts` | Modify system prompt per-turn | `registerCommand`, `before_agent_start` |
| `summarize.ts` | Conversation summary command | `registerCommand`, `ui.custom` |
| `handoff.ts` | Cross-provider model handoff | `registerCommand`, `ui.editor`, `ui.custom` |
| `qna.ts` | Q&A with custom UI | `registerCommand`, `ui.custom`, `setEditorText` |
| `send-user-message.ts` | Inject user messages | `registerCommand`, `sendUserMessage` |
| `reload-runtime.ts` | Reload command and LLM tool handoff | `registerCommand`, `ctx.reload()`, `sendUserMessage` |
| `shutdown-command.ts` | Graceful shutdown command | `registerCommand`, `shutdown()` |
| **Events & Gates** |||
| `permission-gate.ts` | Block dangerous commands | `on("tool_call")`, `ui.confirm` |
| `protected-paths.ts` | Block writes to specific paths | `on("tool_call")` |
| `confirm-destructive.ts` | Confirm session changes | `on("session_before_switch")`, `on("session_before_fork")` |
| `dirty-repo-guard.ts` | Warn on dirty git repo | `on("session_before_*")`, `exec` |
| `input-transform.ts` | Transform user input | `on("input")` |
| `model-status.ts` | React to model changes | `on("model_select")`, `setStatus` |
| `system-prompt-header.ts` | Display system prompt info | `on("agent_start")`, `getSystemPrompt` |
| `claude-rules.ts` | Load rules from files | `on("session_start")`, `on("before_agent_start")` |
| `file-trigger.ts` | File watcher triggers messages | `sendMessage` |
| **Compaction & Sessions** |||
| `custom-compaction.ts` | Custom compaction summary | `on("session_before_compact")` |
| `trigger-compact.ts` | Trigger compaction manually | `compact()` |
| `git-checkpoint.ts` | Git stash on turns | `on("turn_end")`, `on("session_fork")`, `exec` |
| `auto-commit-on-exit.ts` | Commit on shutdown | `on("session_shutdown")`, `exec` |
| **UI Components** |||
| `status-line.ts` | Footer status indicator | `setStatus`, session events |
| `custom-footer.ts` | Replace footer entirely | `registerCommand`, `setFooter` |
| `custom-header.ts` | Replace startup header | `on("session_start")`, `setHeader` |
| `modal-editor.ts` | Vim-style modal editor | `setEditorComponent`, `CustomEditor` |
| `rainbow-editor.ts` | Custom editor styling | `setEditorComponent` |
| `widget-placement.ts` | Widget above/below editor | `setWidget` |
| `overlay-test.ts` | Overlay components | `ui.custom` with overlay options |
| `overlay-qa-tests.ts` | Comprehensive overlay tests | `ui.custom`, all overlay options |
| `notify.ts` | Simple notifications | `ui.notify` |
| `timed-confirm.ts` | Dialogs with timeout | `ui.confirm` with timeout/signal |
| `mac-system-theme.ts` | Auto-switch theme | `setTheme`, `exec` |
| **Complex Extensions** |||
| `plan-mode/` | Full plan mode implementation | All event types, `registerCommand`, `registerShortcut`, `registerFlag`, `setStatus`, `setWidget`, `sendMessage`, `setActiveTools` |
| `preset.ts` | Saveable presets (model, tools, thinking) | `registerCommand`, `registerShortcut`, `registerFlag`, `setModel`, `setActiveTools`, `setThinkingLevel`, `appendEntry` |
| `tools.ts` | Toggle tools on/off UI | `registerCommand`, `setActiveTools`, `SettingsList`, session events |
| **Remote & Sandbox** |||
| `ssh.ts` | SSH remote execution | `registerFlag`, `on("user_bash")`, `on("before_agent_start")`, tool operations |
| `interactive-shell.ts` | Persistent shell session | `on("user_bash")` |
| `sandbox/` | Sandboxed tool execution | Tool operations |
| `subagent/` | Spawn sub-agents | `registerTool`, `exec` |
| **Games** |||
| `snake.ts` | Snake game | `registerCommand`, `ui.custom`, keyboard handling |
| `space-invaders.ts` | Space Invaders game | `registerCommand`, `ui.custom` |
| `doom-overlay/` | Doom in overlay | `ui.custom` with overlay |
| **Providers** |||
| `custom-provider-anthropic/` | Custom Anthropic proxy | `registerProvider` |
| `custom-provider-gitlab-duo/` | GitLab Duo integration | `registerProvider` with OAuth |
| **Messages & Communication** |||
| `message-renderer.ts` | Custom message rendering | `registerMessageRenderer`, `sendMessage` |
| `event-bus.ts` | Inter-extension events | `pi.events` |
| **Session Metadata** |||
| `session-name.ts` | Name sessions for selector | `setSessionName`, `getSessionName` |
| `bookmark.ts` | Bookmark entries for /tree | `setLabel` |
| **Misc** |||
| `antigravity-image-gen.ts` | Image generation tool | `registerTool`, Google Antigravity |
| `inline-bash.ts` | Inline bash in tool calls | `on("tool_call")` |
| `bash-spawn-hook.ts` | Adjust bash command, cwd, and env before execution | `createBashTool`, `spawnHook` |
| `with-deps/` | Extension with npm dependencies | Package structure with `package.json` |

## Documentation

Read the docs shipped inside the installed pi package:

`node_modules/@earendil-works/pi-coding-agent/docs/`

Run `npm install` first if the directory is missing. When pi runs from its own installation, the docs are also at the package install root, e.g.:

`/Users/arivera/.volta/tools/image/packages/@earendil-works/pi-coding-agent/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

Start with:

| File | Description |
|------|-------------|
| `extensions.md` | Main intro, key capabilities, table of contents |
| `quick-start.md` | Quick start example |
| `extension-locations.md` | Where to place extensions |
| `available-imports.md` | Available npm packages |
| `writing-an-extension.md` | How to write extensions |
| `events.md` | Lifecycle, session, agent, tool, model, input events |
| `extension-context.md` | ExtensionContext API |
| `extension-command-context.md` | Command-specific context methods |
| `extension-api.md` | ExtensionAPI methods (registerTool, sendMessage, etc.) |
| `state-management.md` | Persisting state across sessions |
| `custom-tools.md` | Custom tool registration, override, rendering |
| `custom-ui.md` | Dialogs, widgets, custom components |
| `error-handling.md` | Error handling behavior |
| `mode-behavior.md` | Interactive/RPC/JSON/Print modes |
| `packages.md` | Sharing extensions as npm/git pi packages |

# Pi Extension API — Technical Blueprint

## Source
- `@earendil-works/pi-coding-agent` v0.82.1
- Docs: `~/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Examples: `.../examples/extensions/` (68+ files)
- Types: `.../dist/index.d.ts` + `.../dist/core/extensions/types.d.ts`

---

## Extension Structure

### Required Files

An extension is a TypeScript module with a **default export** that is a factory function receiving `ExtensionAPI`:

```
~/.pi/agent/extensions/
├── my-ext.ts                    # Single-file extension
└── my-ext/
    ├── index.ts                 # Entry point (default export)
    ├── package.json             # Optional: npm deps
    └── node_modules/            # After npm install
```

### Factory Signature (sync or async)

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) { /* sync */ }
// or
export default async function (pi: ExtensionAPI) { /* async — awaited at startup */ }
```

### Loading Locations
- `~/.pi/agent/extensions/*.ts` — global
- `~/.pi/agent/extensions/*/index.ts` — global (subdir)
- `.pi/extensions/*.ts` — project-local
- `.pi/extensions/*/index.ts` — project-local (subdir)
- `pi -e ./path.ts` — ad-hoc

Hot-reloadable via `/reload`. TypeScript via jiti, no compile step.

---

## Registration APIs (ExtensionAPI)

### `pi.registerTool(definition)`

Register a tool the LLM can call. Works during load AND after startup (dynamic). New tools appear immediately without `/reload`.

```ts
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

pi.registerTool({
  name: "my_tool",              // Used by LLM in tool calls
  label: "My Tool",             // UI label
  description: "What it does",  // LLM description
  // Optional: one-line for "Available tools" section
  promptSnippet: "Short one-liner for system prompt",
  // Optional: bullets for "Guidelines" section (must name the tool!)
  promptGuidelines: ["Use my_tool when..."],
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Use StringEnum (not Type.Union/Literal) for Google compat
    text: Type.Optional(Type.String()),
  }),
  // Optional: compat shim for old session args before they reach execute()
  prepareArguments(args) { return args; },
  // Per-tool execution mode override
  executionMode: "sequential",   // or "parallel" (default)
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // params is Static<TParams> — fully typed
    // signal — AbortSignal for cancellation
    // onUpdate — stream progress: onUpdate?.({ content: [...], details: {} })
    // ctx — ExtensionContext (see below)
    if (signal?.aborted) return { content: [...], details: {} };
    return {
      content: [{ type: "text", text: "Result" }],  // Sent to LLM
      details: { /* any state */ },                    // For rendering & state reconstruction
      terminate: true,  // Optional: skip follow-up LLM call
    };
  },
  // Optional: custom TUI rendering
  renderCall(args, theme, context) { /* return Component */ },
  renderResult(result, options, theme, context) { /* return Component */ },
});
```

**Key rules:**
- Always call `onUpdate?.()` before returning for streaming progress
- Throw from `execute()` to signal errors (sets `isError: true`)
- Use `StringEnum` for enums (Google API compatibility)
- Use `withFileMutationQueue(absolutePath, async () => {...})` to participate in per-file mutation queue alongside built-in `edit`/`write`
- Override built-in tools by registering same `name`; inherit renderers you omit
- `promptSnippet` and `promptGuidelines` are NOT inherited from built-in tools when overriding
- Output must be truncated: use `truncateHead`/`truncateTail` with `DEFAULT_MAX_BYTES`/`DEFAULT_MAX_LINES`

### `pi.registerCommand(name, options)`

```ts
pi.registerCommand("mycmd", {
  description: "Do something",
  handler: async (args, ctx) => { /* ctx is ExtensionCommandContext */ },
});
```

`ExtensionCommandContext` extends `ExtensionContext` with:
- `waitForIdle()`, `newSession()`, `fork()`, `navigateTree()`, `switchSession()`, `reload()`

### `pi.registerShortcut(keyId, options)`

```ts
pi.registerShortcut("ctrl+shift+p", {
  description: "Toggle thing",
  handler: async (ctx) => { /* ExtensionContext */ },
});
```

### `pi.registerFlag(name, options)`

```ts
pi.registerFlag("my-flag", {
  description: "Enable foo",
  type: "boolean",
  default: false,
});
// Read:
const val = pi.getFlag("my-flag");
```

### `pi.on(event, handler)`

Subscribes to lifecycle events:

```ts
pi.on("session_start", async (event, ctx) => { ... });
pi.on("session_shutdown", async (event, ctx) => { ... });
pi.on("tool_call", async (event, ctx) => { ... });
pi.on("tool_result", async (event, ctx) => { ... });
pi.on("before_agent_start", async (event, ctx) => { ... });
pi.on("input", async (event, ctx) => { ... });
pi.on("context", async (event, ctx) => { ... });
// ... many more (30+ event types)
```

**`tool_call` pattern — block/mutate:**
```ts
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Dangerous" };
    }
    event.input.command = `source ~/.profile\n${event.input.command}`; // mutate in place
  }
});
```

### `pi.registerMessageRenderer(customType, renderer)`
### `pi.registerEntryRenderer(customType, renderer)`
### `pi.sendMessage(message, options?)`
### `pi.sendUserMessage(content, options?)`
### `pi.appendEntry(customType, data?)`
### `pi.setSessionName(name)` / `pi.getSessionName()`
### `pi.setLabel(entryId, label)`
### `pi.exec(command, args, options?)`
### `pi.getActiveTools()` / `pi.getAllTools()` / `pi.setActiveTools(names)`
### `pi.getCommands()`
### `pi.setModel(model)` / `pi.getThinkingLevel()` / `pi.setThinkingLevel(level)`
### `pi.registerProvider(name, config)` / `pi.unregisterProvider(name)`
### `pi.events` — shared EventBus for inter-extension communication

---

## ExtensionContext (passed to all handlers)

### Core
- `ctx.mode` — `"tui" | "rpc" | "json" | "print"`
- `ctx.hasUI` — `true` in TUI/RPC, `false` in print/json
- `ctx.cwd` — working directory
- `ctx.ui` — UI methods (select, confirm, input, notify, custom, setStatus, setWidget, setFooter, setTitle, etc.)
- `ctx.sessionManager` — read-only session state (`getEntries()`, `getBranch()`, `getLeafId()`, etc.)
- `ctx.modelRegistry` / `ctx.model` / `ctx.thinkingLevel`
- `ctx.signal` — abort signal when streaming active
- `ctx.isIdle()`, `ctx.abort()`, `ctx.hasPendingMessages()`
- `ctx.shutdown()` — graceful shutdown
- `ctx.getContextUsage()` — current context tokens
- `ctx.compact(options?)` — trigger compaction
- `ctx.getSystemPrompt()` — current system prompt string

### UI Methods (ctx.ui)
- `select(title, options, opts?)` — pick from list
- `confirm(title, message, opts?)` — yes/no
- `input(title, placeholder?, opts?)` — text input
- `editor(title, prefill?)` — multi-line editor
- `notify(message, type?)` — non-blocking banner
- `custom(factory, options?)` — full custom component
- `setStatus(key, text)` — persistent footer status line
- `setWidget(key, content, options?)` — above/below editor
- `setFooter(factory)` — replace footer entirely
- `setTitle(title)` — terminal title
- `setEditorText(text)` / `getEditorText()` / `pasteToEditor(text)`
- `setEditorComponent(factory)` — custom editor (vim, etc.)
- `addAutocompleteProvider(factory)` — custom autocomplete
- `onTerminalInput(handler)` — raw key listener
- `setWorkingMessage(msg?)` / `setWorkingVisible(visible)` / `setWorkingIndicator(options?)`
- `theme` / `getAllThemes()` / `getTheme(name)` / `setTheme(name)`

---

## State Management Pattern

State is stored in tool result `details` for proper branching. No external files.

**Reconstruct on `session_start` and `session_tree`:**
```ts
let items: string[] = [];

pi.on("session_start", async (_event, ctx) => {
  items = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "toolResult"
        && entry.message.toolName === "my_tool") {
      items = entry.message.details?.items ?? [];
    }
  }
});
```

---

## Tool Override Pattern

Override built-in tools by registering same name. Omit `renderCall`/`renderResult` to inherit built-in renderers. Must match exact result shape including `details` type.

```ts
pi.registerTool({
  name: "read",  // same as built-in → overrides it
  label: "read (audited)",
  description: "Read files with logging",
  parameters: readSchema,
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // ... custom logic
  },
  // No renderCall/renderResult → built-in renderer used automatically
});
```

---

## Hashline Mechanism

**Not documented** in the pi extension API. The term "hashline" appears nowhere in the pi docs, examples, source, or type definitions. It is specific to this project (`pi-the-hashline`) and needs custom implementation.

---

## File Mutation Queue

For tools that mutate files, participate in the same queue as built-in `edit`/`write`:

```ts
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";

async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
  const absolutePath = resolve(ctx.cwd, params.path);
  return withFileMutationQueue(absolutePath, async () => {
    // read-modify-write logic here
    return { content: [...], details: {} };
  });
}
```

---

## Key Dependencies for Extensions

| Import | Package | Use |
|--------|---------|-----|
| `Type` | `typebox` | Parameter schema |
| `StringEnum` | `@earendil-works/pi-ai` | Google-compatible enums |
| `Text`, `Box` | `@earendil-works/pi-tui` | Custom rendering components |
| `Theme`, `highlightCode` | `@earendil-works/pi-coding-agent` | Styling |
| `defineTool` | `@earendil-works/pi-coding-agent` | Type-safe tool definition |

---

## Edge Cases & Gotchas

1. **Custom tools MUST truncate output** — 50KB/2000 line limit. Use `truncateHead`/`truncateTail`.
2. **`Type.Union`/`Type.Literal` breaks Google API** — use `StringEnum` from `@earendil-works/pi-ai`
3. **`promptGuidelines` bullets are unlabeled** — each must name its tool explicitly ("Use my_tool...")
4. **Parallel tool calls** — use `withFileMutationQueue()` to avoid lost writes
5. **`prepareArguments()`** — for backward compat when resuming old sessions with different schema
6. **Tool errors via throw** — returning a value never sets `isError: true`
7. **`terminate: true`** — only works when EVERY tool in the batch returns it
8. **Dynamic tools** — register with `pi.registerTool()`, then `pi.setActiveTools([...])` to toggle. Providers with native deferred loading (Anthropic 4.5+, OpenAI gpt-5.4+) preserve prompt cache; others fall back to normal tool list
9. **`ctx.ui.custom()` returns `undefined` in RPC mode** — guard with `ctx.hasUI`
10. **Session replacement footguns** — after `newSession()`, `fork()`, `switchSession()` inside `withSession()`, old captured `pi`/`ctx` objects are stale; use only the replacement-session `ctx` passed to the callback

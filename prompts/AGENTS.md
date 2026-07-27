# prompts/ — Prompt Guideline Files

## Purpose
External markdown files containing prompt guidelines for edit and read tools.

## Ownership
- prompts/ directory
- These files are NOT currently loaded by the extension. Our tool registration uses inline prompt strings in edit.ts and read.ts. These files are dead/unused.

## Local Contracts
- **edit.md** — Describes hashline DSL format for edit tool (NOT loaded at runtime)
- **read.md** — Describes read tool hashline output (NOT loaded at runtime)

## Work Guidance
These files should either be:
1. Removed if unused
2. Or wired up via loadPromptGuidelines() like YanwuZeng's approach

Currently they are dead files — no code references them.

## Verification
None.

## Child DOX Index
(leaf directory — no children)

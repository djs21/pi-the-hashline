## ADDED Requirements

### Requirement: Nudging and Prompt Guidelines
Grep, read, and edit tools SHALL cross-nudge each other via prompt guidelines to ensure optimal usage.

#### Scenario: Guidelines Gated by Configuration
- **WHEN** config has `grep: false`
- **THEN** no grep prompt guidelines are injected
- **WHEN** config has `grep: true`
- **THEN** grep guidelines are injected, and read/edit tools include cross-nudging guidance

#### Scenario: Read Tool Cross-Nudging
- **WHEN** grep is enabled in config
- **THEN** the `read` tool guidelines SHALL suggest using `grep` specifically for locating specific strings, patterns, or definitions in files (not for reading file content or small files)

#### Scenario: Edit Tool Cross-Nudging
- **WHEN** grep is enabled in config
- **THEN** the `edit` tool guidelines SHALL mention that grep outputs hashline anchors directly usable by the edit tool

### Requirement: Asynchronous NDJSON Streaming
Grep SHALL execute ripgrep (`rg`) using spawn and stream output line-by-line using NDJSON to avoid blocking the event loop.

#### Scenario: Match collection and formatting
- **WHEN** a match is streamed from `rg --json`
- **THEN** parse it as NDJSON, extract path, line number, and lines, and format in hashline format (LINE#HASH:content)
- **AND** respect the `context` parameter for context lines

#### Scenario: Spawn Error Handling
- **WHEN** `rg` fails to spawn (e.g. command not found, permission denied, or exit code 2/non-zero other than 1)
- **THEN** handle the error gracefully, return a clear error message instead of crashing. Note: `rg` exit code 1 means "no matches found" (not an error), whereas exit code 2 or spawn failure means error.

#### Scenario: Limit Enforcement
- **WHEN** the search is run
- **THEN** enforce the limit parameter using both `--max-count` per-file and a global in-stream counter (close the stream and kill the process when the global limit is reached).

#### Scenario: End/Summary Parsing
- **WHEN** the search completes
- **THEN** parse the `end`/`summary` records to detect `rg` exit status and gather search metrics.

#### Scenario: Non-UTF8 / Invalid Bytes Handling
- **WHEN** a matching line contains invalid UTF-8 (passed in `bytes` base64 field by `rg`)
- **THEN** decode the `bytes` field from base64 safely to preserve the content without throwing errors

### Requirement: Test Suite
The grep tool MUST have robust, runnable tests checking its core features.

#### Scenario: Self-check or test script execution
- **WHEN** the test suite is executed
- **THEN** verify grep handles literal and regex matches, context lines, limit enforcement, and invalid UTF-8 bytes correctly

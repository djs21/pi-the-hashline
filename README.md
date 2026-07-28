# pi-the-hashline

Hashline-anchored `read`/`edit` tools for [Pi coding-agent](https://pi.dev).

Overrides Pi's built-in `read` and `edit` tools with hashline-anchored replacements. Every line in `read` output carries a `LINE#HASH:` prefix; `edit` validates anchors against live content hashes before applying changes.

## Features

- **Hashline read** — `LINE#HASH:content` per line with context-sensitive xxHash32 hashes
- **TUI preview** — read & edit show 10-line preview (Ctrl+O expands)
- **Hash-validated edit** — SWAP/DEL/INS/INS.BLK ops verified against live hashes
- **Colored diff** — edit diffs colorized: removed lines, added lines, context lines, warnings, errors each in distinct theme colors
- **Stale-anchor recovery** — 3-way merge against historical snapshots when file changed
- **Brace-block resolution** — `.BLK` ops for TS/JS/Java/C/C++/Go/Rust/C# via char-level brace-matching
- **Self-healing** — Trailing closer dedup, landing-shift for nested inserts
- **Noop-loop guard** — 3 consecutive identical no-ops → hard fail
- **grep** — ripgrep-backed search with hashline output, auto-downloads if not found
- **Configurable** — `~/.pi/agent/hashline.json` for hash length (2-4) and grep toggle

## Installation

### From git (recommended)

```bash
pi install git:github.com/YOUR_USER/pi-the-hashline
```

Then reload Pi:

```
/reload
```

### From local directory

```bash
# Clone or copy to pi extensions
git clone https://github.com/YOUR_USER/pi-the-hashline ~/.pi/agent/extensions/pi-the-hashline

# Or symlink
ln -s /path/to/pi-the-hashline ~/.pi/agent/extensions/pi-the-hashline

# Install dependencies
cd ~/.pi/agent/extensions/pi-the-hashline
npm install

# Reload Pi
/reload
```

### Verify installation

```
/hashline-status
```

## Configuration

Create `~/.pi/agent/hashline.json`:

Minimal (grep disabled by default):

```json
{
  "hashLength": 2
}
```

Full:

```json
{
  "hashLength": 3,
  "grep": true
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `hashLength` | int | 2 | Hash characters per line (2-4) |
| `grep` | bool | false | Enable grep tool. Auto-downloads ripgrep from GitHub if not on PATH. |
| `replaceText` | bool | true | Accept Pi native `oldText`/`newText` format via bridge. Set `false` to require hashline DSL only. |

## Usage

### Read

```
read path/to/file.ts
```

Output:
```
   1#JB:import { foo } from "./bar";
   2#KP:const x = 42;
   3#MZ:console.log(x);
```

Use `raw: true` for plain output.

### Edit DSL

> **Note:** Hashline DSL (SWAP/DEL/INS/INS.BLK etc.) is preferred. Pi native `oldText`/`newText` format is also accepted via bridge (`replaceText: true`). Set `replaceText: false` in config to require hashline DSL only.

```
[path/to/file.ts#JB]
  SWAP 2.:
    const x = 99;
  INS.POST 3:
    console.log("done");
  INS.TAIL:
    export default x;
```

| Op | Description |
|----|-------------|
| `SWAP N.=M:` | Replace lines N-M with payload |
| `SWAP N:` | Replace single line N |
| `DEL N.=M` | Delete lines N-M |
| `DEL N` | Delete single line N |
| `INS.PRE N:` | Insert before line N |
| `INS.POST N:` | Insert after line N |
| `INS.HEAD:` | Insert at file start |
| `INS.TAIL:` | Insert at file end |
| `SWAP.BLK N:` | Replace brace block at N |
| `DEL.BLK N` | Delete brace block at N |

## Architecture

See [DESIGN.md](./DESIGN.md) for full design document.

## Credits

- **RimuruW** ([pi-hashline-edit](https://github.com/RimuruW/pi-hashline-edit)) — NIBBLE_STR alphabet, context-based hashing, config file, grep tool
- **YanwuZeng** ([pi-hashline](https://github.com/YanwuZeng/pi-hashline)) — State-machine DSL parser, brace-matching block resolver, self-healing, landing-shift

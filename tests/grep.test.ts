import test, { describe, before, after } from "node:test";
import assert from "node:assert";
import { registerGrepTool } from "../src/grep.js";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

describe("grep tool tests", () => {
  const fixtureDir = join(process.cwd(), "tests", "fixtures");
  const configPath = join(homedir(), ".pi", "agent", "hashline.json");
  const backupPath = configPath + ".bak";
  let hasOriginal = false;

  before(() => {
    // Restore backup if it exists from a crashed run
    if (existsSync(backupPath)) {
      try {
        writeFileSync(configPath, readFileSync(backupPath));
        rmSync(backupPath, { force: true });
      } catch {}
    }

    // Save original config
    if (existsSync(configPath)) {
      writeFileSync(backupPath, readFileSync(configPath));
      hasOriginal = true;
    }
    // Write test config ensuring grep is enabled
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ hashLength: 2, grep: true }));

    // Create fixtures
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, "file1.txt"), "hello world\napple banana\ncat dog\n");
    writeFileSync(join(fixtureDir, "file2.txt"), "apple pie\nbanana split\n");

    // Invalid UTF-8 file: 0xFF bytes + matchable text
    const invalidBuf = Buffer.concat([
      Buffer.from([0xff, 0xff, 0xff]),
      Buffer.from("invalid utf8 matchable pattern\n")
    ]);
    writeFileSync(join(fixtureDir, "invalid.txt"), invalidBuf);
  });

  after(() => {
    // Restore original config
    try {
      if (hasOriginal && existsSync(backupPath)) {
        writeFileSync(configPath, readFileSync(backupPath));
      } else if (!hasOriginal) {
        rmSync(configPath, { force: true });
      }
    } catch {} finally {
      try {
        rmSync(backupPath, { force: true });
      } catch {}
    }
    // Remove fixtures
    try {
      rmSync(fixtureDir, { recursive: true, force: true });
    } catch {}
  });

  async function executeGrep(params: any) {
    let capturedTool: any = null;
    const fakePi: ExtensionAPI = {
      registerTool(tool: any) {
        capturedTool = tool;
      },
      registerCommand() {},
    } as any;

    const { resetConfig } = await import("../src/config.js");
    resetConfig();

    registerGrepTool(fakePi);
    if (!capturedTool) {
      throw new Error("Grep tool was not registered (config.grep might be false)");
    }

    const context = { cwd: fixtureDir };
    const result = await capturedTool.execute("test-call-id", params, new AbortController().signal, undefined, context);
    return result;
  }

  test("Match collection and hashline formatting", async () => {
    const res = await executeGrep({ pattern: "banana", path: "." });
    assert.ok(res.content && res.content[0]);
    const text = res.content[0].text;
    
    // Should find banana in file1.txt and file2.txt
    assert.ok(text.includes("["));
    assert.ok(text.includes("file1.txt"));
    assert.ok(text.includes("file2.txt"));
    
    // Hashline format: line number + # + hash + : + content
    assert.ok(/banana/.test(text));
    // E.g., "   2#XX:apple banana"
    assert.ok(/\d+#[A-Z0-9]+:.*banana/i.test(text), `Output did not match expected hashline format: ${text}`);
  });

  test("Regex vs literal matching", async () => {
    // With regex (literal: false or undefined)
    // "a.b" should match "apple banana" (since '.' matches 'e' and ' ' and 'b' is after)
    // Actually let's use a simpler pattern: "a.p" which matches "app" in "apple"
    const regexRes = await executeGrep({ pattern: "a.p", path: "." });
    assert.ok(regexRes.content[0].text.includes("apple banana"));

    // With literal: true
    const literalRes = await executeGrep({ pattern: "a.p", literal: true, path: "." });
    assert.ok(literalRes.content[0].text.includes("No matches found."));
  });

  test("ignoreCase", async () => {
    const caseResSensitive = await executeGrep({ pattern: "APPLE", path: "." });
    assert.ok(caseResSensitive.content[0].text.includes("No matches found."));

    const caseResInsensitive = await executeGrep({ pattern: "APPLE", ignoreCase: true, path: "." });
    assert.ok(caseResInsensitive.content[0].text.includes("apple banana"));
  });

  test("context lines", async () => {
    const res = await executeGrep({ pattern: "banana", context: 1, path: "file1.txt" });
    const text = res.content[0].text;
    
    // "banana" is on line 2. With context: 1, preceding line ("hello world") should be included
    assert.ok(text.includes("hello world"), `Should contain hello world. Output: ${text}`);
  });

  test("limit enforcement", async () => {
    // In file1.txt: hello world, apple banana, cat dog. Let's search for "a" or similar matching multiple lines.
    // "file1.txt" contains:
    // line 1: hello world
    // line 2: apple banana
    // line 3: cat dog
    // Let's search for "a" or "o"
    // "o" matches line 1 (hello world), line 3 (cat dog)
    // If we limit to 1, we should only get 1 match.
    const res = await executeGrep({ pattern: "o", limit: 1, path: "file1.txt" });
    const text = res.content[0].text;
    const lines = text.split("\n").filter(l => l.includes("#"));
    assert.strictEqual(lines.length, 1);
  });

  test("limit enforcement global counter kill path", async () => {
    // Searching "." (both file1.txt and file2.txt) for pattern "a".
    // file1.txt has 2 matches for "a", file2.txt has 2 matches for "a".
    // With limit: 2, ripgrep's --max-count 2 allows up to 4 matches total,
    // but the global counter kill path will terminate ripgrep after 2 matches.
    const res = await executeGrep({ pattern: "a", limit: 2, path: "." });
    const text = res.content[0].text;
    const lines = text.split("\n").filter(l => l.includes("#"));
    assert.ok(lines.length <= 2, `Expected <= 2 matches, got ${lines.length}. Output:\n${text}`);
  });

  test("invalid UTF-8 bytes handling", async () => {
    const res = await executeGrep({ pattern: "matchable", path: "invalid.txt" });
    const text = res.content[0].text;
    // Should output the line containing "matchable" without crashing, decoding it safely
    assert.ok(text.includes("matchable"), `Output should contain matchable. Got: ${text}`);
  });

  test("no matches returns gracefully", async () => {
    const res = await executeGrep({ pattern: "nonexistentpattern", path: "." });
    assert.ok(res.content && res.content[0]);
    assert.strictEqual(res.content[0].text, "No matches found.");
  });
});

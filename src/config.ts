import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HashConfig } from "./types.js";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "hashline.json");

const DEFAULTS: HashConfig = {
  hashLength: 2,
  grep: false,
  replaceText: true,
};

let cached: HashConfig | null = null;

const VALID_HASH_LENGTHS = new Set([2, 3, 4]);

export function loadConfig(): HashConfig {
  if (cached) return cached;
  
  const config = { ...DEFAULTS };
  
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      
      if (parsed.hashLength !== undefined) {
        if (VALID_HASH_LENGTHS.has(parsed.hashLength)) {
          config.hashLength = parsed.hashLength;
        } else {
          console.warn(`[pi-the-hashline] Invalid hashLength ${parsed.hashLength}, using default ${DEFAULTS.hashLength}`);
        }
      }
      
      if (typeof parsed.grep === "boolean") {
        config.grep = parsed.grep;
      }
      
      if (typeof parsed.replaceText === "boolean") {
        config.replaceText = parsed.replaceText;
      }
    }
  } catch (err) {
    // Config file missing or invalid — use defaults silently
  }
  
  cached = config;
  return config;
}

export function resetConfig(): void {
  cached = null;
}

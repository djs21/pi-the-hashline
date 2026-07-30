import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReadTool } from "./read.js";
import { registerEditTool } from "./edit.js";
import { registerGrepTool } from "./grep.js";

export default async function (pi: ExtensionAPI): Promise<void> {
  registerReadTool(pi);
  registerEditTool(pi);
  registerGrepTool(pi);

  // Register status command
  pi.registerCommand("hashline-status", {
    description: "Check pi-the-hashline extension status and config",
    handler: async (_args, ctx) => {
      const { loadConfig } = await import("./config.js");
      const config = loadConfig();

      // Check rg availability
      let rgAvailable = false;
      try {
        const { execSync } = await import("node:child_process");
        execSync("rg --version", { stdio: "ignore" });
        rgAvailable = true;
      } catch {}

      const lines = [
        "=== pi-the-hashline status ===",
        `Hash length: ${config.hashLength}`,
        `Grep tool: ${config.grep ? "enabled" : "disabled"}`,
        `Ripgrep: ${rgAvailable ? "available" : "not found"}`,
        `Tools: read (hashline), edit (hashline)${config.grep && rgAvailable ? ", grep (hashline)" : ""}`,
      ];

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

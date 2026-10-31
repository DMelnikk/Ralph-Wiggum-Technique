#!/usr/bin/env node
// Ralph loop with human-readable streaming output.
// Usage: node ralph.js [iterations=10]

const { spawn } = require("child_process");
const fs = require("fs");
const readline = require("readline");

const ITERATIONS = parseInt(process.argv[2] || "10", 10);
const PROMPT = fs.readFileSync("PROMPT.md", "utf8");
const MAX_RESULT_LINES = 8;
const MAX_LINE_LEN = 160;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c("1");
const dim = c("2");
const red = c("31");
const green = c("32");
const yellow = c("33");
const cyan = c("36");
const magenta = c("35");

function truncate(s, n = MAX_LINE_LEN) {
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// One-line summary of a tool call's input.
function summarizeInput(name, input = {}) {
  switch (name) {
    case "Bash":
      return input.description
        ? `${input.description} ${dim(`$ ${truncate(input.command, 100)}`)}`
        : truncate(input.command);
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return input.file_path || input.notebook_path || "";
    case "Glob":
      return input.pattern;
    case "Grep":
      return `${input.pattern}${input.path ? ` in ${input.path}` : ""}`;
    case "WebFetch":
      return input.url;
    case "WebSearch":
      return input.query;
    case "Task":
    case "Agent":
      return input.description || truncate(input.prompt || "");
    case "ToolSearch":
      return input.query;
    default: {
      const first = Object.values(input)[0];
      return first === undefined ? "" : truncate(typeof first === "string" ? first : JSON.stringify(first));
    }
  }
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b.type === "text" ? b.text : b.type === "tool_reference" ? `[${b.tool_name}]` : `[${b.type}]`))
      .join("\n");
  }
  return "";
}

function printIndented(text, color) {
  const lines = String(text).split("\n");
  const shown = lines.slice(0, MAX_RESULT_LINES);
  for (const l of shown) console.log(color("   │ " + truncate(l, MAX_LINE_LEN)));
  if (lines.length > shown.length) console.log(dim(`   │ … ${lines.length - shown.length} more lines`));
}

function handleMessage(msg, state) {
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") {
        console.log(dim(`session ${msg.session_id} · model ${msg.model} · ${msg.cwd}`));
      } else if (msg.subtype === "permission_denied") {
        console.log(red(`⛔ permission denied: ${msg.tool_name}`));
      }
      // thinking_tokens and other subtypes are noise
      break;

    case "assistant":
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && block.text.trim()) {
          console.log(`\n${bold("🤖")} ${block.text.trim()}`);
        } else if (block.type === "thinking" && block.thinking?.trim()) {
          console.log(dim(`💭 ${truncate(block.thinking, 300)}`));
        } else if (block.type === "tool_use") {
          state.tools.set(block.id, block.name);
          console.log(`${cyan("🔧 " + block.name)} ${summarizeInput(block.name, block.input)}`);
        }
      }
      break;

    case "user":
      if (!Array.isArray(msg.message?.content)) break;
      for (const block of msg.message.content) {
        if (block.type !== "tool_result") continue;
        const text = resultText(block.content).trim();
        if (block.is_error) {
          printIndented(text || "error", red);
        } else if (text) {
          // Reads/ToolSearch results are noisy; show a short summary instead.
          const name = state.tools.get(block.tool_use_id);
          if (name === "Read" || name === "ToolSearch") {
            console.log(dim(`   │ (${text.split("\n").length} lines)`));
          } else {
            printIndented(text, dim);
          }
        }
      }
      break;

    case "result": {
      state.result = msg.result ?? "";
      const secs = ((msg.duration_ms ?? 0) / 1000).toFixed(1);
      const cost = (msg.total_cost_usd ?? 0).toFixed(4);
      const status = msg.is_error ? red("✗ error") : green("✓ done");
      console.log(`\n${status} ${dim(`${msg.num_turns} turns · ${secs}s · $${cost}`)}`);
      break;
    }

    default:
      break; // rate_limit_event etc.
  }
}

function runIteration() {
  return new Promise((resolve, reject) => {
    // Prompt goes via stdin to avoid shell quoting issues (shell is needed on Windows for claude.cmd).
    const child = spawn("claude", ["-p", "--output-format", "stream-json", "--verbose"], {
      stdio: ["pipe", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
    child.stdin.end(PROMPT);

    const state = { tools: new Map(), result: "" };
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        console.log(line); // not JSON; pass through
        return;
      }
      try {
        handleMessage(msg, state);
      } catch (e) {
        console.log(red(`(failed to render ${msg.type}: ${e.message})`));
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`claude exited with code ${code}`));
      else resolve(state.result);
    });
  });
}

(async () => {
  for (let i = 1; i <= ITERATIONS; i++) {
    console.log(magenta(bold(`\n━━━ Iteration ${i} of ${ITERATIONS} ━━━`)));
    let result;
    try {
      result = await runIteration();
    } catch (e) {
      console.error(red(e.message));
      process.exit(1);
    }
    if (result.includes("<promise>COMPLETE</promise>")) {
      console.log(green(`\nAll tasks complete after ${i} iterations.`));
      process.exit(0);
    }
  }
  console.log(yellow(`\nReached max iterations (${ITERATIONS}).`));
})();

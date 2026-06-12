#!/usr/bin/env node
import path from "path";
import { execSync } from "child_process";

let input = "";

// ── ANSI color helpers ────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  // 256-color foreground: \x1b[38;5;Nm
  blue: "\x1b[38;5;117m", // #7dcfff – project name
  purple: "\x1b[38;5;183m", // #bb9af7 – branch
  green: "\x1b[38;5;150m", // #9ece6a – diff add / cost
  red: "\x1b[38;5;210m", // #f7768e – diff del / output tokens
  yellow: "\x1b[38;5;215m", // #e0af68 – model name
  cyan: "\x1b[38;5;116m", // #73daca – input tokens
  barFill: "\x1b[38;5;111m", // #7aa2f7 – context bar fill
  barMid: "\x1b[38;5;214m", // amber   – bar fill when >70%
  barHot: "\x1b[38;5;203m", // red     – bar fill when >90%
  barEmpty: "\x1b[38;5;238m", // dark gray – bar empty
  muted: "\x1b[38;5;61m", // separator / punctuation
  dimWhite: "\x1b[38;5;246m", // labels
  vimBg: "\x1b[48;5;235m", // vim mode badge bg
  agentRed: "\x1b[38;5;204m", // agent name
};

// Strip ANSI escape codes so we can measure printable length
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Build a line with left and right parts, padded to terminal width
function spaceBetween(left, right, width = process.env.columns || 80, pad) {
  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;
  const gap = Math.max(1, width - leftLen - (pad ? rightLen + pad : rightLen));
  return left + " ".repeat(gap) + right;
}

// ── Utility ───────────────────────────────────────────────────────────────────
function formatMsToTime(ms) {
  if (isNaN(ms) || ms < 0) return "00:00";

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  // Pads single digits with a leading zero (e.g., 5 becomes "05")
  const paddedHours = String(hours).padStart(2, "0");
  const paddedMinutes = String(minutes).padStart(2, "0");

  return `${paddedHours}:${paddedMinutes}`;
}

function formatMsToTimeWithSecs(ms) {
  if (isNaN(ms) || ms < 0) return "00:00:00";

  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((val) => String(val).padStart(2, "0"))
    .join(":");
}

function formatCount(number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  }).format(number);
}

const getProjectRoot = (dirPath = "") => {
  if (!dirPath) return "";
  return dirPath.replace(/\\+/g, "/").split("/").at(-1) ?? "";
};

function getGitDiffSummary(repoPath) {
  try {
    const cleanPath = path.resolve(repoPath);
    const output = execSync(`git -C "${cleanPath}" diff HEAD --numstat`, {
      encoding: "utf8",
    });
    if (!output.trim()) return { added: 0, deleted: 0 };

    let totalAdded = 0,
      totalDeleted = 0;
    for (const line of output.trim().split("\n")) {
      const [added, deleted] = line.split("\t");
      if (!isNaN(added)) totalAdded += parseInt(added, 10);
      if (!isNaN(deleted)) totalDeleted += parseInt(deleted, 10);
    }
    return { added: totalAdded, deleted: totalDeleted };
  } catch {
    return repoPath ? null : { added: 0, deleted: 0 };
  }
}

// ── Context bar ───────────────────────────────────────────────────────────────
function buildContextBar(pct) {
  const filled = Math.floor((pct * 20) / 100);
  const barColor = pct > 90 ? c.barHot : pct > 70 ? c.barMid : c.barFill;
  return (
    barColor +
    "⣿".repeat(filled) +
    c.barEmpty +
    "░".repeat(20 - filled) +
    c.reset
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
process.stdin.on("data", (chunk) => (input += chunk));

process.stdin.on("end", () => {
  const data = JSON.parse(input);

  const workspaceRoot = getProjectRoot(data.workspace?.project_dir ?? "");
  const branchName =
    execSync("git branch --show-current", { encoding: "utf8" })?.trim() ??
    "unknown";
  const diff = getGitDiffSummary(data.workspace?.project_dir ?? "");
  const model = data.model?.display_name ?? "?";
  const contextPct = Math.floor(data.context_window?.used_percentage || 0);
  const totalInputTokens = formatCount(
    data.context_window?.total_input_tokens ?? 0,
  );
  const totalOutputTokens = formatCount(
    data.context_window?.total_output_tokens ?? 0,
  );
  const totalCost = (data.cost?.total_cost_usd ?? 0).toFixed(2);
  const totalDurationMs = (data.cost?.total_duration_ms ?? 0).toFixed(2);
  const totalApiDurationMs = (data.cost?.total_api_duration_ms ?? 0).toFixed(2);
  const effort = data.effort?.level ?? "";
  const vimMode = data.vim?.mode ?? "";
  const agentName = data.agent?.name ?? "";

  const currentInputTokens = formatCount(
    data.context_window?.current_usage?.input_tokens ?? 0,
  );
  const currentOutputTokens = formatCount(
    data.context_window?.current_usage?.output_tokens ?? 0,
  );
  const cacheCreationInputTokens = formatCount(
    data.context_window?.current_usage?.cache_creation_input_tokens ?? 0,
  );
  const cacheReadInputTokens = formatCount(
    data.context_window?.current_usage?.cache_read_input_tokens ?? 0,
  );

  const currentStats = [
    `${c.red}▼ ${currentInputTokens}${c.reset}`,
    `${c.green}▲ ${currentOutputTokens}${c.reset}`,
    `${c.yellow}\udb80\uddba ${cacheCreationInputTokens}${c.reset}`,
    `${c.green}\udb86\udd1f ${cacheReadInputTokens}${c.reset}`,
  ];

  const sep = `${c.muted} ⏽ ${c.reset}`;
  const dot = `${c.muted} · ${c.reset}`;

  // ── Row 1 ────────────────────────────────────────────────────────────────
  const diffStr = diff
    ? `${c.green}+${diff.added}${c.reset} ${c.red}-${diff.deleted}${c.reset}`
    : `${c.red}DIFF_ERR${c.reset}`;

  const r1left = [
    vimMode ? `${c.vimBg}${c.barFill} ${vimMode} ${c.reset}` : "",
    `${c.bold}${c.blue}${workspaceRoot}${c.reset}`,
  ]
    .filter(Boolean)
    .join(sep);

  const r1right = [
    diffStr,
    `${c.purple} ${branchName}${c.reset}`,
    agentName ? `${dot}${c.agentRed}${agentName}${c.reset}` : "",
  ]
    .filter(Boolean)
    .join(sep);

  // ── Row 2 ────────────────────────────────────────────────────────────────
  const r2left = [
    `${c.yellow}${model}${c.reset}`,
    `${buildContextBar(contextPct)} ${c.barFill}${contextPct}%${c.reset}`,
  ].join(sep);

  const r2right = [
    `${c.cyan}▼ ${totalInputTokens}${c.reset} ${c.red}▲ ${totalOutputTokens}${c.reset}`,
    `${c.green}$ ${totalCost}${c.reset}${effort ? sep + `${c.purple}Σ ${effort}${c.reset}` : `${c.reset}`}`,
  ].join(sep);

  console.log(spaceBetween(r1left, r1right));
  console.log("─".repeat(parseInt(process.env.COLUMNS)));
  console.log(spaceBetween(r2left, r2right));
  console.log("─".repeat(parseInt(process.env.COLUMNS)));
  console.log(
    spaceBetween(
      `${c.green}Current:${c.reset} ${currentStats.join(sep)}`,
      `⌚ ${formatMsToTime(totalDurationMs)}${sep}🛜 ${formatMsToTimeWithSecs(totalApiDurationMs)}`,
    ),
  );
  console.log("─".repeat(parseInt(process.env.COLUMNS)));
});

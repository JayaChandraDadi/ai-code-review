import { consume } from "./rabbitmq.js";
import { insertReviewEvent, updateFindings } from "./db.js";
import { fetchPRFiles } from "./github.js";
import { analyzeFiles } from "./rules.js";
import { analyzeFileWithLLM } from "./llm";
import type { GhFile } from "./github.js"; // type import
import type { Issue } from "./rules.js";   // type import

const RABBITMQ_URL = process.env.RABBITMQ_URL!;
const QUEUE_NAME = process.env.QUEUE_NAME || "pull_requests";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const HF_MODEL = process.env.HF_MODEL || "Qwen/Qwen2.5-Coder-7B-Instruct";

// tiny sleep to be nice to APIs
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Files coming from GitHub + our extra fields for LLM
type PRFile = GhFile & {
  content?: string; // raw file text for LLM
  sha?: string;
};

/** ---------- LLM → Issue mapping ---------- */

type LlmSeverity = "INFO" | "MINOR" | "MAJOR" | "CRITICAL";

function mapSeverity(s: LlmSeverity): Issue["severity"] {
  switch (s) {
    case "CRITICAL":
    case "MAJOR":
      return "error";
    case "MINOR":
      return "warn";
    case "INFO":
    default:
      return "info";
  }
}

function toIssueFromLLM(iss: any, fallbackFile: string): Issue {
  // iss may look like: { file?, title, severity, line?, rationale, suggestion? }
  const parts: string[] = [];
  if (iss?.title) parts.push(String(iss.title));
  if (iss?.rationale) parts.push(String(iss.rationale));
  if (iss?.suggestion) parts.push(`Suggestion: ${String(iss.suggestion)}`);

  return {
    file: iss?.file || fallbackFile,
    line: typeof iss?.line === "number" ? iss.line : undefined,
    message: parts.filter(Boolean).join(" — "),
    severity: mapSeverity((iss?.severity || "INFO") as LlmSeverity),
    rule: "llm",
  };
}

/** ---------------------------------------- */

(async () => {
  await consume(RABBITMQ_URL, QUEUE_NAME, async (msg) => {
    const payload = JSON.parse(msg.content.toString());

    // 1) audit row as RECEIVED
    await insertReviewEvent({
      id: payload.id,
      repo: payload.repo,
      pr_number: payload.pr_number,
      head_sha: payload.head_sha,
      status: "RECEIVED",
      payload,
    });

    // 2) fetch PR files (best effort)
    let findings: { issues: Issue[]; meta: Record<string, any> } = { issues: [], meta: {} };
    let files: PRFile[] = [];
    try {
      if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN missing");
      files = await fetchPRFiles(payload.repo, payload.pr_number, GITHUB_TOKEN);

      findings.meta = {
        ...(findings.meta || {}),
        file_count: files.length,
        fetch_ok: true,
      };
    } catch (err: any) {
      findings.meta = {
        ...(findings.meta || {}),
        fetch_ok: false,
        error: String(err?.message || err),
      };
      console.error("review error", payload.id, findings.meta.error);

      await updateFindings(payload.id, findings);
      console.log("reviewed (fetch failed)", payload.id, payload.repo, `#${payload.pr_number}`);
      return;
    }

    // If PR has no changed files, persist and exit early
    if (!files.length) {
      findings.meta = { ...(findings.meta || {}), note: "No changed files in PR" };
      await updateFindings(payload.id, findings);
      console.log("reviewed (no files)", payload.id, payload.repo, `#${payload.pr_number}`);
      return;
    }

    // 3) static rules (non-blocking / best-effort)
    try {
      const staticResult = analyzeFiles(files);
      if (staticResult?.issues?.length) {
        findings.issues.push(...staticResult.issues);
      }
      findings.meta = {
        ...(findings.meta || {}),
        static_rules_ok: true,
        static_issue_count: staticResult?.issues?.length || 0,
      };
    } catch (err: any) {
      findings.meta = {
        ...(findings.meta || {}),
        static_rules_ok: false,
        static_rules_error: String(err?.message || err),
      };
      console.warn("static rules failed", payload.id, err?.message || err);
    }

    // 4) LLM analysis per file
    const llmNewIssues: Issue[] = [];
    let llmAnalyzed = 0;
    let llmSkippedNoContent = 0;
    let llmErrors = 0;

    for (const f of files) {
      // Skip binary/empty/no-content files
      if (!f.content || typeof f.content !== "string" || f.content.trim().length === 0) {
        llmSkippedNoContent++;
        continue;
      }

      try {
        const result = await analyzeFileWithLLM(f.filename, f.content);
        if (result?.issues?.length) {
          for (const raw of result.issues) {
            llmNewIssues.push(toIssueFromLLM(raw, f.filename));
          }
        }
        llmAnalyzed++;

        // small delay to avoid hitting HF too hard
        await sleep(250);
      } catch (e: any) {
        llmErrors++;
        llmNewIssues.push({
          file: f.filename,
          message: `LLM analysis failed — ${e?.message || String(e)}`,
          severity: "info",
          rule: "llm",
        });
      }
    }

    // merge LLM issues
    findings.issues.push(...llmNewIssues);

    // meta for LLM
    findings.meta = {
      ...(findings.meta || {}),
      llm_model: HF_MODEL,
      llm_analyzed_files: llmAnalyzed,
      llm_skipped_no_content: llmSkippedNoContent,
      llm_errors: llmErrors,
      total_issue_count: findings.issues.length,
      analyzed_at: new Date().toISOString(),
    };

    // 5) persist results as REVIEWED (or ANALYZED if you prefer)
    await updateFindings(payload.id, findings);
    console.log(
      "reviewed",
      payload.id,
      payload.repo,
      `#${payload.pr_number}`,
      `${findings.issues.length} issues`,
      `(static:${findings.meta.static_issue_count || 0}, llm:${llmNewIssues.length})`
    );
  });
})();

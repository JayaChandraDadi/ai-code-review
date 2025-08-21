import axios from "axios";
import { z } from "zod";
const HF_MODEL = process.env.HF_MODEL || "Qwen/Qwen2.5-Coder-7B-Instruct";
const HF_TOKEN = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN || "";
const TIMEOUT = Number(process.env.LLM_TIMEOUT_MS || 60000);
const MAX_NEW_TOKENS = Number(process.env.LLM_MAX_NEW_TOKENS || 512);
const TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 0.2);
// The shape we want the LLM to return (per file).
export const IssueSchema = z.object({
    file: z.string(),
    title: z.string(),
    severity: z.enum(["INFO", "MINOR", "MAJOR", "CRITICAL"]),
    line: z.number().optional(),
    category: z.enum(["bug", "security", "style", "performance", "maintainability"]),
    rationale: z.string(),
    suggestion: z.string().optional(),
    snippet: z.string().optional(),
});
export const IssuesResponseSchema = z.object({
    issues: z.array(IssueSchema),
    summary: z.string().optional(),
});
function buildPrompt(filePath, content) {
    // For very large files, truncate to protect the endpoint.
    const MAX_CHARS = 12000;
    const safeContent = content.length > MAX_CHARS
        ? content.slice(0, MAX_CHARS) + "\n\n// [truncated for analysis]"
        : content;
    return `
You are a senior code reviewer. Analyze the given file and return findings as strict JSON.

Rules:
- Only return JSON (no code fences, no commentary).
- Use these keys exactly: issues (array), summary (string).
- For each issue: file, title, severity (INFO|MINOR|MAJOR|CRITICAL), line (optional number),
  category (bug|security|style|performance|maintainability), rationale, suggestion (optional), snippet (optional).

File: ${filePath}
Code:
${safeContent}

Return JSON only, matching:
{
  "issues": [{
    "file": "path",
    "title": "string",
    "severity": "INFO|MINOR|MAJOR|CRITICAL",
    "line": 123,
    "category": "bug|security|style|performance|maintainability",
    "rationale": "string",
    "suggestion": "string",
    "snippet": "string"
  }],
  "summary": "string"
}
`.trim();
}
function extractJson(text) {
    // HF text-gen often returns plain text; be robust if anything extra sneaks in.
    // 1) try direct parse
    try {
        return JSON.parse(text);
    }
    catch { }
    // 2) try to yank the first {...} block
    const m = text.match(/\{[\s\S]*\}$/m);
    if (m) {
        try {
            return JSON.parse(m[0]);
        }
        catch { }
    }
    throw new Error("LLM returned non-JSON or malformed JSON");
}
export async function analyzeFileWithLLM(filePath, content) {
    if (!HF_TOKEN) {
        throw new Error("HUGGINGFACE_API_TOKEN is not set");
    }
    const prompt = buildPrompt(filePath, content);
    const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(HF_MODEL)}`;
    const { data } = await axios.post(url, {
        inputs: prompt,
        parameters: {
            max_new_tokens: MAX_NEW_TOKENS,
            temperature: TEMPERATURE,
            return_full_text: false
        }
    }, {
        headers: { Authorization: `Bearer ${HF_TOKEN}` },
        timeout: TIMEOUT,
    });
    // Common HF response formats:
    // - [{ generated_text: "..." }]
    // - { error: "...", estimated_time: 5.0 } (loading on first call)
    if (Array.isArray(data) && data.length && data[0].generated_text) {
        const json = extractJson(data[0].generated_text);
        return IssuesResponseSchema.parse(json);
    }
    // Model cold start case
    if (data && data.error && typeof data.estimated_time !== "undefined") {
        throw new Error(`Model warming up. Try again in ~${data.estimated_time}s`);
    }
    // Some hosted models return {generated_text: "..."} directly
    if (data && data.generated_text) {
        const json = extractJson(data.generated_text);
        return IssuesResponseSchema.parse(json);
    }
    throw new Error(`Unexpected HF response: ${JSON.stringify(data).slice(0, 400)}`);
}

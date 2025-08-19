import type { GhFile } from './github.js';

export type Issue = {
  file: string;
  line?: number;
  message: string;
  severity: 'info' | 'warn' | 'error';
  rule: string;
};

export type Findings = { issues: Issue[]; meta?: Record<string, any> };

const patterns: { rule: string; severity: Issue['severity']; re: RegExp; msg: string }[] = [
  { rule: 'no-console-log', severity: 'warn',  re: /\bconsole\.log\s*\(/, msg: 'Avoid console.log in committed code' },
  { rule: 'todo-fixme',     severity: 'info',  re: /\b(?:TODO|FIXME)\b/,   msg: 'Leftover TODO/FIXME' },
  { rule: 'secret-key',     severity: 'error', re: /\b(?:(?:api[_-]?key)|secret|password)\b/i, msg: 'Potential secret or credential' },
  { rule: 'aws-access-key', severity: 'error', re: /\bAKIA[0-9A-Z]{16}\b/, msg: 'Looks like an AWS Access Key ID' },
  { rule: 'private-key',    severity: 'error', re: /-----BEGIN (?:RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/, msg: 'Private key material detected' },
];

export function analyzeFiles(files: GhFile[]): Findings {
  const issues: Issue[] = [];

  for (const f of files) {
    if ((f.additions + f.deletions) > 800) {
      issues.push({ file: f.filename, message: 'Very large change (>800 lines) — consider splitting', severity: 'info', rule: 'large-change' });
    }
    if (!f.patch) continue;

    let newLine = 0;
    const lines = f.patch.split('\n');
    for (const line of lines) {
      if (line.startsWith('@@')) {
        const m = /\+([0-9]+)(?:,([0-9]+))?/.exec(line); // @@ -a,b +c,d @@
        if (m) newLine = parseInt(m[1], 10);
        continue;
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.slice(1);
        for (const p of patterns) {
          if (p.re.test(content)) {
            issues.push({ file: f.filename, line: newLine, message: p.msg, severity: p.severity, rule: p.rule });
          }
        }
        newLine++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // removed line → do not advance newLine
      } else {
        newLine++; // context
      }
    }
  }
  return { issues };
}

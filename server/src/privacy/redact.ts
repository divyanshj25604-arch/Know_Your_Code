/**
 * Secret redaction (docs/07 §10). Applied to file contents before storage and again to anything sent to the
 * model. Redaction preserves line structure so line numbers stay valid; it replaces only the secret value.
 */
export const REDACTED = '[REDACTED]';

interface Rule {
  name: string;
  re: RegExp;
  /** Replace only a capture group (keeps surrounding quotes/keys); default replaces the whole match. */
  group?: number;
}

const RULES: Rule[] = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'openai-style-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{20,}\b/g },
  // scheme://user:password@host — redact the password only.
  { name: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:([^\s@'"`/]{3,})@/gi, group: 1 },
  // KEY = "value" where the key name looks secret and the value looks like a real secret (>= 12 chars, no spaces).
  {
    name: 'secret-assignment',
    re: /\b[A-Za-z0-9_.-]*(?:secret|password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)[A-Za-z0-9_.-]*\s*[:=]\s*['"`]([^'"`\s${}]{12,})['"`]/gi,
    group: 1,
  },
];

function blankKeepingNewlines(s: string): string {
  const lines = s.split('\n');
  return lines.map(() => REDACTED).join('\n');
}

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      const match = args[0] as string;
      if (rule.group) {
        const g = args[rule.group] as string | undefined;
        if (!g) return match;
        // Leave obvious placeholders alone (process.env.X, <your-key>, xxxx...).
        if (/^(x+|\*+|<.*>|your[-_ ].*|changeme|example.*|placeholder.*)$/i.test(g)) return match;
        count++;
        return match.replace(g, REDACTED);
      }
      count++;
      return match.includes('\n') ? blankKeepingNewlines(match) : REDACTED;
    });
  }
  return { text: out, count };
}

const SECRET_FILE_RES: RegExp[] = [
  /(^|\/)\.env(\.(?!example$|sample$|template$|dist$).+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)credentials(\.json)?$/i,
  /(^|\/)service-account.*\.json$/i,
];

/** Files that are never stored or displayed (docs/08 §2). `.env.example` and similar templates are allowed. */
export function isSecretFile(path: string): boolean {
  return SECRET_FILE_RES.some((re) => re.test(path));
}

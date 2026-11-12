import type { HealthView } from '@kyc/contracts';
import { privacyFacts } from './PrivacyFacts';

const health = (over: Partial<HealthView> = {}): HealthView => ({
  status: 'ok',
  db: 'ok',
  ai: 'configured',
  github: 'token',
  queueDepth: 0,
  jobs: 'active',
  version: 't',
  privacy: { aiProvider: 'Anthropic', retentionDays: 7 },
  ...over,
});

describe('privacy notice (P4.5)', () => {
  it('names the provider and retention this server is configured with', () => {
    const t = privacyFacts(health()).join('\n');
    expect(t).toMatch(/stored for 7 days/);
    expect(t).toMatch(/sent to Anthropic to write explanations/);
    expect(t).toMatch(/Anthropic's own terms govern/);
    const g = privacyFacts(health({ privacy: { aiProvider: 'Groq', retentionDays: 1 } })).join('\n');
    expect(g).toMatch(/sent to Groq/);
    expect(g).toMatch(/stored for 1 day,/);
    expect(g).not.toMatch(/Anthropic/);
  });

  it('says no code leaves for an AI service when none is used', () => {
    expect(
      privacyFacts(health({ ai: 'test_provider', privacy: { aiProvider: null, retentionDays: 7 } })).join(
        ' ',
      ),
    ).toMatch(/test provider: no code is sent/);
    expect(
      privacyFacts(health({ ai: 'not_configured', privacy: { aiProvider: null, retentionDays: 7 } })).join(
        ' ',
      ),
    ).toMatch(/not configured on this server: no code is sent/);
  });

  it('makes no unsupported promises: no pricing, no "free", no provider retention claims, no perfect redaction', () => {
    for (const h of [null, health(), health({ privacy: { aiProvider: 'Groq', retentionDays: 7 } })]) {
      const t = privacyFacts(h).join(' ');
      expect(t).not.toMatch(
        /\bfree\b|price|never (stored|retained|logged)|not used for training|all secrets/i,
      );
      expect(t).toMatch(/pattern-based/);
    }
  });
});

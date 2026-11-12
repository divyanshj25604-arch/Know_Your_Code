import type { HealthView } from '@kyc/contracts';

/**
 * What happens to imported code (P4.5). Every statement is either a product fact enforced by this codebase or comes
 * from the server's configuration (`/api/v1/health` `privacy`). Nothing here describes a provider's own pricing or
 * data handling: that is governed by the provider's terms, which this product does not restate.
 */
export function privacyFacts(health: HealthView | null): string[] {
  const days = health?.privacy?.retentionDays;
  const provider = health?.privacy?.aiProvider ?? null;
  const ai =
    health === null
      ? 'Short snippets of the code you select, never the whole repository, are sent to the AI provider this server uses to write explanations.'
      : provider
        ? `Short snippets of the code you select, never the whole repository, are sent to ${provider} to write explanations. ${provider}'s own terms govern how it handles them.`
        : health.ai === 'test_provider'
          ? 'This server uses a test provider: no code is sent to an AI service.'
          : 'AI explanations are not configured on this server: no code is sent to an AI service.';
  return [
    days
      ? `Your files are stored for ${days} day${days === 1 ? '' : 's'}, or until you delete them.`
      : 'Your files are stored for a limited time, or until you delete them.',
    'Imported code is never executed.',
    ai,
    'Common secret formats, such as API keys and tokens, are removed before code is stored or sent. The check is pattern-based, so do not import code that contains real secrets.',
  ];
}

export function PrivacyFacts({ health, lead }: { health: HealthView | null; lead?: string[] }) {
  return (
    <ul className="plain-list">
      {[...(lead ?? []), ...privacyFacts(health)].map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

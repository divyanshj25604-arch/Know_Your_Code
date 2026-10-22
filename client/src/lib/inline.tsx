import type { ReactNode } from 'react';

/**
 * Render the small markdown subset the model is asked to use (**bold**, `code`) as React nodes. Everything else is
 * plain text. No HTML is ever interpreted, so repository- or model-supplied markup cannot inject script (docs/07 §10).
 */
export function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4)
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
          return <code key={i}>{p.slice(1, -1)}</code>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

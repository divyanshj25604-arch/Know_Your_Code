import { render } from '@testing-library/react';
import { Inline } from './inline';

describe('Inline', () => {
  it('renders bold and code, and nothing else, as elements', () => {
    const { container } = render(<Inline text="It waits for the reply (**await**) from `db.find()`." />);
    expect(container.querySelector('strong')?.textContent).toBe('await');
    expect(container.querySelector('code')?.textContent).toBe('db.find()');
    expect(container.textContent).toBe('It waits for the reply (await) from db.find().');
  });

  it('never interprets HTML from model or repository text', () => {
    const evil = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> **ok**';
    const { container } = render(<Inline text={evil} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('leaves unmatched markers as plain text', () => {
    const { container } = render(<Inline text="2 ** 3 and `unterminated" />);
    expect(container.textContent).toBe('2 ** 3 and `unterminated');
  });
});

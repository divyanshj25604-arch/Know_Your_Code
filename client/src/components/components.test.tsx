import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Relations, TreeNode } from '@kyc/contracts';
import { FileTree } from './FileTree';
import { RelationList } from './RelationList';
import { RepoUrlInput } from './RepoUrlInput';
import { StageProgress } from './StageProgress';
import { DepthControl, ErrorState, ProvenanceTag } from './ui';

const tree: TreeNode = {
  name: '/',
  type: 'dir',
  children: [
    {
      name: 'src',
      type: 'dir',
      children: [
        { name: 'app.js', type: 'file', path: 'src/app.js', analysable: true },
        { name: 'util.ts', type: 'file', path: 'src/util.ts', analysable: true },
      ],
    },
    { name: 'README.md', type: 'file', path: 'README.md', analysable: false },
  ],
};

describe('RepoUrlInput', () => {
  it('blocks submit and explains a bad URL, then submits a good one', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    const Wrapper = () => {
      const [v, setV] = useState('');
      return <RepoUrlInput value={v} onChange={setV} onSubmit={onSubmit} submitting={false} />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Public GitHub repository URL');
    await user.type(input, 'https://gitlab.com/a/b');
    await user.click(screen.getByRole('button', { name: 'Analyse repository' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/isn't a GitHub repository link/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'https://github.com/acme/app');
    await user.click(screen.getByRole('button', { name: 'Analyse repository' }));
    expect(onSubmit).toHaveBeenCalledWith('https://github.com/acme/app');
  });
});

describe('FileTree', () => {
  it('expands folders, filters by name, and opens a file with the keyboard', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<FileTree root={tree} activePath={null} onOpen={onOpen} />);
    expect(screen.queryByText('app.js')).not.toBeInTheDocument(); // collapsed
    await user.click(screen.getByRole('treeitem', { name: 'src' }));
    expect(screen.getByRole('treeitem', { name: 'app.js' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Filter files by name'), 'util');
    expect(screen.queryByText('app.js')).not.toBeInTheDocument();
    const item = screen.getByRole('treeitem', { name: 'util.ts' });
    item.focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith('src/util.ts');
  });

  it('says when nothing matches and marks view-only files for screen readers', async () => {
    const user = userEvent.setup();
    render(<FileTree root={tree} activePath={null} onOpen={() => undefined} />);
    expect(screen.getByRole('treeitem', { name: /README\.md/ })).toHaveTextContent('(not analysed)');
    await user.type(screen.getByLabelText('Filter files by name'), 'zzz');
    expect(screen.getByText(/No files match/)).toBeInTheDocument();
  });

  it('arrow keys move between rows', async () => {
    const user = userEvent.setup();
    render(<FileTree root={tree} activePath="src/app.js" onOpen={() => undefined} />);
    const first = screen.getByRole('treeitem', { name: 'src' });
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: 'app.js' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowUp}');
    expect(screen.getByRole('treeitem', { name: 'app.js' })).toHaveFocus();
  });
});

describe('RelationList', () => {
  const rel: Relations = {
    symbol: {
      id: 's',
      name: 'login',
      kind: 'function',
      signature: 'function login()',
      path: 'a.js',
      startLine: 1,
      startCol: 0,
      endLine: 3,
      endCol: 1,
    },
    definedIn: { path: 'a.js', line: 1 },
    calledBy: [
      {
        symbolId: 'c',
        label: 'POST /login route registration',
        path: 'routes.js',
        line: 4,
        provenance: 'pattern',
        via: 'route',
      },
    ],
    calls: [
      { symbolId: 'f', label: 'findUser', path: 'svc.js', line: 7, provenance: 'verified', via: 'call' },
    ],
    imports: [{ label: 'express', external: true, line: 1 }],
    unresolved: [
      { label: 'obj[name]', path: 'a.js', line: 2, reason: 'computed_member' },
      { label: 'res.json', path: 'a.js', line: 3, reason: 'external_package:express' },
    ],
  };

  it('navigates to the definition of a callee and labels pattern matches honestly', async () => {
    const onNav = vi.fn();
    const user = userEvent.setup();
    render(<RelationList relations={rel} onNavigate={onNav} />);
    await user.click(screen.getByRole('button', { name: /findUser/ }));
    expect(onNav).toHaveBeenCalledWith('svc.js', 7, 'findUser', 'f');
    const tags = screen.getAllByText((_, el) => el?.classList.contains('tag') ?? false);
    expect(tags.map((t) => t.textContent)).toEqual(['✓ Verified', '✓ Verified (pattern)', '✓ Verified']);
  });

  it('explains why something cannot be followed, in plain words, only when asked', async () => {
    const user = userEvent.setup();
    render(<RelationList relations={rel} onNavigate={() => undefined} />);
    expect(screen.queryByText(/chosen at runtime/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Can't follow statically \(2\)/ }));
    expect(screen.getByText(/the method is chosen at runtime/)).toBeInTheDocument();
    expect(screen.getByText(/belongs to an external package: express/)).toBeInTheDocument();
  });

  it('is honest when there is nothing to show', () => {
    render(
      <RelationList
        relations={{ ...rel, calledBy: [], calls: [], unresolved: [], imports: [] }}
        onNavigate={() => undefined}
      />,
    );
    expect(screen.getByText(/No relations were found/)).toBeInTheDocument();
  });
});

describe('small components', () => {
  it('StageProgress shows counts and states with text, not colour alone', () => {
    render(
      <StageProgress
        stages={[
          { name: 'fetching', state: 'done', ms: 1200 },
          { name: 'filtering', state: 'done', ms: 300 },
          { name: 'analysing', state: 'running', progress: { done: 12, total: 40 } },
          { name: 'summarising', state: 'pending' },
        ]}
      />,
    );
    expect(screen.getByText('done · 1.2s')).toBeInTheDocument();
    expect(screen.getByText('in progress · 12/40')).toBeInTheDocument();
    expect(screen.getByText('waiting')).toBeInTheDocument();
  });

  it('ErrorState shows a cause, a hint and a working action; no duplicate Retry text', () => {
    const onAction = vi.fn();
    render(<ErrorState code="AI_TIMEOUT" onAction={onAction} />);
    expect(screen.getByRole('alert')).toHaveTextContent("The explanation didn't finish.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onAction).toHaveBeenCalled();
    expect(screen.getAllByText('Retry')).toHaveLength(1);
  });

  it('DepthControl is a radio group', () => {
    const onChange = vi.fn();
    render(<DepthControl value="default" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Deeper'));
    expect(onChange).toHaveBeenCalledWith('deeper');
    expect(screen.getByLabelText('Default')).toBeChecked();
  });

  it('ProvenanceTag always pairs an icon with a word', () => {
    const { container } = render(
      <>
        <ProvenanceTag kind="verified" />
        <ProvenanceTag kind="explained" />
      </>,
    );
    expect(container.querySelector('.tag-verified')).toHaveTextContent('✓ Verified');
    expect(container.querySelector('.tag-explained')).toHaveTextContent('✦ Explained');
  });
});

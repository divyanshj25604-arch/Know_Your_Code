import type { ResolveResponse, Selection } from '@kyc/contracts';
import type { Db } from '../db/pool';
import { AppError } from '../http/errors';
import { classifySelection } from '../analysis/resolve';
import { getFileContent } from './files';
import { enclosingSymbol, symbolsInFile } from './symbols';

export interface ResolvedSelection extends ResolveResponse {
  text: string;
  identifier?: string;
  fileAnalysable: boolean;
}

export async function resolveSelection(
  db: Db,
  snapshotId: string,
  sel: Selection,
): Promise<ResolvedSelection> {
  const file = await getFileContent(db, snapshotId, sel.path);
  if (!file) throw new AppError('FILE_NOT_FOUND');
  if (sel.endLine > file.lineCount && file.lineCount > 0) throw new AppError('INVALID_SELECTION');

  const analysable =
    (await db.query<{ analysable: boolean }>('SELECT analysable FROM files WHERE id=$1', [file.id])).rows[0]
      ?.analysable ?? false;
  const imports = analysable ? await symbolsInFile(db, snapshotId, sel.path, ['import']) : [];
  const classified = classifySelection(sel.path, file.content, sel, new Set(imports.map((i) => i.name)));

  const symbol = analysable ? await enclosingSymbol(db, snapshotId, sel.path, sel) : null;
  let kind = classified.kind;
  if (kind === 'identifier' && symbol && classified.identifier) {
    const short = symbol.name.split('.').pop();
    if (short === classified.identifier && sel.startLine === symbol.startLine) kind = 'function';
  }
  const note =
    classified.note ??
    (!analysable
      ? 'This file is shown but not analysed, so there are no verified relations for it.'
      : undefined);
  return {
    kind,
    symbol: symbol
      ? {
          id: symbol.id,
          name: symbol.name,
          kind: symbol.kind,
          path: symbol.path,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          signature: symbol.signature ?? null,
        }
      : null,
    spansMultiple: classified.spansMultiple,
    ...(note ? { note } : {}),
    text: classified.text,
    ...(classified.identifier ? { identifier: classified.identifier } : {}),
    fileAnalysable: analysable,
  };
}

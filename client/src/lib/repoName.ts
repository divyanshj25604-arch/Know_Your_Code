import type { RepositorySource } from '@kyc/contracts';

/** How a repository is named in the UI: owner/name for GitHub, the project name for a ZIP upload. */
export function repoName(r: { owner: string; name: string; source?: RepositorySource }): string {
  return r.source === 'upload' || !r.owner ? r.name : `${r.owner}/${r.name}`;
}

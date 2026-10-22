import { Project, ts } from 'ts-morph';
import type { AnalysisInput } from './types';

export interface PathAliases {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

/** Read `baseUrl`/`paths` from a root tsconfig.json or jsconfig.json (JSONC tolerated). Never throws. */
export function readPathAliases(
  files: AnalysisInput[],
  allFiles: { path: string; content: string }[] = files,
): PathAliases {
  const cfg =
    allFiles.find((f) => f.path === 'tsconfig.json') ?? allFiles.find((f) => f.path === 'jsconfig.json');
  if (!cfg) return {};
  try {
    const parsed = ts.parseConfigFileTextToJson(cfg.path, cfg.content);
    const opts = parsed.config?.compilerOptions as { baseUrl?: unknown; paths?: unknown } | undefined;
    if (!opts) return {};
    const out: PathAliases = {};
    if (typeof opts.baseUrl === 'string') out.baseUrl = opts.baseUrl;
    if (opts.paths && typeof opts.paths === 'object') {
      const paths: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(opts.paths as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) paths[k] = v as string[];
      }
      out.paths = paths;
    }
    return out;
  } catch {
    return {};
  }
}

const ROOT = '/repo';

/**
 * Build an in-memory ts-morph Project. No file-system access, no npm install, no execution of repository code:
 * we only parse and type-resolve text.
 */
export function buildProject(files: AnalysisInput[], aliases: PathAliases = {}): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      resolveJsonModule: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      types: [],
      noLib: false,
      skipLibCheck: true,
      baseUrl: aliases.baseUrl ? `${ROOT}/${aliases.baseUrl}`.replace(/\/\.$/, '') : undefined,
      paths: aliases.paths,
    },
  });
  for (const f of files) {
    project.createSourceFile(`${ROOT}/${f.path}`, f.content, { overwrite: true });
  }
  return project;
}

export function toRelPath(absPath: string): string | null {
  return absPath.startsWith(`${ROOT}/`) ? absPath.slice(ROOT.length + 1) : null;
}
export const PROJECT_ROOT = ROOT;

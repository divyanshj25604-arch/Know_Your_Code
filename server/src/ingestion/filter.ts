import { isSecretFile } from '../privacy/redact';

export type SkipReason =
  | 'excluded_directory'
  | 'excluded_file'
  | 'binary'
  | 'secret_file'
  | 'file_too_large'
  | 'total_size_limit'
  | 'not_utf8'
  | 'unsafe_path'
  | 'symlink'
  | 'too_many_analysable_files';

export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  excluded_directory: 'Inside a dependency/build directory',
  excluded_file: 'Lockfile, minified, or source map',
  binary: 'Binary file',
  secret_file: 'May contain secrets; never stored',
  file_too_large: 'File too large',
  total_size_limit: 'Repository text size limit reached',
  not_utf8: 'Not valid UTF-8 text',
  unsafe_path: 'Unsafe path in archive',
  symlink: 'Symbolic link',
  too_many_analysable_files: 'Analysable file limit reached',
};

export const ANALYSABLE_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx']);

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.git',
  'vendor',
  '.turbo',
  '.vercel',
  '.cache',
  '.nuxt',
  '.svelte-kit',
  '.parcel-cache',
  '__pycache__',
  '.idea',
  '.vscode',
]);

const EXCLUDED_FILE_RES = [
  /\.min\.(js|css)$/i,
  /\.map$/i,
  /\.lock$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /\.d\.ts$/i,
  /(^|\/)\.DS_Store$/i,
];

const BINARY_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'svgz',
  'pdf',
  'zip',
  'gz',
  'tgz',
  'tar',
  'rar',
  '7z',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp3',
  'mp4',
  'mov',
  'avi',
  'wav',
  'webm',
  'exe',
  'dll',
  'so',
  'dylib',
  'class',
  'jar',
  'wasm',
  'bin',
  'psd',
  'sketch',
  'db',
  'sqlite',
]);

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase();
}

export function languageOf(path: string): string | null {
  const e = extOf(path);
  if (e === 'mjs' || e === 'cjs') return 'js';
  return ANALYSABLE_EXT.has(e) ? e : null;
}

export type PathVerdict = { keep: true } | { keep: false; reason: SkipReason };

/** Decide from the path alone (before reading content). */
export function classifyPath(path: string): PathVerdict {
  const parts = path.split('/');
  if (parts.slice(0, -1).some((p) => EXCLUDED_DIRS.has(p)))
    return { keep: false, reason: 'excluded_directory' };
  if (isSecretFile(path)) return { keep: false, reason: 'secret_file' };
  if (EXCLUDED_FILE_RES.some((re) => re.test(path))) return { keep: false, reason: 'excluded_file' };
  if (BINARY_EXT.has(extOf(path))) return { keep: false, reason: 'binary' };
  return { keep: true };
}

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function isGeneratedPath(path: string): boolean {
  return /(^|\/)__generated__\//.test(path);
}

export function isGeneratedContent(head: string): boolean {
  return /@generated|DO NOT EDIT|auto-?generated/i.test(head.slice(0, 600));
}

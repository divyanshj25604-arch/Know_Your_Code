export const SKIP_REASON_COPY: Record<string, string> = {
  excluded_directory: 'inside a dependency or build folder',
  excluded_file: 'lockfile, minified file, or source map',
  binary: 'binary file',
  secret_file: 'may contain secrets; never stored',
  file_too_large: 'too large to show',
  total_size_limit: 'repository size limit reached',
  not_utf8: "isn't valid UTF-8 text",
  unsafe_path: 'unsafe path in the archive',
  symlink: 'symbolic link',
  parse_error: "has a syntax error, so it's viewable but not analysed",
  analysis_failed: "couldn't be analysed",
};

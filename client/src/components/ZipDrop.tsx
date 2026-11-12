import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';

const fmt = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;

/** Client-side checks before any upload: a .zip, not empty. The server checks the archive itself and its limits. */
export function checkZip(f: File): string | null {
  if (!/\.zip$/i.test(f.name))
    return "That isn't a .zip file. Compress your project folder as a ZIP and try again.";
  if (f.size === 0) return 'That file is empty.';
  return null;
}

/**
 * ZIP import (PRD stage 2): a large drop zone that is also a button (click, Enter or Space to browse), the chosen file
 * with Replace and Remove, and one action to upload. Disabled while any import is running, so nothing is sent twice.
 */
export function ZipDrop({
  file,
  onFile,
  onSubmit,
  submitting,
  uploading,
  error,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  onSubmit: (f: File) => void;
  /** Any import (GitHub or ZIP) is in progress. */
  submitting: boolean;
  /** This upload is in progress. */
  uploading: boolean;
  error?: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const take = (f: File | undefined | null) => {
    if (!f) return;
    const problem = checkZip(f);
    setHint(problem);
    onFile(problem ? null : f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (submitting) return;
    take(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="zip">
      <input
        ref={input}
        id={id}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div
        role="button"
        tabIndex={submitting ? -1 : 0}
        aria-disabled={submitting}
        aria-describedby={`${id}-help`}
        aria-label={
          file ? `ZIP file chosen: ${file.name}. Choose another` : 'Choose a ZIP file, or drop one here'
        }
        className={`dropzone${over ? ' over' : ''}${file ? ' has-file' : ''}`}
        onClick={() => !submitting && input.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !submitting) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!submitting) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {file ? (
          <>
            <span className="dropzone-title mono">{file.name}</span>
            <span className="small muted">{fmt(file.size)} · ready to upload</span>
          </>
        ) : (
          <>
            <span className="dropzone-title">Drop a .zip of your project here</span>
            <span className="small muted">or click to browse</span>
          </>
        )}
      </div>
      <p id={`${id}-help`} className="field-hint">
        {hint ?? 'Zip the project folder. Folders like node_modules and build output are skipped for you.'}
      </p>
      {file && (
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting}
            onClick={() => onSubmit(file)}
          >
            {uploading ? 'Uploading…' : 'Analyse ZIP'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={submitting}
            onClick={() => input.current?.click()}
          >
            Replace
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={submitting}
            onClick={() => {
              onFile(null);
              setHint(null);
            }}
          >
            Remove
          </button>
        </div>
      )}
      {error}
    </div>
  );
}

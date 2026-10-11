import { useEffect, useState } from 'react';
import { FileCode2, X } from 'lucide-react';
import type { WorkspaceFile } from '../shared/computer-types';
import { formatBytes } from '../shared/paths';
import { highlight } from './code-view';

/** The open file, editor-style: a tab with its name, then its lines, numbered and highlighted. */
export function CodeView({
  path,
  file,
  error,
  onClose,
}: {
  path: string | null;
  file?: WorkspaceFile;
  error: string;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const text = file && !file.binary ? (file.text ?? '') : null;
  useEffect(() => {
    setHtml(null);
    if (text === null || !path) return;
    let active = true;
    void highlight(text, path).then((next) => active && setHtml(next));
    return () => {
      active = false;
    };
  }, [text, path]);
  if (!path)
    return (
      <div className="code-editor empty">
        <p className="code-empty">Open a file from the tree.</p>
      </div>
    );
  const name = path.split('/').pop() ?? path;
  return (
    <div className="code-editor">
      <div className="code-tabs">
        <div className="code-tab" title={path}>
          <FileCode2 size={14} aria-hidden="true" />
          <span>{name}</span>
          <button
            className="icon-button"
            aria-label="Close file"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
        {file && <small className="code-size">{formatBytes(file.size)}</small>}
      </div>
      <div className="code-body" tabIndex={0} aria-label={`${name} contents`}>
        {error ? (
          <p className="code-empty failed">{error}</p>
        ) : !file ? (
          <p className="code-empty">Opening…</p>
        ) : file.binary ? (
          <p className="code-empty">
            {name} is a binary file ({formatBytes(file.size)}).
          </p>
        ) : html ? (
          <div
            className="code-lines"
            // Shiki's output: the file's text, escaped, in highlighted spans.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="code-lines">
            <pre className="shiki">
              <code>
                {(text ?? '').split('\n').map((line, index) => (
                  <span className="line" key={index}>
                    {line}
                    {'\n'}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        )}
        {file?.truncated && (
          <p className="code-empty">Showing the first 256 KB.</p>
        )}
      </div>
    </div>
  );
}

import {
  Ban,
  BookOpen,
  FilePen,
  FileSearch,
  FileText,
  FolderSearch,
  LoaderCircle,
  Search,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { openPageLink } from './page-navigation';
import { blockedReason } from './chat-errors';
import { folderRelative, formatBytes, shortPath } from '../shared/paths';
export type ToolRenderProps = {
  name: string;
  toolCallId: string;
  status: string;
  args?: unknown;
  result?: unknown;
};
export function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
const fields = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
/** ``→ 41 lines`` for multi-line output, the line itself when there is one. */
export function outputNote(output: string) {
  const lines = output.split('\n').filter((line) => line.trim());
  if (!lines.length) return '';
  if (lines.length > 1) return `${lines.length} lines`;
  return lines[0].length > 60 ? `${lines[0].slice(0, 57)}…` : lines[0];
}
export interface ToolView {
  icon: LucideIcon;
  verb: string;
  target: string;
  /** Shown after the target: a size, a count, or the command's output. */
  note?: string;
  /** Opens in the Files tab when the target is a file in the Dot's folder. */
  file?: string | null;
  /** A Space page the call created or edited. */
  link?: string;
  output?: string;
  problem?: string;
  denied?: boolean;
}
/** How one Claude Code tool call reads in the conversation. */
export function describeTool(
  name: string,
  args: unknown,
  result: unknown,
  directory: string,
): ToolView {
  const input = fields(args);
  const raw = parseJson(result);
  const data = fields(raw);
  const path = shortPath(
    text(input.file_path) || text(input.notebook_path) || text(input.path),
    directory,
  );
  const problem =
    data.denied === true
      ? text(data.reason) || 'Blocked by policy.'
      : text(data.error) || undefined;
  const base = { problem, denied: data.denied === true };
  switch (name) {
    case 'Bash': {
      const stdout =
        typeof raw === 'string' ? raw : text(data.stdout) || text(data.stderr);
      return {
        ...base,
        icon: Terminal,
        verb: 'Ran',
        target: shortPath(text(input.command), directory),
        note: problem ? undefined : outputNote(stdout),
        output: stdout || undefined,
      };
    }
    case 'Write':
      return {
        ...base,
        icon: FileText,
        verb: 'Saved file',
        target: path,
        note: formatBytes(new TextEncoder().encode(text(input.content)).length),
        file: folderRelative(path),
      };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return {
        ...base,
        icon: FilePen,
        verb: 'Edited file',
        target: path,
        file: folderRelative(path),
      };
    case 'Read':
      return {
        ...base,
        icon: FileSearch,
        verb: 'Read',
        target: path,
        file: folderRelative(path),
      };
    case 'Glob':
      return {
        ...base,
        icon: FolderSearch,
        verb: 'Listed',
        target: text(input.pattern),
      };
    case 'Grep':
      return {
        ...base,
        icon: Search,
        verb: 'Searched for',
        target: text(input.pattern),
      };
    case 'list_authorized_spaces':
      return {
        ...base,
        icon: BookOpen,
        verb: 'Checked your Spaces',
        target: '',
      };
    case 'list_space_pages':
      return {
        ...base,
        icon: BookOpen,
        verb: 'Listed pages',
        target: '',
        note: Array.isArray(raw) ? `${raw.length} found` : undefined,
      };
    case 'read_space_page':
      return {
        ...base,
        icon: BookOpen,
        verb: 'Read page',
        target: text(data.title) || text(input.id),
      };
    case 'create_space_page':
    case 'edit_space_page':
      return {
        ...base,
        icon: BookOpen,
        verb: name === 'create_space_page' ? 'Created page' : 'Edited page',
        target: text(data.title) || text(input.title),
        link: text(data.url) || undefined,
      };
    default:
      return { ...base, icon: Terminal, verb: `Used ${name}`, target: path };
  }
}
export function ToolRow({
  name,
  args,
  result,
  directory,
  running,
  onOpenFile,
  dotName = 'This Dot',
}: ToolRenderProps & {
  directory: string;
  running: boolean;
  onOpenFile?: (path: string) => void;
  /** Names the Dot in a blocked call's explanation ("Running commands is off for Dora"). */
  dotName?: string;
}) {
  const described = describeTool(name, args, result, directory);
  const view = described.denied
    ? { ...described, problem: blockedReason(described.problem, dotName) }
    : described;
  const done = result !== undefined && result !== null && result !== '';
  const Icon = view.denied ? Ban : !done && running ? LoaderCircle : view.icon;
  const target =
    view.file && onOpenFile ? (
      <button
        type="button"
        className="tool-target link"
        title="Open in Files"
        onClick={() => onOpenFile(view.file!)}
      >
        {view.target}
      </button>
    ) : view.link ? (
      <a
        className="tool-target link"
        href={view.link}
        onClick={(event) => {
          event.preventDefault();
          openPageLink(view.link!);
        }}
      >
        {view.target}
      </a>
    ) : view.target ? (
      <code className="tool-target">{view.target}</code>
    ) : null;
  const line = (
    <>
      <span className={`tool-icon ${!done && running ? 'spinning' : ''}`}>
        <Icon size={14} aria-hidden="true" />
      </span>
      <span className="tool-text">
        <span className="tool-verb">{view.verb}</span> {target}
        {done && view.note && !view.problem && (
          <span className="tool-note">
            {name === 'Bash' ? '→' : '·'} {view.note}
          </span>
        )}
        {!done && !running && (
          <span className="tool-note">· did not finish</span>
        )}
      </span>
    </>
  );
  return (
    <div
      className={`tool-row ${view.problem ? 'failed' : ''}`}
      aria-label={`${view.verb} ${view.target}`.trim()}
    >
      {view.output && done ? (
        <details>
          <summary>{line}</summary>
          <pre>{view.output.slice(0, 6000)}</pre>
        </details>
      ) : (
        <div className="tool-line">{line}</div>
      )}
      {view.problem && <p className="tool-problem">{view.problem}</p>}
    </div>
  );
}

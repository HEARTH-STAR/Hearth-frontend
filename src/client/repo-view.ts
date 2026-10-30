import type { Commit } from '../shared/repo-types';
import type {
  ApiChange,
  DetectionSummary,
  ImpactMatch,
  Watch,
} from '../shared/watch-types';
import { FIX_LABEL } from './watch-view';
// How the repo browser reads: its hash URLs, sizes and file types, commits by day, and the API diff of
// a watched repo grouped by resource and kind of change.

export const REPO_TABS = [
  'files',
  'code',
  'commits',
  'branches',
  'activity',
  'pulls',
  'diff',
] as const;
export type RepoTab = (typeof REPO_TABS)[number];

/**
 * Where the repo page stands: ``#/spaces/:id/repos/:owner/:name/:tab/...`` with the ref and a line in
 * the hash's query (``?ref=main&line=42``).
 */
export interface RepoRoute {
  spaceId: string;
  owner: string;
  name: string;
  tab: RepoTab;
  /** Files and Code: a folder or a file. */
  view?: 'tree' | 'blob';
  /** Files and Code: repo-relative, '' for the root. */
  path?: string;
  /** Commits: the open commit. */
  sha?: string;
  /** Pull requests: the detection whose PR is open. */
  detection?: string;
  /** A branch or sha; the default branch when left out. */
  ref?: string;
  /** A file's line to scroll to. */
  line?: number;
}

const NAME = /^[A-Za-z0-9_.-]+$/;
const decode = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
};
/** The repo page a location hash names, or undefined for any other hash. */
export function parseRepoHash(hash: string): RepoRoute | undefined {
  const raw = hash.replace(/^#/, '');
  const mark = raw.indexOf('?');
  const pathPart = mark < 0 ? raw : raw.slice(0, mark);
  const query = new URLSearchParams(mark < 0 ? '' : raw.slice(mark + 1));
  const parts = pathPart.split('/').map(decode);
  if (parts.some((part) => part === undefined)) return undefined;
  const [lead, spaces, spaceId, repos, owner, name, tab, ...rest] =
    parts as string[];
  if (lead !== '' || spaces !== 'spaces' || repos !== 'repos') return;
  if (!spaceId || !owner || !name || !NAME.test(owner) || !NAME.test(name))
    return;
  const route: RepoRoute = { spaceId, owner, name, tab: 'files' };
  if (tab) {
    if (!(REPO_TABS as readonly string[]).includes(tab)) return;
    route.tab = tab as RepoTab;
  }
  if (route.tab === 'files' || route.tab === 'code') {
    const [view, ...path] = rest;
    if (view === 'blob' && path.length) {
      route.view = 'blob';
      route.path = path.join('/');
    } else {
      route.view = 'tree';
      route.path = view === 'tree' ? path.filter(Boolean).join('/') : '';
    }
  } else if (route.tab === 'commits' && rest[0]) {
    if (/^[0-9a-f]{7,40}$/.test(rest[0])) route.sha = rest[0];
  } else if (route.tab === 'pulls' && rest[0]) route.detection = rest[0];
  const ref = query.get('ref');
  if (ref) route.ref = ref;
  const line = Number(query.get('line'));
  if (Number.isInteger(line) && line > 0) route.line = line;
  return route;
}

/** The hash for a repo page; the inverse of ``parseRepoHash``. */
export function repoHash(route: RepoRoute) {
  const parts = ['spaces', route.spaceId, 'repos', route.owner, route.name];
  const tail: string[] = [];
  if (route.tab === 'files' || route.tab === 'code') {
    const path = (route.path ?? '').split('/').filter(Boolean);
    if (route.view === 'blob' && path.length) tail.push('blob', ...path);
    else if (path.length) tail.push('tree', ...path);
  } else if (route.tab === 'commits' && route.sha) tail.push(route.sha);
  else if (route.tab === 'pulls' && route.detection) tail.push(route.detection);
  if (route.tab !== 'files' || tail.length) parts.push(route.tab, ...tail);
  const query = new URLSearchParams();
  if (route.ref) query.set('ref', route.ref);
  if (route.line) query.set('line', String(route.line));
  const search = query.toString();
  return `#/${parts.map(encodeURIComponent).join('/')}${search ? `?${search}` : ''}`;
}

/** A query string of the values that are set ('' when none is). */
export function repoQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** The repo page of a watch's ``owner/name``. */
export function repoHref(spaceId: string, repo: string) {
  const [owner, name] = repo.split('/');
  return repoHash({ spaceId, owner, name, tab: 'files' });
}

/** ``78 B``, ``1.4 KB``, ``12 MB``. */
export function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1024)
    return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${text.replace(/\.0$/, '')} ${units[unit]}`;
}

/** A file's type as its extension, upper-cased (``MD``, ``JSON``); ``FILE`` without one. */
export function fileType(name: string) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && dot < name.length - 1
    ? name.slice(dot + 1).toUpperCase()
    : 'FILE';
}

/** Up to two initials for an author's avatar. */
export function initials(author: string) {
  const words = author
    .replace(/\[bot\]$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.[0];
  return (letters ?? '?').toUpperCase();
}

/** ``Oct 30, 2026``, in the viewer's time zone. */
export const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Commits under the day they were made, newest first as given. */
export function commitsByDay(commits: Commit[]) {
  const days: { day: string; commits: Commit[] }[] = [];
  for (const commit of commits) {
    const day = dayLabel(commit.date);
    const last = days.at(-1);
    if (last?.day === day) last.commits.push(commit);
    else days.push({ day, commits: [commit] });
  }
  return days;
}

export type ChangeKind = 'breaking' | 'additive' | 'deprecated' | 'other';
export const CHANGE_KINDS: ChangeKind[] = [
  'breaking',
  'additive',
  'deprecated',
  'other',
];
export const KIND_LABEL: Record<ChangeKind, string> = {
  breaking: 'Breaking',
  additive: 'Additive',
  deprecated: 'Deprecated',
  other: 'Other',
};
const ADDITIVE = new Set([
  'added',
  'param_added_optional',
  'enum_values_added',
]);
/** Breaking (Hearth-Core says so), additive (new things, wider enums), deprecated, or other. */
export function changeKind(change: Pick<ApiChange, 'type' | 'breaking'>) {
  if (change.breaking) return 'breaking';
  if (change.type.includes('deprecat')) return 'deprecated';
  if (ADDITIVE.has(change.type) || change.type.endsWith('_added'))
    return 'additive';
  return 'other';
}

/** How many changes of each kind, for the change-mix bar. */
export function changeMix(changes: Pick<ApiChange, 'type' | 'breaking'>[]) {
  const mix: Record<ChangeKind, number> = {
    breaking: 0,
    additive: 0,
    deprecated: 0,
    other: 0,
  };
  for (const change of changes) mix[changeKind(change)]++;
  return mix;
}

const VERSION = /^(v\d+[a-z0-9._-]*|\d{4}-\d{2}-\d{2}|api)$/i;
/**
 * The API resource a change belongs to: an operation's first path segment that is not a version
 * (``POST /v1/payment_intents/{}/confirm`` → ``payment_intents``), ``Schemas`` for ``schema:Name``,
 * and for an SDK symbol (``stripe.Charges.create``) its owner (``stripe.Charges``).
 */
export function resourceOf(symbol: string) {
  if (/^schema:/i.test(symbol)) return 'Schemas';
  const operation = /^[A-Z]+\s+(\S+)/.exec(symbol);
  if (operation) {
    const segments = operation[1]
      .split('/')
      .filter((part) => part && !/^[{:]/.test(part));
    return segments.find((part) => !VERSION.test(part)) ?? '/';
  }
  const dotted = symbol.split('.');
  return dotted.length > 1 ? dotted.slice(0, -1).join('.') : symbol;
}

export interface ChangeGroup<T> {
  resource: string;
  changes: T[];
  breaking: number;
}
/** Changes by resource: groups with the most breaking changes first, then by name. */
export function groupChanges<T extends Pick<ApiChange, 'symbol' | 'breaking'>>(
  changes: T[],
) {
  const groups = new Map<string, ChangeGroup<T>>();
  for (const change of changes) {
    const resource = resourceOf(change.symbol);
    const group = groups.get(resource) ?? {
      resource,
      changes: [],
      breaking: 0,
    };
    group.changes.push(change);
    if (change.breaking) group.breaking++;
    groups.set(resource, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.breaking - a.breaking ||
      (a.resource === 'Schemas' ? 1 : 0) - (b.resource === 'Schemas' ? 1 : 0) ||
      a.resource.localeCompare(b.resource),
  );
}

/** A fix's call sites by file, each file's lines in order (one chip per line and symbol). */
export function impactByFile(impact: ImpactMatch[]) {
  const files = new Map<string, ImpactMatch[]>();
  for (const match of impact) {
    const list = files.get(match.path) ?? [];
    if (
      !list.some(
        (item) => item.line === match.line && item.symbol === match.symbol,
      )
    )
      list.push(match);
    files.set(match.path, list);
  }
  return [...files.entries()]
    .map(([path, matches]) => ({
      path,
      matches: matches.sort((a, b) => a.line - b.line),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** The watches of one ``owner/name``. */
export const watchesOf = (watches: Watch[], repo: string) =>
  watches.filter((watch) => sameRepo(watch.repo, repo));
/** The detections of those watches, newest first as Hearth-Core lists them. */
export function detectionsOf(watches: Watch[], detections: DetectionSummary[]) {
  const ids = new Set(watches.map((watch) => watch.id));
  return detections.filter((detection) => ids.has(detection.watch_id));
}
/** A breaking change still waiting on its fix to merge. */
export const openBreaking = (detection: DetectionSummary) =>
  detection.breaking_count > 0 &&
  detection.fix.status !== 'merged' &&
  detection.fix.status !== 'no_impact';

export type ActivityKind =
  | 'watch'
  | 'baseline'
  | 'unchanged'
  | 'changed'
  | 'error'
  | 'detection'
  | 'fix';
export interface ActivityItem {
  at: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  detection?: string;
}
const versions = (from: string | null, to: string | null) =>
  from && to && from !== to ? `${from} → ${to}` : (to ?? from ?? '');
/** A repo's API watch timeline: its watches' checks, detections and fixes, newest first. */
export function repoActivity(
  watches: Watch[],
  detections: DetectionSummary[],
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const watch of watches) {
    items.push({
      at: watch.created_at,
      kind: 'watch',
      title: `Started watching ${watch.name}`,
      detail: watch.spec_url,
    });
    for (const check of watch.history) {
      const version = versions(check.from_version, check.to_version);
      const titles = {
        baseline: `${watch.name}: baseline${version ? ` ${version}` : ''}`,
        unchanged: `${watch.name}: no change${version ? ` (${version})` : ''}`,
        changed: `${watch.name} ${version}: ${check.breaking}/${check.total} breaking`,
        error: `${watch.name}: check failed`,
      };
      items.push({
        at: check.at,
        kind: check.result,
        title: titles[check.result],
        ...(check.error ? { detail: check.error } : {}),
        ...(check.detection_id ? { detection: check.detection_id } : {}),
      });
    }
  }
  for (const detection of detectionsOf(watches, detections)) {
    const { fix } = detection;
    items.push({
      at: detection.detected_at,
      kind: 'detection',
      title: `${detection.provider} ${versions(detection.from_version, detection.to_version)}: ${detection.breaking_count} breaking change${detection.breaking_count === 1 ? '' : 's'}`,
      detail: detection.summary,
      detection: detection.id,
    });
    if (fix.status !== 'detected' && fix.updated_at !== detection.detected_at)
      items.push({
        at: fix.updated_at,
        kind: 'fix',
        title: `${detection.provider} fix: ${FIX_LABEL[fix.status]}`,
        ...(fix.pr
          ? { detail: `#${fix.pr.number} ${fix.pr.title}` }
          : fix.message
            ? { detail: fix.message }
            : {}),
        detection: detection.id,
      });
  }
  const time = (iso: string) => Date.parse(iso) || 0;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => time(b.item.at) - time(a.item.at) || a.index - b.index)
    .map(({ item }) => item);
}

import { AbstractAgent } from '@ag-ui/client';
import {
  EventType,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from '@ag-ui/core';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { pageReviewTool } from '../shared/page-review.js';
import { shortPath } from '../shared/paths.js';
import type { Dot, Settings, StoredSpace } from '../shared/types.js';
import type { WatchOverview } from '../shared/watch-types.js';
import type { HearthConfig } from './config.js';
import type {
  ChatSpec,
  ChatTool,
  CoreEvent,
  HearthCore,
} from './hearth-core.js';
import type { Page } from './pages.js';
import { pageAccess, pageTools, type PageTool } from './page-tools.js';
import type { Store } from './store.js';
import type { WorkspaceStore } from './workspace.js';

export interface HearthAgentDeps {
  store: Store;
  workspace: WorkspaceStore;
  /** The Hearth-Core in a Space's container; throws when that Space is not ready. */
  core: (spaceId: string) => Promise<HearthCore>;
  config: Pick<HearthConfig, 'model'>;
  /** The user who owns a Space, whose settings (name, paused) the Dot runs under. */
  ownerOf?: (spaceId: string) => Promise<string | undefined>;
}
/** Hearth-Core serves the web app's tools to Claude Code under this MCP prefix. */
const CLIENT_TOOL_PREFIX = 'mcp__client__';
const TURN_LIMITS = {
  max_turns: 30,
  wall_clock_seconds: 900,
  tool_result_timeout_seconds: 60,
};
export const ACTIVITY_EVENT = 'hearth.activity';

export function displayToolName(name: string) {
  return name.startsWith(CLIENT_TOOL_PREFIX)
    ? name.slice(CLIENT_TOOL_PREFIX.length)
    : name;
}
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) =>
      part &&
      typeof part === 'object' &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('\n');
}
/**
 * What is new in this run: the owner's answers to handoffs still open (``open``: tool call id →
 * tool name), then what they wrote since the agent last spoke. Claude Code keeps the conversation
 * itself (Hearth-Core resumes the session), so only this goes. CopilotKit files an answer right
 * after the call it answers, not at the end, so answers are found by id rather than by position.
 */
export function turnMessage(messages: Message[], open: Map<string, string>) {
  const parts: string[] = [];
  const answered: string[] = [];
  for (const message of messages)
    if (message.role === 'tool' && open.has(message.toolCallId)) {
      answered.push(message.toolCallId);
      parts.push(
        `The owner answered ${open.get(message.toolCallId)} (call ${message.toolCallId}):\n${message.content}`,
      );
    }
  const last = messages.findLastIndex(
    (message) => message.role === 'assistant',
  );
  const owner = messages
    .slice(last + 1)
    .filter((message) => message.role === 'user')
    .map((message) => textOf(message.content))
    .filter((text) => text.trim());
  parts.push(...owner);
  return { text: parts.join('\n\n'), owner: owner.join('\n\n'), answered };
}
/** One line for the sidebar, without Markdown marks. */
export function previewOf(text: string) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/**
 * How replies should be laid out. The app shows each section under a reply's top headings as a
 * card (client/reply-sections.ts), so structured answers read as cards in every conversation.
 */
export const REPLY_FORMAT =
  'Format replies in Markdown. The Hearth app shows each "## " section as a card. For anything longer than a few sentences, open with one or two plain sentences that answer directly, then give each part its own "## " heading with a short title, keeping each section focused. Use lists, tables and fenced code blocks (with a language) inside sections where they help. A short answer needs no headings.';
/**
 * The Space's API watch as the agent should know it: each watched repo with its APIs, where its code is
 * checked out (relative to the Dot's folder), and its breaking changes with their fix and pull request.
 * Undefined when Hearth-Core could not say (an older one, or not reachable): the prompt then leaves it out.
 */
export function apiWatchSection(
  overview: WatchOverview | undefined,
  directory: string,
): string | undefined {
  if (!overview) return undefined;
  const { watches, detections } = overview;
  if (!watches.length)
    return 'API watch: no repos are watched yet. The owner adds one from the API watch button (beside the computer button) by pasting a GitHub clone URL; Hearth then finds the APIs the repo uses and watches them.';
  const repos = [...new Set(watches.map((watch) => watch.repo))].sort();
  const lines = repos.map((repo) => {
    const own = watches.filter((watch) => watch.repo === repo);
    const branch = own.find((watch) => watch.base_branch)?.base_branch;
    const code = posix.relative(directory || '.', `repos/${repo}`);
    const apis = own
      .map(
        (watch) =>
          `${watch.name} (spec ${watch.status.spec_version ?? 'not read yet'}${watch.status.last_error ? `; last check failed: ${watch.status.last_error}` : ''})`,
      )
      .join(', ');
    const breaking = detections
      .filter((d) => own.some((watch) => watch.id === d.watch_id))
      .slice(0, 5)
      .map((d) => {
        const pr = d.fix.pr
          ? `PR #${d.fix.pr.number} ${d.fix.pr.state} (${d.fix.pr.url})`
          : `fix ${d.fix.status}${d.fix.message ? `: ${d.fix.message}` : ''}`;
        return `\n  - ${d.provider} ${d.from_version} -> ${d.to_version}: ${d.breaking_count} breaking of ${d.total_count} changes (${d.summary.slice(0, 200)}); ${pr}`;
      })
      .join('');
    return `- ${repo} (branch ${branch ?? 'default'}; code checked out at ${code}): watching ${apis}.${breaking || ' No breaking changes so far.'}`;
  });
  return [
    'API watch, live: this Space watches the APIs these GitHub repos use.',
    ...lines,
    "Read a watched repo's code at its path when the owner asks about it. Do not edit files there: Hearth refreshes those copies, and fixes reach a repo only as Hearth's pull requests. Point the owner to the API watch screen to review, comment on or merge a pull request.",
  ].join('\n');
}
export function systemPrompt(input: {
  dot: Dot;
  settings: Settings;
  spaces: Pick<StoredSpace, 'id' | 'name'>[];
  page?: Page;
  review: boolean;
  /** `apiWatchSection` for this turn, when Hearth-Core answered. */
  watch?: string;
}) {
  const { dot, settings, spaces, page, review, watch } = input;
  return [
    `You are ${dot.name}: an assistant (a "Dot") in ${settings.name}'s Hearth workspace.`,
    `Role instructions from the owner: ${dot.instructions}`,
    REPLY_FORMAT,
    watch ?? '',
    `Spaces hold the owner's pages. You may use: ${spaces.map((space) => `${space.name} (id ${space.id})`).join(', ') || 'none'}. Save new pages to ${spaces.find((space) => space.id === dot.spaceId)?.name ?? 'your default Space'} (id ${dot.spaceId}) unless asked otherwise.`,
    review
      ? 'When the owner wants to see a draft before it is saved, call review_space_page once and end your turn; it saves the page only if they approve. After approval, link the page with Markdown using the url from their answer.'
      : '',
    page
      ? `This conversation is about the page "${page.title}" (id ${page.id}, Space ${page.spaceId}). Read it with read_space_page before you edit it.`
      : '',
    `Current time: ${new Date().toISOString()} (UTC).`,
  ]
    .filter(Boolean)
    .join('\n');
}
/** The Space's API watch for the system prompt; undefined after 3 s or on any error (the turn goes on). */
async function watchOverview(core: HearthCore) {
  try {
    const answer = await Promise.race([
      core.watchOverview(),
      new Promise<undefined>((resolve) => setTimeout(resolve, 3000)),
    ]);
    return answer?.body;
  } catch {
    return undefined;
  }
}
/** A short label for a tool call: the command it ran or the file it touched. */
export function toolSummary(
  tool: string,
  input: Record<string, unknown>,
  directory: string,
) {
  const value = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string) : '';
  const raw =
    tool === 'Bash'
      ? value('command')
      : value('file_path') ||
        value('notebook_path') ||
        value('path') ||
        value('pattern') ||
        value('title') ||
        value('id');
  return shortPath(raw, directory);
}
type Emit = (event: Record<string, unknown> & { type: EventType }) => void;
export class HearthAgent extends AbstractAgent {
  private controller?: AbortController;
  constructor(
    private deps: HearthAgentDeps,
    private dotId: string,
  ) {
    super({ agentId: dotId });
  }
  clone() {
    return new HearthAgent(this.deps, this.dotId);
  }
  abortRun() {
    this.controller?.abort();
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const controller = new AbortController();
      this.controller = controller;
      let open = true;
      const emit: Emit = (event) => {
        if (open) subscriber.next(event as unknown as BaseEvent);
      };
      void this.turn(input, controller, emit).finally(() => {
        if (open) subscriber.complete();
      });
      return () => {
        open = false;
        controller.abort();
      };
    });
  }
  private async turn(
    input: RunAgentInput,
    controller: AbortController,
    emit: Emit,
  ) {
    const { store, workspace, config } = this.deps;
    const { threadId, runId } = input;
    emit({ type: EventType.RUN_STARTED, threadId, runId });
    const resolved = new Set<string>();
    const handoffs = new Set<string>();
    const activity = new Map<string, string>();
    const assistant: string[] = [];
    let preview = '';
    let paused = false;
    let watcher: ReturnType<typeof setInterval> | undefined;
    // The text message being streamed from partial tokens, if any.
    let text: { id: string; streamed: string } | undefined;
    const appendText = (delta: string) => {
      if (!delta) return;
      if (!text) {
        text = { id: randomUUID(), streamed: '' };
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId: text.id,
          role: 'assistant',
        });
      }
      text.streamed += delta;
      emit({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: text.id,
        delta,
      });
    };
    /** Ends the streamed message; text that never got its full token is kept as it streamed. */
    const closeText = (complete = false) => {
      if (!text) return;
      emit({ type: EventType.TEXT_MESSAGE_END, messageId: text.id });
      if (!complete && text.streamed.trim()) {
        assistant.push(text.streamed);
        preview = text.streamed;
      }
      text = undefined;
    };
    const result = (toolCallId: string, content: string) => {
      resolved.add(toolCallId);
      emit({
        type: EventType.TOOL_CALL_RESULT,
        messageId: randomUUID(),
        toolCallId,
        content,
        role: 'tool',
      });
    };
    try {
      const dot = workspace.dot(this.dotId);
      if (!dot) throw new Error('This Dot no longer exists.');
      workspace.requireThread(threadId, dot.id);
      const owner = await this.deps.ownerOf?.(dot.spaceId);
      const settings = store.settings(owner);
      if (settings.paused)
        throw new Error('All Dots are paused. Resume them to continue.');
      // The Dot runs in its home Space's container.
      const core = await this.deps.core(dot.spaceId);
      const turn = turnMessage(
        input.messages,
        workspace.openHandoffs(threadId),
      );
      if (!turn.text.trim())
        throw new Error('There is no new message to send.');
      workspace.appendTranscript(threadId, 'user', turn.owner);
      const check = () => {
        if (controller.signal.aborted)
          throw new Error('This turn was stopped.');
      };
      const access = pageAccess(workspace, dot.spaceId, threadId, check);
      const serverTools = new Map<string, PageTool>(
        pageTools(access).map((tool) => [tool.name, tool]),
      );
      const review = input.tools.some(
        (tool) => tool.name === pageReviewTool.name,
      );
      const tools: ChatTool[] = [...serverTools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: jsonSchema(tool.parameters),
      }));
      if (review)
        tools.push({
          name: pageReviewTool.name,
          description: pageReviewTool.description,
          input_schema: jsonSchema(pageReviewTool.parameters),
          handoff: true,
        });
      const spec: ChatSpec = {
        session: threadId,
        message: turn.text,
        system: systemPrompt({
          dot,
          settings,
          spaces: access.spaces(),
          page: access.context(),
          review,
          watch: apiWatchSection(await watchOverview(core), dot.directory),
        }),
        directory: dot.directory,
        permissions: workspace.computers.permissions(dot.id),
        tools,
        limits: TURN_LIMITS,
        ...(config.model ? { model: config.model } : {}),
      };
      watcher = setInterval(() => {
        if (store.settings(owner).paused) {
          paused = true;
          controller.abort();
        }
      }, 500);
      let done = false;
      let started = false;
      const errors: string[] = [];
      for await (const event of core.chat(spec, controller.signal)) {
        if (!started) {
          // Hearth-Core took the turn, so the answers in it are delivered.
          started = true;
          workspace.answerHandoffs(threadId, turn.answered);
        }
        if (isDone(event)) {
          closeText();
          done = true;
          continue;
        }
        // Text streams until the block's full token; anything but text or a label ends it.
        if (event.type !== 'token' && event.type !== 'model-loading')
          closeText();
        switch (event.type) {
          case 'token': {
            if (event.partial) {
              appendText(event.token);
              break;
            }
            // The full token is the block's authoritative text: add what did not stream, then close.
            const streamed = text?.streamed ?? '';
            if (event.token.startsWith(streamed))
              appendText(event.token.slice(streamed.length));
            closeText(true);
            assistant.push(event.token);
            preview = event.token;
            break;
          }
          case 'model-loading':
            emit({
              type: EventType.CUSTOM,
              name: ACTIVITY_EVENT,
              value: { label: event.label },
            });
            break;
          case 'tool-call': {
            const toolCallId = event.tool_use_id ?? randomUUID();
            const name = displayToolName(event.tool);
            emit({
              type: EventType.TOOL_CALL_START,
              toolCallId,
              toolCallName: name,
              parentMessageId: randomUUID(),
            });
            emit({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId,
              delta: JSON.stringify(event.input ?? {}),
            });
            emit({ type: EventType.TOOL_CALL_END, toolCallId });
            if (name === pageReviewTool.name) {
              handoffs.add(toolCallId);
              workspace.openHandoff(threadId, toolCallId, name);
              preview = `Waiting for your review: ${String(event.input?.title ?? 'draft')}`;
              break;
            }
            const summary = toolSummary(name, event.input ?? {}, dot.directory);
            activity.set(
              toolCallId,
              workspace.computers.begin(dot.id, threadId, name, summary),
            );
            const server = serverTools.get(name);
            if (server) {
              const { output, isError } = await runServerTool(
                server,
                event.input,
              );
              await core.toolResult(
                threadId,
                toolCallId,
                output,
                isError,
                controller.signal,
              );
              result(toolCallId, output);
              workspace.computers.finish(
                activity.get(toolCallId)!,
                isError ? 'failed' : 'succeeded',
                output,
              );
            }
            break;
          }
          case 'tool-result': {
            const id = event.tool_use_id;
            if (!id || resolved.has(id) || handoffs.has(id)) break;
            result(id, event.output);
            const entry = activity.get(id);
            if (entry)
              workspace.computers.finish(entry, 'succeeded', event.output);
            break;
          }
          case 'policy-denied': {
            const id = event.tool_use_id;
            if (!id || resolved.has(id)) break;
            result(id, JSON.stringify({ denied: true, reason: event.reason }));
            const entry = activity.get(id);
            if (entry)
              workspace.computers.finish(entry, 'denied', event.reason);
            break;
          }
          case 'error':
            errors.push(event.error);
            break;
        }
      }
      closeText();
      // Claude Code reports only successful tools; a call that never reported back failed.
      for (const [id, entry] of activity)
        if (!resolved.has(id)) {
          result(id, JSON.stringify({ error: 'The tool did not finish.' }));
          workspace.computers.settle([entry], 'The tool did not finish.');
        }
      if (!done && !errors.length)
        errors.push('Hearth-Core ended the turn before it finished.');
      if (errors.length) throw new Error(errors.join(' '));
      emit({ type: EventType.RUN_FINISHED, threadId, runId });
    } catch (error) {
      closeText();
      for (const [id, entry] of activity)
        if (!resolved.has(id)) {
          resolved.add(id);
          workspace.computers.settle([entry], 'The turn stopped first.');
        }
      // The owner pressed Stop: what streamed so far stays, and the turn simply ends.
      if (controller.signal.aborted && !paused)
        emit({ type: EventType.RUN_FINISHED, threadId, runId });
      else
        emit({
          type: EventType.RUN_ERROR,
          message: paused
            ? 'All Dots were paused, so this turn stopped.'
            : error instanceof Error
              ? error.message
              : 'This turn could not finish.',
        });
    } finally {
      clearInterval(watcher);
      if (assistant.length)
        workspace.appendTranscript(
          threadId,
          'assistant',
          assistant.join('\n\n'),
        );
      if (preview)
        try {
          workspace.touchThread(threadId, previewOf(preview));
        } catch {
          // The conversation may have been removed while this turn ran.
        }
    }
  }
}
function isDone(event: CoreEvent): event is Extract<CoreEvent, { done: true }> {
  return 'done' in event && event.done === true;
}
function jsonSchema(schema: unknown): Record<string, unknown> {
  const value =
    schema instanceof z.ZodType
      ? (z.toJSONSchema(schema) as Record<string, unknown>)
      : { ...(schema as Record<string, unknown>) };
  delete value.$schema;
  return value;
}
async function runServerTool(tool: PageTool, input: unknown) {
  try {
    const parsed = tool.parameters.parse(input ?? {});
    const output = await tool.execute(parsed as never);
    return { output: JSON.stringify(output ?? null), isError: false };
  } catch (error) {
    return {
      output:
        error instanceof z.ZodError
          ? `Invalid input: ${error.issues.map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`).join('; ')}`
          : error instanceof Error
            ? error.message
            : 'The tool failed.',
      isError: true,
    };
  }
}

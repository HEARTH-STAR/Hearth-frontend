import type { BaseEvent, Message, RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { afterEach, expect, it } from 'vitest';
import {
  HearthAgent,
  systemPrompt,
  toolSummary,
  turnMessage,
} from '../src/server/hearth-agent.js';
import { HearthCore, type CoreEvent } from '../src/server/hearth-core.js';
import { SpaceNotReady } from '../src/server/space-service.js';
import { pageReviewTool } from '../src/shared/page-review.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { fakeFetch, sse } from './helpers.js';
const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((item) => item.close()));
function setup(
  events: CoreEvent[] | ((spec: Record<string, unknown>) => CoreEvent[]),
) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  open.push(store, workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread-1', dot.id, 'Launch notes');
  const core = fakeFetch({
    'POST /api/chat': async (request) => {
      const spec = (await request.json()) as Record<string, unknown>;
      return sse(typeof events === 'function' ? events(spec) : events);
    },
    'POST /api/chat/thread-1/tool-results': () => Response.json({ ok: true }),
  });
  const agent = new HearthAgent(
    {
      store,
      workspace,
      core: async () => new HearthCore('http://core.test', core.fetch),
      config: {},
    },
    dot.id,
  );
  return { store, workspace, dot, core, agent };
}
const input = (
  messages: Message[],
  tools: RunAgentInput['tools'] = [],
): RunAgentInput => ({
  threadId: 'thread-1',
  runId: 'run-1',
  messages,
  tools,
  context: [],
  state: {},
  forwardedProps: {},
});
const run = (agent: HearthAgent, value: RunAgentInput) =>
  lastValueFrom(agent.run(value).pipe(toArray())) as Promise<
    (BaseEvent & Record<string, unknown>)[]
  >;
const reviewTool = {
  name: pageReviewTool.name,
  description: pageReviewTool.description,
  parameters: pageReviewTool.parameters,
};
const done: CoreEvent = { done: true, native_session_id: 'n1', result: {} };

// CopilotKit files the owner's answer right after the call it answers, before the agent's later text.
const answeredReview: Message[] = [
  { id: 'u1', role: 'user', content: 'Draft notes' },
  {
    id: 'a1',
    role: 'assistant',
    toolCalls: [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'review_space_page', arguments: '{}' },
      },
    ],
  },
  {
    id: 't1',
    role: 'tool',
    toolCallId: 'call-1',
    content: '{"approved":true}',
  },
  { id: 's1', role: 'tool', toolCallId: 'call-0', content: 'server result' },
  { id: 'a2', role: 'assistant', content: 'The draft is ready for review.' },
];
it('sends open handoff answers wherever they sit, then what the owner wrote since', () => {
  const open = new Map([['call-1', 'review_space_page']]);
  const turn = turnMessage(answeredReview, open);
  expect(turn.text).toBe(
    'The owner answered review_space_page (call call-1):\n{"approved":true}',
  );
  expect(turn.answered).toEqual(['call-1']);
  const next = turnMessage(
    [
      ...answeredReview,
      { id: 'u2', role: 'user', content: [{ type: 'text', text: 'Thanks!' }] },
    ],
    new Map(),
  );
  expect(next).toEqual({ text: 'Thanks!', owner: 'Thanks!', answered: [] });
  expect(turnMessage(answeredReview, new Map()).text).toBe('');
});
it('continues after the owner approves a review, once', async () => {
  let message = '';
  const { agent, workspace } = setup((spec) => {
    message = String(spec.message);
    return [
      { type: 'token', token: 'Saved: [Notes](/#/spaces/s/pages/p)' },
      done,
    ];
  });
  workspace.openHandoff('thread-1', 'call-1', 'review_space_page');
  const events = await run(agent, input(answeredReview, [reviewTool]));
  expect(events.at(-1)?.type).toBe('RUN_FINISHED');
  expect(message).toContain('The owner answered review_space_page');
  expect(workspace.openHandoffs('thread-1').size).toBe(0);
  expect(workspace.conversations()[0].preview).toBe('Saved: Notes');
  const again = await run(agent, input(answeredReview, [reviewTool]));
  expect(again.at(-1)).toMatchObject({
    type: 'RUN_ERROR',
    message: 'There is no new message to send.',
  });
});
it('describes the Dot and names its Spaces', () => {
  const workspace = new WorkspaceStore(':memory:', 'owner');
  open.push(workspace);
  const dot = workspace.dots()[0];
  const prompt = systemPrompt({
    dot,
    settings: { name: 'Sam', paused: false },
    spaces: workspace.spaces(),
    review: true,
  });
  expect(prompt).toContain(
    'You are Scout: an assistant (a "Dot") in Sam\'s Hearth workspace.',
  );
  expect(prompt).toContain(`Scout (id ${dot.spaceId})`);
  expect(prompt).toContain('review_space_page');
  expect(
    systemPrompt({
      dot,
      settings: { name: 'Sam', paused: false },
      spaces: [],
      review: false,
    }),
  ).not.toContain('review_space_page');
  expect(
    toolSummary(
      'Bash',
      { command: `wc -l /workspace/${dot.directory}/notes.md` },
      dot.directory,
    ),
  ).toBe('wc -l ~/notes.md');
});
it('maps a Hearth-Core turn onto AG-UI events and runs the web app tools', async () => {
  const { agent, core, workspace, dot } = setup((spec) => {
    expect(spec).toMatchObject({
      session: 'thread-1',
      message: 'Save notes on the Acme SDK',
      directory: dot.directory,
      permissions: { files: true, shell: false },
      limits: { max_turns: 30 },
    });
    const tools = spec.tools as {
      name: string;
      handoff?: boolean;
      input_schema: Record<string, unknown>;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_authorized_spaces',
      'list_space_pages',
      'read_space_page',
      'create_space_page',
      'edit_space_page',
      'review_space_page',
    ]);
    expect(tools.at(-1)?.handoff).toBe(true);
    expect(tools[1].input_schema.$schema).toBeUndefined();
    return [
      { type: 'session_id', session_id: 'n1' },
      { type: 'model-loading', label: 'running command' },
      { type: 'token', token: 'Opening it on my computer.' },
      {
        type: 'tool-call',
        tool: 'Bash',
        tool_use_id: 'b1',
        input: { command: 'wc -l notes.md' },
      },
      {
        type: 'tool-result',
        tool: 'Bash',
        tool_use_id: 'b1',
        output: '{"stdout":"41 notes.md"}',
      },
      {
        type: 'tool-call',
        tool: 'mcp__client__list_space_pages',
        tool_use_id: 'p1',
        input: {},
      },
      {
        type: 'tool-result',
        tool: 'mcp__client__list_space_pages',
        tool_use_id: 'p1',
        output: 'ignored duplicate',
      },
      {
        type: 'tool-call',
        tool: 'Write',
        tool_use_id: 'w1',
        input: { file_path: '/etc/x' },
      },
      {
        type: 'policy-denied',
        tool: 'Write',
        tool_use_id: 'w1',
        input: {},
        reason: 'path escapes the workspace',
      },
      {
        type: 'tool-call',
        tool: 'mcp__client__review_space_page',
        tool_use_id: 'r1',
        input: { title: 'Acme notes', content: 'Body', spaceId: dot.spaceId },
      },
      {
        type: 'tool-result',
        tool: 'mcp__client__review_space_page',
        tool_use_id: 'r1',
        output: 'ack',
      },
      { type: 'token', token: 'Here is the draft.' },
      done,
    ];
  });
  workspace.pages.create(dot.spaceId, { title: 'Launch brief' });
  const events = await run(
    agent,
    input(
      [{ id: 'u1', role: 'user', content: 'Save notes on the Acme SDK' }],
      [reviewTool],
    ),
  );
  const types = events.map((event) => event.type);
  expect(types[0]).toBe('RUN_STARTED');
  expect(types.at(-1)).toBe('RUN_FINISHED');
  expect(events.find((e) => e.type === 'CUSTOM')).toMatchObject({
    name: 'hearth.activity',
    value: { label: 'running command' },
  });
  const starts = events.filter((e) => e.type === 'TOOL_CALL_START');
  expect(starts.map((e) => e.toolCallName)).toEqual([
    'Bash',
    'list_space_pages',
    'Write',
    'review_space_page',
  ]);
  const results = events.filter((e) => e.type === 'TOOL_CALL_RESULT');
  expect(results.map((e) => e.toolCallId)).toEqual(['b1', 'p1', 'w1']);
  expect(JSON.parse(String(results[1].content))[0]).toMatchObject({
    spaceId: dot.spaceId,
    title: 'Launch brief',
  });
  expect(JSON.parse(String(results[2].content))).toEqual({
    denied: true,
    reason: 'path escapes the workspace',
  });
  // the page tool's result went back to Hearth-Core for the waiting agent
  const posted = core.calls.find(
    (call) => call.path === '/api/chat/thread-1/tool-results',
  );
  expect(posted?.body).toMatchObject({ tool_use_id: 'p1', is_error: false });
  expect(
    events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').map((e) => e.delta),
  ).toEqual(['Opening it on my computer.', 'Here is the draft.']);
  const activity = workspace.computers.activity(dot.id);
  expect(activity.map((entry) => [entry.tool, entry.outcome])).toEqual(
    expect.arrayContaining([
      ['Bash', 'succeeded'],
      ['list_space_pages', 'succeeded'],
      ['Write', 'denied'],
    ]),
  );
  expect(workspace.transcript('thread-1').map((entry) => entry.role)).toEqual([
    'user',
    'assistant',
  ]);
  expect(workspace.conversations()[0].preview).toBe('Here is the draft.');
});
it('reports Hearth-Core errors and calls that never finished', async () => {
  const { agent, workspace, dot } = setup([
    {
      type: 'tool-call',
      tool: 'Bash',
      tool_use_id: 'b1',
      input: { command: 'pytest' },
    },
    { type: 'error', error: 'token budget exhausted' },
    done,
  ]);
  const events = await run(
    agent,
    input([{ id: 'u1', role: 'user', content: 'Run the tests' }]),
  );
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_ERROR',
    message: 'token budget exhausted',
  });
  expect(events.find((e) => e.type === 'TOOL_CALL_RESULT')).toMatchObject({
    toolCallId: 'b1',
  });
  expect(workspace.computers.activity(dot.id)[0].outcome).toBe('failed');
});
it('runs in the home Space’s container, and says so when it is not ready', async () => {
  const { store, workspace, dot } = setup([done]);
  const asked: string[] = [];
  const agent = new HearthAgent(
    {
      store,
      workspace,
      config: {},
      core: async (spaceId) => {
        asked.push(spaceId);
        throw new SpaceNotReady(
          '“Scout” has no container yet. Start it from its Setup page.',
          'none',
        );
      },
    },
    dot.id,
  );
  const events = await run(
    agent,
    input([{ id: 'u1', role: 'user', content: 'Hello' }]),
  );
  expect(asked).toEqual([dot.spaceId]);
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_ERROR',
    message: '“Scout” has no container yet. Start it from its Setup page.',
  });
  // nothing was sent, so nothing waits in the transcript as delivered
  expect(workspace.transcript('thread-1')).toEqual([]);
});
it('refuses to start while paused, for an unknown thread, or with nothing new', async () => {
  const { agent, store, core } = setup([done]);
  store.updateSettings({ paused: true });
  expect(
    (await run(agent, input([{ id: 'u', role: 'user', content: 'Hi' }]))).at(
      -1,
    ),
  ).toMatchObject({
    type: 'RUN_ERROR',
    message: 'All Dots are paused. Resume them to continue.',
  });
  store.updateSettings({ paused: false });
  expect(
    (
      await run(agent, {
        ...input([{ id: 'u', role: 'user', content: 'Hi' }]),
        threadId: 'foreign',
      })
    ).at(-1),
  ).toMatchObject({ type: 'RUN_ERROR' });
  expect(
    (
      await run(
        agent,
        input([{ id: 'a', role: 'assistant', content: 'Hello' }]),
      )
    ).at(-1),
  ).toMatchObject({
    type: 'RUN_ERROR',
    message: 'There is no new message to send.',
  });
  expect(core.calls.filter((call) => call.path === '/api/chat')).toHaveLength(
    0,
  );
});
it('treats a stream that ends without done as an error', async () => {
  const { agent } = setup([{ type: 'token', token: 'partial' }]);
  const events = await run(
    agent,
    input([{ id: 'u', role: 'user', content: 'Hi' }]),
  );
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_ERROR',
    message: 'Hearth-Core ended the turn before it finished.',
  });
});
const texts = (events: (BaseEvent & Record<string, unknown>)[]) => {
  const messages = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'TEXT_MESSAGE_START')
      messages.set(String(event.messageId), '');
    if (event.type === 'TEXT_MESSAGE_CONTENT')
      messages.set(
        String(event.messageId),
        messages.get(String(event.messageId)) + String(event.delta),
      );
  }
  return [...messages.values()];
};
it('streams text as it is written and does not repeat it when the full block arrives', async () => {
  const { agent, workspace } = setup([
    { type: 'token', token: 'Opening ', partial: true },
    { type: 'model-loading', label: 'thinking', partial: true },
    { type: 'token', token: 'it.', partial: true },
    { type: 'token', token: 'Opening it.' },
    { type: 'tool-call', tool: 'Read', tool_use_id: 'r1', input: {} },
    { type: 'tool-result', tool: 'Read', tool_use_id: 'r1', output: 'text' },
    { type: 'token', token: 'Here', partial: true },
    { type: 'token', token: 'Here is more.' },
    { type: 'token', token: 'Unstreamed block.' },
    done,
  ]);
  const events = await run(
    agent,
    input([{ id: 'u', role: 'user', content: 'Open it' }]),
  );
  expect(events.at(-1)?.type).toBe('RUN_FINISHED');
  expect(texts(events)).toEqual([
    'Opening it.',
    'Here is more.',
    'Unstreamed block.',
  ]);
  const starts = events.filter((e) => e.type === 'TEXT_MESSAGE_START').length;
  const ends = events.filter((e) => e.type === 'TEXT_MESSAGE_END').length;
  expect([starts, ends]).toEqual([3, 3]);
  expect(workspace.transcript('thread-1').at(-1)?.text).toBe(
    'Opening it.\n\nHere is more.\n\nUnstreamed block.',
  );
});
it('ends the turn quietly when the owner stops it, keeping what streamed', async () => {
  const { agent, workspace } = setup([]);
  const encoder = new TextEncoder();
  const stuck = new HearthAgent(
    {
      store: new Store(':memory:'),
      workspace,
      config: {},
      core: async () =>
        new HearthCore('http://core.test', (async (
          info: RequestInfo | URL,
          init?: RequestInit,
        ) => {
          const signal = new Request(info, init).signal;
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'token', token: 'Half a thou', partial: true })}\n\n`,
                  ),
                );
                signal.addEventListener('abort', () =>
                  controller.error(new DOMException('Aborted', 'AbortError')),
                );
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          );
        }) as typeof fetch),
    },
    workspace.dots()[0].id,
  );
  void agent;
  const events: (BaseEvent & Record<string, unknown>)[] = [];
  await new Promise<void>((resolve) =>
    stuck.run(input([{ id: 'u', role: 'user', content: 'Think' }])).subscribe({
      next: (event) => {
        events.push(event as BaseEvent & Record<string, unknown>);
        if (event.type === 'TEXT_MESSAGE_CONTENT') stuck.abortRun();
      },
      complete: resolve,
    }),
  );
  expect(events.map((e) => e.type).slice(-2)).toEqual([
    'TEXT_MESSAGE_END',
    'RUN_FINISHED',
  ]);
  expect(workspace.transcript('thread-1').at(-1)?.text).toBe('Half a thou');
});

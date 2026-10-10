# Hearth-frontend

The Hearth web app: Spaces for your pages, and Dots, assistants that each have their own
computer. Every conversation runs on **Claude Code through [Hearth-Core](../Hearth-Core)**, and
each Dot's container comes from **[Hearth-backend](../Hearth-backend)**.

Forked from [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots) (MIT). The CopilotKit
React SDK and runtime and AG-UI are kept; OpenDots' model, conversation and computer services
are replaced with the Hearth ones. The Files tab renders each Dot's folder with
[trees.software](https://trees.software/) (`@pierre/trees`).

## Requirements

- Node.js 24 and npm
- Hearth-Core running (`../Hearth-Core`, `./hearth-core.sh dev`, default `http://127.0.0.1:5010`)
  with a Claude login or an Anthropic key, as its README describes
- Optional: Hearth-backend (`../Hearth-backend`, `./hearth-backend.sh serve`, default
  `http://127.0.0.1:5020`) and Docker, for "Spin up container"

## Quick start

```bash
npm ci
cp .env.example .env
npm run dev            # API on 127.0.0.1:4310, app on http://127.0.0.1:5173
```

Production: `npm run build && npm start` serves everything on `http://127.0.0.1:4310`.

The app opens on the first Dot, Scout. Settings shows whether Hearth-Core and Hearth-backend
answer. While Hearth-Core is down, a banner says so and Dots cannot run.

## What is where

| Surface                     | What it shows                                                                                                                            | Backed by                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Sidebar                     | Search, Spaces with page counts, Dots with their latest conversation, Memory, Settings                                                   | this server's SQLite                            |
| Conversation                | Your messages, Claude Code's replies, one row per tool call ("Saved file ~/notes/a.md · 2.1 KB", "Ran wc -l … → 41 lines"), review cards | Hearth-Core `POST /api/chat`                    |
| Review before saving        | A draft with **Approve & save** / **Decline**; only approval saves the page                                                              | CopilotKit human-in-the-loop                    |
| Computer: Files             | The Dot's folder as a tree (`@pierre/trees`); click a file to read it                                                                    | Hearth-Core `/api/workspace/*`                  |
| Computer: Terminal          | Commands the Dot ran and their output                                                                                                    | recorded from the chat stream                   |
| Computer: Activity          | Every tool call, with its outcome (succeeded, failed, denied)                                                                            | recorded from the chat stream                   |
| Computer: Spin up container | A container for the Dot from a template                                                                                                  | Hearth-backend `POST /api/containers`           |
| Permissions                 | Files (edits), Shell (Bash), Memory                                                                                                      | sent with every turn; Hearth-Core enforces them |

## How a turn runs

1. The browser sends the message to the CopilotKit runtime (`/api/copilotkit`, AG-UI over SSE).
2. The Dot's `HearthAgent` (`src/server/hearth-agent.ts`) sends Hearth-Core one `ChatSpec`: the
   message, the Dot's persona and Spaces, its folder (`dots/<name>-<id>`), its permissions, and
   the page tools this server runs (list, read, create, edit pages; `review_space_page`).
3. Hearth-Core runs Claude Code in that folder, under its policy hook, and streams events back.
   The agent turns them into AG-UI events: text, tool calls and their results.
4. When Claude Code calls a page tool, this server runs it against its own database and posts the
   result back to Hearth-Core, which hands it to the waiting agent.
5. `review_space_page` hands the decision to you: the turn ends with the review card, and your
   answer goes to Claude Code as the next turn of the same session.

Conversation history is stored by `@copilotkit/sqlite-runner`. Claude Code keeps its own session
in Hearth-Core, so each turn sends only what is new.

## Configuration

Every variable is documented in `.env.example`. The ones that matter:

| Variable                    | Default                  | Meaning                                                 |
| --------------------------- | ------------------------ | ------------------------------------------------------- |
| `HEARTH_CORE_URL`           | `http://127.0.0.1:5010`  | Hearth-Core                                             |
| `HEARTH_MODEL`              | Hearth-Core's default    | Model for conversations                                 |
| `HEARTH_BACKEND_URL`        | `http://127.0.0.1:5020`  | Hearth-backend                                          |
| `HEARTH_BACKEND_TOKEN`      | none                     | Bearer token when Hearth-backend has `HEARTH_API_TOKEN` |
| `HEARTH_CONTAINER_TEMPLATE` | Hearth-backend's default | Template for "Spin up container"                        |
| `HOST`, `PORT`              | `127.0.0.1`, `4310`      | Where this server listens                               |
| `OWNER_TOKEN`               | none                     | Required (24+ characters) to listen beyond loopback     |
| `DATABASE_PATH`             | `data/hearth.sqlite`     | App data                                                |

## Layout

```
src/server/
  index.ts               server entry: config, stores, Platform, static files
  app.ts                 /api guards (host, origin, owner token, JSON), settings, memories
  platform.ts            CopilotKit runtime (SSE, SQLite runner), one HearthAgent per Dot
  hearth-agent.ts        AG-UI agent ⇄ Hearth-Core chat turn
  hearth-core.ts         Hearth-Core client (chat SSE, tool results, workspace files)
  hearth-backend.ts      Hearth-backend client (Docker status, container spin-up)
  service-status.ts      whether both services answer (cached briefly)
  computer-*.ts          a Dot's computer: folder, permissions, activity, container
  workspace*.ts          Spaces, Dots, conversations, transcripts, review handoffs
  page*.ts               pages, page conversations, page tools
  runtime-scope.ts       which runtime routes, Dots and conversations a request may use
src/client/              React app (App, Sidebar, Chat, ToolRow, ComputerPanel, FileTreeView, …)
src/shared/              types shared by both sides
tests/                   vitest; Hearth-Core and Hearth-backend are faked (tests/helpers.ts)
```

## Development

```bash
npm test               # vitest
npm run typecheck
npm run lint
npm run check-format   # npm run format to fix
npm run build
```

CI (`.github/workflows/ci.yml`) runs all five.

## License

MIT, as OpenDots. `LICENSE` keeps CopilotKit's copyright notice.

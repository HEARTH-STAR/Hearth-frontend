# Hearth-frontend

The Hearth web app: Spaces for your pages, and Dots, assistants that each have their own
computer. Each Space is its own container, spun up by
**[Hearth-backend](https://github.com/HEARTH-STAR/Hearth-backend)** and running
**[Hearth-Core](https://github.com/HEARTH-STAR/Hearth-Core)**; Claude Code and GitHub are signed
in inside it, and every conversation of a Dot runs on Claude Code in its home Space's container.

Forked from [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots) (MIT). The CopilotKit
React SDK and runtime and AG-UI are kept; OpenDots' model, conversation and computer services
are replaced with the Hearth ones. The Files tab renders each Dot's folder with
[trees.software](https://trees.software/) (`@pierre/trees`).

## The three repos

HEARTH is three repos in [github.com/HEARTH-STAR](https://github.com/HEARTH-STAR), cloned side by
side:

```
HEARTH/
  Hearth-frontend/   this app             :4310 (dev UI :5173)
  Hearth-Core/       Claude Code + files  :5010 inside each Space's container
  Hearth-backend/    container spin-up    :5020   ← HEARTH_BACKEND_URL
```

Each repo's `.env.example` names the other two and uses the same ports, so the defaults connect
with no configuration. The one value to keep in step: when Hearth-backend sets `HEARTH_API_TOKEN`,
set the same value here as `HEARTH_BACKEND_TOKEN`.

Hearth-backend's `space` template clones Hearth-Core's `main` into `/workspace/hearth-core` and
runs it on port 5010, published on `127.0.0.1` at a port Docker picks; this server asks
Hearth-backend for it (`GET /api/containers/{name}`). A Space runs the Hearth-Core that `main`
held when it was created, so push Hearth-Core changes before creating Spaces that need them.

```bash
git clone https://github.com/HEARTH-STAR/Hearth-frontend.git
git clone https://github.com/HEARTH-STAR/Hearth-Core.git
git clone https://github.com/HEARTH-STAR/Hearth-backend.git   # private
```

## Requirements

- Node.js 24 and npm
- Docker (Docker Desktop on Windows and macOS), running
- Hearth-backend (`./hearth-backend.sh serve` in that repo, default `http://127.0.0.1:5020`)
- A Claude account to sign Claude Code in to, inside each Space

## Quick start

```bash
npm ci
cp .env.example .env
npm run dev            # API on 127.0.0.1:4310, app on http://127.0.0.1:5173
```

From the folder that holds the repos (Hearth-Core runs inside each Space, not here):

```bash
(cd Hearth-backend && ./hearth-backend.sh serve) &
(cd Hearth-frontend && npm run dev)
```

Production: `npm run build && npm start` serves everything on `http://127.0.0.1:4310`.

Each Dot is a Space: its own container, under the Dot's name. The first Dot, Scout, is there
already; the **+** next to Hearth spins up another (just give it a name). A Dot's **…** menu opens
its **Setup** and **Pages**; a new conversation starts from the clock menu in its header.
Follow the Setup page:

1. **Container**: a new Dot starts its container at once (Scout has a **Start container**
   button). The first one builds the `space` image and its first start installs Hearth-Core's
   packages; both take a few minutes.
2. **The Dot's agent**, picked when the Dot was made (Claude Code by default):
   - **Claude Code**: **Sign in to Claude**, approve on claude.com, and paste the code it shows.
   - **Cursor**: **Sign in to Cursor** and approve on cursor.com; the page finishes on its own.
   - **Antigravity**: **Sign in to Google**, approve, and paste the code Google shows.

   Hearth-Core runs the agent's own login inside the container, so the login lives there. The Space
   image must include that agent's CLI (Cursor's `cursor-agent`, Antigravity's `agy`).

3. **GitHub** (optional): a one-time code or a personal access token, for the gh CLI inside the
   container.

A Dot runs in its Space's container. Until that Space is ready, its message box waits; the
Setup page shows what is missing.

## What is where

| Surface              | What it shows                                                                                                                                                                  | Backed by                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Sidebar              | Search, Dots with their latest conversation; each Dot's **…** menu (Setup, Pages), Settings                                                                                    | this server's SQLite                                           |
| Setup (Dot menu)     | The Dot's Space: its container, then its agent's sign-in (Claude Code, Cursor or Antigravity), then GitHub                                                                     | Hearth-backend, then the Space's Hearth-Core                   |
| Pages (Dot menu)     | The Dot's Space's pages                                                                                                                                                        | this server's SQLite                                           |
| Conversation         | Your messages; Claude Code's replies, justified, each heading's section a card (code with Copy, framed tables); one row per tool call ("Ran wc -l … → 41 lines"); review cards | the home Space's Hearth-Core `POST /api/chat`                  |
| Review before saving | A draft with **Approve & save** / **Decline**; only approval saves the page                                                                                                    | CopilotKit human-in-the-loop                                   |
| Computer: Files      | Editor-style: the container's `/workspace` as a tree (`@pierre/trees`) beside the open file, with line numbers and highlighting (Shiki, Pierre Dark)                           | the Dot's Hearth-Core `/api/workspace/*`                       |
| Computer: Terminal   | A live shell in the Dot's container (xterm.js); it stays connected while the panel is open                                                                                     | Hearth-backend's terminal WebSocket (`docker exec`)            |
| Computer: Activity   | Every tool call, with its outcome (succeeded, failed, denied)                                                                                                                  | recorded from the chat stream                                  |
| GitHub (Setup)       | The Space's GitHub account; connect with a one-time code or a personal access token, re-check, disconnect                                                                      | the Space's Hearth-Core `/api/connectors/github/*` (gh inside) |

## How a turn runs

1. The browser sends the message to the CopilotKit runtime (`/api/copilotkit`, AG-UI over SSE).
2. The Dot's `HearthAgent` (`src/server/hearth-agent.ts`) sends the Hearth-Core in the Dot's home
   Space's container one `ChatSpec`: the message, the Dot's persona and Spaces, its folder
   (`dots/<name>-<id>`), its permissions, and the page tools this server runs (list, read,
   create, edit pages; `review_space_page`).
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

| Variable                    | Default                 | Meaning                                                  |
| --------------------------- | ----------------------- | -------------------------------------------------------- |
| `HEARTH_BACKEND_URL`        | `http://127.0.0.1:5020` | Hearth-backend                                           |
| `HEARTH_BACKEND_TOKEN`      | none                    | Bearer token when Hearth-backend has `HEARTH_API_TOKEN`  |
| `HEARTH_CONTAINER_TEMPLATE` | `space`                 | Template for Space containers (runs Hearth-Core on 5010) |
| `HEARTH_SPACE_HOST`         | `127.0.0.1`             | Where this server reaches the ports Spaces publish       |
| `HEARTH_MODEL`              | Hearth-Core's default   | Model for conversations                                  |
| `HOST`, `PORT`              | `127.0.0.1`, `4310`     | Where this server listens                                |
| `OWNER_TOKEN`               | none                    | Required (24+ characters) to listen beyond loopback      |
| `DATABASE_PATH`             | `data/hearth.sqlite`    | App data                                                 |

## Layout

```
src/server/
  index.ts               server entry: config, stores, Platform, static files
  app.ts                 /api guards (host, origin, owner token, JSON), settings
  platform.ts            CopilotKit runtime (SSE, SQLite runner), one HearthAgent per Dot
  space-service.ts       Spaces as containers: spin-up, stage, each Space's Hearth-Core
  space-routes.ts        /api/spaces: create, setup, container start, agent sign-in
  github-routes.ts       /api/spaces/:id/github*: the Space's gh account
  connections.ts         Hearth-Core connector answers → what the app shows
  hearth-agent.ts        AG-UI agent ⇄ a Space's Hearth-Core chat turn
  hearth-core.ts         Hearth-Core client (chat SSE, tool results, files, GitHub, Claude sign-in)
  hearth-backend.ts      Hearth-backend client (Docker status, spin-up, container lookup, start)
  service-status.ts      whether Hearth-backend and its Docker answer (cached briefly)
  computer-*.ts          a Dot's computer: folder, permissions, activity
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

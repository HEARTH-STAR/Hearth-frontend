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
- Postgres 17 (`DATABASE_URL`): users and the Dots each one owns
- A [Clerk](https://clerk.com) application (`CLERK_*`), set up as in
  [Clerk: username and password](#clerk-username-and-password)
- A Claude account to sign Claude Code in to, inside each Space

## Quick start

```bash
npm ci
cp .env.example .env   # then fill in the three CLERK_* values
docker run -d --name hearth-postgres -e POSTGRES_PASSWORD=hearth   -p 127.0.0.1:5432:5432 postgres:17   # the DATABASE_URL in .env.example
npm run dev            # API on 127.0.0.1:4310, app on http://127.0.0.1:5173
```

The server applies the migrations in `drizzle/` when it starts. Clerk's webhooks cannot reach a
laptop, and Hearth does not need them to: a user who signs in before their `user.created` arrives is
added when they first make a Dot.

From the folder that holds the repos (Hearth-Core runs inside each Space, not here):

```bash
(cd Hearth-backend && ./hearth-backend.sh serve) &
(cd Hearth-frontend && npm run dev)
```

Production: `npm run build && npm start` serves everything on `http://127.0.0.1:4310`.

Sign in, or sign up with a username and a password (Clerk's screens). Each Dot is a Space: its
own container, `hearth-container-<dot_id>`. A new user starts with one Dot, Scout; the **+** next
to Hearth spins up another (just give it a name). Each user sees and reaches only their own Dots. A Dot's **…** menu opens
its **Setup** and **Pages**; a new conversation starts from the clock menu in its header.
Follow the Setup page:

1. **Container**: a new Dot starts its container at once (**Start container** brings a stopped
   or lost one back). The first one builds the `space` image and its first start installs Hearth-Core's
   packages; both take a few minutes.
2. **The Dot's agent**, picked when the Dot was made (Claude Code by default):
   - **Claude Code**: **Sign in to Claude**, approve on claude.com, and paste the code it shows.
   - **Cursor**: **Sign in to Cursor** and approve on cursor.com; the page finishes on its own.
   - **Antigravity**: **Sign in to Google**, approve, and paste the code Google shows.

   Hearth-Core runs the agent's own login inside the container, so the login lives there. A
   Cursor or Antigravity Space downloads that agent's CLI on its first start (Hearth-backend's
   `install-agent-cli`, pinned by version and checksum), so that start takes a little longer.

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
| `APP_ORIGIN`                | Vite's in development   | The URLs Hearth is opened at; required beyond loopback   |
| `DATABASE_URL`              | none (required)         | Postgres: users, their Dots, their sign-ins              |
| `CLERK_PUBLISHABLE_KEY`     | none (required)         | Clerk, API keys                                          |
| `CLERK_SECRET_KEY`          | none (required)         | Clerk, API keys                                          |
| `CLERK_WEBHOOK_SECRET`      | none (required)         | The Signing Secret of Clerk's webhook endpoint           |
| `DATABASE_PATH`             | `data/hearth.sqlite`    | App data (pages, conversations, …)                       |

## Layout

```
src/server/
  index.ts               server entry: config, Postgres (migrated), stores, Platform, static files
  app.ts                 /api guards (host, origin, JSON, Clerk session, ownership), settings
  auth.ts                Clerk: the session's user, usernames, the Frontend API host for the CSP
  clerk-webhook.ts       /api/webhooks/clerk: Svix-verified user and session events
  ownership.ts           404 unless the session's user owns the Dot, Space or conversation in the path
  db/                    Drizzle: schema.ts (users, dots, sign_ins), accounts.ts, the connection
  platform.ts            CopilotKit runtime (SSE, SQLite runner), one HearthAgent per Dot
  space-service.ts       Spaces as containers: spin-up, stage, each Space's Hearth-Core
  space-routes.ts        /api/spaces/:id: setup, container start, agent sign-in (made with its Dot)
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
drizzle/                 Postgres migrations (npm run db:generate after a schema change)
tests/                   vitest; Hearth-Core, Hearth-backend and Clerk are faked, Postgres is
                         PGlite (tests/helpers.ts)
```

## Users and their Dots

Clerk signs people in; Hearth keeps no passwords and no emails. Postgres (Drizzle, `src/server/db/`)
holds three tables, created by `drizzle/0000_init.sql`:

| Table      | Columns                                                    | Written when                                                    |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `users`    | `user_id` (Clerk's), `username` (unique)                   | `user.created` / `user.updated` webhooks, or a first Dot        |
| `dots`     | `dot_id`, `dot_name`, `user_id` → `users`                  | a Dot is made (before its container spins up), renamed, deleted |
| `sign_ins` | `sign_in_id` (Clerk session id), `user_id`, `signed_in_at` | `session.created` (once per session)                            |

A Dot, its Space and its `dots` row share one id, and its container is `hearth-container-<dot_id>`.
Every `/api` route needs a Clerk session. Every route that names a Dot, a Space or a conversation
(chat, files, pages, terminal, setup, delete) answers 404 unless that Dot is the user's; the SQLite
stores (pages, conversations, transcripts) are reached only through that check.

`POST /api/webhooks/clerk` verifies each event's Svix signature. `user.deleted` removes the user's
containers through Hearth-backend (`DELETE /api/containers/{name}`), then what Hearth kept for those
Dots, their `dots` rows and the user (with their sign-ins). If a container cannot be removed, it
answers 500 and Clerk delivers the event again later.

### Clerk: username and password

In the [Clerk dashboard](https://dashboard.clerk.com), for the application (development and
production instances alike):

1. **User & authentication**: turn on **Username** and make it required; turn on **Password**.
   Turn off the identifiers Hearth does not use (email, phone) if sign-up should ask only for
   a username and a password.
2. **Webhooks**: add the endpoint `https://<your host>/api/webhooks/clerk` with the events
   `user.created`, `user.updated`, `user.deleted` and `session.created`. Its **Signing Secret**
   (`whsec_…`) is `CLERK_WEBHOOK_SECRET`.
3. **API keys**: the publishable key is `CLERK_PUBLISHABLE_KEY`, the secret key `CLERK_SECRET_KEY`.
4. Production instance: add your domain and the DNS records Clerk lists. The page's
   Content-Security-Policy allows the Clerk host named in the publishable key, so no other change
   is needed.

## Hosting on a VPS (HostVDS)

Hosted, Hearth runs every user's containers on one VPS: Ubuntu with Docker Engine, Postgres in a
container, this app in a container, Hearth-backend on the host beside the engine it drives, and a
reverse proxy for HTTPS. Only ports 22, 80 and 443 face the internet.

```
internet ─443→ Caddy ─→ 127.0.0.1:4310  Hearth-frontend (container; networks hearth + hearth-db)
                                           ├─→ postgres:5432         hearth-db, internal, no published port
                                           ├─→ 172.30.0.1:5020       Hearth-backend on the host
                                           └─→ 172.30.0.1:<port>     each Space's Hearth-Core
```

1. **Server.** Make an Ubuntu 24.04 VPS at HostVDS with enough disk for every user's containers
   (each Space image is a few GB once built), point your domain's DNS at it, and sign in as root.

2. **Docker Engine**, from Docker's apt repository:

   ```bash
   apt-get update && apt-get install -y ca-certificates curl git
   install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
     https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
     > /etc/apt/sources.list.d/docker.list
   apt-get update
   apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   ```

3. **Private networks**, made once (they survive reboots). `hearth-db` is internal: Postgres has no
   route out and no published port. On `hearth`, `172.30.0.1` is the host:

   ```bash
   docker network create --internal hearth-db
   docker network create --subnet 172.30.0.0/24 --gateway 172.30.0.1 hearth
   ```

4. **Firewall.** Containers on `hearth` reach the host at `172.30.0.1`; nothing else does.

   ```bash
   ufw allow OpenSSH && ufw allow 80,443/tcp
   ufw allow from 172.30.0.0/24 to 172.30.0.1
   ufw enable
   ```

   Docker's published ports skip ufw, which is why nothing here publishes on the public address:
   the app on `127.0.0.1`, the Spaces on `172.30.0.1`.

5. **Hearth-backend** on the host (it runs the `docker` CLI). Clone it (it is private: use a deploy
   key) and install it as a service:

   ```bash
   useradd --system --create-home --groups docker hearth
   sudo -iu hearth git clone git@github.com:HEARTH-STAR/Hearth-backend.git
   sudo -iu hearth bash -c 'curl -LsSf https://astral.sh/uv/install.sh | sh && cd Hearth-backend && ~/.local/bin/uv venv venv && ~/.local/bin/uv pip install --python venv/bin/python -r requirements.txt'
   openssl rand -hex 32   # the token, for both sides
   cat > /etc/hearth-backend.env <<'EOF'
   HOST=172.30.0.1
   PORT=5020
   HEARTH_API_TOKEN=<the token>
   HEARTH_PUBLISH_HOST=172.30.0.1
   EOF
   chmod 600 /etc/hearth-backend.env
   cat > /etc/systemd/system/hearth-backend.service <<'EOF'
   [Unit]
   After=docker.service
   Requires=docker.service
   [Service]
   User=hearth
   WorkingDirectory=/home/hearth/Hearth-backend
   EnvironmentFile=/etc/hearth-backend.env
   ExecStart=/home/hearth/Hearth-backend/venv/bin/python server.py
   Restart=always
   [Install]
   WantedBy=multi-user.target
   EOF
   systemctl enable --now hearth-backend
   ```

   The `docker` group is root on the host in all but name: keep this user for Hearth-backend only.

6. **Postgres and this app** (`compose.yml`). In a checkout of Hearth-frontend, write `.env`:

   ```bash
   APP_ORIGIN=https://hearth.example.com
   POSTGRES_PASSWORD=<openssl rand -hex 24>   # hex: it goes into DATABASE_URL as is
   CLERK_PUBLISHABLE_KEY=pk_live_…
   CLERK_SECRET_KEY=sk_live_…
   CLERK_WEBHOOK_SECRET=whsec_…
   HEARTH_BACKEND_TOKEN=<the token from step 5>
   ```

   then `docker compose up -d --build`. Postgres keeps its data in the `hearth-postgres` volume;
   the app applies `drizzle/` at start, then listens on `127.0.0.1:4310`. Its `DATABASE_URL` is
   `postgres://hearth:<password>@postgres:5432/hearth`, resolved on `hearth-db`. Back up with
   `docker compose exec postgres pg_dump -U hearth hearth > hearth.sql`.

7. **HTTPS.** Install Caddy (`apt-get install -y caddy`) and give `/etc/caddy/Caddyfile`
   `hearth.example.com { reverse_proxy 127.0.0.1:4310 }`, then `systemctl reload caddy`. It gets
   the certificate and passes the terminal's WebSocket through.

8. **Clerk**: the production instance as in [Clerk: username and password](#clerk-username-and-password),
   with the webhook at `https://hearth.example.com/api/webhooks/clerk`.

Updating: `git pull && docker compose up -d --build` here, `git pull && systemctl restart
hearth-backend` there. Running Spaces keep going: they are Hearth-backend's containers, not the
app's.

## Development

```bash
npm test               # vitest
npm run typecheck
npm run lint
npm run check-format   # npm run format to fix
npm run build
```

CI (`.github/workflows/ci.yml`) runs all five. After changing `src/server/db/schema.ts`, run
`npm run db:generate` and commit the new file in `drizzle/`; the server applies it at its next start.

## License

MIT, as OpenDots. `LICENSE` keeps CopilotKit's copyright notice.

# Contributing to Hearth-frontend

## Setup

```bash
npm ci
cp .env.example .env
npm run dev        # API on 127.0.0.1:4310, app on http://127.0.0.1:5173
```

Requires Node.js 24. Conversations need [Hearth-Core](https://github.com/HEARTH-STAR/Hearth-Core) (`../Hearth-Core`); containers need
[Hearth-backend](https://github.com/HEARTH-STAR/Hearth-backend) (`../Hearth-backend`) and Docker.

## Rules

1. The browser talks only to this server. Hearth-Core and Hearth-backend are reached from `src/server`.
2. Every Space, Dot, conversation and file operation is authorized on the server, not in the client.
3. A tool Claude Code can call is either run here (page tools) or handed to the owner (`handoff`), and has a
   row in `ToolRow.tsx`.
4. Tests fake both services with `tests/helpers.ts`; nothing calls a model, Docker or the network.
5. Check narrow screens (390px wide, no horizontal scroll) and dark mode when changing the UI.

## Before a pull request

Run `npm run format`, `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`. Keep credentials,
local databases (`data/`) and test reports out of commits.

## Upstream

This repository is a fork of [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots), remote `upstream`.
Its code is MIT licensed; keep the `LICENSE` notice.

# Hearth-frontend - Agent Instructions

Read `CLAUDE.md` first; it is the project memory and applies to every coding agent working here.

## Quick reference

- Install: `npm ci`, then `cp .env.example .env`.
- Run: `npm run dev` (API on `127.0.0.1:4310`, app on `127.0.0.1:5173`). Hearth-Core must be running for
  conversations; Hearth-backend only for containers.
- Check: `npm test`, `npm run typecheck`, `npm run lint`, `npm run check-format`, `npm run build`.
- Add a page tool: `src/server/page-tools.ts` (zod parameters); `HearthAgent` offers it to Claude Code and
  runs it. Give it a row in `src/client/ToolRow.tsx`.
- Add a handoff (owner decides) tool: register it client-side with `useHumanInTheLoop`, offer it in
  `HearthAgent` with `handoff: true`, and record its calls with `workspace.openHandoff`.
- Add a setting: `src/server/config.ts`, documented in `.env.example` and the README.

## Never

- Bring back CopilotKit Intelligence, an OpenAI/TanStack model, OpenBot, voice, Slack, telemetry or other
  upstream services; Hearth-Core and Hearth-backend are the services.
- Let the browser call Hearth-Core or Hearth-backend directly.
- Pass a browser-supplied path to Hearth-Core without `filePath` validation under the Dot's folder.
- Widen `runtime-scope.ts` beyond the routes the client uses.
- Listen beyond loopback without `APP_ORIGIN`, or answer an `/api` route without a Clerk session (only
  `/api/webhooks/clerk`, Svix-signed, and `/api/auth/config` are public).
- Add a route that takes a Dot, Space or conversation id outside `/api/dots/:id`, `/api/spaces/:id` or
  `/api/conversations/:id` (`ownershipGuard` checks those), or take such an id in a body without checking
  the user owns it. Another user's Dot answers 404, like one that does not exist.
- Add tables or columns to the Postgres schema (`users`, `dots`, `sign_ins`) unless asked; never store
  passwords or emails (Clerk keeps them).

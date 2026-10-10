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
- Listen beyond loopback without `OWNER_TOKEN`.

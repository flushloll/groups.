# Contributing to Groups

Thanks for helping. Issues, ideas, models, fixes and docs are all welcome.

## Set up

Node.js 22.13 or newer.

```sh
npm install
npm run dev          # http://localhost:5173 (frontend) + backend on :3001
npm test             # unit and integration tests, no API keys or paid calls needed
npm run build        # type-check and production build
```

Luna needs a model connection. Copy `.env.example` to `.env.local` and set a provider. Any OpenAI-compatible endpoint with tool calling works, including local servers such as LM Studio or Ollama. Without one, Luna shows as offline and everything else still works. Never commit `.env.local`.

The browser smoke test needs Chrome: `npm run build && npm run test:browser` (set `CHROME_PATH` if Chrome isn't in a standard location).

To try Postgres locally:

```sh
docker run -d --name groups-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npm start
```

## Find your way around

[ARCHITECTURE.md](ARCHITECTURE.md) explains how the pieces fit: who owns which state, the sync protocol, how Luna works and the code map. The short version:

- `shared/`: the object catalog (models, sizes, colliders) and board merging, used by both browser and server.
- `server/`: HTTP and WebSocket service, physics (Rapier), storage (SQLite or Postgres), Luna's tools and model connection.
- `src/`: React app. The lobby is in `src/lobby`; the 3D room (React Three Fiber) and its interface are in `src/room`; client state is in `src/state`.
- `tests/`: Node test runner suites; the integration tests use a mock model.

## Good first contributions

- **New catalog models.** Add an entry to `MODELS` in `shared/catalog.mjs`, made of simple parts with an optional collider. The library thumbnail and Luna's vocabulary update automatically. `tests/physics.test.mjs` checks every model's colliders.
- **Room themes.** Add a preset to `src/lobby/presets.ts` (and `server/servers.mjs` for built-in spaces).
- **Interface polish, accessibility and translations** in `src/room/hud`.
- **Docs and screenshots.** Images live in `docs/images`.

For larger changes, open an issue first so we can agree on the approach. [ROADMAP.md](ROADMAP.md) lists bigger directions.

## Conventions

- Keep one authority per kind of state (see ARCHITECTURE.md). Luna only changes rooms through `apply_room_operations`. It must never gain access to code, credentials or permissions.
- Validate everything the server receives (`server/schema.mjs`), and check permissions on the server, not just in the interface.
- Match the surrounding code style. TypeScript in `src`, ES modules in `server` and `shared`.
- Add or update tests for behaviour changes. `npm test` and `npm run build` must pass.
- Keep commits focused, with messages that say why.

## Reporting security issues

Please don't open public issues for vulnerabilities. Use GitHub's private vulnerability reporting (**Security → Report a vulnerability**) on this repository.

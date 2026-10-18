# Groups architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI shell | React 19, TypeScript, Vite 6 | Code-split: the lobby loads React, three.js and auth; the room, R3F and Excalidraw load on demand |
| 3D | React Three Fiber 9 + drei on three.js 0.186 | A declarative scene replaced a 1,200-line imperative renderer, which makes new asset types straightforward |
| Client state | zustand | One store for session, optimistic edits and UI. 60 Hz data (simulation frames, keys, voice levels) lives in `liveFrame`, outside React |
| Boards | Excalidraw 0.18 (MIT), fonts self-hosted | Full whiteboard editing with per-element versions suited to merging |
| Server | Node 22, `ws`, Better Auth (anonymous guests) | One process owns sessions, physics, persistence and Luna |
| Storage | SQLite locally (`node:sqlite`), Postgres when `DATABASE_URL` is set (`pg`) | One store over a small SQL adapter (`server/database.mjs`). Space metadata and memberships are cached in memory and written through |
| Physics | Rapier 0.21, server-authoritative | Fixed 60 Hz step, 20 Hz frames to clients |
| Model | AI SDK 7 tool agent (OpenAI, Gateway or compatible) | One validated tool, shared with MCP |

## Shared vocabulary (`shared/`)

`shared/catalog.mjs` is imported by the browser, the physics service and Luna's prompt:

- `ROOM`: floor bounds (20 × 16 m) and wall height.
- `PRIMITIVES` and `PANELS`: base sizes for cube, sphere, pyramid, cylinder and cone, and for text, note, image and board panels.
- `MODELS`: 69 procedural low-poly models made of simple parts (box, cylinder, cone, icosahedron, prism, wedge, star…). Each has colour roles (`$`, `$dark`, `$light`), a default physics profile, optional multi-part colliders (doorways and arches can be walked through) and an optional **text surface** where the instance's text is drawn (whiteboard, easel, sign, screen, table).
- `objectSize`, `restHeight` and `catalogGuide`: sizing maths and the compact prompt description.

`shared/board.mjs` merges board elements by version (ties go to the lower `versionNonce`, as in Excalidraw) and creates sticky-note layouts for Luna.

An object's size is base size × `scale` × per-axis `stretch`. A position is the object's centre; `y = 0` means "resting on the floor" for both renderer and physics.

## Domain model

- **Space**: directory metadata, visibility, the default visitor role, memberships and invitations (SQLite tables).
- **Live room**: each space has one. It holds instances, conversation, environment (colours, soundscape, `room`/`open` setting) and the `autoBuild` flag.
- **Asset**: typed content with a revision: `prop`, `model`, `document`, `image`, `drawing` or `board`. **Instance** holds placement: position, rotation, scale, stretch, colour and physics. The renderer sees expanded `RoomObject`s; content edits bump the asset revision, placement edits don't.
- **Checkpoint**: a full snapshot of the room saved before every Luna change and every restore, or on demand. Restoring saves the current scene first. Checkpoints are capped at 150 per room.
- **Message**: a typed or spoken turn (`source`, `toLuna`, `canDirectLuna`) or a Luna reply (`status`, `checkpointId`). `sourceTurnIds` records which turns Luna has already considered.

## State authorities

| State | Authority | Transport |
| --- | --- | --- |
| Room content | Server (`live.mjs` + `schema.mjs`), persisted before broadcast | Client `patch` (upserts, removes, partial `updates`), server `delta` with a sequence number |
| Board content | Same, merged per element | Partial `updates` with only the changed elements |
| Player and dynamic prop poses | Rapier on the server | Client `move` input at 20 Hz; server `simulation` frames |
| Presence (mute, speaking, colour, name) | Server roster | `presence` and `profile` messages |
| Voice audio | Browsers (WebRTC mesh) | Signalling relayed over the socket |
| Identity and roles | Better Auth + SQLite | Cookies; checked on every mutation and heartbeat |

### Sync protocol

- On `join` the server sends the full workspace with `seq`. After that it sends only `delta` messages: changed room fields, object upserts and removes, and message upserts. A client that sees a gap sends `resync`.
- Clients apply their own patches optimistically (`pending`) and drop each one when its acknowledgement arrives, or replace the state on rejection. Unacknowledged patches and speech turns are replayed after reconnecting; the server de-duplicates by id.
- Partial `updates` merge into the latest object, so one person recolouring and another moving the same object don't overwrite each other. Board updates merge element by element.
- Physics poses are flushed into the room every two seconds while occupied (as small deltas), and on leave and shutdown.

## Luna

1. A turn arrives (`chat`, or a `transcript` from voice). Viewer turns are stored with `canDirectLuna: false` and never trigger a run.
2. The **server coordinator** (`live.mjs`) schedules a run. Turns addressed to Luna (the toggle, or text or speech starting with "Luna") run after about 350 ms. Ordinary conversation waits for `GROUPS_LUNA_QUIET_MS` of quiet, and waits longer while anyone in the room is speaking. Only one run per room happens at a time; turns that arrive during a run trigger a follow-up.
3. `intelligence.mjs` sends instructions, the room context (`room-tools.mjs` `roomContext`), the catalog guide and up to four images to the model, which may call `apply_room_operations` once.
4. `applyPlan` validates the operations. The revision is *semantic*: it ignores where physics has carried dynamic props. If the room changed meanwhile, a per-object fingerprint check rejects only real conflicts.
5. `commitDevelopment` saves a checkpoint, updates the same live room, broadcasts the delta and posts Luna's reply with an *Undo this change* link. When nothing needs building, the considered turns are marked consumed. Luna replies only if it was asked directly.
6. MCP clients use the same commit path.

## Rendering

- `room/scene/Scene.tsx`: the canvas, physics-pose interpolation, cameras (third person with wall collision, first person, overview orbit), movement input, pointer interaction (select, drag with grid snapping, place with a ghost preview, paint, look; thin objects can be grabbed by their bounds) and outlines.
- `ObjectView.tsx`: catalog models (cached geometries and materials, animated parts), primitives, writing panels drawn on canvas with headings and bullets, images, floor strokes, and boards drawn by a light canvas renderer (`boardTexture.ts`), so visitors never load Excalidraw.
- `RoomShell.tsx`: the walled diorama or the open-air island, with lighting and fog easing between environments.
- `Avatars.tsx`: interpolated low-poly avatars that face their walking direction, with name tags and speaking rings.
- The lobby's `SpacePreview` reuses the same renderer to show a turning miniature of a space's real contents.

## Security notes

- Every HTTP mutation checks the Origin header and the session. WebSocket upgrades check the origin. Roles are rechecked when each message is handled.
- Luna's tools are limited to declared object operations in one room. Room text is treated as untrusted creative material.
- Server transcription is opt-in, rate-limited (40 clips per minute per user) and capped at 2 MB per clip.
- The MCP bearer token is administrative.

## Code map

| Path | Responsibility |
| --- | --- |
| `shared/catalog.mjs`, `shared/board.mjs` | Shared vocabulary, sizes, colliders, board merge |
| `server/index.mjs` | HTTP routes, static files, WebSocket upgrade, shutdown |
| `server/live.mjs` | Sessions, delta publishing, socket protocol, Luna coordinator, checkpoints, physics loop |
| `server/schema.mjs`, `server/assets.mjs` | Validation, patch merging, deltas, asset/instance projection |
| `server/room-tools.mjs`, `server/intelligence.mjs`, `server/mcp.mjs` | Luna's tool schema, context and plan application; model connection; MCP |
| `server/physics.mjs` | Rapier worlds, colliders from the catalog, character controller |
| `server/store.mjs`, `server/database.mjs` | Durable state over SQLite or Postgres, caches, migrations, memberships, invitations, checkpoints |
| `server/auth.mjs`, `server/servers.mjs` | Guest sessions, socket tickets for cross-origin realtime, built-in spaces |
| `server/transcription.mjs` | Optional server speech-to-text |
| `src/App.tsx`, `src/lobby/*` | Lobby, space creation and entry |
| `src/state/*` | zustand store, socket connection, sync maths, undo history |
| `src/room/RoomView.tsx`, `src/room/hud/*` | Room HUD: dock, inspector, chat, history, people, dialogs, library, board editor |
| `src/room/scene/*` | 3D scene |
| `src/hooks/useVoiceRoom.ts`, `useServerTranscription.ts` | WebRTC voice, speech recognition, ambient sound, transcription fallback |
| `tests/*.test.mjs`, `tests/browser/smoke.mjs` | Unit and integration tests (mock model), browser smoke test |

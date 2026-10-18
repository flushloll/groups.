# Deploying Groups (free, no payment method)

Groups needs a long-running Node process for WebSockets, the physics loop and Luna's timers, which Vercel's serverless functions can't provide. The free setup:

```
Browser ──https──▶ Vercel (static site; /api, /mcp, /health proxied) ──▶ Render (Docker, free)
   └──────wss with a 60-second signed ticket────────────────────────────▶ Render
                                                            Render ──▶ Neon Postgres (free)
```

- **Vercel** serves the site. Login cookies stay first-party on its domain.
- **Render's free web service** runs the same Docker image. It sleeps after 15 minutes without traffic; the first visit afterwards takes about a minute.
- **Neon's free Postgres** stores everything: spaces, members, history and logins. Render's free disk is wiped whenever the service sleeps, so nothing important is kept there.

None of the three services needs a card for these plans.

## 1. Database (Neon)

Create a project and copy its **connection string** (`postgresql://…?sslmode=require`). Groups creates its tables on first start.

## 2. Backend (Render)

Render deploys from a Git repository or a container registry.

- **From GitHub:** push this project to a (private) repository, then in Render choose *New → Blueprint* and pick it. `render.yaml` defines the service.
- **From Docker Hub:** `docker build -t <you>/groups-live . && docker push <you>/groups-live`, then *New → Web Service → Existing image*, plan **Free**, health check `/health`.

Environment variables:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `GROUPS_ORIGINS` | `https://<your-vercel-domain>,https://<service>.onrender.com` |
| `BETTER_AUTH_URL` | `https://<your-vercel-domain>` |
| `OPENAI_API_KEY` | Luna's model key (plus `GROUPS_AI_PROVIDER=openai`, `GROUPS_AI_MODEL=gpt-6-luna`) |
| `GROUPS_TRUST_PROXY` | `true` |

Optional: `GROUPS_MCP_TOKEN`, `GROUPS_TRANSCRIPTION=openai`, `GROUPS_ICE_SERVERS`, `BETTER_AUTH_SECRET` (otherwise one is generated and stored in Postgres).

Check: `https://<service>.onrender.com/health` returns `{"ok":true}`.

Run exactly one instance. Live rooms and permission caches live in that one process.

## 3. Frontend (Vercel)

```sh
node scripts/configure-vercel.mjs <service>.onrender.com   # writes the proxy target into vercel.json
vercel link
vercel deploy --prod
```

The browser learns the realtime address from the backend with each ticket (Render provides `RENDER_EXTERNAL_URL`; other hosts can set `GROUPS_REALTIME_URL`), so Vercel needs no environment variables. `VITE_GROUPS_REALTIME_URL` is only a build-time fallback.

```sh
```

`.vercelignore` keeps `.env*`, `.groups-data` and `node_modules` out of the upload. If you add a custom domain, add it to `GROUPS_ORIGINS` and `BETTER_AUTH_URL` on Render.

## 4. Optional: copy your local spaces

Start the Render service once so the tables exist, then:

```sh
DATABASE_URL="<neon connection string>" node scripts/copy-to-postgres.mjs .groups-data/groups.sqlite
```

Then restart the Render service. Local spaces replace the hosted built-in ones. Guest logins are tied to a domain, so on the hosted site you get a new guest identity. Public spaces such as the built-ins are fully usable; private spaces you created locally stay owned by your local identity.

## 5. Optional: avoid cold starts

A free uptime monitor (for example UptimeRobot) requesting `https://<service>.onrender.com/health` every 10 minutes keeps the service awake. One always-on free service fits within Render's 750 free instance hours a month.

## Local testing against Postgres

```sh
docker run -d --name groups-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npm start
```

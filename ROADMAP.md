# Roadmap

Directions we'd like to take Groups. None of these are implemented yet. Pick one up and open an issue to discuss.

## Experience
- **Luna on boards:** let Luna draw shapes and arrows on boards, not just sticky notes.
- **Accounts:** guest identities are tied to one browser. Add account linking and recovery (Better Auth supports email and OAuth).
- **More assets:** shared video with synchronised playback, and uploaded 3D models (glTF).
- **Client prediction** for walking on high-latency connections, and drag ownership when two people move the same object.

## Infrastructure
- **Object storage for images:** they're stored inline in the room today, up to about 2 MB each.
- **Horizontal scaling:** one server process currently owns all live rooms and permission caches.
- **Voice:** an SFU (e.g. LiveKit) for larger rooms; the peer-to-peer mesh suits up to about 10 people.
- **Per-member MCP credentials:** the current MCP token is administrative.

## Bigger ideas
- **Generated applications:** small apps Luna builds inside isolated, sandboxed previews, never inside the host app.

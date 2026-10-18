export const publicServers = [
  {
    id: "the-commons",
    name: "The commons",
    description: "A little room for whatever comes next.",
    color: "#de865f",
    theme: "quiet",
  },
  {
    id: "the-garden",
    name: "The garden",
    description: "Slow thoughts. Wild possibilities.",
    color: "#789b7e",
    theme: "garden",
  },
  {
    id: "the-playroom",
    name: "The playroom",
    description: "Make a mess. See what happens.",
    color: "#9b8cb8",
    theme: "studio",
  },
];
// Starting atmospheres for built-in spaces, matching the themes offered at creation.
export const themeEnvironments = {
  quiet: { background: "#f3f1ea", floor: "#faf8f2", walls: "#fffdf7", light: "#fff4e0", soundscape: "quiet", setting: "room" },
  garden: { background: "#dfe9dc", floor: "#b9cf9f", walls: "#9fbf8f", light: "#fff3d6", soundscape: "garden", setting: "open" },
  studio: { background: "#ece8f2", floor: "#f6f3ee", walls: "#fbf9ff", light: "#fff6ea", soundscape: "studio", setting: "room" },
};
export const LEGACY_ENVIRONMENT = { background: "#f4f1e9", floor: "#faf8f2", walls: "#fffdf7", light: "#fff2db" };
export function serverWorkspace(server) {
  const roomId = `${server.id}-origin`;
  return {
    id: server.id,
    name: server.name,
    currentId: roomId,
    rooms: [
      {
        id: roomId,
        parentId: null,
        title: server.name,
        description: server.description,
        objects: [],
        messages: [],
        changes: [],
        prompt: "",
        createdAt: new Date().toISOString(),
        environment: themeEnvironments[server.theme] || themeEnvironments.quiet,
        autoBuild: true,
      },
    ],
  };
}

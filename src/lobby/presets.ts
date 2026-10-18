import type { RoomEnvironment, Soundscape } from "../types";

export const THEMES: { id: Soundscape; label: string; hint: string; color: string; environment: RoomEnvironment }[] = [
  {
    id: "quiet",
    label: "Calm room",
    hint: "Bright, quiet, a blank page",
    color: "#de865f",
    environment: { background: "#f3f1ea", floor: "#faf8f2", walls: "#fffdf7", light: "#fff4e0", soundscape: "quiet", setting: "room" },
  },
  {
    id: "garden",
    label: "Garden",
    hint: "Open air and green",
    color: "#789b7e",
    environment: { background: "#dfe9dc", floor: "#b9cf9f", walls: "#9fbf8f", light: "#fff3d6", soundscape: "garden", setting: "open" },
  },
  {
    id: "studio",
    label: "Studio",
    hint: "A place to make things",
    color: "#9b8cb8",
    environment: { background: "#ece8f2", floor: "#f6f3ee", walls: "#fbf9ff", light: "#fff6ea", soundscape: "studio", setting: "room" },
  },
  {
    id: "ocean",
    label: "Seaside",
    hint: "Sand, sea breeze",
    color: "#6f9fc4",
    environment: { background: "#d9e8ee", floor: "#efe3c8", walls: "#a9cfdc", light: "#fff8e8", soundscape: "ocean", setting: "open" },
  },
  {
    id: "cosmic",
    label: "Night sky",
    hint: "Dark and dreamy",
    color: "#5d5f9e",
    environment: { background: "#1f2338", floor: "#3a3f5c", walls: "#2b3050", light: "#c9d2ff", soundscape: "cosmic", setting: "room" },
  },
];
export const themeFor = (id: string) => THEMES.find((theme) => theme.id === id) || THEMES[0];

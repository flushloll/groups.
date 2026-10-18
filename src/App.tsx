import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import Lobby from "./lobby/Lobby";
import type { EnterOptions } from "./lobby/Lobby";
import { themeFor } from "./lobby/presets";
import { api, ensureIdentity } from "./api";
import { useApp } from "./state/store";
import { connect, disconnect } from "./state/connection";
import type { SpaceAccess, SpaceSettings, Visibility, Workspace } from "./types";

const RoomView = lazy(() => import("./room/RoomView"));

type Joined = { workspace: Workspace; access: SpaceAccess; settings: SpaceSettings };

function setUrl(spaceId: string | null) {
  const url = new URL(location.href);
  url.search = "";
  if (spaceId) url.searchParams.set("space", spaceId);
  history.replaceState({}, "", url);
}

export default function App() {
  const [phase, setPhase] = useState<"lobby" | "room">("lobby");
  const [returning, setReturning] = useState(false);
  const [entering, setEntering] = useState(false);
  const [notice, setNotice] = useState("");
  const [voiceOnEntry, setVoiceOnEntry] = useState(false);
  const cameraMode = useApp((state) => state.cameraMode);
  const setCameraMode = useApp((state) => state.setCameraMode);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((config) =>
        useApp.setState({
          builderOnline: Boolean(config.intelligence?.available),
          transcription: Boolean(config.transcription?.available),
          iceServers: Array.isArray(config.iceServers) ? config.iceServers : [],
        }),
      )
      .catch(() => useApp.setState({ builderOnline: false }));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const open = (joined: Joined, voice: boolean) => {
    useApp.getState().reset();
    useApp.setState({
      spaceId: joined.workspace.id,
      access: joined.access,
      settings: joined.settings,
      status: "connecting",
    });
    useApp.getState().setConfirmed(joined.workspace, 0);
    setUrl(joined.workspace.id);
    setVoiceOnEntry(voice);
    connect(joined.workspace.id);
    setPhase("room");
  };
  const enter = async (spaceId: string, options: EnterOptions) => {
    if (entering) return;
    setEntering(true);
    try {
      await ensureIdentity();
      open(
        await api<Joined>(`/api/spaces/${spaceId}/join`, options.invite ? { invite: options.invite } : {}),
        options.voice,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The space couldn’t be opened.");
    } finally {
      setEntering(false);
    }
  };
  const create = async (input: { name: string; visibility: Visibility; theme: string; voice: boolean }) => {
    if (entering) return;
    setEntering(true);
    try {
      await ensureIdentity();
      const theme = themeFor(input.theme);
      const roomId = crypto.randomUUID();
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: input.name,
        currentId: roomId,
        rooms: [
          {
            id: roomId,
            parentId: null,
            title: input.name,
            description: "A fresh space.",
            objects: [],
            messages: [],
            changes: [],
            prompt: "",
            createdAt: new Date().toISOString(),
            environment: theme.environment,
            autoBuild: true,
          },
        ],
      };
      const created = await api<Joined>("/api/spaces", {
        workspace,
        visibility: input.visibility,
        color: theme.color,
        theme: theme.id,
        description: theme.hint,
      });
      open(created, input.voice);
      if (innerWidth > 860) useApp.getState().set({ panel: "chat" });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The space couldn’t be created.");
    } finally {
      setEntering(false);
    }
  };
  const leave = useCallback((message?: string) => {
    disconnect();
    useApp.getState().reset();
    setUrl(null);
    setReturning(true);
    if (message) setNotice(message);
    setPhase("lobby");
  }, []);

  if (phase === "room")
    return (
      <Suspense
        fallback={
          <div className="room-loading">
            <LoaderCircle className="spin" size={22} />
            <span>Opening the space…</span>
          </div>
        }
      >
        <RoomView voiceOnEntry={voiceOnEntry} onLeave={leave} />
      </Suspense>
    );
  return (
    <Lobby
      returning={returning}
      notice={notice}
      entering={entering}
      cameraMode={cameraMode}
      onCameraMode={setCameraMode}
      onEnter={enter}
      onCreate={create}
    />
  );
}

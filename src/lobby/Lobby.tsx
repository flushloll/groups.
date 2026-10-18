import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  LoaderCircle,
  LockKeyhole,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import type { CameraMode, RoomEnvironment, ServerListing, Visibility } from "../types";
import type { RoomObject } from "../assets";
import LobbyWorld from "../components/LobbyWorld";
import { api, currentUser, ensureIdentity, updateName } from "../api";
import { THEMES } from "./presets";
import "../experience.css";

const SpacePreview = lazy(() => import("./SpacePreview"));

type Preview = { title: string; environment?: RoomEnvironment; objects: RoomObject[] };
export type EnterOptions = { invite?: string | null; voice: boolean };

export default function Lobby(props: {
  returning: boolean;
  notice: string;
  entering: boolean;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
  onEnter: (spaceId: string, options: EnterOptions) => void;
  onCreate: (input: { name: string; visibility: Visibility; theme: string; voice: boolean }) => void;
}) {
  const params = useRef(new URLSearchParams(location.search)).current;
  const linked = params.get("space");
  const invite = params.get("invite");
  const [browsing, setBrowsing] = useState(props.returning || Boolean(linked));
  const [servers, setServers] = useState<ServerListing[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [theme, setTheme] = useState("quiet");
  const [microphone, setMicrophone] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "yours" | "live">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [me, setMe] = useState("");
  const [editingName, setEditingName] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    void ensureIdentity()
      .then(currentUser)
      .then((user) => user && setMe(user.name))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        await ensureIdentity();
        if (controller.signal.aborted) return;
        const response = await fetch("/api/servers", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (controller.signal.aborted) return;
        setServers(data.servers);
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("The lobby is taking a moment to connect.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 8000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (browsing) heading.current?.focus();
  }, [browsing]);
  const filtered = servers.filter(
    (server) =>
      (filter === "all" || (filter === "live" ? server.members > 0 : server.member || server.owned)) &&
      `${server.name} ${server.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = filtered.find((server) => server.id === selectedId) || filtered[0];
  useEffect(() => {
    if (!selected) return setPreview(null);
    let alive = true;
    api<{ preview: Preview }>(`/api/spaces/${selected.id}/preview`)
      .then((data) => alive && setPreview(data.preview))
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [selected?.id]);
  const theme3d = selected?.theme === "garden" ? 1 : selected?.theme === "studio" ? 2 : 0;
  const showRealPreview = browsing && preview && preview.objects.length > 0;
  const linkedListing = linked ? servers.find((server) => server.id === linked) : undefined;
  return (
    <main className={`experience ${browsing ? "is-browsing" : "is-opening"}`}>
      <div className="experience-grain" aria-hidden="true" />
      <header className="experience-header">
        <a
          href="/"
          className="experience-brand"
          onClick={(event) => {
            event.preventDefault();
            setBrowsing(false);
          }}
          aria-label="Groups home"
        >
          <span className="brand-blocks">
            <i />
            <i />
            <i />
            <i />
          </span>
          groups<span>.</span>
        </a>
        <span className="experience-edition">
          TALK. BUILD. TOGETHER. <i />
        </span>
        <div className="experience-header-actions">
          {me && !editingName && (
            <button className="experience-about" onClick={() => setEditingName(true)} title="Change your name">
              <span className="me-dot" />
              {me}
            </button>
          )}
          {editingName && (
            <form
              className="name-form"
              onSubmit={async (event) => {
                event.preventDefault();
                try {
                  await updateName(me);
                  setEditingName(false);
                } catch {
                  /* keep editing */
                }
              }}
            >
              <input autoFocus value={me} maxLength={40} aria-label="Your name" onChange={(event) => setMe(event.target.value)} />
              <button aria-label="Save name">
                <Check size={14} />
              </button>
            </form>
          )}
          <button className="experience-about" onClick={() => setMicrophone(!microphone)} aria-pressed={microphone}>
            <Mic size={14} />
            {microphone ? "Voice on entry" : "Enter quietly"}
          </button>
        </div>
      </header>
      <div className="experience-world-wrap">
        {showRealPreview ? (
          <Suspense fallback={null}>
            <div className="real-preview">
              <SpacePreview objects={preview.objects} environment={preview.environment} />
            </div>
          </Suspense>
        ) : (
          <LobbyWorld
            selection={0}
            browsing={browsing}
            themes={browsing ? [theme3d] : undefined}
            count={browsing ? 1 : 3}
            onSelect={() => setBrowsing(true)}
          />
        )}
      </div>
      {!browsing ? (
        <section className="opening-copy" aria-label="Welcome to Groups">
          <span className="opening-eyebrow">GOOD THINGS HAPPEN TOGETHER</span>
          <h1 aria-label="Groups">
            groups<span>.</span>
          </h1>
          <div className="opening-bottom">
            <h2>
              Talk it through.
              <br />
              Watch it take shape.
            </h2>
            <p>
              Step into a shared little world with your people.
              <br />
              Say what you imagine and Luna builds it with you.
            </p>
            <button className="experience-primary" onClick={() => setBrowsing(true)}>
              Let’s begin <ArrowUpRight size={20} />
            </button>
            <span className="opening-footnote">Up to 10 people per room. Voice optional.</span>
          </div>
        </section>
      ) : (
        <>
          <button className="lobby-back" onClick={() => setBrowsing(false)}>
            <ArrowLeft size={15} />
            Back
          </button>
          <div className="world-caption">
            <span>
              {selected?.visibility === "private"
                ? "PRIVATE SPACE"
                : selected?.members
                  ? `${selected.members} INSIDE NOW`
                  : "OPEN DOORS"}
            </span>
            <h2>{selected?.name || "Your next beginning"}</h2>
            <p>
              {preview?.objects.length
                ? `${preview.title} · ${preview.objects.length} thing${preview.objects.length === 1 ? "" : "s"} inside`
                : selected?.description || "A room is only the beginning."}
            </p>
          </div>
          <section className="server-lobby" aria-label="Choose a space">
            <span className="lobby-eyebrow">
              <i /> THERE’S ROOM FOR YOU
            </span>
            <h1 ref={heading} tabIndex={-1}>
              Where shall
              <br /> we begin<span>?</span>
            </h1>
            {linked && (
              <button className="invited-room" onClick={() => props.onEnter(linked, { invite, voice: microphone })} disabled={props.entering}>
                <span>
                  <small>{invite ? "YOU’RE INVITED" : "SHARED WITH YOU"}</small>
                  {linkedListing?.name || (invite ? "Join the space you were invited to" : "Open the shared space")}
                </span>
                <ArrowUpRight size={19} />
              </button>
            )}
            <div className="server-filters" role="group" aria-label="Filter spaces">
              {(
                [
                  ["all", "Discover"],
                  ["yours", "Your spaces"],
                  ["live", "Live now"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="server-search">
              <Search size={15} />
              <input aria-label="Find a space" placeholder="Find a space…" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="server-list" role="group" aria-label="Spaces">
              {loading && (
                <div className="lobby-loading" role="status">
                  <LoaderCircle className="spin" size={18} />
                  Finding spaces…
                </div>
              )}
              {filtered.map((server) => (
                <button
                  key={server.id}
                  className={`server-option ${selected?.id === server.id ? "is-selected" : ""}`}
                  aria-pressed={selected?.id === server.id}
                  onClick={() => setSelectedId(server.id)}
                  onDoubleClick={() => props.onEnter(server.id, { voice: microphone })}
                >
                  <span className="server-swatch" style={{ "--server-color": server.color } as React.CSSProperties}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="server-option-copy">
                    <strong>{server.name}</strong>
                    <small>
                      {server.visibility === "private" && <LockKeyhole size={10} />}
                      {server.owned ? "Yours · " : server.member ? "Member · " : ""}
                      {server.description}
                    </small>
                  </span>
                  <span className={`server-occupancy ${server.members ? "is-live" : ""}`}>
                    <Users size={12} />
                    {server.members}/{server.capacity}
                  </span>
                </button>
              ))}
              {!loading && !filtered.length && (
                <p className="lobby-loading">
                  {filter === "yours" ? "You haven’t made or joined a space yet." : filter === "live" ? "Nobody is inside right now." : "No spaces match that name."}
                </p>
              )}
            </div>
            {error && (
              <div className="lobby-error" role="status">
                {error}
                <button
                  onClick={() => {
                    setLoading(true);
                    setRefresh((value) => value + 1);
                  }}
                  aria-label="Reconnect"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            )}
            <div className="entry-camera" role="group" aria-label="Perspective">
              <span>View</span>
              {(
                [
                  ["third", "Third person"],
                  ["first", "First person"],
                  ["overview", "Overview"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} aria-pressed={props.cameraMode === value} onClick={() => props.onCameraMode(value)}>
                  {label}
                </button>
              ))}
            </div>
            {selected && (
              <p className="server-entry-detail">
                {selected.role === "owner"
                  ? "Your space"
                  : selected.role === "contributor" || selected.role === "moderator"
                    ? "You can build here"
                    : "You can visit and talk"}
                {" · "}
                {selected.members === 0 ? "be the first inside" : `${selected.members} ${selected.members === 1 ? "person" : "people"} inside`}
              </p>
            )}
            <button
              className="experience-primary enter-server"
              disabled={props.entering || !selected || selected.members >= selected.capacity}
              onClick={() => selected && props.onEnter(selected.id, { voice: microphone })}
            >
              <span>
                {props.entering ? "Opening…" : selected && selected.members >= selected.capacity ? "This room is full" : "Step inside"}
              </span>
              <ArrowRight size={19} />
            </button>
            <span className="entry-privacy">
              <Mic size={12} />
              {microphone ? "Your microphone opens when you enter. Mute any time." : "Enter quietly; turn on your microphone inside."}
            </span>
            <div className="lobby-create-row">
              <span>Or make a space of your own.</span>
              <button onClick={() => setCreating(true)} disabled={props.entering}>
                <Plus size={14} />
                New space
              </button>
            </div>
          </section>
        </>
      )}
      <footer className="experience-footer">
        <span>MADE OF PEOPLE & POSSIBILITIES</span>
        <span className="experience-footer-right">
          <i /> LIVE
        </span>
      </footer>
      {props.notice && (
        <div className="experience-notice" role="status">
          {props.notice}
        </div>
      )}
      {creating && (
        <div className="create-space-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCreating(false)}>
          <form
            className="create-space-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Create a space"
            onKeyDown={(event) => event.key === "Escape" && setCreating(false)}
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) props.onCreate({ name: name.trim(), visibility, theme, voice: microphone });
            }}
          >
            <button type="button" className="create-space-close" aria-label="Close" onClick={() => setCreating(false)}>
              <X size={18} />
            </button>
            <span className="lobby-eyebrow">A FRESH START</span>
            <h2>
              Make yourself
              <br />
              some room.
            </h2>
            <label htmlFor="space-name">What shall we call it?</label>
            <input id="space-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Friday planning" autoFocus required />
            <label>Start with</label>
            <div className="theme-picker" role="radiogroup" aria-label="Theme">
              {THEMES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  role="radio"
                  aria-checked={theme === item.id}
                  className={theme === item.id ? "is-active" : ""}
                  onClick={() => setTheme(item.id)}
                >
                  <i style={{ background: `linear-gradient(135deg, ${item.environment.background}, ${item.environment.floor})`, borderColor: item.color }} />
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
            <label htmlFor="space-visibility">Who can find it?</label>
            <select id="space-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)}>
              <option value="private">Private · invitation only</option>
              <option value="unlisted">Unlisted · anyone with the link can visit</option>
              <option value="public">Public · listed in the directory</option>
            </select>
            <button className="experience-primary" disabled={props.entering || !name.trim()}>
              {props.entering ? "Making your space…" : "Create & enter"}
              <ArrowRight size={18} />
            </button>
            <p>You own this space. Invite people to visit or build once you’re inside.</p>
          </form>
        </div>
      )}
    </main>
  );
}

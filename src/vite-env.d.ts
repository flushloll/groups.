/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Optional fallback realtime origin; normally the server reports it with each ticket. */
  readonly VITE_GROUPS_REALTIME_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

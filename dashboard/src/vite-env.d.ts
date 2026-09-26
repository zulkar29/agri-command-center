/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API, used by src/services/http.ts. See .env.example. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

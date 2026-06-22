/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USAGE_METRICS_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

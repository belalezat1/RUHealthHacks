/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'mock' | 'live'
  readonly VITE_REPORT_ENDPOINT?: string
  readonly VITE_CSRF_HEADER_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
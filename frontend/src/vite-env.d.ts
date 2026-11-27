/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** "true" habilita el botón Pausar sesión (contrato backend B1). */
  readonly VITE_FEATURE_SESSION_PAUSE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

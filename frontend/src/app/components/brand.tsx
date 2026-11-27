/** Nombre corto y largo del sistema; fuente única para la marca visible. */
export const APP_NAME = "UAM SIAT";
export const APP_FULL_NAME = "Sistema Integrado de Aplicación de Tests";

/**
 * Isotipo UAM SIAT: círculo teal con anillo (guiño al sello de UAM Virtual)
 * y un portapapeles con check que representa la aplicación de tests.
 */
export function BrandMark({ className = "h-10 w-10", onDark = false }: { className?: string; onDark?: boolean }) {
  const fill = onDark ? "#ffffff" : "var(--brand)";
  const ink = onDark ? "var(--sidebar)" : "#ffffff";
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="30" fill={fill} />
      <circle cx="32" cy="32" r="25" fill="none" stroke={ink} strokeWidth="3" />
      <rect x="22" y="18" width="20" height="28" rx="3" fill="none" stroke={ink} strokeWidth="3" />
      <rect x="27" y="15" width="10" height="6" rx="2" fill={ink} />
      <path d="M26.5 33l4 4 7-8" fill="none" stroke={ink} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Marca del sistema. `light` es para fondos teal (sidebar, panel de login);
 * por defecto se asume fondo claro. `compact` deja solo el isotipo.
 */
export function Brand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" aria-label={`${APP_NAME} · ${APP_FULL_NAME}`} role="img">
      <BrandMark className={compact ? "h-9 w-9" : "h-11 w-11"} onDark={light} />
      {!compact && (
        <div className="leading-none font-[family-name:var(--font-display)]">
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-sm font-bold tracking-wide ${
                light ? "bg-white text-sidebar" : "bg-primary text-primary-foreground"
              }`}
            >
              UAM
            </span>
            <span className={`text-xl font-bold tracking-tight ${light ? "text-white" : "text-primary"}`}>SIAT</span>
          </div>
          <div
            className={`mt-1 text-[11px] font-medium leading-tight max-w-[12rem] ${
              light ? "text-white" : "text-muted-foreground"
            }`}
          >
            {APP_FULL_NAME}
          </div>
        </div>
      )}
    </div>
  );
}

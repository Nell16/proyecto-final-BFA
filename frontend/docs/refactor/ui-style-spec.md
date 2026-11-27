# UAM SIAT — Especificación de Estilo UI/UX (Producción)

> **Actualización de marca (2026-11):** la paleta pasó del azul `#0F2649` al teal de la identidad UAM Virtual (`--brand #0099a8`, `--primary #007c87`, `--brand-deep #036a70`), con Poppins para títulos. La fuente de verdad es `src/styles/theme.css`; los valores de color citados abajo son históricos.

Sistema institucional de evaluación psicométrica (Universidad Americana — Psicología).
Stack existente: **React 18, Vite, Tailwind 4, shadcn/Radix (`src/app/components/ui`), `lucide-react`, `sonner`, `motion`, `react-resizable-panels`**. No se introducen librerías nuevas.

Principios rectores: **seriedad clínica/institucional**, **tokens semánticos estrictos** (prohibido hardcodear `bg-emerald-100`, `bg-amber-50`, `bg-rose-*`, `bg-[#fafafa]`), **jerarquía sin ruido** (eliminar microtextos `10–11px uppercase` y elementos decorativos inertes), **contraste WCAG AA** y **cero `alert()`/`confirm()` nativos**.

---

## 1. Design Tokens (`src/styles/theme.css`)

### 1.1 Paleta semántica (Light & Dark)

Compatible con la estructura actual de `theme.css` (`:root`, `.dark`, `@theme inline`). Conserva el azul UAM `#0F2649` como ancla de marca y corrige el modo oscuro hacia una gama *navy-slate* coherente.

```css
:root {
  /* Superficies */
  --background: #f6f8fb;          /* Canvas general (reemplaza #fafafa) */
  --card: #ffffff;                /* Tarjetas, tablas, paneles elevados */
  --popover: #ffffff;             /* Menús, tooltips, diálogos */
  --muted: #eef2f7;               /* Superficie sutil, cabeceras de tabla */
  --input-background: #ffffff;    /* Fondo de inputs con borde visible */
  --switch-background: #cbd5e1;

  /* Texto (niveles con AA >= 4.5:1 sobre --card y --background) */
  --foreground: #0f172a;          /* Nivel 1: títulos, contenido principal */
  --card-foreground: #0f172a;
  --popover-foreground: #0f172a;
  --muted-foreground: #475569;    /* Nivel 2: subtítulos, metadatos, labels secundarios */
  --text-tertiary: #64748b;       /* Nivel 3: placeholders, timestamps, ayuda */

  /* Marca UAM */
  --primary: #0f2649;
  --primary-hover: #173666;
  --primary-foreground: #ffffff;
  --secondary: #e8eef6;
  --secondary-foreground: #0f2649;
  --accent: #e1eaf6;
  --accent-foreground: #0f2649;

  /* Bordes y foco */
  --border: #dce3ec;              /* Separadores, tarjetas */
  --border-strong: #94a3b8;       /* Inputs, controles interactivos (>= 3:1) */
  --input: #cbd5e1;
  --ring: #1d4ed8;

  /* Destructivo (alias de danger-solid para compatibilidad shadcn) */
  --destructive: #b91c1c;
  --destructive-foreground: #ffffff;

  /* Estados semánticos */
  --status-success-bg: #ecfdf5;   --status-success-fg: #065f46;   --status-success-border: #a7f3d0;   --status-success-solid: #047857;
  --status-warning-bg: #fffbeb;   --status-warning-fg: #92400e;   --status-warning-border: #fde68a;   --status-warning-solid: #b45309;
  --status-danger-bg:  #fef2f2;   --status-danger-fg:  #991b1b;   --status-danger-border:  #fecaca;   --status-danger-solid:  #b91c1c;
  --status-info-bg:    #eff6ff;   --status-info-fg:    #1e40af;   --status-info-border:    #bfdbfe;   --status-info-solid:    #1d4ed8;
  --status-neutral-bg: #f1f5f9;   --status-neutral-fg: #334155;   --status-neutral-border: #cbd5e1;   --status-neutral-solid: #475569;

  /* Sidebar institucional */
  --sidebar: #0f2649;
  --sidebar-foreground: #e2e8f0;
  --sidebar-primary: #ffffff;
  --sidebar-primary-foreground: #0f2649;
  --sidebar-accent: rgba(255, 255, 255, 0.14);
  --sidebar-accent-foreground: #ffffff;
  --sidebar-border: rgba(255, 255, 255, 0.12);
  --sidebar-ring: #60a5fa;

  /* Radios y sombras */
  --radius: 0.5rem; /* 8px base: sm=4px, md=6px, lg=8px, xl=12px */
  --shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-md: 0 6px 16px rgba(15, 23, 42, 0.08);
}

.dark {
  --background: #0b1120;
  --card: #111a2e;
  --popover: #16223b;
  --muted: #18243d;
  --input-background: #0f172a;
  --switch-background: #334155;

  --foreground: #f1f5f9;
  --card-foreground: #f1f5f9;
  --popover-foreground: #f1f5f9;
  --muted-foreground: #94a3b8;
  --text-tertiary: #7c8da6;

  --primary: #5b9bf3;
  --primary-hover: #7bb0f7;
  --primary-foreground: #071326;
  --secondary: #1b2a46;
  --secondary-foreground: #e2e8f0;
  --accent: #1e3152;
  --accent-foreground: #f1f5f9;

  --border: #23324d;
  --border-strong: #3b5075;
  --input: #2b3d5c;
  --ring: #60a5fa;

  --destructive: #dc2626;
  --destructive-foreground: #ffffff;

  --status-success-bg: #062b22;   --status-success-fg: #6ee7b7;   --status-success-border: #0f513d;   --status-success-solid: #10b981;
  --status-warning-bg: #2d1e08;   --status-warning-fg: #fcd34d;   --status-warning-border: #6b440e;   --status-warning-solid: #f59e0b;
  --status-danger-bg:  #2e1015;   --status-danger-fg:  #fca5a5;   --status-danger-border:  #6f1d29;   --status-danger-solid:  #dc2626;
  --status-info-bg:    #0f2042;   --status-info-fg:    #93c5fd;   --status-info-border:    #1e3f7a;   --status-info-solid:    #3b82f6;
  --status-neutral-bg: #1e293b;   --status-neutral-fg: #cbd5e1;   --status-neutral-border: #334155;   --status-neutral-solid: #64748b;

  --sidebar: #080e1a;
  --sidebar-foreground: #cbd5e1;
  --sidebar-primary: #5b9bf3;
  --sidebar-primary-foreground: #071326;
  --sidebar-accent: rgba(91, 155, 243, 0.16);
  --sidebar-accent-foreground: #f8fafc;
  --sidebar-border: #1e293b;
  --sidebar-ring: #60a5fa;

  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-sm: 0 2px 6px rgba(0, 0, 0, 0.35);
  --shadow-md: 0 10px 24px rgba(0, 0, 0, 0.45);
}
```

> En `@theme inline` mapear todas las nuevas variables (`--color-primary-hover`, `--color-border-strong`, `--color-text-tertiary`, `--color-status-{success,warning,danger,info,neutral}-{bg,fg,border,solid}`).

### 1.2 Tipografía, espaciado, superficies y tablas

- **Familias** (`src/styles/fonts.css`): `--font-sans: "Inter", system-ui, -apple-system, sans-serif;` y `--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;` para códigos (`SES-...`, tokens, IDs) y contadores. Usar siempre `tabular-nums` en KPIs, cronómetros, porcentajes y columnas numéricas.
- **Escala tipográfica** (regla dura: **nada menor a `12px` (`text-xs`)**; `uppercase tracking-wider` reservado **exclusivamente** a encabezados de grupo en sidebar):
  | Rol | Clase Tailwind | Tamaño / Line-height | Peso |
  | :--- | :--- | :--- | :--- |
  | Page Title (`h1`) | `text-xl font-semibold tracking-tight` | 20px / 28px | 600 |
  | Section / Card Title (`h2`) | `text-base font-semibold` | 16px / 24px | 600 |
  | Subheading / Group (`h3`) | `text-sm font-semibold` | 14px / 20px | 600 |
  | Body / Table Cell / Input | `text-sm font-normal` | 14px / 20px | 400 |
  | Label de formulario | `text-sm font-medium text-foreground` | 14px / 20px | 500 |
  | Caption / Meta / Badge | `text-xs font-medium` | 12px / 16px | 500 |
  | KPI numérico | `text-2xl font-semibold tabular-nums` | 24px / 32px | 600 |
  | Sidebar Group | `text-[11px] font-semibold uppercase tracking-wider` | 11px / 16px | 600 |
- **Espaciado**: cuadrícula de 4px (`gap-4`/`16px` interno de cards, `gap-6`/`24px` entre secciones, padding de `<main>` = `p-4 md:p-6`, ancho máximo de lectura en formularios largos = `max-w-5xl`).
- **Tarjetas y bordes**: reemplazar `border-0 shadow-sm` por `border border-border bg-card rounded-lg shadow-[var(--shadow-xs)]`. Usar `--shadow-md` solo en `Dialog`, `Popover`, `DropdownMenu` y paneles flotantes.
- **Densidad de tablas**:
  - **Estándar (CRUD/catálogos)**: fila `h-11` (44px), celda `px-4 py-2.5`.
  - **Compacta (baremos/auditoría/ítems)**: fila `h-9` (36px), celda `px-3 py-1.5`.
  - **Monitor en vivo (con avatar + subtexto)**: fila `h-14` (56px), celda `px-4 py-3`.
  - Cabecera `TableHeader`: `bg-muted/70 text-xs font-semibold text-muted-foreground border-b border-border` (sin `uppercase` agresivo).

---

## 2. Mapa de Estados → Estilo Visual

Centralizar en un único componente `<StatusBadge domain status />` basado en `Badge` con estilo *soft bordered* (`border bg-status-{tone}-bg text-status-{tone}-fg border-status-{tone}-border rounded-full px-2.5 py-0.5 text-xs font-medium inline-flex items-center gap-1.5`). **Prohibido `animate-pulse` sobre el badge completo**: los estados activos usan un punto indicador (`size-1.5 rounded-full bg-status-{tone}-solid`).

| Dominio | Estado | Etiqueta UI | Tono semántico | Icono (`lucide-react`, 14px) | Detalle extra |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Sesión** | `PROGRAMADA` | Programada | `info` | `CalendarClock` | — |
| | `ABIERTA` | Abierta (En vivo) | `success` | `Radio` | Punto verde vivo |
| | `CERRADA` | Cerrada | `neutral` | `Lock` | — |
| | `CANCELADA` | Cancelada | `danger` | `Ban` | — |
| **Asignación** | `ASIGNADO` | Asignado | `neutral` | `Ticket` | Token listo, sin ingreso |
| | `EN_PROGRESO` | En progreso | `info` | `Play` | Punto azul vivo |
| | `COMPLETADO` | Completado | `success` | `CheckCircle2` | — |
| | `ANULADO` | Anulado | `danger` | `XCircle` | — |
| | `EXPIRADO` | Expirado | `warning` | `ClockAlert` | — |
| **Intento / Subtest** | `NO_INICIADO` | No iniciado | `neutral` | `CircleDashed` | — |
| | `EN_PROGRESO` | En progreso | `info` | `Play` | Punto azul vivo |
| | `COMPLETADO` | Completado | `success` | `CheckCircle2` | — |
| | `INTERRUMPIDO` | Interrumpido | `warning` | `WifiOff` | Resaltar fila en monitor |
| | `ANULADO` | Anulado | `danger` | `XCircle` | — |
| **Versión de instrumento** | `BORRADOR` | Borrador | `warning` | `FileEdit` | Editable |
| | `APROBADO` | Aprobado | `info` | `ShieldCheck` | Listo para publicar |
| | `EN_REVISION` | En revisión | `info` | `FileEdit` | Solo lectura |
| | `PUBLICADO` | Publicado | `success` | `Globe` | Solo lectura |
| | `RETIRADO` | Retirado | `neutral` | `Archive` | Solo lectura / archivada |

---

## 3. Patrones de Interfaz y Layout

### 3.1 Shell administrativo y `PageHeader` (`src/routes/app.tsx`)

- **Limpieza del Topbar**: eliminar `<Input>` buscador y `<Button><Bell /></Button>` sin funcionalidad. Mantener topbar delgada (`h-14 border-b border-border bg-card`) con: trigger de sidebar móvil (`Sheet`), `Breadcrumb` de la ruta actual a la izquierda, y a la derecha el badge discreto `Confidencial · UAM` (`neutral` con icono `Shield`, sin rojo destructivo) + toggle de tema claro/oscuro opcional.
- **Unificación de cabecera**: eliminar el doble header actual (header estático + div `Dynamic Section Header` en `app.tsx`). Cada vista renderiza un componente `<PageHeader>` dentro de `<main>`:

```text
┌──────────────┬─────────────────────────────────────────────────────────────┐
│ SIDEBAR 248px│ [≡] Inicio / Aplicación / Monitor de sesiones   [🛡 UAM]   │ (h-14)
│ bg-sidebar   ├─────────────────────────────────────────────────────────────┤
│              │ Monitor de sesiones                    [ Exportar ] [+ Nueva]│ PageHeader
│ [Brand]      │ Estado en tiempo real y control de laboratorio              │
│ ──────────── │ ─────────────────────────────────────────────────────────── │
│ GENERAL      │                                                             │
│  Inicio      │   <Contenido de página sobre bg-background>                 │
│ APLICACIÓN   │                                                             │
│ ● Sesiones   │                                                             │
│  Particip.   │                                                             │
│ ──────────── │                                                             │
│ [AV] Nombre  │                                                             │
│ Rol   [⎋]   │                                                             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 3.2 Tablas con filtros y paginación

- **Contenedor**: `Card` (`p-0 overflow-hidden`) con 3 bandas:
  1. **Toolbar** (`px-4 py-3 border-b border-border flex flex-wrap items-center gap-2`): buscador (`w-64`), filtros `Select`/chips a la izquierda; contador (`"24 registros"`) y acciones secundarias a la derecha. Si hay filtros activos, mostrar botón `Limpiar filtros`.
  2. **Tabla**: hover sutil (`hover:bg-muted/40`), alineación izquierda para texto, derecha + `tabular-nums` para números/fechas, columna de acciones fija a la derecha (`1–2` acciones frecuentes visibles; el resto en `DropdownMenu` con `MoreHorizontal`).
  3. **Pie** (`px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between`): `"Mostrando 1–20 de 86"` + `Pagination` (`ui/pagination.tsx`).

### 3.3 Formularios y validación inline

- Reemplazar todos los `alert("Debes indicar...")` (como en `session-create.tsx`) por validación inline.
- Estructura del campo: `<Label>` (`text-sm font-medium`) + asterisco `*` (`text-status-danger-fg`) si es requerido → control con `aria-invalid={!!error}` (borde `border-status-danger-solid ring-2 ring-status-danger-bg`) → texto de ayuda (`text-xs text-muted-foreground`) o error (`text-xs text-status-danger-fg flex items-center gap-1`).
- En formularios de varias secciones (`session-create.tsx`): layout 2:1 en `lg` con panel resumen lateral `sticky top-6` que muestra checklist de requisitos cumplidos antes de habilitar el CTA primario.

### 3.4 Diálogos de confirmación destructiva (reemplazo de `confirm()`)

- Usar `AlertDialog` (`ui/alert-dialog.tsx`) para toda acción irreversible (cerrar sesión en vivo, eliminar subtest/ítem, anular asignación, publicar versión).
- Anatomía obligatoria: icono de tono (`danger` o `warning`) + título con verbo de acción (`"¿Cerrar sesión de laboratorio?"`) + descripción concreta del impacto (ej. *"Se revocarán 4 tokens sin usar y se cerrarán 2 intentos en curso"*) + footer con `Cancelar` (`variant="outline"`, foco inicial en acciones críticas) y botón de acción con verbo exacto (`"Cerrar sesión"`, `variant="destructive"`).

### 3.5 Feedback: Toasts (`sonner`) vs `Alert` inline

| Situación | Componente | Regla |
| :--- | :--- | :--- |
| Éxito efímero (guardado, token copiado, nota creada) | `toast.success()` (`sonner`) | 3–4s, esquina inferior derecha, sin bloquear flujo |
| Error de acción puntual (fallo al copiar o guardar) | `toast.error()` + detalle corto | 6s; si requiere corrección de campos, usar `Alert` inline |
| Estado persistente del contexto (versión publicada solo lectura, modo offline, error de carga) | `<Alert>` inline | Borde y fondo `--status-*-bg/border/fg`, sin auto-ocultar |
| Aviso de confidencialidad o advertencia de seguridad | `<Alert>` tono `info` o `warning` | Compacto, nunca `danger` salvo riesgo inminente |

### 3.6 Empty, Loading (Skeleton) y Error States

- **Empty**: usar `EmptyState` (`ui/empty-state.tsx`) en 2 variantes: `default` (página sin datos, `min-h-[260px]`, icono 24px dentro de círculo `h-12 w-12 bg-muted`, título `text-base`, descripción y CTA) y `compact` (dentro de tablas/cards: `py-10`, sin bordes punteados pesados ni iconos gigantes de 48px). Distinguir *"Sin registros aún"* (con CTA crear) vs *"Sin resultados para este filtro"* (con CTA limpiar filtros).
- **Loading**: **preferir `Skeleton` (`ui/skeleton.tsx`)** replicando la geometría real (filas de tabla, grid de KPIs, editor de ítem) para evitar saltos de layout. Reservar `LoadingState` (spinner) solo para transiciones de autenticación o descargas/cálculos en modal.
- **Error**: contenedor con `border-status-danger-border bg-status-danger-bg/60 rounded-lg p-6 text-center` con icono `AlertCircle`, mensaje humano (sin stacktraces) y botón `Reintentar` (`variant="outline"`).

---

## 4. Runner del Participante (Modo Examen)

Pantalla libre de distracciones: sin sidebar, sin enlaces externos, `select-none` y `onContextMenu` bloqueado sobre estímulos y opciones. Canvas externo `--background` (`#F6F8FB`) con superficie de trabajo `--card` (`#FFFFFF`) para reducir deslumbramiento en sesiones largas de laboratorio.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ [BFA] Subtest 2: Desplazamiento · Ítem 6/20  [● Guardado] [⏱ 04:12] [▦] │ h-14
│ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ h-1
├─────────────────────────────────────────────────────────────────────────┤
│ (Solo si offline) ⚠ Sin conexión · Respuestas en cola local (2)         │
├─────────────────────────────────────────────────────────────────────────┤
│                     ┌───────────────────────────────────┐               │
│                     │  Ítem 6 de 20                     │               │
│                     │  ¿Qué figura continúa la serie?   │               │
│                     │  ┌─────────────────────────────┐  │               │
│                     │  │    [ Estímulo / Imagen ]    │  │               │
│                     │  └─────────────────────────────┘  │               │
│                     │  ┌────────┐ ┌────────┐ ┌────────┐ │               │
│                     │  │[A] img │ │[B]●img │ │[C] img │ │               │
│                     │  └────────┘ └────────┘ └────────┘ │               │
│                     └───────────────────────────────────┘               │
├─────────────────────────────────────────────────────────────────────────┤
│ [ ← Anterior ]           6 / 20 respondidos          [ Siguiente → ]    │ h-16
└─────────────────────────────────────────────────────────────────────────┘
```

- **Header fijo (`h-14`)**: marca compacta, título del subtest + `Ítem X de N`, pill de guardado (`Guardando...` info / `Guardado` success / `Pendiente` warning), **cronómetro** (`font-mono text-sm font-semibold tabular-nums px-3 py-1.5 rounded-md`) con 3 estados:
  - Normal (`> 120s`): `bg-muted text-foreground`.
  - Advertencia (`30–120s`): `bg-status-warning-bg text-status-warning-fg border border-status-warning-border`.
  - Crítico (`< 30s`): `bg-status-danger-bg text-status-danger-fg border border-status-danger-border` (transición sobria, **sin `animate-pulse` continuo** que induzca ansiedad o reduzca legibilidad).
- **Mapa de ítems (`[▦]` en header / `Sheet` o `Popover`)**: grilla numerada `grid-cols-5 sm:grid-cols-8 gap-2`, cada celda mínimo `44×44px`:
  - **Actual**: `border-2 border-primary bg-primary/10 text-primary font-semibold`.
  - **Respondido**: `bg-primary text-primary-foreground`.
  - **Sin responder**: `border border-border bg-card text-muted-foreground`.
- **Opciones con imágenes en grilla**:
  - 2 opciones → `grid-cols-1 sm:grid-cols-2`; 3–4 opciones → `grid-cols-2 lg:grid-cols-4`; 5+ → `grid-cols-2 md:grid-cols-3`.
  - Cada tarjeta de opción (`button` con `role="radio"` dentro de `role="radiogroup"`): `min-h-[148px] p-4 rounded-lg border-2 transition-colors`. Inactiva: `border-border bg-card hover:border-border-strong`. Seleccionada: `border-primary bg-accent/60 ring-2 ring-primary/20`.
  - Imágenes (`AuthenticatedImage`): contenedor `aspect-[4/3]` o `max-h-36` con fondo blanco explícito (`bg-white rounded p-2`) incluso en modo oscuro si las láminas psicométricas tienen fondo claro/trazo negro; placeholder `Skeleton` de misma altura + botón `Reintentar` si falla la carga.
- **Ergonomía táctil (tablet)**: todos los botones de navegación (`Anterior`, `Siguiente`, `Finalizar subtest`) en `h-12 px-5` (48px), separación mínima `gap-3` (12px) entre tarjetas y botones.
- **Accesibilidad teclado y lectores**:
  - Teclas `A`/`B`/`C`/`D` (o `1`–`4`) seleccionan opción cuando no hay foco en un `<input>`/`<textarea>`; `ArrowLeft`/`ArrowRight` navegan ítems; indicador visual de tecla (`A`) en chip `h-7 w-7 rounded-md font-mono font-semibold`.
  - `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring`.
  - Región `aria-live="polite"` para cambios de guardado/offline y `aria-live="assertive"` al llegar a 2:00 y 0:30 restantes.
  - Al agotarse el tiempo o pulsar `Finalizar subtest`: usar `AlertDialog` modal en vez de `alert()`, informando si faltan ítems sin responder.

---

## 5. Monitor de Sesión en Vivo (`/app/sesiones/$id`)

Diseñado para lectura rápida en laboratorio (escaneo en < 3 segundos de incidencias o caídas).

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ ← Sesiones / Cohorte 2026-I · Lab 3   [● Abierta]  [Pausar] [Cerrar]    │
│ Sincronizado hace 3s · 14/20 completados ██████████████░░░░░░ 70%       │
├──────────┬──────────┬──────────┬──────────┬─────────────────────────────┤
│ Asignados│ En curso │Completad.│! Caídos  │ En espera                   │
│   20     │    4     │   14     │    1     │    1      (clic = filtra)   │
├──────────┴──────────┴──────────┴──────────┴─────────────────────────────┤
│ [Buscar participante...] [Estado ▾]              [Asignaciones & Tokens]│
│ Participante        Subtest        Progreso        Estado     Actividad │
│ ⚠ Ana Ruiz (1042)   Desplazam.     ████░░ 45%   [Interrump.]  hace 4m   │ ← fila tinted warning
│   Luis Mora (1039)  Espacial       ██████ 75%   [En progreso] hace 8s   │
│   Carla Paz (1018)  Finalizado     ██████ 100%  [Completado]  hace 2m   │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Jerarquía de KPIs** (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3`):
  - Cada KPI es un botón/filtro interactivo (`aria-pressed`): al hacer clic filtra la tabla por ese estado (con borde `border-primary` activo).
  - **Énfasis condicional**: la tarjeta **Interrumpidos / Caídos** solo adopta `border-status-warning-border bg-status-warning-bg/50` cuando `count > 0`; en `0` se muestra neutra para no generar fatiga de alerta.
  - Barra de avance global de la sesión (`Progress h-1.5`) en la cabecera de la tarjeta principal junto al timestamp de último polling (`Actualizado hace 4s` en `text-xs text-muted-foreground tabular-nums`).
- **Tabla de participantes**:
  - Orden por defecto recomendado: `INTERRUMPIDO` arriba → `EN_PROGRESO` → `NO_INICIADO` → `COMPLETADO` / `ANULADO`.
  - Fila de participante `INTERRUMPIDO`: borde izquierdo `border-l-2 border-l-status-warning-solid bg-status-warning-bg/30`.
  - Columna **Acciones**: `Nota` (`MessageSquare`) siempre accesible para activos; `Ver respuestas` y `Calificar` agrupados limpiamente (ocultar botones deshabilitados con textos técnicos como *"Sin attemptId"*, mostrar tooltip si no está disponible).
- **Bitácora de incidencias**: lista vertical con línea de tiempo compacta (`font-mono text-xs` para hora + nombre participante + nota), mismo contenedor `Card` debajo de la tabla.

---

## 6. Creador de Tests (`/app/instrumentos/...`)

### 6.1 Decisión: Editor libre estructurado vs Wizard

**Recomendación: Editor libre de 3 paneles** (con creación inicial mínima en `Dialog` para alta de Test + primera versión `BORRADOR`, y un **Checklist de Publicación** integrado).
**Justificación**: La autoría psicométrica es iterativa y no lineal — los psicólogos ajustan ítems, suben láminas, reordenan subtests y afinan baremos en múltiples sesiones parciales. Un wizard paso a paso bloquea saltos entre subtests/ítems y penaliza revisiones, mientras un editor libre con árbol + validación por nodo combina agilidad diaria con control estricto antes de publicar.

### 6.2 Layout de 3 paneles (`ResizablePanelGroup`)

En viewports `< 1280px`, el panel derecho pasa a `Tabs` (`Editar` | `Vista previa`) y el árbol izquierdo se colapsa en `Sheet`.

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ ← Instrumentos / BFA-2026 [v1.2 · Borrador ▾]   [● Sin guardar] [Publicar]│ Toolbar fija
├───────────────────┬────────────────────────────────┬──────────────────────┤
│ ESTRUCTURA (272px)│ EDITOR CENTRAL (fluido)        │ PANEL DERECHO (340px)│
│                   │                                │ [Vista previa|Valid.]│
│ ⚙ Datos versión ✓ │ Subtest 1 › Ítem 04            │ ┌──────────────────┐ │
│ ───────────────── │ [Guardar ítem] [Duplicar] [🗑]  │ │ Simulación runner│ │
│ SUBTESTS     [+]  │                                │ │ Ítem 4           │ │
│ ▾ ⠿ 1. Figuras  ✓ │ Enunciado / Consigna           │ │ [Estímulo]       │ │
│     ⠿ IT-01     ✓ │ [____________________________] │ │ ┌────┐ ┌────┐    │ │
│     ⠿ IT-02     ✓ │                                │ │ │ A  │ │ B✓ │    │ │
│   ▸ ⠿ IT-04   ● ! │ Tipo: [Texto e imagen ▾]       │ │ └────┘ └────┘    │ │
│ ▸ ⠿ 2. Espacial ! │ Opciones y clave correcta      │ └──────────────────┘ │
│ ───────────────── │ (●) A [texto / imagen]         │ Validación del nodo: │
│ ▤ Baremos       ✓ │ ( ) B [texto / imagen]         │ ⚠ Falta alt-text     │
│ ☑ Publicación 4/5 │ [+ Añadir opción]              │ ✓ Clave asignada     │
└───────────────────┴────────────────────────────────┴──────────────────────┘
```

- **Panel izquierdo — Árbol (`260–300px`)**:
  - Selector de versión arriba (`v1.2 Borrador`, `v1.1 Publicada`, `+ Nueva versión`).
  - Nodos fijos (`Datos de versión`, `Baremos`, `Revisión y publicación`) y jerarquía expandible `Subtest → Ítems` con `GripVertical` para drag-and-drop (solo activo en `BORRADOR`).
  - Botones de acción al final de cada grupo (`+ Nuevo subtest`, `+ Reutilizar`, `+ Nuevo ítem`).
- **Panel central — Editor contextual**:
  - Muestra **solo** el formulario del nodo activo (evita la página actual de 3000px con tabla de subtests + editor de ítems + baremos apilados).
  - En versión distinta de `BORRADOR`: banner superior `Alert` tono `info` (no `amber animate-pulse`) con texto *"Versión bloqueada en solo lectura"* y botón `Crear nueva versión borrador`; campos en `readOnly`/disabled limpio.
- **Panel derecho — Inspector (`320–360px`, colapsable)**:
  - Tab **Vista previa**: renderiza el ítem actual con las mismas clases visuales del Runner del participante (incluyendo toggle Escritorio / Tablet) para verificar imágenes y recorte antes de publicar.
  - Tab **Validación**: muestra errores/advertencias del nodo actual y enlace directo al nodo `Revisión y publicación` con el checklist completo.

### 6.3 Indicadores de borrador sin guardar y validación por nodo

- **Estado dirty (sin guardar)**:
  - Punto ámbar (`size-2 rounded-full bg-status-warning-solid`) junto al nombre del nodo modificado en el árbol.
  - Pill en toolbar superior: `Cambios sin guardar` (`warning`) junto al botón primario `Guardar` (con atajo `⌘S`/`Ctrl+S`).
  - Al intentar cambiar de versión o salir de la ruta con cambios pendientes: `AlertDialog` (*"Descartar cambios"* / *"Seguir editando"*).
- **Validación por nodo (icono de 14px alineado a la derecha en el árbol)**:
  - **Válido**: `CheckCircle2` (`text-status-success-fg`) — cumple requisitos de publicación.
  - **Advertencia no bloqueante**: `AlertTriangle` (`text-status-warning-fg`) — ej. sin texto alternativo o sin tiempo límite en subtest.
  - **Error bloqueante**: `AlertCircle` (`text-status-danger-fg`) — ej. ítem sin clave de respuesta correcta, subtest sin ítems, baremo con rangos solapados. Deshabilita `Publicar` hasta resolverlos y lista cada error como enlace que enfoca el nodo exacto en el árbol.

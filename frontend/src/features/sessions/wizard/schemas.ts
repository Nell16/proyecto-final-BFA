import { z } from "zod";
import { toServerDateTime } from "../../../api/schemas/datetime";
import type { CreateSessionRequest } from "../../../api/schemas/sessions";

/** Parámetros de búsqueda de /app/sesiones/nueva: `sessionId` permite reanudar el wizard. */
export const wizardSearchSchema = z.object({
  sessionId: z.coerce.number().int().positive().optional().catch(undefined),
});

export type WizardSearch = z.output<typeof wizardSearchSchema>;

const SESSION_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

/** Paso 1: datos de la sesión + instrumento (la versión no se puede cambiar tras crear la sesión). */
export const sessionDataSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre es obligatorio.").max(150, "Máximo 150 caracteres."),
    code: z
      .string()
      .trim()
      .min(1, "El código es obligatorio.")
      .max(80, "Máximo 80 caracteres.")
      .regex(SESSION_CODE_PATTERN, "Use solo letras, números, punto, guion y guion bajo."),
    date: z.string().regex(DATE_PATTERN, "La fecha es obligatoria."),
    startTime: z.string().regex(TIME_PATTERN, "La hora de inicio es obligatoria."),
    endTime: z.string().regex(TIME_PATTERN, "La hora de fin es obligatoria."),
    location: z.string().trim(),
    description: z.string().trim(),
    /** IDs como texto: son los `value` de los controles nativos (select/radio). */
    testId: z.string().min(1, "Seleccione un instrumento."),
    versionId: z.string().min(1, "Seleccione una versión publicada."),
  })
  .refine((v) => !TIME_PATTERN.test(v.startTime) || !TIME_PATTERN.test(v.endTime) || v.endTime > v.startTime, {
    path: ["endTime"],
    message: "La hora de fin debe ser posterior a la de inicio.",
  });

export type SessionDataValues = z.output<typeof sessionDataSchema>;

const hhmm = (time: string): string => time.slice(0, 5);

/** Fecha + hora tal como las escribió el usuario (zona del navegador) → `LocalDateTime` UTC del backend. */
const localToServer = (date: string, time: string): string =>
  toServerDateTime(new Date(`${date}T${hhmm(time)}:00`));

export function toCreateSessionRequest(values: SessionDataValues): CreateSessionRequest {
  return {
    versionTestId: Number(values.versionId),
    code: values.code,
    name: values.name,
    ...(values.description !== "" ? { description: values.description } : {}),
    scheduledStart: localToServer(values.date, values.startTime),
    scheduledEnd: localToServer(values.date, values.endTime),
    ...(values.location !== "" ? { location: values.location } : {}),
  };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Sufijo aleatorio de 4 caracteres (sin 0/O/1/I para evitar confusiones al dictarlo). */
export function randomCodeSuffix(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** `SES-AAAAMMDD-XXXX`. `date` es `YYYY-MM-DD`; si no es válida se usa la fecha de hoy. */
export function generateSessionCode(date: string, suffix: string): string {
  const compact = DATE_PATTERN.test(date) ? date.replaceAll("-", "") : todayIsoDate().replaceAll("-", "");
  return `SES-${compact}-${suffix}`;
}

export function todayIsoDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Enlace de acceso del participante. El `rawToken` NUNCA se persiste: solo vive en memoria. */
export function buildAccessUrl(accessCode: string): string {
  return `${window.location.origin}/evaluacion/${accessCode}`;
}

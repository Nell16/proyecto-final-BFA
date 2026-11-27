import { z } from "zod";
import { serverDateTime } from "./datetime";

export const BackupStatusSchema = z.enum(["GENERADO", "DESCONOCIDO"]).catch("DESCONOCIDO");
export type BackupStatus = z.output<typeof BackupStatusSchema>;

/** GET /backups, POST /backups -> BackupService.BackupView */
export const BackupSchema = z
  .object({
    fileName: z.string(),
    path: z.string(),
    sizeBytes: z.number(),
    generatedAt: serverDateTime,
    status: BackupStatusSchema,
  })
  .loose();
export type Backup = z.output<typeof BackupSchema>;
export const BackupListSchema = z.array(BackupSchema);

/** POST /backups/{fileName}/restore-requests -> BackupService.RestoreRequestView */
export const RestoreRequestSchema = z
  .object({
    fileName: z.string(),
    auditId: z.number(),
    requestedAt: serverDateTime,
  })
  .loose();
export type RestoreRequest = z.output<typeof RestoreRequestSchema>;

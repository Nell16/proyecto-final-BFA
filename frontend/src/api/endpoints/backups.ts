import { staffClient } from "../client";
import { filenameFromDisposition } from "../download";
import { unwrap, type ApiEnvelope } from "../errors";
import {
  BackupListSchema,
  BackupSchema,
  RestoreRequestSchema,
  type Backup,
  type RestoreRequest,
} from "../schemas/backups";
import { parseOrThrow } from "../schemas/parse";

export interface DownloadedBackup {
  fileName: string;
  blob: Blob;
}

export async function listBackups(): Promise<Backup[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/backups");
  return parseOrThrow(BackupListSchema, unwrap(res), "GET /backups");
}

export async function createBackup(): Promise<Backup> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/backups");
  return parseOrThrow(BackupSchema, unwrap(res), "POST /backups");
}

export async function downloadBackup(fileName: string): Promise<DownloadedBackup> {
  const res = await staffClient.get<Blob>(`/backups/${encodeURIComponent(fileName)}`, {
    responseType: "blob",
  });
  return {
    fileName: filenameFromDisposition(res.headers["content-disposition"], fileName),
    blob: res.data,
  };
}

export async function requestRestore(fileName: string): Promise<RestoreRequest> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(
    `/backups/${encodeURIComponent(fileName)}/restore-requests`,
  );
  return parseOrThrow(RestoreRequestSchema, unwrap(res), `POST /backups/${fileName}/restore-requests`);
}

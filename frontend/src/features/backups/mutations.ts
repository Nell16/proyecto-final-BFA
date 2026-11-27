import { useMutation, useQueryClient } from "@tanstack/react-query";
import { downloadBlobFile } from "../../api/download";
import {
  createBackup,
  downloadBackup,
  requestRestore,
} from "../../api/endpoints/backups";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import { backupKeys } from "./queries";

const scoped = createAccountScopedMutation();

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (_vars: void, ctx) => {
      scoped.guard(ctx);
      return createBackup();
    },
    onSuccess: (_backup, _vars, context) => {
      if (isScopeCurrent(context)) {
        void qc.invalidateQueries({ queryKey: backupKeys.list() });
      }
    },
  });
}

export function useDownloadBackup() {
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (fileName: string, ctx) => {
      scoped.guard(ctx);
      return downloadBackup(fileName);
    },
    onSuccess: (downloaded, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      downloadBlobFile(downloaded.fileName, downloaded.blob);
    },
  });
}

export function useRequestRestore() {
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (fileName: string, ctx) => {
      scoped.guard(ctx);
      return requestRestore(fileName);
    },
  });
}

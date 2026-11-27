import { queryOptions } from "@tanstack/react-query";
import { listBackups } from "../../api/endpoints/backups";

export const backupKeys = {
  all: ["backups"] as const,
  list: () => [...backupKeys.all, "list"] as const,
};

export const backupListQuery = () =>
  queryOptions({
    queryKey: backupKeys.list(),
    queryFn: listBackups,
  });

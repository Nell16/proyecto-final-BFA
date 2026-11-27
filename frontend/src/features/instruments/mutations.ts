import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  approveVersion,
  createTest,
  createVersion,
  publishVersion,
} from "../../api/endpoints/instruments";
import type { TestInstrument, TestPayload, TestVersion, VersionPayload } from "../../api/schemas/instruments";
import { wizardKeys } from "../sessions/wizard/wizard-queries";
import { captureAccountScope } from "../../store/accountScope";
import { createAccountScopedMutation, isScopeCurrent } from "../accountScopedMutation";
import {
  cloneVersionFromSource,
  IncompleteVersionCloneError,
  saveVersionDocument,
  type CloneVersionFromSourceInput,
  type SaveVersionDocumentInput,
} from "./document/adapters";
import { instrumentKeys } from "./queries";

const scoped = createAccountScopedMutation();

export function useCreateTest() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (payload: TestPayload, ctx) => {
      scoped.guard(ctx);
      return createTest(payload);
    },
    onSuccess: (test, _vars, context) => {
      if (isScopeCurrent(context)) {
        qc.setQueryData<TestInstrument[]>(instrumentKeys.tests(), (previous) =>
          [...(previous ?? []).filter((entry) => entry.id !== test.id), test],
        );
        void qc.invalidateQueries({ queryKey: wizardKeys.tests() });
        void qc.invalidateQueries({ queryKey: instrumentKeys.tests() });
      }
    },
  });
}

export function useCreateVersion(testId: number) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (payload: VersionPayload, ctx) => {
      scoped.guard(ctx);
      return createVersion(testId, payload);
    },
    onSuccess: (version, _vars, context) => {
      if (isScopeCurrent(context)) {
        qc.setQueryData<TestVersion[]>(instrumentKeys.versions(testId), (previous) =>
          [...(previous ?? []).filter((entry) => entry.id !== version.id), version],
        );
        void qc.invalidateQueries({ queryKey: instrumentKeys.versions(testId) });
      }
    },
  });
}

export function useCloneVersion(testId: number) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (input: Omit<CloneVersionFromSourceInput, "testId" | "scope">, ctx) => {
      scoped.guard(ctx);
      const scope = captureAccountScope();
      return cloneVersionFromSource({ ...input, testId, scope });
    },
    onSettled: (result, error, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      const version =
        (result?.status === "cloned" ? result.version : undefined) ??
        (error instanceof IncompleteVersionCloneError ? error.version : undefined);
      if (version) {
        qc.setQueryData<TestVersion[]>(instrumentKeys.versions(testId), (previous) =>
          [...(previous ?? []).filter((entry) => entry.id !== version.id), version],
        );
        void qc.invalidateQueries({ queryKey: instrumentKeys.versions(testId) });
      }
    },
  });
}

export function useSaveVersionDocument(versionId: number) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (input: Omit<SaveVersionDocumentInput, "scope">, ctx) => {
      scoped.guard(ctx);
      const scope = captureAccountScope();
      return saveVersionDocument({ ...input, scope });
    },
    onSuccess: (loaded, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.cancelQueries({ queryKey: instrumentKeys.versionDocument(versionId), exact: true });
      qc.setQueryData(instrumentKeys.versionDocument(versionId), loaded);
      void qc.invalidateQueries({ queryKey: instrumentKeys.versions(loaded.test.id) });
      void qc.invalidateQueries({ queryKey: instrumentKeys.baremos(versionId) });
      void qc.invalidateQueries({ queryKey: instrumentKeys.tests() });
    },
  });
}

export function useApproveVersion(versionId: number, testId?: number) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (_vars: void, ctx) => {
      scoped.guard(ctx);
      return approveVersion(versionId);
    },
    onSuccess: (_data, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: instrumentKeys.versionDocument(versionId) });
      void qc.invalidateQueries({
        queryKey: testId
          ? instrumentKeys.versions(testId)
          : ([...instrumentKeys.all, "versions"] as const),
      });
    },
  });
}

export function usePublishVersion(versionId: number, testId?: number) {
  const qc = useQueryClient();
  return useMutation({
    onMutate: scoped.onMutate,
    mutationFn: (_vars: void, ctx) => {
      scoped.guard(ctx);
      return publishVersion(versionId);
    },
    onSuccess: (_data, _vars, context) => {
      if (!isScopeCurrent(context)) return;
      void qc.invalidateQueries({ queryKey: wizardKeys.all });
      void qc.invalidateQueries({ queryKey: instrumentKeys.versionDocument(versionId) });
      void qc.invalidateQueries({
        queryKey: testId
          ? instrumentKeys.versions(testId)
          : ([...instrumentKeys.all, "versions"] as const),
      });
    },
  });
}

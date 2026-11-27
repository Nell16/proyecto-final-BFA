import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { authKeys } from "../../../api/authService";
import * as endpoints from "../../../api/endpoints/instruments";
import testsFixture from "../../../api/schemas/__fixtures__/instruments/tests.json";
import versionsFixture from "../../../api/schemas/__fixtures__/instruments/versions.json";
import { TestInstrumentListWireSchema, TestVersionListWireSchema } from "../../../api/schemas/instruments";
import { routeTree } from "../../../routeTree.gen";
import { useStaffAuth } from "../../../store/staffAuth";
import * as adapters from "../document/adapters";
import { createCleanDocument } from "../document/__tests__/fixtures";
import type { VersionStatus } from "../document";

vi.mock("../../../app/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("../StaffImage", () => ({ StaffImage: () => null }));

afterEach(() => {
  useStaffAuth.getState().clear();
  vi.restoreAllMocks();
});

it("abre la versión del test, previsualiza un ítem y actualiza el estado al aprobar y publicar", async () => {
  const [test] = TestInstrumentListWireSchema.parse(testsFixture);
  const [draft, published] = TestVersionListWireSchema.parse(versionsFixture);
  const document = createCleanDocument();
  let status: VersionStatus = "BORRADOR";
  const list = () => [{ ...draft!, status }, published!];
  vi.spyOn(endpoints, "listTests").mockResolvedValue([test!]);
  vi.spyOn(endpoints, "listVersions").mockImplementation(async () => list());
  vi.spyOn(adapters, "loadVersionDocument").mockImplementation(async () => ({
    document: { ...document, version: { ...document.version, status } },
    version: list()[0]!,
    test: test!,
    scoringRulesBySubtestId: {},
    activeScoringRuleCount: 1,
    hasActiveScoringRules: true,
  }));
  const approve = vi.spyOn(endpoints, "approveVersion").mockImplementation(async () => {
    status = "APROBADO";
    return list()[0]!;
  });
  const publish = vi.spyOn(endpoints, "publishVersion").mockImplementation(async () => {
    status = "PUBLICADO";
    return list()[0]!;
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = { id: "staff-1", username: "staff", roles: [], permissions: ["TEST_PUBLICAR"] };
  useStaffAuth.getState().setSession({ token: "staff-token", expiresAt: null, user });
  queryClient.setQueryData(authKeys.me(useStaffAuth.getState().sessionId), user);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/app/instrumentos"] }),
    context: { queryClient },
  });
  const { unmount } = render(
    <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole("link", { name: /ver versiones de batería/i }));
  const editor = await screen.findByRole("region", { name: "Editor de versión" });
  expect(within(editor).getByRole("heading", { name: "Versión 1.0" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Nueva versión" })).not.toBeInTheDocument();
  expect(within(editor).queryByRole("button", { name: "Guardar borrador" })).not.toBeInTheDocument();

  fireEvent.click(within(editor).getByRole("button", { name: "Vista previa" }));
  const preview = screen.getByRole("dialog", { name: "Vista previa como participante" });
  fireEvent.click(within(preview).getByRole("button", { name: "Comenzar" }));
  expect(within(preview).getByRole("heading", { name: document.subtests[0]!.items[0]!.prompt })).toBeVisible();
  fireEvent.keyDown(preview, { key: "Escape" });

  fireEvent.click(within(editor).getByRole("button", { name: /revisión y publicación/i }));
  fireEvent.click(within(editor).getByRole("button", { name: "Aprobar versión" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Aprobar versión 1.0" })).getByRole("button", { name: "Aprobar" }));
  const publishButton = await within(editor).findByRole("button", { name: "Publicar versión" });
  expect(approve).toHaveBeenCalledWith(10);

  fireEvent.click(publishButton);
  fireEvent.click(within(screen.getByRole("dialog", { name: "Publicar versión 1.0" })).getByRole("button", { name: "Publicar" }));
  expect(await within(editor).findByText("Versión publicada.")).toBeVisible();
  expect(publish).toHaveBeenCalledWith(10);
  unmount();
  queryClient.clear();
});

import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { ApiError } from "../errors";
import {
  calculateAge,
  ParticipantInputSchema,
  ParticipantWireSchema,
  toParticipant,
  toParticipantRequest,
} from "../schemas/academic";
import {
  createAcademicGroup,
  createCareer,
  createCohort,
  createParticipant,
  createSex,
  deleteCatalogItem,
  deleteParticipant,
  getParticipant,
  listCatalog,
  listParticipants,
} from "./academic";
import participantsPageFixture from "../schemas/__fixtures__/academic/participants-page.json";
import participantDetailFixture from "../schemas/__fixtures__/academic/participant-detail.json";
import participantCreatedFixture from "../schemas/__fixtures__/academic/participant-created.json";
import sexosFixture from "../schemas/__fixtures__/academic/catalog-sexos.json";
import carrerasFixture from "../schemas/__fixtures__/academic/catalog-carreras.json";
import cohortesFixture from "../schemas/__fixtures__/academic/catalog-cohortes.json";
import gruposFixture from "../schemas/__fixtures__/academic/catalog-grupos-academicos.json";
import { useStaffAuth } from "../../store/staffAuth";

const API = "http://localhost:8080";

beforeEach(() => {
  useStaffAuth.getState().setSession({
    token: "staff-jwt",
    expiresAt: null,
    user: { id: "u1", username: "admin", roles: ["ADMIN"], permissions: ["PARTICIPANTE_LEER"] },
  });
});

describe("academic endpoints — participantes", () => {
  it("listParticipants parsea PageResponse y envía parámetros page y size", async () => {
    let seenPage: string | null = null;
    let seenSize: string | null = null;
    server.use(
      http.get(`${API}/participantes`, ({ request }) => {
        const url = new URL(request.url);
        seenPage = url.searchParams.get("page");
        seenSize = url.searchParams.get("size");
        return HttpResponse.json({ success: true, data: participantsPageFixture });
      }),
    );

    const page = await listParticipants({ page: 1, size: 10 });

    expect(seenPage).toBe("1");
    expect(seenSize).toBe("10");
    expect(page.page).toBe(0);
    expect(page.totalElements).toBe(2);
    expect(page.content).toHaveLength(2);
    expect(page.content[0]).toMatchObject({
      id: "a1b2c3d4-e5f6-4789-abcd-111111111111",
      code: "PART-2026-001",
      firstNames: "Ana Sofía",
      lastNames: "Martínez López",
      fullName: "Ana Sofía Martínez López",
      birthDate: "2004-05-12",
      status: "ACTIVO",
    });
    expect(page.content[1].status).toBe("INACTIVO");
    expect(page.content[1].birthDate).toBeUndefined();
    expect(page.content[1].age).toBeUndefined();
  });

  it("getParticipant tolera campos extra desconocidos y estado desconocido", async () => {
    server.use(
      http.get(`${API}/participantes/a1b2c3d4-e5f6-4789-abcd-111111111111`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...participantDetailFixture,
            estado: "SUSPENDIDO_FUTURO",
            campoExtraNoDocumentado: "valor",
          },
        }),
      ),
    );

    const participant = await getParticipant("a1b2c3d4-e5f6-4789-abcd-111111111111");

    expect(participant.id).toBe("a1b2c3d4-e5f6-4789-abcd-111111111111");
    expect(participant.status).toBe("DESCONOCIDO");
  });

  it("createParticipant envía ParticipantRequest al backend y parsea relaciones anidadas", async () => {
    let sentBody: unknown = null;
    server.use(
      http.post(`${API}/participantes`, async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json({ success: true, data: participantCreatedFixture });
      }),
    );

    const created = await createParticipant({
      code: " PART-2026-003 ",
      firstNames: "Lucía Fernanda",
      lastNames: "Torres Vega",
      birthDate: "2005-09-20",
      sexId: 1,
      careerId: 1,
      cohortId: 1,
      groupId: 1,
    });

    expect(sentBody).toEqual({
      code: "PART-2026-003",
      firstNames: "Lucía Fernanda",
      lastNames: "Torres Vega",
      fechaNacimiento: "2005-09-20",
      sexoId: 1,
      carreraId: 1,
      cohorteId: 1,
      grupoAcademicoId: 1,
    });
    expect(created.sex).toEqual({ id: 1, code: "F", name: "Femenino" });
    expect(created.career).toEqual({ id: 1, code: "PSI", name: "Psicología" });
    expect(created.cohort).toEqual({
      id: 1,
      code: "2026-1",
      name: "Cohorte 2026-I",
      year: 2026,
      period: "I",
    });
    expect(created.group).toEqual({
      id: 1,
      code: "PSI-A",
      name: "Grupo A",
      careerId: 1,
    });
  });

  it("deleteParticipant ejecuta DELETE /participantes/{id}", async () => {
    let deleted = false;
    server.use(
      http.delete(`${API}/participantes/a1b2c3d4-e5f6-4789-abcd-111111111111`, () => {
        deleted = true;
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    await deleteParticipant("a1b2c3d4-e5f6-4789-abcd-111111111111");
    expect(deleted).toBe(true);
  });

  it("lanza ApiError cuando el envelope indica success: false", async () => {
    server.use(
      http.get(`${API}/participantes`, () =>
        HttpResponse.json({
          success: false,
          data: null,
          error: { code: "PARTICIPANT_ERROR", message: "No autorizado" },
        }),
      ),
    );

    await expect(listParticipants()).rejects.toMatchObject({
      code: "PARTICIPANT_ERROR",
      message: "No autorizado",
    });
  });

  it("lanza ApiError con code CONTRACT_MISMATCH cuando el payload incumple el contrato", async () => {
    server.use(
      http.get(`${API}/participantes/bad-id`, () =>
        HttpResponse.json({ success: true, data: { id: "no-es-uuid" } }),
      ),
    );

    const err = await getParticipant("bad-id").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("CONTRACT_MISMATCH");
  });
});

describe("academic endpoints — catálogos", () => {
  it("listCatalog parsea sexos, carreras, cohortes y grupos-academicos con búsqueda q", async () => {
    let seenQuery: string | null = null;
    server.use(
      http.get(`${API}/catalogos/sexos`, () => HttpResponse.json({ success: true, data: sexosFixture })),
      http.get(`${API}/catalogos/carreras`, ({ request }) => {
        seenQuery = new URL(request.url).searchParams.get("q");
        return HttpResponse.json({ success: true, data: carrerasFixture });
      }),
      http.get(`${API}/catalogos/cohortes`, () => HttpResponse.json({ success: true, data: cohortesFixture })),
      http.get(`${API}/catalogos/grupos-academicos`, () => HttpResponse.json({ success: true, data: gruposFixture })),
    );

    const sexos = await listCatalog("sexos");
    const carreras = await listCatalog("carreras", "PSI");
    const cohortes = await listCatalog("cohortes");
    const grupos = await listCatalog("grupos-academicos");

    expect(seenQuery).toBe("PSI");
    expect(sexos).toEqual([
      { id: 1, code: "F", name: "Femenino", status: "ACTIVO" },
      { id: 2, code: "M", name: "Masculino", status: "ACTIVO" },
    ]);
    expect(carreras[0]).toEqual({ id: 1, code: "PSI", name: "Psicología", status: "ACTIVO" });
    expect(cohortes[1]).toEqual({
      id: 2,
      code: "2026-2",
      name: "Cohorte 2026-II",
      year: 2026,
      period: undefined,
      status: "ACTIVO",
    });
    expect(grupos).toEqual([
      { id: 1, code: "PSI-A", name: "Grupo A", careerId: 1, status: "ACTIVO" },
      { id: 2, code: "GEN-B", name: "GEN-B", careerId: undefined, status: "ACTIVO" },
    ]);
  });

  it("createSex, createCareer, createCohort, createAcademicGroup y deleteCatalogItem envían el payload esperado", async () => {
    const bodies: Record<string, unknown> = {};
    let deletedPath = "";

    server.use(
      http.post(`${API}/catalogos/sexos`, async ({ request }) => {
        bodies.sexos = await request.json();
        return HttpResponse.json({ success: true, data: sexosFixture[0] });
      }),
      http.post(`${API}/catalogos/carreras`, async ({ request }) => {
        bodies.carreras = await request.json();
        return HttpResponse.json({ success: true, data: carrerasFixture[0] });
      }),
      http.post(`${API}/catalogos/cohortes`, async ({ request }) => {
        bodies.cohortes = await request.json();
        return HttpResponse.json({ success: true, data: cohortesFixture[0] });
      }),
      http.post(`${API}/catalogos/grupos-academicos`, async ({ request }) => {
        bodies.grupos = await request.json();
        return HttpResponse.json({ success: true, data: gruposFixture[0] });
      }),
      http.delete(`${API}/catalogos/carreras/1`, ({ request }) => {
        deletedPath = new URL(request.url).pathname;
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    const sex = await createSex({ code: "F", name: "Femenino" });
    const career = await createCareer({ code: "PSI", name: "Psicología" });
    const cohort = await createCohort({ code: "2026-1", name: "Cohorte 2026-I", year: 2026, period: "I" });
    const group = await createAcademicGroup({ code: "PSI-A", name: "Grupo A", careerId: 1 });
    await deleteCatalogItem("carreras", 1);

    expect(bodies.sexos).toEqual({ codigo: "F", nombre: "Femenino" });
    expect(bodies.carreras).toEqual({ codigoCarrera: "PSI", nombreCarrera: "Psicología" });
    expect(bodies.cohortes).toEqual({
      codigoCohorte: "2026-1",
      nombreCohorte: "Cohorte 2026-I",
      anio: 2026,
      periodo: "I",
    });
    expect(bodies.grupos).toEqual({
      codigoGrupo: "PSI-A",
      nombreGrupo: "Grupo A",
      carrera: { id: 1 },
    });
    expect(sex.code).toBe("F");
    expect(career.code).toBe("PSI");
    expect(cohort.year).toBe(2026);
    expect(group.careerId).toBe(1);
    expect(deletedPath).toBe("/catalogos/carreras/1");
  });
});

describe("academic schemas — cálculo de edad y validación de ParticipantInput", () => {
  it("calculateAge calcula edad exacta antes y después del cumpleaños con fecha inyectada", () => {
    expect(calculateAge("2004-05-12", new Date(2026, 4, 11))).toBe(21);
    expect(calculateAge("2004-05-12", new Date(2026, 4, 12))).toBe(22);
    expect(calculateAge("2004-05-12", new Date(2026, 10, 24))).toBe(22);
    expect(calculateAge("2030-01-01", new Date(2026, 10, 24))).toBeUndefined();
    expect(calculateAge("fecha-invalida")).toBeUndefined();

    const parsedWire = ParticipantWireSchema.parse(participantDetailFixture);
    const participant = toParticipant(parsedWire, new Date(2026, 4, 11));
    expect(participant.age).toBe(21);
  });

  it("ParticipantInputSchema valida campos requeridos, fecha no futura y toParticipantRequest", () => {
    const valid = ParticipantInputSchema.safeParse({
      code: "PART-01",
      firstNames: "María",
      lastNames: "Pérez",
      birthDate: "2000-01-15",
      sexId: 1,
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(toParticipantRequest(valid.data)).toEqual({
        code: "PART-01",
        firstNames: "María",
        lastNames: "Pérez",
        fechaNacimiento: "2000-01-15",
        sexoId: 1,
      });
    }

    const emptyOptionalBirthDate = ParticipantInputSchema.safeParse({
      code: "PART-02",
      firstNames: "Juan",
      lastNames: "López",
      birthDate: "",
    });
    expect(emptyOptionalBirthDate.success).toBe(true);
    if (emptyOptionalBirthDate.success) {
      expect(toParticipantRequest(emptyOptionalBirthDate.data)).toEqual({
        code: "PART-02",
        firstNames: "Juan",
        lastNames: "López",
      });
    }

    const missingRequired = ParticipantInputSchema.safeParse({
      code: "   ",
      firstNames: "",
      lastNames: "Pérez",
    });
    expect(missingRequired.success).toBe(false);

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const futureIso = futureDate.toISOString().slice(0, 10);
    const futureResult = ParticipantInputSchema.safeParse({
      code: "PART-03",
      firstNames: "Luis",
      lastNames: "Mora",
      birthDate: futureIso,
    });
    expect(futureResult.success).toBe(false);

    const invalidCalendarDate = ParticipantInputSchema.safeParse({
      code: "PART-04",
      firstNames: "Luis",
      lastNames: "Mora",
      birthDate: "2024-02-30",
    });
    expect(invalidCalendarDate.success).toBe(false);
  });
});

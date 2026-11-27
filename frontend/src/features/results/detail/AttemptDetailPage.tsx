import { Link } from "@tanstack/react-router";
import { PendingServerSupportNotice } from "../components/PendingServerSupportNotice";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, CircleDashed, XCircle } from "lucide-react";

import type { DetailedAttemptResult } from "../../../api/schemas/results";
import { AuthenticatedImage } from "../../../app/components/ui/authenticated-image";
import { Button } from "../../../app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../app/components/ui/card";
import { EmptyState } from "../../../app/components/ui/empty-state";
import { PageHeader } from "../../../app/components/ui/page-header";
import { Skeleton } from "../../../app/components/ui/skeleton";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../app/components/ui/tabs";
import { ErrorPanel } from "../components/ErrorPanel";
import { InlineNotice } from "../components/InlineNotice";
import { ToneBadge } from "../components/ToneBadge";
import { formatDateTime, formatScore, formatSeconds, isMissingError, parseAttemptId } from "../format";
import { useCanOpenManualReview } from "../permissions";
import { detailedResultQuery } from "../queries";

type Item = DetailedAttemptResult["subtests"][number]["items"][number];

function ItemVerdict({ item }: { item: Item }) {
  const response = item.response;
  if (response?.requiresManualReview) {
    return (
      <ToneBadge tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
        Revisión manual
      </ToneBadge>
    );
  }
  if (response?.isCorrect === true) {
    return (
      <ToneBadge tone="success" icon={<CheckCircle2 aria-hidden="true" />}>
        Correcto ({formatScore(response.scoreObtained ?? 0)} pts)
      </ToneBadge>
    );
  }
  if (response?.isCorrect === false) {
    return (
      <ToneBadge tone="danger" icon={<XCircle aria-hidden="true" />}>
        Incorrecto ({formatScore(response.scoreObtained ?? 0)} pts)
      </ToneBadge>
    );
  }
  return (
    <ToneBadge tone="neutral" icon={<CircleDashed aria-hidden="true" />}>
      Sin calificar
    </ToneBadge>
  );
}

function ItemCard({ item, showKey }: { item: Item; showKey: boolean }) {
  const response = item.response;
  const open = item.responseType === "TEXTO_ABIERTO" || item.responseType === "NUMERICA";
  const answer = item.responseType === "NUMERICA" ? response?.numericAnswer : response?.textAnswer;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <CardTitle className="text-sm font-semibold">
          Ítem {item.order} <span className="font-mono text-xs font-normal text-muted-foreground">{item.code}</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {item.itemType} · {item.responseType}
          </span>
        </CardTitle>
        <ItemVerdict item={item} />
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {item.prompt && <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">{item.prompt}</p>}
        {item.images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {item.images.map((image) => (
              <div key={image.imageId} className="max-w-md rounded-lg border border-border bg-white p-2">
                <AuthenticatedImage src={image.url} alt={image.altText ?? `Estímulo del ítem ${item.order}`} className="mx-auto max-h-60 object-contain" />
              </div>
            ))}
          </div>
        )}

        {open ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">Respuesta del participante</p>
            <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-foreground">{answer == null ? "Sin responder" : String(answer)}</p>
            {response?.observation && <p className="mt-2 text-xs text-muted-foreground">Observación: {response.observation}</p>}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label={`Opciones del ítem ${item.order}`}>
            {item.options.map((option) => {
              const correctVisible = showKey && option.isCorrect;
              return (
                <li
                  key={option.optionId}
                  data-selected={option.selected ? "true" : undefined}
                  className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${
                    option.selected ? "border-primary bg-accent/60" : "border-border bg-card"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{option.code ?? option.order}</span>
                    {option.selected && (
                      <ToneBadge tone="info" icon={<Check aria-hidden="true" />}>
                        Seleccionada
                      </ToneBadge>
                    )}
                    {correctVisible && (
                      <ToneBadge tone="success" icon={<CheckCircle2 aria-hidden="true" />}>
                        Correcta
                      </ToneBadge>
                    )}
                  </div>
                  {option.text && <p className="font-medium text-foreground">{option.text}</p>}
                  {option.images.map((image) => (
                    <div key={image.imageId} className="max-w-[160px] rounded border border-border bg-white p-1">
                      <AuthenticatedImage src={image.url} alt={image.altText ?? `Opción ${option.order}`} className="mx-auto max-h-24 object-contain" />
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
        {response?.timeUsedSeconds != null && (
          <p className="text-xs tabular-nums text-muted-foreground">Tiempo en el ítem: {formatSeconds(response.timeUsedSeconds)}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

/** Resultado detallado de un intento (`GET /attempts/{id}/detailed-result`, RESULTADO_VER): respuestas por ítem. */
export function AttemptDetailPage({ attemptId: rawId }: { attemptId: string }) {
  const attemptId = parseAttemptId(rawId);
  const canOpenReview = useCanOpenManualReview();
  const query = useQuery({ ...detailedResultQuery(attemptId ?? 0), enabled: attemptId !== null });

  const header = (
    <PageHeader
      title="Respuestas del intento"
      subtitle={attemptId === null ? undefined : `Intento #${attemptId}`}
      breadcrumbs={[{ label: "Resultados", to: "/app/resultados" }, { label: "Respuestas del intento" }]}
      renderBreadcrumbLink={({ label }) => <Link to="/app/resultados">{label}</Link>}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/app/resultados">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Volver a resultados
          </Link>
        </Button>
      }
    />
  );

  if (attemptId === null) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorPanel error={new Error("El identificador del intento no es válido.")} title="Intento no válido" />
      </div>
    );
  }

  if (query.isPending) {
    return (
      <div className="space-y-6" aria-busy="true">
        {header}
        <p role="status" className="sr-only">
          Cargando respuestas…
        </p>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-6">
        {header}
        {isMissingError(query.error) ? (
          <EmptyState title="Intento no encontrado" description="El intento solicitado no existe o ya no está disponible." />
        ) : (
          <ErrorPanel error={query.error} title="No se pudo cargar el detalle del intento" onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const detail = query.data;
  const graded = detail.resultId !== null && detail.totalScore !== null;
  const finished = detail.attemptStatus === "COMPLETADO";

  return (
    <div className="max-w-6xl space-y-6">
      {header}

      <div className="flex flex-wrap items-center gap-2">
        {detail.attemptStatus === "DESCONOCIDO" ? (
          <ToneBadge tone="neutral">Estado desconocido</ToneBadge>
        ) : (
          <StatusBadge domain="attempt" status={detail.attemptStatus} />
        )}
        {graded && (
          <ToneBadge tone={detail.requiresManualReview ? "warning" : "success"}>
            {detail.requiresManualReview ? "Requiere revisión" : "Calificado"}
          </ToneBadge>
        )}
        {detail.requiresManualReview && canOpenReview && (
          <Button asChild variant="outline" size="sm">
            <Link to="/app/revision-manual">Ir a revisión manual</Link>
          </Button>
        )}
        {detail.requiresManualReview && canOpenReview && (
          <span className="text-xs text-muted-foreground">
            Por ahora la bandeja no recibe estas revisiones automáticamente.
          </span>
        )}
      </div>

      {graded && detail.requiresManualReview && <PendingServerSupportNotice />}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Participante</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label="Nombre" value={detail.participantName} />
              <Fact label="Código" value={detail.participantCode} />
              <Fact label="Carrera" value={detail.career ?? "No especificada"} />
              <Fact label="Grupo y cohorte" value={[detail.academicGroup, detail.cohort].filter(Boolean).join(" · ") || "No especificado"} />
              <Fact label="Instrumento" value={`${detail.testName} (v${detail.testVersion})`} />
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Métricas del intento</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Fact label="Inicio" value={formatDateTime(detail.startedAt)} />
              <Fact label="Fin" value={formatDateTime(detail.finishedAt)} />
              <Fact label="Duración" value={formatSeconds(detail.totalTimeSeconds)} />
              <Fact label="Dirección IP" value={detail.ipAddress ?? "No registrada"} />
              <Fact label="Dispositivo" value={detail.deviceInfo ?? "No registrado"} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {graded ? (
        <section aria-label="Calificación global" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Puntaje directo", `${formatScore(detail.totalScore)} pts`],
            ["Correctas", String(detail.correctCount ?? 0)],
            ["Incorrectas", String(detail.incorrectCount ?? 0)],
            ["Pendientes de revisión", String(detail.pendingReviewCount ?? 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
            </div>
          ))}
        </section>
      ) : (
        <InlineNotice tone="info" title="Intento sin calificación">
          Este intento todavía no tiene un resultado calculado. Se listan las respuestas almacenadas.
        </InlineNotice>
      )}

      <section aria-labelledby="items-title" className="space-y-3">
        <h2 id="items-title" className="text-base font-semibold text-foreground">
          Respuestas por subtest
        </h2>
        {detail.subtests.length === 0 ? (
          <EmptyState title="Sin subtests" description="El instrumento de este intento no tiene subtests registrados." />
        ) : (
          <Tabs defaultValue={`subtest-${detail.subtests[0].subtestId}`}>
            <div className="max-w-full overflow-x-auto">
              <TabsList>
                {detail.subtests.map((subtest) => (
                  <TabsTrigger key={subtest.subtestId} value={`subtest-${subtest.subtestId}`}>
                    {subtest.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {detail.subtests.map((subtest) => (
              <TabsContent key={subtest.subtestId} value={`subtest-${subtest.subtestId}`} className="space-y-4 pt-2">
                <p className="text-xs tabular-nums text-muted-foreground">Ítems: {subtest.items.length}</p>
                {subtest.items.length === 0 ? (
                  <EmptyState title="Sin ítems" description="Este subtest no tiene ítems para mostrar." />
                ) : (
                  subtest.items.map((item) => <ItemCard key={item.itemId} item={item} showKey={finished} />)
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </section>
    </div>
  );
}

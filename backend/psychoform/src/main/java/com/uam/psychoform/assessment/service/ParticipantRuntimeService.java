package com.uam.psychoform.assessment.service;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.academic.repository.ParticipanteRepository;
import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.model.SesionSubtest;
import com.uam.psychoform.assessment.repository.AsignacionTestRepository;
import com.uam.psychoform.assessment.repository.CompletedSubtestCount;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.RespuestaRechazadaRepository;
import com.uam.psychoform.assessment.repository.SesionAplicacionRepository;
import com.uam.psychoform.assessment.repository.SesionSubtestRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.uam.psychoform.assessment.dto.SessionIncidenceDto;
import com.uam.psychoform.audit.model.Auditoria;
import com.uam.psychoform.audit.repository.AuditoriaRepository;
import com.uam.psychoform.audit.service.AuditLogService;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.assessment.dto.SessionAssignmentDto;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Period;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class ParticipantRuntimeService {
    static final String ACCION_INCIDENCIA = "INCIDENCIA_SESION";
    static final String ENTIDAD_INCIDENCIA = "sesion_aplicacion";
    static final int MAX_TEXTO_INCIDENCIA = 1000;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final SesionAplicacionRepository sesiones;
    private final SesionSubtestRepository sesionSubtests;
    private final AsignacionTestRepository asignaciones;
    private final IntentoTestRepository intentos;
    private final IntentoSubtestRepository intentoSubtests;
    private final ParticipanteRepository participantes;
    private final UsuarioRepository usuarios;
    private final ParticipantTokenService tokenService;
    private final CurrentActor currentActor;
    private final AuditLogService audit;
    private final Clock clock;
    private final SessionWriteGuard sessionWriteGuard;
    private final SubtestClosingService closing;
    private final AuditoriaRepository auditorias;
    private final RespuestaRechazadaRepository rechazos;

    public ParticipantRuntimeService(SesionAplicacionRepository sesiones, SesionSubtestRepository sesionSubtests,
            AsignacionTestRepository asignaciones, IntentoTestRepository intentos,
            IntentoSubtestRepository intentoSubtests, ParticipanteRepository participantes, UsuarioRepository usuarios,
            ParticipantTokenService tokenService, CurrentActor currentActor, AuditLogService audit, Clock clock,
            SessionWriteGuard sessionWriteGuard, SubtestClosingService closing, AuditoriaRepository auditorias,
            RespuestaRechazadaRepository rechazos) {
        this.sesiones = sesiones;
        this.sesionSubtests = sesionSubtests;
        this.asignaciones = asignaciones;
        this.intentos = intentos;
        this.intentoSubtests = intentoSubtests;
        this.participantes = participantes;
        this.usuarios = usuarios;
        this.tokenService = tokenService;
        this.currentActor = currentActor;
        this.audit = audit;
        this.clock = clock;
        this.sessionWriteGuard = sessionWriteGuard;
        this.closing = closing;
        this.auditorias = auditorias;
        this.rechazos = rechazos;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public AssignedParticipant assignParticipant(AssignParticipantCommand command) {
        SesionAplicacion sesion = sesiones.findByIdForUpdate(command.sesionAplicacionId())
                .orElseThrow(() -> new EntityNotFoundException("Sesion no encontrada: " + command.sesionAplicacionId()));
        if (sesion.getEstado() == EstadoSesionAplicacion.CERRADA || sesion.getEstado() == EstadoSesionAplicacion.CANCELADA) {
            throw new IllegalStateException("La sesion no permite nuevas asignaciones");
        }
        Participante participante = participantes.findById(command.participanteId())
                .orElseThrow(() -> new EntityNotFoundException("Participante no encontrado: " + command.participanteId()));
        if (asignaciones.findBySesionAplicacionIdAndParticipanteId(sesion.getId(), participante.getId()).isPresent()) {
            throw new IllegalStateException("El participante ya esta asignado a la sesion");
        }
        UUID actorId = currentActor.usuarioId();
        Usuario evaluador = usuarios.findById(actorId)
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + actorId));
        LocalDateTime now = LocalDateTime.now(clock);
        String rawToken = tokenService.generateRawToken();

        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setSesionAplicacion(sesion);
        asignacion.setParticipante(participante);
        asignacion.setEvaluador(evaluador);
        asignacion.setTokenAccesoHash(tokenService.hash(rawToken));
        asignacion.setTokenExpiraEn(now.plus(command.tokenTtl()));
        asignacion.setIntentosAcceso(0);
        asignacion.setEdadRegistradaAplicacion(ageAt(participante.getFechaNacimiento(), LocalDate.now(clock)));
        asignacion.setSexoAplicacion(participante.getSexo());
        asignacion.setCarreraAplicacion(participante.getCarrera());
        asignacion.setCohorteAplicacion(participante.getCohorte());
        asignacion.setGrupoAcademicoAplicacion(participante.getGrupoAcademico());
        asignacion.setAsignadoEn(now);
        asignacion.setEstado(EstadoAsignacion.ASIGNADO);
        asignaciones.save(asignacion);
        return new AssignedParticipant(asignacion.getId(), rawToken, asignacion.getTokenExpiraEn());
    }

    /**
     * Regenera el token de acceso de una asignacion (B2). El token anterior deja de validar porque cambia el hash;
     * las sesiones JWT de participante ya emitidas y el intento en curso no se tocan.
     */
    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public AssignedParticipant regenerateAssignmentToken(Long sessionId, Long assignmentId, Duration tokenTtl) {
        AsignacionTest asignacion = asignaciones.findByIdForUpdate(assignmentId)
                .orElseThrow(() -> new EntityNotFoundException("Asignacion no encontrada: " + assignmentId));
        SesionAplicacion sesion = asignacion.getSesionAplicacion();
        if (!Objects.equals(sesion.getId(), sessionId)) {
            throw new EntityNotFoundException("Asignacion no encontrada en la sesion: " + assignmentId);
        }
        if (sesion.getEstado() == EstadoSesionAplicacion.CERRADA
                || sesion.getEstado() == EstadoSesionAplicacion.CANCELADA) {
            throw new ParticipantConflictException(ParticipantConflictException.SESION_FINALIZADA,
                    "La sesion ya finalizo");
        }
        if (asignacion.getEstado() == EstadoAsignacion.ANULADO || asignacion.getEstado() == EstadoAsignacion.COMPLETADO) {
            throw new ParticipantConflictException(ParticipantConflictException.ASIGNACION_NO_OPERABLE,
                    "La asignacion no permite regenerar el token");
        }
        String rawToken = tokenService.generateRawToken();
        LocalDateTime expiresAt = LocalDateTime.now(clock).plus(tokenTtl);
        asignacion.setTokenAccesoHash(tokenService.hash(rawToken));
        asignacion.setTokenExpiraEn(expiresAt);
        asignacion.setIntentosAcceso(0);
        if (asignacion.getEstado() == EstadoAsignacion.EXPIRADO) {
            asignacion.setEstado(EstadoAsignacion.ASIGNADO);
        }
        asignaciones.save(asignacion);
        audit.recordTrusted(new AuditLogService.AuditEvent("ASIGNACION_TOKEN_REGENERADO", "asignacion_test",
                String.valueOf(assignmentId), null,
                "{\"sesionId\":" + sessionId + ",\"expiresAt\":\"" + expiresAt + "\"}", null, null));
        return new AssignedParticipant(asignacion.getId(), rawToken, expiresAt);
    }

    @Transactional
    public IntentoTest startOrResumeAttempt(ParticipantAccessService.ParticipantAccess access, String deviceInfo,
            String ipAddress) {
        AsignacionTest asignacionActual = asignaciones.findById(access.assignmentId())
                .orElseThrow(() -> new EntityNotFoundException("Asignacion no encontrada: " + access.assignmentId()));
        sessionWriteGuard.requireWritable(asignacionActual.getSesionAplicacion().getId());
        return intentos.findByAsignacionId(access.assignmentId())
                .orElseGet(() -> createAttempt(access.assignmentId(), deviceInfo, ipAddress));
    }

    @Transactional
    public IntentoSubtest startSubtest(ParticipantAccessService.ParticipantAccess access, long intentoId,
            long subtestId) {
        IntentoTest intento = intentos.findByIdForUpdate(intentoId)
                .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + intentoId));
        requireAttemptScope(access, intento);
        Long sesionId = intento.getAsignacion().getSesionAplicacion().getId();
        sessionWriteGuard.requireWritable(sesionId);
        if (intento.getEstado() == EstadoIntento.COMPLETADO || intento.getEstado() == EstadoIntento.ANULADO) {
            throw new IllegalStateException("El intento no permite iniciar subtests");
        }
        SesionSubtest sesionSubtest = sesionSubtests.findBySesionAplicacionIdAndSubtestId(sesionId, subtestId)
                .orElseThrow(() -> new IllegalStateException("Subtest no habilitado en la sesion"));
        return intentoSubtests.findByIntentoIdAndSubtestId(intentoId, subtestId)
                .orElseGet(() -> createAttemptSubtest(intento, sesionSubtest));
    }

    @Transactional
    public IntentoSubtest finishSubtest(ParticipantAccessService.ParticipantAccess access, long intentoId,
            long subtestId, int tiempoUsadoSegundos) {
        // Mismo bloqueo que PUT respuesta / bulk-sync (intento FOR UPDATE): serializa finalizar contra un guardado
        // en curso, de modo que ninguna respuesta se confirme despues de marcar el subtest COMPLETADO.
        IntentoTest intento = intentos.findByIdForUpdate(intentoId)
                .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + intentoId));
        requireAttemptScope(access, intento);
        IntentoSubtest intentoSubtest = intentoSubtests.findByIntentoIdAndSubtestId(intentoId, subtestId)
                .orElseThrow(() -> new EntityNotFoundException("Intento de subtest no encontrado"));
        Long sesionId = intento.getAsignacion().getSesionAplicacion().getId();
        sessionWriteGuard.requireWritable(sesionId);
        if (intentoSubtest.getEstado() == EstadoIntento.COMPLETADO) {
            // Idempotente: el subtest pudo cerrarse por tiempo agotado (PUT, bulk-sync o cierre automatico)
            // antes de que el cliente llamara a finalizar. Se devuelve tal como quedo.
            return intentoSubtest;
        }
        if (intentoSubtest.getEstado() != EstadoIntento.EN_PROGRESO) {
            throw new IllegalStateException("El subtest no esta en progreso");
        }
        // El valor del cliente es informativo: el servidor calcula el tiempo efectivo (sin pausas) y registra
        // respuestas vacias para los items no respondidos.
        closing.cerrar(intentoSubtest, sesionId, LocalDateTime.now(clock));
        return intentoSubtest;
    }

    @Transactional
    public IntentoTest finishAttempt(ParticipantAccessService.ParticipantAccess access, long intentoId,
            int tiempoTotalSegundos) {
        IntentoTest intento = intentos.findByIdForUpdate(intentoId)
                .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + intentoId));
        requireAttemptScope(access, intento);
        sessionWriteGuard.requireWritable(intento.getAsignacion().getSesionAplicacion().getId());
        if (intento.getEstado() != EstadoIntento.EN_PROGRESO) {
            throw new IllegalStateException("El intento no esta en progreso");
        }
        // Los subtests que quedaron en curso se entregan tal como estaban (con respuestas vacias para omitidos).
        LocalDateTime cierre = LocalDateTime.now(clock);
        Long sesionDelIntento = intento.getAsignacion().getSesionAplicacion().getId();
        for (IntentoSubtest enCurso : intentoSubtests.findByIntentoId(intentoId)) {
            closing.cerrar(enCurso, sesionDelIntento, cierre);
        }
        intento.setEstado(EstadoIntento.COMPLETADO);
        intento.setFinalizadoEn(LocalDateTime.now(clock));
        intento.setUltimaActividadEn(LocalDateTime.now(clock));
        intento.setTiempoTotalSegundos(tiempoTotalSegundos);
        intento.getAsignacion().setEstado(EstadoAsignacion.COMPLETADO);
        intentos.save(intento);
        return intento;
    }

    private static void requireAttemptScope(ParticipantAccessService.ParticipantAccess access, IntentoTest intento) {
        if (!Objects.equals(intento.getAsignacion().getId(), access.assignmentId())) {
            throw new AccessDeniedException("Intento fuera de alcance");
        }
    }

    private IntentoTest createAttempt(long asignacionId, String deviceInfo, String ipAddress) {
        AsignacionTest asignacion = asignaciones.findByIdForUpdate(asignacionId)
                .orElseThrow(() -> new EntityNotFoundException("Asignacion no encontrada: " + asignacionId));
        if (asignacion.getEstado() == EstadoAsignacion.COMPLETADO || asignacion.getEstado() == EstadoAsignacion.ANULADO
                || asignacion.getEstado() == EstadoAsignacion.EXPIRADO) {
            throw new IllegalStateException("La asignacion no permite iniciar intento");
        }
        LocalDateTime now = LocalDateTime.now(clock);
        asignacion.setEstado(EstadoAsignacion.EN_PROGRESO);
        IntentoTest intento = new IntentoTest();
        intento.setAsignacion(asignacion);
        intento.setIniciadoEn(now);
        intento.setUltimaActividadEn(now);
        intento.setEstado(EstadoIntento.EN_PROGRESO);
        intento.setInformacionDispositivo(deviceInfo);
        intento.setDireccionIp(ipAddress);
        intentos.save(intento);
        return intento;
    }

    private IntentoSubtest createAttemptSubtest(IntentoTest intento, SesionSubtest sesionSubtest) {
        LocalDateTime now = LocalDateTime.now(clock);
        IntentoSubtest intentoSubtest = new IntentoSubtest();
        intentoSubtest.setIntento(intento);
        intentoSubtest.setSesionSubtest(sesionSubtest);
        intentoSubtest.setSubtest(sesionSubtest.getSubtest());
        intentoSubtest.setIniciadoEn(now);
        intentoSubtest.setEstado(EstadoIntento.EN_PROGRESO);
        intento.setUltimoSubtest(sesionSubtest.getSubtest());
        intento.setUltimaActividadEn(now);
        intentoSubtests.save(intentoSubtest);
        return intentoSubtest;
    }

    private static Short ageAt(LocalDate birthDate, LocalDate now) {
        return birthDate == null ? null : (short) Period.between(birthDate, now).getYears();
    }

    public record AssignParticipantCommand(Long sesionAplicacionId, UUID participanteId, Duration tokenTtl) {
    }

    public record AssignedParticipant(Long assignmentId, String rawToken, LocalDateTime expiresAt) {
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public void revokeAssignment(Long sessionId, Long assignmentId) {
        AsignacionTest assignment = asignaciones.findByIdForUpdate(assignmentId)
                .orElseThrow(() -> new EntityNotFoundException("Asignacion no encontrada: " + assignmentId));
        if (!Objects.equals(assignment.getSesionAplicacion().getId(), sessionId)) {
            throw new AccessDeniedException("Asignacion fuera de la sesion indicada");
        }
        assignment.setEstado(EstadoAsignacion.ANULADO);
        intentos.findByAsignacionId(assignmentId).ifPresent(attempt -> {
            if (attempt.getEstado() != EstadoIntento.COMPLETADO) {
                attempt.setEstado(EstadoIntento.ANULADO);
                attempt.setUltimaActividadEn(LocalDateTime.now(clock));
                intentos.save(attempt);
            }
        });
        asignaciones.save(assignment);
        audit.recordTrusted(new AuditLogService.AuditEvent("ASIGNACION_REVOCADA", "asignacion_test",
                String.valueOf(assignmentId), null, "{\"sesionId\":" + sessionId + "}", null, null));
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public void recordIncidence(Long sessionId, IncidenceCommand command) {
        if (!sesiones.existsById(sessionId)) {
            throw new EntityNotFoundException("Sesion no encontrada: " + sessionId);
        }
        String text = command.text();
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("El texto de la incidencia es obligatorio");
        }
        if (text.length() > MAX_TEXTO_INCIDENCIA) {
            throw new IllegalArgumentException(
                    "El texto de la incidencia no puede superar " + MAX_TEXTO_INCIDENCIA + " caracteres");
        }
        if (command.participantId() != null && asignaciones
                .findBySesionAplicacionIdAndParticipanteId(sessionId, command.participantId()).isEmpty()) {
            throw new IllegalArgumentException("El participante no esta asignado a la sesion");
        }
        ObjectNode metadata = JSON.createObjectNode();
        if (command.participantId() == null) {
            metadata.putNull("participantId");
        } else {
            metadata.put("participantId", command.participantId().toString());
        }
        metadata.put("text", text);
        audit.recordTrusted(new AuditLogService.AuditEvent(ACCION_INCIDENCIA, ENTIDAD_INCIDENCIA,
                String.valueOf(sessionId), null, metadata.toString(), null, null));
    }

    /** Incidencias de la sesion, de la mas antigua a la mas reciente: una query de auditoria y una carga en lote. */
    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public List<SessionIncidenceDto> listIncidences(Long sessionId) {
        if (!sesiones.existsById(sessionId)) {
            throw new EntityNotFoundException("Sesion no encontrada: " + sessionId);
        }
        List<Auditoria> rows = auditorias.findByAccionAndEntidadWithUsuario(ACCION_INCIDENCIA, ENTIDAD_INCIDENCIA,
                String.valueOf(sessionId));
        List<JsonNode> payloads = rows.stream().map(row -> parsePayload(row.getValorNuevo())).toList();
        Set<UUID> participantIds = new HashSet<>();
        List<UUID> parsedIds = payloads.stream().map(ParticipantRuntimeService::participantIdOf).toList();
        parsedIds.stream().filter(Objects::nonNull).forEach(participantIds::add);
        Map<UUID, Participante> participantsById = participantIds.isEmpty()
                ? Map.of()
                : participantes.findAllById(participantIds).stream()
                        .collect(Collectors.toMap(Participante::getId, Function.identity()));
        return java.util.stream.IntStream.range(0, rows.size()).mapToObj(i -> {
            Auditoria row = rows.get(i);
            UUID participantId = parsedIds.get(i);
            Participante participant = participantId == null ? null : participantsById.get(participantId);
            JsonNode text = payloads.get(i).get("text");
            return new SessionIncidenceDto(
                    row.getId(),
                    participantId,
                    participant == null ? null : participant.getNombres() + " " + participant.getApellidos(),
                    text == null || text.isNull() ? "" : text.asText(),
                    row.getCreadoEn(),
                    row.getUsuario() == null ? null : row.getUsuario().getNombreCompleto());
        }).toList();
    }

    /** Una query agregada por sesion: total de filas y las mas recientes de cada intento (sin N+1). */
    private Map<Long, RejectedSummary> rejectedAnswersByAttempt(Long sessionId) {
        Map<Long, List<SessionAssignmentDto.RejectedAnswerDto>> recent = new java.util.LinkedHashMap<>();
        Map<Long, Integer> counts = new java.util.HashMap<>();
        for (RespuestaRechazadaRepository.RechazoDeIntento row : rechazos.findRecientesPorSesion(sessionId,
                SessionAssignmentDto.MAX_REJECTED_ANSWERS)) {
            counts.put(row.getIntentoId(), row.getTotal().intValue());
            recent.computeIfAbsent(row.getIntentoId(), k -> new java.util.ArrayList<>())
                    .add(new SessionAssignmentDto.RejectedAnswerDto(row.getItemId(), row.getCodigo(),
                            row.getRechazadoEn()));
        }
        Map<Long, RejectedSummary> result = new java.util.HashMap<>();
        recent.forEach((attemptId, rows) -> result.put(attemptId,
                new RejectedSummary(counts.get(attemptId), List.copyOf(rows))));
        return result;
    }

    private record RejectedSummary(int count, List<SessionAssignmentDto.RejectedAnswerDto> recent) {
        static final RejectedSummary NONE = new RejectedSummary(0, List.of());
    }

    private static JsonNode parsePayload(String json) {
        if (json == null || json.isBlank()) {
            return JSON.createObjectNode();
        }
        try {
            JsonNode node = JSON.readTree(json);
            return node == null || !node.isObject() ? JSON.createObjectNode() : node;
        } catch (JsonProcessingException ex) {
            return JSON.createObjectNode();
        }
    }

    private static UUID participantIdOf(JsonNode payload) {
        JsonNode node = payload.get("participantId");
        if (node == null || node.isNull()) {
            return null;
        }
        try {
            return UUID.fromString(node.asText());
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    @Transactional(readOnly = true)
    public List<SessionAssignmentDto> getAssignmentsForSession(Long sessionId) {
        List<AsignacionTest> list = asignaciones.findBySesionAplicacionIdWithParticipante(sessionId);
        Map<Long, IntentoTest> attemptsByAssignment = intentos.findByAsignacionSesionAplicacionIdWithUltimoSubtest(sessionId)
                .stream()
                .collect(Collectors.toMap(attempt -> attempt.getAsignacion().getId(), Function.identity(),
                        (first, second) -> first));
        long totalSubtests = sesionSubtests.countBySesionAplicacionId(sessionId);
        List<Long> attemptIds = attemptsByAssignment.values().stream().map(IntentoTest::getId).toList();
        Map<Long, Long> completedSubtestsByAttempt = attemptIds.isEmpty()
                ? Map.of()
                : intentoSubtests.countCompletedByIntentoIds(attemptIds).stream()
                        .collect(Collectors.toMap(CompletedSubtestCount::getIntentoId,
                                CompletedSubtestCount::getCompletedCount));
        Map<Long, RejectedSummary> rejectedByAttempt = rejectedAnswersByAttempt(sessionId);
        LocalDateTime now = LocalDateTime.now(clock);
        return list.stream().map(asg -> {
            IntentoTest attempt = attemptsByAssignment.get(asg.getId());
            AssignmentStatusMapper.Mapped mapped = AssignmentStatusMapper.map(asg.getEstado(),
                    asg.getTokenExpiraEn(), attempt == null ? null : attempt.getEstado(), now);
            String currentSubtestId = "—";
            int progress = 0;
            String lastActivity = "Nunca";

            if (attempt != null) {
                if (attempt.getUltimoSubtest() != null) {
                    currentSubtestId = attempt.getUltimoSubtest().getCodigoSubtest();
                }

                if (attempt.getEstado() == EstadoIntento.COMPLETADO) {
                    progress = 100;
                } else if (attempt.getEstado() == EstadoIntento.EN_PROGRESO || attempt.getEstado() == EstadoIntento.INTERRUMPIDO) {
                    if (totalSubtests > 0) {
                        long completed = completedSubtestsByAttempt.getOrDefault(attempt.getId(), 0L);
                        progress = (int) (completed * 100 / totalSubtests);
                        if (progress == 0 && completed == 0) {
                            progress = 10;
                        }
                    }
                }

                if (attempt.getUltimaActividadEn() != null) {
                    lastActivity = attempt.getUltimaActividadEn().toString();
                }
            }

            RejectedSummary rejected = attempt == null
                    ? RejectedSummary.NONE
                    : rejectedByAttempt.getOrDefault(attempt.getId(), RejectedSummary.NONE);
            return new SessionAssignmentDto(
                asg.getId(),
                attempt == null ? null : attempt.getId(),
                asg.getParticipante().getId(),
                asg.getParticipante().getNombres() + " " + asg.getParticipante().getApellidos(),
                asg.getParticipante().getCodigoParticipante(),
                mapped.status(),
                mapped.state(),
                currentSubtestId,
                progress,
                lastActivity,
                asg.getTokenExpiraEn().toString(),
                asg.getEstado().name(),
                attempt == null ? null : attempt.getEstado().name(),
                rejected.count(),
                rejected.recent()
            );
        }).toList();
    }

    public record IncidenceCommand(UUID participantId, String text) {
    }
}

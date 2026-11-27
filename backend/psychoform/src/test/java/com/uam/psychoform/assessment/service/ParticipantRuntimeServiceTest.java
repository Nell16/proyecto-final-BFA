package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import com.uam.psychoform.academic.model.Carrera;
import com.uam.psychoform.academic.model.CatalogoSexo;
import com.uam.psychoform.academic.model.Cohorte;
import com.uam.psychoform.academic.model.GrupoAcademico;
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
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.PausaSesionRepository;
import com.uam.psychoform.assessment.model.PausaSesion;
import com.uam.psychoform.assessment.repository.SesionAplicacionRepository;
import com.uam.psychoform.assessment.repository.SesionSubtestRepository;
import com.uam.psychoform.audit.service.AuditLogService;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;

class ParticipantRuntimeServiceTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    private final SesionAplicacionRepository sesiones = Mockito.mock(SesionAplicacionRepository.class);
    private final SesionSubtestRepository sesionSubtests = Mockito.mock(SesionSubtestRepository.class);
    private final AsignacionTestRepository asignaciones = Mockito.mock(AsignacionTestRepository.class);
    private final IntentoTestRepository intentos = Mockito.mock(IntentoTestRepository.class);
    private final IntentoSubtestRepository intentoSubtests = Mockito.mock(IntentoSubtestRepository.class);
    private final ParticipanteRepository participantes = Mockito.mock(ParticipanteRepository.class);
    private final UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
    private final ParticipantTokenService tokenService = Mockito.mock(ParticipantTokenService.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final AuditLogService audit = Mockito.mock(AuditLogService.class);
    private final com.uam.psychoform.audit.repository.AuditoriaRepository auditorias =
            Mockito.mock(com.uam.psychoform.audit.repository.AuditoriaRepository.class);
    private final com.uam.psychoform.assessment.repository.RespuestaRechazadaRepository rechazos =
            Mockito.mock(com.uam.psychoform.assessment.repository.RespuestaRechazadaRepository.class);
    private final PausaSesionRepository pausas = Mockito.mock(PausaSesionRepository.class);
    private final jakarta.persistence.EntityManager entityManager = Mockito.mock(jakarta.persistence.EntityManager.class);
    private final SessionWriteGuard guard = new SessionWriteGuard(entityManager);
    private final SubtestTimingService timing = new SubtestTimingService(intentoSubtests, pausas, CLOCK);
    private final com.uam.psychoform.assessment.repository.RespuestaItemRepository respuestas =
            Mockito.mock(com.uam.psychoform.assessment.repository.RespuestaItemRepository.class);
    private final com.uam.psychoform.instrument.repository.ItemLookupRepository items =
            Mockito.mock(com.uam.psychoform.instrument.repository.ItemLookupRepository.class);
    private final SubtestClosingService closing = new SubtestClosingService(intentoSubtests, respuestas, items, timing);
    private final ParticipantRuntimeService service = new ParticipantRuntimeService(sesiones, sesionSubtests,
            asignaciones, intentos, intentoSubtests, participantes, usuarios, tokenService, currentActor, audit, CLOCK,
            guard, closing, auditorias, rechazos);

    @BeforeEach
    void abiertaPorDefecto() {
        when(entityManager.find(SesionAplicacion.class, 10L)).thenReturn(sesion(EstadoSesionAplicacion.ABIERTA));
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(99L);
        asignacion.setSesionAplicacion(sesion(EstadoSesionAplicacion.ABIERTA));
        when(asignaciones.findById(99L)).thenReturn(Optional.of(asignacion));
    }

    private void pausar() {
        when(entityManager.find(SesionAplicacion.class, 10L)).thenReturn(sesion(EstadoSesionAplicacion.PAUSADA));
    }

    @Test
    void escriturasDeRuntimeConSesionPausadaLanzanSesionPausada() {
        pausar();
        IntentoTest intento = intentoConSesion();
        intento.getAsignacion().setId(99L);
        IntentoSubtest intentoSubtest = new IntentoSubtest();
        intentoSubtest.setEstado(EstadoIntento.EN_PROGRESO);
        intentoSubtest.setIntento(intento);
        when(intentos.findByIdForUpdate(5L)).thenReturn(Optional.of(intento));
        when(intentoSubtests.findByIntentoIdAndSubtestId(5L, 20L)).thenReturn(Optional.of(intentoSubtest));

        assertThatThrownBy(() -> service.startOrResumeAttempt(access(99L), "d", "ip"))
                .isInstanceOf(SesionPausadaException.class);
        assertThatThrownBy(() -> service.startSubtest(access(99L), 5L, 20L)).isInstanceOf(SesionPausadaException.class);
        assertThatThrownBy(() -> service.finishSubtest(access(99L), 5L, 20L, 1))
                .isInstanceOf(SesionPausadaException.class);
        assertThatThrownBy(() -> service.finishAttempt(access(99L), 5L, 1)).isInstanceOf(SesionPausadaException.class);
        assertThat(intentoSubtest.getEstado()).isEqualTo(EstadoIntento.EN_PROGRESO);
    }

    private IntentoSubtest subtestEnProgreso(long segundosAtras, Integer limite) {
        IntentoSubtest intentoSubtest = new IntentoSubtest();
        intentoSubtest.setEstado(EstadoIntento.EN_PROGRESO);
        intentoSubtest.setIniciadoEn(LocalDateTime.now(CLOCK).minusSeconds(segundosAtras));
        SesionSubtest sesionSubtest = new SesionSubtest();
        sesionSubtest.setTiempoLimiteSegundos(limite);
        intentoSubtest.setSesionSubtest(sesionSubtest);
        intentoSubtest.setIntento(intentoWithAssignment(99L));
        when(intentos.findByIdForUpdate(5L)).thenReturn(Optional.of(intentoSubtest.getIntento()));
        when(intentoSubtests.findByIntentoIdAndSubtestId(5L, 20L)).thenReturn(Optional.of(intentoSubtest));
        return intentoSubtest;
    }

    @Test
    void finishSubtestGuardaMinimoEntreEfectivoYLimiteIgnorandoValorDelCliente() {
        IntentoSubtest excedido = subtestEnProgreso(700, 600);
        service.finishSubtest(access(99L), 5L, 20L, 3);
        assertThat(excedido.getTiempoUsadoSegundos()).isEqualTo(600);

        IntentoSubtest dentro = subtestEnProgreso(300, 600);
        service.finishSubtest(access(99L), 5L, 20L, 9999);
        assertThat(dentro.getTiempoUsadoSegundos()).isEqualTo(300);

        IntentoSubtest sinLimite = subtestEnProgreso(900, null);
        service.finishSubtest(access(99L), 5L, 20L, 1);
        assertThat(sinLimite.getTiempoUsadoSegundos()).isEqualTo(900);
    }

    @Test
    void finishSubtestDescuentaPausasDelTiempoEfectivo() {
        IntentoSubtest subtest = subtestEnProgreso(500, 600);
        PausaSesion pausa = new PausaSesion();
        pausa.setPausadoEn(subtest.getIniciadoEn().plusSeconds(100));
        pausa.setReanudadoEn(subtest.getIniciadoEn().plusSeconds(400));
        when(pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(10L)).thenReturn(List.of(pausa));

        service.finishSubtest(access(99L), 5L, 20L, 500);

        assertThat(subtest.getTiempoUsadoSegundos()).isEqualTo(200);
    }

    @Test
    void assignParticipantRequierePermisoSesionAplicar() throws Exception {
        Method method = ParticipantRuntimeService.class.getMethod("assignParticipant",
                ParticipantRuntimeService.AssignParticipantCommand.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_SESION_APLICAR')");
    }

    @Test
    void operacionesAdministrativasDeSesionRequierenPermisoSesionAplicar() throws Exception {
        assertThat(ParticipantRuntimeService.class.getMethod("revokeAssignment", Long.class, Long.class)
                .getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_SESION_APLICAR')");
        assertThat(ParticipantRuntimeService.class.getMethod("recordIncidence",
                Long.class, ParticipantRuntimeService.IncidenceCommand.class)
                .getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_SESION_APLICAR')");
    }

    @Test
    void operacionesRuntimeDeParticipanteNoUsanPermisoInternoRespuestaRegistrar() throws Exception {
        assertThat(ParticipantRuntimeService.class.getMethod("startOrResumeAttempt",
                ParticipantAccessService.ParticipantAccess.class, String.class, String.class)
                .getAnnotation(PreAuthorize.class)).isNull();
        assertThat(ParticipantRuntimeService.class.getMethod("startSubtest",
                ParticipantAccessService.ParticipantAccess.class, long.class, long.class)
                .getAnnotation(PreAuthorize.class)).isNull();
        assertThat(ParticipantRuntimeService.class.getMethod("finishSubtest",
                ParticipantAccessService.ParticipantAccess.class, long.class, long.class, int.class)
                .getAnnotation(PreAuthorize.class)).isNull();
        assertThat(ParticipantRuntimeService.class.getMethod("finishAttempt",
                ParticipantAccessService.ParticipantAccess.class, long.class, int.class)
                .getAnnotation(PreAuthorize.class)).isNull();
    }

    @Test
    void assignParticipantGuardaSnapshotDemograficoYTokenHasheado() {
        UUID participanteId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.PROGRAMADA);
        Participante participante = participante(participanteId);
        Usuario evaluador = new Usuario();
        evaluador.setId(actorId);
        when(sesiones.findByIdForUpdate(10L)).thenReturn(Optional.of(sesion));
        when(participantes.findById(participanteId)).thenReturn(Optional.of(participante));
        when(asignaciones.findBySesionAplicacionIdAndParticipanteId(10L, participanteId)).thenReturn(Optional.empty());
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(evaluador));
        when(tokenService.generateRawToken()).thenReturn("raw-token");
        when(tokenService.hash("raw-token")).thenReturn("hashed-token");

        ParticipantRuntimeService.AssignedParticipant assigned = service.assignParticipant(
                new ParticipantRuntimeService.AssignParticipantCommand(10L, participanteId, Duration.ofHours(3)));

        assertThat(assigned.rawToken()).isEqualTo("raw-token");
        assertThat(assigned.expiresAt()).isEqualTo(LocalDateTime.ofInstant(CLOCK.instant().plusSeconds(10_800), ZoneOffset.UTC));
        verify(asignaciones).save(Mockito.argThat(a -> a.getEvaluador() == evaluador
                && a.getTokenAccesoHash().equals("hashed-token")
                && a.getEdadRegistradaAplicacion().equals((short) 26)
                && a.getSexoAplicacion() == participante.getSexo()
                && a.getCarreraAplicacion() == participante.getCarrera()
                && a.getCohorteAplicacion() == participante.getCohorte()
                && a.getGrupoAcademicoAplicacion() == participante.getGrupoAcademico()
                && a.getEstado() == EstadoAsignacion.ASIGNADO));
    }

    @Test
    void startOrResumeAttemptReutilizaIntentoExistente() {
        IntentoTest existing = new IntentoTest();
        when(intentos.findByAsignacionId(99L)).thenReturn(Optional.of(existing));

        assertThat(service.startOrResumeAttempt(access(99L), "device", "127.0.0.1")).isSameAs(existing);
    }

    @Test
    void startOrResumeAttemptCreaIntentoYMarcaAsignacionEnProgreso() {
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setEstado(EstadoAsignacion.ASIGNADO);
        when(intentos.findByAsignacionId(99L)).thenReturn(Optional.empty());
        when(asignaciones.findByIdForUpdate(99L)).thenReturn(Optional.of(asignacion));

        IntentoTest intento = service.startOrResumeAttempt(access(99L), "device", "127.0.0.1");

        assertThat(intento.getAsignacion()).isSameAs(asignacion);
        assertThat(intento.getEstado()).isEqualTo(EstadoIntento.EN_PROGRESO);
        assertThat(asignacion.getEstado()).isEqualTo(EstadoAsignacion.EN_PROGRESO);
        verify(intentos).save(intento);
    }

    @Test
    void startSubtestRechazaSubtestNoHabilitadoEnSesion() {
        IntentoTest intento = intentoConSesion();
        intento.getAsignacion().setId(99L);
        when(intentos.findByIdForUpdate(5L)).thenReturn(Optional.of(intento));
        when(sesionSubtests.findBySesionAplicacionIdAndSubtestId(10L, 20L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.startSubtest(access(99L), 5L, 20L)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Subtest no habilitado");
    }

    @Test
    void startSubtestRechazaIntentoFueraDelContextoDeAsignacion() {
        IntentoTest intento = intentoConSesion();
        intento.getAsignacion().setId(123L);
        when(intentos.findByIdForUpdate(5L)).thenReturn(Optional.of(intento));

        assertThatThrownBy(() -> service.startSubtest(access(99L), 5L, 20L))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("Intento fuera de alcance");
    }

    @Test
    void finishSubtestCompletaIntentoSubtestEnProgreso() {
        IntentoSubtest intentoSubtest = subtestEnProgreso(120, null);

        IntentoSubtest finished = service.finishSubtest(access(99L), 5L, 20L, 5);

        assertThat(finished.getEstado()).isEqualTo(EstadoIntento.COMPLETADO);
        assertThat(finished.getTiempoUsadoSegundos()).isEqualTo(120);
        verify(intentoSubtests).save(intentoSubtest);
    }

    @Test
    void revokeAssignmentAnulaAsignacionEIntentoNoCompletadoYRegistraAuditoria() {
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setSesionAplicacion(sesion(EstadoSesionAplicacion.ABIERTA));
        asignacion.setEstado(EstadoAsignacion.EN_PROGRESO);
        IntentoTest intento = new IntentoTest();
        intento.setEstado(EstadoIntento.EN_PROGRESO);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));
        when(intentos.findByAsignacionId(77L)).thenReturn(Optional.of(intento));

        service.revokeAssignment(10L, 77L);

        assertThat(asignacion.getEstado()).isEqualTo(EstadoAsignacion.ANULADO);
        assertThat(intento.getEstado()).isEqualTo(EstadoIntento.ANULADO);
        assertThat(intento.getUltimaActividadEn()).isEqualTo(LocalDateTime.ofInstant(CLOCK.instant(), ZoneOffset.UTC));
        verify(asignaciones).save(asignacion);
        verify(intentos).save(intento);
        verify(audit).recordTrusted(Mockito.argThat(event -> event.action().equals("ASIGNACION_REVOCADA")
                && event.entity().equals("asignacion_test")
                && event.entityId().equals("77")
                && event.newValuesJson().contains("\"sesionId\":10")));
    }

    @Test
    void revokeAssignmentRechazaAsignacionDeOtraSesion() {
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setSesionAplicacion(sesion(EstadoSesionAplicacion.ABIERTA));
        asignacion.getSesionAplicacion().setId(99L);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        assertThatThrownBy(() -> service.revokeAssignment(10L, 77L))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("Asignacion fuera de la sesion");
    }

    private AsignacionTest asignacionRegenerable(EstadoAsignacion estado, EstadoSesionAplicacion estadoSesion) {
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setSesionAplicacion(sesion(estadoSesion));
        asignacion.setEstado(estado);
        asignacion.setTokenAccesoHash("hash-viejo");
        asignacion.setTokenExpiraEn(LocalDateTime.ofInstant(CLOCK.instant(), ZoneOffset.UTC).minusHours(1));
        asignacion.setIntentosAcceso(4);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));
        when(tokenService.generateRawToken()).thenReturn("token-nuevo");
        when(tokenService.hash("token-nuevo")).thenReturn("hash-nuevo");
        return asignacion;
    }

    @Test
    void regenerarTokenReemplazaHashFechaIntentosYAuditaSinElToken() {
        AsignacionTest asignacion = asignacionRegenerable(EstadoAsignacion.EN_PROGRESO, EstadoSesionAplicacion.ABIERTA);

        var result = service.regenerateAssignmentToken(10L, 77L, Duration.ofHours(8));

        LocalDateTime expected = LocalDateTime.ofInstant(CLOCK.instant(), ZoneOffset.UTC).plusHours(8);
        assertThat(result.assignmentId()).isEqualTo(77L);
        assertThat(result.rawToken()).isEqualTo("token-nuevo");
        assertThat(result.expiresAt()).isEqualTo(expected);
        assertThat(asignacion.getTokenAccesoHash()).isEqualTo("hash-nuevo");
        assertThat(asignacion.getTokenExpiraEn()).isEqualTo(expected);
        assertThat(asignacion.getIntentosAcceso()).isZero();
        assertThat(asignacion.getEstado()).isEqualTo(EstadoAsignacion.EN_PROGRESO);
        verify(asignaciones).save(asignacion);
        Mockito.verifyNoInteractions(intentos);
        verify(audit).recordTrusted(Mockito.argThat(event -> event.action().equals("ASIGNACION_TOKEN_REGENERADO")
                && event.entity().equals("asignacion_test")
                && event.entityId().equals("77")
                && event.newValuesJson().contains("\"sesionId\":10")
                && event.newValuesJson().contains("\"expiresAt\"")
                && !event.newValuesJson().contains("token-nuevo")));
    }

    @Test
    void regenerarTokenDeAsignacionExpiradaLaDevuelveAAsignado() {
        AsignacionTest asignacion = asignacionRegenerable(EstadoAsignacion.EXPIRADO, EstadoSesionAplicacion.ABIERTA);

        service.regenerateAssignmentToken(10L, 77L, Duration.ofHours(2));

        assertThat(asignacion.getEstado()).isEqualTo(EstadoAsignacion.ASIGNADO);
    }

    @Test
    void regenerarTokenDeAsignacionDeOtraSesionOInexistenteEs404() {
        asignacionRegenerable(EstadoAsignacion.ASIGNADO, EstadoSesionAplicacion.ABIERTA);
        when(asignaciones.findByIdForUpdate(88L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.regenerateAssignmentToken(99L, 77L, Duration.ofHours(8)))
                .isInstanceOf(jakarta.persistence.EntityNotFoundException.class);
        assertThatThrownBy(() -> service.regenerateAssignmentToken(10L, 88L, Duration.ofHours(8)))
                .isInstanceOf(jakarta.persistence.EntityNotFoundException.class);
        verify(asignaciones, never()).save(Mockito.any());
    }

    @Test
    void regenerarTokenConAsignacionCompletadaOAnuladaEs409AsignacionNoOperable() {
        for (var estado : List.of(EstadoAsignacion.COMPLETADO, EstadoAsignacion.ANULADO)) {
            AsignacionTest asignacion = asignacionRegenerable(estado, EstadoSesionAplicacion.ABIERTA);

            assertThatThrownBy(() -> service.regenerateAssignmentToken(10L, 77L, Duration.ofHours(8)))
                    .isInstanceOfSatisfying(ParticipantConflictException.class, e -> assertThat(e.getCode())
                            .isEqualTo(ParticipantConflictException.ASIGNACION_NO_OPERABLE));
            assertThat(asignacion.getTokenAccesoHash()).isEqualTo("hash-viejo");
        }
        verify(asignaciones, never()).save(Mockito.any());
    }

    @Test
    void regenerarTokenConSesionCerradaOCanceladaEs409SesionFinalizada() {
        for (var estado : List.of(EstadoSesionAplicacion.CERRADA, EstadoSesionAplicacion.CANCELADA)) {
            asignacionRegenerable(EstadoAsignacion.ASIGNADO, estado);

            assertThatThrownBy(() -> service.regenerateAssignmentToken(10L, 77L, Duration.ofHours(8)))
                    .isInstanceOfSatisfying(ParticipantConflictException.class, e -> assertThat(e.getCode())
                            .isEqualTo(ParticipantConflictException.SESION_FINALIZADA));
        }
        verify(asignaciones, never()).save(Mockito.any());
    }

    @Test
    void regenerarTokenRequierePermisoSesionAplicar() throws Exception {
        assertThat(ParticipantRuntimeService.class.getMethod("regenerateAssignmentToken", Long.class, Long.class,
                Duration.class).getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('PERM_SESION_APLICAR')");
    }

    @Test
    void recordIncidenceRegistraAuditoriaConParticipanteYTextoEscapado() {
        UUID participantId = UUID.randomUUID();
        when(sesiones.existsById(10L)).thenReturn(true);
        when(asignaciones.findBySesionAplicacionIdAndParticipanteId(10L, participantId))
                .thenReturn(Optional.of(new AsignacionTest()));

        service.recordIncidence(10L, new ParticipantRuntimeService.IncidenceCommand(participantId, "Dijo \"alto\""));

        verify(audit).recordTrusted(Mockito.argThat(event -> event.action().equals("INCIDENCIA_SESION")
                && event.entity().equals("sesion_aplicacion")
                && event.entityId().equals("10")
                && event.newValuesJson().contains(participantId.toString())
                && event.newValuesJson().contains("Dijo \\\"alto\\\"")));
    }

    @Test
    void getAssignmentsForSessionIncluyeAttemptIdCuandoExisteIntento() {
        UUID participantId = UUID.randomUUID();
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setEstado(EstadoAsignacion.EN_PROGRESO);
        asignacion.setParticipante(participante(participantId));
        asignacion.getParticipante().setNombres("Ana");
        asignacion.getParticipante().setApellidos("Lopez");
        asignacion.getParticipante().setCodigoParticipante("P-001");
        asignacion.setTokenExpiraEn(LocalDateTime.ofInstant(CLOCK.instant(), ZoneOffset.UTC).plusHours(1));
        IntentoTest intento = new IntentoTest();
        intento.setId(88L);
        intento.setEstado(EstadoIntento.EN_PROGRESO);
        intento.setUltimaActividadEn(LocalDateTime.ofInstant(CLOCK.instant(), ZoneOffset.UTC));
        intento.setAsignacion(asignacion);
        when(asignaciones.findBySesionAplicacionIdWithParticipante(10L)).thenReturn(List.of(asignacion));
        when(intentos.findByAsignacionSesionAplicacionIdWithUltimoSubtest(10L)).thenReturn(List.of(intento));
        when(sesionSubtests.countBySesionAplicacionId(10L)).thenReturn(0L);
        when(intentoSubtests.countCompletedByIntentoIds(List.of(88L))).thenReturn(List.of());

        var result = service.getAssignmentsForSession(10L);

        assertThat(result).singleElement().satisfies(row -> {
            assertThat(row.assignmentId()).isEqualTo(77L);
            assertThat(row.attemptId()).isEqualTo(88L);
        });
        verify(intentos, never()).findByAsignacionId(77L);
        verify(sesionSubtests).countBySesionAplicacionId(10L);
    }

    @Test
    void getAssignmentsForSessionExponeEstadosCrudosYCorrigeAnuladaConIntentoCompletadoYTokenVencido() {
        LocalDateTime now = LocalDateTime.ofInstant(CLOCK.instant(), ZoneOffset.UTC);
        AsignacionTest anulada = asignacionConParticipante(1L, EstadoAsignacion.ANULADO, now.plusHours(1));
        AsignacionTest vencida = asignacionConParticipante(2L, EstadoAsignacion.ASIGNADO, now.minusHours(1));
        AsignacionTest sinIniciar = asignacionConParticipante(3L, EstadoAsignacion.ASIGNADO, now.plusHours(1));
        IntentoTest completado = new IntentoTest();
        completado.setId(91L);
        completado.setEstado(EstadoIntento.COMPLETADO);
        completado.setAsignacion(anulada);
        when(asignaciones.findBySesionAplicacionIdWithParticipante(10L))
                .thenReturn(List.of(anulada, vencida, sinIniciar));
        when(intentos.findByAsignacionSesionAplicacionIdWithUltimoSubtest(10L)).thenReturn(List.of(completado));
        when(intentoSubtests.countCompletedByIntentoIds(List.of(91L))).thenReturn(List.of());

        var result = service.getAssignmentsForSession(10L);

        assertThat(result).extracting(r -> r.assignmentId(), r -> r.status(), r -> r.state(),
                r -> r.assignmentStatus(), r -> r.attemptStatus())
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1L, "REVOCADO", "completado", "ANULADO", "COMPLETADO"),
                        org.assertj.core.groups.Tuple.tuple(2L, "VENCIDO", "no-iniciado", "ASIGNADO", null),
                        org.assertj.core.groups.Tuple.tuple(3L, "GENERADO", "no-iniciado", "ASIGNADO", null));
        assertThat(result).allSatisfy(row -> {
            assertThat(row.rejectedAnswersCount()).isZero();
            assertThat(row.rejectedAnswers()).isEmpty();
        });
    }

    private static AsignacionTest asignacionConParticipante(long id, EstadoAsignacion estado,
            LocalDateTime tokenExpiraEn) {
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(id);
        asignacion.setEstado(estado);
        asignacion.setParticipante(participante(UUID.randomUUID()));
        asignacion.getParticipante().setNombres("N" + id);
        asignacion.getParticipante().setApellidos("A" + id);
        asignacion.setTokenExpiraEn(tokenExpiraEn);
        return asignacion;
    }

    private static ParticipantAccessService.ParticipantAccess access(long assignmentId) {
        return new ParticipantAccessService.ParticipantAccess(assignmentId, UUID.randomUUID());
    }

    private static IntentoTest intentoWithAssignment(long assignmentId) {
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(assignmentId);
        asignacion.setSesionAplicacion(sesion(EstadoSesionAplicacion.ABIERTA));
        IntentoTest intento = new IntentoTest();
        intento.setAsignacion(asignacion);
        return intento;
    }

    private static SesionAplicacion sesion(EstadoSesionAplicacion estado) {
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(estado);
        return sesion;
    }

    private static Participante participante(UUID id) {
        Participante participante = new Participante();
        participante.setId(id);
        participante.setFechaNacimiento(LocalDate.of(2000, 1, 1));
        participante.setSexo(new CatalogoSexo());
        participante.setCarrera(new Carrera());
        participante.setCohorte(new Cohorte());
        participante.setGrupoAcademico(new GrupoAcademico());
        return participante;
    }

    private static IntentoTest intentoConSesion() {
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setSesionAplicacion(sesion(EstadoSesionAplicacion.ABIERTA));
        IntentoTest intento = new IntentoTest();
        intento.setEstado(EstadoIntento.EN_PROGRESO);
        intento.setAsignacion(asignacion);
        return intento;
    }

    @Test
    void finishSubtestBloqueaElIntentoAntesDeLeerElSubtest() {
        subtestEnProgreso(120, null);

        service.finishSubtest(access(99L), 5L, 20L, 0);

        org.mockito.InOrder orden = Mockito.inOrder(intentos, intentoSubtests);
        orden.verify(intentos).findByIdForUpdate(5L);
        orden.verify(intentoSubtests).findByIntentoIdAndSubtestId(5L, 20L);
    }

    // ---- Entrega del subtest "tal como estaba" ----

    private IntentoSubtest subtestConItems(long segundosAtras, Integer limite) {
        IntentoSubtest intentoSubtest = subtestEnProgreso(segundosAtras, limite);
        intentoSubtest.getIntento().setId(5L);
        intentoSubtest.getIntento().setEstado(EstadoIntento.EN_PROGRESO);
        com.uam.psychoform.instrument.model.Subtest subtest = new com.uam.psychoform.instrument.model.Subtest();
        subtest.setId(20L);
        intentoSubtest.setSubtest(subtest);
        com.uam.psychoform.instrument.model.Item respondido = new com.uam.psychoform.instrument.model.Item();
        respondido.setId(100L);
        com.uam.psychoform.instrument.model.Item omitido = new com.uam.psychoform.instrument.model.Item();
        omitido.setId(101L);
        when(items.findBySubtestIdAndEstadoOrderByNumeroOrdenAsc(20L,
                com.uam.psychoform.security.model.EstadoGeneral.ACTIVO)).thenReturn(List.of(respondido, omitido));
        com.uam.psychoform.assessment.model.RespuestaItem previa = new com.uam.psychoform.assessment.model.RespuestaItem();
        previa.setItem(respondido);
        when(respuestas.findByIntentoId(5L)).thenReturn(List.of(previa));
        return intentoSubtest;
    }

    private List<com.uam.psychoform.assessment.model.RespuestaItem> vaciasGuardadas() {
        org.mockito.ArgumentCaptor<com.uam.psychoform.assessment.model.RespuestaItem> captor =
                org.mockito.ArgumentCaptor.forClass(com.uam.psychoform.assessment.model.RespuestaItem.class);
        verify(respuestas, Mockito.atLeast(0)).save(captor.capture());
        return captor.getAllValues();
    }

    @Test
    void finishSubtestRegistraRespuestasVaciasParaLosItemsOmitidos() {
        IntentoSubtest intentoSubtest = subtestConItems(120, 600);

        service.finishSubtest(access(99L), 5L, 20L, 0);

        assertThat(intentoSubtest.getEstado()).isEqualTo(EstadoIntento.COMPLETADO);
        List<com.uam.psychoform.assessment.model.RespuestaItem> vacias = vaciasGuardadas();
        assertThat(vacias).hasSize(1);
        assertThat(vacias.get(0).getItem().getId()).isEqualTo(101L);
        assertThat(vacias.get(0).getIntentoSubtest()).isSameAs(intentoSubtest);
        assertThat(vacias.get(0).getEsFinal()).isTrue();
    }

    @Test
    void finishSubtestEsIdempotenteSiElSubtestYaSeCerroPorTiempo() {
        IntentoSubtest intentoSubtest = subtestConItems(700, 600);
        intentoSubtest.setEstado(EstadoIntento.COMPLETADO);
        intentoSubtest.setTiempoUsadoSegundos(600);

        IntentoSubtest result = service.finishSubtest(access(99L), 5L, 20L, 0);

        assertThat(result).isSameAs(intentoSubtest);
        assertThat(result.getTiempoUsadoSegundos()).isEqualTo(600);
        verify(intentoSubtests, Mockito.never()).save(Mockito.any());
        verify(respuestas, Mockito.never()).save(Mockito.any());
    }

    @Test
    void finishAttemptEntregaLosSubtestsQueSiguenEnCurso() {
        IntentoSubtest enCurso = subtestConItems(120, 600);
        IntentoTest intento = enCurso.getIntento();
        intento.getAsignacion().setEstado(com.uam.psychoform.assessment.model.EstadoAsignacion.EN_PROGRESO);
        when(intentoSubtests.findByIntentoId(5L)).thenReturn(List.of(enCurso));

        service.finishAttempt(access(99L), 5L, 0);

        assertThat(intento.getEstado()).isEqualTo(EstadoIntento.COMPLETADO);
        assertThat(enCurso.getEstado()).isEqualTo(EstadoIntento.COMPLETADO);
        assertThat(vaciasGuardadas()).extracting(r -> r.getItem().getId()).containsExactly(101L);
    }

    @Test
    void cierreAutomaticoEntregaSubtestsVencidosYRespetaLosQueTienenTiempo() {
        IntentoSubtest vencido = subtestConItems(606, 600);
        IntentoSubtestRepository.CierreCandidato candidato = new IntentoSubtestRepository.CierreCandidato() {
            public Long getIntentoId() { return 5L; }
            public Long getIntentoSubtestId() { return 1L; }
        };
        when(intentoSubtests.findCandidatosCierrePorTiempo()).thenReturn(List.of(candidato));
        when(intentoSubtests.findById(1L)).thenReturn(Optional.of(vencido));
        org.springframework.transaction.PlatformTransactionManager txManager =
                Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class);
        ExpiredSubtestCloser closer = new ExpiredSubtestCloser(intentoSubtests, intentos, closing, txManager, CLOCK, entityManager);

        assertThat(closer.cerrarExpirados()).isEqualTo(1);
        assertThat(vencido.getEstado()).isEqualTo(EstadoIntento.COMPLETADO);
        assertThat(vencido.getTiempoUsadoSegundos()).isEqualTo(600);
        assertThat(vaciasGuardadas()).extracting(r -> r.getItem().getId()).containsExactly(101L);

        // Dentro de limite + gracia (605 s) no se cierra.
        IntentoSubtest conTiempo = subtestConItems(605, 600);
        when(intentoSubtests.findById(1L)).thenReturn(Optional.of(conTiempo));
        assertThat(closer.cerrarExpirados()).isZero();
        assertThat(conTiempo.getEstado()).isEqualTo(EstadoIntento.EN_PROGRESO);
    }

    @Test
    void cierreAutomaticoDescuentaPausas() {
        IntentoSubtest pausado = subtestConItems(900, 600);
        PausaSesion pausa = new PausaSesion();
        pausa.setPausadoEn(pausado.getIniciadoEn().plusSeconds(100));
        pausa.setReanudadoEn(null); // pausa todavia abierta: 100 s efectivos
        when(pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(10L)).thenReturn(List.of(pausa));
        IntentoSubtestRepository.CierreCandidato candidato = new IntentoSubtestRepository.CierreCandidato() {
            public Long getIntentoId() { return 5L; }
            public Long getIntentoSubtestId() { return 1L; }
        };
        when(intentoSubtests.findCandidatosCierrePorTiempo()).thenReturn(List.of(candidato));
        when(intentoSubtests.findById(1L)).thenReturn(Optional.of(pausado));
        ExpiredSubtestCloser closer = new ExpiredSubtestCloser(intentoSubtests, intentos, closing,
                Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class), CLOCK, entityManager);

        assertThat(closer.cerrarExpirados()).isZero();
        assertThat(pausado.getEstado()).isEqualTo(EstadoIntento.EN_PROGRESO);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.EnumSource(value = EstadoSesionAplicacion.class, names = { "CERRADA", "CANCELADA" })
    void cierreAutomaticoIgnoraSesionesTerminadas(EstadoSesionAplicacion terminal) {
        IntentoSubtest vencido = subtestConItems(900, 600);
        when(entityManager.find(SesionAplicacion.class, 10L)).thenReturn(sesion(terminal));
        IntentoSubtestRepository.CierreCandidato candidato = new IntentoSubtestRepository.CierreCandidato() {
            public Long getIntentoId() { return 5L; }
            public Long getIntentoSubtestId() { return 1L; }
        };
        when(intentoSubtests.findCandidatosCierrePorTiempo()).thenReturn(List.of(candidato));
        when(intentoSubtests.findById(1L)).thenReturn(Optional.of(vencido));
        ExpiredSubtestCloser closer = new ExpiredSubtestCloser(intentoSubtests, intentos, closing,
                Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class), CLOCK, entityManager);

        assertThat(closer.cerrarExpirados()).isZero();
        assertThat(vencido.getEstado()).isEqualTo(EstadoIntento.EN_PROGRESO);
        verify(respuestas, Mockito.never()).save(Mockito.any());
    }
}

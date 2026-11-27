package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.AsignacionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;

class ParticipantAccessServiceTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    private final AsignacionTestRepository asignaciones = Mockito.mock(AsignacionTestRepository.class);
    private final UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
    private final ParticipantTokenService tokens = Mockito.mock(ParticipantTokenService.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final ParticipantAccessService service = new ParticipantAccessService(asignaciones, usuarios, tokens,
            currentActor, CLOCK);

    @Test
    void emisionDeTokenRequierePermisoDeGestionDeAccesos() throws Exception {
        Method method = ParticipantAccessService.class.getMethod("issueToken", long.class, Duration.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('PERM_PARTICIPANTE_ACCESO_GESTIONAR')");
    }

    @Test
    void issueTokenUsaActorActualComoEvaluadorYPersisteSoloHash() {
        UUID actorId = UUID.randomUUID();
        Usuario evaluador = new Usuario();
        evaluador.setId(actorId);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(99L);
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(evaluador));
        when(asignaciones.findByIdForUpdate(99L)).thenReturn(Optional.of(asignacion));
        when(tokens.generateRawToken()).thenReturn("raw-token");
        when(tokens.hash("raw-token")).thenReturn("hashed-token");

        ParticipantAccessService.IssuedParticipantToken issued = service.issueToken(99L, Duration.ofHours(2));

        assertThat(issued.rawToken()).isEqualTo("raw-token");
        assertThat(issued.expiresAt()).isEqualTo(LocalDateTime.ofInstant(Instant.parse("2026-06-24T14:00:00Z"), ZoneOffset.UTC));
        assertThat(asignacion.getEvaluador()).isSameAs(evaluador);
        assertThat(asignacion.getTokenAccesoHash()).isEqualTo("hashed-token");
        assertThat(asignacion.getTokenUsadoEn()).isNull();
        assertThat(asignacion.getIntentosAcceso()).isZero();
        verify(asignaciones).save(asignacion);
    }

    @Test
    void grantParticipantAccessMarcaUsoCuandoTokenSesionYAsignacionSonValidos() {
        AsignacionTest asignacion = asignacionAbierta();
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));
        when(tokens.matches("raw-token", "hashed-token")).thenReturn(true);

        ParticipantAccessService.GrantedParticipantAccess access = service.grantParticipantAccess(77L, "raw-token");

        assertThat(access.assignmentId()).isEqualTo(77L);
        assertThat(access.participantId()).isEqualTo(asignacion.getParticipante().getId());
        assertThat(access.tokenExpiresAt()).isEqualTo(asignacion.getTokenExpiraEn());
        assertThat(asignacion.getTokenUsadoEn()).isEqualTo(LocalDateTime.ofInstant(CLOCK.instant(), ZoneOffset.UTC));
    }

    @Test
    void grantParticipantAccessExpiraAsignacionCuandoTokenYaVencio() {
        AsignacionTest asignacion = asignacionAbierta();
        asignacion.setTokenExpiraEn(LocalDateTime.ofInstant(CLOCK.instant().minusSeconds(1), ZoneOffset.UTC));
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        assertThatThrownBy(() -> service.grantParticipantAccess(77L, "raw-token"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Token expirado");
        assertThat(asignacion.getEstado()).isEqualTo(EstadoAsignacion.EXPIRADO);
    }

    @Test
    void grantParticipantAccessIncrementaIntentosSiTokenNoCoincide() {
        AsignacionTest asignacion = asignacionAbierta();
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));
        when(tokens.matches("raw-token", "hashed-token")).thenReturn(false);

        assertThatThrownBy(() -> service.grantParticipantAccess(77L, "raw-token"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Token invalido");
        assertThat(asignacion.getIntentosAcceso()).isEqualTo(1);
    }

    @Test
    void validateRuntimeWriteDevuelveContextoSoloSiTokenCoincideConAsignacionActiva() {
        AsignacionTest asignacion = asignacionAbierta();
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        ParticipantAccessService.ParticipantAccess access = service.validateRuntimeWrite(
                new ParticipantAccessService.ParticipantAccess(77L, asignacion.getParticipante().getId()));

        assertThat(access.assignmentId()).isEqualTo(77L);
        assertThat(access.participantId()).isEqualTo(asignacion.getParticipante().getId());
    }

    @Test
    void validateRuntimeWriteRechazaParticipanteDeOtraAsignacion() {
        AsignacionTest asignacion = asignacionAbierta();
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        assertThatThrownBy(() -> service.validateRuntimeWrite(
                new ParticipantAccessService.ParticipantAccess(77L, UUID.randomUUID())))
                .isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("Asignacion fuera de alcance");
    }

    @Test
    void validateRuntimeWriteNoComprueбaElVencimientoDelEnlaceConUnJwtVigente() {
        // B2: el enlace regenerado (TTL 1 h) ya vencio dos horas despues, pero el JWT emitido antes sigue vigente.
        AsignacionTest asignacion = asignacionAbierta();
        asignacion.setTokenExpiraEn(LocalDateTime.ofInstant(CLOCK.instant().minusSeconds(3600), ZoneOffset.UTC));
        asignacion.setIntentosAcceso(0);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));

        ParticipantAccessService.ParticipantAccess access = service.validateRuntimeWrite(accessOf(asignacion));

        assertThat(access.assignmentId()).isEqualTo(77L);
        assertThat(asignacion.getEstado()).isEqualTo(EstadoAsignacion.ASIGNADO);
    }

    private ParticipantAccessService.ParticipantAccess accessOf(AsignacionTest a) {
        return new ParticipantAccessService.ParticipantAccess(77L, a.getParticipante().getId());
    }

    private AsignacionTest conEstado(EstadoSesionAplicacion estado) {
        AsignacionTest asignacion = asignacionAbierta();
        asignacion.getSesionAplicacion().setEstado(estado);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));
        return asignacion;
    }

    @Test
    void readPermiteAbiertaYPausada() {
        for (EstadoSesionAplicacion estado : List.of(EstadoSesionAplicacion.ABIERTA, EstadoSesionAplicacion.PAUSADA)) {
            AsignacionTest a = conEstado(estado);
            assertThat(service.validateRuntimeRead(accessOf(a)).assignmentId()).isEqualTo(77L);
        }
    }

    @Test
    void writeConSesionPausadaLanzaSesionPausada() {
        AsignacionTest a = conEstado(EstadoSesionAplicacion.PAUSADA);
        assertThatThrownBy(() -> service.validateRuntimeWrite(accessOf(a)))
                .isInstanceOf(SesionPausadaException.class)
                .extracting(e -> ((ParticipantConflictException) e).getCode()).isEqualTo("SESION_PAUSADA");
    }

    @Test
    void writeYReadConSesionProgramadaLanzanSesionNoAbierta() {
        AsignacionTest a = conEstado(EstadoSesionAplicacion.PROGRAMADA);
        assertThat(codeOf(() -> service.validateRuntimeWrite(accessOf(a)))).isEqualTo("SESION_NO_ABIERTA");
        assertThat(codeOf(() -> service.validateRuntimeRead(accessOf(a)))).isEqualTo("SESION_NO_ABIERTA");
    }

    @Test
    void writeYReadConSesionFinalizadaLanzanSesionFinalizada() {
        for (EstadoSesionAplicacion estado : List.of(EstadoSesionAplicacion.CERRADA, EstadoSesionAplicacion.CANCELADA)) {
            AsignacionTest a = conEstado(estado);
            assertThat(codeOf(() -> service.validateRuntimeWrite(accessOf(a)))).isEqualTo("SESION_FINALIZADA");
            assertThat(codeOf(() -> service.validateRuntimeRead(accessOf(a)))).isEqualTo("SESION_FINALIZADA");
        }
    }

    @Test
    void lecturaConEnlaceVencidoYJwtVigenteNoLanzaTokenExpirado() {
        AsignacionTest a = conEstado(EstadoSesionAplicacion.ABIERTA);
        a.setTokenExpiraEn(LocalDateTime.ofInstant(CLOCK.instant().minusSeconds(1), ZoneOffset.UTC));
        assertThat(service.validateRuntimeRead(accessOf(a)).assignmentId()).isEqualTo(77L);
        assertThat(a.getEstado()).isEqualTo(EstadoAsignacion.ASIGNADO);
    }

    @Test
    void asignacionAnuladaLanzaAsignacionNoOperable() {
        AsignacionTest a = conEstado(EstadoSesionAplicacion.ABIERTA);
        a.setEstado(EstadoAsignacion.ANULADO);
        assertThat(codeOf(() -> service.validateRuntimeWrite(accessOf(a)))).isEqualTo("ASIGNACION_NO_OPERABLE");
        assertThat(codeOf(() -> service.validateRuntimeRead(accessOf(a)))).isEqualTo("ASIGNACION_NO_OPERABLE");
    }

    @Test
    void grantParticipantAccessAceptaSesionPausada() {
        AsignacionTest a = conEstado(EstadoSesionAplicacion.PAUSADA);
        when(tokens.matches("raw-token", "hashed-token")).thenReturn(true);
        assertThat(service.grantParticipantAccess(77L, "raw-token").assignmentId()).isEqualTo(77L);
    }

    private static String codeOf(Runnable action) {
        try {
            action.run();
        } catch (ParticipantConflictException e) {
            return e.getCode();
        }
        return null;
    }

    private static AsignacionTest asignacionAbierta() {
        Participante participante = new Participante();
        participante.setId(UUID.randomUUID());
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setEstado(EstadoSesionAplicacion.ABIERTA);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setParticipante(participante);
        asignacion.setSesionAplicacion(sesion);
        asignacion.setTokenAccesoHash("hashed-token");
        asignacion.setTokenExpiraEn(LocalDateTime.ofInstant(CLOCK.instant().plusSeconds(3600), ZoneOffset.UTC));
        asignacion.setIntentosAcceso(0);
        asignacion.setEstado(EstadoAsignacion.ASIGNADO);
        return asignacion;
    }
}

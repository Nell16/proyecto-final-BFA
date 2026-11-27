package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.assessment.dto.PausaSesionDto;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.PausaSesion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.PausaSesionRepository;
import com.uam.psychoform.assessment.repository.SesionAplicacionRepository;
import com.uam.psychoform.audit.service.AuditLogService;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;

class SesionAplicacionServiceTest {
    private static final Instant T0 = Instant.parse("2026-11-24T10:00:00Z");
    private static final LocalDateTime NOW = LocalDateTime.ofInstant(T0, ZoneOffset.UTC);
    private static final UUID ACTOR = UUID.randomUUID();

    private SesionAplicacionRepository repository;
    private PausaSesionRepository pausas;
    private AuditLogService audit;
    private SesionAplicacionService service;
    private Usuario actor;

    @BeforeEach
    void setUp() {
        repository = mock(SesionAplicacionRepository.class);
        pausas = mock(PausaSesionRepository.class);
        UsuarioRepository usuarios = mock(UsuarioRepository.class);
        CurrentActor currentActor = mock(CurrentActor.class);
        audit = mock(AuditLogService.class);
        actor = new Usuario();
        actor.setId(ACTOR);
        when(currentActor.usuarioId()).thenReturn(ACTOR);
        when(usuarios.getReferenceById(ACTOR)).thenReturn(actor);
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(pausas.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(pausas.findFirstBySesionAplicacionIdAndReanudadoEnIsNull(10L)).thenReturn(Optional.empty());
        service = new SesionAplicacionService(repository, pausas, usuarios, currentActor, audit,
                Clock.fixed(T0, ZoneOffset.UTC));
    }

    private SesionAplicacion sesion(EstadoSesionAplicacion estado) {
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(estado);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(sesion));
        return sesion;
    }

    private PausaSesion pausaAbierta(SesionAplicacion sesion) {
        PausaSesion pausa = new PausaSesion();
        pausa.setId(77L);
        pausa.setSesionAplicacion(sesion);
        pausa.setPausadoEn(NOW.minusMinutes(5));
        pausa.setMotivo("Simulacro");
        when(pausas.findFirstBySesionAplicacionIdAndReanudadoEnIsNull(10L)).thenReturn(Optional.of(pausa));
        sesion.setPausadoEn(pausa.getPausadoEn());
        return pausa;
    }

    // ---- Transiciones validas ----

    @Test
    void abrirPasaDeProgramadaAAbiertaYRegistraInicioReal() {
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.PROGRAMADA);

        SesionAplicacion result = service.abrir(10L);

        assertThat(result.getEstado()).isEqualTo(EstadoSesionAplicacion.ABIERTA);
        assertThat(result.getInicioReal()).isEqualTo(NOW);
        assertThat(sesion.getFinReal()).isNull();
    }

    @Test
    void abrirConservaInicioRealExistente() {
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.PROGRAMADA);
        sesion.setInicioReal(NOW.minusDays(1));

        assertThat(service.abrir(10L).getInicioReal()).isEqualTo(NOW.minusDays(1));
    }

    @Test
    void pausarCreaPausaAbiertaYAudita() {
        sesion(EstadoSesionAplicacion.ABIERTA);

        SesionAplicacion result = service.pausar(10L, "  Corte de luz  ");

        assertThat(result.getEstado()).isEqualTo(EstadoSesionAplicacion.PAUSADA);
        assertThat(result.getPausadoEn()).isEqualTo(NOW);
        ArgumentCaptor<PausaSesion> pausa = ArgumentCaptor.forClass(PausaSesion.class);
        verify(pausas).save(pausa.capture());
        assertThat(pausa.getValue().getPausadoEn()).isEqualTo(NOW);
        assertThat(pausa.getValue().getReanudadoEn()).isNull();
        assertThat(pausa.getValue().getPausadoPor()).isSameAs(actor);
        assertThat(pausa.getValue().getMotivo()).isEqualTo("Corte de luz");
        ArgumentCaptor<AuditLogService.AuditEvent> event = ArgumentCaptor.forClass(AuditLogService.AuditEvent.class);
        verify(audit).recordTrusted(event.capture());
        assertThat(event.getValue().action()).isEqualTo("SESION_PAUSADA");
        assertThat(event.getValue().entity()).isEqualTo("sesion_aplicacion");
        assertThat(event.getValue().entityId()).isEqualTo("10");
        assertThat(event.getValue().newValuesJson()).contains("\"motivo\":\"Corte de luz\"");
    }

    @Test
    void pausarSinMotivoGuardaMotivoNulo() {
        sesion(EstadoSesionAplicacion.ABIERTA);

        service.pausar(10L, null);

        ArgumentCaptor<PausaSesion> pausa = ArgumentCaptor.forClass(PausaSesion.class);
        verify(pausas).save(pausa.capture());
        assertThat(pausa.getValue().getMotivo()).isNull();
    }

    @Test
    void reanudarCierraLaPausaAbiertaYAudita() {
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.PAUSADA);
        PausaSesion pausa = pausaAbierta(sesion);

        SesionAplicacion result = service.reanudar(10L);

        assertThat(result.getEstado()).isEqualTo(EstadoSesionAplicacion.ABIERTA);
        assertThat(result.getPausadoEn()).isNull();
        assertThat(pausa.getReanudadoEn()).isEqualTo(NOW);
        assertThat(pausa.getReanudadoPor()).isSameAs(actor);
        ArgumentCaptor<AuditLogService.AuditEvent> event = ArgumentCaptor.forClass(AuditLogService.AuditEvent.class);
        verify(audit).recordTrusted(event.capture());
        assertThat(event.getValue().action()).isEqualTo("SESION_REANUDADA");
        assertThat(event.getValue().newValuesJson()).contains("\"motivo\":\"Simulacro\"");
    }

    @Test
    void cerrarDesdeAbiertaRegistraFinReal() {
        sesion(EstadoSesionAplicacion.ABIERTA);

        SesionAplicacion result = service.cerrar(10L);

        assertThat(result.getEstado()).isEqualTo(EstadoSesionAplicacion.CERRADA);
        assertThat(result.getFinReal()).isEqualTo(NOW);
        verify(pausas, never()).save(any());
    }

    @Test
    void cerrarDesdePausadaCierraLaPausaAbierta() {
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.PAUSADA);
        PausaSesion pausa = pausaAbierta(sesion);

        SesionAplicacion result = service.cerrar(10L);

        assertThat(result.getEstado()).isEqualTo(EstadoSesionAplicacion.CERRADA);
        assertThat(result.getFinReal()).isEqualTo(NOW);
        assertThat(result.getPausadoEn()).isNull();
        assertThat(pausa.getReanudadoEn()).isEqualTo(NOW);
        verify(pausas).save(pausa);
    }

    @ParameterizedTest
    @EnumSource(value = EstadoSesionAplicacion.class, names = { "PROGRAMADA", "ABIERTA" })
    void cancelarDesdeProgramadaOAbiertaRegistraFinReal(EstadoSesionAplicacion origen) {
        sesion(origen);

        SesionAplicacion result = service.cancelar(10L);

        assertThat(result.getEstado()).isEqualTo(EstadoSesionAplicacion.CANCELADA);
        assertThat(result.getFinReal()).isEqualTo(NOW);
    }

    @Test
    void cancelarDesdePausadaCierraLaPausaAbierta() {
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.PAUSADA);
        PausaSesion pausa = pausaAbierta(sesion);

        SesionAplicacion result = service.cancelar(10L);

        assertThat(result.getEstado()).isEqualTo(EstadoSesionAplicacion.CANCELADA);
        assertThat(pausa.getReanudadoEn()).isEqualTo(NOW);
        assertThat(result.getPausadoEn()).isNull();
    }

    // ---- Transiciones invalidas (409) ----

    private void assertInvalid(EnumSet<EstadoSesionAplicacion> origenes, Function<Long, ?> accion) {
        for (EstadoSesionAplicacion origen : origenes) {
            SesionAplicacion sesion = sesion(origen);
            assertThatThrownBy(() -> accion.apply(10L)).as(origen.name()).isInstanceOf(IllegalStateException.class);
            assertThat(sesion.getEstado()).as(origen.name()).isEqualTo(origen);
        }
    }

    @Test
    void abrirSoloDesdeProgramada() {
        assertInvalid(EnumSet.complementOf(EnumSet.of(EstadoSesionAplicacion.PROGRAMADA)), service::abrir);
    }

    @Test
    void pausarSoloDesdeAbiertaIncluidoDoblePausar() {
        assertInvalid(EnumSet.complementOf(EnumSet.of(EstadoSesionAplicacion.ABIERTA)),
                id -> service.pausar(id, null));
        verify(pausas, never()).save(any());
    }

    @Test
    void pausarRechazaSiYaExistePausaAbiertaAunqueElEstadoSeaAbierta() {
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.ABIERTA);
        pausaAbierta(sesion);

        assertThatThrownBy(() -> service.pausar(10L, null)).isInstanceOf(IllegalStateException.class);
        verify(pausas, never()).save(any());
    }

    @Test
    void reanudarSinPausaEsInvalido() {
        assertInvalid(EnumSet.complementOf(EnumSet.of(EstadoSesionAplicacion.PAUSADA)), service::reanudar);
        verify(audit, never()).recordTrusted(any());
    }

    @Test
    void cerrarSoloDesdeAbiertaOPausada() {
        assertInvalid(EnumSet.of(EstadoSesionAplicacion.PROGRAMADA, EstadoSesionAplicacion.CERRADA,
                EstadoSesionAplicacion.CANCELADA), service::cerrar);
    }

    @Test
    void cancelarRechazaEstadosTerminales() {
        assertInvalid(EnumSet.of(EstadoSesionAplicacion.CERRADA, EstadoSesionAplicacion.CANCELADA),
                service::cancelar);
    }

    @Test
    void sesionInexistenteLanzaNotFound() {
        when(repository.findByIdForUpdate(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.pausar(99L, null)).isInstanceOf(EntityNotFoundException.class);
    }

    // ---- Historial ----

    @Test
    void listarPausasDevuelveElHistorialOrdenado() {
        when(repository.existsById(10L)).thenReturn(true);
        PausaSesion pausa = new PausaSesion();
        pausa.setId(1L);
        pausa.setPausadoEn(NOW.minusMinutes(10));
        pausa.setReanudadoEn(NOW.minusMinutes(5));
        pausa.setPausadoPor(actor);
        pausa.setMotivo("m");
        when(pausas.findBySesionAplicacionIdOrderByPausadoEnAsc(10L)).thenReturn(List.of(pausa));

        assertThat(service.listarPausas(10L)).containsExactly(
                new PausaSesionDto(1L, NOW.minusMinutes(10), NOW.minusMinutes(5), ACTOR, "m"));
    }

    @Test
    void listarPausasDeSesionInexistenteLanzaNotFound() {
        when(repository.existsById(10L)).thenReturn(false);

        assertThatThrownBy(() -> service.listarPausas(10L)).isInstanceOf(EntityNotFoundException.class);
    }

    @Test
    void reanudarPausadaSinPausaAbiertaEnElHistorialEsInvalido() {
        SesionAplicacion sesion = sesion(EstadoSesionAplicacion.PAUSADA);

        assertThatThrownBy(() -> service.reanudar(10L)).isInstanceOf(IllegalStateException.class);
        assertThat(sesion.getEstado()).isEqualTo(EstadoSesionAplicacion.PAUSADA);
        verify(audit, never()).recordTrusted(any());
        verify(repository, never()).save(any());
    }
}

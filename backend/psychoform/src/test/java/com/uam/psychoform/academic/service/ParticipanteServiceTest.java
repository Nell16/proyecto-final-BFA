package com.uam.psychoform.academic.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.uam.psychoform.academic.model.Carrera;
import com.uam.psychoform.academic.model.CatalogoSexo;
import com.uam.psychoform.academic.model.Cohorte;
import com.uam.psychoform.academic.model.GrupoAcademico;
import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.academic.repository.CarreraRepository;
import com.uam.psychoform.academic.repository.CatalogoSexoRepository;
import com.uam.psychoform.academic.repository.CohorteRepository;
import com.uam.psychoform.academic.repository.GrupoAcademicoRepository;
import com.uam.psychoform.academic.repository.ParticipanteRepository;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class ParticipanteServiceTest {

    @Test
    void rechazaRegistrarUnCodigoParticipanteDuplicado() {
        ParticipanteRepository repository = Mockito.mock(ParticipanteRepository.class);
        when(repository.existsByCodigoParticipante("P-001")).thenReturn(true);
        ParticipanteService service = service(repository);

        assertThatThrownBy(() -> service.registrar("P-001", "Ana", "López"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("P-001");
    }

    @Test
    void registraParticipanteConIdentificadorAntesDePersistir() {
        ParticipanteRepository repository = Mockito.mock(ParticipanteRepository.class);
        when(repository.save(any(Participante.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ParticipanteService service = service(repository);

        Participante participante = service.registrar("P-002", "Luis", "García");

        org.assertj.core.api.Assertions.assertThat(participante.getId()).isNotNull();
    }

    @Test
    void registraParticipanteConRelacionesAcademicas() {
        ParticipanteRepository repository = Mockito.mock(ParticipanteRepository.class);
        CatalogoSexoRepository sexoRepository = Mockito.mock(CatalogoSexoRepository.class);
        CarreraRepository carreraRepository = Mockito.mock(CarreraRepository.class);
        CohorteRepository cohorteRepository = Mockito.mock(CohorteRepository.class);
        GrupoAcademicoRepository grupoRepository = Mockito.mock(GrupoAcademicoRepository.class);
        CatalogoSexo sexo = new CatalogoSexo();
        Carrera carrera = new Carrera();
        Cohorte cohorte = new Cohorte();
        GrupoAcademico grupo = new GrupoAcademico();
        when(repository.save(any(Participante.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sexoRepository.getReferenceById((short) 1)).thenReturn(sexo);
        when(carreraRepository.getReferenceById((short) 2)).thenReturn(carrera);
        when(cohorteRepository.getReferenceById((short) 3)).thenReturn(cohorte);
        when(grupoRepository.getReferenceById((short) 4)).thenReturn(grupo);
        ParticipanteService service = new ParticipanteService(
                repository,
                sexoRepository,
                carreraRepository,
                cohorteRepository,
                grupoRepository,
                Clock.systemUTC());

        Participante participante = service.registrar(
                "P-003", "Maria", "Lopez", (short) 1, (short) 2, (short) 3, (short) 4);

        org.assertj.core.api.Assertions.assertThat(participante.getSexo()).isSameAs(sexo);
        org.assertj.core.api.Assertions.assertThat(participante.getCarrera()).isSameAs(carrera);
        org.assertj.core.api.Assertions.assertThat(participante.getCohorte()).isSameAs(cohorte);
        org.assertj.core.api.Assertions.assertThat(participante.getGrupoAcademico()).isSameAs(grupo);
    }

    @Test
    void desactivaElParticipanteSinEliminarlo() {
        ParticipanteRepository repository = Mockito.mock(ParticipanteRepository.class);
        Participante participante = new Participante();
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.of(participante));
        ParticipanteService service = service(repository);

        service.desactivar(id);

        org.assertj.core.api.Assertions.assertThat(participante.getEstado())
                .isEqualTo(com.uam.psychoform.security.model.EstadoGeneral.INACTIVO);
    }

    @Test
    void actualizaCamposEditablesYActualizadoEnManteniendoElCodigo() {
        ParticipanteRepository repository = Mockito.mock(ParticipanteRepository.class);
        CatalogoSexoRepository sexoRepository = Mockito.mock(CatalogoSexoRepository.class);
        CarreraRepository carreraRepository = Mockito.mock(CarreraRepository.class);
        CohorteRepository cohorteRepository = Mockito.mock(CohorteRepository.class);
        GrupoAcademicoRepository grupoRepository = Mockito.mock(GrupoAcademicoRepository.class);
        UUID id = UUID.randomUUID();
        Participante existente = new Participante();
        existente.setId(id);
        existente.setCodigoParticipante("P-010");
        existente.setNombres("Anterior");
        existente.setApellidos("Viejo");
        existente.setActualizadoEn(LocalDateTime.of(2026, 1, 1, 0, 0));

        CatalogoSexo sexo = new CatalogoSexo();
        Carrera carrera = new Carrera();
        Cohorte cohorte = new Cohorte();
        GrupoAcademico grupo = new GrupoAcademico();

        when(repository.findById(id)).thenReturn(Optional.of(existente));
        when(repository.save(any(Participante.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(sexoRepository.getReferenceById((short) 1)).thenReturn(sexo);
        when(carreraRepository.getReferenceById((short) 2)).thenReturn(carrera);
        when(cohorteRepository.getReferenceById((short) 3)).thenReturn(cohorte);
        when(grupoRepository.getReferenceById((short) 4)).thenReturn(grupo);

        Clock fixedClock = Clock.fixed(Instant.parse("2026-11-26T12:30:00Z"), ZoneOffset.UTC);
        ParticipanteService service = new ParticipanteService(
                repository,
                sexoRepository,
                carreraRepository,
                cohorteRepository,
                grupoRepository,
                fixedClock);

        Participante actualizado = service.actualizar(
                id,
                "P-010",
                "Nuevo Nombre",
                "Nuevo Apellido",
                LocalDate.of(2001, 3, 15),
                (short) 1,
                (short) 2,
                (short) 3,
                (short) 4);

        org.assertj.core.api.Assertions.assertThat(actualizado.getCodigoParticipante()).isEqualTo("P-010");
        org.assertj.core.api.Assertions.assertThat(actualizado.getNombres()).isEqualTo("Nuevo Nombre");
        org.assertj.core.api.Assertions.assertThat(actualizado.getApellidos()).isEqualTo("Nuevo Apellido");
        org.assertj.core.api.Assertions.assertThat(actualizado.getFechaNacimiento()).isEqualTo(LocalDate.of(2001, 3, 15));
        org.assertj.core.api.Assertions.assertThat(actualizado.getSexo()).isSameAs(sexo);
        org.assertj.core.api.Assertions.assertThat(actualizado.getCarrera()).isSameAs(carrera);
        org.assertj.core.api.Assertions.assertThat(actualizado.getCohorte()).isSameAs(cohorte);
        org.assertj.core.api.Assertions.assertThat(actualizado.getGrupoAcademico()).isSameAs(grupo);
        org.assertj.core.api.Assertions.assertThat(actualizado.getActualizadoEn())
                .isEqualTo(LocalDateTime.of(2026, 11, 26, 12, 30, 0));
    }

    @Test
    void rechazaCambiarCodigoAlActualizar() {
        ParticipanteRepository repository = Mockito.mock(ParticipanteRepository.class);
        UUID id = UUID.randomUUID();
        Participante existente = new Participante();
        existente.setId(id);
        existente.setCodigoParticipante("P-010");
        when(repository.findById(id)).thenReturn(Optional.of(existente));
        ParticipanteService service = service(repository);

        assertThatThrownBy(() -> service.actualizar(id, "P-999", "Ana", "López", null, null, null, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("código");
    }

    @Test
    void rechazaActualizarParticipanteInexistente() {
        ParticipanteRepository repository = Mockito.mock(ParticipanteRepository.class);
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.empty());
        ParticipanteService service = service(repository);

        assertThatThrownBy(() -> service.actualizar(id, null, "Ana", "López", null, null, null, null, null))
                .isInstanceOf(EntityNotFoundException.class);
    }

    private ParticipanteService service(ParticipanteRepository repository) {
        return new ParticipanteService(
                repository,
                Mockito.mock(CatalogoSexoRepository.class),
                Mockito.mock(CarreraRepository.class),
                Mockito.mock(CohorteRepository.class),
                Mockito.mock(GrupoAcademicoRepository.class),
                Clock.systemUTC());
    }
}

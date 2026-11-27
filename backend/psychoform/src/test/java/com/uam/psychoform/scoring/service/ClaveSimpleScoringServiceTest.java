package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.OpcionSeleccionadaRespuesta;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.OpcionSeleccionadaRespuestaRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.RangoBaremo;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.instrument.model.EstadoConfiguracion;
import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.ClaveRespuestaLookupRepository;
import com.uam.psychoform.instrument.repository.BaremoRepository;
import com.uam.psychoform.instrument.repository.DimensionResultadoLookupRepository;
import com.uam.psychoform.instrument.repository.OpcionPuntajeDimensionRepository;
import com.uam.psychoform.instrument.repository.RangoBaremoRepository;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.scoring.repository.CalificacionRespuestaRepository;
import com.uam.psychoform.scoring.repository.ResultadoDimensionRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.access.prepost.PreAuthorize;

class ClaveSimpleScoringServiceTest {
    private final IntentoTestRepository intentos = Mockito.mock(IntentoTestRepository.class);
    private final ResultadoRepository resultados = Mockito.mock(ResultadoRepository.class);
    private final RespuestaItemRepository respuestas = Mockito.mock(RespuestaItemRepository.class);
    private final OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas = Mockito.mock(OpcionSeleccionadaRespuestaRepository.class);
    private final ClaveRespuestaLookupRepository claves = Mockito.mock(ClaveRespuestaLookupRepository.class);
    private final OpcionPuntajeDimensionRepository puntajesDimension = Mockito.mock(OpcionPuntajeDimensionRepository.class);
    private final BaremoRepository baremos = Mockito.mock(BaremoRepository.class);
    private final RangoBaremoRepository rangosBaremo = Mockito.mock(RangoBaremoRepository.class);
    private final CalificacionRespuestaRepository calificaciones = Mockito.mock(CalificacionRespuestaRepository.class);
    private final ResultadoDimensionRepository resultadosDimension = Mockito.mock(ResultadoDimensionRepository.class);
    private final RevisionManualRespuestaRepository revisiones = Mockito.mock(RevisionManualRespuestaRepository.class);
    private final UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final DimensionResultadoLookupRepository dimensionesLookup = Mockito.mock(DimensionResultadoLookupRepository.class);
    private final DimensionScoreSupport dimensionScores = new DimensionScoreSupport(dimensionesLookup, baremos, rangosBaremo,
            respuestas, opcionesSeleccionadas, claves, puntajesDimension, revisiones);
    private final ClaveSimpleScoringService service = new ClaveSimpleScoringService(intentos, resultados, respuestas,
            opcionesSeleccionadas, claves, dimensionScores, calificaciones,
            resultadosDimension, revisiones, usuarios, currentActor,
            Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC));

    @Test
    void scoreAttemptRequierePermisoCalificacion() throws Exception {
        Method method = ClaveSimpleScoringService.class.getMethod("scoreAttempt", long.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_CALIFICACION_EJECUTAR')");
    }

    @Test
    void scoreAttemptRetornaResultadoExistenteSinDuplicar() {
        Resultado existente = new Resultado();
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.of(existente));

        assertThat(service.scoreAttempt(7L)).isSameAs(existente);
    }

    @Test
    void scoreAttemptCalculaClaveSimpleConTrazabilidadYActorActual() {
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        IntentoTest intento = intentoPublicado();
        Item item = item(10L);
        OpcionItem correcta = opcion(20L, item);
        RespuestaItem respuesta = new RespuestaItem();
        respuesta.setId(30L);
        respuesta.setItem(item);
        OpcionSeleccionadaRespuesta seleccion = new OpcionSeleccionadaRespuesta();
        seleccion.setRespuesta(respuesta);
        seleccion.setOpcion(correcta);
        ClaveRespuesta clave = clave(item, correcta, new BigDecimal("2.00"));
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intento));
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(respuestas.findByIntentoIdWithItem(7L)).thenReturn(List.of(respuesta));
        when(opcionesSeleccionadas.findByRespuestaIdIn(List.of(30L))).thenReturn(List.of(seleccion));
        when(claves.findOfficialKeysByVersionId(100L)).thenReturn(List.of(clave));
        when(puntajesDimension.findActiveOfficialByVersionAndOptionIds(100L, List.of(20L))).thenReturn(List.of());

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getCalculadoPor()).isSameAs(actor);
        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("2.00");
        assertThat(resultado.getCantidadItems()).isEqualTo(1);
        assertThat(resultado.getCantidadCorrectas()).isEqualTo(1);
        verify(calificaciones).save(Mockito.argThat(c -> c.getRespuesta() == respuesta
                && c.getReglaCalificacion() == clave.getReglaCalificacion()
                && c.getOpcion() == correcta
                && c.getEsCorrecta()
                && c.getPuntajeObtenido().compareTo(new BigDecimal("2.00")) == 0));
        verify(opcionesSeleccionadas, never()).findByRespuestaId(30L);
    }

    @Test
    void scoreAttemptRechazaIntentoNoCompletado() {
        IntentoTest intento = intentoPublicado();
        intento.setEstado(EstadoIntento.EN_PROGRESO);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intento));

        assertThatThrownBy(() -> service.scoreAttempt(7L)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("finalizado");
    }

    // ---- B22: correccion segun el tipo de respuesta ----

    @Test
    void opcionMultipleConCodigosEsperadosEsCorrectaSoloConConjuntoIgual() {
        ClaveRespuesta clave = claveBase(null, new BigDecimal("3.00"));
        clave.setTextoEsperado(" b, a ,A,");

        assertThat(scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of("A", "B"), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("3.00");
        assertThat(scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of("a", "b"), null, null).getCantidadCorrectas())
                .isEqualTo(1);
        // subconjunto
        assertThat(scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of("A"), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
        // superconjunto
        Resultado superconjunto = scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of("A", "B", "C"), null, null);
        assertThat(superconjunto.getPuntajeTotalDirecto()).isEqualByComparingTo("0");
        assertThat(superconjunto.getCantidadIncorrectas()).isEqualTo(1);
        // sin seleccion
        assertThat(scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of(), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
    }

    @Test
    void opcionMultipleConConjuntoEnTablaUsaLosIdsDeOpcion() {
        ClaveRespuesta clave = claveBase(null, new BigDecimal("2.00"));
        clave.setId(900L);
        when(claves.findOptionSetRowsByKeyIds(List.of(900L)))
                .thenReturn(List.of(new Object[] {900L, 1L}, new Object[] {900L, 2L}));

        assertThat(scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of("A", "B"), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("2.00");
        assertThat(scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of("A"), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
        assertThat(scoreOne(TipoRespuesta.OPCION_MULTIPLE, clave, List.of("A", "B", "C"), null, null)
                .getPuntajeTotalDirecto()).isEqualByComparingTo("0");
    }

    @Test
    void numericaEsCorrectaHastaElBordeDeLaTolerancia() {
        ClaveRespuesta clave = claveBase(null, new BigDecimal("5.00"));
        clave.setValorNumericoEsperado(new BigDecimal("10.0000"));
        clave.setToleranciaNumerica(new BigDecimal("0.5000"));

        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, new BigDecimal("10")).getPuntajeTotalDirecto())
                .isEqualByComparingTo("5.00");
        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, new BigDecimal("10.5")).getPuntajeTotalDirecto())
                .isEqualByComparingTo("5.00");
        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, new BigDecimal("9.5")).getPuntajeTotalDirecto())
                .isEqualByComparingTo("5.00");
        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, new BigDecimal("10.5001")).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, new BigDecimal("9.4999")).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
        // sin respuesta
        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
    }

    @Test
    void numericaSinToleranciaExigeValorExacto() {
        ClaveRespuesta clave = claveBase(null, new BigDecimal("1.00"));
        clave.setValorNumericoEsperado(new BigDecimal("3.0000"));

        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, new BigDecimal("3.00")).getCantidadCorrectas())
                .isEqualTo(1);
        assertThat(scoreOne(TipoRespuesta.NUMERICA, clave, List.of(), null, new BigDecimal("3.01")).getCantidadCorrectas())
                .isZero();
    }

    @Test
    void textoAbiertoSeComparaNormalizadoSinRevisionManual() {
        ClaveRespuesta clave = claveBase(null, new BigDecimal("4.00"));
        clave.setTextoEsperado("  Árbol   de la Vida ");

        assertThat(scoreOne(TipoRespuesta.TEXTO_ABIERTO, clave, List.of(), "arbol DE   la vida", null)
                .getPuntajeTotalDirecto()).isEqualByComparingTo("4.00");
        assertThat(scoreOne(TipoRespuesta.TEXTO_ABIERTO, clave, List.of(), "arbol de vida", null)
                .getPuntajeTotalDirecto()).isEqualByComparingTo("0");
        assertThat(scoreOne(TipoRespuesta.TEXTO_ABIERTO, clave, List.of(), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
    }

    @Test
    void opcionUnicaConservaElComportamientoPorOpcionCorrecta() {
        Item item = item(10L);
        OpcionItem correcta = opcion(1L, item);
        correcta.setCodigoOpcion("A");
        ClaveRespuesta clave = clave(item, correcta, new BigDecimal("1.00"));

        assertThat(scoreOne(TipoRespuesta.OPCION_UNICA, clave, List.of("A"), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("1.00");
        assertThat(scoreOne(TipoRespuesta.OPCION_UNICA, clave, List.of("B"), null, null).getPuntajeTotalDirecto())
                .isEqualByComparingTo("0");
    }

    @Test
    void itemConRevisionManualNoSeAutocalificaYQuedaPendiente() {
        ClaveRespuesta clave = claveBase(null, new BigDecimal("4.00"));
        clave.setTextoEsperado("hola");
        clave.setRequiereRevisionManual(true);

        Resultado resultado = scoreOne(TipoRespuesta.TEXTO_ABIERTO, clave, List.of(), "hola", null);

        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("0");
        assertThat(resultado.getCantidadPendientesRevision()).isEqualTo(1);
        assertThat(resultado.getRequiereRevisionManual()).isTrue();
    }

    /** Califica un intento con una sola respuesta. Las opciones se identifican por codigo: A=1, B=2, C=3. */
    private Resultado scoreOne(TipoRespuesta tipo, ClaveRespuesta clave, List<String> selectedCodes, String text,
            BigDecimal number) {
        Item item = clave.getItem();
        item.setTipoRespuesta(tipo);
        RespuestaItem respuesta = new RespuestaItem();
        respuesta.setId(30L);
        respuesta.setItem(item);
        respuesta.setRespuestaTextoAbierto(text);
        respuesta.setRespuestaNumerica(number);
        respuesta.setRequiereRevisionManual(false);
        List<OpcionSeleccionadaRespuesta> selections = selectedCodes.stream().map(code -> {
            OpcionItem opcion = opcion((long) (code.toUpperCase().charAt(0) - 'A' + 1), item);
            opcion.setCodigoOpcion(code);
            OpcionSeleccionadaRespuesta selection = new OpcionSeleccionadaRespuesta();
            selection.setRespuesta(respuesta);
            selection.setOpcion(opcion);
            return selection;
        }).toList();
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intentoPublicado()));
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(respuestas.findByIntentoIdWithItem(7L)).thenReturn(List.of(respuesta));
        when(opcionesSeleccionadas.findByRespuestaIdIn(List.of(30L))).thenReturn(selections);
        when(claves.findOfficialKeysByVersionId(100L)).thenReturn(List.of(clave));
        return service.scoreAttempt(7L);
    }

    private static ClaveRespuesta claveBase(OpcionItem correcta, BigDecimal puntaje) {
        return clave(item(10L), correcta, puntaje);
    }

    // ---- B23: revision manual creada al calificar ----

    @Test
    void calificarCreaUnaRevisionPendientePorCadaItemConRevisionManual() {
        RespuestaItem r1 = respuestaManual(31L, 11L);
        RespuestaItem r2 = respuestaManual(32L, 12L);
        RespuestaItem r3 = respuestaAutomatica(33L, 13L);
        prepararIntento(List.of(r1, r2, r3), List.of(
                claveManual(r1.getItem(), "5.00"), claveManual(r2.getItem(), "3.00"), claveAutomatica(r3.getItem())));

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getCantidadPendientesRevision()).isEqualTo(2);
        assertThat(resultado.getRequiereRevisionManual()).isTrue();
        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("0");
        verify(revisiones, times(2)).save(Mockito.argThat(review -> review.getEstado() == EstadoRevisionManual.PENDIENTE
                && review.getReglaCalificacion() != null
                && (review.getRespuesta() == r1 || review.getRespuesta() == r2)));
    }

    @Test
    void respuestaMarcadaParaRevisionTambienCreaRevisionAunqueLaClaveNoLaPida() {
        RespuestaItem respuesta = respuestaAutomatica(31L, 11L);
        respuesta.setRequiereRevisionManual(true);
        prepararIntento(List.of(respuesta), List.of(claveAutomatica(respuesta.getItem())));

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getCantidadPendientesRevision()).isEqualTo(1);
        verify(revisiones, times(1)).save(Mockito.argThat(review -> review.getRespuesta() == respuesta));
    }

    @Test
    void recalificarNoDuplicaRevisionesExistentes() {
        RespuestaItem r1 = respuestaManual(31L, 11L);
        RespuestaItem r2 = respuestaManual(32L, 12L);
        Resultado existente = new Resultado();
        existente.setId(70L);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.of(existente));
        when(calificaciones.findByResultadoId(70L)).thenReturn(List.of(calificacionManual(r1), calificacionManual(r2)));
        when(revisiones.findByRespuestaIdIn(List.of(31L, 32L))).thenReturn(List.of(revision(r1, EstadoRevisionManual.PENDIENTE, null),
                revision(r2, EstadoRevisionManual.PENDIENTE, null)));

        assertThat(service.scoreAttempt(7L)).isSameAs(existente);

        verify(revisiones, never()).save(Mockito.any());
    }

    @Test
    void recalificarCreaSoloLasRevisionesQueFaltan() {
        RespuestaItem r1 = respuestaManual(31L, 11L);
        RespuestaItem r2 = respuestaManual(32L, 12L);
        Resultado existente = new Resultado();
        existente.setId(70L);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.of(existente));
        when(calificaciones.findByResultadoId(70L)).thenReturn(List.of(calificacionManual(r1), calificacionManual(r2)));
        when(revisiones.findByRespuestaIdIn(List.of(31L, 32L)))
                .thenReturn(List.of(revision(r1, EstadoRevisionManual.OBSERVADO, null)));

        service.scoreAttempt(7L);

        verify(revisiones, times(1)).save(Mockito.argThat(review -> review.getRespuesta() == r2));
    }

    @Test
    void unaRevisionYaResueltaSeConservaYSuPuntajeSeAplicaAlCalcular() {
        RespuestaItem r1 = respuestaManual(31L, 11L);
        RespuestaItem r2 = respuestaManual(32L, 12L);
        prepararIntento(List.of(r1, r2), List.of(claveManual(r1.getItem(), "5.00"), claveManual(r2.getItem(), "3.00")));
        when(revisiones.findByRespuestaIdIn(List.of(31L, 32L)))
                .thenReturn(List.of(revision(r1, EstadoRevisionManual.REVISADO, new BigDecimal("4.50"))));

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("4.50");
        assertThat(resultado.getCantidadCorrectas()).isEqualTo(1);
        assertThat(resultado.getCantidadPendientesRevision()).isEqualTo(1);
        assertThat(resultado.getRequiereRevisionManual()).isTrue();
        // solo se crea la de la respuesta sin revision; la resuelta no se toca
        verify(revisiones, times(1)).save(Mockito.argThat(review -> review.getRespuesta() == r2));
        verify(calificaciones).save(Mockito.argThat(c -> c.getRespuesta() == r1 && !c.getRequiereRevisionManual()
                && c.getEsCorrecta() && c.getPuntajeObtenido().compareTo(new BigDecimal("4.50")) == 0));
    }

    // ---- B23: puntaje y baremo por subtest con revision manual ----

    @Test
    void itemsConRevisionManualNoAportanPuntajeAutomaticoAlSubtestYSeAplicaElDeLaRevisionResuelta() {
        Subtest subtest = new Subtest();
        subtest.setId(5L);
        DimensionResultado dimension = new DimensionResultado();
        dimension.setId(60L);
        dimension.setSubtest(subtest);
        Baremo baremo = new Baremo();
        baremo.setId(70L);
        baremo.setDimensionResultado(dimension);
        when(dimensionesLookup.findActiveSubtestDimensionsByVersionId(100L)).thenReturn(List.of(dimension));
        when(baremos.findPreferredDimensionBaremos(Mockito.eq(100L), Mockito.anyCollection())).thenReturn(List.of(baremo));
        when(rangosBaremo.findByBaremoIdInOrderByBaremoAndRangeOrder(List.of(70L)))
                .thenReturn(List.of(rango(baremo, "0", "2", "Bajo"), rango(baremo, "2.01", "10", "Alto")));
        RespuestaItem r1 = respuestaManual(31L, 11L);
        RespuestaItem r2 = respuestaManual(32L, 12L);
        r1.getItem().setSubtest(subtest);
        r2.getItem().setSubtest(subtest);
        prepararIntento(List.of(r1, r2), List.of(claveManual(r1.getItem(), "5.00"), claveManual(r2.getItem(), "3.00")));

        // Ambas pendientes: el subtest tiene fila con 0 (no se suma nada automatico) y el rango del 0.
        service.scoreAttempt(7L);

        org.mockito.ArgumentCaptor<ResultadoDimension> pendiente = org.mockito.ArgumentCaptor
                .forClass(ResultadoDimension.class);
        verify(resultadosDimension).save(pendiente.capture());
        assertThat(pendiente.getValue().getPuntajeDirecto()).isEqualByComparingTo("0");
        assertThat(pendiente.getValue().getCategoria()).isEqualTo("Bajo");
        assertThat(pendiente.getValue().getRequiereRevisionManual()).isTrue();

        // Una ya revisada con 4.50: el subtest suma 4.50 y cae en el rango Alto.
        Mockito.clearInvocations(resultadosDimension);
        when(revisiones.findByRespuestaIdIn(List.of(31L, 32L)))
                .thenReturn(List.of(revision(r1, EstadoRevisionManual.REVISADO, new BigDecimal("4.50"))));
        service.scoreAttempt(7L);

        org.mockito.ArgumentCaptor<ResultadoDimension> parcial = org.mockito.ArgumentCaptor
                .forClass(ResultadoDimension.class);
        verify(resultadosDimension).save(parcial.capture());
        assertThat(parcial.getValue().getPuntajeDirecto()).isEqualByComparingTo("4.50");
        assertThat(parcial.getValue().getCategoria()).isEqualTo("Alto");
    }

    private static RangoBaremo rango(Baremo baremo, String min, String max, String categoria) {
        RangoBaremo rango = new RangoBaremo();
        rango.setBaremo(baremo);
        rango.setPuntajeMinimo(new BigDecimal(min));
        rango.setPuntajeMaximo(new BigDecimal(max));
        rango.setCategoria(categoria);
        rango.setPercentil(new BigDecimal("50"));
        return rango;
    }

    private void prepararIntento(List<RespuestaItem> respuestasIntento, List<ClaveRespuesta> clavesIntento) {
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intentoPublicado()));
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(respuestas.findByIntentoIdWithItem(7L)).thenReturn(respuestasIntento);
        when(claves.findOfficialKeysByVersionId(100L)).thenReturn(clavesIntento);
    }

    private static RespuestaItem respuestaManual(Long id, Long itemId) {
        RespuestaItem respuesta = respuestaAutomatica(id, itemId);
        respuesta.getItem().setTipoRespuesta(TipoRespuesta.TEXTO_ABIERTO);
        return respuesta;
    }

    private static RespuestaItem respuestaAutomatica(Long id, Long itemId) {
        RespuestaItem respuesta = new RespuestaItem();
        respuesta.setId(id);
        respuesta.setItem(item(itemId));
        respuesta.setRequiereRevisionManual(false);
        return respuesta;
    }

    private static ClaveRespuesta claveManual(Item item, String puntaje) {
        ClaveRespuesta clave = clave(item, null, new BigDecimal(puntaje));
        clave.setRequiereRevisionManual(true);
        return clave;
    }

    private static ClaveRespuesta claveAutomatica(Item item) {
        ClaveRespuesta clave = clave(item, null, new BigDecimal("1.00"));
        clave.setTextoEsperado("x");
        return clave;
    }

    private static CalificacionRespuesta calificacionManual(RespuestaItem respuesta) {
        CalificacionRespuesta calificacion = new CalificacionRespuesta();
        calificacion.setRespuesta(respuesta);
        calificacion.setReglaCalificacion(new ReglaCalificacion());
        calificacion.setRequiereRevisionManual(true);
        return calificacion;
    }

    private static RevisionManualRespuesta revision(RespuestaItem respuesta, EstadoRevisionManual estado,
            BigDecimal puntaje) {
        RevisionManualRespuesta review = new RevisionManualRespuesta();
        review.setRespuesta(respuesta);
        review.setEstado(estado);
        review.setPuntajeAsignado(puntaje);
        return review;
    }

    private static IntentoTest intentoPublicado() {
        EstrategiaCalificacion estrategia = new EstrategiaCalificacion();
        estrategia.setTipoEstrategia(TipoEstrategiaCalificacion.CLAVE_SIMPLE);
        VersionTest version = new VersionTest();
        version.setId(100L);
        version.setEstado(EstadoVersionTest.PUBLICADO);
        version.setEstrategiaCalificacion(estrategia);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setVersionTest(version);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setSesionAplicacion(sesion);
        IntentoTest intento = new IntentoTest();
        intento.setEstado(EstadoIntento.COMPLETADO);
        intento.setAsignacion(asignacion);
        return intento;
    }

    private static Item item(Long id) {
        Item item = new Item();
        item.setId(id);
        return item;
    }

    private static OpcionItem opcion(Long id, Item item) {
        OpcionItem opcion = new OpcionItem();
        opcion.setId(id);
        opcion.setItem(item);
        return opcion;
    }

    private static ClaveRespuesta clave(Item item, OpcionItem correcta, BigDecimal puntaje) {
        ReglaCalificacion regla = new ReglaCalificacion();
        regla.setEstado(EstadoConfiguracion.APROBADO);
        regla.setActiva(true);
        ClaveRespuesta clave = new ClaveRespuesta();
        clave.setItem(item);
        clave.setOpcionCorrecta(correcta);
        clave.setPuntaje(puntaje);
        clave.setRequiereRevisionManual(false);
        clave.setReglaCalificacion(regla);
        return clave;
    }
}

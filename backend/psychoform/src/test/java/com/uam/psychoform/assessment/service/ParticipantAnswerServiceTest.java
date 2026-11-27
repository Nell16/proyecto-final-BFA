package com.uam.psychoform.assessment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.IntentoSubtestRepository;
import com.uam.psychoform.assessment.repository.PausaSesionRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.OpcionSeleccionadaRespuestaRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.assessment.model.IntentoSubtest;
import com.uam.psychoform.assessment.model.SesionSubtest;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.repository.ItemLookupRepository;
import com.uam.psychoform.instrument.repository.OpcionItemLookupRepository;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;

class ParticipantAnswerServiceTest {
    private final IntentoTestRepository intentos = Mockito.mock(IntentoTestRepository.class);
    private final RespuestaItemRepository respuestas = Mockito.mock(RespuestaItemRepository.class);
    private final OpcionSeleccionadaRespuestaRepository opcionesSeleccionadas = Mockito.mock(OpcionSeleccionadaRespuestaRepository.class);
    private final ItemLookupRepository items = Mockito.mock(ItemLookupRepository.class);
    private final OpcionItemLookupRepository opciones = Mockito.mock(OpcionItemLookupRepository.class);
    private final SessionWriteGuard guard = Mockito.mock(SessionWriteGuard.class);
    private final IntentoSubtestRepository intentoSubtests = Mockito.mock(IntentoSubtestRepository.class);
    private final com.uam.psychoform.assessment.repository.RespuestaRechazadaRepository rechazos =
            Mockito.mock(com.uam.psychoform.assessment.repository.RespuestaRechazadaRepository.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);
    private final SubtestTimingService timing = new SubtestTimingService(intentoSubtests,
            Mockito.mock(PausaSesionRepository.class), clock);
    private final ParticipantAnswerService service = new ParticipantAnswerService(intentos, respuestas,
            opcionesSeleccionadas, items, opciones, guard, intentoSubtests,
            new SubtestClosingService(intentoSubtests, respuestas, items, timing), rechazos, clock);

    @Test
    void operacionesDeRespuestaDeParticipanteNoUsanPermisoInternoRespuestaRegistrar() throws Exception {
        assertThat(ParticipantAnswerService.class.getMethod("saveAnswer",
                ParticipantAccessService.ParticipantAccess.class, ParticipantAnswerService.SaveAnswerCommand.class)
                .getAnnotation(PreAuthorize.class)).isNull();
        assertThat(ParticipantAnswerService.class.getMethod("bulkSyncAnswers",
                ParticipantAccessService.ParticipantAccess.class, ParticipantAnswerService.BulkSyncAnswersCommand.class)
                .getAnnotation(PreAuthorize.class)).isNull();
    }

    @Test
    void saveAnswerEsIdempotentePorIntentoEItemYReemplazaOpciones() {
        IntentoTest intento = intento(EstadoIntento.EN_PROGRESO);
        Item item = item(10L);
        OpcionItem opcion = opcion(20L, item);
        RespuestaItem existente = new RespuestaItem();
        existente.setId(30L);
        when(intentos.findByIdForUpdate(1L)).thenReturn(Optional.of(intento));
        when(items.findById(10L)).thenReturn(Optional.of(item));
        when(opciones.findAllById(List.of(20L))).thenReturn(List.of(opcion));
        when(respuestas.findByIntentoIdAndItemId(1L, 10L)).thenReturn(Optional.of(existente));

        intento.setAsignacion(asignacion(99L));

        RespuestaItem saved = service.saveAnswer(access(99L), new ParticipantAnswerService.SaveAnswerCommand(1L, 10L,
                List.of(20L), "texto", BigDecimal.TEN, 45));

        assertThat(saved).isSameAs(existente);
        assertThat(saved.getRespuestaTextoAbierto()).isEqualTo("texto");
        assertThat(saved.getRespuestaNumerica()).isEqualByComparingTo(BigDecimal.TEN);
        verify(opcionesSeleccionadas).deleteByRespuestaId(30L);
        verify(respuestas).save(existente);
    }

    @Test
    void saveAnswerRechazaOpcionDeOtroItem() {
        IntentoTest intento = intento(EstadoIntento.EN_PROGRESO);
        Item item = item(10L);
        OpcionItem opcion = opcion(20L, item(99L));
        when(intentos.findByIdForUpdate(1L)).thenReturn(Optional.of(intento));
        when(items.findById(10L)).thenReturn(Optional.of(item));
        when(opciones.findAllById(List.of(20L))).thenReturn(List.of(opcion));

        intento.setAsignacion(asignacion(99L));

        assertThatThrownBy(() -> service.saveAnswer(access(99L), new ParticipantAnswerService.SaveAnswerCommand(1L, 10L,
                List.of(20L), null, null, null))).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("no pertenece al item");
    }

    @Test
    void saveAnswerRechazaIntentoCompletado() {
        IntentoTest intento = intento(EstadoIntento.COMPLETADO);
        intento.setAsignacion(asignacion(99L));
        when(intentos.findByIdForUpdate(1L)).thenReturn(Optional.of(intento));

        assertThatThrownBy(() -> service.saveAnswer(access(99L), new ParticipantAnswerService.SaveAnswerCommand(1L, 10L,
                List.of(), null, null, null))).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("intento no permite respuestas");
    }

    @Test
    void saveAnswerRechazaIntentoFueraDelContextoDeAsignacion() {
        IntentoTest intento = intento(EstadoIntento.EN_PROGRESO);
        intento.setAsignacion(asignacion(123L));
        when(intentos.findByIdForUpdate(1L)).thenReturn(Optional.of(intento));

        assertThatThrownBy(() -> service.saveAnswer(access(99L), new ParticipantAnswerService.SaveAnswerCommand(1L,
                10L, List.of(), null, null, null))).isInstanceOf(AccessDeniedException.class)
                .hasMessageContaining("Intento fuera de alcance");
    }

    @Test
    void saveAnswerConSesionPausadaLanzaSesionPausadaYNoEscribe() {
        IntentoTest intento = intento(EstadoIntento.EN_PROGRESO);
        intento.setAsignacion(asignacion(99L));
        when(intentos.findByIdForUpdate(1L)).thenReturn(Optional.of(intento));
        when(guard.requireWritable(10L)).thenThrow(new SesionPausadaException());
        var command = new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), null, null, null);

        assertThatThrownBy(() -> service.saveAnswer(access(99L), command)).isInstanceOf(SesionPausadaException.class);
        assertThatThrownBy(() -> service.bulkSyncAnswers(access(99L),
                new ParticipantAnswerService.BulkSyncAnswersCommand(1L, List.of(command))))
                .isInstanceOf(SesionPausadaException.class);
        Mockito.verify(respuestas, Mockito.never()).save(Mockito.any());
    }

    private IntentoSubtest subtestIniciado(long segundosAtras, Integer limite) {
        SesionSubtest ss = new SesionSubtest();
        ss.setTiempoLimiteSegundos(limite);
        IntentoSubtest is = new IntentoSubtest();
        is.setEstado(EstadoIntento.EN_PROGRESO);
        is.setSesionSubtest(ss);
        is.setIniciadoEn(LocalDateTime.now(clock).minusSeconds(segundosAtras));
        return is;
    }

    private Item itemConSubtest(long id) {
        Item item = item(id);
        Subtest subtest = new Subtest();
        subtest.setId(7L);
        item.setSubtest(subtest);
        return item;
    }

    private void preparaGuardado(Item item) {
        IntentoTest intento = intento(EstadoIntento.EN_PROGRESO);
        intento.setAsignacion(asignacion(99L));
        when(intentos.findByIdForUpdate(1L)).thenReturn(Optional.of(intento));
        when(items.findById(item.getId())).thenReturn(Optional.of(item));
        when(opciones.findAllById(List.of())).thenReturn(List.of());
        when(respuestas.findByIntentoIdAndItemId(1L, item.getId())).thenReturn(Optional.empty());
    }

    /** Subtest 7 con dos items activos (10 respondido antes, 11 omitido), vencido: 606 s efectivos con limite 600. */
    private IntentoSubtest subtestVencidoConItems(IntentoTest intento) {
        IntentoSubtest subtest = subtestIniciado(606, 600);
        Subtest st = new Subtest();
        st.setId(7L);
        subtest.setSubtest(st);
        subtest.setIntento(intento);
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.of(subtest));
        Item respondido = itemConSubtest(10L);
        Item omitido = itemConSubtest(11L);
        when(items.findBySubtestIdAndEstadoOrderByNumeroOrdenAsc(7L, com.uam.psychoform.security.model.EstadoGeneral.ACTIVO))
                .thenReturn(List.of(respondido, omitido));
        RespuestaItem previa = new RespuestaItem();
        previa.setItem(respondido);
        when(respuestas.findByIntentoId(1L)).thenReturn(List.of(previa));
        return subtest;
    }

    private IntentoTest intentoDePrueba() {
        IntentoTest intento = intento(EstadoIntento.EN_PROGRESO);
        intento.setId(1L);
        intento.setAsignacion(asignacion(99L));
        when(intentos.findByIdForUpdate(1L)).thenReturn(Optional.of(intento));
        return intento;
    }

    private List<RespuestaItem> respuestasGuardadas() {
        org.mockito.ArgumentCaptor<RespuestaItem> captor = org.mockito.ArgumentCaptor.forClass(RespuestaItem.class);
        Mockito.verify(respuestas, Mockito.atLeast(0)).save(captor.capture());
        return captor.getAllValues();
    }

    @Test
    void putConTiempoAgotadoEntregaElSubtestTalComoEstabaYRechazaLaRespuestaTardia() {
        IntentoTest intento = intentoDePrueba();
        when(items.findById(10L)).thenReturn(Optional.of(itemConSubtest(10L)));
        IntentoSubtest subtest = subtestVencidoConItems(intento);
        var tardia = new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), "tardia", null, null);

        assertThatThrownBy(() -> service.saveAnswer(access(99L), tardia))
                .isInstanceOf(TiempoAgotadoException.class)
                .extracting(e -> ((ParticipantConflictException) e).getCode()).isEqualTo("TIEMPO_AGOTADO");

        assertThat(subtest.getEstado()).isEqualTo(EstadoIntento.COMPLETADO);
        assertThat(subtest.getTiempoUsadoSegundos()).isEqualTo(600);
        assertThat(subtest.getFinalizadoEn()).isEqualTo(LocalDateTime.now(clock));
        // Solo se agrega la respuesta vacia del item omitido; la respuesta tardia no se guarda.
        List<RespuestaItem> guardadas = respuestasGuardadas();
        assertThat(guardadas).hasSize(1);
        RespuestaItem vacia = guardadas.get(0);
        assertThat(vacia.getItem().getId()).isEqualTo(11L);
        assertThat(vacia.getIntentoSubtest()).isSameAs(subtest);
        assertThat(vacia.getRespuestaTextoAbierto()).isNull();
        assertThat(vacia.getRespuestaNumerica()).isNull();
        assertThat(vacia.getEsFinal()).isTrue();
        Mockito.verify(opcionesSeleccionadas, Mockito.never()).save(Mockito.any());
    }

    @Test
    void putConTiempoAgotadoConfirmaElCierreAunqueResponda409() throws Exception {
        org.springframework.transaction.annotation.Transactional tx = ParticipantAnswerService.class
                .getMethod("saveAnswer", ParticipantAccessService.ParticipantAccess.class,
                        ParticipantAnswerService.SaveAnswerCommand.class)
                .getAnnotation(org.springframework.transaction.annotation.Transactional.class);
        assertThat(tx.noRollbackFor()).contains(TiempoAgotadoException.class);
    }

    @Test
    void bulkSyncConTiempoAgotadoNoAbortaElLoteYCierraElSubtest() {
        IntentoTest intento = intentoDePrueba();
        when(items.findById(10L)).thenReturn(Optional.of(itemConSubtest(10L)));
        IntentoSubtest subtest = subtestVencidoConItems(intento);
        var tardia = new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), "tardia", null, null);

        var resultado = service.bulkSyncAnswers(access(99L),
                new ParticipantAnswerService.BulkSyncAnswersCommand(1L, List.of(tardia)));

        assertThat(resultado).containsExactly(new ParticipantAnswerService.BulkSyncResult(10L, "RECHAZADA",
                "TIEMPO_AGOTADO", null));
        assertThat(subtest.getEstado()).isEqualTo(EstadoIntento.COMPLETADO);
        assertThat(respuestasGuardadas()).extracting(r -> r.getItem().getId()).containsExactly(11L);
        Mockito.verify(rechazos).registrar(1L, 10L, "TIEMPO_AGOTADO", java.time.LocalDateTime.now(clock));
    }

    @Test
    void bulkSyncInformaPorItemSubtestFinalizadoNoIniciadoYGuardadas() {
        intentoDePrueba();
        Item enCurso = itemConSubtest(10L);
        Item deFinalizado = item(20L);
        Subtest st8 = new Subtest();
        st8.setId(8L);
        deFinalizado.setSubtest(st8);
        Item deNoIniciado = item(30L);
        Subtest st9 = new Subtest();
        st9.setId(9L);
        deNoIniciado.setSubtest(st9);
        when(items.findById(10L)).thenReturn(Optional.of(enCurso));
        when(items.findById(20L)).thenReturn(Optional.of(deFinalizado));
        when(items.findById(30L)).thenReturn(Optional.of(deNoIniciado));
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.of(subtestIniciado(10, 600)));
        IntentoSubtest finalizado = subtestIniciado(100, 600);
        finalizado.setEstado(EstadoIntento.COMPLETADO);
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 8L)).thenReturn(Optional.of(finalizado));
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 9L)).thenReturn(Optional.empty());
        when(opciones.findAllById(List.of())).thenReturn(List.of());
        when(respuestas.findByIntentoIdAndItemId(Mockito.eq(1L), Mockito.anyLong())).thenReturn(Optional.empty());
        when(respuestas.save(Mockito.any())).thenAnswer(inv -> {
            RespuestaItem r = inv.getArgument(0);
            r.setId(500L);
            return r;
        });

        var resultado = service.bulkSyncAnswers(access(99L), new ParticipantAnswerService.BulkSyncAnswersCommand(1L,
                List.of(cmd(10L), cmd(20L), cmd(30L))));

        assertThat(resultado).containsExactly(
                new ParticipantAnswerService.BulkSyncResult(10L, "GUARDADA", null, 500L),
                new ParticipantAnswerService.BulkSyncResult(20L, "RECHAZADA", "SUBTEST_FINALIZADO", null),
                new ParticipantAnswerService.BulkSyncResult(30L, "RECHAZADA", "SUBTEST_NO_INICIADO", null));
        // B17: solo las RECHAZADA llegan a la bitacora; la GUARDADA no.
        Mockito.verify(rechazos).registrar(1L, 20L, "SUBTEST_FINALIZADO", java.time.LocalDateTime.now(clock));
        Mockito.verify(rechazos).registrar(1L, 30L, "SUBTEST_NO_INICIADO", java.time.LocalDateTime.now(clock));
        Mockito.verify(rechazos, Mockito.never()).registrar(Mockito.eq(1L), Mockito.eq(10L), Mockito.anyString(),
                Mockito.any());
    }

    private static ParticipantAnswerService.SaveAnswerCommand cmd(long itemId) {
        return new ParticipantAnswerService.SaveAnswerCommand(1L, itemId, List.of(), "x", null, null);
    }

    @Test
    void saveAnswerPermiteDentroDeLaGracia() {
        Item item = itemConSubtest(10L);
        preparaGuardado(item);
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.of(subtestIniciado(605, 600)));

        service.saveAnswer(access(99L), new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), "x", null, null));

        Mockito.verify(respuestas).save(Mockito.any());
    }

    private static IntentoTest intento(EstadoIntento estado) {
        IntentoTest intento = new IntentoTest();
        intento.setEstado(estado);
        return intento;
    }

    private static com.uam.psychoform.assessment.model.AsignacionTest asignacion(Long id) {
        com.uam.psychoform.assessment.model.AsignacionTest asignacion =
                new com.uam.psychoform.assessment.model.AsignacionTest();
        asignacion.setId(id);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(EstadoSesionAplicacion.ABIERTA);
        asignacion.setSesionAplicacion(sesion);
        return asignacion;
    }

    private static ParticipantAccessService.ParticipantAccess access(long assignmentId) {
        return new ParticipantAccessService.ParticipantAccess(assignmentId, java.util.UUID.randomUUID());
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

    @Test
    void saveAnswerRechazaRespuestasDeUnSubtestYaFinalizado() {
        Item item = itemConSubtest(10L);
        preparaGuardado(item);
        IntentoSubtest finalizado = subtestIniciado(100, 600);
        finalizado.setEstado(EstadoIntento.COMPLETADO);
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.of(finalizado));

        assertThatThrownBy(() -> service.saveAnswer(access(99L),
                new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), "x", null, null)))
                .isInstanceOf(IllegalStateException.class);
        Mockito.verify(respuestas, Mockito.never()).save(Mockito.any());
    }

    @Test
    void saveAnswerRechazaRespuestasDeUnSubtestNoIniciado() {
        Item item = itemConSubtest(10L);
        preparaGuardado(item);
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.saveAnswer(access(99L),
                new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), "x", null, null)))
                .isInstanceOf(IllegalStateException.class);
        Mockito.verify(respuestas, Mockito.never()).save(Mockito.any());
    }

    @Test
    void guardarRespuestaActualizaLaUltimaActividadDelIntento() {
        Item item = itemConSubtest(10L);
        preparaGuardado(item);
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.of(subtestIniciado(10, 600)));

        service.saveAnswer(access(99L), new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), "x", null, null));

        assertThat(intentos.findByIdForUpdate(1L).orElseThrow().getUltimaActividadEn())
                .isEqualTo(LocalDateTime.now(clock));
    }

    @Test
    void laGraciaNoAdmiteFraccionesPosterioresAlLimiteMasCincoSegundos() {
        Item item = itemConSubtest(10L);
        preparaGuardado(item);
        IntentoSubtest subtest = subtestIniciado(0, 600);
        subtest.setIniciadoEn(LocalDateTime.now(clock).minusNanos(605_100_000_000L)); // 605,1 s efectivos
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.of(subtest));

        assertThatThrownBy(() -> service.saveAnswer(access(99L),
                new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, List.of(), "x", null, null)))
                .isInstanceOf(ParticipantConflictException.class)
                .extracting(e -> ((ParticipantConflictException) e).getCode()).isEqualTo("TIEMPO_AGOTADO");
    }

    @Test
    void bulkSyncRechazaListasDeOpcionesEnormesSinConsultarlas() {
        intentoDePrueba();
        when(items.findById(10L)).thenReturn(Optional.of(itemConSubtest(10L)));
        when(intentoSubtests.findByIntentoIdAndSubtestId(1L, 7L)).thenReturn(Optional.of(subtestIniciado(10, 600)));
        List<Long> enorme = java.util.stream.LongStream.rangeClosed(1, ParticipantAnswerService.MAX_OPCIONES_POR_RESPUESTA + 1)
                .boxed().toList();

        var resultado = service.bulkSyncAnswers(access(99L), new ParticipantAnswerService.BulkSyncAnswersCommand(1L,
                List.of(new ParticipantAnswerService.SaveAnswerCommand(1L, 10L, enorme, null, null, null))));

        assertThat(resultado).singleElement().extracting(ParticipantAnswerService.BulkSyncResult::code)
                .isEqualTo(ParticipantAnswerService.OPCION_INVALIDA);
        Mockito.verify(opciones, Mockito.never()).findAllById(Mockito.any());
    }

    @Test
    void normalizarNumeroEvaluaLaMagnitudAntesDeRedondear() {
        java.util.function.Function<String, java.math.BigDecimal> n =
                v -> ParticipantAnswerService.normalizarNumero(new java.math.BigDecimal(v));
        assertThat(n.apply("1E-20000")).isEqualTo(new java.math.BigDecimal("0.0000"));
        assertThat(n.apply("1E-2147483647")).isEqualTo(new java.math.BigDecimal("0.0000"));
        assertThat(n.apply("-0.00004")).isEqualTo(new java.math.BigDecimal("0.0000"));
        assertThat(n.apply("0.00005")).isEqualTo(new java.math.BigDecimal("0.0001"));
        assertThat(n.apply("12.34565")).isEqualTo(new java.math.BigDecimal("12.3457"));
        assertThat(n.apply("1E+7")).isEqualTo(new java.math.BigDecimal("10000000.0000"));
        assertThat(n.apply("-99999999.99994")).isEqualTo(new java.math.BigDecimal("-99999999.9999"));
        assertThat(n.apply("0E+999999999")).isEqualTo(new java.math.BigDecimal("0.0000"));
        assertThat(ParticipantAnswerService.normalizarNumero(null)).isNull();
        for (String fuera : List.of("1E+8", "99999999.99995", "-1E+999999999", "1E+2147483647")) {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> n.apply(fuera))
                    .as(fuera).isInstanceOf(IllegalArgumentException.class);
        }
    }
}

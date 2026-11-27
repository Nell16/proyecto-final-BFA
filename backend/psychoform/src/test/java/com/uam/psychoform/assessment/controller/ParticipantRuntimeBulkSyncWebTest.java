package com.uam.psychoform.assessment.controller;

import static org.assertj.core.api.Assertions.assertThat;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoAsignacion;
import com.uam.psychoform.assessment.model.EstadoSesionAplicacion;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.AsignacionTestRepository;
import com.uam.psychoform.assessment.service.ParticipantAccessService;
import com.uam.psychoform.assessment.service.ParticipantAccessService.ParticipantAccess;
import com.uam.psychoform.assessment.service.ParticipantAnswerService;
import com.uam.psychoform.assessment.service.ParticipantEvaluationView;
import com.uam.psychoform.assessment.service.ParticipantJwtService;
import com.uam.psychoform.assessment.service.ParticipantRuntimeService;
import com.uam.psychoform.assessment.service.SubtestTimingService;
import com.uam.psychoform.controller.GlobalExceptionHandler;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ParticipantRuntimeBulkSyncWebTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    @Test
    void unaEntradaNullDelLoteSeConservaEnSuPosicionSinAbortarLaPeticion() throws Exception {
        UUID participantId = UUID.randomUUID();
        Participante participante = new Participante();
        participante.setId(participantId);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(EstadoSesionAplicacion.ABIERTA);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setParticipante(participante);
        asignacion.setSesionAplicacion(sesion);
        asignacion.setEstado(EstadoAsignacion.EN_PROGRESO);
        asignacion.setTokenExpiraEn(LocalDateTime.now(CLOCK).plusHours(1));
        AsignacionTestRepository asignaciones = mock(AsignacionTestRepository.class);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));
        ParticipantJwtService jwt = mock(ParticipantJwtService.class);
        when(jwt.requireAccess(any())).thenReturn(new ParticipantAccess(77L, participantId));
        ParticipantAnswerService answers = mock(ParticipantAnswerService.class);
        when(answers.bulkSyncAnswers(any(), any())).thenReturn(List.of());
        var controller = new ParticipantRuntimeController(jwt, mock(ParticipantRuntimeService.class),
                new ParticipantAccessService(asignaciones, null, null, null, CLOCK), answers,
                mock(ParticipantEvaluationView.class), mock(SubtestTimingService.class));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new GlobalExceptionHandler()).build();

        mvc.perform(post("/intentos/5/respuestas/bulk-sync").contentType("application/json")
                .content("[{\"itemId\":9,\"textAnswer\":\"x\"}, null]"))
                .andExpect(status().isOk());

        org.mockito.ArgumentCaptor<ParticipantAnswerService.BulkSyncAnswersCommand> captor =
                org.mockito.ArgumentCaptor.forClass(ParticipantAnswerService.BulkSyncAnswersCommand.class);
        org.mockito.Mockito.verify(answers).bulkSyncAnswers(any(), captor.capture());
        assertThat(captor.getValue().answers()).hasSize(2);
        assertThat(captor.getValue().answers().get(0).itemId()).isEqualTo(9L);
        assertThat(captor.getValue().answers().get(1).itemId()).isNull();
    }

    private static List<ParticipantAnswerService.SaveAnswerCommand> leer(byte[] cuerpo, long max) {
        return BulkSyncLoteReader.leer(5L, new java.io.ByteArrayInputStream(cuerpo), max);
    }

    private static List<ParticipantAnswerService.SaveAnswerCommand> leer(String cuerpo) {
        return leer(cuerpo.getBytes(java.nio.charset.StandardCharsets.UTF_8), BulkSyncLoteReader.MAX_BYTES_POR_DEFECTO);
    }

    @Test
    void unElementoMalTipadoSeMarcaInvalidoSinRechazarElLoteYLosDecimalesSonExactos() {
        var lote = leer("[\"abc\", {\"itemId\":3,\"numericAnswer\":\"x\"}, "
                + "{\"itemId\":4,\"selectedOptionIds\":\"zz\"}, [1], null, {\"itemId\":\"no\"}, "
                + "{\"itemId\":6,\"numericAnswer\":1e-20000,\"extra\":{\"itemId\":99}}, "
                + "{\"itemId\":7,\"numericAnswer\":12.34565,\"selectedOptionIds\":[1,null]}, "
                + "{\"numericAnswer\":1E+2147483648,\"itemId\":8}, "
                + "{\"itemId\":99999999999999999999999}]");

        assertThat(lote).extracting(ParticipantAnswerService.SaveAnswerCommand::itemId,
                ParticipantAnswerService.SaveAnswerCommand::entradaInvalida)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(null, true),
                        org.assertj.core.groups.Tuple.tuple(3L, true),
                        org.assertj.core.groups.Tuple.tuple(4L, true),
                        org.assertj.core.groups.Tuple.tuple(null, true),
                        org.assertj.core.groups.Tuple.tuple(null, false),
                        org.assertj.core.groups.Tuple.tuple(null, true),
                        org.assertj.core.groups.Tuple.tuple(6L, false),
                        org.assertj.core.groups.Tuple.tuple(7L, false),
                        // Exponente fuera de rango: solo invalida su posicion, con el itemId que viene despues.
                        org.assertj.core.groups.Tuple.tuple(8L, true),
                        org.assertj.core.groups.Tuple.tuple(null, true));
        assertThat(lote.get(6).numericAnswer()).isEqualTo(new java.math.BigDecimal("1E-20000"));
        assertThat(lote.get(7).numericAnswer()).isEqualTo(new java.math.BigDecimal("12.34565"));
        assertThat(lote.get(7).selectedOptionIds()).containsExactly(1L, null);
        assertThat(lote).allSatisfy(c -> assertThat(c.intentoId()).isEqualTo(5L));
    }

    @Test
    void cuerposMalFormadosOInvalidosSon400() {
        for (String cuerpo : List.of("{}", "[{", "", "[1] [2]", "[{\"itemId\":1},]")) {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> leer(cuerpo)).as(cuerpo)
                    .isInstanceOf(IllegalArgumentException.class);
        }
        // UTF-8 invalido dentro de un texto: se rechaza, no se reemplaza por U+FFFD.
        byte[] utf8Invalido = { '[', '{', '"', 't', 'e', 'x', 't', 'A', 'n', 's', 'w', 'e', 'r', '"', ':', '"',
                (byte) 0xC3, (byte) 0x28, '"', '}', ']' };
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> leer(utf8Invalido, 1000))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void aceptaBomYTextoUtf8() {
        byte[] json = "[{\"itemId\":1,\"textAnswer\":\"ñandú\"}]".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] conBom = new byte[json.length + 3];
        conBom[0] = (byte) 0xEF;
        conBom[1] = (byte) 0xBB;
        conBom[2] = (byte) 0xBF;
        System.arraycopy(json, 0, conBom, 3, json.length);
        assertThat(leer(conBom, 1000)).singleElement()
                .satisfies(c -> assertThat(c.textAnswer()).isEqualTo("ñandú"));
    }

    @Test
    void unLoteQueExcedeElLimiteSeCortaAunqueNoTengaContentLength() {
        String grande = "[" + "{\"itemId\":1,\"textAnswer\":\"xxxxxxxxxx\"},".repeat(200) + "null]";
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> leer(grande.getBytes(), 1024))
                .isInstanceOf(com.uam.psychoform.assessment.service.LoteDemasiadoGrandeException.class);
        assertThat(leer(grande.getBytes(), grande.length())).hasSize(201);
    }

    @Test
    void elEndpointAceptaJsonConSufijoYResponde413AlExcederElLimite() throws Exception {
        MockMvc mvc = mvcConLote();
        mvc.perform(post("/intentos/5/respuestas/bulk-sync").contentType("application/vnd.bfa+json")
                .content("[{\"itemId\":9}]")).andExpect(status().isOk());
        mvc.perform(post("/intentos/5/respuestas/bulk-sync").contentType("text/plain")
                .content("[{\"itemId\":9}]")).andExpect(status().isUnsupportedMediaType());
        byte[] enorme = ("[" + "null,".repeat(600_000) + "null]").getBytes();
        mvc.perform(post("/intentos/5/respuestas/bulk-sync").contentType("application/json").content(enorme))
                .andExpect(status().isContentTooLarge())
                .andExpect(jsonPath("$.error.code").value("PAYLOAD_TOO_LARGE"));
    }

    @Test
    void utf8SobrelargoEs400SinInvocarAlServicio() throws Exception {
        ParticipantAnswerService answers = mock(ParticipantAnswerService.class);
        MockMvc mvc = mvcConLote(answers, mock(ParticipantJwtService.class));
        // 0xC0 0xAF es '/' codificado de forma sobrelarga: debe rechazarse, no convertirse en '/'.
        byte[] cuerpo = { '[', '{', '"', 't', 'e', 'x', 't', 'A', 'n', 's', 'w', 'e', 'r', '"', ':', '"',
                (byte) 0xC0, (byte) 0xAF, '"', '}', ']' };
        mvc.perform(post("/intentos/5/respuestas/bulk-sync").contentType("application/json").content(cuerpo))
                .andExpect(status().isBadRequest());
        org.mockito.Mockito.verifyNoInteractions(answers);
    }

    @Test
    void respetaElCharsetDeclaradoConDecodificacionEstricta() {
        byte[] latin1 = "[{\"itemId\":1,\"textAnswer\":\"ñ\"}]".getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
        assertThat(BulkSyncLoteReader.leer(5L, new java.io.ByteArrayInputStream(latin1),
                java.nio.charset.StandardCharsets.ISO_8859_1, 1000, 10)).singleElement()
                .satisfies(c -> assertThat(c.textAnswer()).isEqualTo("ñ"));
        // Los mismos bytes declarados como UTF-8 son invalidos.
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> leer(latin1, 1000))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void limitaLaCantidadDeElementosAntesDeLlamarAlServicio() throws Exception {
        String lote = "[" + "null,".repeat(1000) + "null]";
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> leer(lote))
                .isInstanceOf(com.uam.psychoform.assessment.service.LoteDemasiadoGrandeException.class);
        assertThat(leer("[" + "null,".repeat(999) + "null]")).hasSize(1000);
        ParticipantAnswerService answers = mock(ParticipantAnswerService.class);
        mvcConLote(answers, mock(ParticipantJwtService.class))
                .perform(post("/intentos/5/respuestas/bulk-sync").contentType("application/json").content(lote))
                .andExpect(status().isContentTooLarge());
        org.mockito.Mockito.verifyNoInteractions(answers);
    }

    @Test
    void decimalesEnCamposEnterosInvalidanElElementoSinPerderPrecision() {
        assertThat(leer("[{\"itemId\":9007199254740993.0}, {\"itemId\":2,\"timeUsedSeconds\":1.5}, "
                + "{\"itemId\":3,\"selectedOptionIds\":[4.0]}]"))
                .extracting(ParticipantAnswerService.SaveAnswerCommand::itemId,
                        ParticipantAnswerService.SaveAnswerCommand::entradaInvalida)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(null, true),
                        org.assertj.core.groups.Tuple.tuple(2L, true),
                        org.assertj.core.groups.Tuple.tuple(3L, true));
    }

    @Test
    void elAccesoSeRevalidaDespuesDeLeerElLote() throws Exception {
        ParticipantAnswerService answers = mock(ParticipantAnswerService.class);
        ParticipantJwtService jwt = mock(ParticipantJwtService.class);
        when(jwt.requireAccess(any())).thenReturn(new ParticipantAccess(77L, PARTICIPANTE))
                .thenThrow(new com.uam.psychoform.assessment.service.ParticipantConflictException(
                        com.uam.psychoform.assessment.service.ParticipantConflictException.TOKEN_EXPIRADO, "expiro"));
        mvcConLote(answers, jwt).perform(post("/intentos/5/respuestas/bulk-sync").contentType("application/json")
                .content("[{\"itemId\":9}]"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("TOKEN_EXPIRADO"));
        org.mockito.Mockito.verifyNoInteractions(answers);
    }

    private static final UUID PARTICIPANTE = UUID.randomUUID();

    private MockMvc mvcConLote() {
        ParticipantAnswerService answers = mock(ParticipantAnswerService.class);
        when(answers.bulkSyncAnswers(any(), any())).thenReturn(List.of());
        ParticipantJwtService jwt = mock(ParticipantJwtService.class);
        when(jwt.requireAccess(any())).thenReturn(new ParticipantAccess(77L, PARTICIPANTE));
        return mvcConLote(answers, jwt);
    }

    private MockMvc mvcConLote(ParticipantAnswerService answers, ParticipantJwtService jwt) {
        if (org.mockito.Mockito.mockingDetails(jwt).getStubbings().isEmpty()) {
            when(jwt.requireAccess(any())).thenReturn(new ParticipantAccess(77L, PARTICIPANTE));
        }
        Participante participante = new Participante();
        participante.setId(PARTICIPANTE);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        sesion.setEstado(EstadoSesionAplicacion.ABIERTA);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setId(77L);
        asignacion.setParticipante(participante);
        asignacion.setSesionAplicacion(sesion);
        asignacion.setEstado(EstadoAsignacion.EN_PROGRESO);
        asignacion.setTokenExpiraEn(LocalDateTime.now(CLOCK).plusHours(1));
        AsignacionTestRepository asignaciones = mock(AsignacionTestRepository.class);
        when(asignaciones.findByIdForUpdate(77L)).thenReturn(Optional.of(asignacion));
        var controller = new ParticipantRuntimeController(jwt, mock(ParticipantRuntimeService.class),
                new ParticipantAccessService(asignaciones, null, null, null, CLOCK), answers,
                mock(ParticipantEvaluationView.class), mock(SubtestTimingService.class));
        return MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(new GlobalExceptionHandler()).build();
    }
}

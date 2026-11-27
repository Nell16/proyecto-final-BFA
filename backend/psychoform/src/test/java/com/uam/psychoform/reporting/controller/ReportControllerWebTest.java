package com.uam.psychoform.reporting.controller;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.reporting.model.FormatoReporte;
import com.uam.psychoform.reporting.model.ReporteGenerado;
import com.uam.psychoform.reporting.repository.ReporteGeneradoRepository;
import com.uam.psychoform.security.service.JwtService;
import com.uam.psychoform.storage.ObjectStorageService;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class ReportControllerWebTest {
    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @MockitoBean
    ReporteGeneradoRepository reports;

    @MockitoBean
    ObjectStorageService storage;

    @Test
    void descargaPdfValidaDevuelveBinarioYHeadersRfc5987() throws Exception {
        byte[] pdfBytes = "%PDF-1.4\ncontenido".getBytes(StandardCharsets.UTF_8);
        ReporteGenerado report = report(10L, FormatoReporte.PDF, "reports/2026/evaluación final.pdf");
        when(reports.findById(10L)).thenReturn(Optional.of(report));
        when(storage.getObject("reports/2026/evaluación final.pdf")).thenReturn(pdfBytes);

        mvc.perform(get("/reports/{id}/file", 10L)
                .header("Authorization", bearer("REPORTE_EXPORTAR")))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/pdf"))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"evaluación final.pdf\"; filename*=UTF-8''evaluaci%C3%B3n%20final.pdf"))
                .andExpect(content().bytes(pdfBytes));
    }

    @Test
    void descargaCsvYXlsxDevuelvenContentTypeCorrecto() throws Exception {
        byte[] csvBytes = "col1,col2\n1,2\n".getBytes(StandardCharsets.UTF_8);
        ReporteGenerado csvReport = report(11L, FormatoReporte.CSV, "reports/sesion-1.csv");
        when(reports.findById(11L)).thenReturn(Optional.of(csvReport));
        when(storage.getObject("reports/sesion-1.csv")).thenReturn(csvBytes);

        mvc.perform(get("/reports/{id}/file", 11L)
                .header("Authorization", bearer("REPORTE_EXPORTAR")))
                .andExpect(status().isOk())
                .andExpect(content().contentType("text/csv;charset=UTF-8"))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        containsString("attachment; filename=\"sesion-1.csv\"")))
                .andExpect(content().bytes(csvBytes));

        byte[] xlsxBytes = new byte[] { 0x50, 0x4B, 0x03, 0x04 };
        ReporteGenerado xlsxReport = report(12L, FormatoReporte.XLSX, "reports/sesion-1.xlsx");
        when(reports.findById(12L)).thenReturn(Optional.of(xlsxReport));
        when(storage.getObject("reports/sesion-1.xlsx")).thenReturn(xlsxBytes);

        mvc.perform(get("/reports/{id}/file", 12L)
                .header("Authorization", bearer("REPORTE_EXPORTAR")))
                .andExpect(status().isOk())
                .andExpect(content().contentType(
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        containsString("attachment; filename=\"sesion-1.xlsx\"")))
                .andExpect(content().bytes(xlsxBytes));
    }

    @Test
    void registroInexistenteResponde404() throws Exception {
        when(reports.findById(404L)).thenReturn(Optional.empty());

        mvc.perform(get("/reports/{id}/file", 404L)
                .header("Authorization", bearer("REPORTE_EXPORTAR")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").value("Reporte no encontrado: 404"));

        verify(storage, never()).getObject(anyString());
    }

    @Test
    void objetoInexistenteEnStorageResponde404SinFiltrarMotivo() throws Exception {
        ReporteGenerado report = report(13L, FormatoReporte.PDF, "reports/no-existe.pdf");
        when(reports.findById(13L)).thenReturn(Optional.of(report));
        when(storage.getObject("reports/no-existe.pdf"))
                .thenThrow(NoSuchKeyException.builder().message("NoSuchKey internal detail").build());

        mvc.perform(get("/reports/{id}/file", 13L)
                .header("Authorization", bearer("REPORTE_EXPORTAR")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.error.message").value("Reporte no encontrado: 13"));
    }

    @Test
    void keyConTraversalOFueraDelPrefijoResponde404SinConsultarStorage() throws Exception {
        when(reports.findById(14L)).thenReturn(Optional.of(report(14L, FormatoReporte.PDF, "reports/../secret.pdf")));
        when(reports.findById(15L)).thenReturn(Optional.of(report(15L, FormatoReporte.PDF, "otro/archivo.pdf")));
        when(reports.findById(16L)).thenReturn(Optional.of(report(16L, FormatoReporte.PDF, "/reports/archivo.pdf")));

        for (long id : new long[] { 14L, 15L, 16L }) {
            mvc.perform(get("/reports/{id}/file", id)
                    .header("Authorization", bearer("REPORTE_EXPORTAR")))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.success").value(false))
                    .andExpect(jsonPath("$.error.code").value("NOT_FOUND"))
                    .andExpect(jsonPath("$.error.message").value("Reporte no encontrado: " + id));
        }

        verify(storage, never()).getObject(anyString());
    }

    @Test
    void errorInternoDeStorageResponde503SinDetalles() throws Exception {
        ReporteGenerado report = report(17L, FormatoReporte.PDF, "reports/ok.pdf");
        when(reports.findById(17L)).thenReturn(Optional.of(report));
        when(storage.getObject("reports/ok.pdf")).thenThrow(new IllegalStateException("Secret S3 endpoint unreachable"));

        mvc.perform(get("/reports/{id}/file", 17L)
                .header("Authorization", bearer("REPORTE_EXPORTAR")))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("SERVICE_UNAVAILABLE"))
                .andExpect(jsonPath("$.error.message").value("El almacenamiento no esta disponible"));
    }

    @Test
    void sinPermisoExportarResponde403() throws Exception {
        mvc.perform(get("/reports/{id}/file", 10L)
                .header("Authorization", bearer("RESULTADO_VER")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));

        verify(reports, never()).findById(10L);
        verify(storage, never()).getObject(anyString());
    }

    private String bearer(String permission) {
        return "Bearer " + jwt.emitir(UUID.fromString("22222222-2222-2222-2222-222222222222"), "consultor",
                Set.of(permission), Set.of("CONSULTOR"));
    }

    private static ReporteGenerado report(long id, FormatoReporte format, String path) {
        ReporteGenerado report = new ReporteGenerado();
        report.setId(id);
        report.setFormato(format);
        report.setRutaAlmacenamiento(path);
        return report;
    }
}

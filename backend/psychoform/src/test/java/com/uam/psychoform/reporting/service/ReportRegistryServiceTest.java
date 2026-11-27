package com.uam.psychoform.reporting.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.SesionAplicacionRepository;
import com.uam.psychoform.reporting.model.FormatoReporte;
import com.uam.psychoform.reporting.model.ReporteGenerado;
import com.uam.psychoform.reporting.repository.ReporteGeneradoRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StorageUnavailableException;
import jakarta.persistence.EntityNotFoundException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import software.amazon.awssdk.awscore.exception.AwsErrorDetails;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

class ReportRegistryServiceTest {
    private final ReporteGeneradoRepository repository = Mockito.mock(ReporteGeneradoRepository.class);
    private final IntentoTestRepository intentos = Mockito.mock(IntentoTestRepository.class);
    private final ResultadoRepository resultados = Mockito.mock(ResultadoRepository.class);
    private final SesionAplicacionRepository sesiones = Mockito.mock(SesionAplicacionRepository.class);
    private final UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final ObjectStorageService storage = Mockito.mock(ObjectStorageService.class);
    private final ReportRegistryService service = new ReportRegistryService(repository, intentos, resultados, sesiones,
            usuarios, currentActor, storage,
            Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC));

    @Test
    void registerAggregateReportRequierePermisoExportar() throws Exception {
        Method method = ReportRegistryService.class.getMethod("registerAggregateReport",
                ReportRegistryService.RegisterReportCommand.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_REPORTE_EXPORTAR')");
    }

    @Test
    void downloadReportRequierePermisoExportar() throws Exception {
        Method method = ReportRegistryService.class.getMethod("downloadReport", long.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_REPORTE_EXPORTAR')");
    }

    @Test
    void registerAggregateReportGuardaMetadataYActorActual() {
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setId(10L);
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(sesiones.findById(10L)).thenReturn(Optional.of(sesion));

        ReporteGenerado report = service.registerAggregateReport(new ReportRegistryService.RegisterReportCommand(
                "AGREGADO_SESION", FormatoReporte.CSV, "reports/report.csv", "{\"sesion\":10}", null, null, 10L));

        assertThat(report.getGeneradoPor()).isSameAs(actor);
        assertThat(report.getSesionAplicacion()).isSameAs(sesion);
        assertThat(report.getTipoReporte()).isEqualTo("AGREGADO_SESION");
        assertThat(report.getFormato()).isEqualTo(FormatoReporte.CSV);
        verify(repository).save(report);
    }

    @Test
    void downloadReportNormalizaKeyYResuelveMediaTypeYNombre() {
        ReporteGenerado report = report(7L, FormatoReporte.CSV, "reports/./sub//datos.csv");
        byte[] content = "a,b\n1,2\n".getBytes(StandardCharsets.UTF_8);
        when(repository.findById(7L)).thenReturn(Optional.of(report));
        when(storage.getObject("reports/sub/datos.csv")).thenReturn(content);

        ReportRegistryService.ReportFile result = service.downloadReport(7L);

        assertThat(result.fileName()).isEqualTo("datos.csv");
        assertThat(result.contentType()).isEqualTo(new MediaType("text", "csv", StandardCharsets.UTF_8));
        assertThat(result.bytes()).isEqualTo(content);
    }

    @Test
    void downloadReportUsaFallbackCuandoUltimoSegmentoQuedaVacio() {
        ReporteGenerado report = report(9L, FormatoReporte.XLSX, "reports/   ");
        byte[] content = new byte[] { 1, 2, 3 };
        when(repository.findById(9L)).thenReturn(Optional.of(report));
        when(storage.getObject("reports/   ")).thenReturn(content);

        ReportRegistryService.ReportFile result = service.downloadReport(9L);

        assertThat(result.fileName()).isEqualTo("reporte-9.xlsx");
        assertThat(result.contentType().toString())
                .isEqualTo("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    @Test
    void downloadReportUsaOctetStreamSiFormatoEsNulo() {
        ReporteGenerado report = report(11L, null, "reports/archivo.bin");
        byte[] content = new byte[] { 9, 8 };
        when(repository.findById(11L)).thenReturn(Optional.of(report));
        when(storage.getObject("reports/archivo.bin")).thenReturn(content);

        ReportRegistryService.ReportFile result = service.downloadReport(11L);

        assertThat(result.contentType()).isEqualTo(MediaType.APPLICATION_OCTET_STREAM);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "",
            "   ",
            "/reports/individual.pdf",
            "other/individual.pdf",
            "reportes/individual.pdf",
            "reports/../secret.pdf",
            "../reports/individual.pdf",
            "reports\\individual.pdf",
            "reports/individual\n.pdf",
            "reports/individual\0.pdf",
            "reports/",
            "reports/."
    })
    void downloadReportRechazaRutasInvalidasSinConsultarStorage(String badPath) {
        ReporteGenerado report = report(15L, FormatoReporte.PDF, badPath);
        when(repository.findById(15L)).thenReturn(Optional.of(report));

        assertThatThrownBy(() -> service.downloadReport(15L))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("Reporte no encontrado: 15");

        verifyNoInteractions(storage);
    }

    @Test
    void downloadReportConvierteNoSuchKeyY404S3EnEntityNotFoundSinDetalles() {
        ReporteGenerado report = report(20L, FormatoReporte.PDF, "reports/missing.pdf");
        when(repository.findById(20L)).thenReturn(Optional.of(report));
        Mockito.doThrow(NoSuchKeyException.builder().message("The specified key does not exist").build())
                .when(storage).getObject("reports/missing.pdf");

        assertThatThrownBy(() -> service.downloadReport(20L))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("Reporte no encontrado: 20");

        Mockito.doThrow(S3Exception.builder().statusCode(404).message("Not Found")
                .awsErrorDetails(AwsErrorDetails.builder().errorCode("NoSuchKey").build()).build())
                .when(storage).getObject("reports/missing.pdf");

        assertThatThrownBy(() -> service.downloadReport(20L))
                .isInstanceOf(EntityNotFoundException.class)
                .hasMessage("Reporte no encontrado: 20");
    }

    @Test
    void downloadReportConNoSuchBucketOOtro404SinCodigoNoSuchKeyEsStorageUnavailable() {
        ReporteGenerado report = report(22L, FormatoReporte.PDF, "reports/ok.pdf");
        when(repository.findById(22L)).thenReturn(Optional.of(report));
        Mockito.doThrow(NoSuchBucketException.builder().message("The specified bucket does not exist").build())
                .when(storage).getObject("reports/ok.pdf");

        assertThatThrownBy(() -> service.downloadReport(22L)).isInstanceOf(StorageUnavailableException.class);

        Mockito.doThrow(S3Exception.builder().statusCode(404).message("Not Found")
                .awsErrorDetails(AwsErrorDetails.builder().errorCode("NoSuchBucket").build()).build())
                .when(storage).getObject("reports/ok.pdf");

        assertThatThrownBy(() -> service.downloadReport(22L)).isInstanceOf(StorageUnavailableException.class);

        Mockito.doThrow(S3Exception.builder().statusCode(404).message("Not Found").build())
                .when(storage).getObject("reports/ok.pdf");

        assertThatThrownBy(() -> service.downloadReport(22L)).isInstanceOf(StorageUnavailableException.class);
    }

    @Test
    void downloadReportConvierteFalloDeStorageEnStorageUnavailableException() {
        ReporteGenerado report = report(21L, FormatoReporte.PDF, "reports/ok.pdf");
        when(repository.findById(21L)).thenReturn(Optional.of(report));
        when(storage.getObject("reports/ok.pdf")).thenThrow(new IllegalStateException("Storage S3 no configurado"));

        assertThatThrownBy(() -> service.downloadReport(21L))
                .isInstanceOf(StorageUnavailableException.class);
    }

    private static ReporteGenerado report(long id, FormatoReporte format, String storagePath) {
        ReporteGenerado report = new ReporteGenerado();
        report.setId(id);
        report.setFormato(format);
        report.setRutaAlmacenamiento(storagePath);
        return report;
    }
}

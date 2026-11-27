package com.uam.psychoform.reporting.service;

import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.assessment.repository.SesionAplicacionRepository;
import com.uam.psychoform.reporting.model.FormatoReporte;
import com.uam.psychoform.reporting.model.ReporteGenerado;
import com.uam.psychoform.reporting.repository.ReporteGeneradoRepository;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import com.uam.psychoform.storage.ObjectStorageService;
import com.uam.psychoform.storage.StorageUnavailableException;
import jakarta.persistence.EntityNotFoundException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;

@Service
@Transactional(readOnly = true)
public class ReportRegistryService {
    public static final String REPORTS_PREFIX = "reports/";
    private static final MediaType CSV_MEDIA_TYPE = new MediaType("text", "csv", StandardCharsets.UTF_8);
    private static final MediaType XLSX_MEDIA_TYPE = MediaType
            .parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    private final ReporteGeneradoRepository repository;
    private final IntentoTestRepository intentos;
    private final ResultadoRepository resultados;
    private final SesionAplicacionRepository sesiones;
    private final UsuarioRepository usuarios;
    private final CurrentActor currentActor;
    private final ObjectStorageService storage;
    private final Clock clock;

    public ReportRegistryService(ReporteGeneradoRepository repository, IntentoTestRepository intentos,
            ResultadoRepository resultados, SesionAplicacionRepository sesiones, UsuarioRepository usuarios,
            CurrentActor currentActor, ObjectStorageService storage, Clock clock) {
        this.repository = repository;
        this.intentos = intentos;
        this.resultados = resultados;
        this.sesiones = sesiones;
        this.usuarios = usuarios;
        this.currentActor = currentActor;
        this.storage = storage;
        this.clock = clock;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.REPORTE_EXPORTAR)
    public ReporteGenerado registerIndividualReport(RegisterReportCommand command) {
        if (command.intentoId() == null && command.resultadoId() == null) {
            throw new IllegalArgumentException("El reporte individual requiere intento o resultado");
        }
        ReporteGenerado report = baseReport(command);
        if (command.intentoId() != null) {
            IntentoTest intento = intentos.findById(command.intentoId())
                    .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + command.intentoId()));
            report.setIntento(intento);
        }
        if (command.resultadoId() != null) {
            Resultado resultado = resultados.findById(command.resultadoId())
                    .orElseThrow(() -> new EntityNotFoundException("Resultado no encontrado: " + command.resultadoId()));
            report.setResultado(resultado);
        }
        repository.save(report);
        return report;
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.REPORTE_EXPORTAR)
    public ReporteGenerado registerAggregateReport(RegisterReportCommand command) {
        if (command.sesionAplicacionId() == null) {
            throw new IllegalArgumentException("El reporte agregado requiere sesion");
        }
        ReporteGenerado report = baseReport(command);
        SesionAplicacion sesion = sesiones.findById(command.sesionAplicacionId())
                .orElseThrow(() -> new EntityNotFoundException("Sesion no encontrada: " + command.sesionAplicacionId()));
        report.setSesionAplicacion(sesion);
        repository.save(report);
        return report;
    }

    @PreAuthorize(SecurityPermissions.REPORTE_LEER)
    public List<ReporteGenerado> listReports(ReportFilter filter) {
        if (filter.sesionAplicacionId() != null) {
            return repository.findBySesionAplicacionId(filter.sesionAplicacionId());
        }
        if (filter.resultadoId() != null) {
            return repository.findByResultadoId(filter.resultadoId());
        }
        if (filter.intentoId() != null) {
            return repository.findByIntentoId(filter.intentoId());
        }
        return repository.findAll();
    }

    @PreAuthorize(SecurityPermissions.REPORTE_EXPORTAR)
    public ReportFile downloadReport(long id) {
        ReporteGenerado report = repository.findById(id).orElseThrow(() -> reportNotFound(id));
        String key = normalizeAndValidateKey(report.getRutaAlmacenamiento(), id);
        byte[] bytes = fetchFromStorage(key, id);
        FormatoReporte format = report.getFormato();
        return new ReportFile(extractFileName(key, id, format), mediaTypeFor(format), bytes);
    }

    private byte[] fetchFromStorage(String key, long id) {
        try {
            byte[] bytes = storage.getObject(key);
            if (bytes == null) {
                throw reportNotFound(id);
            }
            return bytes;
        } catch (NoSuchKeyException | EntityNotFoundException ex) {
            throw reportNotFound(id);
        } catch (S3Exception ex) {
            // Solo un objeto ausente es 404. Otros 404 de S3 (p. ej. NoSuchBucket) son un fallo de configuracion o
            // de infraestructura del almacenamiento y responden 503.
            if (ex.statusCode() == 404 && ex.awsErrorDetails() != null
                    && "NoSuchKey".equals(ex.awsErrorDetails().errorCode())) {
                throw reportNotFound(id);
            }
            throw new StorageUnavailableException("Almacenamiento no disponible", ex);
        } catch (RuntimeException ex) {
            throw new StorageUnavailableException("Almacenamiento no disponible", ex);
        }
    }

    private static String normalizeAndValidateKey(String rawPath, long id) {
        if (rawPath == null || rawPath.isBlank()) {
            throw reportNotFound(id);
        }
        for (int i = 0; i < rawPath.length(); i++) {
            if (Character.isISOControl(rawPath.charAt(i))) {
                throw reportNotFound(id);
            }
        }
        if (rawPath.startsWith("/") || rawPath.contains("\\") || rawPath.contains("..")
                || !rawPath.startsWith(REPORTS_PREFIX) || rawPath.endsWith("/")) {
            throw reportNotFound(id);
        }
        String[] rawSegments = rawPath.split("/", -1);
        List<String> segments = new ArrayList<>(rawSegments.length);
        for (String segment : rawSegments) {
            if (segment.isEmpty() || ".".equals(segment)) {
                continue;
            }
            if ("..".equals(segment)) {
                throw reportNotFound(id);
            }
            segments.add(segment);
        }
        String normalized = String.join("/", segments);
        if (!normalized.startsWith(REPORTS_PREFIX)) {
            throw reportNotFound(id);
        }
        return normalized;
    }

    private static EntityNotFoundException reportNotFound(long id) {
        return new EntityNotFoundException("Reporte no encontrado: " + id);
    }

    private static MediaType mediaTypeFor(FormatoReporte format) {
        if (format == null) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
        return switch (format) {
            case PDF -> MediaType.APPLICATION_PDF;
            case CSV -> CSV_MEDIA_TYPE;
            case XLSX -> XLSX_MEDIA_TYPE;
        };
    }

    private static String extractFileName(String key, long id, FormatoReporte format) {
        int lastSlash = key.lastIndexOf('/');
        String lastSegment = lastSlash >= 0 ? key.substring(lastSlash + 1) : key;
        if (!lastSegment.isBlank()) {
            return lastSegment;
        }
        String ext = switch (format) {
            case PDF -> "pdf";
            case CSV -> "csv";
            case XLSX -> "xlsx";
            case null -> "bin";
        };
        return "reporte-" + id + "." + ext;
    }

    private ReporteGenerado baseReport(RegisterReportCommand command) {
        ReporteGenerado report = new ReporteGenerado();
        report.setTipoReporte(command.tipoReporte());
        report.setFormato(command.formato());
        report.setRutaAlmacenamiento(command.rutaAlmacenamiento());
        report.setResumenFiltros(command.resumenFiltrosJson());
        report.setGeneradoPor(currentUser());
        report.setGeneradoEn(LocalDateTime.now(clock));
        return report;
    }

    private Usuario currentUser() {
        UUID actorId = currentActor.usuarioId();
        return usuarios.findById(actorId)
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + actorId));
    }

    public record RegisterReportCommand(String tipoReporte, FormatoReporte formato, String rutaAlmacenamiento,
            String resumenFiltrosJson, Long intentoId, Long resultadoId, Long sesionAplicacionId) {
        public RegisterReportCommand(String tipoReporte, FormatoReporte formato, String rutaAlmacenamiento,
                String resumenFiltrosJson) {
            this(tipoReporte, formato, rutaAlmacenamiento, resumenFiltrosJson, null, null, null);
        }
    }

    public record ReportFilter(Long intentoId, Long resultadoId, Long sesionAplicacionId) {
    }

    public record ReportFile(String fileName, MediaType contentType, byte[] bytes) {
    }
}

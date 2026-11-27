package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.EstadoConfiguracion;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ClaveRespuestaLookupRepository extends JpaRepository<ClaveRespuesta, Long> {
    default List<ClaveRespuesta> findOfficialKeysByVersionId(Long versionTestId) {
        return findOfficialKeysByVersionIdAndEstados(versionTestId,
                List.of(EstadoConfiguracion.APROBADO, EstadoConfiguracion.PUBLICADO));
    }

    @Query("""
            select c from ClaveRespuesta c
            join c.reglaCalificacion r
            where r.versionTest.id = :versionTestId
              and r.activa = true
              and r.estado in :estados
            """)
    List<ClaveRespuesta> findOfficialKeysByVersionIdAndEstados(Long versionTestId,
            Collection<EstadoConfiguracion> estados);

    Optional<ClaveRespuesta> findFirstByReglaCalificacionIdAndItemId(Long reglaCalificacionId, Long itemId);

    /** Filas {claveId, opcionId} del conjunto correcto (claves con usa_conjunto_opciones, items OPCION_MULTIPLE). */
    @Query(value = """
            select clave_respuesta_id, opcion_id
            from clave_respuesta_opcion
            where clave_respuesta_id in (:claveIds)
            """, nativeQuery = true)
    List<Object[]> findOptionSetRowsByKeyIds(Collection<Long> claveIds);
}

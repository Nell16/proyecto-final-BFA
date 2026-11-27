package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.DimensionResultado;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface DimensionResultadoLookupRepository extends JpaRepository<DimensionResultado, Long> {
    /** Dimensiones activas de la version vinculadas a un subtest (puntaje por subtest), en orden de presentacion. */
    @Query("""
            select d from DimensionResultado d
            join fetch d.subtest
            where d.versionTest.id = :versionTestId
              and d.activa = true
            order by d.ordenPresentacion asc, d.id asc
            """)
    List<DimensionResultado> findActiveSubtestDimensionsByVersionId(Long versionTestId);
}

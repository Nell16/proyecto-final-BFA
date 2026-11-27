package com.uam.psychoform.assessment.repository;

import com.uam.psychoform.assessment.model.SesionSubtest;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface SesionSubtestRepository extends JpaRepository<SesionSubtest, Long> {
    Optional<SesionSubtest> findBySesionAplicacionIdAndSubtestId(Long sesionAplicacionId, Long subtestId);

    List<SesionSubtest> findBySesionAplicacionIdOrderByNumeroOrdenAsc(Long sesionAplicacionId);

    @Query("""
            select ss from SesionSubtest ss
            join fetch ss.subtest
            where ss.sesionAplicacion.id = :sesionAplicacionId
            order by ss.numeroOrden asc
            """)
    List<SesionSubtest> findBySesionAplicacionIdWithSubtestOrderByNumeroOrdenAsc(Long sesionAplicacionId);

    long countBySesionAplicacionId(Long sesionAplicacionId);

    @Modifying
    @Query("delete from SesionSubtest ss where ss.sesionAplicacion.id = :sesionAplicacionId")
    void deleteBySesionAplicacionId(Long sesionAplicacionId);

    @Modifying
    @Query("""
            delete from SesionSubtest ss
            where ss.sesionAplicacion.id = :sesionAplicacionId
              and ss.subtest.id not in :subtestIds
            """)
    void deleteBySesionAplicacionIdAndSubtestIdNotIn(Long sesionAplicacionId, Collection<Long> subtestIds);
}

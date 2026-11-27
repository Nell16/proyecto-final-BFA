package com.uam.psychoform.assessment.repository;

import com.uam.psychoform.assessment.model.PausaSesion;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PausaSesionRepository extends JpaRepository<PausaSesion, Long> {
    Optional<PausaSesion> findFirstBySesionAplicacionIdAndReanudadoEnIsNull(Long sesionId);

    List<PausaSesion> findBySesionAplicacionIdOrderByPausadoEnAsc(Long sesionId);
}

package com.uam.psychoform.scoring.repository;

import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface RevisionManualRespuestaRepository extends JpaRepository<RevisionManualRespuesta, Long> {
    List<RevisionManualRespuesta> findByEstadoOrderByCreadoEnAsc(EstadoRevisionManual estado);

    Optional<RevisionManualRespuesta> findByRespuestaId(Long respuestaId);

    List<RevisionManualRespuesta> findByRespuestaIdIn(Collection<Long> respuestaIds);

    List<RevisionManualRespuesta> findByRespuestaIntentoId(Long intentoId);

    @Query("""
            select review from RevisionManualRespuesta review
            join fetch review.respuesta answer
            join fetch answer.intento attempt
            join fetch attempt.asignacion assignment
            join fetch assignment.participante
            join fetch answer.item
            where review.estado in :estados
            order by review.creadoEn asc
            """)
    List<RevisionManualRespuesta> findPendingWithAnswerContext(Collection<EstadoRevisionManual> estados);

    @Query("""
            select review.respuesta.intento.id, count(review)
            from RevisionManualRespuesta review
            where review.respuesta.intento.id in :intentoIds
              and review.estado <> :excludedStatus
            group by review.respuesta.intento.id
            """)
    List<Object[]> countUnreviewedByIntentoIds(Collection<Long> intentoIds, EstadoRevisionManual excludedStatus);
}

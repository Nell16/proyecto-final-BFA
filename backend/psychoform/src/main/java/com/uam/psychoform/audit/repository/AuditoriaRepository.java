package com.uam.psychoform.audit.repository;

import com.uam.psychoform.audit.model.Auditoria;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

public interface AuditoriaRepository extends JpaRepository<Auditoria, Long>, JpaSpecificationExecutor<Auditoria> {
    List<Auditoria> findByEntidadAndEntidadIdOrderByCreadoEnDesc(String entidad, String entidadId);
    List<Auditoria> findAllByOrderByCreadoEnDesc();

    /** Una sola query con el usuario (evita N+1 al listar), de la mas antigua a la mas reciente. */
    @Query("""
            select a from Auditoria a
            left join fetch a.usuario
            where a.accion = :accion and a.entidad = :entidad and a.entidadId = :entidadId
            order by a.creadoEn asc, a.id asc
            """)
    List<Auditoria> findByAccionAndEntidadWithUsuario(String accion, String entidad, String entidadId);
}

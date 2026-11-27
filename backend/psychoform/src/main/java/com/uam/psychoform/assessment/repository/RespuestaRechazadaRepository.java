package com.uam.psychoform.assessment.repository;

import com.uam.psychoform.assessment.model.RespuestaRechazada;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface RespuestaRechazadaRepository extends JpaRepository<RespuestaRechazada, Long> {
    /**
     * Registra un rechazo: inserta o, si ya existia (intento, item, codigo), suma una vez y actualiza la fecha.
     * Atomico en SQL (ON CONFLICT), sin lectura previa.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            insert into respuesta_rechazada (intento_id, item_id, codigo, rechazado_en, veces)
            values (:intentoId, :itemId, :codigo, :rechazadoEn, 1)
            on conflict (intento_id, item_id, codigo)
            do update set veces = respuesta_rechazada.veces + 1, rechazado_en = excluded.rechazado_en
            """, nativeQuery = true)
    int registrar(Long intentoId, Long itemId, String codigo, LocalDateTime rechazadoEn);

    /**
     * Para el monitor de una sesion, en UNA query: por cada intento, el total de filas y sus {@code limite} mas
     * recientes (mas reciente primero). Los intentos sin rechazos no aparecen.
     */
    @Query(value = """
            select x.intento_id as intentoId, x.item_id as itemId, x.codigo as codigo,
                   x.rechazado_en as rechazadoEn, x.total as total
            from (
                select r.intento_id, r.item_id, r.codigo, r.rechazado_en,
                       row_number() over (partition by r.intento_id
                                          order by r.rechazado_en desc, r.respuesta_rechazada_id desc) as rn,
                       count(*) over (partition by r.intento_id) as total
                from respuesta_rechazada r
                join intento_test i on i.intento_id = r.intento_id
                join asignacion_test a on a.asignacion_id = i.asignacion_id
                where a.sesion_aplicacion_id = :sesionId
            ) x
            where x.rn <= :limite
            order by x.intento_id, x.rn
            """, nativeQuery = true)
    List<RechazoDeIntento> findRecientesPorSesion(Long sesionId, int limite);

    interface RechazoDeIntento {
        Long getIntentoId();

        Long getItemId();

        String getCodigo();

        java.time.LocalDateTime getRechazadoEn();

        Long getTotal();
    }
}

package com.uam.psychoform.assessment.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * Bitacora de respuestas rechazadas por bulk-sync (B17). Una fila por (intento, item, codigo); "veces" cuenta las
 * repeticiones. item_id no es FK: el rechazo puede deberse a un item inexistente.
 */
@Entity
@Table(name = "respuesta_rechazada")
@Getter
@Setter
public class RespuestaRechazada {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "respuesta_rechazada_id")
    private Long id;
    @NotNull
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "intento_id", nullable = false)
    private IntentoTest intento;
    @NotNull
    @Column(name = "item_id", nullable = false)
    private Long itemId;
    @NotBlank
    @Size(max = 60)
    @Column(nullable = false, length = 60)
    private String codigo;
    @NotNull
    @Column(name = "rechazado_en", nullable = false)
    private LocalDateTime rechazadoEn;
    @NotNull
    @Column(nullable = false)
    private Integer veces;
}

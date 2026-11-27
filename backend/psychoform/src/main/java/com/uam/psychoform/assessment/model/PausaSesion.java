package com.uam.psychoform.assessment.model;

import com.uam.psychoform.security.model.Usuario;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "pausa_sesion")
@Getter
@Setter
public class PausaSesion {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "pausa_sesion_id")
    private Long id;
    @NotNull
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sesion_aplicacion_id", nullable = false)
    private SesionAplicacion sesionAplicacion;
    @NotNull
    @Column(name = "pausado_en", nullable = false)
    private LocalDateTime pausadoEn;
    @Column(name = "reanudado_en")
    private LocalDateTime reanudadoEn;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pausado_por")
    private Usuario pausadoPor;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "reanudado_por")
    private Usuario reanudadoPor;
    @Size(max = 300)
    @Column(length = 300)
    private String motivo;
}

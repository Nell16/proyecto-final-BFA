-- B12: permisos de solo catalogo (Aplicador) y de supervision (Psicologo/Coordinador).
-- INSTRUMENTO_CATALOGO_LEER: listar tests, versiones publicadas y subtests para programar sesiones, sin ver items, opciones ni claves.
-- SESION_LEER: consultar sesiones, asignaciones y su progreso (lectura explicita, sin operar la sesion).
INSERT INTO permiso (codigo_permiso, descripcion) VALUES
('INSTRUMENTO_CATALOGO_LEER', 'Listar tests, versiones publicadas y subtests para programar sesiones'),
('SESION_LEER', 'Consultar sesiones, asignaciones y su progreso')
ON CONFLICT (codigo_permiso) DO UPDATE SET descripcion = EXCLUDED.descripcion;

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT r.rol_id, p.permiso_id
FROM rol r
CROSS JOIN permiso p
WHERE r.nombre_rol = 'ADMINISTRADOR'
   OR (r.nombre_rol = 'APLICADOR' AND p.codigo_permiso IN (
        'INSTRUMENTO_CATALOGO_LEER'
   ))
   OR (r.nombre_rol = 'PSICOLOGO_COORDINADOR' AND p.codigo_permiso IN (
        'SESION_LEER', 'PARTICIPANTE_LEER', 'INSTRUMENTO_CATALOGO_LEER'
   ))
ON CONFLICT DO NOTHING;

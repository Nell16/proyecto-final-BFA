-- Pausa y reanudacion de sesiones de aplicacion (1/2).
-- ALTER TYPE ... ADD VALUE va en una migracion propia: el nuevo valor no puede
-- usarse en la misma transaccion en que se agrega.
ALTER TYPE estado_sesion_aplicacion ADD VALUE IF NOT EXISTS 'PAUSADA' AFTER 'ABIERTA';

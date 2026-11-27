UPDATE version_test SET estado='APROBADO' WHERE version_test_id=103 AND estado='BORRADOR';
UPDATE version_test SET estado='PUBLICADO', publicado_en = aprobado_en + interval '1 day' WHERE version_test_id=103;

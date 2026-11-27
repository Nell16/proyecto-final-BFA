-- B20: clave de idempotencia de subida en recurso_multimedia.
ALTER TABLE public.recurso_multimedia
    ADD COLUMN IF NOT EXISTS clave_subida VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS ux_recurso_multimedia_clave_subida
    ON public.recurso_multimedia(clave_subida);

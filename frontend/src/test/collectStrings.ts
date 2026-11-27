/**
 * Recorre un valor por TODAS sus propiedades propias (enumerables o no, incluido `cause`, `config`,
 * `headers`, `request`, `response`…) y devuelve los textos hallados, con nombre de propiedad incluido.
 * Sirve para asegurar que un secreto no queda retenido en ningún nivel de un objeto (p. ej. un error
 * que va a `console.error` o el estado de una mutación). No invoca getters ni funciones.
 */
export function collectStrings(root: unknown): string[] {
  const out: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out.push(String(value));
      return;
    }
    if (typeof value !== "object" || value === null || depth > 12) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (value instanceof Error) out.push(value.name, value.message, value.stack ?? "");
    if (value instanceof Map) {
      for (const [k, v] of value) {
        visit(k, depth + 1);
        visit(v, depth + 1);
      }
      return;
    }
    if (value instanceof Set) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      out.push(typeof key === "symbol" ? key.toString() : key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) visit(descriptor.value, depth + 1);
    }
  };

  visit(root, 0);
  return out;
}

/** `true` si algún texto (o nombre de propiedad) del valor contiene `needle` (sin distinguir mayúsculas). */
export function containsText(root: unknown, needle: string): boolean {
  const lower = needle.toLowerCase();
  return collectStrings(root).some((text) => text.toLowerCase().includes(lower));
}

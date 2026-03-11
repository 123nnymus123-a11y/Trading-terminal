/**
 * Compatibility shim:
 * Some renderer code expects `validateAppEventBatch` to be exported from `packages/shared`.
 * If your event schemas evolve, keep this function stable to prevent startup crashes.
 */
export function validateAppEventBatch(input: unknown): unknown[] {
  // Fail-safe: never throw here (a throw can black-screen the renderer).
  // Your stricter validation can live elsewhere; this keeps boot stable.
  if (Array.isArray(input)) return input;
  return [];
}
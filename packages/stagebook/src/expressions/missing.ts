/** The one absence value shared by reference reads and expression evaluation.
 * It is never a participant value, a stored string, or bare undefined. The
 * registry preserves identity when a host mixes the ESM and CommonJS builds. */
export const Missing: unique symbol = Symbol.for("Stagebook.Missing");

export type Missing = typeof Missing;

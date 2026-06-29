/**
 * Host-supplied participant attributes (#473).
 *
 * `attributes` is the single flat bag of everything the participant arrives
 * at the study with — identity, onboarding, connection, and browser
 * metadata — addressed via the `attributes` reference source
 * (`self.attributes.<field>`). It replaces the three legacy host bags
 * `connectionInfo`, `browserInfo`, and `participantInfo`, which were merged
 * on the premise that they're all "host-maintained attributes of the current
 * participant" with no meaningful split. Values may change mid-study (e.g.
 * screen width on resize); the host is responsible for keeping them current.
 *
 * Two identity fields are special:
 *   - `stableParticipantId` — anonymized, stable across sessions, the
 *     release-safe id used to link exported data. **Required for studies that
 *     use it.** Not checked eagerly at mount (most studies never touch it);
 *     checked lazily at the one place stagebook consumes it — the Qualtrics
 *     `stableParticipantId` URL-param injection — where a missing id is loud
 *     (`console.error` + the optional `onContractViolation` callback) but
 *     never blocks. Presence is enforced upstream via a host CI integration
 *     test (this helper) + a batch-start preflight, and the connect race by a
 *     host readiness gate.
 *   - `sampleId` — the per-assignment data-row id, minted at game-stage
 *     start. **Optional** and absent during intro / groupComposition;
 *     `validateReferences` flags pre-game reads.
 *
 * The recruitment-platform id is deliberately **not** modeled here. Keeping
 * recruitment PII out of stagebook's referenceable surface is the privacy
 * guarantee; released data is linkable via `stableParticipantId`.
 *
 * The bag is open (`.passthrough()`) so a host can add further fields it
 * references in treatments without a schema change. This schema is the host
 * contract, a test-fixture factory, and the documentation source of truth.
 */

import { z } from "zod";

export const attributesSchema = z
  .object({
    // Identity (see module doc).
    stableParticipantId: z.string().min(1),
    sampleId: z.string().min(1).optional(),
    // Onboarding.
    name: z.string().optional(),
    // Connection / geo metadata.
    country: z.string().optional(),
    timezone: z.string().optional(),
    isKnownVpn: z.boolean().optional(),
    // Browser / client metadata.
    screenWidth: z.number().optional(),
    screenHeight: z.number().optional(),
    language: z.string().optional(),
    userAgent: z.string().optional(),
  })
  .passthrough();

export type AttributesType = z.infer<typeof attributesSchema>;

/**
 * The one hard requirement on the `attributes` bag: a non-empty
 * `stableParticipantId`. Isolated from the full schema so the provider's
 * contract check (and host integration tests / batch-start preflight) can
 * assert *presence of the export id* without rejecting a participant over a
 * soft/optional field a host typed loosely (e.g. a stringified `screenWidth`).
 */
export function hasStableParticipantId(attributes: unknown): boolean {
  if (typeof attributes !== "object" || attributes === null) return false;
  const id = (attributes as Record<string, unknown>).stableParticipantId;
  // Non-empty after trimming — a whitespace-only id is treated as absent so a
  // degenerate host value can't silently ship as the export id.
  return typeof id === "string" && id.trim().length > 0;
}

import type { CareEvent } from "./plants.js";

export type TimelineEntry = { kind: "photo"; id: string; createdAt: string } | { kind: "event"; event: CareEvent };

/** `GET /api/plants/:id/timeline` : photos et actions du journal mêlées, de la plus récente à la plus ancienne. */
export interface PlantTimeline {
  entries: TimelineEntry[];
}

import { useState } from "react";
import { dayLabel, gapLabel } from "../lib/timeline";
import { photoUrl } from "../lib/photos";
import { Card, inputClass, labelClass } from "./ui";

export interface ComparePhoto {
  id: string;
  createdAt: string;
}

/** Deux photos côte à côte avec leurs dates et l'écart. `photos` : de la plus récente à la plus ancienne (2 au moins). */
export function TimelineCompare({ photos }: { photos: ComparePhoto[] }) {
  // Par défaut : la plus ancienne (avant) et la plus récente (après).
  const [beforeId, setBeforeId] = useState(photos[photos.length - 1].id);
  const [afterId, setAfterId] = useState(photos[0].id);
  const before = photos.find((p) => p.id === beforeId) ?? photos[photos.length - 1];
  const after = photos.find((p) => p.id === afterId) ?? photos[0];
  const option = (p: ComparePhoto) => (
    <option key={p.id} value={p.id}>
      {dayLabel(p.createdAt)}
    </option>
  );

  return (
    <Card title="Comparer deux photos">
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Avant
          <select value={before.id} onChange={(e) => setBeforeId(e.target.value)} className={inputClass}>
            {photos.map(option)}
          </select>
        </label>
        <label className={labelClass}>
          Après
          <select value={after.id} onChange={(e) => setAfterId(e.target.value)} className={inputClass}>
            {photos.map(option)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[before, after].map((p, i) => (
          <figure key={i} className="flex flex-col gap-1.5">
            <img
              src={photoUrl(p.id)}
              alt={`${i === 0 ? "Avant" : "Après"} : photo du ${dayLabel(p.createdAt)}`}
              loading="lazy"
              width={400}
              height={500}
              className="aspect-4/5 w-full rounded-md bg-surface-sunken object-cover"
            />
            <figcaption className="text-caption text-ink-muted">
              <span className="block text-label text-ink">{i === 0 ? "Avant" : "Après"}</span>
              {dayLabel(p.createdAt)}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="text-body-sm text-ink-muted" role="status">
        {gapLabel(before.createdAt, after.createdAt)}
      </p>
    </Card>
  );
}

import type { CareSheet } from "@plantes/shared";
import { Card, Notice } from "./ui";

export const LIGHT_LABELS: Record<CareSheet["light"]["need"], string> = {
  ombre: "Peu de lumière",
  "mi-ombre": "Lumière douce",
  "lumiere-indirecte-vive": "Très lumineux, sans soleil direct",
  "soleil-direct": "Plein soleil",
};

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-leaf-800">{title}</dt>
      <dd className="mt-0.5 text-stone-700">{children}</dd>
    </div>
  );
}

export function CareSheetView({ s }: { s: CareSheet }) {
  const x = s.extras;
  return (
    <Card>
      <h2 className="text-xl font-bold text-leaf-800">
        {s.commonName} <span className="text-base font-normal text-stone-500 italic">{s.scientificName}</span>
      </h2>
      {!s.nameMatchesPhoto && <Notice kind="error">⚠️ La photo ne semble pas correspondre : {s.identificationNote}</Notice>}
      <p className="text-sm text-stone-600">Difficulté : {s.difficulty}</p>
      {s.observedCondition && <p>{s.observedCondition}</p>}
      <dl className="flex flex-col gap-3">
        <Row title="💧 Arrosage">
          Tous les <b>{s.watering.intervalDaysSummer} jours</b> l'été, <b>{s.watering.intervalDaysWinter} jours</b> l'hiver.
          <br />
          {s.watering.method}
          <small className="mt-1 block text-stone-500">{s.watering.signs}</small>
        </Row>
        <Row title={`☀️ Lumière : ${LIGHT_LABELS[s.light.need] ?? s.light.need}`}>{s.light.details}</Row>
        <Row title="💨 Humidité">{x.humidity}</Row>
        <Row title="🌡️ Température">{x.temperature}</Row>
        <Row title="🧪 Engrais">{x.fertilizer}</Row>
        <Row title="🔁 Rempotage">{x.repotting}</Row>
        <Row title="🪴 Terre">{x.substrate}</Row>
        <Row title="💡 À retenir">
          <ul className="list-disc pl-5">
            {s.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Row>
      </dl>
    </Card>
  );
}

import { useState } from "react";
import type { CareSheet } from "@plantes/shared";
import { Button, Card, Field, Notice, useAction } from "../../components/ui";
import { api } from "../../lib/api";
import { resizePhoto } from "../../lib/image";

const LIGHT_LABELS: Record<CareSheet["light"]["need"], string> = {
  ombre: "Peu de lumière",
  "mi-ombre": "Lumière douce",
  "lumiere-indirecte-vive": "Très lumineux, sans soleil direct",
  "soleil-direct": "Plein soleil",
};

export function CareSheetCard() {
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CareSheet | null>(null);

  const generate = () =>
    void run(async () => {
      setSheet(null);
      const form = new FormData();
      form.append("name", name.trim());
      if (file) form.append("photo", await resizePhoto(file), "photo.jpg");
      setSheet((await api<{ sheet: CareSheet }>("/api/care-sheet", { method: "POST", body: form })).sheet);
    });

  return (
    <>
      <Card title="📸 Fiche d'entretien">
        <Field label="Nom de la plante" placeholder="ex. Calathea sanderiana" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="flex flex-col gap-1 text-sm font-medium text-stone-700">
          Photo (facultatif)
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
        </label>
        {preview && <img src={preview} alt="Aperçu" className="max-h-60 rounded-xl object-cover" />}
        <Button onClick={generate} disabled={busy || !name.trim()}>
          {busy ? "Claude prépare la fiche…" : "Générer la fiche"}
        </Button>
        {busy && <Notice>Compte 15 à 30 secondes.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
      </Card>
      {sheet && <Sheet s={sheet} />}
    </>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-leaf-800">{title}</dt>
      <dd className="mt-0.5 text-stone-700">{children}</dd>
    </div>
  );
}

export function Sheet({ s }: { s: CareSheet }) {
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

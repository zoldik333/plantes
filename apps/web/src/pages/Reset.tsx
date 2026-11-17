import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Button, Card, Field, Notice, Page, useAction } from "../components/ui";
import { api } from "../lib/api";

export default function Reset({ token }: { token: string }) {
  const { busy, error, run } = useAction();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("/api/reset-password", { method: "POST", json: { token, password } });
      setDone(true);
    });
  };

  return (
    <Page>
      <h1 className="pt-6 text-center text-3xl font-bold text-leaf-800">🌿 Plantes</h1>
      <Card title="Nouveau mot de passe">
        {done ? (
          <>
            <Notice kind="ok">Mot de passe changé. Tes autres appareils ont été déconnectés.</Notice>
            <Link href="/login" className="font-medium text-leaf-700 underline">
              Se connecter
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field
              label="Nouveau mot de passe (10 caractères minimum)"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <Notice kind="error">{error}</Notice>}
            <Button type="submit" disabled={busy}>
              Enregistrer
            </Button>
          </form>
        )}
      </Card>
    </Page>
  );
}

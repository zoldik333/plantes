import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Button, Card, Field, Notice, Page, useAction } from "../components/ui";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { useMe } from "../lib/me";

export default function Login() {
  const [, navigate] = useLocation();
  const { refresh } = useMe();
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  useEffect(() => {
    api<{ needsBootstrap: boolean }>("/api/setup")
      .then((s) => setNeedsBootstrap(s.needsBootstrap))
      .catch(() => {});
  }, []);

  const done = async () => {
    await refresh();
    navigate("/");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { error } = await authClient.signIn.email({ email: email.trim().toLowerCase(), password });
      if (error) throw new Error(error.status === 429 ? "Trop de tentatives, réessaie dans un moment." : "E-mail ou mot de passe incorrect.");
      await done();
    });
  };

  const withPasskey = () =>
    void run(async () => {
      const res = await authClient.signIn.passkey();
      if (res?.error) throw new Error("Passkey non reconnue ou annulée.");
      await done();
    });

  return (
    <Page>
      <h1 className="pt-6 text-center text-3xl font-bold text-leaf-800">🌿 Plantes</h1>
      <Card title="Connexion">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Field
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" disabled={busy}>
            Se connecter
          </Button>
        </form>
        <Button variant="secondary" onClick={withPasskey} disabled={busy}>
          🔑 Se connecter avec une passkey
        </Button>
      </Card>
      {needsBootstrap ? (
        <Notice>
          Aucun foyer n'existe encore sur ce serveur. <Link href="/setup" className="font-medium underline">Créer le premier compte</Link>
        </Notice>
      ) : (
        <Notice>L'inscription se fait sur invitation : demande un lien à un membre de ton foyer.</Notice>
      )}
    </Page>
  );
}

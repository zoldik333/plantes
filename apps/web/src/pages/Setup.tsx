import { useState } from "react";
import { Card, Field, Notice } from "../components/ui";
import { SignupForm, WelcomePage } from "./SignupForm";

/** Création du tout premier compte (et du foyer) : exige la clé d'installation du serveur. */
export default function Setup() {
  const [key, setKey] = useState("");
  return (
    <WelcomePage>
      <Card title="Premier compte">
        <Notice>Cette étape crée ton foyer. Elle est réservée à la personne qui administre le serveur.</Notice>
        <SignupForm
          extra={{ bootstrapKey: key }}
          extraField={
            <Field
              label="Clé d'installation (POC_ACCESS_KEY du serveur)"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
          }
        />
      </Card>
    </WelcomePage>
  );
}

import { AiStatusBanner } from "../components/AiStatusBanner";
import { Button, Notice, Page, PageHeader } from "../components/ui";
import { authClient } from "../lib/auth-client";
import { useMe, type Me } from "../lib/me";
import { ClaudeTokenCard } from "./home/ClaudeTokenCard";
import { HouseholdCard } from "./home/HouseholdCard";
import { NotificationsCard } from "./home/NotificationsCard";
import { PasskeysCard } from "./home/PasskeysCard";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad/.test(navigator.userAgent);

export default function Settings({ me }: { me: Me }) {
  const { refresh } = useMe();
  const logout = async () => {
    await authClient.signOut();
    await refresh();
  };

  return (
    <Page>
      <PageHeader
        title="Réglages"
        action={
          <Button variant="secondary" icon="logout" className="px-4" onClick={logout}>
            Déconnexion
          </Button>
        }
      />
      <AiStatusBanner />
      <p className="text-body-sm text-ink-muted">Connecté en tant que {me.user.name}.</p>
      {isIos() && !isStandalone() && (
        <Notice>
          Pour recevoir les notifications sur iPhone, installe l'app : bouton Partager, puis « Sur l'écran d'accueil », et ouvre « Plantes » depuis
          l'écran d'accueil.
        </Notice>
      )}
      <HouseholdCard me={me} />
      <PasskeysCard />
      <NotificationsCard />
      <ClaudeTokenCard />
    </Page>
  );
}

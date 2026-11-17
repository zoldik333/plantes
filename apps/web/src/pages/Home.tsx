import { Button, Notice, Page } from "../components/ui";
import { authClient } from "../lib/auth-client";
import { useMe, type Me } from "../lib/me";
import { CareSheetCard } from "./home/CareSheetCard";
import { HouseholdCard } from "./home/HouseholdCard";
import { NotificationsCard } from "./home/NotificationsCard";
import { PasskeysCard } from "./home/PasskeysCard";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad/.test(navigator.userAgent);

export default function Home({ me }: { me: Me }) {
  const { refresh } = useMe();
  const logout = async () => {
    await authClient.signOut();
    await refresh();
  };

  return (
    <Page>
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold text-leaf-800">🌿 Plantes</h1>
        <Button variant="secondary" className="min-h-9 px-3 py-1 text-sm" onClick={logout}>
          Déconnexion
        </Button>
      </header>
      <p className="text-stone-600">Bonjour {me.user.name} 👋</p>
      {isIos() && !isStandalone() && (
        <Notice>
          Pour recevoir les notifications sur iPhone, installe l'app : bouton Partager, puis « Sur l'écran d'accueil », et ouvre « Plantes » depuis
          l'écran d'accueil.
        </Notice>
      )}
      <HouseholdCard me={me} />
      <PasskeysCard />
      <NotificationsCard />
      <CareSheetCard />
    </Page>
  );
}

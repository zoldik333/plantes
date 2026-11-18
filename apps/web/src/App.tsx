import { Redirect, Route, Switch } from "wouter";
import { Shell } from "./components/Shell";
import { Notice, Page } from "./components/ui";
import { useMe, type Me } from "./lib/me";
import Join from "./pages/Join";
import Login from "./pages/Login";
import PlantDetail from "./pages/PlantDetail";
import PlantList from "./pages/PlantList";
import PlantNew from "./pages/PlantNew";
import Today from "./pages/Today";
import Reset from "./pages/Reset";
import Rooms from "./pages/Rooms";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";

/** Pages réservées aux membres connectés, dans le cadre à onglets. */
function Authenticated({ me }: { me: Me }) {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Today} />
        <Route path="/plants" component={PlantList} />
        <Route path="/plants/new" component={PlantNew} />
        <Route path="/plants/:id">{(p) => <PlantDetail id={p.id} />}</Route>
        <Route path="/rooms" component={Rooms} />
        <Route path="/settings">
          <Settings me={me} />
        </Route>
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </Shell>
  );
}

export default function App() {
  const { me } = useMe();

  if (me === undefined) {
    return (
      <Page>
        <Notice>Chargement…</Notice>
      </Page>
    );
  }

  return (
    <Switch>
      {/* Pages publiques : accessibles sans compte (et aussi avec, ex. lien d'invitation ouvert par erreur). */}
      <Route path="/join/:token">{(p) => <Join token={p.token} />}</Route>
      <Route path="/reset/:token">{(p) => <Reset token={p.token} />}</Route>
      <Route path="/setup">{me ? <Redirect to="/" /> : <Setup />}</Route>
      <Route path="/login">{me ? <Redirect to="/" /> : <Login />}</Route>
      <Route>{me ? <Authenticated me={me} /> : <Redirect to="/login" />}</Route>
    </Switch>
  );
}

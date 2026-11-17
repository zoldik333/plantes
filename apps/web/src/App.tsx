import { Redirect, Route, Switch } from "wouter";
import { Notice, Page } from "./components/ui";
import { useMe } from "./lib/me";
import Home from "./pages/Home";
import Join from "./pages/Join";
import Login from "./pages/Login";
import Reset from "./pages/Reset";
import Setup from "./pages/Setup";

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
      <Route path="/">{me ? <Home me={me} /> : <Redirect to="/login" />}</Route>
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

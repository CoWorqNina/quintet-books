import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import type { AppUser } from "../shared/types";
import { api, ApiRequestError } from "./lib/api";
import { supabase } from "./lib/supabase";
import Accounts from "./pages/Accounts";
import Home from "./pages/Home";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setUser(null);
    setUserError(null);
    if (!session) return;
    api<AppUser>("/me")
      .then(setUser)
      .catch((e: unknown) => setUserError(e instanceof ApiRequestError ? e.message : "Could not load your account"));
  }, [session?.user.id]);

  if (session === undefined) return <p className="center muted">Loading…</p>;
  if (recovering && session) return <SetPassword onDone={() => setRecovering(false)} />;
  if (!session) return <Login />;
  if (userError) {
    return (
      <div className="center card narrow">
        <p>{userError}</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }
  if (!user) return <p className="center muted">Loading your account…</p>;

  return (
    <div className="shell">
      <header className="topbar">
        <strong>GGC Books</strong>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/accounts">Chart of Accounts</NavLink>
        </nav>
        <span className="who">
          {user.fullName} · {user.role}
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </span>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}

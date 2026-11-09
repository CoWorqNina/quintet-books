import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import type { AppUser } from "../shared/types";
import { api, ApiRequestError } from "./lib/api";
import { supabase } from "./lib/supabase";
import { DAILY_REPORT_ROLES, templatesFor } from "../shared/templates";
import Accounts from "./pages/Accounts";
import Approvals from "./pages/Approvals";
import DailyReport, { EditDailyReport } from "./pages/DailyReport";
import DailyReports from "./pages/DailyReports";
import Home from "./pages/Home";
import Journal from "./pages/Journal";
import Ledger from "./pages/Ledger";
import { Payables } from "./pages/Payables";
import { CashReceivables } from "./pages/CashReceivables";
import ManagementReport from "./pages/ManagementReport";
import MonthEnd from "./pages/MonthEnd";
import Login from "./pages/Login";
import Classify from "./pages/Classify";
import ManualEntry from "./pages/ManualEntry";
import NewEntry, { CorrectEntry, EditEntry } from "./pages/NewEntry";
import Registers from "./pages/Registers";
import Statements from "./pages/Statements";
import Users from "./pages/Users";
import Parties from "./pages/Parties";
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

  const canReport = DAILY_REPORT_ROLES.includes(user.role);
  const canEnter = templatesFor(user.role, user.books).length > 0;
  const isOwner = user.role === "Owner";
  const isBooks = isOwner || user.role === "Accountant";
  // Partners (owners who don't post) see the books and reports, read-only.
  const canView = isBooks || user.role === "Partner";
  const canCount = user.role === "Supervisor" || user.role === "Commissary In-charge";

  return (
    <div className="shell">
      <header className="topbar no-print">
        <NavLink to="/" className="brand" end>
          <img src="/logo.png" alt="Go Go Chicken" />
          <span>Books</span>
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          {canReport && <NavLink to="/daily-reports">Daily reports</NavLink>}
          {canEnter && <NavLink to="/entries/new">New entry</NavLink>}
          {isOwner && <NavLink to="/approvals">Approvals</NavLink>}
          <NavLink to="/journal">Journal</NavLink>
          {canView && <NavLink to="/cash">Cash Register</NavLink>}
          {canView && <NavLink to="/payables">Payables</NavLink>}
          {canView && <NavLink to="/report">Report</NavLink>}
          {canView && <NavLink to="/statements">Statements</NavLink>}
          {canView && <NavLink to="/ledger">Ledger</NavLink>}
          {(isBooks || canCount) && <NavLink to={isBooks ? "/month-end" : "/month-end/inventory"}>Month-end</NavLink>}
          {isBooks && <NavLink to="/classify">For classification</NavLink>}
          {isBooks && <NavLink to="/entries/manual">Special entry</NavLink>}
          {isBooks && <NavLink to="/registers">Registers</NavLink>}
          <NavLink to="/parties">People</NavLink>
          <NavLink to="/accounts">Accounts</NavLink>
          {isOwner && <NavLink to="/users">Users</NavLink>}
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
          {canReport && <Route path="/daily-reports" element={<DailyReports />} />}
          {canReport && <Route path="/daily-reports/new" element={<DailyReport user={user} />} />}
          {canEnter && <Route path="/entries/new" element={<NewEntry user={user} />} />}
          {canEnter && <Route path="/entries/:id/edit" element={<EditEntry user={user} />} />}
          {canReport && <Route path="/daily-reports/:id/edit" element={<EditDailyReport user={user} />} />}
          {isOwner && <Route path="/approvals" element={<Approvals />} />}
          <Route path="/journal" element={<Journal user={user} />} />
          <Route path="/parties" element={<Parties user={user} />} />
          <Route path="/accounts" element={<Accounts user={user} />} />
          {isBooks && <Route path="/entries/:id/correct" element={<CorrectEntry user={user} />} />}
          {isBooks && <Route path="/entries/manual" element={<ManualEntry user={user} />} />}
          {isOwner && <Route path="/opening-balances" element={<ManualEntry user={user} opening />} />}
          {isBooks && <Route path="/classify" element={<Classify user={user} />} />}
          {isBooks && <Route path="/registers" element={<Registers user={user} />} />}
          {canView && <Route path="/ledger/*" element={<Ledger />} />}
          {canView && <Route path="/payables" element={<Payables canPay={isBooks} />} />}
          {canView && <Route path="/cash" element={<CashReceivables />} />}
          {canView && <Route path="/statements/*" element={<Statements />} />}
          {canView && <Route path="/report" element={<ManagementReport />} />}
          {isOwner && <Route path="/users" element={<Users user={user} />} />}
          {(isBooks || canCount) && <Route path="/month-end/*" element={<MonthEnd user={user} />} />}
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}

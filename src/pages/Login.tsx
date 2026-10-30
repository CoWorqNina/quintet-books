import { type FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage("Wrong email or password.");
    setBusy(false);
  }

  async function forgot() {
    if (!email) return setMessage("Type your email first, then click “Forgot password”.");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setMessage(error ? error.message : "Check your email for a link to set a new password.");
    setBusy(false);
  }

  return (
    <form className="center card narrow" onSubmit={signIn}>
      <h1>GGC Books</h1>
      <label>
        Email
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        Sign in
      </button>
      <button type="button" className="link" onClick={forgot} disabled={busy}>
        Forgot password
      </button>
      {message && <p className="muted">{message}</p>}
    </form>
  );
}

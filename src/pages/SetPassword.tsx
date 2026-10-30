import { type FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setMessage("Use at least 10 characters.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setMessage(error.message);
    onDone();
  }

  return (
    <form className="center card narrow" onSubmit={save}>
      <h1>Set a new password</h1>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button type="submit">Save password</button>
      {message && <p className="muted">{message}</p>}
    </form>
  );
}

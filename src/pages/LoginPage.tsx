import { useEffect, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from "../auth/AuthProvider";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) nav("/", { replace: true });
  }, [loading, user, nav]);

  async function loginGoogle() {
    setErr(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // redirect is handled by auth state effect
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    }
  }

  return (
    <div className="grid" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1>Login</h1>

      <div className="card">
        <div className="muted" style={{ marginBottom: 10 }}>
          Sign in to sync DayBook across devices.
        </div>

        <button className="btn" onClick={loginGoogle} disabled={loading}>
          Continue with Google
        </button>

        {err ? <div className="muted" style={{ marginTop: 10 }}>{err}</div> : null}
      </div>
    </div>
  );
}
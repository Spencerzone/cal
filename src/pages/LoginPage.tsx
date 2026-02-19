import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from "../auth/AuthProvider";
import { useNavigate } from "react-router-dom";

function friendlyAuthError(e: any): { title: string; detail?: string } {
  const code = e?.code || e?.error?.code;
  const msg = e?.message ? String(e.message) : "";

  if (code === "auth/unauthorized-domain" || msg.includes("auth/unauthorized-domain")) {
    const host = typeof window !== "undefined" ? window.location.host : "(unknown host)";
    return {
      title: "Firebase blocked this domain",
      detail:
        `Error: auth/unauthorized-domain\n\n` +
        `Current site: ${host}\n\n` +
        `Fix (Firebase Console): Authentication → Settings → Authorized domains → Add ${host}.\n` +
        `Also confirm VITE_FIREBASE_AUTH_DOMAIN is set to your Firebase project's authDomain ` +
        `(usually <project-id>.firebaseapp.com from the Web App config), not your custom website domain.`,
    };
  }

  if (code === "auth/popup-blocked") {
    return {
      title: "Popup blocked",
      detail: "Allow popups for this site, then try again.",
    };
  }

  if (code === "auth/cancelled-popup-request" || code === "auth/popup-closed-by-user") {
    return { title: "Login cancelled" };
  }

  return {
    title: "Login failed",
    detail: code ? `${code}${msg ? `\n\n${msg}` : ""}` : msg || "Unknown error",
  };
}

export default function LoginPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<{ title: string; detail?: string } | null>(null);

  useEffect(() => {
    if (!loading && user) nav("/", { replace: true });
  }, [loading, user, nav]);

  const isSecureContext = useMemo(() => {
    // Firebase Auth popups and storage are happier on HTTPS, but localhost is OK.
    const p = typeof window !== "undefined" ? window.location.protocol : "https:";
    const h = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return p === "https:" || h === "localhost" || h === "127.0.0.1";
  }, []);

  async function loginGoogle() {
    setErr(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // redirect is handled by auth state effect
    } catch (e: any) {
      setErr(friendlyAuthError(e));
    }
  }

  return (
    <div className="grid" style={{ maxWidth: 520, margin: "0 auto" }}>
      <h1>Login</h1>

      <div className="card">
        <div className="muted" style={{ marginBottom: 10 }}>
          Sign in to sync DayBook across devices.
        </div>

        {!isSecureContext ? (
          <div className="muted" style={{ marginBottom: 10 }}>
            This site is not running on HTTPS. Firebase Auth may fail unless you use HTTPS (or localhost).
          </div>
        ) : null}

        <button className="btn" onClick={loginGoogle} disabled={loading}>
          Continue with Google
        </button>

        {err ? (
          <div className="muted" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{err.title}</div>
            {err.detail ? <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{err.detail}</pre> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

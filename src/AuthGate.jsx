
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import App from "./App";

export default function AuthGate() {
  const [session, setSession] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;

      setSession(nextSession);
      setLoading(false);
    });

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;

        if (error) {
          setMessage({
            type: "error",
            text: error.message,
          });
        } else {
          setSession(data.session);
        }

        setLoading(false);
      })
      .catch(() => {
        if (!active) return;

        setMessage({
          type: "error",
          text: "Could not check your session. Please refresh.",
        });

        setLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const cleanEmail = email.trim();

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin,
          },
        });

        if (error) throw error;

        if (data.session) {
          setMessage({
            type: "success",
            text: "Account created successfully!",
          });
        } else {
          setMessage({
            type: "success",
            text:
              "Account request received. Check your email for a confirmation link, then sign in.",
          });

          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) throw error;

        setMessage({
          type: "success",
          text: "Signed in successfully!",
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Authentication failed. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setMessage(null);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        setMessage({
          type: "error",
          text: error.message,
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error.message || "Could not sign out. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="auth-loading">
        <p>Loading ClearTrail...</p>
      </div>
    );
  }

  if (demoMode && !session) {
    return (
      <>
        <div className="demo-mode-bar">
          <span>
            <strong>Demo Mode</strong> · Sample and locally saved records
          </span>

          <button
            type="button"
            onClick={() => setDemoMode(false)}
          >
            Exit demo
          </button>
        </div>

        <App
          key="cleartrail-demo"
          storageKey="cleartrailSavedCases:demo"
        />
      </>
    );
  }

  if (session) {
    return (
      <>
        <div className="auth-session-bar">
          <span>
            Signed in as <strong>{session.user.email}</strong>
          </span>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={busy}
          >
            {busy ? "Signing out..." : "Sign out"}
          </button>
        </div>

        <App
          key={session.user.id}
          userId={session.user.id}
          storageKey={`cleartrailSavedCases:${session.user.id}`}
        />
      </>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-logo">✓</div>

        <p className="auth-eyebrow">CITIZEN ACCOUNTABILITY</p>

        <h1>Welcome to ClearTrail</h1>

        <p className="auth-subtitle">
          Keep your complaint records organized and your next steps clear.
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "signin" ? "selected" : ""}
            onClick={() => {
              setMode("signin");
              setMessage(null);
            }}
          >
            Sign in
          </button>

          <button
            type="button"
            className={mode === "signup" ? "selected" : ""}
            onClick={() => {
              setMode("signup");
              setMessage(null);
            }}
          >
            Create account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Email address

            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            Password

            <input
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              required
            />
          </label>

          {message && (
            <div
              className={`auth-message ${message.type}`}
              role="status"
            >
              {message.text}
            </div>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={busy}
          >
            {busy
              ? "Please wait..."
              : mode === "signup"
                ? "Create account →"
                : "Sign in →"}
          </button>
        </form>

        <button
          type="button"
          className="auth-demo-button"
          onClick={() => {
            setDemoMode(true);
            setMessage(null);
          }}
        >
          Explore Demo Mode →
        </button>

        <p className="auth-footnote">
          Your account lets you sign in. Cloud syncing of complaint
          records is still being connected.
        </p>
      </section>
    </main>
  );
}

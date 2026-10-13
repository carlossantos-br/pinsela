import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { PinselaMark } from "../pinsela/ui/darkglass/PinselaLogo";

function resolveNextPath(rawValue: string | null | undefined): string {
  const normalized = String(rawValue || "").trim();
  if (!normalized.startsWith("/")) return "/projects";
  if (normalized.startsWith("//")) return "/projects";
  return normalized;
}

export function PinselaLoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const nextPath = resolveNextPath(new URLSearchParams(location.search).get("next"));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(email, password);
      navigate(nextPath, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Invalid credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="pinsela-auth-shell dg-app-root theme-sand">
      <div className="pinsela-auth-card">
        <div className="pinsela-auth-glow" />

        <div className="pinsela-auth-header">
          <PinselaMark size={48} className="pinsela-auth-logo" />
          <h1>Welcome back</h1>
          <p>Restricted access. Accounts are created by the administrator only.</p>
        </div>

        <form onSubmit={handleSubmit} className="pinsela-auth-form">
          <div className="pinsela-auth-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="pinsela-auth-input"
            />
          </div>

          <div className="pinsela-auth-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="pinsela-auth-input"
            />
          </div>

          {error ? <div className="pinsela-auth-error">{error}</div> : null}

          <button
            type="submit"
            disabled={isLoading}
            className="pinsela-page-btn pinsela-page-btn--primary pinsela-auth-submit"
          >
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

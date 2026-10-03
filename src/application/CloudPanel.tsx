"use client";
import { useState } from "react";
import { cloudSession } from "./cloud-runtime";
import type { CloudSnapshot } from "../services/cloud-session";
import { browserFirebaseConfiguration } from "../adapters/firebase/config";

export function CloudPanel({ snapshot }: { snapshot: CloudSnapshot }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  let configured = false;
  try { configured = browserFirebaseConfiguration().enabled; } catch { /* configuration is reported without exposing values */ }
  const pending = snapshot.save === "pending" || snapshot.auth === "authenticating";
  const canDiscard = () => snapshot.save !== "failed" || window.confirm("Unsaved cloud changes will be discarded from this view. They have not been saved locally. Continue?");
  return <section className="page" aria-label="Account and data source"><details><summary>Account & data · {snapshot.mode === "cloud" ? "Private cloud" : "Local-only"}</summary>
    <p role="status">Authentication: {snapshot.auth}. Data: {snapshot.save}.{snapshot.identity && ` Signed in as ${snapshot.identity.email ?? snapshot.identity.uid}.`}</p>
    {!configured && <p>Firebase is disabled or incomplete. Local mode remains available. See the Phase 3A configuration guide.</p>}
    {!snapshot.identity && <form onSubmit={event => { event.preventDefault(); const secret = password; setPassword(""); void cloudSession.signIn(email.trim(), secret); }}>
      <label>Email<input type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="header-action" disabled={!configured || pending} type="submit">Sign in</button>
    </form>}
    {snapshot.identity && <>
      <p>Signing in does not import local records. Cloud mode loads a separate UID-owned dataset. Active timers and quote rotation stay device-local.</p>
      <button className="header-action" disabled={pending} onClick={() => { try { if (canDiscard()) cloudSession.selectCloud(); } catch { setError("Cloud selection is not available. Sign in first."); } }}>{snapshot.mode === "cloud" ? "Reload cloud data" : "Use cloud data (no import)"}</button>
      <button className="text-button" disabled={pending || snapshot.mode === "local"} onClick={() => { try { if (canDiscard()) cloudSession.selectLocal(); } catch { setError("Wait for the pending write before switching."); } }}>Use local data</button>
      <button className="text-button" disabled={pending} onClick={() => { if (canDiscard()) { setPassword(""); setEmail(""); void cloudSession.signOut(); } }}>Sign out</button>
    </>}
    {(snapshot.error || error) && <p role="alert">{snapshot.error || error}</p>}
    <p>No account registration is offered here. Private cloud access requires an administrator-approved Firebase UID.</p>
  </details></section>;
}

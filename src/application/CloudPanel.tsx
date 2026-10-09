"use client";
import { useState } from "react";
import { cloudSession } from "./cloud-runtime";
import type { CloudSnapshot } from "../services/cloud-session";
import { browserFirebaseConfiguration } from "../adapters/firebase/config";

export function CloudPanel({ snapshot, visible = true, session = cloudSession }: { snapshot: CloudSnapshot; visible?: boolean; session?: typeof cloudSession }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  if (!visible) return null;
  let configured = false;
  try { configured = browserFirebaseConfiguration().enabled; } catch { /* configuration is reported without exposing values */ }
  const pending = snapshot.save === "pending" || snapshot.auth === "authenticating";
  const status = snapshot.cached ? "Showing this device’s cached account data. Authentication is restoring in the background; changes remain pending until the matching account reconnects." : snapshot.auth === "authenticating" ? "Restoring private cloud session. Navigation is available." : snapshot.save === "failed" ? "Cloud sync needs attention. Account edits are paused; navigation is available and pending changes are retained." : !snapshot.online ? "Offline. Cached account data is available; changes remain pending on this device." : snapshot.operation === "loading" ? "Refreshing private cloud data in the background…" : snapshot.save === "pending" ? "Cloud changes pending. The app remains usable while syncing." : snapshot.save === "synced" ? "Cloud changes saved." : snapshot.mode === "signed-out" ? "Signed out. Private cloud data is closed." : "Development/fallback mode: saved only on this device.";
  return <section className="page account-data-panel" aria-label="Account and data source"><details open={snapshot.mode === "signed-out" || snapshot.save === "failed"}><summary>Account & data · {snapshot.mode === "cloud" ? "Private cloud" : snapshot.mode === "signed-out" ? "Sign in" : "Local-only (development/fallback)"}</summary>
    <p role="status">{status} Authentication: {snapshot.auth}.{snapshot.identity && !snapshot.cached && ` Signed in as ${snapshot.identity.email ?? snapshot.identity.uid}.`}</p>
    {!configured && <p>Firebase is disabled or incomplete. Local mode remains available. See the Phase 3A configuration guide.</p>}
    {!snapshot.identity && <form onSubmit={event => { event.preventDefault(); const secret = password; setPassword(""); void session.signIn(email.trim(), secret); }}>
      <label>Email<input type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="header-action" disabled={!configured || pending} type="submit">Sign in</button>
    </form>}
    {snapshot.identity && <>
      <p>Cloud is the normal real-user dataset. Local records are never imported. Active timers and quote rotation stay device-local.</p>
      <button className="header-action" onClick={() => { try { setError(""); if (snapshot.mode === "cloud") session.retry(); else session.selectCloud(); } catch { setError("Cloud selection is not available. Sign in first."); } }}>{snapshot.mode === "cloud" ? "Retry / refresh cloud sync" : "Return to cloud (no import)"}</button>
      <button className="text-button" disabled={snapshot.auth === "authenticating" && !snapshot.cached} onClick={() => { setPassword(""); setEmail(""); setError(""); void session.signOut(); }}>Sign out</button>
    </>}
    <button className="text-button" disabled={pending || snapshot.mode === "local"} onClick={() => { try { setError(""); session.selectLocal(); } catch { setError("Wait for the pending operation before switching."); } }}>Use local-only development/fallback data</button>
    {snapshot.auth === "authentication-error" && <button className="text-button" onClick={() => { if (snapshot.error.startsWith("Sign-out")) void session.signOut(); else session.retry(); }}>{snapshot.error.startsWith("Sign-out") ? "Retry sign-out" : "Retry session restoration"}</button>}
    {(snapshot.error || error) && <p role="alert">{snapshot.error || error}</p>}
    <p>No account registration is offered here. Private cloud access requires an administrator-approved Firebase UID.</p>
  </details></section>;
}

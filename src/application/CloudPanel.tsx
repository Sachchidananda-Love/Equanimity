"use client";
import { useEffect, useState } from "react";
import { cloudSession } from "./cloud-runtime";
import type { CloudSnapshot } from "../services/cloud-session";
import { browserFirebaseConfiguration } from "../adapters/firebase/config";

export function CloudPanel({ snapshot }: { snapshot: CloudSnapshot }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  const [showOnInsights, setShowOnInsights] = useState(true);
  useEffect(() => {
    const update = () => setShowOnInsights(document.querySelector(".bottom-nav button.active")?.textContent?.includes("Insights") ?? true);
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  if (!showOnInsights) return null;
  let configured = false;
  try { configured = browserFirebaseConfiguration().enabled; } catch { /* configuration is reported without exposing values */ }
  const pending = snapshot.save === "pending" || snapshot.auth === "authenticating";
  const canDiscard = () => snapshot.save !== "failed" || window.confirm("Unsaved cloud changes will be discarded from this view. They have not been saved locally. Continue?");
  const status = snapshot.operation === "loading" ? "Loading private cloud data…" : snapshot.operation === "saving" ? "Saving changes to cloud…" : snapshot.save === "synced" ? "Cloud changes saved." : snapshot.save === "failed" ? "Cloud operation failed. Editing is paused." : snapshot.mode === "signed-out" ? "Signed out. Private cloud data is closed." : "Development/fallback mode: saved only on this device.";
  return <section className="page account-data-panel" aria-label="Account and data source"><details open={snapshot.mode === "signed-out" || snapshot.save === "failed"}><summary>Account & data · {snapshot.mode === "cloud" ? "Private cloud" : snapshot.mode === "signed-out" ? "Sign in" : "Local-only (development/fallback)"}</summary>
    <p role="status">{status} Authentication: {snapshot.auth}.{snapshot.identity && ` Signed in as ${snapshot.identity.email ?? snapshot.identity.uid}.`}</p>
    {!configured && <p>Firebase is disabled or incomplete. Local mode remains available. See the Phase 3A configuration guide.</p>}
    {!snapshot.identity && <form onSubmit={event => { event.preventDefault(); const secret = password; setPassword(""); void cloudSession.signIn(email.trim(), secret); }}>
      <label>Email<input type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="header-action" disabled={!configured || pending} type="submit">Sign in</button>
    </form>}
    {snapshot.identity && <>
      <p>Cloud is the normal real-user dataset. Local records are never imported. Active timers and quote rotation stay device-local.</p>
      <button className="header-action" disabled={pending} onClick={() => { try { if (canDiscard()) { setError(""); cloudSession.selectCloud(); } } catch { setError("Cloud selection is not available. Sign in first."); } }}>{snapshot.mode === "cloud" ? "Reload cloud data" : "Return to cloud (no import)"}</button>
      <button className="text-button" disabled={snapshot.auth === "authenticating"} onClick={() => { const discardPending = snapshot.save !== "pending" || window.confirm("Sign out now? Pending changes may already have reached the cloud. Unsaved changes will be discarded from this view."); if (discardPending && canDiscard()) { setPassword(""); setEmail(""); setError(""); void cloudSession.signOut(); } }}>Sign out</button>
    </>}
    <button className="text-button" disabled={pending || snapshot.mode === "local"} onClick={() => { try { if (canDiscard()) { setError(""); cloudSession.selectLocal(); } } catch { setError("Wait for the pending operation before switching."); } }}>Use local-only development/fallback data</button>
    {(snapshot.error || error) && <p role="alert">{snapshot.error || error}</p>}
    <p>No account registration is offered here. Private cloud access requires an administrator-approved Firebase UID.</p>
  </details></section>;
}

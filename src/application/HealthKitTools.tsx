"use client";
import { useEffect, useState } from "react";
import { healthKitStatus, inspectHealthKit, normalizeHealthKitRecords, requestHealthKitAuthorization } from "../adapters/healthkit";
import type { HealthKitStatus } from "../adapters/healthkit";
import type { HealthRecord } from "../domain/health/types";

export function HealthKitTools() {
  const [status, setStatus] = useState<HealthKitStatus | null>(null);
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [message, setMessage] = useState("Checking HealthKit availability…");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try { setStatus(await healthKitStatus()); setMessage("HealthKit status refreshed. Read authorization is intentionally reported as unavailable when Apple does not expose it."); }
    catch (error) { setMessage(`HealthKit status failed: ${String(error)}`); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let mounted = true;
    void healthKitStatus().then(next => {
      if (mounted) {
        setStatus(next);
        setMessage("HealthKit status refreshed. Read authorization is intentionally reported as unavailable when Apple does not expose it.");
      }
    }).catch(error => { if (mounted) setMessage(`HealthKit status failed: ${String(error)}`); });
    return () => { mounted = false; };
  }, []);

  const authorize = async () => {
    setBusy(true);
    try { setStatus(await requestHealthKitAuthorization()); setMessage("Permission request completed. Run inspection to see what the device makes readable."); }
    catch (error) { setMessage(`Permission request failed: ${String(error)}`); }
    finally { setBusy(false); }
  };
  const inspect = async () => {
    setBusy(true);
    try {
      const result = await inspectHealthKit(90);
      const normalized = normalizeHealthKitRecords(result.records);
      setRecords(normalized);
      setMessage(`${result.message} ${normalized.length} normalized record${normalized.length === 1 ? "" : "s"} are held in this view only${result.errors.length ? `; ${result.errors.length} type query error${result.errors.length === 1 ? "" : "s"} returned.` : "."}`);
    } catch (error) { setMessage(`Inspection failed: ${String(error)}`); }
    finally { setBusy(false); }
  };

  return <section className="page" aria-label="HealthKit testing and inspection">
    <details>
      <summary>Testing / development · HealthKit inspection</summary>
      <p>Read-only, device-local inspection. Nothing shown here is saved to the repository, uploaded to Firestore, or sent to analytics.</p>
      <p role="status">{message}</p>
      <p><strong>Availability:</strong> {status ? status.available ? "available" : "unavailable" : "checking…"} · <strong>Read permission state:</strong> {status?.readAuthorizationStatus ?? "unknown"}</p>
      <div>
        <button className="header-action" disabled={busy} onClick={() => void refresh()}>Refresh status</button>{" "}
        <button className="header-action" disabled={busy || status?.available !== true} onClick={() => void authorize()}>Request read permissions</button>{" "}
        <button className="header-action" disabled={busy || status?.available !== true} onClick={() => void inspect()}>Inspect last 90 days</button>
      </div>
      {status && <ul><li>HealthKit read authorization is not exposed per type by Apple; no-record results cannot distinguish denial from an empty store.</li>{status.requestedTypes.map(type => <li key={type.identifier}>{type.displayName}: {type.available ? "requested type available" : "not available on this OS"}</li>)}</ul>}
      <p><strong>Recent normalized records:</strong> {records.length || "none"}</p>
      {records.length > 0 && <div>{records.slice().reverse().map(record => <details key={record.id}><summary>{record.localDate} · {record.metric} · {record.provenance.provider}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(record, null, 2)}</pre></details>)}</div>}
    </details>
  </section>;
}

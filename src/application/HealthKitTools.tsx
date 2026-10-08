"use client";
import { useHealthKitImport } from "./use-healthkit-import";
import type { AppData, DataRepository } from "../services/repository-contracts";

export function HealthKitTools({ uid, repository, onImported, onBusy, cloudBusy = false }: {
  uid?: string; repository?: DataRepository; onImported: (data: AppData) => void; onBusy: (busy: boolean) => void; cloudBusy?: boolean;
}) {
  const tools = useHealthKitImport({ uid, repository, onImported, onBusy });
  const busy = tools.busy || cloudBusy;
  const report = tools.result?.report;
  return <section className="page" aria-label="Apple Health import and inspection">
    <details>
      <summary>Apple Health · import & testing</summary>
      <p>Import Tempdrop basal temperature, cervical mucus and menstrual flow from Apple Health. Sleep and other categories remain available for inspection.</p>
      <label className="check-label"><input type="checkbox" checked={tools.enabled} disabled={busy || !tools.canSync} onChange={event => tools.consent(event.target.checked)} />Sync selected Apple Health data to private cloud</label>
      <p>Enabling this stores the selected Tempdrop records in your private Firebase account for cross-device backup. This choice is separate from Apple Health permission and applies to this device and account. Turning it off stops future imports; it does not remove saved records.</p>
      {!tools.canSync && <p>Sign in and select private cloud data to enable imports. Inspection is still available in the iOS app.</p>}
      <p role="status">{tools.message}</p>
      <p>HealthKit: {tools.status ? tools.status.available ? "available" : "unavailable" : "checking…"}. Last successful import: {tools.lastImport ? new Date(tools.lastImport).toLocaleString() : "never"}. Pending on this device: {tools.pending}.</p>
      <div>
        <button className="header-action" disabled={busy} onClick={() => void tools.act("status")}>Refresh status</button>{" "}
        <button className="header-action" disabled={busy || !tools.status?.available} onClick={() => void tools.act("permissions")}>Request read permissions</button>{" "}
        <button className="header-action" disabled={busy || !tools.status?.available} onClick={() => void tools.act("inspect")}>Inspect last 90 days</button>{" "}
        <button className="header-action" disabled={busy || !tools.enabled || !tools.canSync || !tools.status?.available} onClick={() => void tools.act("import")}>Import recent Health data</button>{" "}
        <button className="header-action" disabled={busy || !tools.enabled || !tools.pending} onClick={() => void tools.act("retry")}>Retry pending import</button>
      </div>
      {report && <div>
        <p>Found: {report.found} · new: {report.new} · already imported: {report.alreadyImported} · updated: {report.updated} · skipped: {report.skipped} · superseded: {report.superseded}.</p>
        {tools.result?.state !== "synced" && <p>These are candidate counts; cloud reconciliation is complete only after a successful import.</p>}
        <p>Providers: {Object.entries(report.providers).map(([name, count]) => `${name}: ${count}`).join(" · ") || "none"}.</p>
        <p>Metrics: {Object.entries(report.metrics).map(([name, count]) => `${name}: ${count}`).join(" · ") || "none"}.</p>
      </div>}
      <details><summary>Testing / development · HealthKit inspection</summary>
        <p>Apple does not expose read authorization per category. An empty query cannot distinguish denied or limited permission from an empty Health store. Query results shown here stay on this device.</p>
        <ul>{tools.status?.requestedTypes.map(type => <li key={type.identifier}>{type.displayName}: {type.available ? "type supported" : "type unavailable"}</li>)}</ul>
        {tools.result?.records.slice().reverse().map(record => <details key={record.id}><summary>{record.localDate} · {record.metric} · {record.provenance.provider}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(record, null, 2)}</pre></details>)}
      </details>
    </details>
  </section>;
}

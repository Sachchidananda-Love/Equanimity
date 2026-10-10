"use client";
import { useState } from "react";
import { localRepository } from "../adapters/local/repository";
import { downloadRawBackup } from "../services/backup-service";
import type { RepositoryIssue } from "../services/repository-contracts";
import { developmentToolsEnabled } from "../platform/release-config";

export function DataTools({ issues, reload }: { issues: RepositoryIssue[]; reload: () => void }) {
  const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  const developer = developmentToolsEnabled();
  const reviews = developer ? localRepository.reviewRecords() : [];
  return <section className="page" aria-label="Local data safety" data-revision={revision}>
    {issues.length > 0 && <p role="status">Local data notice: {issues.map(issue => issue.message).join(". ")}. Your original browser records are retained.</p>}
    {developer && <details><summary>Data backup & review</summary>
      <p>Download an exact backup of the saved browser values, including original records and versioned data. Keep this file private.</p>
      <button className="header-action" onClick={() => { try { downloadRawBackup(localRepository); setError(""); } catch (e) { setError(String(e)); } }}>Export browser data</button>
      {reviews.length > 0 && <p>These records match bundled samples. They are preserved separately and excluded from your totals. If a record is yours, you can explicitly keep it as your data.</p>}
      {reviews.map((item, index) => <div key={`${item.dataset}-${item.record.id}`}><span>{item.dataset} · {item.record.date} · {"title" in item.record ? item.record.title : `${item.record.temperature ?? "—"}°C`}</span> <button className="text-button" onClick={() => { try { localRepository.restoreReviewRecord(index); reload(); setRevision(v => v + 1); setError(""); } catch (e) { setError(String(e)); } }}>Keep as my data</button></div>)}
      {error && <p role="alert">{error}</p>}
    </details>}
  </section>;
}

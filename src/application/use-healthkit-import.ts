"use client";
import { useEffect, useMemo, useState } from "react";
import { cloudSession } from "./cloud-runtime";
import { healthKitImportState } from "../adapters/local/healthkit-import-state";
import { createHealthKitImportService, healthKitInspectionService } from "../services/healthkit-import-service";
import type { HealthImportResult } from "../services/healthkit-import-service";
import type { HealthKitStatus } from "../adapters/healthkit";
import type { AppData, DataRepository } from "../services/repository-contracts";
import { lifecycleMeasure, lifecycleSpan } from "../platform/lifecycle-log";

export function useHealthKitImport({ uid, repository, onImported, onBusy }: {
  uid?: string; repository?: DataRepository; onImported: (data: AppData) => void; onBusy: (busy: boolean) => void;
}) {
  const service = useMemo(() => uid && repository ? createHealthKitImportService({
    uid, repository, state: healthKitImportState,
    isCurrent: () => cloudSession.snapshot().identity?.uid === uid && cloudSession.repository() === repository && cloudSession.snapshot().mode === "cloud",
  }) : null, [uid, repository]);
  const [status, setStatus] = useState<HealthKitStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(0);
  const [lastImport, setLastImport] = useState<string | null>(null);
  const [result, setResult] = useState<HealthImportResult | null>(null);
  const [message, setMessage] = useState("Checking Apple Health availability…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(async () => {
      const finish = lifecycleSpan("Health availability");
      let next;
      try { next = await healthKitInspectionService.status(); } finally { finish(); }
      if (!mounted) return;
      setStatus(next); setMessage(next.message);
      if (service) lifecycleMeasure("Health import status checkpoint", () => { setEnabled(service.consent()); setPending(service.pendingCount()); setLastImport(service.lastImport()); });
    }).catch(() => { if (mounted) setMessage("Could not read Apple Health import status. Existing data and device checkpoints are retained."); });
    return () => { mounted = false; };
  }, [service]);

  async function act(action: "status" | "permissions" | "inspect" | "import" | "retry") {
    setBusy(true); onBusy(true);
    try {
      if (action === "status" || action === "permissions") {
        const next = await (action === "status" ? healthKitInspectionService.status() : healthKitInspectionService.requestAuthorization());
        setStatus(next); setMessage(next.message);
      } else {
        const next = await (action === "inspect" ? healthKitInspectionService.inspect() : action === "retry" ? service!.retryPending() : service!.importRecent());
        setResult(next); setMessage(next.message);
        if (next.data) onImported(next.data);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Health import failed. Existing data was retained."); }
    finally {
      try { if (service) { setPending(service.pendingCount()); setLastImport(service.lastImport()); } } catch { /* changed account has its own keyed view */ }
      setBusy(false); onBusy(false);
    }
  }
  function consent(enabled: boolean) {
    try { service?.setConsent(enabled); setEnabled(enabled); setMessage(enabled ? "Cloud sync enabled for selected Tempdrop temperature, mucus and flow on this device and account. Tap Import recent Health data to start." : "Future Health cloud imports are disabled. Previously saved cloud records remain available."); }
    catch { setMessage("Could not save your sync choice. The previous setting remains in effect."); }
  }
  return { status, enabled, pending, lastImport, result, message, busy, canSync: Boolean(service), act, consent };
}

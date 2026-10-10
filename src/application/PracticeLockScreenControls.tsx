import { useEffect, useState } from "react";
import { isIosPractice, type PracticeLockScreen, type PracticeNativeStatus, type PracticeDiagnostics, type PracticeNotificationEvidence } from "../platform/practice-lock-screen";
import { developmentToolsEnabled } from "../platform/release-config";
import { PRACTICE_GONG_FILES } from "../domain/practice/native-plan";

export function practiceNotificationMessage(status: PracticeNativeStatus) {
  if (status.permission === "notDetermined") return "Allow notifications for scheduled gongs while locked. Your first timed Start will also ask for permission; the timer keeps running.";
  if (status.permission === "denied") return "Lock Screen gongs are off. Enable Equanimity notifications and Sounds in iOS Settings.";
  if (status.permission === "provisional") return "Notifications are delivered quietly. Allow audible notifications for Lock Screen gongs.";
  if (!status.soundEnabled) return "Notification sounds are off. Enable Sounds for Equanimity in iOS Settings.";
  return status.requested > 0 ? `${status.scheduled} of ${status.requested} upcoming gongs scheduled. Silent and Focus modes may silence them.`
    : "Notifications and Sounds allowed. Silent and Focus modes may silence gongs.";
}

export function PracticeLockScreenControls({ service }: { service: PracticeLockScreen }) {
  const [status, setStatus] = useState<PracticeNativeStatus | null>(null);
  useEffect(() => service.subscribe(setStatus), [service]);
  if (!isIosPractice()) return null;
  return <div className="source-caption" role="status">
    <div>
      {!status ? "Lock Screen support unavailable. Foreground practice still works." : <>
        <p>{practiceNotificationMessage(status)}</p>
        {(status.permission === "notDetermined" || status.permission === "provisional") && <button type="button" className="text-button" onClick={() => { void service.requestPermission(); }}>Enable Lock Screen gongs</button>}
      </>}
      {status && !status.liveActivitiesEnabled && <p>Live Activities unavailable or disabled in iOS Settings.</p>}
      {status && status.scheduled < status.requested && <p>Only {status.scheduled} of {status.requested} upcoming gongs scheduled. Reopen the app to refill; the final gong is prioritized.</p>}
      {developmentToolsEnabled() && <PracticeNotificationDiagnostics service={service} />}
    </div>
  </div>;
}

function PracticeNotificationDiagnostics({ service }: { service: PracticeLockScreen }) {
  const [diagnostics, setDiagnostics] = useState<PracticeDiagnostics | null>(null);
  const [file, setFile] = useState(PRACTICE_GONG_FILES["Gong 1"]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void service.diagnostics().then(result => { if (active) setDiagnostics(result); }, () => {
        if (active) setMessage("Native diagnostics unavailable. Install a Debug build.");
      });
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; document.removeEventListener("visibilitychange", refresh); };
  }, [service]);
  async function run(test: boolean) {
    setBusy(true);
    try {
      const result = test ? await service.testGong(file) : await service.diagnostics();
      setDiagnostics(result);
      setMessage(test ? "Test scheduled about 10 seconds ahead. Lock the phone now." : "Native notification state refreshed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Native diagnostics unavailable. Install a Debug build."); }
    finally { setBusy(false); }
  }
  async function control(custom: boolean) {
    setBusy(true);
    try {
      setDiagnostics(await service.testNotificationControl(custom));
      setMessage(`${custom ? "Gong 1" : "Default sound"} isolated control scheduled in 10 seconds. Lock now; do not dismiss the notification.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Control scheduling failed."); }
    finally { setBusy(false); }
  }
  return <details open><summary>Developer: Lock Screen gong diagnostics</summary>
    <button type="button" className="text-button" disabled={busy} onClick={() => { void run(false); }}>Refresh notification diagnostics</button>
    <label>Test gong <select aria-label="Notification test gong" value={file} onChange={event => setFile(event.target.value)}>
      {Object.entries(PRACTICE_GONG_FILES).map(([name, value]) => <option key={value} value={value}>{name}</option>)}
    </select></label>
    <button type="button" className="text-button" disabled={busy} onClick={() => { void run(true); }}>Test gong in 10 seconds</button>
    <button type="button" className="text-button" disabled={busy} onClick={() => { void control(false); }}>Test minimal notification: default sound (10 seconds)</button>
    <button type="button" className="text-button" disabled={busy} onClick={() => { void control(true); }}>Test minimal notification: Gong 1 (10 seconds)</button>
    <p>{message}</p>
    {diagnostics && <>
      <PracticeNotificationReadout title="Current device state" evidence={diagnostics} />
      {diagnostics.backgroundEvidence && <PracticeNotificationReadout title="Last background/lock transition" evidence={diagnostics.backgroundEvidence} />}
      {diagnostics.foregroundEvidence && <PracticeNotificationReadout title="Last return to foreground (before alert cleanup)" evidence={diagnostics.foregroundEvidence} />}
      <p>The background snapshot captures the transition, not continuous sampling while suspended. Delivered alerts prove OS delivery, not that sound was audible. Do not dismiss the test notification before returning to the app.</p>
      <p>Controls have no Practice category, thread, session or cleanup. Test separately with Ring mode, audible alert volume and Focus off. If paired with Apple Watch, power the watch off for the control test to exclude notification routing.</p>
      <p>Presentation / removal trace (last 100 events, this app launch only). State: 0 active, 1 inactive, 2 background. No willPresent event while suspended is normal.</p>
      <ul>{diagnostics.notificationTrace?.map((row, index) => <li key={index} style={{ overflowWrap: "anywhere" }}>
        {new Date(row.at).toLocaleString()} · {row.event} · {row.id} · state {row.applicationState} · {row.reason}
        {row.banner !== undefined && ` · banner=${row.banner} list=${row.list} sound=${row.sound}`}
      </li>)}</ul>
      <ul>{diagnostics.assets.map(asset => <li key={asset.filename}>{asset.filename} · {asset.format} · {asset.duration.toFixed(3)}s · {asset.exists && asset.valid ? "valid/bundled" : "MISSING/INVALID"}</li>)}</ul>
    </>}
  </details>;
}

export function PracticeNotificationReadout({ title, evidence }: { title: string; evidence: PracticeNotificationEvidence }) {
    const yesNo = (value: boolean) => value ? "yes" : "no";
  const time = (value: number) => value ? new Date(value).toLocaleString() : "not available";
  const interruption = (value: number | undefined) => value === undefined ? "unknown" : `${["passive", "active", "time-sensitive", "critical"][value] ?? "unknown"} (${value})`;
  return <section aria-label={title}>
    <p><strong>{title}</strong> · captured {time(evidence.capturedAt)}</p>
    <dl>
      <dt>Authorization status</dt><dd>{evidence.permission}</dd>
      <dt>soundSetting</dt><dd>{evidence.soundSetting}</dd>
      <dt>lockScreenSetting</dt><dd>{evidence.lockScreenSetting}</dd>
      <dt>Pending Practice notification count (includes Debug tests and controls)</dt><dd>{evidence.pendingPracticeCount}</dd>
      <dt>Delivered Practice notification count</dt><dd>{evidence.deliveredPracticeCount}</dd>
      <dt>Alert setting / scheduled summary</dt><dd>{evidence.alertSetting} / {evidence.scheduledDeliverySetting}</dd>
      <dt>Practice notification delegate installed</dt><dd>{yesNo(evidence.delegateInstalled)}</dd>
    </dl>
    {evidence.requests.length === 0 && <p>No pending Practice requests in this snapshot.</p>}
    <ul>{evidence.requests.map(request => <li key={request.id} style={{ overflowWrap: "anywhere" }}><dl>
      <dt>Request identifier</dt><dd>{request.id}</dd>
      <dt>Intended delivery time</dt><dd>{time(request.intendedAt)}</dd>
      <dt>Next native trigger time</dt><dd>{time(request.triggerAt)}</dd>
      <dt>Custom sound filename</dt><dd>{request.soundFilename}</dd>
      <dt>Mapped sound filename</dt><dd>{request.mappedSoundFilename ?? "unknown"}</dd>
      <dt>Request userInfo sound filename</dt><dd>{request.userInfoSoundFilename ?? "unknown"}</dd>
      <dt>Trigger type</dt><dd>{request.triggerType ?? "unknown"}</dd>
      <dt>Sound populated</dt><dd>{yesNo(request.soundPopulated)}</dd>
      <dt>Bundle.main file exists</dt><dd>{request.soundFilename === "system default" ? "not applicable (system sound)" : yesNo(request.bundleExists)}</dd>
      <dt>Sound valid (PCM WAV, under 30 seconds)</dt><dd>{request.soundFilename === "system default" ? "not applicable (system sound)" : yesNo(request.validSound)}</dd>
      <dt>Category / thread</dt><dd>{request.category || "none"} / {request.thread || "none"}</dd>
      <dt>Title / body present</dt><dd>{yesNo(request.titlePresent === true)} / {yesNo(request.bodyPresent === true)}</dd>
      <dt>Actual content interruption level</dt><dd>{interruption(request.interruptionLevel)}</dd>
      <dt>Relevance score</dt><dd>{request.relevanceScore ?? "unknown"}</dd>
    </dl></li>)}</ul>
    <ul>{evidence.deliveredRequests.map(request => <li key={request.id} style={{ overflowWrap: "anywhere" }}>
      Delivered request: {request.id} · {time(request.deliveredAt)} · {request.soundFilename} · sound populated {yesNo(request.soundPopulated)}
      {` · category=${request.category || "none"} thread=${request.thread || "none"} title=${request.titlePresent ?? "unknown"} body=${request.bodyPresent ?? "unknown"} interruption=${interruption(request.interruptionLevel)}`}
      {` · mapped=${request.mappedSoundFilename ?? "unknown"} userInfo=${request.userInfoSoundFilename ?? "unknown"} trigger=${request.triggerType ?? "unknown"} relevance=${request.relevanceScore ?? "unknown"}`}
    </li>)}</ul>
  </section>;
}

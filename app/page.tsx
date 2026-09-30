"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityType,
  demoWellnessConnector,
  fiveHindrances,
  JournalEntry,
  sevenFactors,
  threeCharacteristics,
  TimerPreset,
} from "./data";

type Screen = "Today" | "Practice" | "Journal" | "Insights";
type PracticeMode = "Timer" | "Stopwatch" | "Saved";

const navItems: { label: Screen; icon: string }[] = [
  { label: "Today", icon: "⌂" },
  { label: "Practice", icon: "◷" },
  { label: "Journal", icon: "▤" },
  { label: "Insights", icon: "◫" },
];

function formatTime(totalSeconds: number, includeHours = false) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (includeHours || hours > 0) return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function tone() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(220, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(110, context.currentTime + 1.8);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 2.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 2.25);
  } catch { /* audio is optional */ }
}

function Navigation({ active, setActive }: { active: Screen; setActive: (screen: Screen) => void }) {
  const items = navItems.map((item) => (
    <button key={item.label} onClick={() => setActive(item.label)} className={active === item.label ? "active" : ""} aria-current={active === item.label ? "page" : undefined}>
      <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
    </button>
  ));
  return <><aside className="side-rail"><button className="brand-mark" onClick={() => setActive("Today")} aria-label="Yi home">yi</button><nav aria-label="Primary navigation">{items}</nav><div className="sync-status"><i />Demo source</div></aside><nav className="bottom-nav" aria-label="Primary navigation">{items}</nav></>;
}

function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <header className="topbar"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{action ?? <button className="avatar" aria-label="Open profile">Y</button>}</header>;
}

function CycleCard({ compact = false }: { compact?: boolean }) {
  const cycle = demoWellnessConnector.cycle();
  return <article className={`cycle-card card ${compact ? "compact" : ""}`}>
    <div className="card-heading"><div><p className="eyebrow">Cycle day {cycle.day}</p><h2>{cycle.phase}</h2></div><button className="quiet-button" aria-label="Cycle details">•••</button></div>
    <div className="cycle-content">
      <div className="cycle-ring"><div><strong>{cycle.day}</strong><span>of {cycle.averageCycle}</span></div></div>
      <div className="cycle-copy"><strong>{cycle.nextPeriodIn} days</strong><span>until your next period</span><p>Fertile window estimated in {cycle.fertileWindowIn} days</p></div>
    </div>
    <div className="cycle-note"><span>◉</span> Cycle predictions are estimates and cannot identify a zero-risk day for pregnancy.</div>
  </article>;
}

function ArtCube() {
  return <div className="cube-scene" aria-label="Rotating visual pause"><div className="art-cube">
    <div className="cube-face face-1">breathe</div><div className="cube-face face-2">notice</div><div className="cube-face face-3">soften</div><div className="cube-face face-4">return</div><div className="cube-face face-5">here</div><div className="cube-face face-6">now</div>
  </div></div>;
}

function TodayScreen({ setActive }: { setActive: (screen: Screen) => void }) {
  return <section className="page">
    <PageHeader eyebrow="Wednesday, September 30" title="Good morning, Yi." />
    <div className="hero-grid">
      <CycleCard />
      <article className="practice-card card">
        <div className="card-heading"><div><p className="eyebrow">Today</p><h2>Make a little space</h2></div><span className="streak">7 day streak</span></div>
        <p className="practice-quote">“The quieter you become, the more you are able to hear.”</p>
        <button className="primary-button" onClick={() => setActive("Practice")}><span>Begin practice</span><span>→</span></button>
      </article>
    </div>

    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">A gentle overview</p><h2>Your week</h2></div><button className="text-button" onClick={() => setActive("Insights")}>View insights →</button></div>
      <div className="metric-grid">
        <article className="metric card"><span className="metric-icon sage">◌</span><div><strong>86 min</strong><span>Meditation</span></div><small>↑ 18% from last week</small></article>
        <article className="metric card"><span className="metric-icon gold">⌁</span><div><strong>3 sessions</strong><span>Yoga</span></div><small>1 hr 42 min total</small></article>
        <article className="metric card"><span className="metric-icon coral">✦</span><div><strong>4 entries</strong><span>Reflections</span></div><small>Most present on Sunday</small></article>
      </div>
    </section>

    <section className="home-lower section-block">
      <div>
        <div className="section-heading"><div><p className="eyebrow">Recent</p><h2>Your rhythm</h2></div><button className="text-button" onClick={() => setActive("Journal")}>Open journal →</button></div>
        <article className="timeline-row card"><div className="date-block"><strong>29</strong><span>SEP</span></div><div className="timeline-main"><span className="pill meditation">Meditation</span><h3>Evening sit</h3><p>20 min · Calm and spacious</p></div><button className="quiet-button">›</button></article>
        <article className="timeline-row card"><div className="date-block"><strong>28</strong><span>SEP</span></div><div className="timeline-main"><span className="pill yoga">Yoga</span><h3>Slow morning flow</h3><p>34 min · Grounded</p></div><button className="quiet-button">›</button></article>
      </div>
      <article className="visual-card card"><div><p className="eyebrow">Visual pause</p><h2>Let the day turn slowly.</h2><p>Replace each face with one of your images when you’re ready.</p></div><ArtCube /></article>
    </section>
  </section>;
}

function TimerDial({ value, total, label }: { value: number; total: number; label: string }) {
  const degrees = total ? Math.max(0, Math.min(360, (1 - value / total) * 360)) : 0;
  return <div className="timer-dial" style={{ "--progress": `${degrees}deg` } as React.CSSProperties}><div className="timer-inner"><span>{label}</span><strong>{formatTime(value)}</strong><small>{value === total ? "ready when you are" : `${Math.ceil(value / 60)} minutes remaining`}</small></div></div>;
}

function PracticeScreen({ openReflection }: { openReflection: (duration: number) => void }) {
  const presets = demoWellnessConnector.timers();
  const [mode, setMode] = useState<PracticeMode>("Timer");
  const [duration, setDuration] = useState(600);
  const [remaining, setRemaining] = useState(600);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [gongOpen, setGongOpen] = useState(false);
  const [interval, setIntervalMinutes] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    timerRef.current = setInterval(() => {
      if (mode === "Stopwatch") setElapsed((time) => time + 1);
      else setRemaining((time) => Math.max(0, time - 1));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running, mode]);

  useEffect(() => {
    if (mode !== "Stopwatch" && remaining === 0 && running) {
      setRunning(false); tone(); openReflection(Math.max(1, Math.round(duration / 60)));
    }
  }, [remaining, running, mode, duration, openReflection]);

  const chooseDuration = (seconds: number) => { setDuration(seconds); setRemaining(seconds); setRunning(false); };
  const choosePreset = (preset: TimerPreset) => { chooseDuration(preset.seconds); setIntervalMinutes((preset.interval ?? 300) / 60); setMode("Timer"); };
  const finishStopwatch = () => { setRunning(false); openReflection(Math.max(1, Math.round(elapsed / 60))); };

  return <section className="page practice-page">
    <PageHeader eyebrow="Practice room" title="Settle in." action={<button className="header-action" onClick={() => setMode("Saved")}>Saved timers <span>↗</span></button>} />
    <div className="segmented" role="tablist" aria-label="Practice type">{(["Timer", "Stopwatch", "Saved"] as PracticeMode[]).map((item) => <button role="tab" aria-selected={mode === item} key={item} onClick={() => { setMode(item); setRunning(false); }}>{item}</button>)}</div>

    {mode === "Saved" ? <div className="saved-layout">
      <div className="saved-intro"><p className="eyebrow">Your collection</p><h2>Return to a familiar rhythm.</h2><p>Each timer remembers its duration and gong pattern.</p></div>
      <div className="saved-grid">{presets.map((preset) => <article className="saved-timer card" key={preset.id}>
        <div className={`mini-dial ${preset.color}`}><span>{Math.round(preset.seconds / 60)}</span><small>min</small></div>
        <div className="saved-copy"><p className="eyebrow">{preset.interval ? `Gong every ${preset.interval / 60} min` : `${preset.gongs?.length ?? 0} custom gong${preset.gongs?.length === 1 ? "" : "s"}`}</p><h3>{preset.name}</h3></div>
        <button className="round-play" onClick={() => choosePreset(preset)} aria-label={`Start ${preset.name}`}>→</button>
      </article>)}</div>
      <button className="outline-button"><span>＋</span> Save a new timer</button>
    </div> : <div className="practice-workspace">
      <section className="timer-stage">
        {mode === "Timer" ? <TimerDial value={remaining} total={duration} label="Meditation timer" /> : <div className="stopwatch-display"><span>Stopwatch</span><strong>{formatTime(elapsed, true)}</strong><small>unbounded practice</small></div>}
        <div className="timer-actions">
          <button className="secondary-circle" onClick={() => { if (mode === "Timer") setRemaining(duration); else setElapsed(0); setRunning(false); }} aria-label="Reset">↺</button>
          <button className="start-button" onClick={() => setRunning(!running)}>{running ? "Pause" : mode === "Timer" && remaining < duration ? "Resume" : "Start"}</button>
          <button className="secondary-circle" onClick={mode === "Stopwatch" ? finishStopwatch : () => openReflection(Math.max(1, Math.round((duration - remaining) / 60)))} aria-label="Finish">✓</button>
        </div>
        {mode === "Timer" && <div className="duration-chips" aria-label="Timer duration">{[5, 10, 20, 30, 45].map((mins) => <button className={duration === mins * 60 ? "active" : ""} key={mins} onClick={() => chooseDuration(mins * 60)}>{mins} min</button>)}</div>}
      </section>
      <aside className="timer-settings card">
        <div className="card-heading"><div><p className="eyebrow">Sound</p><h2>Gongs</h2></div><button className="sound-button" onClick={tone}>♪ Try</button></div>
        <button className="setting-row" onClick={() => setGongOpen(!gongOpen)}><span><i className="setting-icon">◎</i><b>Opening & closing</b><small>Deep temple bowl</small></span><em>{gongOpen ? "⌃" : "⌄"}</em></button>
        {gongOpen && <div className="gong-options"><button className="selected">Deep temple bowl <span>✓</span></button><button>Bright singing bowl</button><button>Soft woodblock</button></div>}
        <div className="setting-row"><span><i className="setting-icon">↻</i><b>Repeating gong</b><small>Every {interval} minutes</small></span><label className="toggle"><input type="checkbox" defaultChecked /><span /></label></div>
        <input className="gong-range" type="range" min="1" max="15" value={interval} onChange={(event) => setIntervalMinutes(Number(event.target.value))} aria-label="Repeating gong interval" />
        <div className="setting-row"><span><i className="setting-icon">＋</i><b>Custom gongs</b><small>At 3 and 8 minutes</small></span><button className="mini-action">Edit</button></div>
        <p className="setting-note">Gongs play while this page remains open. Background audio can be added when the native mobile version is connected.</p>
      </aside>
    </div>}
  </section>;
}

function ReflectionModal({ duration, onClose, onSave }: { duration: number; onClose: () => void; onSave: (entry: JournalEntry) => void }) {
  const [type, setType] = useState<ActivityType>("Meditation");
  const [note, setNote] = useState("");
  const [openGroup, setOpenGroup] = useState("Awakening");
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries([...sevenFactors, ...threeCharacteristics, ...fiveHindrances].map((item) => [item, 50])));
  const groups = [{ name: "Awakening", label: "Seven factors of awakening", items: sevenFactors }, { name: "Characteristics", label: "Three characteristics", items: threeCharacteristics }, { name: "Hindrances", label: "Five hindrances", items: fiveHindrances }];
  const save = () => { onSave({ id: Date.now(), type, title: type === "Meditation" ? "Open practice" : `${type} session`, date: "Today · just now", duration, note, mood: "Logged with care" }); onClose(); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="reflection-modal" role="dialog" aria-modal="true" aria-labelledby="reflection-title">
    <header className="modal-header"><div><p className="eyebrow">Practice complete · {duration} min</p><h2 id="reflection-title">How was that?</h2></div><button className="close-button" onClick={onClose} aria-label="Close">×</button></header>
    <div className="activity-picker">{(["Meditation", "Yoga", "Workout", "Other"] as ActivityType[]).map((item) => <button key={item} className={type === item ? "active" : ""} onClick={() => setType(item)}><span>{item === "Meditation" ? "◌" : item === "Yoga" ? "⌁" : item === "Workout" ? "↯" : "＋"}</span>{item}</button>)}</div>
    <div className="assessment-groups">{groups.map((group) => <article className="assessment-group" key={group.name}>
      <button className="assessment-heading" onClick={() => setOpenGroup(openGroup === group.name ? "" : group.name)}><span><small>{group.name === "Awakening" ? "01" : group.name === "Characteristics" ? "02" : "03"}</small><b>{group.label}</b></span><em>{openGroup === group.name ? "−" : "+"}</em></button>
      {openGroup === group.name && <div className="sliders">{group.items.map((item) => <label key={item}><span>{item}<output>{values[item]}</output></span><input type="range" min="0" max="100" value={values[item]} onChange={(event) => setValues({ ...values, [item]: Number(event.target.value) })} /></label>)}</div>}
    </article>)}</div>
    <label className="notes-field"><span>Anything to remember?</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="A thought, a feeling, a tiny shift…" /></label>
    <footer className="modal-footer"><button className="text-button" onClick={save}>Save without reflection</button><button className="primary-button modal-save" onClick={save}>Save practice <span>→</span></button></footer>
  </section></div>;
}

function JournalScreen({ entries, addEntry }: { entries: JournalEntry[]; addEntry: (entry: JournalEntry) => void }) {
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState<number | null>(entries[0]?.id ?? null);
  const [gratitude, setGratitude] = useState("");
  const visible = filter === "All" ? entries : entries.filter((entry) => entry.type === filter);
  const submitGratitude = () => { if (!gratitude.trim()) return; addEntry({ id: Date.now(), type: "Gratitude", title: "A grateful moment", date: "Today · just now", note: gratitude.trim() }); setGratitude(""); };
  return <section className="page journal-page">
    <PageHeader eyebrow="Your living record" title="Journal" action={<button className="header-action">Search <span>⌕</span></button>} />
    <div className="journal-grid">
      <div className="journal-main">
        <div className="filter-row">{["All", "Meditation", "Yoga", "Gratitude", "Period"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
        <div className="month-marker"><span>September 2026</span><i /></div>
        <div className="journal-list">{visible.map((entry) => <article className={`journal-entry card ${expanded === entry.id ? "expanded" : ""}`} key={entry.id}>
          <button className="journal-summary" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
            <span className={`entry-symbol ${entry.type.toLowerCase()}`}>{entry.type === "Meditation" ? "◌" : entry.type === "Yoga" ? "⌁" : entry.type === "Gratitude" ? "✦" : entry.type === "Period" ? "●" : "▤"}</span>
            <span className="entry-copy"><small>{entry.date}</small><b>{entry.title}</b><em>{entry.duration ? `${entry.duration} min` : entry.note?.slice(0, 54)}</em></span>
            <span className={`pill ${entry.type.toLowerCase()}`}>{entry.type}</span><span className="chevron">⌄</span>
          </button>
          {expanded === entry.id && <div className="entry-detail">{entry.mood && <p className="mood-line"><span>Felt</span>{entry.mood}</p>}<p>{entry.note || "Time spent practicing — no reflection added."}</p><button className="text-button">Edit reflection</button></div>}
        </article>)}</div>
      </div>
      <aside className="journal-aside">
        <article className="gratitude-card card"><p className="eyebrow">Daily gratitude</p><h2>What felt quietly good today?</h2><textarea value={gratitude} onChange={(event) => setGratitude(event.target.value)} placeholder="I’m grateful for…" /><button className="primary-button" onClick={submitGratitude}><span>Add to journal</span><span>＋</span></button></article>
        <article className="prompt-card"><span>Journal prompt</span><p>Where did you feel most at home in yourself this week?</p><button onClick={() => setGratitude("I felt most at home when ")}>Reflect →</button></article>
      </aside>
    </div>
  </section>;
}

function WeeklyChart() {
  const data = demoWellnessConnector.weeklyPractice();
  return <div className="weekly-chart" aria-label="Weekly practice minutes chart">{data.map((item) => <div className="bar-column" key={item.day}><div className="bar-stack"><i className="yoga-bar" style={{ height: `${item.yoga * 2}px` }} /><i className="meditation-bar" style={{ height: `${item.meditation * 2}px` }} /></div><span>{item.day}</span></div>)}</div>;
}

function FactorLines() {
  return <div className="factor-lines" aria-label="Seven factors trend chart"><div className="chart-grid"><i /><i /><i /><i /></div><div className="trend trend-a" /><div className="trend trend-b" /><div className="trend trend-c" /></div>;
}

function InsightsScreen({ entries }: { entries: JournalEntry[] }) {
  const practiceEntries = entries.filter((entry) => entry.duration);
  const totalMinutes = practiceEntries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0) + 148;
  return <section className="page insights-page">
    <PageHeader eyebrow="Patterns, not pressure" title="Your wellbeing" action={<button className="header-action">Last 30 days <span>⌄</span></button>} />
    <div className="insight-summary">
      <article><span>Practice time</span><strong>{Math.floor(totalMinutes / 60)}<small>h</small> {totalMinutes % 60}<small>m</small></strong><em>↑ 12% this month</em></article>
      <article><span>Sessions</span><strong>{practiceEntries.length + 9}</strong><em>Across 18 days</em></article>
      <article><span>Current streak</span><strong>7<small> days</small></strong><em>Longest: 14 days</em></article>
      <article><span>Reflections</span><strong>{entries.length + 18}</strong><em>6 this week</em></article>
    </div>
    <div className="insights-grid">
      <article className="chart-card card practice-chart-card"><div className="card-heading"><div><p className="eyebrow">Practice rhythm</p><h2>Minutes this week</h2></div><div className="legend"><span><i className="legend-sage" />Meditation</span><span><i className="legend-gold" />Yoga</span></div></div><WeeklyChart /></article>
      <CycleCard compact />
      <article className="chart-card card factor-card"><div className="card-heading"><div><p className="eyebrow">Reflection patterns</p><h2>Awakening factors</h2></div><button className="quiet-button">•••</button></div><div className="factor-overview"><div><strong>Equanimity</strong><span>Most changed</span></div><b>+18%</b></div><FactorLines /><div className="factor-legend"><span><i />Equanimity</span><span><i />Mindfulness</span><span><i />Energy</span></div></article>
      <article className="body-card card"><p className="eyebrow">Body & cycle</p><h2>How this phase has felt</h2><div className="body-stats"><div><span>Energy</span><b>Steady</b><i style={{ width: "72%" }} /></div><div><span>Sleep</span><b>7h 48m</b><i style={{ width: "82%" }} /></div><div><span>Symptoms</span><b>Light</b><i style={{ width: "34%" }} /></div></div><p className="source-caption"><span>↻</span> Demo data now · Apple Health connector ready later</p></article>
    </div>
  </section>;
}

export default function Home() {
  const [active, setActive] = useState<Screen>("Today");
  const [reflectionDuration, setReflectionDuration] = useState<number | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>(demoWellnessConnector.journal());
  const [toast, setToast] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem("yi-journal");
    if (saved) { try { setEntries(JSON.parse(saved)); } catch { /* keep demo data */ } }
  }, []);
  useEffect(() => { window.localStorage.setItem("yi-journal", JSON.stringify(entries)); }, [entries]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2800); return () => clearTimeout(id); }, [toast]);

  const addEntry = (entry: JournalEntry) => { setEntries((current) => [entry, ...current]); setToast("Saved to your journal"); };
  const screen = useMemo(() => {
    if (active === "Practice") return <PracticeScreen openReflection={setReflectionDuration} />;
    if (active === "Journal") return <JournalScreen entries={entries} addEntry={addEntry} />;
    if (active === "Insights") return <InsightsScreen entries={entries} />;
    return <TodayScreen setActive={setActive} />;
  }, [active, entries]);

  return <main className="app-shell"><Navigation active={active} setActive={setActive} />{screen}{reflectionDuration !== null && <ReflectionModal duration={reflectionDuration} onClose={() => setReflectionDuration(null)} onSave={addEntry} />}{toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}</main>;
}

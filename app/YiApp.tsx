"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import {
  ActivityPreset,
  AssessmentValue,
  CycleDayLog,
  CycleLog,
  fiveFaculties,
  fiveHindrances,
  InsightWidgetId,
  JournalEntry,
  sevenFactors,
  threeCharacteristics,
  TimerPreset,
} from "./data";
import { practiceDefinitions } from "./definitions";
import { dailyQuotes } from "./quotes";
import type { RecordId } from "../src/domain/ids";
import { createRecordId } from "../src/domain/ids";
import type { BookRecord } from "../src/domain/journal/types";
import type { StoredPractice, StoredQuoteRotation } from "../src/domain/practice/types";
import { DISPLAY_TIME_ZONE, MILLISECONDS_PER_DAY, displayDateParts, dateOnlyTimestamp, displayDay, localCalendarDate } from "../src/domain/dates/calendar";
import { cycleSummary, deriveCycleInsights, cycleFieldRecorded, cycleFieldText } from "../src/domain/cycle/calculations";
import { createCycleDraft, updateCycleField, saveCycleDraft } from "../src/domain/cycle/records";
import { localRepository } from "../src/adapters/local/repository";
import { useAppData } from "../src/application/use-app-data";
import { DataTools } from "../src/application/DataTools";
import { reconcileManualHealthRecords, cycleDisplayLog } from "../src/services/health-service";
import { assetUrl } from "../src/platform/runtime";
import type { DataRepository } from "../src/services/repository-contracts";
import { cloudSession } from "../src/application/cloud-runtime";
import { CloudPanel } from "../src/application/CloudPanel";
import { HealthKitTools } from "../src/application/HealthKitTools";

type Screen = "Practice" | "Journal" | "Insights";
type PracticeMode = "Timer" | "Stopwatch" | "Saved";
type ReflectionRequest = { duration: number; type?: string };

const StableNowContext = createContext<number | null>(null);
function useStableNow() {
  const now = useContext(StableNowContext);
  if (now === null) throw new Error("Stable render timestamp is unavailable");
  return now;
}

const quoteListSignature = dailyQuotes.reduce((hash, quote) => {
  for (let index = 0; index < quote.length; index += 1) hash = Math.imul(hash ^ quote.charCodeAt(index), 16777619);
  return hash;
}, 2166136261).toString(36);

function shuffledQuoteOrder() {
  const order = dailyQuotes.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

function validQuoteOrder(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === dailyQuotes.length && new Set(value).size === dailyQuotes.length && value.every((item) => Number.isInteger(item) && item >= 0 && item < dailyQuotes.length);
}

function dailyQuotePosition(day: number) {
  return ((day % dailyQuotes.length) + dailyQuotes.length) % dailyQuotes.length;
}

const navItems: { label: Screen; icon: string }[] = [
  { label: "Insights", icon: "◫" }, { label: "Practice", icon: "◷" }, { label: "Journal", icon: "▤" },
];
const gongNames = ["Gong 1", "Gong 2", "Gong 3", "Tripple Gong"];
const gongSources: Record<string, string> = {
  "Gong 1": "/gong-sounds/gong-1.wav",
  "Gong 2": "/gong-sounds/gong-2.wav",
  "Gong 3": "/gong-sounds/gong-3.wav",
  "Tripple Gong": "/gong-sounds/tripple-gong.wav",
};
const legacyGongNames: Record<string, string> = {
  "Deep temple bowl": "Gong 1",
  "Bright singing bowl": "Gong 2",
  "Soft woodblock": "Gong 3",
  "Gentle bell": "Tripple Gong",
};
function normalizedGongName(gong?: string) { return gong && gongSources[gong] ? gong : legacyGongNames[gong ?? ""] ?? gongNames[0]; }
const assessmentGroups = [
  { name: "Awakening", label: "Seven factors of awakening", items: sevenFactors },
  { name: "Faculties", label: "Five spiritual faculties", items: fiveFaculties },
  { name: "Characteristics", label: "Three characteristics", items: threeCharacteristics },
  { name: "Hindrances", label: "Five hindrances", items: fiveHindrances },
];
const widgetMeta: Record<InsightWidgetId, { title: string; description: string }> = {
  practice: { title: "Practice rhythm", description: "Meditation and yoga minutes" },
  cycle: { title: "Body & cycle", description: "Temperature, mucus, symptoms, sleep and phase" },
  factors: { title: "Awakening factors", description: "Reflection trends over time" },
  faculties: { title: "Spiritual faculties", description: "Faith, energy, mindfulness, concentration and wisdom" },
  characteristics: { title: "Three characteristics", description: "Impermanence, not-self and unsatisfactoriness" },
  hindrances: { title: "Five hindrances", description: "Patterns in what obstructs practice" },
  body: { title: "Body & cycle", description: "Energy, sleep and symptoms" },
  meditation: { title: "Meditation", description: "Sessions, time and consistency" },
  "maintenance-yoga": { title: "Maintenance Yoga", description: "Restorative movement, sessions and time" },
  "workout-yoga": { title: "Work Out Yoga", description: "Strength-focused movement, sessions and time" },
  books: { title: "Books read", description: "Reading history, active books and completion time" },
};
const facultyAssessmentKey = (item: string) => `Faculty: ${item}`;
const assessmentLabel = (item: string) => item.replace(/^Faculty: /, "");
type PatternWidgetId = "factors" | "faculties" | "characteristics" | "hindrances";
const patternWidgetData: Record<PatternWidgetId, { eyebrow: string; title: string; items: string[]; tone: string }> = {
  factors: { eyebrow: "", title: "Awakening factors", items: sevenFactors, tone: "sage" },
  faculties: { eyebrow: "", title: "Five spiritual faculties", items: fiveFaculties.map(facultyAssessmentKey), tone: "plum" },
  characteristics: { eyebrow: "", title: "Three characteristics", items: threeCharacteristics, tone: "gold" },
  hindrances: { eyebrow: "", title: "Five hindrances", items: fiveHindrances, tone: "coral" },
};
const patternColors = ["#8eae9e", "#d78368", "#d7a95f", "#88729a", "#526aa1", "#9a7c88", "#6e8e83"];
type DashboardWidgetId = "cycle" | "practice-start" | "daily-reflection" | "log-activity" | "log-book" | "cycle-checkin" | "daily-quote" | "image-cube" | "quick-reflection" | "quick-prompt" | "lunar" | "timeline" | "summary-time" | "summary-journal" | "summary-days" | `insight-${InsightWidgetId}`;
const defaultDashboardWidgets: DashboardWidgetId[] = [
  "daily-quote", "image-cube", "lunar", "cycle-checkin", "log-activity", "log-book", "quick-reflection", "quick-prompt",
  "summary-time", "summary-journal", "summary-days", "insight-practice", "insight-cycle", "insight-meditation",
  "insight-maintenance-yoga", "insight-workout-yoga", "insight-books", "insight-factors", "insight-faculties", "insight-characteristics", "insight-hindrances",
];
const dashboardWidgetMeta: Record<DashboardWidgetId, { title: string; description: string }> = {
  cycle: { title: "Cycle overview", description: "Phase and next-period estimate" },
  "practice-start": { title: "Start a practice", description: "A direct path into your timer" },
  "daily-reflection": { title: "Daily reflection", description: "Write and save from your dashboard" },
  "log-activity": { title: "Log activity", description: "Meditation, yoga or your own activity" },
  "log-book": { title: "Log new book", description: "Start a book or finish one you have read" },
  "cycle-checkin": { title: "Cycle check-in", description: "Flow, symptoms and temperature" },
  "daily-quote": { title: "Daily quote", description: "A passage from your source document" },
  "image-cube": { title: "Image cube", description: "A rotating collection of personal images" },
  "quick-reflection": { title: "Quick reflection", description: "Open a fresh journal entry" },
  "quick-prompt": { title: "Journal prompt", description: "Begin with a gentle question" },
  lunar: { title: "Lunar phase", description: "The current moon phase and illumination" },
  timeline: { title: "Recent timeline", description: "Your latest journal entries" },
  "summary-time": { title: "Total time practiced", description: "Insight summary" },
  "summary-journal": { title: "Journal entries", description: "Insight summary" },
  "summary-days": { title: "Practice days", description: "Insight summary" },
  "insight-practice": widgetMeta.practice, "insight-cycle": widgetMeta.cycle, "insight-factors": widgetMeta.factors, "insight-faculties": widgetMeta.faculties,
  "insight-characteristics": widgetMeta.characteristics, "insight-hindrances": widgetMeta.hindrances,
  "insight-body": widgetMeta.body, "insight-meditation": widgetMeta.meditation,
  "insight-maintenance-yoga": widgetMeta["maintenance-yoga"], "insight-workout-yoga": widgetMeta["workout-yoga"],
  "insight-books": widgetMeta.books,
};
const retiredDashboardWidgets = new Set<DashboardWidgetId>(["cycle", "practice-start", "daily-reflection", "timeline", "insight-body"]);
const allDashboardWidgets = (Object.keys(dashboardWidgetMeta) as DashboardWidgetId[]).filter((id) => !retiredDashboardWidgets.has(id));
type CubeMedia = { type: "image"; src: string } | { type: "video"; src: string; durationMs: number };
const cubeImages: CubeMedia[] = Array.from({ length: 43 }, (_, index) => ({
  type: "image" as const,
  src: `/cube-media/picture-${String(index + 1).padStart(2, "0")}.jpg`,
}));
const cubeVideo: CubeMedia = { type: "video", src: "/cube-media/wedding.mov", durationMs: 22000 };
const cubeRotationDurations = [3000, 4000, 5000, 6000, 7000, 8000];
const journalPrompts = [
  "Where did you feel most at home in yourself this week?",
  "What are you carrying that you could set down for today?",
  "What did your body ask for today—and did you listen?",
  "Which small moment deserves more of your attention?",
  "What changed when you stopped trying to change the moment?",
  "What would gentleness look like for the rest of this day?",
];
function formatTime(totalSeconds: number, includeHours = false) {
  const seconds = Math.max(0, totalSeconds); const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60); const secs = seconds % 60;
  if (includeHours || hours > 0) return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
function formatPracticeDuration(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes)); const days = Math.floor(minutes / 1440); const hours = Math.floor((minutes % 1440) / 60); const remainder = minutes % 60;
  if (days > 0) return `${days}d${hours ? ` ${hours}h` : ""}${remainder ? ` ${remainder}m` : ""}`;
  if (hours > 0) return `${hours}h${remainder ? ` ${remainder}m` : ""}`;
  return `${remainder} min`;
}

function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function dismissBackdrop(event: React.PointerEvent<HTMLDivElement>, onClose: () => void) { if (event.target === event.currentTarget) onClose(); }

let activeTone: HTMLAudioElement | null = null;

function tone(gong = gongNames[0]) {
  try {
    if (activeTone) {
      activeTone.pause();
      activeTone.currentTime = 0;
    }
    const audio = new Audio(assetUrl(gongSources[normalizedGongName(gong)]));
    activeTone = audio;
    audio.volume = 0.82;
    audio.onended = () => {
      if (activeTone === audio) activeTone = null;
    };
    void audio.play().catch(() => {
      if (activeTone === audio) activeTone = null;
    });
  } catch { /* sound is an enhancement */ }
}

function Navigation({ active, setActive, cloud = false }: { active: Screen; setActive: (screen: Screen) => void; cloud?: boolean }) {
  const items = navItems.map((item) => <button key={item.label} onClick={() => setActive(item.label)} className={active === item.label ? "active" : ""} aria-current={active === item.label ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span></button>);
  return <><aside className="side-rail"><button className="brand-mark" onClick={() => setActive("Insights")} aria-label="Yi insights">yi</button><nav aria-label="Primary navigation">{items}</nav><div className="sync-status"><i />{cloud ? "Private cloud data" : "Saved on this device"}</div></aside><nav className="bottom-nav" aria-label="Primary navigation">{items}</nav></>;
}

function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return <header className="topbar"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{action ?? <button className="avatar" aria-label="Open profile">Y</button>}</header>;
}

function InfoButton({ definitionKey, onOpen }: { definitionKey: string; onOpen: (key: string) => void }) {
  const open = (event: React.SyntheticEvent) => { event.preventDefault(); event.stopPropagation(); onOpen(definitionKey); };
  return <span role="button" tabIndex={0} className="info-button" aria-label={`About ${practiceDefinitions[definitionKey]?.title ?? "this item"}`} onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") open(event); }}><span aria-hidden="true">i</span></span>;
}

function definitionPages(paragraphs: string[], maxWords = 200, maxBlocks = 4) {
  const segments = paragraphs.flatMap((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return [paragraph];
    const chunks: string[] = [];
    for (let index = 0; index < words.length; index += maxWords) chunks.push(words.slice(index, index + maxWords).join(" "));
    return chunks;
  });
  const pages: string[][] = [];
  let page: string[] = [];
  let pageWords = 0;
  segments.forEach((paragraph) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean).length;
    if (page.length && (pageWords + words > maxWords || page.length >= maxBlocks)) { pages.push(page); page = []; pageWords = 0; }
    page.push(paragraph); pageWords += words;
  });
  if (page.length) pages.push(page);
  return pages.length ? pages : [[]];
}

function DefinitionModal({ definitionKey, onClose }: { definitionKey: string; onClose: () => void }) {
  const definition = practiceDefinitions[definitionKey]; const [page, setPage] = useState(0); if (!definition) return null;
  const pages = definitionPages(definition.paragraphs); const currentPage = Math.min(page, Math.max(0, pages.length - 1));
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="definition-modal"><header className="modal-header"><div><p className="eyebrow">Practice glossary</p><h2>{definition.title}</h2></div><button className="close-button" onClick={onClose}>×</button></header><div className="definition-copy">{pages[currentPage].map((paragraph, index) => <p key={`${currentPage}-${index}`}>{paragraph}</p>)}</div><footer className="definition-pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage + 1} / {pages.length}</span><button disabled={currentPage === pages.length - 1} onClick={() => setPage(currentPage + 1)}>→</button></footer></section></div>;
}

function lunarPhase(date: Date) {
  const synodic = 29.530588853; const epoch = Date.UTC(2000, 0, 6, 18, 14); const age = ((date.getTime() - epoch) / 86400000 % synodic + synodic) % synodic;
  const phases = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  const glyphs = ["●", "◔", "◐", "◕", "○", "◕", "◑", "◔"]; const index = Math.round(age / synodic * 8) % 8; const illumination = Math.round((1 - Math.cos(2 * Math.PI * age / synodic)) / 2 * 100); const daysUntilFull = (synodic / 2 - age + synodic) % synodic; const nextFullMoon = new Date(date.getTime() + daysUntilFull * 86400000);
  return { name: phases[index], glyph: glyphs[index], illumination, waxing: age < synodic / 2, age: Math.round(age * 10) / 10, nextFullMoon: nextFullMoon.toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "America/Toronto" }) };
}

function CycleCard({ cycleLog, compact = false, onLog, onExpand }: { cycleLog: CycleLog; compact?: boolean; onLog?: () => void; onExpand?: () => void }) {
  const now = useStableNow(); const cycle = cycleSummary(cycleLog, new Date(now)); const latest = cycleLog.history?.at(-1);
  const latestTemperature = [...(cycleLog.history ?? [])].reverse().find(day => cycleFieldRecorded(day, "temperature") && day.temperature !== undefined);
  return <div className={`cycle-card card ${compact ? "compact" : ""} ${onExpand ? "expandable-widget" : ""}`} role={onExpand ? "button" : undefined} tabIndex={onExpand ? 0 : undefined} onClick={onExpand} onKeyDown={(event) => { if (onExpand && (event.key === "Enter" || event.key === " ")) onExpand(); }}>
    <div className="card-heading"><div><p className="eyebrow">Body & cycle · day {cycle.day}</p><h2>{cycle.phase}</h2></div><div className="card-actions">{onExpand && <button className="expand-button" onClick={(event) => { event.stopPropagation(); onExpand(); }}>Expand ↗</button>}{onLog ? <button className="log-cycle-button" onClick={(event) => { event.stopPropagation(); onLog(); }}>＋ Log</button> : <span className="source-badge">Estimated</span>}</div></div>
    <div className="cycle-content"><div className="cycle-ring" style={{ "--cycle-progress": `${Math.min(100, cycle.day / cycleLog.averageCycle * 100)}%` } as React.CSSProperties}><div><strong>{cycle.day}</strong><span>of {cycleLog.averageCycle}</span></div></div><div className="cycle-copy"><strong>{cycle.day ? `${cycle.nextPeriodIn} days` : "—"}</strong><span>until your next period</span><p>{cycle.fertileText}</p>{cycleLog.temperature && <small>Latest BBT {cycleLog.temperature.toFixed(2)}°C · {latestTemperature?.temperatureSource ?? "manual"}</small>}{latest && <small>{cycleFieldText(latest, "cervicalMucus")} mucus · {latest.sleepMinutes ? `${Math.floor(latest.sleepMinutes / 60)}h ${latest.sleepMinutes % 60}m sleep` : "sleep not logged"}</small>}</div></div>
    <div className="cycle-note"><span>◉</span> Estimates are for awareness only and cannot identify a zero-risk day for pregnancy.</div>
  </div>;
}

function CycleTrackingChart({ history }: { history: CycleDayLog[] }) {
  const points = history; const temps = points.map((item) => item.temperature).filter((value): value is number => typeof value === "number"); const min = Math.min(...temps, 36); const max = Math.max(...temps, 37); const mucusScore: Record<CycleDayLog["cervicalMucus"], number> = { "None / dry": 0, Sticky: 1, Creamy: 2, Watery: 3, "Egg white": 4 };
  const coords = points.map((item, index) => ({ x: points.length === 1 ? 50 : index / Math.max(1, points.length - 1) * 100, y: typeof item.temperature === "number" ? 92 - (item.temperature - min) / Math.max(.1, max - min) * 74 : null }));
  return <div className="cycle-tracking-chart" aria-label="Temperature and cervical mucus history"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><g className="cycle-grid"><line x1="0" x2="100" y1="18" y2="18" /><line x1="0" x2="100" y1="55" y2="55" /><line x1="0" x2="100" y1="92" y2="92" /></g><polyline className="temperature-line" points={coords.filter((point) => point.y !== null).map((point) => `${point.x},${point.y}`).join(" ")} /></svg><div className="cycle-point-layer" aria-hidden="true">{coords.map((point, index) => point.y === null ? null : <i key={points[index].id} className={`cycle-point ${points[index].questionableTemperature ? "questionable" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}</div><div className="mucus-track">{points.map((item) => <i key={item.id} title={`${item.date}: ${item.cervicalMucus}`} style={{ height: `${cycleFieldRecorded(item, "cervicalMucus") ? 5 + mucusScore[item.cervicalMucus] * 6 : 0}px` }} />)}</div><div className="cycle-chart-legend"><span><i />Temperature</span><span><i />Cervical mucus</span></div>{points.length === 0 && <div className="chart-empty"><b>No cycle observations yet</b><small>Save a check-in to begin this chart.</small></div>}</div>;
}

function ArtCube() {
  const [faces, setFaces] = useState<CubeMedia[]>([]);
  const [ready, setReady] = useState(false);
  const mediaOrder = useRef<CubeMedia[]>([]);
  const decodedImages = useRef(new Map<string, HTMLImageElement>());
  const nextMedia = useRef(6);
  const faceTimers = useRef<Array<number | null>>(Array(6).fill(null));
  const advanceFaceRef = useRef<((faceIndex: number) => void) | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let cancelled = false;
    const preloadImage = async (media: CubeMedia): Promise<CubeMedia | null> => {
      if (media.type !== "image") return null;
      const image = new window.Image();
      image.decoding = "async";
      const loaded = await new Promise<boolean>((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = assetUrl(media.src);
        if (image.complete) resolve(image.naturalWidth > 0);
      });
      if (!loaded) return null;
      try {
        await image.decode();
      } catch {
        if (!image.complete || image.naturalWidth === 0) return null;
      }
      if (image.naturalWidth === 0) return null;
      decodedImages.current.set(media.src, image);
      return media;
    };

    const preloadMedia = async () => {
      const loadedImages: CubeMedia[] = [];
      for (let index = 0; index < cubeImages.length; index += 15) {
        const batch = cubeImages.slice(index, index + 15);
        const loadedBatch = await Promise.all(batch.map(async (media) => {
        try {
          return await preloadImage(media);
        } catch {
          return null;
        }
        }));
        loadedImages.push(...loadedBatch.filter((media): media is CubeMedia => media !== null));
        if (cancelled) return;
      }

      let videoLoaded = false;
      if (typeof document !== "undefined") {
        try {
          const video = document.createElement("video");
          video.preload = "auto";
          video.muted = true;
          video.playsInline = true;
          videoLoaded = await new Promise<boolean>((resolve) => {
            video.onloadeddata = () => resolve(true);
            video.onerror = () => resolve(false);
            video.src = assetUrl(cubeVideo.src);
            video.load();
          });
        } catch {
          videoLoaded = false;
        }
      }

      if (!cancelled && loadedImages.length > 0) {
        mediaOrder.current = [...loadedImages];
        if (videoLoaded) mediaOrder.current.push(cubeVideo);
        setReady(true);
      }
    };

    void preloadMedia();
    return () => {
      cancelled = true;
      faceTimers.current.forEach((timer) => {
        if (timer !== null) window.clearTimeout(timer);
      });
    };
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;

    const shuffle = () => {
      const shuffled: CubeMedia[] = [...mediaOrder.current.filter((media) => media.type === "image")];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
      }
      const video = mediaOrder.current.find((media) => media.type === "video");
      if (video) shuffled.push(video);
      mediaOrder.current = shuffled;
    };
    shuffle();
    const initialFaces = Array.from({ length: 6 }, (_, index) => mediaOrder.current[index % mediaOrder.current.length]);
    setFaces(initialFaces);
    nextMedia.current = 6 % mediaOrder.current.length;

    const advanceFace = (faceIndex: number) => {
      if (nextMedia.current >= mediaOrder.current.length) {
        shuffle();
        nextMedia.current = 0;
      }
      const next = mediaOrder.current[nextMedia.current];
      setFaces((current) => current.map((media, index) => index === faceIndex ? next : media));
      nextMedia.current += 1;
      if (next.type === "image") {
        faceTimers.current[faceIndex] = window.setTimeout(
          () => advanceFace(faceIndex),
          cubeRotationDurations[faceIndex],
        );
      }
    };

    advanceFaceRef.current = advanceFace;
    faceTimers.current = cubeRotationDurations.map((duration, faceIndex) =>
      window.setTimeout(() => advanceFace(faceIndex), duration),
    );
    return () => {
      faceTimers.current.forEach((timer) => {
        if (timer !== null) window.clearTimeout(timer);
      });
    };
  }, [ready]);

  return <div className="cube-scene" aria-label="Rotating cube of personal photos"><div className="art-cube">{faces.map((media, index) => {
    const imageSrc = media?.type === "image" ? media.src : "/cube-media/picture-01.jpg";
    return <div className={`cube-face face-${index + 1}`} key={`${index}-${media?.type ?? "empty"}-${media?.src ?? "fallback"}`} style={{ backgroundImage: `url("${assetUrl(imageSrc)}")` }}>
      {media?.type === "video" && <video src={assetUrl(media.src)} poster={assetUrl("/cube-media/picture-01.jpg")} autoPlay muted playsInline style={{ visibility: "hidden" }} onPlaying={(event) => { event.currentTarget.style.visibility = "visible"; }} onWaiting={(event) => { event.currentTarget.style.visibility = "hidden"; }} onEnded={() => advanceFaceRef.current?.(index)} onError={(event) => { event.currentTarget.style.display = "none"; advanceFaceRef.current?.(index); }} />}
    </div>;
  })}</div></div>;
}

function InsightSummaryCard({ id, entries, onOpen }: { id: Extract<DashboardWidgetId, `summary-${string}`>; entries: JournalEntry[]; onOpen?: () => void }) {
  const now = useStableNow(); const practiced = entries.filter((entry) => entry.duration); const total = practiced.reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const meditation = practiced.filter((entry) => entry.type === "Meditation").reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const maintenanceYoga = practiced.filter((entry) => entry.type === "Maintenance Yoga").reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const workoutYoga = practiced.filter((entry) => entry.type === "Work Out Yoga").reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const practiceDays = new Set(practiced.map((entry) => new Date(entryTimestamp(entry, now)).toLocaleDateString("en-CA", { timeZone: DISPLAY_TIME_ZONE }))).size;
  if (id === "summary-time") return <button type="button" className="practice-total-summary" aria-haspopup={onOpen ? "dialog" : undefined} onClick={onOpen}><span>Total time practiced</span><strong>{formatPracticeDuration(total)}</strong><div className="practice-category-grid"><span title="Meditation"><i className="calendar-dot meditation" /><em>{formatPracticeDuration(meditation)}</em><b>Meditation</b></span><span title="Maintenance Yoga"><i className="calendar-dot maintenance-yoga" /><em>{formatPracticeDuration(maintenanceYoga)}</em><b>Maintenance Yoga</b></span><span title="Work Out Yoga"><i className="calendar-dot workout-yoga" /><em>{formatPracticeDuration(workoutYoga)}</em><b>Work Out Yoga</b></span></div></button>;
  const copy = {
    "summary-journal": ["Total journal entries", <>{entries.length}</>, `${entries.filter((entry) => entry.note).length} with notes`],
    "summary-days": ["Practiced at least once", <>{practiceDays}<small> days</small></>, "Across saved entries"],
  }[id];
  return <article className="dashboard-summary"><span>{copy[0]}</span><strong>{copy[1]}</strong><em>{copy[2]}</em></article>;
}

function InsightWidgetCard({ id, entries, cycleLog, onExpand }: { id: InsightWidgetId; entries: JournalEntry[]; cycleLog: CycleLog; onExpand?: (id: InsightWidgetId) => void }) {
  const now = useStableNow(); const [range, setRange] = useState("7d"); const [definition, setDefinition] = useState<string | null>(null); const ranges = ["7d", "30d", "90d", "1yr", "All"]; const openWidget = onExpand ? () => onExpand(id) : undefined; const expand = onExpand && <button className="expand-button" onClick={(event) => { event.stopPropagation(); onExpand(id); }}>Expand ↗</button>;
  if (id === "practice") return <div className="chart-card card practice-chart-card expandable-widget" role="button" tabIndex={0} onClick={openWidget} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWidget?.(); }}><div className="card-heading"><div><p className="eyebrow">Practice rhythm</p><h2>Logged minutes</h2></div>{expand}</div><div className="range-tabs compact-ranges" style={{ "--range-offset": `${ranges.indexOf(range) * 100}%` } as React.CSSProperties}>{ranges.map((item) => <button key={item} className={range === item ? "active" : ""} onClick={(event) => { event.stopPropagation(); setRange(item); }}>{item}</button>)}</div><div className="legend"><span><i />Meditation</span><span><i className="legend-gold" />Maintenance Yoga</span><span><i className="legend-coral" />Work Out Yoga</span></div><PracticeRhythmChart entries={entries} range={range} /></div>;
  if (id === "cycle") return <CycleCard cycleLog={cycleLog} compact onExpand={onExpand ? () => onExpand(id) : undefined} />;
  if (id === "factors" || id === "faculties" || id === "characteristics" || id === "hindrances") { const pattern = patternWidgetData[id]; const summary = patternSummary(entries, pattern.items, now); const group = id === "factors" ? "Awakening" : id === "faculties" ? "Faculties" : id === "characteristics" ? "Characteristics" : "Hindrances"; return <><div className={`chart-card card factor-card pattern-${pattern.tone} expandable-widget`} role="button" tabIndex={0} onClick={openWidget} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWidget?.(); }}><div className="card-heading"><div><p className="eyebrow">{pattern.eyebrow}</p><h2 className="title-with-info">{pattern.title}<InfoButton definitionKey={`group:${group}`} onOpen={setDefinition} /></h2></div>{expand}</div><div className="range-tabs compact-ranges" style={{ "--range-offset": `${ranges.indexOf(range) * 100}%` } as React.CSSProperties}>{ranges.map((item) => <button key={item} className={range === item ? "active" : ""} onClick={(event) => { event.stopPropagation(); setRange(item); }}>{item}</button>)}</div><div className="factor-overview"><div><strong>{assessmentLabel(summary.highlight)}</strong><span>{summary.detail}</span></div><b>{summary.change}</b></div><AssessmentPatternChart entries={entries} items={pattern.items} range={range} /><div className="factor-legend">{pattern.items.map((item, index) => <span key={item}><i style={{ background: patternColors[index % patternColors.length] }} />{assessmentLabel(item)}<InfoButton definitionKey={`${group}:${assessmentLabel(item)}`} onOpen={setDefinition} /></span>)}</div><p className="source-caption"><span>↻</span> Each saved slider check-in becomes a point</p></div>{definition && <DefinitionModal definitionKey={definition} onClose={() => setDefinition(null)} />}</>; }
  if (id === "body") {
    const days = [...cycleLog.history].reverse();
    const temperature = days.find(day => cycleFieldRecorded(day, "temperature") && day.temperature !== undefined);
    const mucus = days.find(day => cycleFieldRecorded(day, "cervicalMucus"));
    const flow = days.find(day => cycleFieldRecorded(day, "flow"));
    return <article className="body-card card"><p className="eyebrow">Body & cycle</p><div className="card-heading"><h2>Latest recorded observations</h2>{expand}</div><div className="body-stats"><div><span>Basal temperature</span><b>{temperature?.temperature !== undefined ? `${temperature.temperature.toFixed(2)}°C` : "—"}</b></div><div><span>Cervical mucus</span><b>{cycleFieldText(mucus, "cervicalMucus")}</b></div><div><span>Menstrual flow</span><b>{cycleFieldText(flow, "flow")}</b></div></div><p className="source-caption"><span>↻</span> Selected saved observations · expand for history</p></article>;
  }
  const type = insightActivityType(id) ?? "Meditation"; const typeEntries = activityHistory(entries, type, range, now); const mins = typeEntries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const longest = Math.max(0, ...typeEntries.map((entry) => entry.duration ?? 0));
  return <div className={`activity-stat-card card ${id} expandable-widget`} role="button" tabIndex={0} onClick={openWidget} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWidget?.(); }}><div className="card-heading"><div><p className="eyebrow">{type} analytics</p><h2>{type}</h2></div>{expand}</div><div className="range-tabs compact-ranges" style={{ "--range-offset": `${ranges.indexOf(range) * 100}%` } as React.CSSProperties}>{ranges.map((item) => <button key={item} className={range === item ? "active" : ""} onClick={(event) => { event.stopPropagation(); setRange(item); }}>{item}</button>)}</div><div className="activity-stat-main"><strong>{typeEntries.length}</strong><span>sessions</span><b>{mins} min</b></div><ActivityHistoryChart entries={entries} type={type} range={range} limit={7} /><p>{typeEntries.length ? `${Math.round(mins / typeEntries.length)} min average · ${longest} min longest` : `Your logged ${type.toLowerCase()} sessions will appear here.`}</p></div>;
}

function widgetCategory(id: DashboardWidgetId) { if (id.startsWith("insight-")) return "Analytics"; if (id.startsWith("summary-")) return "Summaries"; return "Daily tools"; }

function BookAnalyticsCard({ books, onExpand, onLog }: { books: BookRecord[]; onExpand?: () => void; onLog?: () => void }) {
  const now = useStableNow(); const [range, setRange] = useState("1yr"); const ranges = ["7d", "30d", "90d", "1yr", "All"]; const cutoff = rangeCutoff(range, now); const dated = books.filter((book) => { if (!book.startedOn && !book.finishedOn) return false; const start = book.startedOn ? dateOnlyTimestamp(book.startedOn) : 0; const end = book.finishedOn ? dateOnlyTimestamp(book.finishedOn) : now; return !cutoff || end >= cutoff || start >= cutoff; }); const times = dated.flatMap((book) => [book.startedOn, book.finishedOn].filter((value): value is string => typeof value === "string").map((value) => dateOnlyTimestamp(value))); const min = cutoff || (times.length ? Math.min(...times) : now); const max = times.length ? Math.max(...times, now) : now + 1; const span = Math.max(MILLISECONDS_PER_DAY, max - min);
  // The card remains fully keyboard accessible through its explicit Expand button.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  return <article className={`book-analytics-card card ${onExpand ? "expandable-widget" : ""}`} role={onExpand ? "button" : undefined} tabIndex={onExpand ? 0 : undefined} onClick={onExpand} onKeyDown={(event) => { if (onExpand && (event.key === "Enter" || event.key === " ")) onExpand(); }}><div className="card-heading"><div><p className="eyebrow">Reading life</p><h2>Books read</h2></div><div className="card-actions">{onLog && <button className="log-book-button" onClick={(event) => { event.stopPropagation(); onLog(); }}>＋ Log book</button>}{onExpand && <button className="expand-button" onClick={(event) => { event.stopPropagation(); onExpand(); }}>Expand ↗</button>}</div></div><div className="range-tabs compact-ranges" style={{ "--range-offset": `${ranges.indexOf(range) * 100}%` } as React.CSSProperties}>{ranges.map((item) => <button key={item} className={range === item ? "active" : ""} onClick={(event) => { event.stopPropagation(); setRange(item); }}>{item}</button>)}</div><div className="book-timeline">{dated.slice(-8).map((book, index) => { const start = book.startedOn ? Math.max(min, dateOnlyTimestamp(book.startedOn)) : book.finishedOn ? dateOnlyTimestamp(book.finishedOn) : min; const end = book.finishedOn ? dateOnlyTimestamp(book.finishedOn) : now; return <div key={book.id}><span>{book.title}</span><i><em style={{ "--book-color": patternColors[index % patternColors.length], marginLeft: `${Math.max(0, (start - min) / span * 100)}%`, width: `${Math.max(3, (end - start) / span * 100)}%` } as React.CSSProperties} /></i></div>; })}{dated.length === 0 && <p>No dated books overlap this range.</p>}</div><div className="book-list">{books.slice(-4).reverse().map((book) => <div key={book.id}><span><b>{book.title}</b><small>{book.author || (book.finished ? "Finished" : "In progress")}</small></span><em>{book.finishedOn ? new Date(dateOnlyTimestamp(book.finishedOn)).toLocaleDateString("en-CA", { month: "short", year: "numeric", timeZone: DISPLAY_TIME_ZONE }) : book.yearRead || (book.finished ? "Finished" : "Reading")}</em></div>)}</div></article>;
}

function BookLogModal({ books, onSave, onClose }: { books: BookRecord[]; onSave: (book: BookRecord) => void; onClose: () => void }) {
  const [step, setStep] = useState<"choose" | "start" | "finish" | "congrats">("choose"); const [selected, setSelected] = useState<RecordId | null>(null); const [title, setTitle] = useState(""); const [author, setAuthor] = useState(""); const [startedOn, setStartedOn] = useState(() => new Date().toLocaleDateString("en-CA")); const [finishedOn, setFinishedOn] = useState(""); const [yearRead, setYearRead] = useState<number | "">(""); const [draft, setDraft] = useState<BookRecord | null>(null); const [assessments, setAssessments] = useState<Record<string, AssessmentValue>>(() => makeAssessments()); const [assessmentActive, setAssessmentActive] = useState(false); const activeBooks = books.filter((book) => book.startedOn && !book.finished);
  const chooseBook = (value: RecordId) => { setSelected(value); if (value !== "manual") { const book = books.find((item) => item.id === value); if (book) { setTitle(book.title); setAuthor(book.author ?? ""); setStartedOn(book.startedOn ?? ""); } } else { setTitle(""); setAuthor(""); setStartedOn(""); } };
  const finishBook = () => { if (!title.trim()) return; const existing = selected !== "manual" && selected !== null ? books.find((book) => book.id === selected) : undefined; const book: BookRecord = { ...existing, id: existing?.id ?? createRecordId(), title: title.trim(), author: author.trim() || undefined, startedOn: startedOn || undefined, finishedOn: finishedOn || undefined, yearRead: yearRead || (finishedOn ? new Date(`${finishedOn}T12:00:00`).getFullYear() : undefined), finished: true }; setDraft(book); setStep("congrats"); };
  // Focusing the title is intentional when the user explicitly opens the start-book flow.
  // eslint-disable-next-line jsx-a11y/no-autofocus
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="builder-modal book-log-modal"><header className="modal-header"><div><p className="eyebrow">Reading journal</p><h2>{step === "choose" ? "Log a book" : step === "start" ? "Start a book" : step === "finish" ? "Finish a book" : `Congratulations on finishing ${draft?.title}`}</h2></div><button className="close-button" onClick={onClose}>×</button></header>{step === "choose" && <div className="book-choice"><button onClick={() => setStep("start")}><span>＋</span><b>Start a book</b><small>Add it to your currently reading list</small></button><button onClick={() => setStep("finish")}><span>✓</span><b>Finish a book</b><small>Choose an active book or add past reading</small></button></div>}{step === "start" && <><label className="builder-name">Book title<input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></label><div className="field-pair"><label>Author<input value={author} onChange={(event) => setAuthor(event.target.value)} /></label><label>Started<input type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} /></label></div><button className="primary-button" disabled={!title.trim()} onClick={() => { onSave({ id: createRecordId(), title: title.trim(), author: author.trim() || undefined, startedOn: startedOn || undefined }); onClose(); }}><span>Save as currently reading</span><span>→</span></button></>}{step === "finish" && <><p className="modal-intro">Choose any book you have started. More than one book can stay in progress at once.</p><div className="active-book-options">{activeBooks.map((book) => <button className={selected === book.id ? "active" : ""} onClick={() => chooseBook(book.id)} key={book.id}><b>{book.title}</b><small>{book.author || "Author not added"}</small></button>)}<button className={selected === "manual" ? "active" : ""} onClick={() => chooseBook("manual")}><b>A book not listed</b><small>Add something read before using Yi</small></button></div>{selected !== null && <><label className="builder-name">Book title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="field-pair"><label>Author<input value={author} onChange={(event) => setAuthor(event.target.value)} /></label><label>Started (optional)<input type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} /></label><label>Finished (optional)<input type="date" value={finishedOn} onChange={(event) => setFinishedOn(event.target.value)} /></label><label>Year read (if date is unknown)<input type="number" min="1000" max="2100" value={yearRead} onChange={(event) => setYearRead(event.target.value ? Number(event.target.value) : "")} /></label></div><button className="primary-button" disabled={!title.trim()} onClick={finishBook}><span>Finish book</span><span>✓</span></button></>}</>}{step === "congrats" && draft && <><p className="book-congrats">You finished <b>{draft.title}</b>. Capture any qualities or obstacles the book brought into view.</p><AssessmentEditor assessments={assessments} setAssessments={setAssessments} active={assessmentActive} setActive={setAssessmentActive} /><button className="primary-button" onClick={() => { const savedAssessments = loggedAssessments(assessments); onSave({ ...draft, assessments: Object.keys(savedAssessments).length ? savedAssessments : undefined }); onClose(); }}><span>Save finished book</span><span>→</span></button></>}</section></div>;
}

function AddDashboardWidgetModal({ current, renderPreview, onAdd, onClose }: { current: DashboardWidgetId[]; renderPreview: (id: DashboardWidgetId) => React.ReactNode; onAdd: (id: DashboardWidgetId) => void; onClose: () => void }) {
  const [category, setCategory] = useState("All"); const available = allDashboardWidgets.filter((id) => !current.includes(id) && (category === "All" || widgetCategory(id) === category));
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="builder-modal customize-modal widget-archive"><header className="modal-header"><div><p className="eyebrow">Widget archive</p><h2>See it before you add it</h2></div><button className="close-button" onClick={onClose}>×</button></header><div className="archive-toolbar"><p className="modal-intro">Browse full-size previews by category.</p><label>View<select value={category} onChange={(event) => setCategory(event.target.value)}>{["All", "Daily tools", "Summaries", "Analytics"].map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="archive-widget-list">{available.map((id) => <article className="archive-widget" key={id}><header><span><b>{dashboardWidgetMeta[id].title}</b><small>{widgetCategory(id)} · {dashboardWidgetMeta[id].description}</small></span><button onClick={() => onAdd(id)}>＋ Add</button></header><div className="archive-preview">{renderPreview(id)}</div></article>)}{available.length === 0 && <p className="empty-widget-list">No archived widgets match this view.</p>}</div><footer className="modal-footer"><button className="primary-button modal-save" onClick={onClose}><span>Done</span><span>✓</span></button></footer></section></div>;
}

function TodayScreen({ setActive, entries, cycleLog, onCycleLog, openReflection, widgets, setWidgets, addEntry, books, setBooks }: { setActive: (screen: Screen) => void; entries: JournalEntry[]; cycleLog: CycleLog; onCycleLog: () => void; openReflection: (request: ReflectionRequest) => void; widgets: DashboardWidgetId[]; setWidgets: React.Dispatch<React.SetStateAction<DashboardWidgetId[]>>; addEntry: (entry: JournalEntry) => void; books: BookRecord[]; setBooks: React.Dispatch<React.SetStateAction<BookRecord[]>> }) {
  const now = useStableNow(); const [quoteOrder, setQuoteOrder] = useState(() => dailyQuotes.map((_, index) => index)); const [quotePosition, setQuotePosition] = useState(0); const [quoteDay, setQuoteDay] = useState(() => displayDay(now)); const [quoteReady, setQuoteReady] = useState(false); const [editing, setEditing] = useState(false); const [adding, setAdding] = useState(false); const [expanded, setExpanded] = useState<InsightWidgetId | null>(null); const [timePracticedOpen, setTimePracticedOpen] = useState(false); const [booksExpanded, setBooksExpanded] = useState(false); const [bookLogOpen, setBookLogOpen] = useState(false); const [dragging, setDragging] = useState<DashboardWidgetId | null>(null); const [reflection, setReflection] = useState("");
  const todayLabel = new Date(now).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: DISPLAY_TIME_ZONE });
  const holdTimer = useRef<number | null>(null); const pointerStart = useRef({ x: 0, y: 0 }); const draggingRef = useRef<DashboardWidgetId | null>(null); const dashboardRef = useRef<HTMLDivElement | null>(null); const dragOffset = useRef({ x: 0, y: 0 }); const grabOffset = useRef({ x: 0, y: 0 }); const lastPointer = useRef({ x: 0, y: 0 }); const reorderKey = useRef<string | null>(null); const edgeScrollFrame = useRef<number | null>(null); const recent = entries.slice(0, 2); const quoteIndex = quoteOrder[quotePosition] ?? 0;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentDay = displayDay(Date.now());
      let order = shuffledQuoteOrder();
      let position = dailyQuotePosition(currentDay);
      try {
        const saved = localRepository.loadQuote();
        if (saved?.signature === quoteListSignature && validQuoteOrder(saved.order)) {
          order = saved.order;
          if (saved.day === currentDay && Number.isInteger(saved.position) && saved.position >= 0 && saved.position < dailyQuotes.length) position = saved.position;
        }
      } catch { /* start a fresh rotation when storage is unavailable or invalid */ }
      setQuoteOrder(order); setQuotePosition(position); setQuoteDay(currentDay); setQuoteReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!quoteReady) return;
    try { localRepository.saveQuote({ signature: quoteListSignature, order: quoteOrder, day: quoteDay, position: quotePosition } satisfies StoredQuoteRotation); } catch { /* quote rotation can remain in memory */ }
  }, [quoteReady, quoteOrder, quoteDay, quotePosition]);
  useEffect(() => {
    if (!quoteReady) return;
    const updateDay = () => { const currentDay = displayDay(Date.now()); if (currentDay !== quoteDay) { setQuoteDay(currentDay); setQuotePosition(dailyQuotePosition(currentDay)); } };
    const timer = window.setInterval(updateDay, 60000); return () => window.clearInterval(timer);
  }, [quoteReady, quoteDay]);
  const cancelHold = () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = null; };
  const widgetNode = (id: DashboardWidgetId) => dashboardRef.current?.querySelector<HTMLElement>(`[data-dashboard-widget="${id}"]`) ?? null;
  const positionDragged = (clientX: number, clientY: number) => { const id = draggingRef.current; if (!id) return; const node = widgetNode(id); if (!node) return; const rect = node.getBoundingClientRect(); const baseLeft = rect.left - dragOffset.current.x; const baseTop = rect.top - dragOffset.current.y; const next = { x: clientX - grabOffset.current.x - baseLeft, y: clientY - grabOffset.current.y - baseTop }; dragOffset.current = next; node.style.setProperty("--drag-x", `${next.x}px`); node.style.setProperty("--drag-y", `${next.y}px`); };
  const beginDrag = (id: DashboardWidgetId, node: HTMLElement, clientX: number, clientY: number) => { const rect = node.getBoundingClientRect(); draggingRef.current = id; dragOffset.current = { x: 0, y: 0 }; grabOffset.current = { x: clientX - rect.left, y: clientY - rect.top }; lastPointer.current = { x: clientX, y: clientY }; reorderKey.current = null; node.style.setProperty("--drag-x", "0px"); node.style.setProperty("--drag-y", "0px"); setDragging(id); };
  const reorder = (from: DashboardWidgetId, to: DashboardWidgetId, after: boolean) => { const before = new Map<DashboardWidgetId, DOMRect>(); dashboardRef.current?.querySelectorAll<HTMLElement>("[data-dashboard-widget]").forEach((node) => before.set(node.dataset.dashboardWidget as DashboardWidgetId, node.getBoundingClientRect())); flushSync(() => setWidgets((current) => { const next = current.filter((id) => id !== from); const targetIndex = next.indexOf(to); if (targetIndex < 0) return current; next.splice(targetIndex + (after ? 1 : 0), 0, from); return next; })); window.requestAnimationFrame(() => { dashboardRef.current?.querySelectorAll<HTMLElement>("[data-dashboard-widget]").forEach((node) => { const id = node.dataset.dashboardWidget as DashboardWidgetId; if (id === from) return; const first = before.get(id); const last = node.getBoundingClientRect(); if (!first) return; const x = first.left - last.left; const y = first.top - last.top; if (Math.abs(x) < 1 && Math.abs(y) < 1) return; node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }); }); positionDragged(lastPointer.current.x, lastPointer.current.y); }); };
  const reorderAtPointer = (from: DashboardWidgetId, clientX: number, clientY: number) => { const candidates = [...(dashboardRef.current?.querySelectorAll<HTMLElement>("[data-dashboard-widget]") ?? [])].filter((node) => node.dataset.dashboardWidget !== from); if (!candidates.length) return; const direct = document.elementsFromPoint(clientX, clientY).map((element) => element.closest<HTMLElement>("[data-dashboard-widget]")).find((node) => node && node.dataset.dashboardWidget !== from); const targetNode = direct ?? candidates.reduce((closest, node) => { const rect = node.getBoundingClientRect(); const closestRect = closest.getBoundingClientRect(); const distance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2)); const closestDistance = Math.hypot(clientX - (closestRect.left + closestRect.width / 2), clientY - (closestRect.top + closestRect.height / 2)); return distance < closestDistance ? node : closest; }); const rect = targetNode.getBoundingClientRect(); const sameRow = clientY >= rect.top && clientY <= rect.bottom; const after = sameRow ? clientX > rect.left + rect.width / 2 : clientY > rect.top + rect.height / 2; const key = `${targetNode.dataset.dashboardWidget}:${after ? "after" : "before"}`; if (reorderKey.current === key) return; reorderKey.current = key; reorder(from, targetNode.dataset.dashboardWidget as DashboardWidgetId, after); };
  const endDrag = () => { cancelHold(); const id = draggingRef.current; const node = id ? widgetNode(id) : null; if (node) { const transform = getComputedStyle(node).transform; node.style.removeProperty("--drag-x"); node.style.removeProperty("--drag-y"); node.animate([{ transform }, { transform: "translate(0, 0) scale(1)" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }); } dragOffset.current = { x: 0, y: 0 }; reorderKey.current = null; draggingRef.current = null; setDragging(null); };
  useEffect(() => {
    if (!editing || !dragging) return;
    const move = (clientX: number, clientY: number) => { const from = draggingRef.current; if (!from) return; lastPointer.current = { x: clientX, y: clientY }; positionDragged(clientX, clientY); reorderAtPointer(from, clientX, clientY); };
    const onPointerMove = (event: PointerEvent) => move(event.clientX, event.clientY);
    const onPointerUp = () => { if (draggingRef.current) endDrag(); };
    const edge = 84;
    const autoScroll = () => {
      if (!draggingRef.current) return;
      const y = lastPointer.current.y; const distanceFromTop = edge - y; const distanceFromBottom = y - (window.innerHeight - edge); const delta = distanceFromTop > 0 ? -Math.min(24, Math.max(4, distanceFromTop * .42)) : distanceFromBottom > 0 ? Math.min(24, Math.max(4, distanceFromBottom * .42)) : 0;
      if (delta) { window.scrollBy({ top: delta, behavior: "auto" }); move(lastPointer.current.x, lastPointer.current.y); }
      edgeScrollFrame.current = window.requestAnimationFrame(autoScroll);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true }); window.addEventListener("pointerup", onPointerUp, { passive: true }); window.addEventListener("pointercancel", onPointerUp, { passive: true }); edgeScrollFrame.current = window.requestAnimationFrame(autoScroll);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); window.removeEventListener("pointercancel", onPointerUp); if (edgeScrollFrame.current !== null) window.cancelAnimationFrame(edgeScrollFrame.current); edgeScrollFrame.current = null; };
    // These handlers intentionally follow the active drag session rather than render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, dragging]);
  const renderWidget = (id: DashboardWidgetId) => {
    if (id.startsWith("summary-")) return <InsightSummaryCard id={id as Extract<DashboardWidgetId, `summary-${string}`>} entries={entries} onOpen={id === "summary-time" ? () => setTimePracticedOpen(true) : undefined} />;
    if (id === "insight-books") return <BookAnalyticsCard books={books} onLog={() => setBookLogOpen(true)} onExpand={() => setBooksExpanded(true)} />;
    if (id.startsWith("insight-")) return <InsightWidgetCard id={id.replace("insight-", "") as InsightWidgetId} entries={entries} cycleLog={cycleLog} onExpand={setExpanded} />;
    if (id === "cycle") return <CycleCard cycleLog={cycleLog} onLog={onCycleLog} />;
    if (id === "practice-start") return <article className="practice-card card"><div><p className="eyebrow">Practice room</p><h2>Make a little space</h2><p>Choose a recommended rhythm or create a timer that is entirely your own.</p></div><button className="primary-button" onClick={() => setActive("Practice")}><span>Begin practice</span><span>→</span></button></article>;
    if (id === "daily-reflection") return <article className="daily-reflection-card card"><p className="eyebrow">Daily reflection</p><h2>What is worth remembering?</h2><textarea value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="Write a few honest lines…" /><button className="primary-button" disabled={!reflection.trim()} onClick={() => { addEntry({ id: createRecordId(), type: "Journal", title: "Daily reflection", date: "Today · just now", note: reflection.trim() }); setReflection(""); }}><span>Save reflection</span><span>＋</span></button></article>;
    if (id === "log-activity") return <button className="shortcut-card dashboard-shortcut blue" onClick={() => openReflection({ duration: 0 })}><span>◌</span><b>Log activity</b><small>Meditation, yoga or your own</small></button>;
    if (id === "log-book") return <button className="shortcut-card dashboard-shortcut book" onClick={() => setBookLogOpen(true)}><span>▥</span><b>Log new book</b><small>Start reading or mark a book finished</small></button>;
    if (id === "cycle-checkin") return <button className="shortcut-card dashboard-shortcut coral" onClick={onCycleLog}><span>●</span><b>Cycle check-in</b><small>Flow, symptoms and temperature</small></button>;
    if (id === "daily-quote") return <article className="daily-quote-card card"><div className="card-heading"><p className="eyebrow">Daily quote</p><span className="quote-count">{quotePosition + 1} / {dailyQuotes.length}</span></div><p>“{dailyQuotes[quoteIndex]}”</p><div className="quote-actions"><button aria-label="Previous quote" onClick={() => setQuotePosition((quotePosition - 1 + dailyQuotes.length) % dailyQuotes.length)}>←</button><button aria-label="Next quote" onClick={() => setQuotePosition((quotePosition + 1) % dailyQuotes.length)}>→</button></div></article>;
    if (id === "image-cube") return <article className="image-cube-card card"><ArtCube /></article>;
    if (id === "quick-reflection") return <button className="shortcut-card dashboard-shortcut sage" onClick={() => { setActive("Journal"); window.dispatchEvent(new CustomEvent("yi-journal-compose", { detail: "reflection" })); }}><span>✎</span><b>Quick reflection</b><small>Open a fresh journal entry</small></button>;
    if (id === "quick-prompt") return <button className="shortcut-card dashboard-shortcut plum" onClick={() => { setActive("Journal"); window.dispatchEvent(new CustomEvent("yi-journal-compose", { detail: "prompt" })); }}><span>?</span><b>Journal prompt</b><small>Begin with a gentle question</small></button>;
    if (id === "lunar") { const moon = lunarPhase(new Date(now)); return <article className="lunar-card card"><div className={`moon-orb ${moon.waxing ? "waxing" : "waning"}`} style={{ "--moon-shift": `${moon.waxing ? -moon.illumination : moon.illumination}%` } as React.CSSProperties} aria-label={`${moon.name}, ${moon.illumination}% illuminated`}><i /><i /><i /></div><div><p className="eyebrow">Lunar phase</p><h2>{moon.name}</h2><strong>{moon.illumination}% illuminated</strong><small>Moon age {moon.age} days</small><small>Next full moon · {moon.nextFullMoon}</small></div></article>; }
    return <section className="timeline-widget"><div className="section-heading"><div><p className="eyebrow">Recent</p><h2>Your timeline</h2></div><button className="text-button" onClick={() => setActive("Journal")}>Open journal →</button></div>{recent.map((entry) => <article className="timeline-row card" key={entry.id}><div className="date-block"><strong>{entry.date.includes("Today") ? "30" : entry.date.match(/\d+/)?.[0] ?? "—"}</strong><span>SEP</span></div><div className="timeline-main"><span className={`pill ${slug(entry.type)}`}>{entry.type}</span><h3>{entry.title}</h3><p>{entry.duration ? `${entry.duration} min` : entry.note?.slice(0, 48)}</p></div></article>)}</section>;
  };
  return <section className="page dashboard-page"><PageHeader eyebrow={`${todayLabel} · Patterns, practice & daily tools`} title="Your wellbeing" action={<div className="header-actions">{editing && <button className="header-action" onClick={() => { endDrag(); setEditing(false); }}>Done</button>}<button className="header-action primary-header dashboard-edit" aria-label={editing ? "Add insight widget" : "Edit insights"} onClick={() => editing ? setAdding(true) : setEditing(true)}>{editing ? "＋" : "Edit"}</button></div>} />
    {editing && <div className="dashboard-edit-banner"><span>✦</span><div><b>Insights edit mode</b><small>Drag any card anywhere, tap × to remove, or use ＋ to add widgets.</small></div></div>}
    <div ref={dashboardRef} className={`dashboard-grid ${editing ? "editing" : ""}`}>{widgets.map((id) => <div key={id} data-dashboard-widget={id} className={`dashboard-widget dashboard-${id} ${dragging === id ? "dragging" : ""}`} onPointerDown={(event) => { const target = event.target as HTMLElement; if (target.closest(".remove-widget")) return; const node = event.currentTarget; pointerStart.current = { x: event.clientX, y: event.clientY }; if (editing) { event.preventDefault(); node.setPointerCapture(event.pointerId); beginDrag(id, node, event.clientX, event.clientY); return; } if (target.closest("button,input,textarea,select,a,[role=button]")) return; holdTimer.current = window.setTimeout(() => { node.setPointerCapture(event.pointerId); setEditing(true); beginDrag(id, node, pointerStart.current.x, pointerStart.current.y); }, 450); }} onPointerMove={(event) => { if (!draggingRef.current && Math.hypot(event.clientX - pointerStart.current.x, event.clientY - pointerStart.current.y) > 8) cancelHold(); }} onPointerUp={() => { if (!draggingRef.current) cancelHold(); }} onPointerCancel={cancelHold} onContextMenu={(event) => { if (editing) event.preventDefault(); }}>{editing && <><button className="remove-widget" aria-label={`Remove ${dashboardWidgetMeta[id].title}`} onClick={() => setWidgets((current) => current.filter((item) => item !== id))}>×</button><span className="drag-widget-handle" aria-hidden="true">⠿</span></>}{renderWidget(id)}</div>)}</div>
    {adding && <AddDashboardWidgetModal current={widgets} renderPreview={renderWidget} onAdd={(id) => setWidgets((current) => [...current, id])} onClose={() => setAdding(false)} />}{expanded && expanded !== "books" && <AnalyticsModal widget={expanded} entries={entries} cycleLog={cycleLog} onClose={() => setExpanded(null)} />}{timePracticedOpen && <TimePracticedModal entries={entries} onClose={() => setTimePracticedOpen(false)} />}{bookLogOpen && <BookLogModal books={books} onSave={(book) => setBooks((current) => current.some((item) => item.id === book.id) ? current.map((item) => item.id === book.id ? book : item) : [...current, book])} onClose={() => setBookLogOpen(false)} />}{booksExpanded && <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, () => setBooksExpanded(false))}><section className="analytics-modal"><header className="modal-header"><div><p className="eyebrow">Expanded analytics</p><h2>Reading history</h2></div><button className="close-button" onClick={() => setBooksExpanded(false)}>×</button></header><BookAnalyticsCard books={books} onLog={() => { setBooksExpanded(false); setBookLogOpen(true); }} /></section></div>}
  </section>;
}

function TimerDial({ value, total, label, marks }: { value: number; total: number; label: string; marks: number[] }) {
  const degrees = total ? Math.max(0, Math.min(360, (1 - value / total) * 360)) : 0;
  return <div className="timer-wrap"><div className="timer-dial" style={{ "--progress": `${degrees}deg` } as React.CSSProperties}>{marks.map((mark) => <i className="gong-mark" aria-hidden="true" key={mark} style={{ transform: `rotate(${mark / total * 360}deg)` }} />)}<div className="timer-inner"><span>{label}</span><strong>{formatTime(value)}</strong><small>{value === total ? "ready when you are" : `${Math.ceil(value / 60)} minutes remaining`}</small></div></div></div>;
}

function presetGongMarks(preset: TimerPreset) {
  const repeating = preset.interval ? Array.from({ length: Math.floor((preset.seconds - 1) / preset.interval) }, (_, index) => (index + 1) * (preset.interval ?? 0)) : [];
  return [...new Set([...(preset.gongs ?? []), ...repeating])].filter((mark) => mark > 0 && mark < preset.seconds).sort((a, b) => a - b);
}

function SaveTimerModal({ initial, onClose, onSave }: { initial?: TimerPreset; onClose: () => void; onSave: (preset: TimerPreset) => void }) {
  const [generatedId] = useState(createRecordId);
  const starting = initial ?? { id: generatedId, name: "New practice", seconds: 600, color: "sage" as const, startGong: gongNames[0], endGong: gongNames[0], gongs: [] };
  const [name, setName] = useState(starting.name); const [hours, setHours] = useState(Math.floor(starting.seconds / 3600)); const [minutes, setMinutes] = useState(Math.floor(starting.seconds % 3600 / 60)); const [seconds, setSeconds] = useState(starting.seconds % 60);
  const [startGong, setStartGong] = useState(normalizedGongName(starting.startGong)); const [endGong, setEndGong] = useState(normalizedGongName(starting.endGong)); const [intervalEnabled, setIntervalEnabled] = useState(Boolean(starting.interval)); const [intervalMins, setIntervalMins] = useState(Math.max(1, Math.round((starting.interval ?? 300) / 60)));
  const [intervalGong, setIntervalGong] = useState(normalizedGongName(starting.intervalGong ?? gongNames[2])); const [customGongs, setCustomGongs] = useState((starting.gongs ?? []).map((gong, index) => ({ minutes: Math.round(gong / 60), sound: normalizedGongName(starting.gongSounds?.[index] ?? gongNames[2]) }))); const [color, setColor] = useState<TimerPreset["color"]>(starting.color);
  const save = () => { const validGongs = customGongs.filter((gong) => gong.minutes > 0); onSave({ id: starting.id, name: name.trim() || "Untitled timer", seconds: Math.max(5, hours * 3600 + minutes * 60 + seconds), color, startGong, endGong, interval: intervalEnabled ? intervalMins * 60 : undefined, intervalGong, gongs: validGongs.map((gong) => gong.minutes * 60), gongSounds: validGongs.map((gong) => gong.sound) }); };
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="builder-modal" role="dialog" aria-modal="true"><header className="modal-header"><div><p className="eyebrow">{initial ? "Edit saved timer" : "Save a timer"}</p><h2>Build your rhythm</h2></div><button className="close-button" onClick={onClose}>×</button></header>
    <label className="builder-name">Timer name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="time-picker"><label><input type="number" min="0" max="12" value={hours} onChange={(event) => setHours(Number(event.target.value))} /><span>hours</span></label><b>:</b><label><input type="number" min="0" max="59" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /><span>minutes</span></label><b>:</b><label><input type="number" min="0" max="59" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} /><span>seconds</span></label></div>
    <div className="builder-section sound-structure"><p className="eyebrow">Sound & structure</p><label className="structure-option"><span><i className="setting-icon">◎</i><b>Opening gong</b></span><select value={startGong} onChange={(event) => { setStartGong(event.target.value); tone(event.target.value); }}>{gongNames.map((gong) => <option key={gong}>{gong}</option>)}</select></label><label className="structure-option"><span><i className="setting-icon">◎</i><b>Closing gong</b></span><select value={endGong} onChange={(event) => { setEndGong(event.target.value); tone(event.target.value); }}>{gongNames.map((gong) => <option key={gong}>{gong}</option>)}</select></label>
      <div className="structure-option repeat-option"><span><i className="setting-icon">↻</i><b>Repeating gong</b><small>{intervalEnabled ? `Every ${intervalMins} minutes` : "Off"}</small></span><label className="toggle"><input aria-label="Enable repeating gong" type="checkbox" checked={intervalEnabled} onChange={(event) => setIntervalEnabled(event.target.checked)} /><span /></label></div>{intervalEnabled && <div className="repeat-controls"><label>Every <input aria-label="Repeating gong minutes" type="number" min="1" max="120" value={intervalMins} onChange={(event) => setIntervalMins(Math.min(120, Math.max(1, Number(event.target.value))))} /> minutes</label><label>Sound<select value={intervalGong} onChange={(event) => { setIntervalGong(event.target.value); tone(event.target.value); }}>{gongNames.map((gong) => <option key={gong}>{gong}</option>)}</select></label><label className="repeat-slider">Interval<input className="gong-range" type="range" min="1" max="120" value={intervalMins} onChange={(event) => setIntervalMins(Number(event.target.value))} /></label></div>}
      <div className="manual-gongs"><div className="manual-gongs-title"><span><i className="setting-icon">＋</i><b>Custom gongs</b></span><button className="add-inline" onClick={() => setCustomGongs([...customGongs, { minutes: Math.max(1, Math.round((minutes || 10) / 2)), sound: gongNames[2] }])}>＋ Add</button></div>{customGongs.map((gong, index) => <div className="custom-gong-row sound-row" key={index}><input aria-label={`Gong ${index + 1} minute`} type="number" min="1" value={gong.minutes} onChange={(event) => setCustomGongs(customGongs.map((item, itemIndex) => itemIndex === index ? { ...item, minutes: Number(event.target.value) } : item))} /><span>min</span><select aria-label={`Gong ${index + 1} sound`} value={gong.sound} onChange={(event) => { setCustomGongs(customGongs.map((item, itemIndex) => itemIndex === index ? { ...item, sound: event.target.value } : item)); tone(event.target.value); }}>{gongNames.map((sound) => <option key={sound}>{sound}</option>)}</select><button aria-label={`Remove gong ${index + 1}`} onClick={() => setCustomGongs(customGongs.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>
    </div>
    <div className="color-picker"><span>Timer color</span>{(["sage", "gold", "coral"] as const).map((item) => <button aria-label={item} className={`${item} ${color === item ? "active" : ""}`} onClick={() => setColor(item)} key={item} />)}</div>
    <footer className="modal-footer"><button className="text-button" onClick={onClose}>Cancel</button><button className="primary-button modal-save" onClick={() => { save(); onClose(); }}><span>Save timer</span><span>→</span></button></footer>
  </section></div>;
}

function PracticeScreen({ timers, setTimers, openReflection, notify }: { timers: TimerPreset[]; setTimers: React.Dispatch<React.SetStateAction<TimerPreset[]>>; openReflection: (request: ReflectionRequest) => void; notify: (message: string) => void }) {
  const [mode, setMode] = useState<PracticeMode>("Timer"); const [duration, setDuration] = useState(600); const [remaining, setRemaining] = useState(600); const [running, setRunning] = useState(false); const [elapsed, setElapsed] = useState(0);
  const [gongMenu, setGongMenu] = useState<"opening" | "closing" | null>(null); const [openingGong, setOpeningGong] = useState(gongNames[0]); const [closingGong, setClosingGong] = useState(gongNames[0]); const [intervalEnabled, setIntervalEnabled] = useState(true); const [intervalMinutes, setIntervalMinutes] = useState(5); const [intervalGong, setIntervalGong] = useState(gongNames[2]); const [customGongs, setCustomGongs] = useState([3, 8]); const [customGongSounds, setCustomGongSounds] = useState([gongNames[2], gongNames[3]]);
  const [editingGongs, setEditingGongs] = useState(false); const [builder, setBuilder] = useState<TimerPreset | "new" | null>(null); const [presetMenu, setPresetMenu] = useState<RecordId | null>(null); const [draftId] = useState(createRecordId); const [customDurationOpen, setCustomDurationOpen] = useState(false); const [customHours, setCustomHours] = useState(0); const [customMinutes, setCustomMinutes] = useState(15); const [customSeconds, setCustomSeconds] = useState(0); const lastGong = useRef(-1); const deadline = useRef<number | null>(null); const stopwatchStartedAt = useRef<number | null>(null); const restored = useRef(false);
  const previousMode = useRef<"Timer" | "Stopwatch">("Timer");
  const clearStoredPractice = () => { try { localRepository.savePractice(null); } catch { /* local storage can be unavailable */ } };
  const storePractice = useCallback((record: StoredPractice) => { try { localRepository.savePractice(record); } catch { /* local storage can be unavailable */ } }, []);
  const completeTimer = useCallback(() => {
    setRunning(false); setRemaining(0); deadline.current = null; clearStoredPractice(); tone(closingGong);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Practice complete", { body: "Your meditation timer has finished." });
    openReflection({ duration: Math.max(1, Math.round(duration / 60)), type: "Meditation" });
  }, [closingGong, duration, openReflection]);
  useEffect(() => {
    if (restored.current) return; restored.current = true;
    try {
      const saved = localRepository.loadPractice(); if (!saved) return;
      const restoreTimer = window.setTimeout(() => {
        setMode(saved.mode); setDuration(saved.duration); setOpeningGong(normalizedGongName(saved.openingGong)); setClosingGong(normalizedGongName(saved.closingGong)); setIntervalEnabled(saved.intervalEnabled); setIntervalMinutes(saved.intervalMinutes); setIntervalGong(normalizedGongName(saved.intervalGong ?? gongNames[2])); setCustomGongs(saved.customGongs); setCustomGongSounds((saved.customGongSounds ?? saved.customGongs.map(() => gongNames[2])).map(normalizedGongName));
        if (saved.mode === "Timer" && saved.endAt) { const next = Math.max(0, Math.ceil((saved.endAt - Date.now()) / 1000)); setRemaining(next); if (next > 0) { deadline.current = saved.endAt; lastGong.current = saved.duration - next; setRunning(true); } else { clearStoredPractice(); notify("Your timer finished while you were away"); openReflection({ duration: Math.max(1, Math.round(saved.duration / 60)), type: "Meditation" }); } }
        if (saved.mode === "Stopwatch" && saved.startedAt) { stopwatchStartedAt.current = saved.startedAt; setElapsed(Math.max(0, Math.floor((Date.now() - saved.startedAt) / 1000))); setRunning(true); }
      }, 0);
      return () => window.clearTimeout(restoreTimer);
    } catch { clearStoredPractice(); }
  }, [notify, openReflection]);
  useEffect(() => {
    if (!running) return;
    const update = () => {
      if (mode === "Stopwatch") { if (stopwatchStartedAt.current) setElapsed(Math.max(0, Math.floor((Date.now() - stopwatchStartedAt.current) / 1000))); return; }
      if (!deadline.current) return; const next = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)); const practiced = duration - next;
      const intervalSeconds = Math.max(1, intervalMinutes) * 60; const crossedInterval = intervalEnabled && Math.floor(practiced / intervalSeconds) > Math.floor(Math.max(0, lastGong.current) / intervalSeconds); const customIndex = customGongs.findIndex((gong) => gong * 60 > lastGong.current && gong * 60 <= practiced);
      if (practiced > 0 && practiced < duration && customIndex >= 0) tone(customGongSounds[customIndex] ?? gongNames[2]); else if (practiced > 0 && practiced < duration && crossedInterval) tone(intervalGong); lastGong.current = practiced; setRemaining(next); if (next === 0) completeTimer();
    };
    update(); const timer = window.setInterval(update, 500); document.addEventListener("visibilitychange", update); window.addEventListener("pageshow", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("pageshow", update); };
  }, [running, mode, duration, intervalEnabled, intervalMinutes, intervalGong, customGongs, customGongSounds, completeTimer]);
  useEffect(() => { if (presetMenu === null) return; const closeMenu = (event: PointerEvent) => { if (!(event.target as Element).closest(".timer-more,.timer-card-menu")) setPresetMenu(null); }; document.addEventListener("pointerdown", closeMenu); return () => document.removeEventListener("pointerdown", closeMenu); }, [presetMenu]);
  const chooseDuration = (seconds: number) => { setDuration(seconds); setRemaining(seconds); setRunning(false); deadline.current = null; clearStoredPractice(); lastGong.current = -1; };
  const switchPracticeMode = (nextMode: "Timer" | "Stopwatch") => { previousMode.current = nextMode; setMode(nextMode); setRunning(false); deadline.current = null; stopwatchStartedAt.current = null; clearStoredPractice(); };
  const choosePreset = (preset: TimerPreset) => { chooseDuration(preset.seconds); setOpeningGong(normalizedGongName(preset.startGong)); setClosingGong(normalizedGongName(preset.endGong)); setIntervalEnabled(Boolean(preset.interval)); setIntervalMinutes(Math.max(1, Math.round((preset.interval ?? 300) / 60))); setIntervalGong(normalizedGongName(preset.intervalGong ?? gongNames[2])); setCustomGongs((preset.gongs ?? []).map((gong) => Math.round(gong / 60))); setCustomGongSounds((preset.gongs ?? []).map((_, index) => normalizedGongName(preset.gongSounds?.[index] ?? gongNames[2]))); setMode("Timer"); };
  const savePreset = (preset: TimerPreset) => { setTimers((current) => current.some((item) => item.id === preset.id) ? current.map((item) => item.id === preset.id ? preset : item) : [...current, preset]); notify("Timer saved"); };
  const toggleRunning = () => {
    if (running) { if (mode === "Timer" && deadline.current) setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))); if (mode === "Stopwatch" && stopwatchStartedAt.current) setElapsed(Math.max(0, Math.floor((Date.now() - stopwatchStartedAt.current) / 1000))); setRunning(false); deadline.current = null; stopwatchStartedAt.current = null; clearStoredPractice(); return; }
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
    if (mode === "Timer") { if (remaining === duration) tone(openingGong); const endAt = Date.now() + remaining * 1000; deadline.current = endAt; lastGong.current = duration - remaining; storePractice({ mode: "Timer", duration, endAt, openingGong, closingGong, intervalEnabled, intervalMinutes, intervalGong, customGongs, customGongSounds }); }
    else { const startedAt = Date.now() - elapsed * 1000; stopwatchStartedAt.current = startedAt; storePractice({ mode: "Stopwatch", duration, startedAt, openingGong, closingGong, intervalEnabled, intervalMinutes, intervalGong, customGongs, customGongSounds }); }
    setRunning(true);
  };
  const finish = () => { setRunning(false); deadline.current = null; stopwatchStartedAt.current = null; clearStoredPractice(); if (mode === "Stopwatch") { tone(closingGong); openReflection({ duration: Math.max(1, Math.round(elapsed / 60)) }); } else openReflection({ duration: Math.max(1, Math.round((duration - remaining) / 60)), type: "Meditation" }); };
  const currentDraft: TimerPreset = { id: draftId, name: "My meditation", seconds: duration, color: "sage", startGong: openingGong, endGong: closingGong, interval: intervalEnabled ? intervalMinutes * 60 : undefined, intervalGong, gongs: customGongs.map((gong) => gong * 60), gongSounds: customGongSounds };
  return <section className="page practice-page"><PageHeader eyebrow="Practice room" title="Practice" action={mode === "Saved" ? <button className="header-action" onClick={() => switchPracticeMode(previousMode.current)}>← Back to practice</button> : <button className="header-action" onClick={() => { previousMode.current = mode === "Stopwatch" ? "Stopwatch" : "Timer"; setMode("Saved"); setRunning(false); deadline.current = null; stopwatchStartedAt.current = null; clearStoredPractice(); }}>Saved timers <span>{timers.length}</span></button>} />{mode !== "Saved" && <div className="segmented" role="tablist" tabIndex={0} style={{ "--pill-offset": mode === "Stopwatch" ? "calc(100% + 4px)" : "0%" } as React.CSSProperties} onClick={(event) => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); switchPracticeMode(event.clientX < bounds.left + bounds.width / 2 ? "Timer" : "Stopwatch"); }} onKeyDown={(event) => { if (event.key === "ArrowLeft") switchPracticeMode("Timer"); if (event.key === "ArrowRight") switchPracticeMode("Stopwatch"); }}>{(["Timer", "Stopwatch"] as const).map((item) => <button role="tab" aria-selected={mode === item} key={item} onClick={() => switchPracticeMode(item)}>{item}</button>)}</div>}
    {mode === "Saved" ? <div className="saved-layout"><div className="saved-intro"><p className="eyebrow">Your collection</p><h2>Return to a familiar rhythm.</h2><p>Saved timers remember exact durations, interval sounds, and every custom gong.</p></div><div className="saved-grid">{timers.map((preset) => <article className="saved-timer card" key={preset.id}><button className="saved-timer-open" aria-label={`Use ${preset.name}`} onClick={() => choosePreset(preset)} /><div className={`mini-dial ${preset.color}`}>{presetGongMarks(preset).map((mark) => <i className="mini-gong-mark" aria-hidden="true" key={mark} style={{ transform: `rotate(${mark / preset.seconds * 360}deg)` }} />)}<span>{Math.round(preset.seconds / 60)}</span><small>min</small></div><div className="saved-copy"><p className="eyebrow">{preset.interval ? `Gong every ${preset.interval / 60} min` : `${preset.gongs?.length ?? 0} custom gongs`}</p><h3>{preset.name}</h3><span>{preset.startGong}</span></div><button className="timer-more" aria-label={`Edit ${preset.name}`} onClick={() => setPresetMenu(presetMenu === preset.id ? null : preset.id)}>•••</button>{presetMenu === preset.id && <div className="timer-card-menu"><button onClick={() => { setBuilder(preset); setPresetMenu(null); }}>Edit</button><button onClick={() => { setTimers((current) => current.filter((item) => item.id !== preset.id)); setPresetMenu(null); notify("Timer removed"); }}>Delete</button></div>}</article>)}</div><button className="outline-button" onClick={() => setBuilder("new")}><span>＋</span> Save a new timer</button></div> : <div className="practice-workspace"><section className="timer-stage">{mode === "Timer" ? <TimerDial value={remaining} total={duration} label="Meditation timer" marks={[...new Set([...customGongs.map((gong) => gong * 60), ...(intervalEnabled ? Array.from({ length: Math.floor((duration - 1) / (Math.max(1, intervalMinutes) * 60)) }, (_, index) => (index + 1) * Math.max(1, intervalMinutes) * 60) : [])])].filter((gong) => gong > 0 && gong < duration).sort((a, b) => a - b)} /> : <div className="stopwatch-display"><span>Stopwatch</span><strong>{formatTime(elapsed, true)}</strong><small>unbounded practice</small></div>}<div className="timer-actions"><button className="secondary-circle" aria-label="Reset timer" onClick={() => { if (mode === "Timer") setRemaining(duration); else setElapsed(0); setRunning(false); deadline.current = null; stopwatchStartedAt.current = null; clearStoredPractice(); }}>↺</button><button className="start-button" onClick={toggleRunning}>{running ? "Pause" : mode === "Timer" && remaining < duration ? "Resume" : "Start"}</button><button className="secondary-circle" aria-label="Finish practice" onClick={finish}>✓</button></div>{mode === "Timer" && <><div className="duration-chips">{[5, 10, 20, 30, 45, 60].map((mins) => <button className={duration === mins * 60 ? "active" : ""} key={mins} onClick={() => chooseDuration(mins * 60)}>{mins} min</button>)}<button className={customDurationOpen ? "active" : ""} onClick={() => setCustomDurationOpen(!customDurationOpen)}>Custom</button></div>{customDurationOpen && <div className="custom-duration" aria-label="Custom timer duration"><label><input type="number" min="0" max="23" value={customHours} onChange={(event) => setCustomHours(Math.max(0, Number(event.target.value)))} /><span>hours</span></label><b>:</b><label><input type="number" min="0" max="59" value={customMinutes} onChange={(event) => setCustomMinutes(Math.max(0, Number(event.target.value)))} /><span>minutes</span></label><b>:</b><label><input type="number" min="0" max="59" value={customSeconds} onChange={(event) => setCustomSeconds(Math.max(0, Number(event.target.value)))} /><span>seconds</span></label><button onClick={() => { chooseDuration(Math.max(5, customHours * 3600 + customMinutes * 60 + customSeconds)); setCustomDurationOpen(false); }}>Set timer</button></div>}<button className="save-current" onClick={() => setBuilder(currentDraft)}>＋ Save this setup</button></>}</section>
      <aside className="timer-settings card"><div className="card-heading"><div><p className="eyebrow">Sound & structure</p><h2>Gongs</h2></div><button className="sound-button" onClick={() => tone(openingGong)}>♪ Try</button></div>
        {(["opening", "closing"] as const).map((kind) => { const value = kind === "opening" ? openingGong : closingGong; return <div className="gong-setting" key={kind}><button className="setting-row" onClick={() => setGongMenu(gongMenu === kind ? null : kind)}><span><i className="setting-icon">◎</i><b>{kind === "opening" ? "Opening gong" : "Closing gong"}</b><small>{value}</small></span><em>⌄</em></button>{gongMenu === kind && <div className="gong-options">{gongNames.map((gong) => <button className={gong === value ? "selected" : ""} key={gong} onClick={() => { if (kind === "opening") setOpeningGong(gong); else setClosingGong(gong); setGongMenu(null); tone(gong); }}>{gong}{gong === value && <span>✓</span>}</button>)}</div>}</div>; })}
        <div className="setting-row"><span><i className="setting-icon">↻</i><b>Repeating gong</b><small>{intervalEnabled ? `Every ${intervalMinutes} minutes · ${intervalGong}` : "Off"}</small></span><label className="toggle"><input aria-label="Enable repeating gong" type="checkbox" checked={intervalEnabled} onChange={(event) => setIntervalEnabled(event.target.checked)} /><span /></label></div>{intervalEnabled && <div className="inline-repeat-editor"><label className="repeat-live-time"><span>Every</span><input className="gong-range" type="range" min="1" max="120" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} /><span className="gong-minute-field"><input className="gong-minute-input" aria-label="Repeating gong minutes" type="number" min="1" max="120" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Math.min(120, Math.max(1, Number(event.target.value))))} /> min</span></label><label>Sound<select value={intervalGong} onChange={(event) => { setIntervalGong(event.target.value); tone(event.target.value); }}>{gongNames.map((gong) => <option key={gong}>{gong}</option>)}</select></label></div>}
        <button className="setting-row" onClick={() => setEditingGongs(!editingGongs)}><span><i className="setting-icon">＋</i><b>Custom gongs</b><small>{customGongs.length ? `At ${customGongs.join(", ")} minutes` : "None"}</small></span><em>{editingGongs ? "⌃" : "Edit"}</em></button>{editingGongs && <div className="inline-gong-editor">{customGongs.map((gong, index) => <div className="sound-row" key={index}><input aria-label={`Gong ${index + 1} minute`} type="number" min="1" value={gong} onChange={(event) => setCustomGongs(customGongs.map((item, itemIndex) => itemIndex === index ? Number(event.target.value) : item))} /><span>min</span><select aria-label={`Gong ${index + 1} sound`} value={customGongSounds[index] ?? gongNames[2]} onChange={(event) => { setCustomGongSounds(customGongSounds.map((item, itemIndex) => itemIndex === index ? event.target.value : item)); tone(event.target.value); }}>{gongNames.map((sound) => <option key={sound}>{sound}</option>)}</select><button onClick={() => { setCustomGongs(customGongs.filter((_, itemIndex) => itemIndex !== index)); setCustomGongSounds(customGongSounds.filter((_, itemIndex) => itemIndex !== index)); }}>×</button></div>)}<button onClick={() => { setCustomGongs([...customGongs, Math.max(1, Math.round(duration / 120))]); setCustomGongSounds([...customGongSounds, gongNames[2]]); }}>＋ Add gong</button></div>}
        <p className="setting-note">Your timer stays accurate through screen lock, app navigation, and reopening. Completion sound and notifications depend on your device and browser permissions.</p>
      </aside></div>}
    {builder && <SaveTimerModal initial={builder === "new" ? undefined : builder} onClose={() => setBuilder(null)} onSave={savePreset} />}
  </section>;
}

const assessmentItems = [...sevenFactors, ...fiveFaculties.map(facultyAssessmentKey), ...threeCharacteristics, ...fiveHindrances];
function makeAssessments(initial?: Record<string, AssessmentValue>) { return Object.fromEntries(assessmentItems.map((item) => [item, initial?.[item] ?? { value: 0, note: "" }])); }
function groupAssessmentKeys(group: (typeof assessmentGroups)[number]) { return group.items.map((item) => group.name === "Faculties" ? facultyAssessmentKey(item) : item); }
function groupIsLogged(group: (typeof assessmentGroups)[number], assessments: Record<string, AssessmentValue>) { return groupAssessmentKeys(group).some((key) => (assessments[key]?.value ?? 0) > 0); }
function loggedAssessments(assessments: Record<string, AssessmentValue>) { const activeKeys = new Set(assessmentGroups.filter((group) => groupIsLogged(group, assessments)).flatMap(groupAssessmentKeys)); return Object.fromEntries(Object.entries(assessments).filter(([key]) => activeKeys.has(key))); }

function AssessmentEditor({ assessments, setAssessments, active, setActive }: { assessments: Record<string, AssessmentValue>; setAssessments: React.Dispatch<React.SetStateAction<Record<string, AssessmentValue>>>; active: boolean; setActive: (active: boolean) => void }) {
  const [openGroup, setOpenGroup] = useState("Awakening"); const [noteFor, setNoteFor] = useState<string | null>(null); const [definition, setDefinition] = useState<string | null>(null);
  return <><div className={`assessment-groups ${active ? "active" : "inactive"}`}>{assessmentGroups.map((group, groupIndex) => { const groupActive = groupIsLogged(group, assessments); return <article className={`assessment-group ${groupActive ? "logged" : "not-logged"}`} key={group.name}><button className="assessment-heading" onClick={() => setOpenGroup(openGroup === group.name ? "" : group.name)}><span><small>0{groupIndex + 1}</small><b>{group.label}<InfoButton definitionKey={`group:${group.name}`} onOpen={setDefinition} /></b></span><em>{openGroup === group.name ? "−" : "+"}</em></button>{openGroup === group.name && <div className="sliders"><p className="assessment-hint">{groupActive ? "This group will be logged. Return every slider to 0 to leave it N/A." : "Move any slider to begin logging this group."}</p>{group.items.map((item) => { const key = group.name === "Faculties" ? facultyAssessmentKey(item) : item; return <div className="assessment-item" key={key}><label><span>{item}<InfoButton definitionKey={`${group.name}:${item}`} onOpen={setDefinition} /><output>{groupActive ? `${assessments[key].value}%` : "N/A"}</output></span><input type="range" min="0" max="100" value={assessments[key].value} onChange={(event) => { const value = Number(event.target.value); setAssessments((current) => { const next = { ...current, [key]: { ...current[key], value } }; setActive(assessmentGroups.some((candidate) => groupIsLogged(candidate, next))); return next; }); }} /></label><button className={assessments[key].note ? "has-note" : ""} onClick={() => setNoteFor(noteFor === key ? null : key)}>✎</button>{noteFor === key && <input className="factor-note" value={assessments[key].note} onChange={(event) => { const note = event.target.value; setAssessments((current) => { const next = { ...current, [key]: { ...current[key], note } }; setActive(assessmentGroups.some((candidate) => groupIsLogged(candidate, next))); return next; }); }} placeholder={`Note about ${item.toLowerCase()}…`} />}</div>; })}</div>}</article>; })}</div>{definition && <DefinitionModal definitionKey={definition} onClose={() => setDefinition(null)} />}</>;
}

function suggestedEntryTitle(type: string, date = new Date()) { const hour = date.getHours(); const part = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening"; const label = type === "Journal" ? "Journal" : type === "Gratitude" ? "Gratitude" : type; return `${part} ${label}`; }

function ReflectionModal({ request, activities, setActivities, onClose, onSave }: { request: ReflectionRequest; activities: ActivityPreset[]; setActivities: React.Dispatch<React.SetStateAction<ActivityPreset[]>>; onClose: () => void; onSave: (entry: JournalEntry) => void }) {
  const [type, setType] = useState(request.type ?? activities[0]?.name ?? "Meditation"); const [duration, setDuration] = useState(request.duration); const [note, setNote] = useState(""); const [addingType, setAddingType] = useState(false); const [newType, setNewType] = useState("");
  const [assessments, setAssessments] = useState<Record<string, AssessmentValue>>(() => makeAssessments()); const [assessmentActive, setAssessmentActive] = useState(false);
  const addType = () => { if (!newType.trim()) return; const preset: ActivityPreset = { id: createRecordId(), name: newType.trim(), icon: "◇", color: "plum" }; setActivities((current) => [...current, preset]); setType(preset.name); setNewType(""); setAddingType(false); };
  const save = (savedNote = note) => { const savedAssessments = loggedAssessments(assessments); onSave({ id: createRecordId(), type, title: suggestedEntryTitle(type), date: "Today · just now", duration, note: savedNote, assessments: Object.keys(savedAssessments).length ? savedAssessments : undefined, tags: ["practice"] }); };
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="reflection-modal" role="dialog" aria-modal="true"><header className="modal-header"><div><p className="eyebrow">Practice complete</p><h2>How was that?</h2></div><button className="close-button" onClick={onClose}>×</button></header>
    <div className="reflection-basics"><label>Minutes<input type="number" min="0" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label></div>
    <div className="activity-picker">{activities.map((item) => <button key={item.id} className={type === item.name ? "active" : ""} onClick={() => setType(item.name)}><span>{item.icon}</span>{item.name}</button>)}<button onClick={() => setAddingType(true)}><span>＋</span>Add</button></div>{addingType && <div className="add-preset-row"><input value={newType} onChange={(event) => setNewType(event.target.value)} placeholder="Activity name" onKeyDown={(event) => { if (event.key === "Enter") addType(); }} /><button onClick={addType}>Add preset</button></div>}
    <AssessmentEditor assessments={assessments} setAssessments={setAssessments} active={assessmentActive} setActive={setAssessmentActive} />
    <label className="notes-field"><span>Anything else to remember?</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="A thought, a feeling, a tiny shift…" /></label><footer className="modal-footer"><button className="text-button" onClick={() => { save(""); onClose(); }}>Save time only</button><button className="primary-button modal-save" onClick={() => { save(); onClose(); }}><span>Save practice</span><span>→</span></button></footer>
  </section></div>;
}

function NewEntryModal({ activities, initial, seedPrompt, seedType, seedTitle, seedNote, onClose, onSave }: { activities: ActivityPreset[]; initial?: JournalEntry; seedPrompt?: string; seedType?: string; seedTitle?: string; seedNote?: string; onClose: () => void; onSave: (entry: JournalEntry) => void }) {
  const [type, setType] = useState(initial?.type ?? seedType ?? "Journal"); const [title, setTitle] = useState(initial?.title ?? seedTitle ?? (seedPrompt ? "Prompted reflection" : "")); const [note, setNote] = useState(initial?.note ?? seedNote ?? (seedPrompt ? `${seedPrompt}\n\n` : "")); const [duration, setDuration] = useState(initial?.duration ?? 0); const [assessments, setAssessments] = useState<Record<string, AssessmentValue>>(() => makeAssessments(initial?.assessments)); const [assessmentActive, setAssessmentActive] = useState(Boolean(initial?.assessments));
  const suggestedTitle = suggestedEntryTitle(type);
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="builder-modal small-modal journal-entry-modal" role="dialog" aria-modal="true"><header className="modal-header"><div><p className="eyebrow">{initial ? "Edit journal entry" : "New journal entry"}</p><h2>{initial ? "Shape what you captured" : "Capture this moment"}</h2></div><button className="close-button" aria-label="Close" onClick={onClose}>×</button></header><div className="field-pair"><label>Type<select value={type} onChange={(event) => setType(event.target.value)}><option>Journal</option><option>Gratitude</option>{activities.map((activity) => <option key={activity.id}>{activity.name}</option>)}</select></label><label>Minutes<input type="number" min="0" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label></div><label className="builder-name">Title<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={suggestedTitle} /><small>Leave blank to use “{suggestedTitle}”.</small></label><AssessmentEditor assessments={assessments} setAssessments={setAssessments} active={assessmentActive} setActive={setAssessmentActive} /><label className="notes-field"><span>Reflection</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What would you like to remember?" /></label><button className="primary-button" onClick={() => { const savedAssessments = loggedAssessments(assessments); onSave({ ...initial, id: initial?.id ?? createRecordId(), type, title: title.trim() || suggestedTitle, date: initial?.date ?? "Today · just now", duration: duration || undefined, note, assessments: Object.keys(savedAssessments).length ? savedAssessments : undefined }); onClose(); }}><span>{initial ? "Save changes" : "Save entry"}</span><span>→</span></button></section></div>;
}

function calendarDotClass(entry: JournalEntry) { if (entry.type === "Meditation") return "meditation"; if (entry.type === "Maintenance Yoga") return "maintenance-yoga"; if (entry.type === "Work Out Yoga") return "workout-yoga"; if (entry.type === "Journal" || entry.type === "Gratitude") return "journal"; return "other"; }
function entriesForDate(entries: JournalEntry[], date: Date, now: number) { return entries.filter((entry) => { const stamp = new Date(entryTimestamp(entry, now)); return stamp.getFullYear() === date.getFullYear() && stamp.getMonth() === date.getMonth() && stamp.getDate() === date.getDate(); }); }

function JournalCalendar({ entries, mode }: { entries: JournalEntry[]; mode: "Month" | "Year" }) {
  const now = useStableNow(); const [anchor, setAnchor] = useState(() => new Date(now)); const renderMonth = (month: number, compact = false) => { const year = anchor.getFullYear(); const first = new Date(year, month, 1); const days = new Date(year, month + 1, 0).getDate(); const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)]; return <section className={`calendar-month ${compact ? "compact" : ""}`} key={month}><h3>{first.toLocaleDateString("en-CA", { month: "long" })}</h3><div className="calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="calendar-days">{cells.map((day, index) => day === null ? <span className="calendar-blank" key={`blank-${index}`} /> : <span className="calendar-day" key={day}><b>{day}</b><i>{entriesForDate(entries, new Date(year, month, day), now).slice(0, 4).map((entry) => <em className={calendarDotClass(entry)} key={entry.id} title={entry.type} />)}</i></span>)}</div></section>; };
  return <div className={`journal-calendar ${mode.toLowerCase()}`}><header><button onClick={() => setAnchor(new Date(anchor.getFullYear() - (mode === "Year" ? 1 : 0), anchor.getMonth() - (mode === "Month" ? 1 : 0), 1))}>←</button><strong>{mode === "Month" ? anchor.toLocaleDateString("en-CA", { month: "long", year: "numeric" }) : anchor.getFullYear()}</strong><button onClick={() => setAnchor(new Date(anchor.getFullYear() + (mode === "Year" ? 1 : 0), anchor.getMonth() + (mode === "Month" ? 1 : 0), 1))}>→</button></header><div className="calendar-legend"><span><i className="meditation" />Meditation</span><span><i className="maintenance-yoga" />Maintenance Yoga</span><span><i className="workout-yoga" />Work Out Yoga</span><span><i className="journal" />Journal</span></div>{mode === "Month" ? renderMonth(anchor.getMonth()) : <div className="year-grid">{Array.from({ length: 12 }, (_, month) => renderMonth(month, true))}</div>}</div>;
}

function EntryAssessmentDetail({ entry, entries }: { entry: JournalEntry; entries: JournalEntry[] }) {
  const now = useStableNow(); const values = Object.entries(entry.assessments ?? {}).filter(([, value]) => value.value > 0); const previous = entries.filter((candidate) => candidate.id !== entry.id && candidate.type === entry.type && candidate.assessments && entryTimestamp(candidate, now) < entryTimestamp(entry, now)).sort((a, b) => entryTimestamp(b, now) - entryTimestamp(a, now))[0]; const improvements = values.map(([key, value]) => ({ key, delta: value.value - (previous?.assessments?.[key]?.value ?? value.value) })).filter((item) => item.delta > 0);
  if (!values.length) return null; return <div className="entry-assessment-detail"><div className="mini-assessment-list">{values.map(([key, value]) => <div key={key}><span>{assessmentLabel(key)}<b>{value.value}%</b></span><i><em style={{ width: `${value.value}%` }} /></i>{value.note && <small>{value.note}</small>}</div>)}</div>{improvements.map((item) => <p className="assessment-improvement" key={item.key}>↑ {assessmentLabel(item.key)} has improved by {item.delta}% since the last {String(entry.type).toLowerCase()} entry.</p>)}</div>;
}

function ConfirmDeleteModal({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => void }) { return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onCancel)}><section className="builder-modal confirm-delete"><p className="eyebrow">Delete entry</p><h2>Remove “{title}”?</h2><p>This cannot be undone.</p><div><button className="text-button" onClick={onCancel}>Keep entry</button><button className="delete-confirm" onClick={onConfirm}>Delete</button></div></section></div>; }

function JournalEntryChooser({ onChoose, onClose }: { onChoose: (kind: "reflection" | "gratitude" | "prompt", prompt?: string) => void; onClose: () => void }) {
  const [promptIndex, setPromptIndex] = useState(0);
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="builder-modal small-modal entry-chooser"><header className="modal-header"><div><p className="eyebrow">New entry</p><h2>What would you like to capture?</h2></div><button className="close-button" onClick={onClose}>×</button></header><div className="entry-kind-grid"><button onClick={() => onChoose("reflection")}><span>✎</span><b>Journal entry</b><small>Write freely and add practice factors</small></button><button onClick={() => onChoose("gratitude")}><span>✦</span><b>Daily gratitude</b><small>Hold onto something quietly good</small></button></div><article className="prompt-card prompt-option"><div className="prompt-card-header"><span>Journal prompt</span><span>{promptIndex + 1} / {journalPrompts.length}</span></div><p>{journalPrompts[promptIndex]}</p><div className="prompt-actions"><div><button aria-label="Previous prompt" onClick={() => setPromptIndex((promptIndex - 1 + journalPrompts.length) % journalPrompts.length)}>←</button><button aria-label="Next prompt" onClick={() => setPromptIndex((promptIndex + 1) % journalPrompts.length)}>→</button></div><button onClick={() => onChoose("prompt", journalPrompts[promptIndex])}>Start writing</button></div></article></section></div>;
}

function JournalListEntry({ entry, entries, cycleLog, expanded, setExpanded, onEdit, onDelete }: { entry: JournalEntry; entries: JournalEntry[]; cycleLog: CycleLog; expanded: RecordId | null; setExpanded: (id: RecordId | null) => void; onEdit: (entry: JournalEntry) => void; onDelete: (entry: JournalEntry) => void }) {
  const now = useStableNow(); return <article className={`journal-entry card ${expanded === entry.id ? "expanded" : ""}`}><button className="journal-summary" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}><span className={`entry-symbol ${slug(entry.type)}`}>{entry.type === "Meditation" ? "◌" : entry.type === "Maintenance Yoga" ? "⌁" : entry.type === "Work Out Yoga" ? "△" : entry.type === "Gratitude" ? "✦" : entry.type === "Period" ? "●" : "▤"}</span><span className="entry-copy"><small>{entry.date}</small><b>{entry.title}</b><em>{entry.duration ? `${entry.duration} min` : entry.note?.slice(0, 54)}</em><small className="entry-context">☾ {journalContexts(entry, cycleLog, now).lunar} · ● {journalContexts(entry, cycleLog, now).cycle}</small></span><span className={`pill ${slug(entry.type)}`}>{entry.type}</span><span className="chevron">⌄</span></button>{expanded === entry.id && <div className="entry-detail"><p>{entry.note || "Time spent practicing — no reflection added."}</p><EntryAssessmentDetail entry={entry} entries={entries} /><div className="entry-actions"><button className="text-button" onClick={() => onEdit(entry)}>Edit reflection</button><button className="text-button delete-entry" onClick={() => onDelete(entry)}>Delete</button></div></div>}</article>;
}

function JournalScreen({ entries, activities, cycleLog, addEntry, updateEntry, deleteEntry }: { entries: JournalEntry[]; activities: ActivityPreset[]; cycleLog: CycleLog; addEntry: (entry: JournalEntry) => void; updateEntry: (entry: JournalEntry) => void; deleteEntry: (id: RecordId) => void }) {
  const now = useStableNow(); const [filter, setFilter] = useState("All"); const [expanded, setExpanded] = useState<RecordId | null>(entries[0]?.id ?? null); const [search, setSearch] = useState(""); const [searching, setSearching] = useState(false); const [sort, setSort] = useState<"Newest" | "Oldest">("Newest"); const [view, setView] = useState<"List" | "Month" | "Year">("List"); const [chooser, setChooser] = useState(false); const [newEntry, setNewEntry] = useState(false); const [entryKind, setEntryKind] = useState<"reflection" | "gratitude" | "prompt">("reflection"); const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null); const [deleteTarget, setDeleteTarget] = useState<JournalEntry | null>(null); const [promptDraft, setPromptDraft] = useState<string | undefined>();
  useEffect(() => { const compose = (event: Event) => { const kind = (event as CustomEvent<string>).detail; if (kind === "prompt") setChooser(true); else { setEntryKind("reflection"); setPromptDraft(undefined); setNewEntry(true); } }; window.addEventListener("yi-journal-compose", compose); return () => window.removeEventListener("yi-journal-compose", compose); }, []);
  const filters = ["All", "Meditation", "Maintenance Yoga", "Work Out Yoga", "Gratitude", "Period", ...activities.map((activity) => activity.name).filter((name) => !["Meditation", "Maintenance Yoga", "Work Out Yoga"].includes(name))];
  const visible = entries.filter((entry) => (filter === "All" || entry.type === filter) && `${entry.title} ${entry.note ?? ""} ${entry.type}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "Newest" ? entryTimestamp(b, now) - entryTimestamp(a, now) || String(b.id).localeCompare(String(a.id)) : entryTimestamp(a, now) - entryTimestamp(b, now) || String(a.id).localeCompare(String(b.id)));
  const monthGroups = visible.reduce<{ label: string; entries: JournalEntry[] }[]>((groups, entry) => {
    const label = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: DISPLAY_TIME_ZONE }).format(new Date(entryTimestamp(entry, now)));
    const current = groups.at(-1);
    if (current?.label === label) current.entries.push(entry); else groups.push({ label, entries: [entry] });
    return groups;
  }, []);
  const chooseEntry = (kind: "reflection" | "gratitude" | "prompt", prompt?: string) => { setEntryKind(kind); setPromptDraft(prompt); setChooser(false); setNewEntry(true); };
  return <section className="page journal-page"><PageHeader eyebrow="Your living record" title="Journal" action={<div className="header-actions"><button className="header-action" onClick={() => setSearching(!searching)}>Search <span>⌕</span></button><button className="header-action primary-header" onClick={() => setChooser(true)}>＋ New entry</button></div>} />{searching && <div className="journal-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes and activities…" /><button aria-label="Close search" onClick={() => { setSearch(""); setSearching(false); }}>×</button></div>}
    <div className="journal-main"><div className="journal-view-tabs">{(["List", "Month", "Year"] as const).map((item) => <button className={view === item ? "active" : ""} key={item} onClick={() => setView(item)}>{item}</button>)}</div>{view === "List" ? <><div className="journal-controls"><div className="filter-row">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><select aria-label="Sort journal" value={sort} onChange={(event) => setSort(event.target.value as "Newest" | "Oldest")}><option>Newest</option><option>Oldest</option></select></div><div className="journal-list">{monthGroups.map((group) => <section className="journal-month" key={group.label}><div className="month-marker"><span>{group.label}</span><i /></div>{group.entries.map((entry) => <JournalListEntry key={entry.id} entry={entry} entries={entries} cycleLog={cycleLog} expanded={expanded} setExpanded={setExpanded} onEdit={setEditingEntry} onDelete={setDeleteTarget} />)}</section>)}{visible.length === 0 && <div className="empty-state"><span>⌕</span><h2>No entries found</h2><p>Try another filter or add a new reflection.</p></div>}</div></> : <JournalCalendar entries={entries} mode={view} />}</div>
    {chooser && <JournalEntryChooser onChoose={chooseEntry} onClose={() => setChooser(false)} />}{newEntry && <NewEntryModal activities={activities} seedPrompt={promptDraft} seedType={entryKind === "gratitude" ? "Gratitude" : "Journal"} seedTitle={entryKind === "gratitude" ? "A grateful moment" : undefined} onClose={() => { setNewEntry(false); setPromptDraft(undefined); }} onSave={addEntry} />}{editingEntry && <NewEntryModal activities={activities} initial={editingEntry} onClose={() => setEditingEntry(null)} onSave={updateEntry} />}{deleteTarget && <ConfirmDeleteModal title={deleteTarget.title} onCancel={() => setDeleteTarget(null)} onConfirm={() => { deleteEntry(deleteTarget.id); setDeleteTarget(null); }} />}</section>;
}

function entryTimestamp(entry: JournalEntry, now: number) {
  if (entry.loggedAt) return entry.loggedAt; if (typeof entry.id === "number" && entry.id >= 1e12) return entry.id; if (entry.date.startsWith("Today")) return now; const match = entry.date.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/); if (!match) return typeof entry.id === "number" ? entry.id : now;
  const referenceParts = Object.fromEntries(displayDateParts.formatToParts(now).map((part) => [part.type, part.value])); const referenceYear = Number(referenceParts.year); const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]); let parsed = Date.UTC(referenceYear, month, Number(match[2]), 12); if (parsed > now + MILLISECONDS_PER_DAY) parsed = Date.UTC(referenceYear - 1, month, Number(match[2]), 12); return parsed;
}
function journalContexts(entry: JournalEntry, cycleLog: CycleLog, now: number) { const at = new Date(entryTimestamp(entry, now)); const moon = lunarPhase(at); const cycle = cycleSummary(cycleLog, at); return { lunar: entry.lunarContext ?? `${moon.name} · ${moon.illumination}%`, cycle: entry.cycleContext ?? `${cycle.phase} · day ${cycle.day}` }; }
function rangeCutoff(range: string, now: number) { const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : range === "1yr" ? 365 : 0; return days ? now - days * 86400000 : 0; }
type PracticeActivityType = "Meditation" | "Maintenance Yoga" | "Work Out Yoga";
const practiceActivityTypes: PracticeActivityType[] = ["Meditation", "Maintenance Yoga", "Work Out Yoga"];
function insightActivityType(id: InsightWidgetId): PracticeActivityType | null { return id === "meditation" ? "Meditation" : id === "maintenance-yoga" ? "Maintenance Yoga" : id === "workout-yoga" ? "Work Out Yoga" : null; }
function activityHistory(entries: JournalEntry[], type: PracticeActivityType, range: string, now: number) { const cutoff = rangeCutoff(range, now); return entries.filter((entry) => entry.type === type && (!cutoff || entryTimestamp(entry, now) >= cutoff)).sort((a, b) => entryTimestamp(a, now) - entryTimestamp(b, now)); }
function PracticeRhythmChart({ entries, range = "7d" }: { entries: JournalEntry[]; range?: string }) {
  const now = useStableNow(); const cutoff = rangeCutoff(range, now); const sessions = entries.filter((entry) => practiceActivityTypes.includes(entry.type as PracticeActivityType) && (!cutoff || entryTimestamp(entry, now) >= cutoff)).sort((a, b) => entryTimestamp(a, now) - entryTimestamp(b, now)); const max = Math.max(1, ...sessions.map((entry) => entry.duration ?? 0));
  return <div className="weekly-chart practice-rhythm-chart" aria-label={`Practice rhythm from logged entries in the ${range} range`}>{sessions.map((entry) => <div className="bar-column" key={entry.id} title={`${entry.type}: ${entry.duration ?? 0} minutes`}><div className="bar-stack"><i className={`${slug(entry.type)}-bar`} style={{ height: `${Math.max(5, (entry.duration ?? 0) / max * 100)}%` }} /></div><span>{new Date(entryTimestamp(entry, now)).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: DISPLAY_TIME_ZONE })}</span></div>)}{sessions.length === 0 && <div className="activity-history-empty">No meditation or yoga sessions logged in this range</div>}</div>;
}
function ActivityHistoryChart({ entries, type, range = "All", limit }: { entries: JournalEntry[]; type: PracticeActivityType; range?: string; limit?: number }) {
  const now = useStableNow(); const complete = activityHistory(entries, type, range, now); const history = typeof limit === "number" ? complete.slice(-limit) : complete; const max = Math.max(1, ...history.map((entry) => entry.duration ?? 0));
  return <div className={`activity-history-chart ${slug(type)}`} aria-label={`${type} session durations`}>{history.map((entry) => <div className="activity-history-bar" key={entry.id} title={`${entry.title}: ${entry.duration ?? 0} minutes`}><i style={{ height: `${Math.max(4, (entry.duration ?? 0) / max * 100)}%` }} /><span>{entry.duration ?? 0}</span></div>)}{history.length === 0 && <div className="activity-history-empty">No logged sessions in this range</div>}</div>;
}
function assessmentHistory(entries: JournalEntry[], items: string[], range: string, now: number) {
  const cutoff = rangeCutoff(range, now);
  return entries.filter((entry) => entry.assessments && items.some((item) => typeof entry.assessments?.[item]?.value === "number") && (!cutoff || entryTimestamp(entry, now) >= cutoff)).sort((a, b) => entryTimestamp(a, now) - entryTimestamp(b, now));
}
function patternSummary(entries: JournalEntry[], items: string[], now: number) {
  const history = assessmentHistory(entries, items, "All", now); if (!history.length) return { highlight: "No assessments yet", detail: "Move sliders and save an entry", change: "—", count: 0 };
  const latest = history[history.length - 1]; const previous = history.at(-2); let highlight = items[0]; let latestValue = latest.assessments?.[highlight]?.value ?? 0; let delta = previous ? latestValue - (previous.assessments?.[highlight]?.value ?? latestValue) : 0;
  items.forEach((item) => { const value = latest.assessments?.[item]?.value; if (typeof value !== "number") return; const itemDelta = previous ? value - (previous.assessments?.[item]?.value ?? value) : value; if (previous ? Math.abs(itemDelta) > Math.abs(delta) : value > latestValue) { highlight = item; latestValue = value; delta = itemDelta; } });
  return { highlight, detail: previous ? "Most changed since last entry" : "First recorded assessment", change: previous ? `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)}%` : `${latestValue}%`, count: history.length };
}
function AssessmentPatternChart({ entries, items, range = "All" }: { entries: JournalEntry[]; items: string[]; range?: string }) {
  const now = useStableNow(); const canvasRef = useRef<HTMLCanvasElement | null>(null); const history = assessmentHistory(entries, items, range, now);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const chartHistory = assessmentHistory(entries, items, range, now); const draw = () => { const rect = canvas.getBoundingClientRect(); if (rect.width < 2 || rect.height < 2) return; const ratio = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio); const context = canvas.getContext("2d"); if (!context) return; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height); const left = 3; const right = rect.width - 3; const top = 8; const bottom = rect.height - 8; context.lineWidth = 1; context.strokeStyle = "rgba(113,128,120,.16)"; for (let row = 0; row < 4; row += 1) { const y = top + (bottom - top) * row / 3; context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke(); } items.forEach((item, itemIndex) => { const points = chartHistory.map((entry, entryIndex) => { const value = entry.assessments?.[item]?.value; if (typeof value !== "number") return null; const x = chartHistory.length === 1 ? (left + right) / 2 : left + (right - left) * entryIndex / (chartHistory.length - 1); const y = bottom - (bottom - top) * Math.max(0, Math.min(100, value)) / 100; return { x, y }; }).filter((point): point is { x: number; y: number } => Boolean(point)); if (!points.length) return; context.strokeStyle = patternColors[itemIndex % patternColors.length]; context.fillStyle = patternColors[itemIndex % patternColors.length]; context.lineWidth = 2; context.lineJoin = "round"; context.lineCap = "round"; context.beginPath(); points.forEach((point, pointIndex) => { if (pointIndex === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); }); context.stroke(); points.forEach((point) => { context.beginPath(); context.arc(point.x, point.y, 2.6, 0, Math.PI * 2); context.fill(); }); }); }; draw(); const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(draw); observer?.observe(canvas); return () => observer?.disconnect(); }, [entries, items, range, now]);
  return <div className="assessment-chart"><canvas ref={canvasRef} aria-label={`Saved assessment history with ${history.length} entries`} />{history.length === 0 && <div className="chart-empty"><span>○</span><b>No slider history yet</b><small>Move the scales and save an entry to add the first point.</small></div>}</div>;
}

function TimePracticedModal({ entries, onClose }: { entries: JournalEntry[]; onClose: () => void }) {
  const practiced = entries.filter((entry) => entry.duration); const total = practiced.reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const categories = [
    { name: "Meditation", className: "meditation", minutes: practiced.filter((entry) => entry.type === "Meditation").reduce((sum, entry) => sum + (entry.duration ?? 0), 0) },
    { name: "Maintenance Yoga", className: "maintenance-yoga", minutes: practiced.filter((entry) => entry.type === "Maintenance Yoga").reduce((sum, entry) => sum + (entry.duration ?? 0), 0) },
    { name: "Work Out Yoga", className: "workout-yoga", minutes: practiced.filter((entry) => entry.type === "Work Out Yoga").reduce((sum, entry) => sum + (entry.duration ?? 0), 0) },
  ];
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="analytics-modal practice-time-modal" role="dialog" aria-modal="true" aria-labelledby="practice-time-title"><header className="modal-header"><div><p className="eyebrow">Expanded summary</p><h2 id="practice-time-title">Time practiced</h2></div><button className="close-button" aria-label="Close time practiced" onClick={onClose}>×</button></header><div className="practice-time-hero"><span>Total time practiced</span><strong>{formatPracticeDuration(total)}</strong><small>{practiced.length} logged {practiced.length === 1 ? "session" : "sessions"}</small></div><div className="practice-time-list" aria-label="Practice time by activity">{categories.map((category) => <div key={category.name}><span><i className={`calendar-dot ${category.className}`} />{category.name}</span><strong>{formatPracticeDuration(category.minutes)}</strong></div>)}</div><p className="source-caption"><span>↻</span> Calculated from logged meditation and yoga entries</p></section></div>;
}

function AnalyticsModal({ widget, entries, cycleLog, onClose }: { widget: InsightWidgetId; entries: JournalEntry[]; cycleLog: CycleLog; onClose: () => void }) {
  const now = useStableNow(); const [range, setRange] = useState("90d"); const title = widgetMeta[widget].title; const ranges = ["7d", "30d", "90d", "1yr", "All"]; const patternId = (["factors", "faculties", "characteristics", "hindrances"] as InsightWidgetId[]).includes(widget) ? widget as PatternWidgetId : null; const pattern = patternId ? patternWidgetData[patternId] : null; const history = pattern ? assessmentHistory(entries, pattern.items, range, now) : []; const latest = history.at(-1); const previous = history.at(-2); const activityType = insightActivityType(widget); const activityEntries = activityType ? activityHistory(entries, activityType, range, now) : []; const activityMinutes = activityEntries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const activityAverage = activityEntries.length ? Math.round(activityMinutes / activityEntries.length) : 0; const activityLongest = Math.max(0, ...activityEntries.map((entry) => entry.duration ?? 0)); const cutoff = rangeCutoff(range, now); const practiceEntries = entries.filter((entry) => practiceActivityTypes.includes(entry.type as PracticeActivityType) && (!cutoff || entryTimestamp(entry, now) >= cutoff)); const practiceMinutes = practiceEntries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0); const cycleHistory = (cycleLog.history ?? []).filter((item) => !cutoff || dateOnlyTimestamp(item.date) >= cutoff); const latestCycle = cycleHistory.at(-1); const latestTemperature = [...cycleHistory].reverse().find(day => cycleFieldRecorded(day, "temperature") && day.temperature !== undefined); const cycleInsights = deriveCycleInsights(cycleHistory);
  const count = pattern ? history.length : activityType ? activityEntries.length : widget === "cycle" || widget === "body" ? cycleHistory.length : practiceEntries.length;
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className={`analytics-modal ${widget === "cycle" || widget === "body" ? "cycle-analytics" : ""}`}><header className="modal-header"><div><p className="eyebrow">Expanded analytics</p><h2>{title}</h2></div><button className="close-button" onClick={onClose}>×</button></header><div className="range-tabs" style={{ "--range-offset": `${ranges.indexOf(range) * 100}%` } as React.CSSProperties}>{ranges.map((item) => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div><div className="analytics-hero"><div><span>Entries in view</span><strong>{count}</strong><small>{range} window</small></div>{pattern ? <AssessmentPatternChart entries={entries} items={pattern.items} range={range} /> : activityType ? <ActivityHistoryChart entries={entries} type={activityType} range={range} /> : widget === "cycle" || widget === "body" ? <CycleTrackingChart history={cycleHistory} /> : <PracticeRhythmChart entries={entries} range={range} />}</div>
    {pattern ? <div className="factor-table">{pattern.items.map((factor, index) => { const value = latest?.assessments?.[factor]?.value; const previousValue = previous?.assessments?.[factor]?.value; const delta = typeof value === "number" && typeof previousValue === "number" ? value - previousValue : null; return <div key={factor}><i style={{ background: patternColors[index % patternColors.length] }} /><span>{assessmentLabel(factor)}</span><b>{typeof value === "number" ? `${value}%` : "—"}</b><em>{delta === null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)}`}</em></div>; })}</div> : activityType ? <><div className="analytics-callouts"><article><span>Total practice</span><strong>{activityMinutes} min</strong></article><article><span>Average session</span><strong>{activityAverage} min</strong></article><article><span>Longest session</span><strong>{activityLongest} min</strong></article></div><div className="activity-history-list">{activityEntries.slice(-5).reverse().map((entry) => <div key={entry.id}><span><b>{entry.title}</b><small>{entry.date}</small></span><strong>{entry.duration ?? 0} min</strong></div>)}{activityEntries.length === 0 && <p>No {activityType.toLowerCase()} sessions were logged in this range.</p>}</div></> : widget === "cycle" || widget === "body" ? <><div className="analytics-callouts"><article><span>Latest temperature</span><strong>{latestTemperature?.temperature !== undefined ? `${latestTemperature.temperature.toFixed(2)}°C` : "—"}</strong></article><article><span>Cervical mucus</span><strong>{cycleFieldText(latestCycle, "cervicalMucus")}</strong></article><article><span>Sleep score</span><strong>{latestCycle?.sleepScore ?? "—"}</strong></article></div><div className="cycle-insight-list"><p><b>Temperature pattern</b>{cycleInsights.coverline ? `${cycleInsights.sustainedShift ? "A sustained rise is visible" : "No sustained rise yet"} · working coverline ${cycleInsights.coverline.toFixed(2)}°C` : "More valid temperature entries are needed for a shift pattern."}</p><p><b>Peak-type mucus</b>{cycleInsights.peakMucus ? `${cycleInsights.peakMucus.cervicalMucus} observed ${cycleInsights.peakMucus.date}` : "No watery or egg-white mucus logged in this range."}</p><p><b>Latest observations</b>{latestCycle ? `${cycleFieldText(latestCycle, "flow")} flow · ${cycleFieldText(latestCycle, "ovulationTest")} ovulation test · ${cycleFieldText(latestCycle, "symptoms")} symptoms` : "No observations in this range."}</p><p><b>Body signals</b>{latestCycle ? `Energy ${cycleFieldText(latestCycle, "energy")} · sex drive ${cycleFieldText(latestCycle, "sexDrive")} · PMS ${cycleFieldText(latestCycle, "pms")}` : "Log a cycle check-in to begin."}</p><p><b>Sleep pattern</b>{cycleInsights.averageSleep ? `${Math.floor(cycleInsights.averageSleep / 60)}h ${cycleInsights.averageSleep % 60}m average · latest score ${latestCycle?.sleepScore ?? "—"}` : "No sleep data logged."}</p><p><b>Common symptoms</b>{cycleInsights.commonSymptoms.length ? cycleInsights.commonSymptoms.join(" · ") : "No repeated symptoms in this range."}</p></div></> : <><div className="analytics-callouts"><article><span>Total practice</span><strong>{practiceMinutes} min</strong></article><article><span>Sessions</span><strong>{practiceEntries.length}</strong></article><article><span>Average session</span><strong>{practiceEntries.length ? Math.round(practiceMinutes / practiceEntries.length) : 0} min</strong></article></div></>}
    <p className="source-caption"><span>↻</span> {pattern ? "Calculated from saved slider assessments" : activityType ? `Calculated from logged ${activityType.toLowerCase()} entries` : widget === "cycle" || widget === "body" ? "App-derived estimates from saved body and cycle observations" : "Calculated from logged meditation and yoga entries"}</p>{(widget === "cycle" || widget === "body") && <p className="cycle-safety">Cycle predictions and temperature shifts are awareness tools, not contraception or medical advice.</p>}</section></div>;
}

function CycleLogModal({ cycleLog, onClose, onSave }: { cycleLog: CycleLog; onClose: () => void; onSave: (log: CycleLog) => void }) {
  const [draft, setDraft] = useState<CycleDayLog>(() => { const today = localCalendarDate(Date.now()); const previous = cycleLog.history?.find((item) => item.date === today); return previous ?? createCycleDraft(today); }); const [averageCycle, setAverageCycle] = useState(cycleLog.averageCycle); const [averagePeriod, setAveragePeriod] = useState(cycleLog.averagePeriod); const symptomOptions = ["Headache", "Tender breasts", "Cramps", "Bloating", "Fatigue", "Mood shift", "Acne", "Backache", "Nausea", "Cravings"]; const disturbanceOptions = ["Alcohol", "Medication", "Illness", "Travel", "Poor sleep", "Late temperature"];
  const update = <K extends keyof CycleDayLog>(key: K, value: CycleDayLog[K]) => setDraft((current) => updateCycleField(current, key, value)); const toggleList = (key: "symptoms" | "disturbances", item: string) => update(key, draft[key].includes(item) ? draft[key].filter((value) => value !== item) : [...draft[key], item]);
  return <div className="modal-backdrop" onPointerDown={(event) => dismissBackdrop(event, onClose)}><section className="builder-modal cycle-log-modal"><header className="modal-header"><div><p className="eyebrow">Body & cycle check-in</p><h2>Log today’s signals</h2></div><button className="close-button" onClick={onClose}>×</button></header><p className="modal-intro">Manual check-in (including transcribed measurements): temperature, mucus, cervix, tests, symptoms, feelings, disturbances and sleep. Untouched fields are unrecorded. Cycle estimates are calculated by this app, not imported measurements.</p>
    <div className="cycle-form-section"><h3>Day & bleeding</h3><div className="field-pair"><label>Date<input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /></label><label className="check-label"><input type="checkbox" checked={draft.cycleDayOne} onChange={(event) => update("cycleDayOne", event.target.checked)} />This is cycle day 1</label></div><div className="choice-chips wrap">{(["None", "Spotting", "Light", "Medium", "Heavy"] as const).map((item) => <button className={(draft.recordedFields === undefined || draft.recordedFields.includes("flow")) && draft.flow === item ? "active" : ""} onClick={() => update("flow", item)} key={item}>{item}</button>)}</div><div className="field-pair"><label>Average cycle<input type="number" min="15" max="60" value={averageCycle} onChange={(event) => setAverageCycle(Number(event.target.value))} /></label><label>Average period<input type="number" min="1" max="14" value={averagePeriod} onChange={(event) => setAveragePeriod(Number(event.target.value))} /></label></div></div>
    <div className="cycle-form-section"><h3>Temperature</h3><div className="field-pair"><label>Basal temperature °C<input type="number" min="34" max="42" step=".01" value={draft.temperature ?? ""} onChange={(event) => update("temperature", event.target.value ? Number(event.target.value) : undefined)} placeholder="36.45" /></label><label>Source<select value={draft.temperatureSource} onChange={(event) => update("temperatureSource", event.target.value as CycleDayLog["temperatureSource"])}><option>Manual</option><option>Tempdrop</option><option>Oral</option><option>Vaginal</option></select></label></div><label className="check-label"><input type="checkbox" checked={draft.questionableTemperature} onChange={(event) => update("questionableTemperature", event.target.checked)} />Mark this temperature as questionable</label><label className="check-label"><input type="checkbox" checked={draft.temperatureDisplayOverride ?? false} onChange={event => update("temperatureDisplayOverride", event.target.checked)} />Use this manual temperature instead of imported Tempdrop for this date</label></div>
    <div className="cycle-form-section"><h3>Cervical mucus</h3><div className="field-pair"><label>Observation<select value={draft.recordedFields === undefined || draft.recordedFields.includes("cervicalMucus") ? draft.cervicalMucus : ""} onChange={(event) => update("cervicalMucus", event.target.value as CycleDayLog["cervicalMucus"])}><option value="" disabled>Not recorded</option>{["None / dry", "Sticky", "Creamy", "Watery", "Egg white"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Sensation<select value={draft.recordedFields === undefined || draft.recordedFields.includes("mucusSensation") ? draft.mucusSensation : ""} onChange={(event) => update("mucusSensation", event.target.value as CycleDayLog["mucusSensation"])}><option value="" disabled>Not recorded</option>{["Dry", "Damp", "Wet", "Slippery"].map((item) => <option key={item}>{item}</option>)}</select></label></div></div>
    <div className="cycle-form-section"><h3>Cervix & tests</h3><div className="cycle-three-fields"><label>Position<select value={draft.recordedFields === undefined || draft.recordedFields.includes("cervixPosition") ? draft.cervixPosition : ""} onChange={(event) => update("cervixPosition", event.target.value as CycleDayLog["cervixPosition"])}><option value="" disabled>Not recorded</option>{["Low", "Medium", "High"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Firmness<select value={draft.recordedFields === undefined || draft.recordedFields.includes("cervixFirmness") ? draft.cervixFirmness : ""} onChange={(event) => update("cervixFirmness", event.target.value as CycleDayLog["cervixFirmness"])}><option value="" disabled>Not recorded</option>{["Firm", "Medium", "Soft"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Opening<select value={draft.recordedFields === undefined || draft.recordedFields.includes("cervixOpening") ? draft.cervixOpening : ""} onChange={(event) => update("cervixOpening", event.target.value as CycleDayLog["cervixOpening"])}><option value="" disabled>Not recorded</option>{["Closed", "Medium", "Open"].map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="field-pair"><label>Ovulation test<select value={draft.recordedFields === undefined || draft.recordedFields.includes("ovulationTest") ? draft.ovulationTest : ""} onChange={(event) => update("ovulationTest", event.target.value as CycleDayLog["ovulationTest"])}><option value="" disabled>Not recorded</option>{["Not tested", "Negative", "Positive", "Low", "High", "Peak"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Pregnancy test<select value={draft.recordedFields === undefined || draft.recordedFields.includes("pregnancyTest") ? draft.pregnancyTest : ""} onChange={(event) => update("pregnancyTest", event.target.value as CycleDayLog["pregnancyTest"])}><option value="" disabled>Not recorded</option>{["Not tested", "Negative", "Positive"].map((item) => <option key={item}>{item}</option>)}</select></label></div><label className="check-label"><input type="checkbox" checked={draft.intercourse} onChange={(event) => update("intercourse", event.target.checked)} />Intercourse</label></div>
    <div className="cycle-form-section"><h3>Body scan & symptoms</h3><div className="choice-chips wrap"><button className={draft.recordedFields?.includes("symptoms") && draft.symptoms.length === 0 ? "active" : ""} onClick={() => update("symptoms", [])}>None</button>{symptomOptions.map((item) => <button className={draft.symptoms.includes(item) ? "active" : ""} onClick={() => toggleList("symptoms", item)} key={item}>{item}</button>)}</div><div className="cycle-scales">{([['energy', 'Energy'], ['sexDrive', 'Sex drive'], ['pms', 'PMS']] as const).map(([key, label]) => <label key={key}><span>{label}<output>{draft.recordedFields === undefined || draft.recordedFields.includes(key) ? `${draft[key]}%` : "Not recorded"}</output></span><input type="range" min="0" max="100" value={draft[key]} onChange={(event) => update(key, Number(event.target.value))} /></label>)}</div></div>
    <div className="cycle-form-section"><h3>Disturbances & notes</h3><div className="choice-chips wrap"><button className={draft.recordedFields?.includes("disturbances") && draft.disturbances.length === 0 ? "active" : ""} onClick={() => update("disturbances", [])}>None</button>{disturbanceOptions.map((item) => <button className={draft.disturbances.includes(item) ? "active" : ""} onClick={() => toggleList("disturbances", item)} key={item}>{item}</button>)}</div><div className="field-pair"><label>Medication detail<input value={draft.medicationNote ?? ""} onChange={(event) => update("medicationNote", event.target.value)} placeholder="Name, dose or timing" /></label><label>Notes<input value={draft.notes ?? ""} onChange={(event) => update("notes", event.target.value)} placeholder="Anything else" /></label></div></div>
    <div className="cycle-form-section"><h3>Sleep</h3><div className="sleep-fields">{([['sleepScore','Score'],['sleepMinutes','Total min'],['deepSleepMinutes','Deep min'],['sleepLatencyMinutes','Latency min'],['sleepInterruptions','Interruptions']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" value={draft[key] ?? ""} onChange={(event) => update(key, event.target.value ? Number(event.target.value) : undefined)} /></label>)}</div></div>
    <button className="primary-button" onClick={() => { onSave(saveCycleDraft(cycleLog, draft, averageCycle, averagePeriod)); onClose(); }}><span>Save body & cycle check-in</span><span>→</span></button></section></div>;
}

function YiExperience({ initialNow, repository, uid, cloudBusy = false, blocked = false }: { initialNow: number; repository?: DataRepository; uid?: string; cloudBusy?: boolean; blocked?: boolean }) {
  const stableNow = initialNow;
  const [active, setActive] = useState<Screen>("Insights"); const [reflection, setReflection] = useState<ReflectionRequest | null>(null); const [cycleOpen, setCycleOpen] = useState(false); const [toast, setToast] = useState("");
  const { journal: entries, timers, activities, books, cycle: cycleLog, health, widgets, acceptImportedData, ready: loaded, issues, reload, setEntries, setTimers, setActivities, setBooks, setCycleLog, setDashboardWidgets, setHealth } = useAppData(defaultDashboardWidgets, repository);
  const [importing, setImporting] = useState(false);
  const displayCycleLog = cycleDisplayLog(cycleLog, health);
  const ready = loaded && !blocked && !importing;
  const dashboardWidgets = widgets.filter((id): id is DashboardWidgetId => id in dashboardWidgetMeta && !retiredDashboardWidgets.has(id as DashboardWidgetId));
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2800); return () => clearTimeout(id); }, [toast]);
  const notify = useCallback((message: string) => setToast(repository ? `${message.replace(/^Saved/, "Queued").replace(/\bsaved\b/gi, "queued").replace(/\bupdated\b/gi, "update queued").replace(/\bdeleted\b/gi, "deletion queued").replace(/\bremoved\b/gi, "removal queued")} · check cloud save status` : message), [repository]); const addEntry = (entry: JournalEntry) => { const loggedAt = entry.loggedAt ?? (typeof entry.id === "number" && entry.id >= 1e12 ? entry.id : Date.now()); const at = new Date(loggedAt); const moon = lunarPhase(at); const cycle = cycleSummary(cycleLog, at); const contextualEntry = { ...entry, loggedAt, lunarContext: entry.lunarContext ?? `${moon.name} · ${moon.illumination}%`, cycleContext: entry.cycleContext ?? `${cycle.phase} · day ${cycle.day}` }; setEntries((current) => [contextualEntry, ...current]); notify("Saved to your journal"); };
  const updateEntry = (entry: JournalEntry) => { setEntries((current) => current.map((item) => item.id === entry.id ? entry : item)); notify("Journal entry updated"); };
  const deleteEntry = (id: RecordId) => { setEntries((current) => current.filter((item) => item.id !== id)); notify("Journal entry deleted"); };
  const saveCycle = (log: CycleLog) => { const latest = log.history.at(-1); const cycle = cycleSummary(log, new Date()); setCycleLog(log); const modified = log.history.find(item => item.recordOrigin === "user" && item.recordedFields !== undefined && JSON.stringify(item) !== JSON.stringify(cycleLog.history.find(previous => previous.id === item.id)));
    if (modified) setHealth(current => reconcileManualHealthRecords(modified, current, new Date().toISOString()));
    addEntry({ id: createRecordId(), type: "Period", title: "Body & cycle check-in", date: "Today · just now", cycleContext: `${cycle.phase} · day ${cycle.day}`, note: `${cycleFieldText(modified ?? latest, "flow")} flow${log.symptoms.length ? ` · ${log.symptoms.join(", ")}` : ""}${log.temperature ? ` · ${log.temperature.toFixed(2)}°C` : ""}${latest ? ` · ${cycleFieldText(latest, "cervicalMucus")} mucus` : ""}` }); };
  return <StableNowContext.Provider value={stableNow}><main className="app-shell" inert={!ready}><Navigation active={active} setActive={setActive} cloud={Boolean(repository)} /><div hidden={active !== "Insights"}><TodayScreen setActive={setActive} entries={entries} cycleLog={displayCycleLog} onCycleLog={() => setCycleOpen(true)} openReflection={setReflection} widgets={dashboardWidgets} setWidgets={(next) => setDashboardWidgets(current => typeof next === "function" ? next(current.filter((id): id is DashboardWidgetId => id in dashboardWidgetMeta)) : next)} addEntry={addEntry} books={books} setBooks={setBooks} /></div><div hidden={active !== "Practice"}><PracticeScreen timers={timers} setTimers={setTimers} openReflection={setReflection} notify={notify} /></div><div hidden={active !== "Journal"}><JournalScreen entries={entries} activities={activities} cycleLog={displayCycleLog} addEntry={addEntry} updateEntry={updateEntry} deleteEntry={deleteEntry} /></div>{reflection && <ReflectionModal request={reflection} activities={activities} setActivities={setActivities} onClose={() => setReflection(null)} onSave={addEntry} />}{cycleOpen && <CycleLogModal cycleLog={cycleLog} onClose={() => setCycleOpen(false)} onSave={saveCycle} />}{repository ? <section className="page" aria-label="Cloud data safety">{!loaded && <p role="status">Loading private cloud data. Editing remains disabled until loading succeeds.</p>}{issues.map(issue => <p role="alert" key={issue.dataset}>{issue.message}</p>)}</section> : <DataTools issues={issues} reload={reload} />}{toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}</main><HealthKitTools uid={uid} repository={repository} onImported={acceptImportedData} onBusy={setImporting} cloudBusy={cloudBusy || !loaded} /></StableNowContext.Provider>;
}

export default function YiApp({ initialNow }: { initialNow: number }) {
  const snapshot = useSyncExternalStore(cloudSession.subscribe, cloudSession.snapshot, cloudSession.snapshot);
  const repository = snapshot.mode === "cloud" ? cloudSession.repository() : undefined;
  return <>{snapshot.mode === "signed-out" ? <main className="app-shell"><section className="page"><h1>Yi</h1><p>Sign in to open your private cloud journal, practice, and wellbeing data.</p></section><CloudPanel snapshot={snapshot} /></main> : <>
    {snapshot.mode === "cloud" && <section className="page" aria-live="polite"><p role={snapshot.save === "failed" ? "alert" : "status"}>{snapshot.operation === "loading" ? "Loading private cloud data…" : snapshot.save === "pending" ? "Saving cloud changes…" : snapshot.save === "failed" ? snapshot.error : "Private cloud · changes saved"}</p></section>}
    <YiExperience key={snapshot.mode === "cloud" ? `cloud:${snapshot.identity?.uid}:${snapshot.revision}` : "local"} initialNow={initialNow} repository={repository} uid={snapshot.mode === "cloud" ? snapshot.identity?.uid : undefined} cloudBusy={snapshot.save === "pending"} blocked={snapshot.mode === "cloud" && snapshot.save === "failed"} />
  </>}{snapshot.mode !== "signed-out" && <CloudPanel snapshot={snapshot} />}</>;
}

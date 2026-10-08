import { dateOnlyParts } from "../../domain/dates/calendar";
import { HEALTH_METRICS } from "../../domain/health/types";
const timestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const timeZone = (value: unknown) => { try { if (typeof value !== "string" || !value) return false; new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } };

export const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const id = (v: unknown) => (typeof v === "string" && v.length > 0) || (finite(v) && Number.isSafeInteger(v));
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === "string");
const numbers = (v: unknown) => Array.isArray(v) && v.every(finite);
const optional = (v: Record<string, unknown>, fields: string[], check: (value: unknown) => boolean) => fields.every(k => v[k] === undefined || check(v[k]));
const metadata = (value: unknown) => object(value) && Object.values(value).every(item => typeof item === "string");
const enumValue = (value: unknown, values: string[]) => typeof value === "string" && values.includes(value);
const assessments = (v: unknown) => object(v) && Object.values(v).every(x => object(x) && finite(x.value) && (x.note === undefined || typeof x.note === "string"));
export const journalValid = (v: unknown) => object(v) && id(v.id) && [v.type, v.title, v.date].every(x => typeof x === "string") && optional(v, ["duration", "loggedAt"], finite) && optional(v, ["note", "mood", "lunarContext", "cycleContext"], x => typeof x === "string") && optional(v, ["tags"], strings) && optional(v, ["assessments"], assessments);
export const timerValid = (v: unknown) => object(v) && id(v.id) && typeof v.name === "string" && finite(v.seconds) && Number(v.seconds) > 0 && enumValue(v.color, ["sage", "gold", "coral"]) && optional(v, ["interval"], x => finite(x) && Number(x) > 0) && optional(v, ["gongs"], numbers) && optional(v, ["gongSounds"], strings) && optional(v, ["startGong", "endGong", "intervalGong"], x => typeof x === "string");
export const activityValid = (v: unknown) => object(v) && id(v.id) && typeof v.name === "string" && typeof v.icon === "string" && enumValue(v.color, ["sage", "gold", "coral", "plum"]);
export const bookValid = (v: unknown) => object(v) && id(v.id) && typeof v.title === "string" && optional(v, ["author"], x => typeof x === "string") && optional(v, ["startedOn", "finishedOn"], x => typeof x === "string" && Boolean(dateOnlyParts(x))) && optional(v, ["yearRead"], finite) && optional(v, ["finished"], x => typeof x === "boolean") && optional(v, ["assessments"], assessments);
export const cycleDayValid = (v: unknown) => {
  if (!object(v) || !id(v.id) || typeof v.date !== "string" || !dateOnlyParts(v.date)) return false;
  const enums: Record<string, string[]> = {
    flow: ["None", "Spotting", "Light", "Medium", "Heavy"], temperatureSource: ["Manual", "Tempdrop", "Oral", "Vaginal"],
    cervicalMucus: ["None / dry", "Sticky", "Creamy", "Watery", "Egg white"], mucusSensation: ["Dry", "Damp", "Wet", "Slippery"],
    cervixPosition: ["Low", "Medium", "High"], cervixFirmness: ["Firm", "Medium", "Soft"], cervixOpening: ["Closed", "Medium", "Open"],
    ovulationTest: ["Not tested", "Negative", "Positive", "Low", "High", "Peak"], pregnancyTest: ["Not tested", "Negative", "Positive"],
  };
  return Object.entries(enums).every(([k, values]) => enumValue(v[k], values)) && ["cycleDayOne", "questionableTemperature", "intercourse"].every(k => typeof v[k] === "boolean") && ["energy", "sexDrive", "pms"].every(k => finite(v[k])) && ["symptoms", "disturbances"].every(k => strings(v[k])) && optional(v, ["temperature", "sleepScore", "sleepMinutes", "deepSleepMinutes", "sleepLatencyMinutes", "sleepInterruptions"], finite) && optional(v, ["medicationNote", "notes"], x => typeof x === "string") && optional(v, ["recordedFields"], strings) && optional(v, ["recordOrigin"], x => enumValue(x, ["user", "sample", "legacy-unverified"]));
};
export const cycleValid = (v: unknown) => object(v) && typeof v.lastPeriod === "string" && (v.lastPeriod === "" || Boolean(dateOnlyParts(v.lastPeriod))) && finite(v.averageCycle) && Number(v.averageCycle) > 0 && finite(v.averagePeriod) && Number(v.averagePeriod) > 0 && enumValue(v.flow, ["None", "Spotting", "Light", "Medium", "Heavy"]) && strings(v.symptoms) && optional(v, ["temperature"], finite) && Array.isArray(v.history) && v.history.every(cycleDayValid) && new Set(v.history.filter(object).map(r => `${typeof r.id}:${r.id}`)).size === v.history.length && new Set(v.history.filter(object).map(r => r.date)).size === v.history.length;
export const quoteValid = (v: unknown) => object(v) && typeof v.signature === "string" && numbers(v.order) && Number.isInteger(v.day) && Number.isInteger(v.position);
export const practiceValid = (v: unknown) => object(v) && enumValue(v.mode, ["Timer", "Stopwatch"]) && finite(v.duration) && Number(v.duration) > 0 && optional(v, ["endAt", "startedAt"], finite) && ["openingGong", "closingGong", "intervalGong"].every(k => v[k] === undefined || typeof v[k] === "string") && typeof v.intervalEnabled === "boolean" && finite(v.intervalMinutes) && Number(v.intervalMinutes) > 0 && numbers(v.customGongs) && optional(v, ["customGongSounds"], strings);
export const healthValid = (v: unknown) => object(v) && typeof v.id === "string" && v.id.length > 0 && v.schemaVersion === 1 && typeof v.metric === "string" && HEALTH_METRICS.some(metric => metric === v.metric) && object(v.value) && typeof v.value.unit === "string" && ((v.value.kind === "quantity" && v.value.unit.length > 0 && finite(v.value.value)) || (v.value.kind === "category" && v.value.unit === "category" && typeof v.value.value === "string") || (v.value.kind === "boolean" && v.value.unit === "boolean" && typeof v.value.value === "boolean") || (v.value.kind === "list" && v.value.unit === "category" && strings(v.value.value))) && typeof v.localDate === "string" && Boolean(dateOnlyParts(v.localDate)) && timeZone(v.timeZone) && object(v.provenance) && typeof v.provenance.provider === "string" && v.provenance.provider.length > 0 && enumValue(v.provenance.ingestion, ["manual", "healthkit", "tempdrop-csv", "wearable", "legacy-migration"]) && enumValue(v.status, ["recorded", "questionable", "estimated", "legacy-unverified", "superseded", "deleted"]) && [v.createdAt, v.updatedAt].every(timestamp) && optional(v, ["observedAt", "startAt", "endAt"], timestamp) && (!(v.startAt && v.endAt) || Date.parse(String(v.endAt)) >= Date.parse(String(v.startAt))) && optional(v.provenance, ["originalSourceId", "sourceAppId", "sourceDeviceId", "importBatchId", "method"], x => typeof x === "string") && optional(v.provenance, ["metadata"], metadata) && optional(v.provenance, ["storage"], x => enumValue(x, ["local-session-inspection", "repository", "cloud"])) && (v.confidence === undefined || (object(v.confidence) && enumValue(v.confidence.level, ["unknown", "low", "medium", "high"]) && optional(v.confidence, ["reason"], x => typeof x === "string")));

export function parseArray(value: unknown, valid: (v: unknown) => boolean) {
  if (!Array.isArray(value)) throw new Error("Expected a list; original data retained");
  if (!value.every(valid)) throw new Error("Invalid record found; original data retained and this collection is protected from writes");
  const ids = value.filter(object).map(v => `${typeof v.id}:${v.id}`);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate IDs; collection protected from writes");
  return value;
}

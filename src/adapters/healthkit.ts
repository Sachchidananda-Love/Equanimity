import { Capacitor, registerPlugin } from "@capacitor/core";
import type { HealthMetric, HealthRecord, HealthValue } from "../domain/health/types";
import { healthValid, object } from "./local/validation";
import { healthKitProvider } from "../domain/health/import-policy";

export type HealthKitTypeStatus = {
  identifier: string;
  displayName: string;
  available: boolean;
  readAuthorization: "not-exposed-by-healthkit";
};

export type HealthKitStatus = {
  available: boolean;
  platform: string;
  readAuthorizationStatus: "not-exposed-by-healthkit" | "unavailable";
  message: string;
  requestedTypes: HealthKitTypeStatus[];
  authorizationRequestCompleted?: boolean;
};

type NativeHealthKitPlugin = {
  isAvailable(): Promise<HealthKitStatus>;
  requestAuthorization(): Promise<HealthKitStatus>;
  inspect(options?: { days?: number }): Promise<HealthKitInspection>;
};

export type HealthKitInspection = {
  available: boolean;
  queriedFrom?: string;
  queriedTo?: string;
  records: HealthKitSample[];
  errors: { typeIdentifier: string; message: string }[];
  message: string;
};

export type HealthKitSample = {
  uuid: string;
  typeIdentifier: string;
  sampleType: string;
  value: HealthValue;
  categoryValue?: number;
  startDate: string;
  endDate: string;
  localDate: string;
  timeZone: string;
  source: {
    name: string;
    bundleIdentifier: string;
    version?: string;
    productType?: string;
    provider: string;
  };
  device?: Record<string, string>;
  metadata: Record<string, string>;
};

export const healthKitPlugin = registerPlugin<NativeHealthKitPlugin>("EquanimityHealthKit");

export async function healthKitStatus(): Promise<HealthKitStatus> {
  if (Capacitor.getPlatform() !== "ios") {
    return {
      available: false,
      platform: Capacitor.getPlatform(),
      readAuthorizationStatus: "unavailable",
      message: "HealthKit inspection is available only in the iOS app.",
      requestedTypes: [],
    };
  }
  try {
    return await healthKitPlugin.isAvailable();
  } catch (error) {
    return {
      available: false,
      platform: "ios",
      readAuthorizationStatus: "unavailable",
      message: `HealthKit bridge unavailable: ${String(error)}`,
      requestedTypes: [],
    };
  }
}

export async function requestHealthKitAuthorization() {
  if (Capacitor.getPlatform() !== "ios") return healthKitStatus();
  return healthKitPlugin.requestAuthorization();
}

export async function inspectHealthKit(days = 30): Promise<HealthKitInspection> {
  if (Capacitor.getPlatform() !== "ios") return { available: false, records: [], errors: [], message: "HealthKit inspection is available only in the iOS app." };
  return healthKitPlugin.inspect({ days });
}

function metricForType(identifier: string): HealthMetric | null {
  if (identifier === "HKQuantityTypeIdentifierBasalBodyTemperature") return "basal-temperature";
  if (identifier === "HKCategoryTypeIdentifierSleepAnalysis") return "sleep-stage";
  if (identifier === "HKCategoryTypeIdentifierMenstrualFlow") return "menstrual-flow";
  if (identifier === "HKCategoryTypeIdentifierCervicalMucusQuality") return "cervical-mucus";
  if (identifier === "HKCategoryTypeIdentifierOvulationTestResult") return "ovulation-test";
  if (identifier === "HKCategoryTypeIdentifierSexualActivity") return "intercourse";
  return null;
}

function normalizedValue(sample: HealthKitSample): HealthValue {
  if (sample.typeIdentifier === "HKCategoryTypeIdentifierCervicalMucusQuality" && sample.value.kind === "category") {
    const values: Record<string, string> = { dry: "None / dry", "egg-white": "Egg white" };
    return { ...sample.value, value: values[sample.value.value] ?? `${sample.value.value.charAt(0).toUpperCase()}${sample.value.value.slice(1)}` };
  }
  if (sample.typeIdentifier === "HKCategoryTypeIdentifierMenstrualFlow" && sample.value.kind === "category") return { ...sample.value, value: `${sample.value.value.charAt(0).toUpperCase()}${sample.value.value.slice(1)}` };
  return sample.value;
}

export function normalizeHealthKitRecords(samples: HealthKitSample[], now = new Date().toISOString()): HealthRecord[] {
  if (!Array.isArray(samples)) throw new Error("Malformed HealthKit response; no records were imported");
  return samples.flatMap((sample): HealthRecord[] => {
    assertNativeSample(sample);
    const metric = metricForType(sample.typeIdentifier);
    if (!metric) return [];
    const uuid = sample.uuid.toUpperCase();
    const value = normalizedValue(sample);
    const provenance = {
      provider: healthKitProvider(sample.source.name, sample.source.bundleIdentifier),
      ingestion: "healthkit" as const,
      originalSourceId: uuid,
      sourceAppId: sample.source.bundleIdentifier,
      ...(sample.device?.localIdentifier ? { sourceDeviceId: sample.device.localIdentifier } : {}),
      method: `healthkit:${sample.typeIdentifier}`,
      storage: "local-session-inspection" as const,
      metadata: {
        sourceName: sample.source.name,
        ...(sample.source.version ? { sourceVersion: sample.source.version } : {}),
        ...(sample.source.productType ? { sourceProductType: sample.source.productType } : {}),
        ...sample.device,
        ...sample.metadata,
        typeIdentifier: sample.typeIdentifier,
        ...(sample.categoryValue !== undefined ? { categoryValue: String(sample.categoryValue) } : {}),
      },
    };
    const record: HealthRecord = {
      id: `healthkit:${uuid}`,
      schemaVersion: 1,
      metric,
      value,
      observedAt: sample.startDate,
      startAt: sample.startDate,
      endAt: sample.endDate,
      localDate: sample.localDate,
      timeZone: sample.timeZone,
      provenance,
      status: "recorded",
      confidence: { level: "unknown", reason: "Imported from a HealthKit sample; source selection has not been applied." },
      createdAt: now,
      updatedAt: now,
    };
    if (!healthValid(record)) throw new Error("Malformed HealthKit record; no records were imported");
    return [record];
  });
}

function assertNativeSample(value: unknown): asserts value is HealthKitSample {
  const strings = (item: unknown) => object(item) && Object.values(item).every(v => typeof v === "string" && v.length <= 4096);
  if (!object(value) || typeof value.uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.uuid)
    || ![value.typeIdentifier, value.sampleType, value.startDate, value.endDate, value.localDate, value.timeZone].every(v => typeof v === "string" && v.length > 0)
    || !object(value.source) || typeof value.source.name !== "string" || typeof value.source.bundleIdentifier !== "string" || !value.source.bundleIdentifier
    || (value.source.version !== undefined && typeof value.source.version !== "string")
    || (value.source.productType !== undefined && typeof value.source.productType !== "string")
    || !strings(value.metadata) || (value.device !== undefined && !strings(value.device))
    || !object(value.value)) throw new Error("Malformed HealthKit sample; no records were imported");
  const metric = metricForType(String(value.typeIdentifier));
  if (metric === "basal-temperature" && (value.value.kind !== "quantity" || value.value.unit !== "Cel" || typeof value.value.value !== "number" || !Number.isFinite(value.value.value))) throw new Error("Invalid basal temperature sample");
  if (["sleep-stage", "menstrual-flow", "cervical-mucus", "ovulation-test"].includes(metric ?? "")
    && (value.value.kind !== "category" || value.value.unit !== "category" || typeof value.value.value !== "string")) throw new Error("Invalid HealthKit category sample");
  if (metric === "intercourse" && (value.value.kind !== "boolean" || value.value.unit !== "boolean" || value.value.value !== true)) throw new Error("Invalid HealthKit sexual activity sample");
}

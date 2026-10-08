import { Capacitor, registerPlugin } from "@capacitor/core";
import type { HealthMetric, HealthRecord, HealthValue } from "../domain/health/types";
import { DISPLAY_TIME_ZONE } from "../domain/dates/calendar";

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
    version: string;
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
  return samples.flatMap((sample): HealthRecord[] => {
    const metric = metricForType(sample.typeIdentifier);
    if (!metric || !sample.uuid || !sample.startDate || !sample.endDate || !sample.localDate) return [];
    const value = normalizedValue(sample);
    const provenance = {
      provider: sample.source.provider || "other source",
      ingestion: "healthkit" as const,
      originalSourceId: sample.uuid,
      sourceAppId: sample.source.bundleIdentifier,
      ...(sample.device?.localIdentifier ? { sourceDeviceId: sample.device.localIdentifier } : {}),
      method: `healthkit:${sample.typeIdentifier}`,
      storage: "local-session-inspection" as const,
      metadata: {
        sourceName: sample.source.name,
        sourceVersion: sample.source.version,
        ...(sample.source.productType ? { sourceProductType: sample.source.productType } : {}),
        ...sample.device,
        ...sample.metadata,
      },
    };
    return [{
      id: `healthkit:${sample.uuid}`,
      schemaVersion: 1,
      metric,
      value,
      observedAt: sample.startDate,
      startAt: sample.startDate,
      endAt: sample.endDate,
      localDate: sample.localDate,
      timeZone: sample.timeZone || DISPLAY_TIME_ZONE,
      provenance,
      status: "recorded",
      confidence: { level: "unknown", reason: "Imported from a HealthKit sample; source selection has not been applied." },
      createdAt: now,
      updatedAt: now,
    }];
  });
}

export const HEALTH_SCHEMA_VERSION = 1;
export const HEALTH_METRICS = ["basal-temperature","body-temperature","skin-temperature","sleep-duration","sleep-stage","sleep-score","sleep-latency","sleep-interruptions","menstrual-flow","cervical-mucus","mucus-sensation","cervix-position","cervix-firmness","cervix-opening","ovulation-test","pregnancy-test","intercourse","symptoms","energy","sex-drive","pms","disturbances","mood","activity","heart-rate"] as const;
export type HealthMetric = typeof HEALTH_METRICS[number];
export type HealthValue = { kind: "quantity"; value: number; unit: string } | { kind: "category"; value: string; unit: "category" } | { kind: "boolean"; value: boolean; unit: "boolean" } | { kind: "list"; value: string[]; unit: "category" };
export type HealthRecord = {
  id: string;
  schemaVersion: 1;
  metric: HealthMetric;
  value: HealthValue;
  observedAt?: string;
  startAt?: string;
  endAt?: string;
  localDate: string;
  timeZone: string;
  provenance: {
    provider: string;
    ingestion: "manual" | "healthkit" | "tempdrop-csv" | "wearable" | "legacy-migration";
    originalSourceId?: string;
    sourceAppId?: string;
    sourceDeviceId?: string;
    importBatchId?: string;
    method?: string;
  };
  status: "recorded" | "questionable" | "estimated" | "legacy-unverified" | "superseded" | "deleted";
  confidence?: { level: "unknown" | "low" | "medium" | "high"; reason?: string };
  createdAt: string;
  updatedAt: string;
};

/** Summaries reference source records; they are never imported measurements. */
export type DailyHealthSummary = {
  localDate: string;
  timeZone: string;
  schemaVersion: 1;
  calculationVersion: string;
  sourceRecordIds: string[];
  values: Partial<Record<HealthMetric, { value: HealthValue; sourceRecordIds: string[] }>>;
  computedAt: string;
};

export const UUID_A = "11111111-1111-4111-8111-111111111111";
export const UUID_B = "22222222-2222-4222-8222-222222222222";
export const UUID_C = "33333333-3333-4333-8333-333333333333";
export const timestamp = "2026-10-07T12:00:00.000Z";

/** Synthetic bridge payloads only. No copied device health values. */
export function healthKitSample(overrides = {}) {
  return {
    uuid: UUID_A, typeIdentifier: "HKQuantityTypeIdentifierBasalBodyTemperature", sampleType: "Basal body temperature",
    value: { kind: "quantity", value: 36.4, unit: "Cel" }, startDate: timestamp, endDate: timestamp,
    localDate: "2026-10-07", timeZone: "America/Toronto",
    source: { name: "Tempdrop", bundleIdentifier: "com.tempdrop.synthetic", version: "1", provider: "Tempdrop" },
    device: { name: "Synthetic sensor", model: "Fixture", localIdentifier: "synthetic-device" },
    metadata: { "healthkit.HKTimeZone": "America/Toronto", arbitraryPrivateNote: "Never upload this inspection detail" },
    ...overrides,
  };
}

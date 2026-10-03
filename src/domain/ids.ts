export type RecordId = string | number;

/** New records use UUIDs; legacy numeric IDs remain unchanged. */
export function createRecordId(): string { return globalThis.crypto.randomUUID(); }

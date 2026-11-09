import type { Snapshot } from "./model";

export type StoredSnapshot = { snapshot: Snapshot; version: string };
export interface SnapshotStore {
  read(signal: AbortSignal): Promise<StoredSnapshot | null>;
  // A null version creates the first snapshot; otherwise replace that exact version.
  write(
    snapshot: Snapshot,
    version: string | null,
    signal: AbortSignal,
  ): Promise<boolean>;
}

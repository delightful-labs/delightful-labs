import {
  createActor,
  type InputFrom,
  type ActorLogic,
  type SnapshotFrom,
  type EventFrom,
} from "xstate";
import { parseReaderConfig } from "./config";
import type { ReaderConfig, Snapshot, SnapshotStorage } from "./model";
import { readerMachine, type ReaderActor } from "./reader-machine";

export type { Article, ReaderConfig, Snapshot } from "./model";

export class PublicationReader {
  private readonly actor: ReaderActor;

  constructor(
    config: ReaderConfig,
    storage?: SnapshotStorage,
    logic: ActorLogic<
      SnapshotFrom<typeof readerMachine>,
      EventFrom<typeof readerMachine>,
      InputFrom<typeof readerMachine>
    > = readerMachine,
  ) {
    this.actor = createActor(logic, {
      input: { config: parseReaderConfig(config), storage },
    }).start();
  }

  read(): Promise<Snapshot | null> {
    if (this.actor.getSnapshot().status !== "active")
      return Promise.reject(new Error("Reader stopped"));
    return new Promise((resolve, reject) =>
      this.actor.send({
        type: "READ",
        at: Date.now(),
        reply: { resolve, reject },
      }),
    );
  }

  stop(): void {
    if (this.actor.getSnapshot().status === "active")
      this.actor.send({ type: "STOP" });
  }
}

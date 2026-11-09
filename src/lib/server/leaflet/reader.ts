import { createActor } from "xstate";
import { parseReaderConfig } from "./config";
import { readJson } from "./http";
import { loadSnapshot } from "./load-snapshot";
import type { ReaderConfig, ReaderDependencies, Snapshot } from "./model";
import { readerMachine, type ReaderActor } from "./reader-machine";

export type { Article, ReaderConfig, Snapshot } from "./model";

export class PublicationReader {
  private readonly actor: ReaderActor;
  private readonly now: () => number;

  constructor(config: ReaderConfig, dependencies: ReaderDependencies = {}) {
    const parsed = parseReaderConfig(config);
    const json = dependencies.json ?? readJson;
    this.now = dependencies.now ?? Date.now;
    this.actor = createActor(readerMachine, {
      input: {
        configured: parsed !== null,
        now: this.now,
        load: async (signal) => {
          if (!parsed) throw new Error("Unconfigured reader cannot load");
          return loadSnapshot(parsed, json, this.now, signal);
        },
      },
    }).start();
  }

  read(): Promise<Snapshot | null> {
    if (this.actor.getSnapshot().status !== "active")
      return Promise.reject(new Error("Reader stopped"));
    return new Promise((resolve, reject) =>
      this.actor.send({
        type: "READ",
        at: this.now(),
        reply: { resolve, reject },
      }),
    );
  }

  stop(): void {
    if (this.actor.getSnapshot().status === "active")
      this.actor.send({ type: "STOP" });
  }
}

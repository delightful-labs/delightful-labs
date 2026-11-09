import { createAsyncLogic, setup, types } from "xstate";
import { articlesMachine } from "./articles-machine";
import { rpcUrl } from "./client";
import { readJson } from "./http";
import { identityUrl } from "./identity";
import type { Article, ConfiguredReader, Snapshot } from "./model";
import { recordsMachine } from "./records-machine";
import {
  commitSchema,
  identitySchema,
  pdsUrlSchema,
  publicationSchema,
  type DocumentRecord,
} from "./schemas";

type Input = { config: ConfiguredReader };
type Connected = Input & { pds: string };
type Committed = Connected & { commit: string };
type Published = Committed & { publication: Snapshot["publication"] };
type Enumerated = Published & { records: DocumentRecord[] };
type Prepared = Published & { articles: Article[] };
type Context = Input & Partial<Enumerated & Prepared & { snapshot: Snapshot }>;

export const snapshotMachine = setup({
  schemas: {
    context: types<Context>(),
    input: types<Input>(),
    output: types<Snapshot>(),
  },
  actors: {
    resolveIdentity: createAsyncLogic({
      schemas: { input: types<Input>() },
      run: async ({ input, signal }) => {
        const did = input.config.ownerDid;
        const identity = identitySchema.parse(
          await readJson(identityUrl(did), signal),
        );
        if (identity.id !== did) throw new Error("DID document mismatch");
        const service = identity.service.find(
          (s) => s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`,
        );
        return new URL(pdsUrlSchema.parse(service?.serviceEndpoint)).origin;
      },
    }),
    readCommit: createAsyncLogic({
      schemas: { input: types<Connected>() },
      run: async ({ input, signal }) =>
        commitSchema.parse(
          await readJson(
            rpcUrl(input.pds, "com.atproto.sync.getLatestCommit", {
              did: input.config.ownerDid,
            }),
            signal,
          ),
        ).cid,
    }),
    readPublication: createAsyncLogic({
      schemas: { input: types<Committed>() },
      run: async ({ input, signal }): Promise<Snapshot["publication"]> => {
        const record = publicationSchema.parse(
          await readJson(
            rpcUrl(input.pds, "com.atproto.repo.getRecord", {
              repo: input.config.ownerDid,
              collection: "site.standard.publication",
              rkey: input.config.publicationKey,
            }),
            signal,
          ),
        );
        if (record.uri !== input.config.publicationUri)
          throw new Error("Publication mismatch");
        return {
          uri: record.uri,
          name: record.value.name,
          sourceUrl: new URL(record.value.url).href,
        };
      },
    }),
    enumerateRecords: recordsMachine,
    prepareArticles: articlesMachine,
    captureVerificationTime: createAsyncLogic({ run: async () => Date.now() }),
    failDeadline: createAsyncLogic({
      run: async () => {
        throw new Error("Archive refresh timeout");
      },
    }),
    failChangedCommit: createAsyncLogic({
      run: async () => {
        throw new Error("Repository changed during scan; retry later");
      },
    }),
  },
  states: {
    readingInitialCommit: { schemas: { context: types<Connected>() } },
    readingPublication: { schemas: { context: types<Committed>() } },
    enumeratingRecords: { schemas: { context: types<Published>() } },
    preparingArticles: { schemas: { context: types<Enumerated>() } },
    verifyingCommit: { schemas: { context: types<Prepared>() } },
    recordingVerification: { schemas: { context: types<Prepared>() } },
    complete: { schemas: { context: types<{ snapshot: Snapshot }>() } },
  },
}).createMachine({
  id: "snapshotLoad",
  context: ({ input }) => ({ ...input }),
  initial: "resolvingIdentity",
  timeout: 40_000,
  onTimeout: { target: ".timedOut" },
  states: {
    resolvingIdentity: {
      invoke: {
        src: "resolveIdentity",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "readingInitialCommit",
          context: { pds: event.output },
        }),
      },
    },
    readingInitialCommit: {
      invoke: {
        src: "readCommit",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "readingPublication",
          context: { commit: event.output },
        }),
      },
    },
    readingPublication: {
      invoke: {
        src: "readPublication",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "enumeratingRecords",
          context: { publication: event.output },
        }),
      },
    },
    enumeratingRecords: {
      invoke: {
        src: "enumerateRecords",
        input: ({ context }) => ({
          pds: context.pds,
          ownerDid: context.config.ownerDid,
        }),
        onDone: ({ event }) => ({
          target: "preparingArticles",
          context: { records: event.output },
        }),
      },
    },
    preparingArticles: {
      invoke: {
        src: "prepareArticles",
        input: ({ context }) => context,
        onDone: ({ event }) => ({
          target: "verifyingCommit",
          context: { articles: event.output },
        }),
      },
    },
    verifyingCommit: {
      invoke: {
        src: "readCommit",
        input: ({ context }) => context,
        onDone: ({ context, event }) => ({
          target:
            event.output === context.commit
              ? "recordingVerification"
              : "changed",
        }),
      },
    },
    recordingVerification: {
      invoke: {
        src: "captureVerificationTime",
        onDone: ({ context, event }) => ({
          target: "complete",
          context: {
            snapshot: {
              publication: context.publication,
              articles: context.articles,
              verifiedAt: event.output,
              stale: false,
            },
          },
        }),
      },
    },
    timedOut: { invoke: { src: "failDeadline" } },
    changed: { invoke: { src: "failChangedCommit" } },
    complete: { type: "final", output: ({ context }) => context.snapshot },
  },
  output: ({ output }) => output,
});

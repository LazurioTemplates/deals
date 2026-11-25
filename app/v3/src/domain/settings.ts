import { z } from "zod";
import { currencyCode, slug, text, writeRevision, writtenAt, writtenBy } from "./common.ts";
import { probability } from "./money.ts";

/**
 * The settings of Deals, one record per data repository
 * (`data/settings/settings.yaml`). The stages of the pipeline, the reasons a
 * deal is lost and the names of the salespeople are data the Organization
 * edits in the App, never constants in the code.
 */
export const SETTINGS_ID = "settings";

/** How a stage counts: still open, won or lost. */
export const STAGE_KINDS = ["open", "won", "lost"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/**
 * One stage of the pipeline. Stages are kept in the order of the pipeline;
 * the probability of a stage is the default chance a deal in it is won.
 */
export const stage = z.strictObject({
  id: slug,
  label: text,
  kind: z.enum(STAGE_KINDS),
  probability,
});

/** Why a deal was lost: `price`, `competitor`. */
export const lossReason = z.strictObject({
  id: slug,
  label: text,
});

export const settings = z.strictObject({
  currency: currencyCode.describe("The currency of every amount, ISO 4217; CZK by default."),
  stages: z
    .array(stage)
    .min(3)
    .describe(
      "The pipeline in order: at least one open stage, exactly one won (100) and one lost (0).",
    ),
  lossReasons: z.array(lossReason).min(1),
  owners: z
    .array(text)
    .optional()
    .describe("The salespeople a deal is usually assigned to; another name only warns."),
  aresLookup: z.boolean().describe("Whether the App looks companies up in ARES by their IČO."),
  revision: writeRevision,
  updatedAt: writtenAt,
  updatedBy: writtenBy,
});

export type Settings = z.infer<typeof settings>;
export type Stage = z.infer<typeof stage>;
export type LossReason = z.infer<typeof lossReason>;

/** The stage a stage id names, or undefined. */
export function stageById(value: Pick<Settings, "stages">, id: string): Stage | undefined {
  return value.stages.find((entry) => entry.id === id);
}

/** The loss reason a reason id names, or undefined. */
export function lossReasonById(
  value: Pick<Settings, "lossReasons">,
  id: string,
): LossReason | undefined {
  return value.lossReasons.find((entry) => entry.id === id);
}

/** The open stages in pipeline order. */
export function openStages(value: Pick<Settings, "stages">): Stage[] {
  return value.stages.filter((entry) => entry.kind === "open");
}

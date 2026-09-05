import { describe, expect, it } from "vitest";

import { buildActions } from "./LibraryRoomParts";
import type { ManagedDownloadStatus } from "./downloadTypes";
import type { CatalogGame } from "./types";

const game: CatalogGame = {
  id: 1,
  slug: "matrix",
  name: "Matrix",
  app_id: 42,
  credit_cost_per_hour: 0,
  copies_total: 1,
  copies_available: 1,
};

const status = (state: ManagedDownloadStatus["state"], installed = false): ManagedDownloadStatus => ({
  app_id: 42,
  state,
  progress: state === "downloading" ? 50 : null,
  bytes_downloaded: null,
  bytes_total: null,
  installed,
  job_id: "job-42",
});

describe("exclusive primary library action", () => {
  it("offers only Download when not installed", () => {
    expect(buildActions(game, status("not-installed"), false).map((action) => action.kind)).toEqual(["download"]);
  });

  it("offers only Cancel while active", () => {
    expect(buildActions(game, status("preparing"), false).map((action) => action.kind)).toEqual(["cancel"]);
    expect(buildActions(game, status("downloading"), false).map((action) => action.kind)).toEqual(["cancel"]);
  });

  it("offers disabled Cancelando while cancellation is pending", () => {
    const actions = buildActions(game, status("cancelling"), false);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("cancel");
    expect(actions[0]?.disabled).toBe(true);
  });

  it("offers only Play for a confirmed install", () => {
    expect(buildActions(game, status("installed", true), false).map((action) => action.kind)).toEqual(["play"]);
  });

  it("does not infer absence from unknown verification", () => {
    const actions = buildActions(game, status("unknown"), false);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("verify");
    expect(actions[0]?.disabled).toBe(true);
  });

  it("keeps installed Play disabled when no license exists instead of offering Download", () => {
    const actions = buildActions({ ...game, copies_available: 0, local_primary_account_label: undefined }, status("installed", true), false);
    expect(actions.map((action) => action.kind)).toEqual(["play"]);
    expect(actions[0]?.disabled).toBe(true);
  });
});

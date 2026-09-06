import type {
  GridCell,
  ProfileLocations,
  Stop,
  Weights,
} from "../data/types.js";

export type WorkerRequest =
  | { type: "init"; stops: Stop[]; grid: GridCell[] }
  | {
      type: "compute";
      requestId: number;
      locations: ProfileLocations;
      weights: Weights;
    };

export type WorkerResponse =
  | { type: "ready" }
  | {
      type: "result";
      requestId: number;
      scores: number[];
      profileCosts: number[];
    };

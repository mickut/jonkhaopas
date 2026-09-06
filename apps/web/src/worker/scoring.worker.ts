/// <reference lib="webworker" />
import { computeScores } from "./cost.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.js";
import type { GridCell, Stop } from "../data/types.js";

let stops: Stop[] = [];
let grid: GridCell[] = [];

function post(message: WorkerResponse): void {
  (self as unknown as Worker).postMessage(message);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    stops = message.stops;
    grid = message.grid;
    post({ type: "ready" });
    return;
  }
  if (message.type === "compute") {
    const { scores, profileCosts } = computeScores(
      stops,
      grid,
      message.locations,
      message.weights,
    );
    post({
      type: "result",
      requestId: message.requestId,
      scores: Array.from(scores),
      profileCosts: Array.from(profileCosts),
    });
  }
};

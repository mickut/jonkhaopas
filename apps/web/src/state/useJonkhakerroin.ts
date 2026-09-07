import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGrid, loadMeta, loadStops } from "../data/loadData.js";
import {
  PROFILES,
  type GridCell,
  type Location,
  type Meta,
  type Profile,
  type ProfileLocations,
  type Stop,
  type Weights,
} from "../data/types.js";
import type { WorkerRequest, WorkerResponse } from "../worker/protocol.js";

export const MAX_LOCATIONS = 5;
/** Profile weights are fixed (not user-controlled) — see WeightControls, which now exposes a
 * single "traveler patience" slider that shapes the score-to-color curve instead. Ratio 3:2:1. */
export const FIXED_WEIGHTS: Weights = {
  work: 0.6,
  weekdayEvening: 0.4,
  weekend: 0.2,
};
export const DEFAULT_PATIENCE = 0.75;
export const DEFAULT_PROFILE_LOCATIONS: ProfileLocations = {
  work: [],
  weekdayEvening: [],
  weekend: [],
};
/** Debounce recompute so dragging a pin or a slider doesn't flood the worker. */
const RECOMPUTE_DEBOUNCE_MS = 120;

export type JonkhakerroinState = {
  meta: Meta | null;
  grid: GridCell[];
  ready: boolean;
  locations: ProfileLocations;
  activeProfile: Profile;
  isPicking: boolean;
  patience: number;
  scores: Float64Array | null;
  profileCosts: Float64Array | null;
  setActiveProfile: (profile: Profile) => void;
  setPicking: (isPicking: boolean) => void;
  addLocation: (profile: Profile, location: Location) => void;
  removeLocation: (profile: Profile, index: number) => void;
  updateLocation: (profile: Profile, index: number, location: Location) => void;
  setPatience: (value: number) => void;
};

export function useJonkhakerroin(): JonkhakerroinState {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [grid, setGrid] = useState<GridCell[]>([]);
  const [ready, setReady] = useState(false);
  const [locations, setLocations] = useState<ProfileLocations>(
    DEFAULT_PROFILE_LOCATIONS,
  );
  const [activeProfile, setActiveProfile] = useState<Profile>("work");
  const [isPicking, setIsPicking] = useState(true);
  const [patience, setPatience] = useState<number>(DEFAULT_PATIENCE);
  const [scores, setScores] = useState<Float64Array | null>(null);
  const [profileCosts, setProfileCosts] = useState<Float64Array | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const nextRequestId = useRef(0);
  const latestHandledRequestId = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadStops(), loadGrid(), loadMeta()]).then(
      ([loadedStops, loadedGrid, loadedMeta]) => {
        if (cancelled) return;
        setStops(loadedStops);
        setGrid(loadedGrid);
        setMeta(loadedMeta);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (stops.length === 0 || grid.length === 0) return;

    const worker = new Worker(
      new URL("../worker/scoring.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "ready") {
        setReady(true);
        return;
      }
      if (message.type === "result") {
        if (message.requestId < latestHandledRequestId.current) return;
        latestHandledRequestId.current = message.requestId;
        setScores(Float64Array.from(message.scores));
        setProfileCosts(Float64Array.from(message.profileCosts));
      }
    };

    const initMessage: WorkerRequest = { type: "init", stops, grid };
    worker.postMessage(initMessage);

    return () => {
      worker.terminate();
      workerRef.current = null;
      setReady(false);
    };
  }, [stops, grid]);

  const requestCompute = useCallback(
    (nextLocations: ProfileLocations, nextWeights: Weights) => {
      const worker = workerRef.current;
      if (!worker || !ready) return;
      const requestId = nextRequestId.current++;
      const message: WorkerRequest = {
        type: "compute",
        requestId,
        locations: nextLocations,
        weights: nextWeights,
      };
      worker.postMessage(message);
    },
    [ready],
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const hasAllProfileLocations = PROFILES.every(
      (profile) => locations[profile].length > 0,
    );
    if (!hasAllProfileLocations) {
      nextRequestId.current++;
      latestHandledRequestId.current = nextRequestId.current;
      setScores(null);
      setProfileCosts(null);
      return;
    }
    debounceTimer.current = setTimeout(() => {
      requestCompute(locations, FIXED_WEIGHTS);
    }, RECOMPUTE_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [locations, requestCompute]);

  const addLocation = useCallback((profile: Profile, location: Location) => {
    setLocations((prev) =>
      prev[profile].length >= MAX_LOCATIONS
        ? prev
        : { ...prev, [profile]: [...prev[profile], location] },
    );
  }, []);

  const removeLocation = useCallback((profile: Profile, index: number) => {
    setLocations((prev) => ({
      ...prev,
      [profile]: prev[profile].filter((_, i) => i !== index),
    }));
  }, []);

  const updateLocation = useCallback(
    (profile: Profile, index: number, location: Location) => {
      setLocations((prev) => ({
        ...prev,
        [profile]: prev[profile].map((existing, i) =>
          i === index ? location : existing,
        ),
      }));
    },
    [],
  );

  const setActiveProfileValue = useCallback((profile: Profile) => {
    setActiveProfile(profile);
    setIsPicking(true);
  }, []);

  const setPickingValue = useCallback((value: boolean) => {
    setIsPicking(value);
  }, []);

  const setPatienceValue = useCallback((value: number) => {
    setPatience(value);
  }, []);

  return useMemo(
    () => ({
      meta,
      grid,
      ready,
      locations,
      activeProfile,
      isPicking,
      patience,
      scores,
      profileCosts,
      setActiveProfile: setActiveProfileValue,
      setPicking: setPickingValue,
      addLocation,
      removeLocation,
      updateLocation,
      setPatience: setPatienceValue,
    }),
    [
      meta,
      grid,
      ready,
      locations,
      activeProfile,
      isPicking,
      setActiveProfileValue,
      setPickingValue,
      patience,
      scores,
      profileCosts,
      addLocation,
      removeLocation,
      updateLocation,
      setPatienceValue,
    ],
  );
}

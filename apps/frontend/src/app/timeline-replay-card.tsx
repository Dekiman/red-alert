import { useEffect, useMemo, useRef, useState } from "react";
import type { PolygonReplayEventPayload, PolygonReplayTimelinePayload } from "./contracts.js";
import { formatTime } from "./text-utils.js";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Clock, 
  Zap, 
  History,
  AlertCircle,
  Activity,
  ChevronDown,
  ChevronUp
} from "lucide-react";

const STATE_WINDOW_MINUTES = 15;

const REPLAY_RANGE_OPTIONS = [
  {
    key: "10m",
    label: "10m",
    minutes: 10,
    scrubStepSeconds: 2,
    targetPlaybackDurationSeconds: 30,
    maxFrameStepSeconds: 2
  },
  {
    key: "1h",
    label: "1h",
    minutes: 60,
    scrubStepSeconds: 10,
    targetPlaybackDurationSeconds: 45,
    maxFrameStepSeconds: 10
  },
  {
    key: "24h",
    label: "24h",
    minutes: 24 * 60,
    scrubStepSeconds: 60,
    targetPlaybackDurationSeconds: 75,
    maxFrameStepSeconds: 60
  },
  {
    key: "3d",
    label: "3d",
    minutes: 3 * 24 * 60,
    scrubStepSeconds: 5 * 60,
    targetPlaybackDurationSeconds: 90,
    maxFrameStepSeconds: 3 * 60
  },
  {
    key: "7d",
    label: "7d",
    minutes: 7 * 24 * 60,
    scrubStepSeconds: 15 * 60,
    targetPlaybackDurationSeconds: 105,
    maxFrameStepSeconds: 8 * 60
  },
  {
    key: "30d",
    label: "30d",
    minutes: 30 * 24 * 60,
    scrubStepSeconds: 60 * 60,
    targetPlaybackDurationSeconds: 120,
    maxFrameStepSeconds: 20 * 60
  }
] as const;

type ReplayRangeKey = (typeof REPLAY_RANGE_OPTIONS)[number]["key"];
type ReplayRangeOption = (typeof REPLAY_RANGE_OPTIONS)[number];

const REPLAY_SPEED_MIN = 0.5;
const REPLAY_SPEED_MAX = 10;
const REPLAY_SPEED_STEP = 0.5;

type ReplaySpeedMultiplier = number;

interface TimelineReplayCardProps {
  onReplayModeChanged: (active: boolean) => void;
  onReplayStateChanged?: (state: ReplayStatePayload) => void;
  onReplayTimelineEventsChanged?: (events: PolygonReplayEventPayload[]) => void;
}

export interface ReplayStatePayload {
  active: boolean;
  rangeKey: ReplayRangeKey;
  rangeMinutes: number;
  stateWindowMinutes: number;
  rangeFromUnix: number | null;
  rangeToUnix: number | null;
  replayUnix: number | null;
}

interface ReplayTransitionDelta {
  toActiveSiren: number;
  toPostSirenUnsafe: number;
  cleared: number;
}

interface ReplayStateItem {
  localityId: number;
  stage: "active_siren" | "post_siren_unsafe";
}

function toReplayTimelinePayload(data: unknown): PolygonReplayTimelinePayload | null {
  if (typeof data !== "object" || data === null) return null;
  const partial = data as Partial<PolygonReplayTimelinePayload>;
  if (!Number.isFinite(Number(partial.rangeFromUnix))) return null;
  if (!Number.isFinite(Number(partial.rangeToUnix))) return null;
  return {
    rangeFromUnix: Number(partial.rangeFromUnix),
    rangeToUnix: Number(partial.rangeToUnix),
    stateWindowMinutes: Number(partial.stateWindowMinutes),
    events: Array.isArray(partial.events) ? (partial.events as PolygonReplayEventPayload[]) : []
  };
}

function getRangeOptionByKey(rangeKey: ReplayRangeKey): ReplayRangeOption {
  return REPLAY_RANGE_OPTIONS.find((option) => option.key === rangeKey) ?? REPLAY_RANGE_OPTIONS[0];
}

function buildReplayStatesAtUnix(
  events: PolygonReplayEventPayload[],
  cursorUnix: number,
  windowMinutes: number
): ReplayStateItem[] {
  const windowSeconds = windowMinutes * 60;
  const windowStartUnix = cursorUnix - windowSeconds;

  const latestByLocality = new Map<number, PolygonReplayEventPayload>();
  for (const event of events) {
    const timestamp = Number(event.alertTimestampUnix);
    if (timestamp > cursorUnix || timestamp < windowStartUnix) {
      continue;
    }
    const existing = latestByLocality.get(event.localityId);
    if (!existing || timestamp > Number(existing.alertTimestampUnix)) {
      latestByLocality.set(event.localityId, event);
    }
  }

  const results: ReplayStateItem[] = [];
  for (const [localityId, event] of latestByLocality) {
    const timestamp = Number(event.alertTimestampUnix);
    const sirenEndUnix = timestamp + 90; 
    results.push({
      localityId,
      stage: cursorUnix <= sirenEndUnix ? "active_siren" : "post_siren_unsafe"
    });
  }

  return results;
}

export function TimelineReplayCard({
  onReplayModeChanged,
  onReplayStateChanged,
  onReplayTimelineEventsChanged
}: TimelineReplayCardProps) {
  const [isReplayActive, setIsReplayActive] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedRangeKey, setSelectedRangeKey] = useState<ReplayRangeKey>("10m");
  const [timelinePayload, setTimelinePayload] = useState<PolygonReplayTimelinePayload | null>(null);
  const [replayUnix, setReplayUnix] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<ReplaySpeedMultiplier>(1);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [transitionDelta, setTransitionDelta] = useState<ReplayTransitionDelta | null>(null);
  const previousStageByLocalityRef = useRef<Map<number, ReplayStateItem["stage"]>>(new Map());

  const selectedRange = useMemo(() => getRangeOptionByKey(selectedRangeKey), [selectedRangeKey]);
  const timelineEvents = useMemo(() => 
    Array.isArray(timelinePayload?.events) ? timelinePayload.events : []
  , [timelinePayload]);
  const timelineFromUnix = Number(timelinePayload?.rangeFromUnix ?? 0);
  const timelineToUnix = Number(timelinePayload?.rangeToUnix ?? 0);
  const effectiveReplayUnix =
    Number.isFinite(replayUnix) && replayUnix != null ? replayUnix : Number.isFinite(timelineToUnix) ? timelineToUnix : null;
  const cursorUnixFloor = Number.isFinite(effectiveReplayUnix) ? Math.floor(Number(effectiveReplayUnix)) : null;
  
  const cursorEventCount = useMemo(() => {
    if (!Number.isFinite(cursorUnixFloor)) {
      return 0;
    }
    return timelineEvents.reduce((count, eventItem) => {
      const eventUnix = Number(eventItem?.alertTimestampUnix);
      if (!Number.isFinite(eventUnix)) {
        return count;
      }
      return eventUnix === cursorUnixFloor ? count + 1 : count;
    }, 0);
  }, [timelineEvents, cursorUnixFloor]);

  const playbackSecondsPerSecond = Math.max(
    1,
    (selectedRange.minutes * 60 * playbackSpeed) / selectedRange.targetPlaybackDurationSeconds
  );

  const applyCursorUnix = (nextUnix: number) => {
    if (!Number.isFinite(nextUnix) || !hasTimeline) {
      return;
    }
    const clamped = Math.max(timelineFromUnix, Math.min(timelineToUnix, Math.floor(nextUnix)));
    setIsPlaying(false);
    setReplayUnix(clamped);
  };

  const loadReplayTimeline = async (rangeMinutes: number) => {
    setLoading(true);
    setErrorText(null);
    try {
      const url = `/api/polygon-states/replay?rangeMinutes=${encodeURIComponent(
        rangeMinutes
      )}&stateWindowMinutes=${STATE_WINDOW_MINUTES}`;
      const response = await fetch(url, { cache: "no-store" });
      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 140)}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        if (rawText.trim().startsWith("<")) {
          throw new Error(
            "Replay API returned HTML instead of JSON. Start/restart backend on 127.0.0.1:8787."
          );
        }
        throw new Error("Replay API returned invalid JSON payload.");
      }

      const payload = toReplayTimelinePayload(parsed);
      if (!payload) {
        throw new Error("Invalid replay payload");
      }
      previousStageByLocalityRef.current.clear();
      setTransitionDelta(null);
      setTimelinePayload(payload);
      setReplayUnix(Number(payload.rangeToUnix));
    } catch (error) {
      previousStageByLocalityRef.current.clear();
      setTransitionDelta(null);
      setTimelinePayload(null);
      setReplayUnix(null);
      setErrorText(error instanceof Error ? error.message : "Failed to load replay data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    onReplayModeChanged(isReplayActive);
    if (!isReplayActive) {
      setIsPlaying(false);
      previousStageByLocalityRef.current.clear();
      setTransitionDelta(null);
    }
  }, [isReplayActive, onReplayModeChanged]);

  useEffect(() => {
    onReplayStateChanged?.({
      active: isReplayActive,
      rangeKey: selectedRangeKey,
      rangeMinutes: selectedRange.minutes,
      stateWindowMinutes: Number.isFinite(Number(timelinePayload?.stateWindowMinutes))
        ? Math.max(1, Math.floor(Number(timelinePayload?.stateWindowMinutes)))
        : STATE_WINDOW_MINUTES,
      rangeFromUnix: Number.isFinite(timelineFromUnix) ? timelineFromUnix : null,
      rangeToUnix: Number.isFinite(timelineToUnix) ? timelineToUnix : null,
      replayUnix: Number.isFinite(effectiveReplayUnix) ? Number(effectiveReplayUnix) : null
    });
  }, [
    onReplayStateChanged,
    isReplayActive,
    selectedRangeKey,
    selectedRange.minutes,
    timelineFromUnix,
    timelineToUnix,
    effectiveReplayUnix,
    timelinePayload?.stateWindowMinutes
  ]);

  useEffect(() => {
    if (!onReplayTimelineEventsChanged) {
      return;
    }
    onReplayTimelineEventsChanged(isReplayActive ? timelineEvents : []);
  }, [onReplayTimelineEventsChanged, isReplayActive, timelineEvents]);

  useEffect(() => {
    if (!isReplayActive) {
      return;
    }
    void loadReplayTimeline(selectedRange.minutes);
  }, [isReplayActive, selectedRange.minutes]);

  useEffect(() => {
    if (!isReplayActive || !isPlaying || !timelinePayload || effectiveReplayUnix == null) {
      return;
    }

    let animationFrameId = 0;
    let lastFrameAtMs: number | null = null;
    let accumulatedMs = 0;

    const stepPlayback = (frameAtMs: number) => {
      if (lastFrameAtMs == null) {
        lastFrameAtMs = frameAtMs;
        animationFrameId = window.requestAnimationFrame(stepPlayback);
        return;
      }

      accumulatedMs += Math.min(frameAtMs - lastFrameAtMs, 100);
      lastFrameAtMs = frameAtMs;

      const elapsedMs = accumulatedMs;
      accumulatedMs = 0;

      setReplayUnix((currentValue) => {
        const currentUnix = Number.isFinite(currentValue) ? Number(currentValue) : timelineFromUnix;
        const frameDeltaSeconds = Math.min(
          (elapsedMs / 1000) * playbackSecondsPerSecond,
          selectedRange.maxFrameStepSeconds
        );
        const nextUnix = Math.min(currentUnix + frameDeltaSeconds, timelineToUnix);
        if (nextUnix >= timelineToUnix) {
          setIsPlaying(false);
          return timelineToUnix;
        }
        return nextUnix;
      });

      animationFrameId = window.requestAnimationFrame(stepPlayback);
    };

    animationFrameId = window.requestAnimationFrame(stepPlayback);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    isReplayActive,
    isPlaying,
    timelinePayload,
    effectiveReplayUnix,
    playbackSecondsPerSecond,
    selectedRange.maxFrameStepSeconds,
    timelineFromUnix,
    timelineToUnix
  ]);

  useEffect(() => {
    if (!isReplayActive || !timelinePayload || effectiveReplayUnix == null) {
      return;
    }

    const stateWindowMinutes = Number(timelinePayload.stateWindowMinutes ?? STATE_WINDOW_MINUTES);
    const replayStates = buildReplayStatesAtUnix(timelineEvents, effectiveReplayUnix, stateWindowMinutes);
    const nextStageByLocality = new Map<number, ReplayStateItem["stage"]>();
    let toActiveSiren = 0;
    let toPostSirenUnsafe = 0;
    let cleared = 0;

    for (const replayState of replayStates) {
      nextStageByLocality.set(replayState.localityId, replayState.stage);
      const previousStage = previousStageByLocalityRef.current.get(replayState.localityId);
      if (!previousStage) {
        if (replayState.stage === "active_siren") {
          toActiveSiren += 1;
        } else {
          toPostSirenUnsafe += 1;
        }
        continue;
      }
      if (previousStage !== replayState.stage) {
        if (replayState.stage === "active_siren") {
          toActiveSiren += 1;
        } else {
          toPostSirenUnsafe += 1;
        }
      }
    }

    for (const previousLocalityId of previousStageByLocalityRef.current.keys()) {
      if (!nextStageByLocality.has(previousLocalityId)) {
        cleared += 1;
      }
    }

    previousStageByLocalityRef.current = nextStageByLocality;
    setTransitionDelta((prev) => {
      if (
        prev?.toActiveSiren === toActiveSiren &&
        prev?.toPostSirenUnsafe === toPostSirenUnsafe &&
        prev?.cleared === cleared
      ) {
        return prev;
      }
      return { toActiveSiren, toPostSirenUnsafe, cleared };
    });
  }, [isReplayActive, timelinePayload, timelineEvents, effectiveReplayUnix]);

  const hasTimeline = Number.isFinite(timelineFromUnix) && Number.isFinite(timelineToUnix) && timelineToUnix >= timelineFromUnix;
  const replayProgressValue =
    hasTimeline && Number.isFinite(effectiveReplayUnix)
      ? Math.max(timelineFromUnix, Math.min(timelineToUnix, Number(effectiveReplayUnix)))
      : timelineToUnix;

  return (
    <section 
      className={`card transition-all duration-200 border-l-2 ${isReplayActive ? "border-l-orange-500 bg-orange-500/5" : "border-l-transparent bg-white/[0.03]"}`} 
      aria-label="Incident timeline replay"
    >
      <div className={`flex flex-col ${isCollapsed ? "p-2 px-3" : "gap-4 p-4"}`}>
        <div className="flex justify-between items-center gap-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h3 className="text-[13px] font-bold tracking-tight text-orange-500 uppercase flex items-center gap-1.5 truncate">
              <History className="w-3.5 h-3.5 shrink-0" />
              Timeline Replay
              {isCollapsed && isReplayActive && (
                <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              )}
            </h3>
            {!isCollapsed && (
              <p className="text-[11px] text-muted-foreground font-medium leading-tight">
                Scrub historical state and transitions.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isCollapsed && (
              <button
                type="button"
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all focus-visible:ring-1 focus-visible:ring-orange-500 focus-visible:outline-none ${isReplayActive ? "bg-orange-500 text-white" : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10"}`}
                onClick={() => setIsReplayActive((current) => !current)}
              >
                {isReplayActive ? "Live View" : "Start Replay"}
              </button>
            )}
            <button
              type="button"
              className="p-1 rounded-md text-muted-foreground hover:text-orange-500 hover:bg-white/5 transition-colors"
              onClick={() => setIsCollapsed(!isCollapsed)}
              aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
            >
              {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="flex flex-col gap-4 animate-in fade-in duration-300">
            {isReplayActive ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap gap-1">
                  {REPLAY_RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`px-2 py-1 rounded text-[10px] font-bold tabular-nums transition-colors ${selectedRangeKey === option.key ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "bg-white/5 text-muted-foreground border border-white/5 hover:border-white/10"}`}
                      onClick={() => setSelectedRangeKey(option.key)}
                      disabled={loading}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                    disabled={!hasTimeline || loading}
                    onClick={() => {
                      if (isPlaying) {
                        setIsPlaying(false);
                        return;
                      }
                      if (!hasTimeline) return;
                      setReplayUnix((currentValue) => {
                        const currentUnix = Number.isFinite(currentValue) ? Number(currentValue) : timelineToUnix;
                        return currentUnix >= timelineToUnix ? timelineFromUnix : currentUnix;
                      });
                      setIsPlaying(true);
                    }}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>

                  <button
                    type="button"
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50"
                    disabled={loading}
                    onClick={() => void loadReplayTimeline(selectedRange.minutes)}
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                  </button>

                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex justify-between items-center text-[9px] uppercase font-bold tracking-widest text-muted-foreground/60">
                      <span>Playback Speed</span>
                      <span className="text-orange-400 tabular-nums">{playbackSpeed.toFixed(1)}x</span>
                    </div>
                    <input
                      className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-500"
                      type="range"
                      min={REPLAY_SPEED_MIN}
                      max={REPLAY_SPEED_MAX}
                      step={REPLAY_SPEED_STEP}
                      value={playbackSpeed}
                      disabled={loading}
                      onChange={(event) => setPlaybackSpeed(Number(event.currentTarget.value))}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-mono font-bold text-orange-400 tabular-nums">
                      {effectiveReplayUnix ? formatTime(new Date(effectiveReplayUnix * 1000).toISOString()) : "--:--:--"}
                    </span>
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground/50 uppercase font-bold">
                      <Clock className="w-3 h-3" />
                      {selectedRange.label}&nbsp;Window
                    </div>
                  </div>
                  <input
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    type="range"
                    min={hasTimeline ? timelineFromUnix : 0}
                    max={hasTimeline ? timelineToUnix : 0}
                    step={selectedRange.scrubStepSeconds}
                    value={hasTimeline ? replayProgressValue : 0}
                    disabled={!hasTimeline || loading}
                    onChange={(event) => applyCursorUnix(Number(event.currentTarget.value))}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Events</span>
                    <span className="text-[11px] font-bold text-slate-100 tabular-nums">
                      {timelineEvents.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">At Cursor</span>
                    <span className="text-[11px] font-bold text-slate-100 tabular-nums">
                      {cursorEventCount}
                    </span>
                  </div>
                  {transitionDelta && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Sirens</span>
                      <span className="text-[11px] font-bold text-red-400 tabular-nums">
                        +{transitionDelta.toActiveSiren}
                      </span>
                    </div>
                  )}
                </div>

                {loading && (
                  <div className="flex items-center justify-center py-2">
                    <RotateCcw className="w-4 h-4 text-orange-500 animate-spin" />
                  </div>
                )}

                {errorText && (
                  <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] font-medium text-red-400 leading-tight">{errorText}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 p-2 bg-emerald-500/5 border border-emerald-500/10 rounded">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <p className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-tight">Live Stream Active</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

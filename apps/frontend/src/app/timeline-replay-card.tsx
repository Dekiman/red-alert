import { useEffect, useMemo, useRef, useState } from "react";
import type { PolygonReplayEventPayload, PolygonReplayTimelinePayload } from "./contracts.js";
import { formatTime } from "./text-utils.js";

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
const REPLAY_SPEED_MIN = 0.5;
const REPLAY_SPEED_MAX = 10;
const REPLAY_SPEED_STEP = 0.5;

type ReplayRangeOption = (typeof REPLAY_RANGE_OPTIONS)[number];
type ReplayRangeKey = ReplayRangeOption["key"];
type ReplaySpeedMultiplier = number;

interface ReplayStateItem {
  localityId: number;
  stage: "active_siren" | "post_siren_unsafe";
  stageStartedAtUnix: number;
  latestAlertTimestampUnix: number;
}

interface TimelineReplayCardProps {
  onReplayModeChanged: (active: boolean) => void;
  onReplayStateChanged?: (state: ReplayTimelineState) => void;
  onReplayTimelineEventsChanged?: (events: PolygonReplayEventPayload[]) => void;
}

interface ReplayTransitionDelta {
  toActiveSiren: number;
  toPostSirenUnsafe: number;
  cleared: number;
}

export interface ReplayTimelineState {
  active: boolean;
  rangeKey: ReplayRangeKey;
  rangeMinutes: number;
  stateWindowMinutes: number;
  rangeFromUnix: number | null;
  rangeToUnix: number | null;
  replayUnix: number | null;
}

function toReplayTimelinePayload(input: unknown): PolygonReplayTimelinePayload | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const payload = input as PolygonReplayTimelinePayload;
  if (!Array.isArray(payload.events)) {
    return null;
  }
  if (!Number.isFinite(Number(payload.rangeFromUnix)) || !Number.isFinite(Number(payload.rangeToUnix))) {
    return null;
  }
  return payload;
}

function buildReplayStatesAtUnix(
  events: PolygonReplayEventPayload[],
  replayUnix: number,
  stateWindowMinutes: number
): ReplayStateItem[] {
  const replayUnixFloor = Math.floor(replayUnix);
  const windowStartUnix = replayUnixFloor - Math.max(1, Math.floor(stateWindowMinutes * 60));
  const latestByLocalityId = new Map<number, number>();

  for (const eventItem of events) {
    const eventUnix = Number(eventItem?.alertTimestampUnix);
    if (!Number.isFinite(eventUnix)) {
      continue;
    }
    if (eventUnix > replayUnixFloor) {
      break;
    }
    if (eventUnix < windowStartUnix) {
      continue;
    }
    if (!Array.isArray(eventItem?.localityIds) || eventItem.localityIds.length === 0) {
      continue;
    }

    for (const localityIdRaw of eventItem.localityIds) {
      const localityId = Number(localityIdRaw);
      if (!Number.isFinite(localityId)) {
        continue;
      }
      const previousUnix = latestByLocalityId.get(localityId);
      if (!Number.isFinite(previousUnix) || eventUnix >= previousUnix) {
        latestByLocalityId.set(localityId, eventUnix);
      }
    }
  }

  return Array.from(latestByLocalityId.entries())
    .map(([localityId, latestAlertTimestampUnix]) => {
      const ageSeconds = replayUnixFloor - latestAlertTimestampUnix;
      const stage = ageSeconds <= 60 ? "active_siren" : "post_siren_unsafe";
      const stageStartedAtUnix = stage === "active_siren" ? latestAlertTimestampUnix : latestAlertTimestampUnix + 60;
      return {
        localityId,
        stage,
        stageStartedAtUnix,
        latestAlertTimestampUnix
      } as ReplayStateItem;
    })
    .sort((a, b) => a.localityId - b.localityId);
}

function getRangeOptionByKey(rangeKey: ReplayRangeKey): ReplayRangeOption {
  return REPLAY_RANGE_OPTIONS.find((option) => option.key === rangeKey) ?? REPLAY_RANGE_OPTIONS[0];
}

export function TimelineReplayCard({
  onReplayModeChanged,
  onReplayStateChanged,
  onReplayTimelineEventsChanged
}: TimelineReplayCardProps) {
  const [isReplayActive, setIsReplayActive] = useState(false);
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
            "Replay API returned HTML instead of JSON. Start/restart backend on 127.0.0.1:8787 or use Vite proxy."
          );
        }
        throw new Error("Replay API returned invalid JSON payload.");
      }

      const payload = toReplayTimelinePayload(parsed);
      if (!payload) {
        throw new Error("invalid replay payload");
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
      setErrorText(error instanceof Error ? error.message : "failed to load replay data");
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
    effectiveReplayUnix
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
    <section className="timeline-replay card" aria-label="Incident timeline replay">
      <div className="timeline-replay-head">
        <div>
          <h3 className="timeline-replay-title">Incident Timeline Replay</h3>
          <p className="timeline-replay-subtitle">Scrub historical map state and inspect polygon transitions.</p>
        </div>
        <button
          type="button"
          className={`timeline-toggle ${isReplayActive ? "active" : ""}`}
          onClick={() => setIsReplayActive((current) => !current)}
        >
          {isReplayActive ? "Exit Replay" : "Start Replay"}
        </button>
      </div>

      {isReplayActive ? (
        <>
          <div className="timeline-replay-ranges">
            {REPLAY_RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`timeline-range-btn ${selectedRangeKey === option.key ? "active" : ""}`}
                onClick={() => setSelectedRangeKey(option.key)}
                disabled={loading}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="timeline-replay-row">
            <button
              type="button"
              className="timeline-play-btn"
              disabled={!hasTimeline || loading}
              onClick={() => {
                if (isPlaying) {
                  setIsPlaying(false);
                  return;
                }

                if (!hasTimeline) {
                  return;
                }

                setReplayUnix((currentValue) => {
                  const currentUnix = Number.isFinite(currentValue) ? Number(currentValue) : timelineToUnix;
                  return currentUnix >= timelineToUnix ? timelineFromUnix : currentUnix;
                });
                setIsPlaying(true);
              }}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className="timeline-refresh-btn"
              disabled={loading}
              onClick={() => void loadReplayTimeline(selectedRange.minutes)}
            >
              Refresh
            </button>
          </div>

          <div className="timeline-replay-row timeline-speed-row">
            <label className="timeline-speed-control">
              <span className="timeline-speed-label">Replay speed</span>
              <input
                className="timeline-speed-slider"
                type="range"
                min={REPLAY_SPEED_MIN}
                max={REPLAY_SPEED_MAX}
                step={REPLAY_SPEED_STEP}
                value={playbackSpeed}
                disabled={loading}
                onInput={(event) => {
                  setPlaybackSpeed(Number(event.currentTarget.value));
                }}
                onChange={(event) => {
                  setPlaybackSpeed(Number(event.currentTarget.value));
                }}
              />
            </label>
            <strong className="timeline-speed-value">{playbackSpeed.toFixed(1)}x</strong>
          </div>

          <input
            className="timeline-slider"
            type="range"
            min={hasTimeline ? timelineFromUnix : 0}
            max={hasTimeline ? timelineToUnix : 0}
            step={selectedRange.scrubStepSeconds}
            value={hasTimeline ? replayProgressValue : 0}
            disabled={!hasTimeline || loading}
            onInput={(event) => {
              applyCursorUnix(Number(event.currentTarget.value));
            }}
            onChange={(event) => {
              applyCursorUnix(Number(event.currentTarget.value));
            }}
          />

          <div className="timeline-replay-meta">
            <span>
              Cursor:{" "}
              <strong>{effectiveReplayUnix ? formatTime(new Date(effectiveReplayUnix * 1000).toISOString()) : "-"}</strong>
            </span>
            <span>
              Events: <strong>{timelineEvents.length}</strong>
            </span>
            <span>
              At cursor: <strong>{cursorEventCount} transition event{cursorEventCount === 1 ? "" : "s"}</strong>
            </span>
            <span>
              Window: <strong>{STATE_WINDOW_MINUTES}m</strong>
            </span>
            <span>
              Speed: <strong>{playbackSpeed}x</strong>
            </span>
          </div>

          {transitionDelta ? (
            <div className="timeline-replay-meta">
              <span>
                +Active: <strong>{transitionDelta.toActiveSiren}</strong>
              </span>
              <span>
                +Unsafe: <strong>{transitionDelta.toPostSirenUnsafe}</strong>
              </span>
              <span>
                Cleared: <strong>{transitionDelta.cleared}</strong>
              </span>
            </div>
          ) : null}

          {loading ? <div className="timeline-replay-note">Loading replay timeline...</div> : null}
          {errorText ? <div className="timeline-replay-error">Replay error: {errorText}</div> : null}
          {!loading && !errorText && timelineEvents.length === 0 ? (
            <div className="timeline-replay-note">No alert events found in this range.</div>
          ) : null}
        </>
      ) : (
        <div className="timeline-replay-note">Replay is off. Live map stream is active.</div>
      )}
    </section>
  );
}

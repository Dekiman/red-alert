import { useEffect, useRef } from "react";

function nextClockValue() {
  return new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function LiveClockValue() {
  const clockNodeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const applyClockValue = () => {
      if (clockNodeRef.current) {
        clockNodeRef.current.textContent = nextClockValue();
      }
    };

    applyClockValue();
    const intervalId = window.setInterval(() => {
      applyClockValue();
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return <span ref={clockNodeRef}>{nextClockValue()}</span>;
}

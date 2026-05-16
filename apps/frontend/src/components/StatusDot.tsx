interface StatusDotProps {
  mode: "live" | "down" | "connecting";
}

export function StatusDot({ mode }: StatusDotProps) {
  const className = mode === "live" ? "dot live" : mode === "down" ? "dot down" : "dot";
  return <span className={className}></span>;
}

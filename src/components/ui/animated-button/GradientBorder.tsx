import { type CSSProperties, useEffect, useRef, useState } from "react";

export type GradientBorderMode = "static" | "animated" | "cursor" | "auto";
export type GradientType = "conic" | "linear";

type Props = {
  mode: GradientBorderMode;
  gradientType?: GradientType;
  /** Tailwind padding class that sets the visual border thickness e.g. "p-px" */
  borderWidth?: string;
  /** Pixel offset subtracted from borderRadius for the inner div — defaults to 1 */
  borderOffset?: number;
  borderRadius?: number;
  colors?: string[];
  animationDuration?: number;
  staticAngle?: number;
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  innerClassName?: string;
  innerStyle?: CSSProperties;
  innerBackground?: string;
  /** Solid base color painted under the gradient — lets the gradient act as a highlight layer */
  backgroundColor?: string;
};

function shortestDelta(from: number, to: number) {
  return (((to - from) % 360) + 540) % 360 - 180;
}

export function GradientBorder({
  mode,
  gradientType = "conic",
  borderWidth = "p-0.5",
  borderOffset = 1,
  borderRadius = 16,
  colors = ["#6366f1", "#a855f7", "#ec4899", "#f43f5e", "#6366f1"],
  animationDuration = 3,
  staticAngle = 135,
  children,
  className = "",
  style,
  innerClassName = "",
  innerStyle,
  innerBackground,
  backgroundColor,
}: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [displayAngle, setDisplayAngle] = useState(staticAngle);
  const targetRef = useRef(staticAngle);
  const currentRef = useRef(staticAngle);
  const rafRef = useRef(0);
  const animDurationRef = useRef(animationDuration);
  useEffect(() => { animDurationRef.current = animationDuration; }, [animationDuration]);

  // Cursor mode
  useEffect(() => {
    if (mode !== "cursor") return;
    const onMove = (e: MouseEvent) => {
      const el = outerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      targetRef.current = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    };
    const tick = () => {
      const delta = shortestDelta(currentRef.current, targetRef.current);
      if (Math.abs(delta) > 0.05) {
        currentRef.current += delta * 0.12;
        setDisplayAngle(currentRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", onMove);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [mode]);

  // Auto mode — spins when idle, tracks cursor when moving, reverts after 2s
  useEffect(() => {
    if (mode !== "auto") return;
    let tracking = false;
    let baseAngle = currentRef.current;
    let lastTime = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let trackingDuration = 0;

    const stopTracking = () => {
      tracking = false;
      baseAngle = currentRef.current;
    };
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(stopTracking, 2000);
    };
    const onMove = (e: MouseEvent) => {
      const el = outerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      targetRef.current = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      tracking = true;
      resetIdle();
    };
    const onDocLeave = () => {
      if (idleTimer) clearTimeout(idleTimer);
      stopTracking();
    };
    const tick = (time: DOMHighResTimeStamp) => {
      const dt = lastTime > 0 ? (time - lastTime) / 1000 : 0;
      lastTime = time;
      if (tracking) {
        trackingDuration += dt;
        const lerpFactor = Math.min(1, trackingDuration / 0.4) * 0.12;
        const delta = shortestDelta(currentRef.current, targetRef.current);
        if (Math.abs(delta) > 0.05) currentRef.current += delta * lerpFactor;
      } else {
        trackingDuration = 0;
        baseAngle = (baseAngle + (360 / animDurationRef.current) * dt) % 360;
        const delta = shortestDelta(currentRef.current, baseAngle);
        currentRef.current += delta * 0.08;
      }
      setDisplayAngle(currentRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onDocLeave);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onDocLeave);
      cancelAnimationFrame(rafRef.current);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [mode]);

  const colorStr = colors.join(", ");
  const gradientFn =
    gradientType === "linear"
      ? `linear-gradient(var(--gb-angle), ${colorStr})`
      : `conic-gradient(from var(--gb-angle), ${colorStr})`;

  const outerStyle: CSSProperties & Record<string, string | number> = {
    borderRadius,
    background: backgroundColor ? `${gradientFn}, ${backgroundColor}` : gradientFn,
  };

  if (mode === "static") {
    outerStyle["--gb-angle"] = `${staticAngle}deg`;
  } else if (mode === "cursor" || mode === "auto") {
    outerStyle["--gb-angle"] = `${displayAngle}deg`;
  } else {
    outerStyle["animation"] = `gb-rotate ${animationDuration}s linear infinite`;
  }

  const innerRadius = Math.max(0, borderRadius - borderOffset);

  return (
    <div ref={outerRef} style={{ ...outerStyle, ...style }} className={`${borderWidth} ${className}`}>
      <div
        style={{ borderRadius: innerRadius, background: innerBackground, ...innerStyle }}
        className={innerClassName}
      >
        {children}
      </div>
    </div>
  );
}

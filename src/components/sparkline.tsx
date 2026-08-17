"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A trend line small enough to sit inside a stat tile.
 *
 * Deliberately not a charting library: this draws one polyline and an area
 * fill, and pulling in a 90KB dependency to do that would cost more than the
 * whole dashboard bundle. No axes and no gridlines either — at this size they
 * would be unreadable, and the number beside it already carries the magnitude.
 * The shape is the entire message.
 */
export function Sparkline({
  values,
  className,
  tone = "primary",
  height = 32,
}: {
  values: number[];
  className?: string;
  tone?: "primary" | "success" | "danger" | "muted";
  height?: number;
}) {
  const width = 100;

  if (values.length < 2) {
    return <div className={cn("h-8", className)} aria-hidden />;
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series has no range to scale against; without this guard every
  // point divides by zero and the line vanishes.
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    // SVG y grows downward, so the value is inverted. The 2px inset keeps the
    // stroke from being clipped at the extremes.
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;

  const stroke = {
    primary: "stroke-cyan-500 dark:stroke-cyan-400",
    success: "stroke-emerald-500 dark:stroke-emerald-400",
    danger: "stroke-red-500 dark:stroke-red-400",
    muted: "stroke-muted-foreground",
  }[tone];

  const fill = {
    primary: "fill-cyan-500/10 dark:fill-cyan-400/10",
    success: "fill-emerald-500/10 dark:fill-emerald-400/10",
    danger: "fill-red-500/10 dark:fill-red-400/10",
    muted: "fill-muted",
  }[tone];

  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      aria-hidden
    >
      <polygon points={area} className={fill} />
      <polyline
        points={line}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={stroke}
      />
      <circle cx={last[0]} cy={last[1]} r={2} className={cn(stroke, "fill-current")} />
    </svg>
  );
}

/**
 * Percentage change with a direction.
 *
 * Colour alone would fail for a red-green colour blind reader and in a
 * screenshot, so the arrow carries the same information independently. `good`
 * inverts the palette for series where down is the desired direction — new
 * support cases falling is not a problem.
 */
export function Delta({
  value,
  good = "up",
  className,
}: {
  value: number | null;
  good?: "up" | "down";
  className?: string;
}) {
  if (value === null) {
    return (
      <span className={cn("font-mono text-[11px] text-muted-foreground", className)}>
        no prior week
      </span>
    );
  }

  const rounded = Math.round(value);
  const flat = Math.abs(rounded) < 1;
  const positive = rounded > 0;
  const favourable = good === "up" ? positive : !positive;

  const Icon = flat ? Minus : positive ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] tabular-nums",
        flat
          ? "text-muted-foreground"
          : favourable
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
        className,
      )}
      title="Last 7 days against the 7 before"
    >
      <Icon className="h-3 w-3" aria-hidden />
      {flat ? "flat" : `${positive ? "+" : ""}${rounded}%`}
    </span>
  );
}

/**
 * A number that counts up to its value on mount.
 *
 * Draws the eye to figures that changed without a layout shift. It respects
 * `prefers-reduced-motion` — for a reader who asked for stillness, an animated
 * number is not a flourish but a distraction — and it renders the final text
 * on the server so the value is correct before hydration and for anyone
 * without JavaScript.
 */
export function CountUp({
  value,
  format,
  className,
  durationMs = 700,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const from = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: fast at first, settling gently, so the eye catches the
      // movement without waiting for it.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, durationMs]);

  return (
    <span className={cn("tabular-nums", className)} suppressHydrationWarning>
      {format(display)}
    </span>
  );
}

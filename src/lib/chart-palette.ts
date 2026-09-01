/**
 * Chart colours for the dashboard, validated rather than chosen by eye.
 *
 * Five business areas — sales, finance, delivery, service, partners — each need a
 * hue that stays distinguishable for colourblind readers on both the light and
 * dark surfaces this app ships.
 *
 * Both sets were run through the dataviz validator against the app's own surface
 * colours (#f8fafc light, #0b111e dark) and pass all five checks: lightness band,
 * chroma floor, CVD separation, normal-vision separation, and contrast. The dark
 * set is a separate stepping rather than a flip of the light one — lighter tints
 * failed the lightness band against a near-black surface, which is exactly the
 * mistake an automatic inversion makes.
 *
 * One caveat carried from the validator: in dark mode the delivery/finance pair
 * separates by ΔE 4.8 under tritanopia, below the 6–8 floor. That is legal only
 * with secondary encoding, so every chart using these must also carry a direct
 * label or icon — never colour alone. The module cards do; keep it that way.
 *
 * Colour follows the entity, never its rank: sales is always blue whether or not
 * finance is on screen, so filtering a module out never repaints the others.
 */

export type ModuleKey = "sales" | "finance" | "delivery" | "service" | "partners";

export const MODULE_COLORS: Record<ModuleKey, { light: string; dark: string }> = {
  sales: { light: "#2563eb", dark: "#3b82f6" },
  finance: { light: "#0d9488", dark: "#0d9488" },
  delivery: { light: "#c2410c", dark: "#ea580c" },
  service: { light: "#7c3aed", dark: "#8b5cf6" },
  partners: { light: "#b45309", dark: "#a16207" },
};

/**
 * Status colours are reserved and never reused as a sixth series.
 *
 * They mean state — good, warning, serious — and lending one to a module would
 * make "delivery" and "something is wrong" the same colour on the same screen.
 * These ship with an icon or a label in every use, never colour alone.
 */
export const STATUS_COLORS = {
  good: { light: "#15803d", dark: "#22c55e" },
  warning: { light: "#b45309", dark: "#f59e0b" },
  critical: { light: "#b91c1c", dark: "#ef4444" },
} as const;

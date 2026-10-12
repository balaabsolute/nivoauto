/**
 * Dealership identity colours, used everywhere a dealership is named (cards, chips, tables, filters).
 * Six categorical hues validated for colour-vision deficiency (dataviz validator, light surface).
 * Green and red are deliberately absent: they are reserved for status (good / critical).
 * A colour always accompanies the dealership's name — it never carries meaning on its own.
 */
export const DEALER_PALETTE = [
  { hex: "#2a78d6", name: "Blue" },
  { hex: "#eb6834", name: "Orange" },
  { hex: "#1baf7a", name: "Aqua" },
  { hex: "#eda100", name: "Yellow" },
  { hex: "#e87ba4", name: "Magenta" },
  { hex: "#6250d6", name: "Violet" },
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** Stored colour if valid, otherwise a stable palette slot derived from the dealership code. */
export function dealerColor(d: { color?: string | null; code: string }): string {
  if (d.color && HEX.test(d.color)) return d.color;
  let h = 0;
  for (const c of d.code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DEALER_PALETTE[h % DEALER_PALETTE.length].hex;
}

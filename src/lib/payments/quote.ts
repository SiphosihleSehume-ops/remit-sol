import type { ConversionConfig } from "@/lib/config";

/**
 * Quote calculation. ALL money is integer minor units (bigint):
 *   ZAR cents, NGN kobo, USDC base units (6 decimals).
 * No floating point is used anywhere in the maths.
 *
 * The NGN figure is SIMULATED: no fiat payout takes place. Only the USDC
 * transfer on Solana Devnet is real.
 */

export interface Quote {
  sourceCents: bigint; // what the sender pays, ZAR cents
  feeCents: bigint; // platform fee, ZAR cents
  netCents: bigint; // amount converted, ZAR cents
  ngnPerZarMicro: bigint; // simulated rate, scaled 1e6
  destinationKobo: bigint; // what the recipient "receives", NGN kobo (simulated)
  usdcBaseUnits: bigint; // real on-chain USDC amount (6 decimals)
  feeBps: number;
}

/** Parse a ZAR amount string like "500", "500.5", "1,250.75" into cents. Returns null if invalid. */
export function parseZarToCents(input: string): bigint | null {
  const cleaned = input.replace(/[\s,]/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const cents = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return cents > 0n ? cents : null;
}

export function buildQuote(sourceCents: bigint, cfg: ConversionConfig): Quote {
  if (sourceCents <= 0n) throw new Error("Amount must be positive");

  // fee = round-half-up(source * bps / 10_000)
  const feeCents = (sourceCents * BigInt(cfg.feeBps) + 5_000n) / 10_000n;
  const netCents = sourceCents - feeCents;

  // ZAR cents -> NGN kobo (both have 100 subunits, so the rate applies directly)
  const destinationKobo = (netCents * cfg.ngnPerZarMicro) / 1_000_000n;

  // USDC base units = netZAR / (ZAR per USD) * 1e6
  //                 = netCents * 1e4 / zarPerUsd
  //                 = netCents * 1e4 * 1e6 / zarPerUsdMicro
  const exactUsdc =
    (netCents * 10_000n * 1_000_000n) / cfg.zarPerUsdMicro;
  const usdcBaseUnits = (exactUsdc * cfg.demoUsdcScaleMicro) / 1_000_000n;

  if (usdcBaseUnits <= 0n) throw new Error("Amount too small to transfer");

  return {
    sourceCents,
    feeCents,
    netCents,
    ngnPerZarMicro: cfg.ngnPerZarMicro,
    destinationKobo,
    usdcBaseUnits,
    feeBps: cfg.feeBps,
  };
}

// ---------- formatting helpers (display only) ----------

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMinor(minor: bigint, decimals: number, dropZeroFraction: boolean): string {
  const base = 10n ** BigInt(decimals);
  const whole = minor / base;
  const frac = (minor % base).toString().padStart(decimals, "0");
  const wholeStr = groupThousands(whole.toString());
  if (dropZeroFraction && /^0+$/.test(frac)) return wholeStr;
  return `${wholeStr}.${frac}`;
}

export const formatZar = (cents: bigint) => `R${formatMinor(cents, 2, true)}`;
export const formatNgn = (kobo: bigint) => `₦${formatMinor(kobo, 2, true)}`;
export const formatUsdc = (base: bigint) => `${formatMinor(base, 6, false)} USDC`;
export const formatRate = (micro: bigint) =>
  (Number(micro) / 1_000_000).toString();

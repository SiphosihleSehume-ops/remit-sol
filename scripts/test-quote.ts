import assert from "node:assert/strict";
import {
  buildQuote,
  parseZarToCents,
  formatZar,
  formatNgn,
  formatUsdc,
} from "../src/lib/payments/quote";

const cfg = {
  ngnPerZarMicro: 45_000_000n,
  zarPerUsdMicro: 18_000_000n,
  feeBps: 200,
  demoUsdcScaleMicro: 1_000_000n,
};

// The worked example from the spec: R500 -> fee R10 -> R490 -> N22,050
const q = buildQuote(50_000n, cfg);
assert.equal(q.feeCents, 1_000n);
assert.equal(q.netCents, 49_000n);
assert.equal(q.destinationKobo, 2_205_000n);
assert.equal(formatZar(q.feeCents), "R10");
assert.equal(formatNgn(q.destinationKobo), "₦22,050");
// R490 / 18 = 27.222222 USDC (truncated to 6 dp)
assert.equal(q.usdcBaseUnits, 27_222_222n);
assert.equal(formatUsdc(q.usdcBaseUnits), "27.222222 USDC");

// Demo scale reduces only the on-chain amount
const scaled = buildQuote(50_000n, { ...cfg, demoUsdcScaleMicro: 10_000n }); // 1%
assert.equal(scaled.usdcBaseUnits, 272_222n);
assert.equal(scaled.destinationKobo, q.destinationKobo);

// Parsing
assert.equal(parseZarToCents("500"), 50_000n);
assert.equal(parseZarToCents("1,250.75"), 125_075n);
assert.equal(parseZarToCents("0"), null);
assert.equal(parseZarToCents("abc"), null);
assert.equal(parseZarToCents("12.345"), null);

// Rounding: 2% of R0.75 = 1.5 cents -> rounds half up to 2
assert.equal(buildQuote(75n, cfg).feeCents, 2n);

console.log("quote tests passed");

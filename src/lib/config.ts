import { z } from "zod";

/**
 * Server-side configuration, validated with Zod.
 *
 * Parsed lazily (on first call) so `next build` and unit scripts don't need
 * every secret. Never import this from a client component: it reads
 * server-only environment variables.
 */

// Decimal string -> bigint scaled by 1e6 (avoids floating point for money/rates).
const microDecimal = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "must be a positive decimal with up to 6 places")
  .transform((s) => {
    const [whole, frac = ""] = s.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  });

const intFromString = z.coerce.number().int().nonnegative();

const envSchema = z.object({
  APP_BASE_URL: z.url(),

  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(5),
  PRIVY_APP_SECRET: z.string().min(10),
  PRIVY_AUTHORIZATION_PRIVATE_KEY: z.string().min(10),
  PRIVY_SIGNER_KEY_QUORUM_ID: z.string().min(5),

  SOLANA_RPC_URL: z.url(),
  SOLANA_USDC_MINT: z.string().min(32).max(44),
  SPONSOR_PRIVATE_KEY: z.string().min(20),

  WHATSAPP_ACCESS_TOKEN: z.string().min(10),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(5),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().min(10),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8),
  WHATSAPP_GRAPH_VERSION: z.string().default("v23.0"),

  NGN_PER_ZAR: microDecimal.default(45_000_000n),
  ZAR_PER_USD: microDecimal.default(18_000_000n),
  PLATFORM_FEE_BPS: intFromString.max(2000).default(200),
  DEMO_USDC_SCALE: microDecimal.default(1_000_000n),

  MIN_SEND_ZAR: intFromString.default(10),
  MAX_SEND_ZAR: intFromString.default(5000),
  STEP_UP_ABOVE_ZAR: intFromString.default(1000),
  DAILY_LIMIT_ZAR: intFromString.default(5000),

  PIN_PEPPER: z.string().min(32),
  DASHBOARD_USER: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(8),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Full validated env. Throws a readable error listing every bad/missing variable. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Conversion settings only, so quote logic and its tests need no secrets. */
const conversionSchema = envSchema.pick({
  NGN_PER_ZAR: true,
  ZAR_PER_USD: true,
  PLATFORM_FEE_BPS: true,
  DEMO_USDC_SCALE: true,
});

export function conversionConfig() {
  const c = conversionSchema.parse(process.env);
  return {
    ngnPerZarMicro: c.NGN_PER_ZAR,
    zarPerUsdMicro: c.ZAR_PER_USD,
    feeBps: c.PLATFORM_FEE_BPS,
    demoUsdcScaleMicro: c.DEMO_USDC_SCALE,
  };
}

export type ConversionConfig = ReturnType<typeof conversionConfig>;

export const USDC_DECIMALS = 6;
export const SOLANA_CLUSTER = "devnet" as const;

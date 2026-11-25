-- WhatsApp remittance MVP: initial schema.
-- Money columns: fiat as numeric(18,2) (ZAR / NGN), USDC as bigint base units (6 decimals).
-- NO private keys or auth secrets are stored here. PINs are stored only as salted hashes.

create extension if not exists pgcrypto;

-- ---------- users ----------
create table public.users (
  id              uuid primary key default gen_random_uuid(),
  phone_number    text not null unique check (phone_number ~ '^\+[1-9][0-9]{7,14}$'), -- E.164
  full_name       text,
  country         text not null default 'ZA' check (char_length(country) = 2),
  wallet_address  text unique,
  privy_user_id   text unique,
  privy_wallet_id text unique,                -- needed to request delegated signing
  email           text,                       -- verified at onboarding, used for step-up
  created_at      timestamptz not null default now()
);

-- PIN material kept in its own table so it is never selected by accident.
create table public.user_security (
  user_id          uuid primary key references public.users(id) on delete cascade,
  pin_hash         text not null,             -- scrypt hash incl. per-user salt
  failed_attempts  int  not null default 0,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);

-- ---------- recipients ----------
create table public.recipients (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  full_name       text not null,
  phone_number    text check (phone_number is null or phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  country         text not null default 'NG' check (char_length(country) = 2),
  wallet_address  text not null,              -- Solana (Devnet) address that receives the USDC
  created_at      timestamptz not null default now()
);
-- One "Mama" per sender, case-insensitive
create unique index recipients_user_name_uniq on public.recipients (user_id, lower(full_name));
create index recipients_user_idx on public.recipients (user_id);

-- ---------- transactions ----------
create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  sender_id             uuid not null references public.users(id),
  recipient_id          uuid not null references public.recipients(id),
  source_currency       text not null default 'ZAR',
  destination_currency  text not null default 'NGN',
  source_amount         numeric(18,2) not null check (source_amount > 0),
  platform_fee          numeric(18,2) not null check (platform_fee >= 0),
  net_amount            numeric(18,2) not null check (net_amount > 0),   -- source - fee
  exchange_rate         numeric(18,6) not null check (exchange_rate > 0), -- SIMULATED NGN per ZAR
  destination_amount    numeric(18,2) not null check (destination_amount > 0), -- SIMULATED NGN
  usdc_amount           bigint not null check (usdc_amount > 0),          -- real on-chain base units
  transaction_signature text unique,
  status                text not null default 'pending_confirm'
    check (status in ('pending_confirm','awaiting_stepup','processing','submitted','confirmed','failed','cancelled','expired')),
  failure_reason        text,
  source_message_id     text unique,          -- wamid that created the quote (idempotency)
  expires_at            timestamptz not null default (now() + interval '10 minutes'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index transactions_sender_created_idx on public.transactions (sender_id, created_at desc);
create index transactions_status_idx on public.transactions (status);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();

-- ---------- conversations ----------
create table public.conversations (
  id                     uuid primary key default gen_random_uuid(),
  phone_number           text not null unique,
  current_state          text not null default 'idle'
    check (current_state in ('idle','awaiting_confirm','awaiting_pin','awaiting_stepup')),
  pending_transaction_id uuid references public.transactions(id) on delete set null,
  updated_at             timestamptz not null default now()
);
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ---------- idempotency: every processed WhatsApp message id ----------
create table public.processed_messages (
  wamid        text primary key,
  phone_number text not null,
  received_at  timestamptz not null default now()
);
create index processed_messages_received_idx on public.processed_messages (received_at);

-- ---------- rate limiting (fixed window, works across serverless instances) ----------
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key, window_start)
);

-- ---------- functions ----------

-- Returns true if this wamid is NEW (caller should process it), false if it is a replay.
create or replace function public.claim_message(p_wamid text, p_phone text)
returns boolean language plpgsql security definer set search_path = public as $$
declare inserted int;
begin
  insert into processed_messages (wamid, phone_number) values (p_wamid, p_phone)
  on conflict (wamid) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

-- Atomically moves a quote from pending_confirm to processing. Exactly one caller can win.
create or replace function public.claim_transaction(p_tx_id uuid, p_sender uuid)
returns setof public.transactions language sql security definer set search_path = public as $$
  update transactions
     set status = 'processing'
   where id = p_tx_id
     and sender_id = p_sender
     and status = 'pending_confirm'
     and expires_at > now()
  returning *;
$$;

-- Fixed-window counter. Returns true if the action is ALLOWED.
create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz; c int;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into rate_limits (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  return c <= p_limit;
end $$;

-- ---------- row level security ----------
-- RLS on, NO policies: the anon/authenticated roles can read or write nothing.
-- All access goes through server route handlers using the service-role key.
alter table public.users              enable row level security;
alter table public.user_security      enable row level security;
alter table public.recipients         enable row level security;
alter table public.transactions       enable row level security;
alter table public.conversations      enable row level security;
alter table public.processed_messages enable row level security;
alter table public.rate_limits        enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
-- Functions are executable by PUBLIC by default; remove that, then allow only the server role.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.claim_message(text, text)           to service_role;
grant execute on function public.claim_transaction(uuid, uuid)       to service_role;
grant execute on function public.rate_limit_hit(text, int, int)      to service_role;

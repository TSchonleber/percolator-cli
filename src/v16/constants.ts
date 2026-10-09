/**
 * v16 account-layout constants for percolator-prog HEAD `70294cb`
 * (PushEwmaMark same-slot rate-limit guard), engine pin `051e268`
 * (release impaired insurance liens in terminal wind-down).
 *
 * **Major layout changes vs `4ee339d`/`b6e23b3`:**
 *
 *  - Commit `792256b` collapsed `admin + insurance_authority +
 *    insurance_operator + backing_bucket_authority + asset_authority +
 *    hyperp_mark_authority + base_unit_authority` (7 keys × 32 B) into a
 *    single `marketauth` key. WrapperConfigV16 shrank 624 → 432.
 *  - Commit `dba87a9` unified asset-0 with assets 1..N: per-asset oracle
 *    config + authorities are now per-slot for assets ≥ 1; asset 0's oracle
 *    fields are inline in WrapperConfigV16 (so the wrapper still doubles as
 *    asset 0's profile).
 *  - `MarketGroupV16HeaderAccount` grew 638 → 710 (engine added
 *    `pnl_pos_bound_tot_num`, `pnl_matured_pos_tot`, plus a 72-byte
 *    accounting block).
 *  - `PortfolioAccountV16Account` shrank 22,379 → 9,195 (16 + 9,179) —
 *    source-domain claims compacted into a fixed inline sparse array
 *    (PortfolioSourceDomainV16Account stride 196, 32 slots → 6272 B).
 *  - Market account now starts at `DEFAULT_MARKET_SLOT_CAPACITY = 1` and
 *    reallocs on asset activation; smoke explicitly pre-sizes for `N`
 *    via `marketAccountLenFor(N)`.
 *  - `ASSET_ORACLE_PROFILE_LEN` grew 368 → 400; wrapper storage 512
 *    (unchanged); engine slot 1285 (unchanged); per-slot stride 1797.
 */

// ---------- Header ----------
export const MAGIC = 0x5045_5243_5631_3600n; // "PERCV16\0"
export const VERSION = 16;
export const KIND_MARKET = 1;
export const KIND_PORTFOLIO = 2;
export const KIND_BACKING_DOMAIN_LEDGER = 3;
export const KIND_INSURANCE_LEDGER = 4;
export const KIND_CLOSED_MARKET = 5; // tombstone left by CloseSlab
// Max active legs one portfolio may carry (CU envelope); use more portfolios for more assets.
export const WRAPPER_MAX_PORTFOLIO_ASSETS = 14;
export const HEADER_LEN = 16;

// ---------- WrapperConfigV16 (448 B, immediately after header) ----------
// Grew 432 → 448 in the post-fd98358 era: two new fields appended at the end
// (matcher_req_seq u64 at offset 432, _padding1 [u8;8] at offset 440). All
// existing field offsets are UNCHANGED; only WRAPPER_CONFIG_LEN + MARKET_GROUP_OFF
// shift +16. Old-layout markets are unparseable under the new wrapper because
// the engine's V16Config validation reads MG at offset 464 not 448.
export const WRAPPER_CONFIG_LEN = 448;
export const WRAPPER_CONFIG_OFF = HEADER_LEN; // 16

// WrapperConfigV16: size 448, align 16 (generated from tests/fixtures/prog-layout.json)
export const WC = {
  marketauth: 0,                                 // 32 B
  collateral_mint: 32,                           // 32 B
  secondary_collateral_mint: 64,                 // 32 B
  maintenance_fee_per_slot: 96,                  // 16 B
  permissionless_market_init_fee: 112,           // 16 B
  trade_fee_base_bps: 128,                       // 8 B
  permissionless_resolve_stale_slots: 136,       // 8 B
  force_close_delay_slots: 144,                  // 8 B
  last_good_oracle_slot: 152,                    // 8 B
  terminal_slab_scan_progress: 160,              // 16 B
  _reserved_insurance_withdraw_max_bps: 176,     // 2 B
  liquidation_cranker_fee_share_bps: 178,        // 2 B
  maintenance_cranker_fee_share_bps: 180,        // 2 B
  backing_trade_fee_bps_long: 182,               // 2 B
  unit_scale: 184,                               // 4 B
  conf_filter_bps: 188,                          // 2 B
  backing_trade_fee_bps_short: 190,              // 2 B
  _reserved_insurance_withdraw_deposits_only: 192, // 1 B
  oracle_mode: 193,                              // 1 B
  oracle_leg_count: 194,                         // 1 B
  oracle_leg_flags: 195,                         // 1 B
  invert: 196,                                   // 1 B
  _padding0: 197,                                // 1 B
  free_market_slot_count: 198,                   // 2 B
  _reserved_insurance_withdraw_cooldown_slots: 200, // 8 B
  _reserved_last_insurance_withdraw_slot: 208,   // 8 B
  max_staleness_secs: 216,                       // 8 B
  hybrid_soft_stale_slots: 224,                  // 8 B
  mark_ewma_e6: 232,                             // 8 B
  mark_ewma_last_slot: 240,                      // 8 B
  mark_ewma_halflife_slots: 248,                 // 8 B
  mark_min_fee: 256,                             // 8 B
  oracle_target_price_e6: 264,                   // 8 B
  oracle_target_publish_time: 272,               // 8 B
  oracle_leg_feeds: 280,                         // 96 B
  oracle_leg_prices_e6: 376,                     // 24 B
  oracle_leg_publish_times: 400,                 // 24 B
  backing_trade_fee_policy_count: 424,           // 2 B
  backing_trade_fee_insurance_share_bps_long: 426, // 2 B
  backing_trade_fee_insurance_share_bps_short: 428, // 2 B
  fee_redirect_to_market_0_bps: 430,             // 2 B
  matcher_req_seq: 432,                          // 8 B
  next_portfolio_id: 440,                        // 8 B
} as const;

// ---------- Per-asset oracle profile (slot wrapper storage, +0) ----------
// AssetOracleProfileV16 grew 368 → 400 (commit dba87a9). Field offsets:
export const ASSET_ORACLE_PROFILE_LEN = 424;
export const ASSET_ORACLE_WRAPPER_LEN = 512;   // the per-slot `T` storage
export const ENGINE_ASSET_SLOT_LEN = 1301;     // EngineAssetSlotV16Account
export const V16_MAX_MARKET_SLOTS = 64;        // hard ceiling
export const V16_DOMAIN_COUNT = 128;
export const DEFAULT_MARKET_SLOT_CAPACITY = 1; // initial alloc; grows on Activate

// AssetOracleProfileV16 — same as old up to insurance_authority; field set
// shrank now that the wrapper-level authorities collapsed into `marketauth`,
// but the per-slot profile still carries its own oracle authority (per-asset
// mark-pusher). Offsets verified against `cargo run --example dump_layout`.
// NB: only asset_index >= 1 uses this struct; asset 0's oracle config lives in
// WrapperConfigV16 directly.
// AssetOracleProfileV16 layout (size = 400 B, dumped via examples/dump_layout):
// the marketauth-collapse comment elsewhere is misleading — the per-asset profile
// still carries insurance_authority / insurance_operator / backing_bucket_authority
// slots; they're just mirrored from `marketauth` in the wrapper code path, but
// `UpdateAssetAuthority` (tag 65) reads and writes them independently.
// AssetOracleProfileV16: size 424, align 8 (generated from tests/fixtures/prog-layout.json)
export const AOP = {
  oracle_mode: 0,                                // 1 B
  oracle_leg_count: 1,                           // 1 B
  oracle_leg_flags: 2,                           // 1 B
  invert: 3,                                     // 1 B
  unit_scale: 4,                                 // 4 B
  conf_filter_bps: 8,                            // 2 B
  backing_trade_fee_bps_long: 10,                // 2 B
  backing_trade_fee_bps_short: 12,               // 2 B
  backing_trade_fee_insurance_share_bps_long: 14, // 2 B
  backing_trade_fee_insurance_share_bps_short: 16, // 2 B
  price_move_remainder_bps_num: 18,              // 2 B
  effective_price_provenance: 20,                // 1 B
  _padding0: 21,                                 // 3 B
  insurance_authority: 24,                       // 32 B
  insurance_operator: 56,                        // 32 B
  backing_bucket_authority: 88,                  // 32 B
  oracle_authority: 120,                         // 32 B
  max_staleness_secs: 152,                       // 8 B
  hybrid_soft_stale_slots: 160,                  // 8 B
  mark_ewma_e6: 168,                             // 8 B
  mark_ewma_last_slot: 176,                      // 8 B
  mark_ewma_halflife_slots: 184,                 // 8 B
  mark_min_fee: 192,                             // 8 B
  oracle_target_price_e6: 200,                   // 8 B
  oracle_target_publish_time: 208,               // 8 B
  last_good_oracle_slot: 216,                    // 8 B
  oracle_leg_feeds: 224,                         // 96 B
  oracle_leg_prices_e6: 320,                     // 24 B
  oracle_leg_publish_times: 344,                 // 24 B
  asset_admin: 368,                              // 32 B
  funding_mark_e6: 400,                          // 8 B
  funding_mark_pending_e6: 408,                  // 8 B
  funding_mark_pending_slot: 416,                // 8 B
} as const;

// Per-asset wrapper storage (ASSET_ORACLE_WRAPPER_LEN = 512 B at the start of every asset slot):
//   [0, 424)   AssetOracleProfileV16 (AOP)
//   [424, 512) AssetControlSequencesV16 (ACS) — replay/ordering watermarks. Asset 0 owns the
//              market-wide policy lanes; oracle, backing and top-up lanes are per asset.
export const ASSET_CONTROL_SEQUENCES_OFF = ASSET_ORACLE_PROFILE_LEN; // 424
export const ASSET_CONTROL_SEQUENCES_LEN = ASSET_ORACLE_WRAPPER_LEN - ASSET_CONTROL_SEQUENCES_OFF; // 88
// AssetControlSequencesV16: size 88, align 8 (generated from tests/fixtures/prog-layout.json)
export const ACS = {
  oracle_observation: 0,                         // 8 B
  backing_fee: 8,                                // 8 B
  authority_epoch: 16,                           // 8 B
  trade_fee: 24,                                 // 8 B
  liquidation_fee: 32,                           // 8 B
  maintenance_fee: 40,                           // 8 B
  fee_redirect: 48,                              // 8 B
  market_init_fee: 56,                           // 8 B
  permissionless_resolve: 64,                    // 8 B
  insurance_top_up: 72,                          // 8 B
  backing_top_up: 80,                            // 8 B
} as const;

// ---------- MarketGroup ----------
// Layout: [HEADER(16)][WRAPPER_CONFIG(448)][MarketGroupHeader(726)][slots × N]
// Each slot = oracle storage(512) + EngineAssetSlot(1285) = 1797 B.
export const MARKET_GROUP_OFF = HEADER_LEN + WRAPPER_CONFIG_LEN; // 464
// Was 710; +16 B in ce073dc (engine v16.8.11) — inserted
// `source_fresh_backing_total_num: u128` between `source_claim_bound_total_num`
// and `source_insurance_credit_reserved_total_atoms`. All MG header fields at
// or after `source_insurance_credit_reserved_total_atoms` shift +16 bytes.
export const MARKET_GROUP_HEADER_LEN = 726;
export const ASSET_SLOT_LEN = ASSET_ORACLE_WRAPPER_LEN + ENGINE_ASSET_SLOT_LEN; // 1797
// Helper for smoke account allocation. Old MARKET_ACCOUNT_LEN assumed 64 slots;
// new model defaults to 1 and grows.
export function marketAccountLenFor(slotCapacity: number): number {
  return MARKET_GROUP_OFF + MARKET_GROUP_HEADER_LEN + slotCapacity * ASSET_SLOT_LEN;
}
// Default 4-slot smoke market: 448 + 726 + 4*1797 = 8362.
export const MARKET_ACCOUNT_LEN = marketAccountLenFor(4);
// Old name kept for compat; resolves to the same 4-slot smoke default.
export const MARKET_GROUP_LEN = MARKET_GROUP_HEADER_LEN + 4 * ASSET_SLOT_LEN;

export const V16_MAX_ASSETS = V16_MAX_MARKET_SLOTS;
export const ORACLE_LEG_CAP = 3;

// MarketGroupV16HeaderAccount (726 B, align=1; was 710 pre-ce073dc).
// Field offsets from dump_layout. ce073dc adds 16 B `source_fresh_backing_total_num`
// inside the 397..485 accounting block; all fields at or after
// materialized_portfolio_count shift +16.
// MarketGroupV16HeaderAccount: size 726, align 1 (generated from tests/fixtures/prog-layout.json)
export const MG = {
  market_group_id: 0,                            // 32 B
  config: 32,                                    // 249 B
  asset_slot_capacity: 281,                      // 4 B
  vault: 285,                                    // 16 B
  insurance: 301,                                // 16 B
  c_tot: 317,                                    // 16 B
  pnl_pos_tot: 333,                              // 16 B
  pnl_pos_bound_tot_num: 349,                    // 16 B
  pnl_pos_bound_tot: 365,                        // 16 B
  pnl_matured_pos_tot: 381,                      // 16 B
  backing_provider_earnings_total: 397,          // 16 B
  source_claim_bound_total_num: 413,             // 16 B
  source_fresh_backing_total_num: 429,           // 16 B
  source_insurance_credit_reserved_total_atoms: 445, // 16 B
  insurance_domain_budget_remaining_total: 461,  // 16 B
  resolved_payout_blocker_count: 477,            // 8 B
  materialized_portfolio_count: 485,             // 8 B
  stale_certificate_count: 493,                  // 8 B
  b_stale_account_count: 501,                    // 8 B
  negative_pnl_account_count: 509,               // 8 B
  risk_epoch: 517,                               // 8 B
  asset_set_epoch: 525,                          // 8 B
  asset_activation_count: 533,                   // 8 B
  last_asset_activation_slot: 541,               // 8 B
  next_market_id: 549,                           // 8 B
  oracle_epoch: 557,                             // 8 B
  funding_epoch: 565,                            // 8 B
  slot_last: 573,                                // 8 B
  current_slot: 581,                             // 8 B
  bankruptcy_hlock_active: 589,                  // 1 B
  threshold_stress_active: 590,                  // 1 B
  loss_stale_active: 591,                        // 1 B
  recovery_reason: 592,                          // 2 B
  mode: 594,                                     // 1 B
  resolved_slot: 595,                            // 8 B
  payout_snapshot: 603,                          // 16 B
  payout_snapshot_pnl_pos_tot: 619,              // 16 B
  payout_snapshot_captured: 635,                 // 1 B
  resolved_payout_ledger: 636,                   // 90 B
  asset_slots: MARKET_GROUP_HEADER_LEN, // per-asset slots start right after the header
} as const;

// ---------- AssetStateV16Account (499 B, unchanged in this round) ----------
export const ASSET_LEN = 515;
// AssetStateV16Account: size 515, align 1 (generated from tests/fixtures/prog-layout.json)
export const AS = {
  market_id: 0,                                  // 8 B
  retired_slot: 8,                               // 8 B
  lifecycle: 16,                                 // 1 B
  raw_oracle_target_price: 17,                   // 8 B
  effective_price: 25,                           // 8 B
  fund_px_last: 33,                              // 8 B
  slot_last: 41,                                 // 8 B
  a_long: 49,                                    // 16 B
  a_short: 65,                                   // 16 B
  k_long: 81,                                    // 16 B
  k_short: 97,                                   // 16 B
  f_long_num: 113,                               // 16 B
  f_short_num: 129,                              // 16 B
  kf_epoch_long: 145,                            // 8 B
  kf_epoch_short: 153,                           // 8 B
  k_epoch_start_long: 161,                       // 16 B
  k_epoch_start_short: 177,                      // 16 B
  f_epoch_start_long_num: 193,                   // 16 B
  f_epoch_start_short_num: 209,                  // 16 B
  b_long_num: 225,                               // 16 B
  b_short_num: 241,                              // 16 B
  b_epoch_start_long_num: 257,                   // 16 B
  b_epoch_start_short_num: 273,                  // 16 B
  oi_eff_long_q: 289,                            // 16 B
  oi_eff_short_q: 305,                           // 16 B
  stored_pos_count_long: 321,                    // 8 B
  stored_pos_count_short: 329,                   // 8 B
  stale_account_count_long: 337,                 // 8 B
  stale_account_count_short: 345,                // 8 B
  pending_obligation_count_long: 353,            // 8 B
  pending_obligation_count_short: 361,           // 8 B
  loss_weight_sum_long: 369,                     // 16 B
  loss_weight_sum_short: 385,                    // 16 B
  social_loss_remainder_long_num: 401,           // 16 B
  social_loss_remainder_short_num: 417,          // 16 B
  social_loss_dust_long_num: 433,                // 16 B
  social_loss_dust_short_num: 449,               // 16 B
  explicit_unallocated_loss_long: 465,           // 16 B
  explicit_unallocated_loss_short: 481,          // 16 B
  epoch_long: 497,                               // 8 B
  epoch_short: 505,                              // 8 B
  mode_long: 513,                                // 1 B
  mode_short: 514,                               // 1 B
} as const;

// ---------- Portfolio (9,291 B state + 16 B header + 104 B matcher config tail = 9,411 total) ----------
// PortfolioAccountV16Account shrank from 22,363 → 9,179 (source-domain claims
// compacted into a fixed inline sparse array, 32 slots × 196 B = 6,272 B).
// 7144d9b: appended 104-byte PortfolioMatcherConfigV16 tail (matcher_program +
// matcher_context + matcher_delegate + enabled u64 = 104 B).
// 0f87dcb: PortfolioAccount header gained 48 bytes (3 × u128) for monotonic
// residual-reward counters between reserved_pnl and fee_credits:
//   residual_crystallized_loss_atoms_total  (180..196)
//   residual_spent_principal_atoms_total    (196..212)
//   residual_received_atoms_total           (212..228)
// post-fd98358: appended 4 × u128 funding-flow counters between
// residual_received_atoms_total and fee_credits — all fields at or after
// fee_credits shift +64:
//   funding_long_paid_atoms_total       (228..244)
//   funding_long_received_atoms_total   (244..260)
//   funding_short_paid_atoms_total      (260..276)
//   funding_short_received_atoms_total  (276..292)
// PORTFOLIO_STATE_LEN: 9227 → 9291.
export const PORTFOLIO_STATE_LEN = 9419;
export const PORTFOLIO_ENGINE_ACCOUNT_LEN = HEADER_LEN + PORTFOLIO_STATE_LEN; // 9307
export const PORTFOLIO_MATCHER_CONFIG_LEN = 104;
export const PORTFOLIO_MATCHER_CONFIG_OFF = PORTFOLIO_ENGINE_ACCOUNT_LEN; // 9307
// Full account = engine account + matcher config + portfolio_id + owner sequence + matcher expiry.
export const PORTFOLIO_ACCOUNT_LEN = PORTFOLIO_ENGINE_ACCOUNT_LEN + PORTFOLIO_MATCHER_CONFIG_LEN + 24; // 9563
export const PORTFOLIO_STATE_OFF = HEADER_LEN; // 16

// PortfolioAccountV16Account inline field offsets (within state region):
// legs[16] at 340 (16 × 144 = 2304 → ends at 2644)
// source_domains[32] at 2644 (32 × 196 = 6272 → ends at 8916)
// then health_cert(121) close_progress(184) resolved_payout_receipt(66).
// PortfolioAccountV16Account: size 9419, align 1 (generated from tests/fixtures/prog-layout.json)
export const PA = {
  provenance_header: 0,                          // 100 B
  owner: 100,                                    // 32 B
  capital: 132,                                  // 16 B
  pnl: 148,                                      // 16 B
  reserved_pnl: 164,                             // 16 B
  residual_crystallized_loss_atoms_total: 180,   // 16 B
  residual_spent_principal_atoms_total: 196,     // 16 B
  residual_received_atoms_total: 212,            // 16 B
  funding_long_paid_atoms_total: 228,            // 16 B
  funding_long_received_atoms_total: 244,        // 16 B
  funding_short_paid_atoms_total: 260,           // 16 B
  funding_short_received_atoms_total: 276,       // 16 B
  fee_credits: 292,                              // 16 B
  cancel_deposit_escrow: 308,                    // 16 B
  last_fee_slot: 324,                            // 8 B
  active_bitmap: 332,                            // 8 B
  legs: 340,                                     // 2432 B
  source_domains: 2772,                          // 6272 B
  health_cert: 9044,                             // 121 B
  stale_state: 9165,                             // 1 B
  b_stale_state: 9166,                           // 1 B
  rebalance_lock: 9167,                          // 1 B
  liquidation_lock: 9168,                        // 1 B
  close_progress: 9169,                          // 184 B
  resolved_payout_receipt: 9353,                 // 66 B
} as const;

// Portfolio account tail, after the 16 B header + PortfolioAccountV16Account state:
//   PortfolioMatcherConfigV16 (104 B) | portfolio_id u64 | owner sequence u64 | matcher expiry slot u64
// The "matcher sequence" lane is the shared owner-state replay counter: Deposit, Withdraw,
// SetMatcherConfig, ClosePortfolio and TradeCpi (as account B) bind its current value.
// PortfolioMatcherConfigV16: size 104, align 8 (generated from tests/fixtures/prog-layout.json)
export const PMC = {
  matcher_program: 0,                            // 32 B
  matcher_context: 32,                           // 32 B
  matcher_delegate: 64,                          // 32 B
  control: 96,                                   // 8 B
} as const;
export const PORTFOLIO_MATCHER_CONTROL_OFF = PORTFOLIO_MATCHER_CONFIG_OFF + 96;
export const PORTFOLIO_ID_OFF = PORTFOLIO_MATCHER_CONFIG_OFF + PORTFOLIO_MATCHER_CONFIG_LEN;
export const PORTFOLIO_MATCHER_SEQUENCE_OFF = PORTFOLIO_ID_OFF + 8;
export const PORTFOLIO_MATCHER_EXPIRY_OFF = PORTFOLIO_MATCHER_SEQUENCE_OFF + 8;

// ---------- PortfolioLegV16Account (144 B, unchanged) ----------
export const LEG_LEN = 152;
// PortfolioLegV16Account: size 152, align 1 (generated from tests/fixtures/prog-layout.json)
export const PL = {
  active: 0,                                     // 1 B
  asset_index: 1,                                // 4 B
  market_id: 5,                                  // 8 B
  side: 13,                                      // 1 B
  basis_pos_q: 14,                               // 16 B
  a_basis: 30,                                   // 16 B
  k_snap: 46,                                    // 16 B
  f_snap: 62,                                    // 16 B
  kf_epoch_snap: 78,                             // 8 B
  epoch_snap: 86,                                // 8 B
  loss_weight: 94,                               // 16 B
  b_snap: 110,                                   // 16 B
  b_rem: 126,                                    // 16 B
  b_epoch_snap: 142,                             // 8 B
  b_stale: 150,                                  // 1 B
  stale: 151,                                    // 1 B
} as const;

// ---------- Provenance header (100 B; inside portfolio) ----------
export const PROVENANCE_LEN = 100;
// ProvenanceHeaderV16Account: size 100, align 1 (generated from tests/fixtures/prog-layout.json)
export const PROV = {
  market_group_id: 0,                            // 32 B
  portfolio_account_id: 32,                      // 32 B
  owner: 64,                                     // 32 B
  version: 96,                                   // 2 B
  layout_discriminator: 98,                      // 2 B
} as const;

// ---------- Misc enums ----------
export const MarketMode = {
  Live: 0,
  Resolved: 1,
} as const;

export const OracleMode = {
  Manual: 0,
  HybridAfterHours: 1,
  Hyperp: 2,
  AuthMark: 3,
} as const;

export const SideMode = {
  Normal: 0,
  DrainOnly: 1,
  ResetPending: 2,
} as const;

export const AssetLifecycle = {
  Disabled: 0,
  PendingActivation: 1,
  Active: 2,
  DrainOnly: 3,
  Retired: 4,
  Recovery: 5,
} as const;

export const ORACLE_LEG_FLAG_DIVIDE_LEG2 = 0x01;
export const ORACLE_LEG_FLAG_DIVIDE_LEG3 = 0x02;

export const OracleProvider = {
  PYTH_RECEIVER: "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
  SWITCHBOARD_ONDEMAND_MAINNET: "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
  SWITCHBOARD_ONDEMAND_DEVNET: "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2",
  CHAINLINK_STORE: "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny",
} as const;

export const SwitchboardPullFeed = {
  discriminator: Buffer.from([196, 27, 108, 196, 10, 215, 219, 40]),
  minLen: 3_208,
} as const;
export const ChainlinkFeed = {
  discriminator: Buffer.from([96, 179, 69, 66, 128, 129, 73, 117]),
  minLen: 8 + 192 + 48,
} as const;
export const PythPriceUpdateV2 = {
  minLen: 134,
} as const;

export const AssetAction = {
  Activate: 0,
  DrainOnly: 1,
  Retire: 2,
  Shutdown: 3,
} as const;

// commit 792256b collapsed authority kinds — only `marketauth` (kind 0) remains
// for market-level rotation; per-asset oracle_authority is rotated via the
// per-asset path. `Asset` (kind 5) was retired with the authority collapse.
export const AuthorityKind = {
  MarketAuth: 0,
  // legacy aliases (now all alias 0 — kept for any old call sites that compile but
  // may reject at the program if it validates kind strictly; preferred is MarketAuth):
  Admin: 0,
  HyperpMark: 0,
  Insurance: 0,
  BackingBucket: 0,
  InsuranceOperator: 0,
  Asset: 0,
} as const;

/**
 * TransactionInstruction builders for percolator-prog v16 (5cb331dd).
 *
 * Account lists follow the program's processor and its LiteSVM harness
 * (percolator-prog/tests/support/v16_svm.rs). Instruction data comes from the
 * generated encoders in encode.gen.ts, which are byte-checked against the
 * program's own encoder (tests/v16/ix-vectors.ts).
 *
 * Replay protection: most instructions bind values the client reads from chain.
 * `readPortfolioBinding` / `readMarketBinding` return them; the rules are
 *   - portfolio_id, expected_sequence, position_epoch, market_id,
 *     asset_generation_frontier, authority_epoch  -> pass the CURRENT value
 *   - policy_sequence, observation_sequence, intent_id -> pass current + 1
 */
import {
  ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction,
} from "@solana/web3.js";
import * as E from "./encode.gen.js";
import {
  ASSET_SLOT_LEN, AS, ASSET_ORACLE_WRAPPER_LEN, HEADER_LEN, MARKET_GROUP_OFF, MG, PORTFOLIO_ACCOUNT_LEN, WC,
  WRAPPER_CONFIG_OFF,
} from "./constants.js";
import {
  assetSlotOffset, parseAssetControlSequences, parseAssetOracleProfile, parsePortfolioMatcherConfig,
  type AssetControlSequences, type AssetOracleProfile,
} from "./parsers.js";
import { PORTFOLIO_ID_OFF, PORTFOLIO_MATCHER_SEQUENCE_OFF } from "./constants.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** The program runs a 128 KiB bump allocator; every tx must request at least that heap frame. */
export const HEAP_FRAME_BYTES = 256 * 1024;

// ---------------------------------------------------------------- sizes / PDAs

/** Market account size for `capacity` asset slots (capacity >= maxPortfolioAssets at init). */
export function marketAccountLen(capacity: number): number {
  return MARKET_GROUP_OFF + MG.asset_slots + capacity * ASSET_SLOT_LEN;
}


export function vaultAuthority(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId)[0];
}
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}
/** The only vault the program accepts: ATA(vaultAuthority, mint). InitMarket does not create it. */
export function vaultAddress(programId: PublicKey, market: PublicKey, mint: PublicKey): PublicKey {
  return associatedTokenAddress(vaultAuthority(programId, market), mint);
}
export function matcherDelegate(
  programId: PublicKey, market: PublicKey, lpPortfolio: PublicKey, lpOwner: PublicKey,
  matcherProgram: PublicKey, matcherContext: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("matcher"), market.toBuffer(), lpPortfolio.toBuffer(), lpOwner.toBuffer(),
      matcherProgram.toBuffer(), matcherContext.toBuffer()], programId)[0];
}
/** Idempotent ATA creation (Associated Token Account program, instruction 1). */
export function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}
/** Compute-budget preamble: heap frame (mandatory) + CU limit. */
export function computeBudgetIxs(units = 1_400_000): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.requestHeapFrame({ bytes: HEAP_FRAME_BYTES }),
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ];
}

// ---------------------------------------------------------------- bindings

export interface PortfolioBinding {
  portfolioId: bigint;
  /** Owner-state replay counter: pass as `expectedSequence` (Deposit/Withdraw/Close/SetMatcherConfig). */
  expectedSequence: bigint;
  /** Pass as `positionEpoch` / `account{A,B}PositionEpoch`; bumps after every position change. */
  positionEpoch: bigint;
  /** Also the `accountBMatcherSequence` for TradeCpi when this portfolio is the LP. */
  matcherSequence: bigint;
}
export function readPortfolioBinding(data: Buffer): PortfolioBinding {
  if (data.length < PORTFOLIO_ACCOUNT_LEN) throw new Error(`portfolio account too short: ${data.length}`);
  const seq = data.readBigUInt64LE(PORTFOLIO_MATCHER_SEQUENCE_OFF);
  return {
    portfolioId: data.readBigUInt64LE(PORTFOLIO_ID_OFF),
    expectedSequence: seq,
    positionEpoch: parsePortfolioMatcherConfig(data).positionEpoch,
    matcherSequence: seq,
  };
}

export interface AssetBinding {
  index: number;
  /** Current generation of this asset slot (pass as `marketId`). */
  marketId: bigint;
  lifecycle: number;
  controls: AssetControlSequences;
  profile: AssetOracleProfile;
}
export interface MarketBinding {
  marketauth: PublicKey;
  collateralMint: PublicKey;
  secondaryCollateralMint: PublicKey;
  tradeFeeBaseBps: bigint;
  liquidationCrankerFeeShareBps: number;
  /** header next_market_id: pass as `assetGenerationFrontier`, and as `marketId` when activating. */
  nextMarketId: bigint;
  mode: number;
  maxMarketSlots: number;
  assetSlotCapacity: number;
  assets: AssetBinding[];
}
export function readMarketBinding(data: Buffer): MarketBinding {
  const w = WRAPPER_CONFIG_OFF;
  const h = MARKET_GROUP_OFF;
  const capacity = data.readUInt32LE(h + MG.asset_slot_capacity);
  const fit = Math.floor((data.length - h - MG.asset_slots) / ASSET_SLOT_LEN);
  const assets: AssetBinding[] = [];
  for (let i = 0; i < Math.min(capacity, fit); i++) {
    const slot = assetSlotOffset(i);
    const eng = slot + ASSET_ORACLE_WRAPPER_LEN;
    assets.push({
      index: i,
      marketId: data.readBigUInt64LE(eng + AS.market_id),
      lifecycle: data.readUInt8(eng + AS.lifecycle),
      controls: parseAssetControlSequences(data, slot),
      profile: parseAssetOracleProfile(data, slot, i),
    });
  }
  return {
    marketauth: new PublicKey(data.subarray(w + WC.marketauth, w + WC.marketauth + 32)),
    collateralMint: new PublicKey(data.subarray(w + WC.collateral_mint, w + WC.collateral_mint + 32)),
    secondaryCollateralMint: new PublicKey(
      data.subarray(w + WC.secondary_collateral_mint, w + WC.secondary_collateral_mint + 32)),
    tradeFeeBaseBps: data.readBigUInt64LE(w + WC.trade_fee_base_bps),
    liquidationCrankerFeeShareBps: data.readUInt16LE(w + WC.liquidation_cranker_fee_share_bps),
    nextMarketId: data.readBigUInt64LE(h + MG.next_market_id),
    mode: data.readUInt8(h + MG.mode),
    maxMarketSlots: data.readUInt32LE(h + MG.config + 2), // V16ConfigAccount: max_portfolio_assets u16, max_market_slots u32
    assetSlotCapacity: capacity,
    assets,
  };
}
void HEADER_LEN;

// ---------------------------------------------------------------- builders

const S = (pubkey: PublicKey, isWritable = false) => ({ pubkey, isSigner: true, isWritable });
const W = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
const R = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const ix = (programId: PublicKey, keys: ReturnType<typeof R>[], data: Buffer) =>
  new TransactionInstruction({ programId, keys, data });

/** Client-side account creation for a market (program-owned, rent-exempt). */
export function createMarketAccountIx(
  payer: PublicKey, market: PublicKey, programId: PublicKey, capacity: number, lamports: number,
): TransactionInstruction {
  return SystemProgram.createAccount({
    fromPubkey: payer, newAccountPubkey: market, programId, space: marketAccountLen(capacity), lamports,
  });
}
/** Client-side account creation for a portfolio (fixed size, must be rent-exempt). */
export function createPortfolioAccountIx(
  payer: PublicKey, portfolio: PublicKey, programId: PublicKey, lamports: number,
): TransactionInstruction {
  return SystemProgram.createAccount({
    fromPubkey: payer, newAccountPubkey: portfolio, programId, space: PORTFOLIO_ACCOUNT_LEN, lamports,
  });
}

/** [admin S, market W, collateral mint]. Admin becomes marketauth and every per-asset role. */
export function initMarketIx(p: { programId: PublicKey; admin: PublicKey; market: PublicKey; mint: PublicKey },
  args: E.InitMarketArgs) {
  return ix(p.programId, [S(p.admin, true), W(p.market), R(p.mint)], E.encInitMarket(args));
}
/** [owner S, market W, portfolio W]. */
export function initPortfolioIx(p: { programId: PublicKey; owner: PublicKey; market: PublicKey; portfolio: PublicKey }) {
  return ix(p.programId, [S(p.owner, true), W(p.market), W(p.portfolio)], E.encInitPortfolio());
}
/** [owner S, market W, portfolio W, source token W, vault W, token program]. */
export function depositIx(p: {
  programId: PublicKey; owner: PublicKey; market: PublicKey; portfolio: PublicKey; sourceToken: PublicKey; mint: PublicKey;
}, args: E.DepositArgs) {
  return ix(p.programId, [S(p.owner, true), W(p.market), W(p.portfolio), W(p.sourceToken),
    W(vaultAddress(p.programId, p.market, p.mint)), R(TOKEN_PROGRAM_ID)], E.encDeposit(args));
}
/** [owner S, market W, portfolio W, dest token W, vault W, vault authority, token program]. */
export function withdrawIx(p: {
  programId: PublicKey; owner: PublicKey; market: PublicKey; portfolio: PublicKey; destToken: PublicKey; mint: PublicKey;
}, args: E.WithdrawArgs) {
  return ix(p.programId, [S(p.owner, true), W(p.market), W(p.portfolio), W(p.destToken),
    W(vaultAddress(p.programId, p.market, p.mint)), R(vaultAuthority(p.programId, p.market)), R(TOKEN_PROGRAM_ID)],
  E.encWithdraw(args));
}
/** Bilateral trade, both owners sign: [ownerA S, ownerB S, market W, portfolioA W, portfolioB W]. */
export function tradeNoCpiIx(p: {
  programId: PublicKey; ownerA: PublicKey; ownerB: PublicKey; market: PublicKey; portfolioA: PublicKey; portfolioB: PublicKey;
}, args: E.TradeNoCpiArgs) {
  return ix(p.programId, [S(p.ownerA, true), S(p.ownerB, true), W(p.market), W(p.portfolioA), W(p.portfolioB)],
    E.encTradeNoCpi(args));
}
export function batchTradeNoCpiIx(p: {
  programId: PublicKey; ownerA: PublicKey; ownerB: PublicKey; market: PublicKey; portfolioA: PublicKey; portfolioB: PublicKey;
}, args: E.BatchTradeNoCpiArgs) {
  return ix(p.programId, [S(p.ownerA, true), S(p.ownerB, true), W(p.market), W(p.portfolioA), W(p.portfolioB)],
    E.encBatchTradeNoCpi(args));
}
interface MatcherAccounts {
  matcherProgram: PublicKey; matcherContext: PublicKey; lpOwner: PublicKey; lpPortfolio: PublicKey;
}
/**
 * Trade routed through the LP's matcher:
 * [taker S, market W, taker pf W, LP pf W, matcher program, matcher context W, matcher delegate PDA, ...tail].
 */
export function tradeCpiIx(p: { programId: PublicKey; taker: PublicKey; market: PublicKey; takerPortfolio: PublicKey;
  tail?: { pubkey: PublicKey; isWritable: boolean }[] } & MatcherAccounts, args: E.TradeCpiArgs) {
  return ix(p.programId, matcherTradeKeys(p), E.encTradeCpi(args));
}
export function batchTradeCpiIx(p: { programId: PublicKey; taker: PublicKey; market: PublicKey; takerPortfolio: PublicKey;
  tail?: { pubkey: PublicKey; isWritable: boolean }[] } & MatcherAccounts, args: E.BatchTradeCpiArgs) {
  return ix(p.programId, matcherTradeKeys(p), E.encBatchTradeCpi(args));
}
function matcherTradeKeys(p: { programId: PublicKey; taker: PublicKey; market: PublicKey; takerPortfolio: PublicKey;
  tail?: { pubkey: PublicKey; isWritable: boolean }[] } & MatcherAccounts) {
  if ((p.tail?.length ?? 0) > 32) throw new RangeError("matcher tail: at most 32 accounts");
  return [S(p.taker, true), W(p.market), W(p.takerPortfolio), W(p.lpPortfolio), R(p.matcherProgram),
    W(p.matcherContext),
    R(matcherDelegate(p.programId, p.market, p.lpPortfolio, p.lpOwner, p.matcherProgram, p.matcherContext)),
    ...(p.tail ?? []).map((t) => ({ pubkey: t.pubkey, isSigner: false, isWritable: t.isWritable }))];
}
/**
 * [LP owner S, market, LP portfolio W] + (enabled: matcher program, matcher context, matcher delegate PDA).
 * Any non-matcher position change clears the enabled bit, so LPs re-send this after such changes.
 */
export function setMatcherConfigIx(p: { programId: PublicKey; market: PublicKey; matcher?: { program: PublicKey; context: PublicKey } }
  & Pick<MatcherAccounts, "lpOwner" | "lpPortfolio">, args: E.SetMatcherConfigArgs) {
  const keys = [S(p.lpOwner, true), R(p.market), W(p.lpPortfolio)];
  if (args.enabled) {
    if (!p.matcher) throw new Error("enabled=1 needs matcher program + context");
    keys.push(R(p.matcher.program), R(p.matcher.context),
      R(matcherDelegate(p.programId, p.market, p.lpPortfolio, p.lpOwner, p.matcher.program, p.matcher.context)));
  }
  return ix(p.programId, keys, E.encSetMatcherConfig(args));
}
/** [closer S, market W (receives lamports), portfolio W]. Closer = owner, or marketauth once Resolved. */
export function closePortfolioIx(p: { programId: PublicKey; closer: PublicKey; market: PublicKey; portfolio: PublicKey },
  args: E.ClosePortfolioArgs) {
  return ix(p.programId, [S(p.closer, true), W(p.market), W(p.portfolio)], E.encClosePortfolio(args));
}
/**
 * Keeper auto-crank. Hints: one per active leg of the target, `oracleAccounts` = that asset's
 * oracle leg count (0 for manual / EWMA / auth-mark). Oracle accounts follow in hint order.
 * `rewardPortfolio` only when liquidation cranker share != 0 (cranker must then sign).
 * Custom(22) EngineNonProgress = nothing to do.
 */
export function permissionlessCrankIx(p: {
  programId: PublicKey; cranker: PublicKey; market: PublicKey; target: PublicKey;
  oracleAccounts?: PublicKey[]; rewardPortfolio?: PublicKey;
}, args: E.PermissionlessCrankArgs) {
  const keys = [p.rewardPortfolio ? S(p.cranker, true) : R(p.cranker), W(p.market), W(p.target),
    ...(p.oracleAccounts ?? []).map(R)];
  if (p.rewardPortfolio) keys.push(W(p.rewardPortfolio));
  return ix(p.programId, keys, E.encPermissionlessCrank(args));
}
/** [market W, portfolio W, (opt) cranker reward portfolio W]. */
export function syncMaintenanceFeeIx(p: { programId: PublicKey; market: PublicKey; portfolio: PublicKey; rewardPortfolio?: PublicKey },
  args: E.SyncMaintenanceFeeArgs) {
  const keys = [W(p.market), W(p.portfolio)];
  if (p.rewardPortfolio) keys.push(W(p.rewardPortfolio));
  return ix(p.programId, keys, E.encSyncMaintenanceFee(args));
}
/**
 * Insurance top-up — signer must be asset 0's `insurance_authority` (tag 9) or the domain asset's
 * (tag 56): [authority S, market W, source token W, vault W, token program, (opt) insurance ledger W].
 */
export function topUpInsuranceIx(p: { programId: PublicKey; authority: PublicKey; market: PublicKey; sourceToken: PublicKey;
  mint: PublicKey; ledger?: PublicKey }, args: E.TopUpInsuranceArgs) {
  return ix(p.programId, topUpKeys(p), E.encTopUpInsurance(args));
}
export function topUpInsuranceDomainIx(p: { programId: PublicKey; authority: PublicKey; market: PublicKey; sourceToken: PublicKey;
  mint: PublicKey; ledger?: PublicKey }, args: E.TopUpInsuranceDomainArgs) {
  return ix(p.programId, topUpKeys(p), E.encTopUpInsuranceDomain(args));
}
function topUpKeys(p: { programId: PublicKey; authority: PublicKey; market: PublicKey; sourceToken: PublicKey; mint: PublicKey; ledger?: PublicKey }) {
  const keys = [S(p.authority, true), W(p.market), W(p.sourceToken), W(vaultAddress(p.programId, p.market, p.mint)),
    R(TOKEN_PROGRAM_ID)];
  if (p.ledger) keys.push(W(p.ledger));
  return keys;
}
/**
 * [operator (S in Live), market W, dest token W, vault W, vault authority, token program, (opt) insurance ledger W].
 * Dest owner: insurance_operator (Live) / insurance_authority (Resolved). A Live success consumes the authority epoch.
 */
export function withdrawInsuranceAssetIx(p: { programId: PublicKey; authority: PublicKey; authoritySigns?: boolean; market: PublicKey;
  destToken: PublicKey; mint: PublicKey; ledger?: PublicKey }, args: E.WithdrawInsuranceAssetArgs) {
  const keys = [(p.authoritySigns ?? true) ? S(p.authority, true) : R(p.authority), W(p.market), W(p.destToken),
    W(vaultAddress(p.programId, p.market, p.mint)), R(vaultAuthority(p.programId, p.market)), R(TOKEN_PROGRAM_ID)];
  if (p.ledger) keys.push(W(p.ledger));
  return ix(p.programId, keys, E.encWithdrawInsuranceAsset(args));
}
/** Two-account authority-only instructions: [signer S, market W]. */
function authIx<A>(enc: (a: A) => Buffer) {
  return (p: { programId: PublicKey; authority: PublicKey; market: PublicKey }, args: A) =>
    ix(p.programId, [S(p.authority, true), W(p.market)], enc(args));
}
export const resolveMarketIx = authIx(E.encResolveMarket);
export const updateLiquidationFeePolicyIx = authIx(E.encUpdateLiquidationFeePolicy);
export const updateMaintenanceFeePolicyIx = authIx(E.encUpdateMaintenanceFeePolicy);
export const updateFeeRedirectPolicyIx = authIx(E.encUpdateFeeRedirectPolicy);
export const updateMarketInitFeePolicyIx = authIx(E.encUpdateMarketInitFeePolicy);
/** Signer: asset 0's insurance_authority. */
export const updateTradeFeePolicyIx = authIx(E.encUpdateTradeFeePolicy);
/** Signer: insurance_authority of domain/2. */
export const updateBackingFeePolicyIx = authIx(E.encUpdateBackingFeePolicy);
export const configurePermissionlessResolveIx = authIx(E.encConfigurePermissionlessResolve);
/** Signer: the asset's oracle_authority. */
export const configureEwmaMarkIx = authIx(E.encConfigureEwmaMark);
export const pushEwmaMarkIx = authIx(E.encPushEwmaMark);
export const configureAuthMarkIx = authIx(E.encConfigureAuthMark);
export const pushAuthMarkIx = authIx(E.encPushAuthMark);
/** Signer: the asset's asset_admin; asset must be in Recovery. */
export const restartAssetOracleIx = authIx(E.encRestartAssetOracle);
/** [oracle authority S, market W, ...oracle feed accounts in leg order]. */
export function configureHybridOracleIx(p: { programId: PublicKey; authority: PublicKey; market: PublicKey; oracleAccounts: PublicKey[] },
  args: E.ConfigureHybridOracleArgs) {
  return ix(p.programId, [S(p.authority, true), W(p.market), ...p.oracleAccounts.map(R)], E.encConfigureHybridOracle(args));
}
/** [market W] — permissionless. */
export function resolveStalePermissionlessIx(p: { programId: PublicKey; market: PublicKey }, args: E.ResolveStalePermissionlessArgs) {
  return ix(p.programId, [W(p.market)], E.encResolveStalePermissionless(args));
}
export function finalizeResetSideIx(p: { programId: PublicKey; market: PublicKey }, args: E.FinalizeResetSideArgs) {
  return ix(p.programId, [W(p.market)], E.encFinalizeResetSide(args));
}
/** [current S, new S (key == newPubkey), market W]. Market is at index 2. */
export function updateAuthorityIx(p: { programId: PublicKey; current: PublicKey; next: PublicKey; market: PublicKey },
  args: E.UpdateAuthorityArgs) {
  return ix(p.programId, [S(p.current, true), S(p.next), W(p.market)], E.encUpdateAuthority(args));
}
/** kind: 0 ADMIN, 1 INSURANCE, 2 INSURANCE_OPERATOR, 3 BACKING_BUCKET, 4 ORACLE. Burning ADMIN: `next` may be a non-signer placeholder. */
export function updateAssetAuthorityIx(p: { programId: PublicKey; current: PublicKey; next: PublicKey; market: PublicKey; burn?: boolean },
  args: E.UpdateAssetAuthorityArgs) {
  return ix(p.programId, [S(p.current, true), p.burn ? R(p.next) : S(p.next), W(p.market)], E.encUpdateAssetAuthority(args));
}
/**
 * [authority S, market W]. Appending a new slot reallocs the market by one slot; the program does not
 * add lamports, so prepend a transfer topping the market up to rent-exempt for the new size.
 */
export function updateAssetLifecycleIx(p: { programId: PublicKey; authority: PublicKey; market: PublicKey;
  /** Only for permissionless (fee-paying) ACTIVATE: source token of the payer. */
  activationFee?: { sourceToken: PublicKey; mint: PublicKey } }, args: E.UpdateAssetLifecycleArgs) {
  const keys = [S(p.authority, true), W(p.market)];
  if (p.activationFee) keys.push(W(p.activationFee.sourceToken),
    W(vaultAddress(p.programId, p.market, p.activationFee.mint)), R(TOKEN_PROGRAM_ID));
  return ix(p.programId, keys, E.encUpdateAssetLifecycle(args));
}
/** [owner (S only during the force-close delay), market W, portfolio W] + payout accounts when payout != 0. */
export function closeResolvedIx(p: { programId: PublicKey; owner: PublicKey; ownerSigns: boolean; market: PublicKey;
  portfolio: PublicKey; payout?: { destToken: PublicKey; mint: PublicKey } }) {
  const keys = [p.ownerSigns ? S(p.owner, true) : R(p.owner), W(p.market), W(p.portfolio)];
  if (p.payout) keys.push(W(p.payout.destToken), W(vaultAddress(p.programId, p.market, p.payout.mint)),
    R(vaultAuthority(p.programId, p.market)), R(TOKEN_PROGRAM_ID));
  return ix(p.programId, keys, E.encCloseResolved({ feeRatePerSlot: 0n }));
}
/**
 * [marketauth S+W, market W, vault W, vault authority, dest token W, token program, (primary mint W)].
 * May only advance a scan cursor; repeat until the market account is a 16-byte tombstone.
 */
export function closeSlabIx(p: { programId: PublicKey; marketauth: PublicKey; market: PublicKey; destToken: PublicKey; mint: PublicKey;
  includeMint?: boolean }, args: E.CloseSlabArgs) {
  const keys = [S(p.marketauth, true), W(p.market), W(vaultAddress(p.programId, p.market, p.mint)),
    R(vaultAuthority(p.programId, p.market)), W(p.destToken), R(TOKEN_PROGRAM_ID)];
  if (p.includeMint ?? true) keys.push(W(p.mint));
  return ix(p.programId, keys, E.encCloseSlab(args));
}
/** [cranker S, market W, portfolio A W, portfolio B W]. */
export function forceCloseAbandonedAssetIx(p: { programId: PublicKey; cranker: PublicKey; market: PublicKey; portfolioA: PublicKey;
  portfolioB: PublicKey }, args: E.ForceCloseAbandonedAssetArgs) {
  return ix(p.programId, [S(p.cranker, true), W(p.market), W(p.portfolioA), W(p.portfolioB)], E.encForceCloseAbandonedAsset(args));
}

/** Owner-only portfolio maintenance: [owner S, market W, portfolio W]. All bump the position epoch. */
function ownerIx<A>(enc: (a: A) => Buffer) {
  return (p: { programId: PublicKey; owner: PublicKey; market: PublicKey; portfolio: PublicKey }, args: A) =>
    ix(p.programId, [S(p.owner, true), W(p.market), W(p.portfolio)], enc(args));
}
export const convertReleasedPnlIx = ownerIx(E.encConvertReleasedPnl);
export const forfeitRecoveryLegIx = ownerIx(E.encForfeitRecoveryLeg);
export const rebalanceReduceIx = ownerIx(E.encRebalanceReduce);
/** [owner S, market W, portfolio W] + (optionalDeposit != 0: source token W, vault W, token program). */
export function cureAndCancelCloseIx(p: { programId: PublicKey; owner: PublicKey; market: PublicKey; portfolio: PublicKey;
  deposit?: { sourceToken: PublicKey; mint: PublicKey } }, args: E.CureAndCancelCloseArgs) {
  const keys = [S(p.owner, true), W(p.market), W(p.portfolio)];
  if (BigInt(args.optionalDeposit) !== 0n) {
    if (!p.deposit) throw new Error("optionalDeposit != 0 needs deposit accounts");
    keys.push(W(p.deposit.sourceToken), W(vaultAddress(p.programId, p.market, p.deposit.mint)), R(TOKEN_PROGRAM_ID));
  }
  return ix(p.programId, keys, E.encCureAndCancelClose(args));
}
/** Permissionless: [owner, market W, portfolio W, dest token W, vault W, vault authority, token program]. */
export function claimResolvedPayoutTopupIx(p: { programId: PublicKey; owner: PublicKey; market: PublicKey; portfolio: PublicKey;
  destToken: PublicKey; mint: PublicKey }) {
  return ix(p.programId, [R(p.owner), W(p.market), W(p.portfolio), W(p.destToken), W(vaultAddress(p.programId, p.market, p.mint)),
    R(vaultAuthority(p.programId, p.market)), R(TOKEN_PROGRAM_ID)], E.encClaimResolvedPayoutTopup());
}
/** [backing authority of domain/2 S, market W, ledger W (240 B, program-owned)]. */
export function syncBackingDomainLedgerIx(p: { programId: PublicKey; authority: PublicKey; market: PublicKey; ledger: PublicKey },
  args: E.SyncBackingDomainLedgerArgs) {
  return ix(p.programId, [S(p.authority, true), W(p.market), W(p.ledger)], E.encSyncBackingDomainLedger(args));
}
/** [asset-0 insurance authority S, market W, ledger W (176 B, program-owned)]. */
export function syncInsuranceLedgerIx(p: { programId: PublicKey; authority: PublicKey; market: PublicKey; ledger: PublicKey }) {
  return ix(p.programId, [S(p.authority, true), W(p.market), W(p.ledger)], E.encSyncInsuranceLedger());
}
/** [backing authority of domain/2 S, market W, source token W, vault W, token program, (opt) ledger W]. */
export function topUpBackingBucketIx(p: { programId: PublicKey; authority: PublicKey; market: PublicKey; sourceToken: PublicKey;
  mint: PublicKey; ledger?: PublicKey }, args: E.TopUpBackingBucketArgs) {
  return ix(p.programId, topUpKeys(p), E.encTopUpBackingBucket(args));
}
/** [authority (S unless Resolved), market W, dest token W (owner = backing authority), vault W, vault authority, token program, (opt) ledger W]. */
export function withdrawBackingBucketIx(p: { programId: PublicKey; authority: PublicKey; authoritySigns?: boolean; market: PublicKey;
  destToken: PublicKey; mint: PublicKey; ledger?: PublicKey }, args: E.WithdrawBackingBucketArgs) {
  const keys = [(p.authoritySigns ?? true) ? S(p.authority, true) : R(p.authority), W(p.market), W(p.destToken),
    W(vaultAddress(p.programId, p.market, p.mint)), R(vaultAuthority(p.programId, p.market)), R(TOKEN_PROGRAM_ID)];
  if (p.ledger) keys.push(W(p.ledger));
  return ix(p.programId, keys, E.encWithdrawBackingBucket(args));
}
/** Ledger is REQUIRED and sits at index 2: [authority, market W, ledger W, dest token W, vault W, vault authority, token program]. */
export function withdrawBackingBucketEarningsIx(p: { programId: PublicKey; authority: PublicKey; authoritySigns?: boolean;
  market: PublicKey; ledger: PublicKey; destToken: PublicKey; mint: PublicKey }, args: E.WithdrawBackingBucketEarningsArgs) {
  return ix(p.programId, [(p.authoritySigns ?? true) ? S(p.authority, true) : R(p.authority), W(p.market), W(p.ledger),
    W(p.destToken), W(vaultAddress(p.programId, p.market, p.mint)), R(vaultAuthority(p.programId, p.market)), R(TOKEN_PROGRAM_ID)],
  E.encWithdrawBackingBucketEarnings(args));
}

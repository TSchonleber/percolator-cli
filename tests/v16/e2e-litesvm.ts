/**
 * End-to-end SDK test against the real compiled program, in-process (LiteSVM) — no devnet.
 *
 *   PERCOLATOR_SO=../percolator-prog/target/deploy/percolator_prog.so pnpm tsx tests/v16/e2e-litesvm.ts
 *
 * Flow: mint + market + vault -> two portfolios -> deposits -> replay rejection -> bilateral trade
 * -> crank -> insurance top-up (authority ok, non-authority rejected) -> unwind -> withdraw -> close.
 */
import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import {
  createInitializeMint2Instruction, createMintToInstruction, MINT_SIZE, AccountLayout,
} from "@solana/spl-token";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import * as path from "path";
import * as I from "../../src/v16/instructions.js";
import { parsePortfolio, parseMarketGroup } from "../../src/v16/parsers.js";
import { PORTFOLIO_ACCOUNT_LEN } from "../../src/v16/constants.js";

const SO = process.env.PERCOLATOR_SO
  ?? path.resolve(new URL(".", import.meta.url).pathname, "../../../percolator-prog/target/deploy/percolator_prog.so");
const POS_SCALE = 1_000_000n;
const PRICE = 1_000_000n;

const svm = new LiteSVM();
const programId = Keypair.generate().publicKey; // any address works: the program never checks its declared id
svm.addProgramFromFile(programId, SO);
svm.warpToSlot(1_000n);

let passed = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) throw new Error("ASSERT: " + msg);
  passed++; console.log("  ok  " + msg);
};
function send(ixs: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...I.computeBudgetIxs(), ...ixs);
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const res = svm.sendTransaction(tx);
  svm.expireBlockhash();
  return res;
}
function mustSend(label: string, ixs: TransactionInstruction[], signers: Keypair[]) {
  const res = send(ixs, signers);
  if (res instanceof FailedTransactionMetadata) {
    console.log(res.meta().prettyLogs());
    throw new Error(`${label} failed: ${res.toString()}`);
  }
  ok(true, `${label} (CU ${res.computeUnitsConsumed()})`);
  return res;
}
function customErr(res: ReturnType<typeof send>): number | null {
  if (!(res instanceof FailedTransactionMetadata)) return null;
  const m = res.toString().match(/Custom\((\d+)\)/) ?? res.meta().logs().join(" ").match(/custom program error: 0x([0-9a-f]+)/);
  return m ? (m[0].startsWith("Custom") ? Number(m[1]) : parseInt(m[1], 16)) : -1;
}
const data = (k: PublicKey) => Buffer.from(svm.getAccount(k)!.data);
const tokenAmount = (k: PublicKey) => AccountLayout.decode(data(k)).amount;
const rent = (n: number) => Number(svm.minimumBalanceForRentExemption(BigInt(n)));

// ---------------------------------------------------------------- actors + mint
const [admin, alice, bob, mallory] = [0, 1, 2, 3].map(() => Keypair.generate());
for (const k of [admin, alice, bob, mallory]) svm.airdrop(k.publicKey, 100_000_000_000n);
const mint = Keypair.generate();
mustSend("create collateral mint", [
  SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
    lamports: rent(MINT_SIZE), programId: I.TOKEN_PROGRAM_ID }),
  createInitializeMint2Instruction(mint.publicKey, 6, admin.publicKey, null),
], [admin, mint]);
const ata = (o: Keypair) => I.associatedTokenAddress(o.publicKey, mint.publicKey);
for (const o of [admin, alice, bob, mallory]) {
  mustSend(`ATA + mint for ${o === admin ? "admin" : o === alice ? "alice" : o === bob ? "bob" : "mallory"}`, [
    I.createAtaIdempotentIx(admin.publicKey, o.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, ata(o), admin.publicKey, 1_000_000_000n),
  ], [admin]);
}

// ---------------------------------------------------------------- market
const market = Keypair.generate();
const P = { programId };
mustSend("create + InitMarket (1 asset)", [
  I.createMarketAccountIx(admin.publicKey, market.publicKey, programId, 1, rent(I.marketAccountLen(1))),
  I.initMarketIx({ ...P, admin: admin.publicKey, market: market.publicKey, mint: mint.publicKey }, {
    // Same envelope as the author's live STOXX/SOL market (20x): MM must cover max move x accrual window.
    maxPortfolioAssets: 1, hMin: 0, hMax: 6_480_000, initialPrice: PRICE, minNonzeroMmReq: 500, minNonzeroImReq: 600,
    maintenanceMarginBps: 500, initialMarginBps: 500, maxTradingFeeBps: 10_000, tradeFeeBaseBps: 1,
    liquidationFeeBps: 5, liquidationFeeCap: 50_000_000_000n, minLiquidationAbs: 0, maxPriceMoveBpsPerSlot: 49,
    maxAccrualDtSlots: 10, maxAbsFundingE9PerSlot: 1_000, minFundingLifetimeSlots: 10_000_000, maxAccountBSettlementChunks: 16,
    maxBankruptCloseChunks: 16, maxBankruptCloseLifetimeSlots: 10_000_000, publicBChunkAtoms: 1_000_000,
    maintenanceFeePerSlot: 0,
  }),
  I.createAtaIdempotentIx(admin.publicKey, I.vaultAuthority(programId, market.publicKey), mint.publicKey),
], [admin, market]);
const vault = I.vaultAddress(programId, market.publicKey, mint.publicKey);
let mb = I.readMarketBinding(data(market.publicKey));
ok(mb.marketauth.equals(admin.publicKey), "marketauth = admin");
ok(mb.collateralMint.equals(mint.publicKey), "collateral mint recorded");
ok(mb.assets.length === 1 && mb.assets[0].marketId === 1n, `asset 0 generation = 1 (got ${mb.assets[0]?.marketId})`);
ok(mb.nextMarketId === 2n, `next_market_id = 2 (got ${mb.nextMarketId})`);
ok(mb.assets[0].profile.insuranceAuthority.equals(admin.publicKey), "asset-0 insurance authority = admin");
const mkt = { ...P, market: market.publicKey };

// ---------------------------------------------------------------- portfolios + deposits
const pf = new Map<Keypair, PublicKey>();
for (const [name, o] of [["alice", alice], ["bob", bob]] as const) {
  const k = Keypair.generate();
  pf.set(o, k.publicKey);
  mustSend(`create + InitPortfolio ${name}`, [
    I.createPortfolioAccountIx(o.publicKey, k.publicKey, programId, rent(PORTFOLIO_ACCOUNT_LEN)),
    I.initPortfolioIx({ ...mkt, owner: o.publicKey, portfolio: k.publicKey }),
  ], [o, k]);
}
const bA0 = I.readPortfolioBinding(data(pf.get(alice)!));
const bB0 = I.readPortfolioBinding(data(pf.get(bob)!));
ok(bA0.portfolioId !== 0n && bB0.portfolioId !== 0n && bA0.portfolioId !== bB0.portfolioId,
  `portfolio ids assigned (${bA0.portfolioId}, ${bB0.portfolioId})`);
ok(parsePortfolio(data(pf.get(alice)!)).owner.equals(alice.publicKey), "portfolio owner parsed");

const DEPOSIT = 100_000_000n;
for (const [name, o] of [["alice", alice], ["bob", bob]] as const) {
  const b = I.readPortfolioBinding(data(pf.get(o)!));
  mustSend(`Deposit ${name}`, [I.depositIx({ ...mkt, owner: o.publicKey, portfolio: pf.get(o)!, sourceToken: ata(o),
    mint: mint.publicKey }, { portfolioId: b.portfolioId, expectedSequence: b.expectedSequence, amount: DEPOSIT })], [o]);
  const after = I.readPortfolioBinding(data(pf.get(o)!));
  ok(after.expectedSequence === b.expectedSequence + 1n, `${name} owner sequence advanced`);
  ok(parsePortfolio(data(pf.get(o)!)).capital === DEPOSIT, `${name} capital = deposit`);
}
ok(tokenAmount(vault) === 2n * DEPOSIT, "vault holds both deposits");
ok(parseMarketGroup(data(market.publicKey)).vault === 2n * DEPOSIT, "engine vault total matches");

// replay: re-using the old sequence must fail with EngineStale (19)
{
  const res = send([I.depositIx({ ...mkt, owner: alice.publicKey, portfolio: pf.get(alice)!, sourceToken: ata(alice),
    mint: mint.publicKey }, { portfolioId: bA0.portfolioId, expectedSequence: bA0.expectedSequence, amount: 1n })], [alice]);
  ok(customErr(res) === 19, `stale expected_sequence rejected with EngineStale (got ${customErr(res)})`);
}

// ---------------------------------------------------------------- trade
function trade(sizeQ: bigint, label: string) {
  const a = I.readPortfolioBinding(data(pf.get(alice)!));
  const b = I.readPortfolioBinding(data(pf.get(bob)!));
  const m = I.readMarketBinding(data(market.publicKey));
  mustSend(label, [I.tradeNoCpiIx({ ...mkt, ownerA: alice.publicKey, ownerB: bob.publicKey,
    portfolioA: pf.get(alice)!, portfolioB: pf.get(bob)! }, {
    accountAPortfolioId: a.portfolioId, accountAPositionEpoch: a.positionEpoch,
    accountBPortfolioId: b.portfolioId, accountBPositionEpoch: b.positionEpoch,
    assetIndex: 0, marketId: m.assets[0].marketId, sizeQ, execPrice: PRICE, feeBps: 1, backingFeeCapBps: 0,
  })], [alice, bob]);
  ok(I.readPortfolioBinding(data(pf.get(alice)!)).positionEpoch === a.positionEpoch + 1n, "taker position epoch bumped");
}
trade(10n * POS_SCALE, "TradeNoCpi alice long 10 vs bob");
{
  const pa = parsePortfolio(data(pf.get(alice)!));
  const pb = parsePortfolio(data(pf.get(bob)!));
  ok(pa.legs.length === 1 && pa.legs[0].assetIndex === 0, "alice has one leg on asset 0");
  ok(pa.legs[0].basisPosQ > 0n && pb.legs[0].basisPosQ < 0n, `alice long / bob short (${pa.legs[0].basisPosQ}, ${pb.legs[0].basisPosQ})`);
}

// ---------------------------------------------------------------- crank (manual oracle: 0 oracle accounts)
svm.warpToSlot(1_002n);
{
  const res = send([I.permissionlessCrankIx({ ...mkt, cranker: mallory.publicKey, target: pf.get(alice)! },
    { nowSlot: 1_002n, observations: [{ assetIndex: 0, oracleAccounts: 0 }] })], [mallory]);
  const e = customErr(res);
  ok(e === null || e === 22, `PermissionlessCrank accepted or no-progress (err=${e})`);
}

// ---------------------------------------------------------------- insurance top-up (bounty 7 question)
function topUp(signer: Keypair, amount: bigint) {
  const m = I.readMarketBinding(data(market.publicKey));
  const a0 = m.assets[0];
  return send([I.topUpInsuranceIx({ ...mkt, authority: signer.publicKey, sourceToken: ata(signer), mint: mint.publicKey }, {
    marketId: a0.marketId, intentId: a0.controls.insuranceTopUp + 1n, authorityEpoch: a0.controls.authorityEpoch, amount,
  })], [signer]);
}
{
  const before = parseMarketGroup(data(market.publicKey)).insurance;
  const res = topUp(mallory, 5_000_000n);
  ok(res instanceof FailedTransactionMetadata, `non-authority TopUpInsurance rejected (err=${customErr(res)})`);
  ok(parseMarketGroup(data(market.publicKey)).insurance === before, "insurance unchanged after rejected top-up");
  const res2 = topUp(admin, 5_000_000n);
  if (res2 instanceof FailedTransactionMetadata) { console.log(res2.meta().prettyLogs()); throw new Error("admin top-up failed"); }
  ok(parseMarketGroup(data(market.publicKey)).insurance === before + 5_000_000n, "authority TopUpInsurance credited insurance");
  ok(I.readMarketBinding(data(market.publicKey)).assets[0].controls.insuranceTopUp === 1n, "insurance_top_up intent lane advanced");
}

// ---------------------------------------------------------------- unwind, withdraw, close
svm.warpToSlot(1_003n);
trade(-10n * POS_SCALE, "TradeNoCpi unwind");
ok(parsePortfolio(data(pf.get(alice)!)).legs.length === 0, "alice flat after unwind");
for (const [name, o] of [["alice", alice], ["bob", bob]] as const) {
  const p = parsePortfolio(data(pf.get(o)!));
  const b = I.readPortfolioBinding(data(pf.get(o)!));
  const tokBefore = tokenAmount(ata(o));
  mustSend(`Withdraw all ${name}`, [I.withdrawIx({ ...mkt, owner: o.publicKey, portfolio: pf.get(o)!, destToken: ata(o),
    mint: mint.publicKey }, { portfolioId: b.portfolioId, expectedSequence: b.expectedSequence, amount: p.capital })], [o]);
  ok(tokenAmount(ata(o)) - tokBefore === p.capital, `${name} received ${p.capital}`);
  const b2 = I.readPortfolioBinding(data(pf.get(o)!));
  mustSend(`ClosePortfolio ${name}`, [I.closePortfolioIx({ ...mkt, closer: o.publicKey, portfolio: pf.get(o)! },
    { portfolioId: b2.portfolioId, expectedSequence: b2.expectedSequence, positionEpoch: b2.positionEpoch })], [o]);
  const acct = svm.getAccount(pf.get(o)!);
  ok(!acct || acct.data.length === 0, `${name} portfolio account closed`);
}
ok(parseMarketGroup(data(market.publicKey)).materializedPortfolioCount === 0n, "market has no portfolios left");
{
  // Trading fees are credited to group.insurance: the permissionless way insurance grows.
  const ins = parseMarketGroup(data(market.publicKey)).insurance;
  ok(ins === 5_000_000n + 4_000n, `insurance = top-up + both sides' fees on 2 trades (got ${ins})`);
  ok(tokenAmount(vault) === ins, "vault now holds exactly the insurance fund");
}

console.log(`\ne2e OK: ${passed} checks passed against ${path.basename(SO)}`);

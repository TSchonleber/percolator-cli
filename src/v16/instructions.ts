/**
 * v16 instructions for percolator-prog 5cb331dd.
 *
 * - Encoders (`enc*`, `TAG`, `*Args`) are generated from the program's own
 *   ix::Instruction::encode() — see encode.gen.ts and tests/v16/ix-vectors.ts.
 * - Builders (`*Ix`) attach the account lists and read replay-protection bindings — see builders.ts.
 *
 * The pre-port encoders were removed: their wire formats (no portfolio_id / sequence /
 * epoch bindings, old PermissionlessCrank body, dead tags 23/41/47) are rejected by this program.
 */
export * from "./encode.gen.js";
export * from "./builders.js";

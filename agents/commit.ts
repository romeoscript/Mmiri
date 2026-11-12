/**
 * The sealed-bid commitment.
 *
 * This is the TypeScript half of a definition that also exists in Rust
 * (`contracts/market/src/bid.rs::commit_preimage`). The two must agree byte for byte or
 * every reveal fails, so the specification lives in `docs/RULES.md` §3 and both sides
 * implement it from there rather than from each other.
 *
 *   preimage = "mmiri:bid:v1:" || round_id || ":" || premium || ":" || salt_hex || ":" || bidder
 *   commit   = sha256(utf8(preimage))
 *
 * `:` cannot occur inside any field — NEAR account ids are [a-z0-9._-], and the other
 * three are decimal or lowercase hex — so the encoding is injective.
 */

import { createHash, randomBytes } from "node:crypto";

/** A fresh 32-byte salt as 64 lowercase hex characters. */
export function newSalt(): string {
  return randomBytes(32).toString("hex");
}

export function commitPreimage(
  roundId: string | number | bigint,
  premium: bigint,
  saltHex: string,
  bidder: string,
): string {
  if (!/^[0-9a-f]{64}$/.test(saltHex)) {
    throw new Error("salt must be 32 bytes as 64 lowercase hex characters");
  }
  return `mmiri:bid:v1:${roundId}:${premium}:${saltHex}:${bidder}`;
}

export function commitHash(
  roundId: string | number | bigint,
  premium: bigint,
  saltHex: string,
  bidder: string,
): string {
  return createHash("sha256")
    .update(commitPreimage(roundId, premium, saltHex, bidder), "utf8")
    .digest("hex");
}

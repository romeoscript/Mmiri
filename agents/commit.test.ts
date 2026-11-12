/**
 * Pins the commit preimage across languages.
 *
 * The expected string below is copied from the Rust test in
 * contracts/market/src/bid.rs. If either side ever changes its encoding, this file and
 * that test disagree with each other and one of them fails — which is the only way to
 * catch a drift that would otherwise show up as "every reveal is rejected" on testnet.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { commitHash, commitPreimage, newSalt } from "./commit";

const BIDDER = "uw-3.mmiri.testnet";

describe("commit preimage", () => {
  it("matches the Rust implementation byte for byte", () => {
    const salt = "a".repeat(64);
    expect(commitPreimage(7, 12_500_000n, salt, BIDDER)).toBe(
      `mmiri:bid:v1:7:12500000:${salt}:${BIDDER}`,
    );
  });

  it("hashes to sha256 of exactly that string", () => {
    const salt = "a".repeat(64);
    const expected = createHash("sha256")
      .update(`mmiri:bid:v1:7:12500000:${salt}:${BIDDER}`, "utf8")
      .digest("hex");
    expect(commitHash(7, 12_500_000n, salt, BIDDER)).toBe(expected);
  });

  it("binds the commitment to its bidder", () => {
    // Without this, a watcher could lift a sealed bid off the chain and reveal it as
    // their own. THREAT_MODEL T8.
    const salt = "0".repeat(64);
    expect(commitHash(1, 100n, salt, "uw-1.x.testnet")).not.toBe(
      commitHash(1, 100n, salt, "uw-2.x.testnet"),
    );
  });

  it("binds the commitment to its round", () => {
    const salt = "0".repeat(64);
    expect(commitHash(1, 100n, salt, BIDDER)).not.toBe(commitHash(2, 100n, salt, BIDDER));
  });

  it("rejects a malformed salt rather than hashing something unrevealable", () => {
    expect(() => commitHash(1, 100n, "tooshort", BIDDER)).toThrow(/32 bytes/);
    expect(() => commitHash(1, 100n, "A".repeat(64), BIDDER)).toThrow(/lowercase/);
  });

  it("generates 32-byte lowercase-hex salts", () => {
    for (let i = 0; i < 20; i++) expect(newSalt()).toMatch(/^[0-9a-f]{64}$/);
    expect(newSalt()).not.toBe(newSalt());
  });
});

/**
 * The vault's encryption.
 *
 * The properties worth pinning are the ones whose absence is invisible: that a
 * tampered row fails loudly rather than decrypting to something else, and that
 * the same plaintext never encrypts to the same ciphertext twice — an IV reused
 * under one key is what breaks GCM, and nothing about the output looks wrong
 * when it happens.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  valueHint,
  vaultKeyConfigured,
} from "@/lib/secret-crypto";

const ORIGINAL_KEY = process.env.SECRET_VAULT_KEY;

beforeAll(() => {
  process.env.SECRET_VAULT_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SECRET_VAULT_KEY;
  else process.env.SECRET_VAULT_KEY = ORIGINAL_KEY;
});

describe("encrypt and decrypt", () => {
  it("returns the original value", () => {
    const plain = "sk_live_51H8xQ2KZvBcDeFgHiJkLmNoP";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("handles unicode and punctuation", () => {
    const plain = "pässwörd-with-émoji-🔐-and \"quotes\" & \slashes";
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("never produces the same ciphertext twice", () => {
    const plain = "the same secret every time";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);

    // Different IVs, therefore different ciphertext, therefore an observer
    // cannot tell that two rows hold the same value.
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it("does not leak the plaintext into the stored fields", () => {
    const plain = "hunter2-in-the-clear";
    const enc = encryptSecret(plain);
    expect(enc.ciphertext).not.toContain(plain);
    expect(`${enc.ciphertext}${enc.iv}${enc.tag}`).not.toContain(plain);
  });
});

describe("tampering", () => {
  it("refuses a modified ciphertext rather than returning wrong plaintext", () => {
    const enc = encryptSecret("sk_live_do_not_alter_me");

    // Flip the first byte of the ciphertext.
    const bytes = Buffer.from(enc.ciphertext, "base64");
    bytes[0] ^= 0xff;

    expect(() =>
      decryptSecret({ ...enc, ciphertext: bytes.toString("base64") }),
    ).toThrow(/could not be decrypted/i);
  });

  it("refuses a modified auth tag", () => {
    const enc = encryptSecret("sk_live_do_not_alter_me");
    const tag = Buffer.from(enc.tag, "base64");
    tag[0] ^= 0xff;

    expect(() => decryptSecret({ ...enc, tag: tag.toString("base64") })).toThrow(
      /could not be decrypted/i,
    );
  });

  it("refuses to decrypt under a different key", () => {
    const enc = encryptSecret("sk_live_key_rotation_test");

    const previous = process.env.SECRET_VAULT_KEY;
    process.env.SECRET_VAULT_KEY = randomBytes(32).toString("base64");
    expect(() => decryptSecret(enc)).toThrow(/SECRET_VAULT_KEY has changed/i);
    process.env.SECRET_VAULT_KEY = previous;
  });
});

describe("the key itself", () => {
  it("is reported missing rather than assumed", () => {
    const previous = process.env.SECRET_VAULT_KEY;
    delete process.env.SECRET_VAULT_KEY;

    expect(vaultKeyConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/SECRET_VAULT_KEY is not set/i);

    process.env.SECRET_VAULT_KEY = previous;
  });

  it("rejects a key of the wrong length instead of failing obscurely", () => {
    const previous = process.env.SECRET_VAULT_KEY;
    process.env.SECRET_VAULT_KEY = randomBytes(16).toString("base64");

    expect(vaultKeyConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/must be 32 bytes/i);

    process.env.SECRET_VAULT_KEY = previous;
  });
});

describe("valueHint", () => {
  it("gives the last four characters of a long secret", () => {
    expect(valueHint("sk_live_abcdefghijkl")).toBe("ijkl");
  });

  it("gives nothing for a short one, which it would mostly reveal", () => {
    expect(valueHint("1234567")).toBeNull();
  });
});

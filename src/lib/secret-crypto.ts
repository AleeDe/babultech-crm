import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encryption for the credential vault.
 *
 * AES-256-GCM, with the key held in SECRET_VAULT_KEY and never in the database.
 * That separation is the entire security model: a dump of the `secret` table on
 * its own decrypts to nothing. It also means losing the key loses every stored
 * value — there is no recovery path, by design, so the key belongs in your
 * hosting provider's environment settings with a copy in an offline password
 * manager.
 *
 * GCM rather than CBC because it authenticates as well as encrypts. A row whose
 * ciphertext has been tampered with fails to decrypt instead of quietly
 * returning different plaintext, which for a credential store is the difference
 * between a visible error and someone silently using a swapped-in key.
 */

const ALGORITHM = "aes-256-gcm";
/** GCM's standard IV length. 12 bytes is what the mode is specified around. */
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * The vault key, validated.
 *
 * Read on each call rather than cached at module load: a missing key must fail
 * when someone tries to use the vault, not stop the whole application from
 * booting for the many deployments that never touch this feature.
 */
function vaultKey(): Buffer {
  const raw = process.env.SECRET_VAULT_KEY;

  if (!raw) {
    throw new Error(
      "SECRET_VAULT_KEY is not set, so the credential vault cannot be opened. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  const key = Buffer.from(raw, "base64");

  // A short key is the failure worth catching loudly. Node would otherwise
  // throw something obscure about key length at cipher creation, and a
  // truncated or mistyped key would look like a code fault rather than a
  // configuration one.
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `SECRET_VAULT_KEY must be 32 bytes encoded as base64 (got ${key.length}). ` +
        "Generate one with: openssl rand -base64 32",
    );
  }

  return key;
}

/** True when a usable vault key is configured, without throwing. */
export function vaultKeyConfigured(): boolean {
  try {
    vaultKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const key = vaultKey();
  // A fresh IV per encryption. Reusing one under the same key is the single
  // mistake that breaks GCM outright, so it is generated here and never
  // supplied by a caller.
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const key = vaultKey();

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // final() throws when the tag does not match. The cause is either a wrong
    // key or a modified row, and the message says both rather than guessing —
    // telling someone their data is corrupt when they have simply rotated the
    // key badly would send them looking in the wrong place.
    throw new Error(
      "This secret could not be decrypted. Either SECRET_VAULT_KEY has changed " +
        "since it was saved, or the stored value has been altered.",
    );
  }
}

/**
 * The last few characters, kept in the clear for identification.
 *
 * Enough to match a key against the provider's dashboard, short enough not to
 * meaningfully narrow a brute-force search. Very short secrets return nothing:
 * four of the six characters of a short PIN is most of it.
 */
export function valueHint(plaintext: string): string | null {
  if (plaintext.length < 8) return null;
  return plaintext.slice(-4);
}

/** Constant-time comparison, for confirming a value without leaking it by timing. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

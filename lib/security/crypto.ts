import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export type EncryptedValue = {
  encryptedValue: string;
  encryptionIv: string;
  encryptionTag: string;
};

function encryptionKey(): Buffer {
  const source = process.env.APP_ENCRYPTION_KEY;
  if (!source) {
    throw new Error("APP_ENCRYPTION_KEY is not configured.");
  }
  return createHash("sha256").update(source, "utf8").digest();
}

export function encryptSecret(value: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedValue: encrypted.toString("base64url"),
    encryptionIv: iv.toString("base64url"),
    encryptionTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptSecret(input: EncryptedValue): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(input.encryptionIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(input.encryptionTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashAccessCode(code: string): string {
  const pepper = process.env.ACCESS_CODE_PEPPER;
  if (!pepper) {
    throw new Error("ACCESS_CODE_PEPPER is not configured.");
  }
  return createHmac("sha256", pepper)
    .update(code.replace(/\s+/g, "").toUpperCase())
    .digest("base64url");
}

export function createAdminPasswordHash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyAdminPassword(
  password: string,
  encodedHash: string,
): boolean {
  const [scheme, saltEncoded, hashEncoded] = encodedHash.split("$");
  if (scheme !== "scrypt" || !saltEncoded || !hashEncoded) {
    return false;
  }
  const expected = Buffer.from(hashEncoded, "base64url");
  const actual = scryptSync(
    password,
    Buffer.from(saltEncoded, "base64url"),
    expected.length,
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashForLog(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

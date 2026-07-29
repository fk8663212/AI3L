import { afterEach, describe, expect, it } from "vitest";
import {
  createAdminPasswordHash,
  decryptSecret,
  encryptSecret,
  hashAccessCode,
  verifyAdminPassword,
} from "@/lib/security/crypto";

const originalEncryptionKey = process.env.APP_ENCRYPTION_KEY;
const originalPepper = process.env.ACCESS_CODE_PEPPER;

afterEach(() => {
  process.env.APP_ENCRYPTION_KEY = originalEncryptionKey;
  process.env.ACCESS_CODE_PEPPER = originalPepper;
});

describe("research secrets", () => {
  it("encrypts API keys with an authenticated random nonce", () => {
    process.env.APP_ENCRYPTION_KEY = "test-master-key";
    const first = encryptSecret("secret-api-key");
    const second = encryptSecret("secret-api-key");

    expect(first.encryptedValue).not.toBe(second.encryptedValue);
    expect(decryptSecret(first)).toBe("secret-api-key");
  });

  it("normalizes anonymous access codes before HMAC hashing", () => {
    process.env.ACCESS_CODE_PEPPER = "test-pepper";
    expect(hashAccessCode("ab cd-1234")).toBe(hashAccessCode("ABCD-1234"));
  });

  it("verifies scrypt admin hashes without storing the password", () => {
    const encoded = createAdminPasswordHash("a-long-research-password");
    expect(verifyAdminPassword("a-long-research-password", encoded)).toBe(true);
    expect(verifyAdminPassword("wrong-password", encoded)).toBe(false);
  });
});

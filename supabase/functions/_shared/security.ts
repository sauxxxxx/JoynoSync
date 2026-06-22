import { getEnv, getRequiredEnv } from "./runtime.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length % 2 !== 0) {
    throw new Error("Invalid hex value");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function stringToBase64Url(value: string) {
  return bytesToBase64Url(textEncoder.encode(String(value || "")));
}

export function base64UrlToString(value: string) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return textDecoder.decode(base64ToBytes(`${normalized}${padding}`));
}

export function toMimeBase64(value: string) {
  return bytesToBase64(textEncoder.encode(String(value || ""))).replace(/.{1,76}/g, "$&\r\n").trim();
}

export function randomHex(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function getEncryptionKeyBytes() {
  const keyHex = getEnv("EMAIL_TOKEN_ENCRYPTION_KEY");
  if (!keyHex) {
    return null;
  }
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== 32) {
    throw new Error("EMAIL_TOKEN_ENCRYPTION_KEY must be 32-byte hex");
  }
  return keyBytes;
}

async function importEncryptionKey(keyBytes: Uint8Array) {
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ]);
}

export async function encryptSecret(value: string) {
  const keyBytes = getEncryptionKeyBytes();
  if (!keyBytes) {
    return String(value || "");
  }

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importEncryptionKey(keyBytes);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder.encode(String(value || "")))
  );
  const tag = encrypted.slice(encrypted.length - 16);
  const content = encrypted.slice(0, encrypted.length - 16);
  return `v1:${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(content)}`;
}

export async function decryptSecret(value: string) {
  const raw = String(value || "");
  if (!raw.startsWith("v1:")) {
    return raw;
  }

  const keyBytes = getEncryptionKeyBytes();
  if (!keyBytes) {
    throw new Error("EMAIL_TOKEN_ENCRYPTION_KEY is required to decrypt token");
  }

  const parts = raw.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted token format");
  }

  const iv = hexToBytes(parts[1]);
  const tag = hexToBytes(parts[2]);
  const content = hexToBytes(parts[3]);
  const encrypted = new Uint8Array(content.length + tag.length);
  encrypted.set(content);
  encrypted.set(tag, content.length);
  const key = await importEncryptionKey(keyBytes);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return textDecoder.decode(decrypted);
}

export async function signState(payload: unknown) {
  const secret = getRequiredEnv("EMAIL_STATE_SECRET");
  const encodedPayload = stringToBase64Url(JSON.stringify(payload));
  const key = await importHmacKey(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedPayload)));
  return `${encodedPayload}.${bytesToHex(signature)}`;
}

export async function verifyState(stateValue: string) {
  const [encodedPayload, signatureHex] = String(stateValue || "").split(".");
  if (!encodedPayload || !signatureHex) {
    throw new Error("Invalid state");
  }

  const secret = getRequiredEnv("EMAIL_STATE_SECRET");
  const key = await importHmacKey(secret);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signatureHex),
    textEncoder.encode(encodedPayload)
  );

  if (!isValid) {
    throw new Error("Invalid state signature");
  }

  return JSON.parse(base64UrlToString(encodedPayload));
}

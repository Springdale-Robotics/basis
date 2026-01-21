import { createRequire } from 'module';
import { config } from '../config/index.js';

// Use CommonJS require for libsodium-wrappers due to broken ESM exports
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers');

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await sodium.ready;
    initialized = true;
  }
}

function getEncryptionKey(): Uint8Array {
  const keyHex = config.ENCRYPTION_KEY;
  return Uint8Array.from(Buffer.from(keyHex, 'hex'));
}

export async function encrypt(plaintext: string): Promise<string> {
  await ensureInitialized();
  const key = getEncryptionKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    sodium.from_string(plaintext),
    nonce,
    key
  );

  // Combine nonce and ciphertext
  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);

  return sodium.to_base64(combined);
}

export async function decrypt(encrypted: string): Promise<string> {
  await ensureInitialized();
  const key = getEncryptionKey();
  const combined = sodium.from_base64(encrypted);

  const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES);

  const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(decrypted);
}

export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  await ensureInitialized();
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(keypair.publicKey),
    privateKey: sodium.to_base64(keypair.privateKey),
  };
}

export async function encryptWithPublicKey(
  plaintext: string,
  recipientPublicKey: string
): Promise<string> {
  await ensureInitialized();
  const publicKey = sodium.from_base64(recipientPublicKey);
  const ciphertext = sodium.crypto_box_seal(
    sodium.from_string(plaintext),
    publicKey
  );
  return sodium.to_base64(ciphertext);
}

export async function decryptWithPrivateKey(
  encrypted: string,
  publicKey: string,
  privateKey: string
): Promise<string> {
  await ensureInitialized();
  const pub = sodium.from_base64(publicKey);
  const priv = sodium.from_base64(privateKey);
  const ciphertext = sodium.from_base64(encrypted);

  const decrypted = sodium.crypto_box_seal_open(ciphertext, pub, priv);
  return sodium.to_string(decrypted);
}

export async function hashForVerification(data: string): Promise<string> {
  await ensureInitialized();
  const hash = sodium.crypto_generichash(32, sodium.from_string(data));
  return sodium.to_hex(hash);
}

export async function generateRandomToken(length = 32): Promise<string> {
  await ensureInitialized();
  const bytes = sodium.randombytes_buf(length);
  return sodium.to_hex(bytes);
}

export async function signMessage(
  message: string,
  privateKey: string
): Promise<string> {
  await ensureInitialized();
  const priv = sodium.from_base64(privateKey);
  const signature = sodium.crypto_sign_detached(
    sodium.from_string(message),
    priv
  );
  return sodium.to_base64(signature);
}

export async function verifySignature(
  message: string,
  signature: string,
  publicKey: string
): Promise<boolean> {
  await ensureInitialized();
  try {
    const pub = sodium.from_base64(publicKey);
    const sig = sodium.from_base64(signature);
    return sodium.crypto_sign_verify_detached(
      sig,
      sodium.from_string(message),
      pub
    );
  } catch {
    return false;
  }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

function getMasterKey() {
  const source = process.env.GENERGI_MODEL_CONTROL_MASTER_KEY?.trim()
  if (!source) {
    if (process.env.NODE_ENV !== "production") {
      return createHash("sha256").update("genergi-model-control-dev-key").digest()
    }
    throw new Error("MODEL_CONTROL_MASTER_KEY_MISSING")
  }

  return createHash("sha256").update(source).digest()
}

export function encryptControlPlaneSecret(plaintext: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getMasterKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

export function decryptControlPlaneSecret(ciphertext: string) {
  const payload = Buffer.from(ciphertext, "base64")
  const iv = payload.subarray(0, 12)
  const tag = payload.subarray(12, 28)
  const encrypted = payload.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", getMasterKey(), iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return plaintext.toString("utf8")
}

export function maskSecret(value: string | null) {
  if (!value) {
    return null
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}****`
  }

  return `${value.slice(0, 4)}****${value.slice(-2)}`
}

import { safeStorage } from 'electron'

export function encryptSecret(secret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System secure storage is not available on this machine.')
  }

  return safeStorage.encryptString(secret).toString('base64')
}

export function decryptSecret(secret: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System secure storage is not available on this machine.')
  }

  return safeStorage.decryptString(Buffer.from(secret, 'base64'))
}

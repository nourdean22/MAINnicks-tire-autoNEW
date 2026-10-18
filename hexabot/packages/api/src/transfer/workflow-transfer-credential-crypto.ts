/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';

import { type WorkflowCredentialProtection } from '@hexabot-ai/types';

import { type WorkflowTransferCredentialResource } from './workflow-transfer.types';

const SCRYPT_OPTIONS = {
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
} as const;
const KEY_LENGTH = 32;
const DERIVED_KEY_LENGTH = KEY_LENGTH * 2;
const AAD = Buffer.from('hexabot.workflow.credentials.v1');
const deriveKeyMaterial = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, DERIVED_KEY_LENGTH, SCRYPT_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

export const deriveWorkflowCredentialKeys = async (
  password: string,
  salt: Buffer,
) => {
  const keyMaterial = await deriveKeyMaterial(password, salt);

  return [
    keyMaterial.subarray(0, KEY_LENGTH),
    keyMaterial.subarray(KEY_LENGTH),
  ] as const;
};

export const encryptWorkflowCredentialValues = async (
  credentials: WorkflowTransferCredentialResource[],
  password: string,
): Promise<readonly [WorkflowCredentialProtection, Buffer]> => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const [encryptionKey, integrityKey] = await deriveWorkflowCredentialKeys(
    password,
    salt,
  );
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(AAD);
  const values = Object.fromEntries(
    credentials.flatMap(({ exportId, value }) =>
      value === undefined ? [] : [[exportId, value]],
    ),
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(values), 'utf8'),
    cipher.final(),
  ]);

  return [
    {
      keyDerivation: 'scrypt',
      salt: salt.toString('base64'),
      cost: SCRYPT_OPTIONS.N,
      blockSize: SCRYPT_OPTIONS.r,
      parallelization: SCRYPT_OPTIONS.p,
      cipher: 'aes-256-gcm',
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    },
    integrityKey,
  ];
};

export const decryptWorkflowCredentialValues = (
  protection: WorkflowCredentialProtection,
  encryptionKey: Buffer,
): Record<string, string> => {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(protection.iv, 'base64'),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(protection.authTag, 'base64'));

  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(protection.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  ) as Record<string, string>;
};

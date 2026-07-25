import { Buffer } from "node:buffer";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  decryptSettingSecret,
  encryptSettingSecret,
  type SettingSecretKeyring,
} from "../settings/settings-secret-codec.js";

export const PROVIDER_SECRET_MASK = "••••••••";

const MAX_PROVIDER_SECRET_BYTES = 8_192;
const SECRET_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

declare const providerSecretEnvelopeBrand: unique symbol;
export type ProviderSecretEnvelope = string & {
  readonly [providerSecretEnvelopeBrand]: true;
};

export type ProviderSecretRecordMetadata = Readonly<{
  envelope?: string | null;
  id: string | null;
  revision: number;
  updatedAt: Date | string | null;
}>;

export type ProviderSecretPublicMetadata =
  | Readonly<{
      configured: false;
      id: null;
      mask: null;
      revision: 0;
      updatedAt: null;
    }>
  | Readonly<{
      configured: true;
      id: string;
      mask: typeof PROVIDER_SECRET_MASK;
      revision: number;
      updatedAt: string;
    }>;

@Injectable()
export class ProviderSecretService {
  private readonly keyring: SettingSecretKeyring;

  constructor(config: ConfigService) {
    const currentKey = config.get<string>("settings.encryptionKey", "");
    const currentKeyId = config.get<string>("settings.encryptionKeyId", "");
    if (!currentKey?.trim() || !currentKeyId?.trim()) {
      throw new Error("Provider secret encryption keyring is not configured");
    }
    this.keyring = Object.freeze({
      currentKey,
      currentKeyId,
      previousKeys: Object.freeze({
        ...(config.get<Record<string, string>>(
          "settings.previousEncryptionKeys",
          {},
        ) ?? {}),
      }),
    });
  }

  encrypt(apiKey: string): ProviderSecretEnvelope {
    validateProviderSecret(apiKey);
    return encryptSettingSecret(apiKey, this.keyring) as ProviderSecretEnvelope;
  }

  decrypt(envelope: ProviderSecretEnvelope | string) {
    return decryptSettingSecret(envelope, this.keyring);
  }

  rotate(envelope: ProviderSecretEnvelope | string): ProviderSecretEnvelope {
    const plaintext = this.decrypt(envelope);
    validateProviderSecret(plaintext);
    return encryptSettingSecret(plaintext, this.keyring) as ProviderSecretEnvelope;
  }

  metadata(record: ProviderSecretRecordMetadata): ProviderSecretPublicMetadata {
    if (!record.id) {
      if (
        record.envelope ||
        record.revision !== 0 ||
        record.updatedAt !== null
      ) {
        throw new Error("Provider secret metadata is inconsistent");
      }
      return Object.freeze({
        configured: false,
        id: null,
        mask: null,
        revision: 0,
        updatedAt: null,
      });
    }

    if (
      !record.id.trim() ||
      !Number.isInteger(record.revision) ||
      record.revision < 1 ||
      !record.updatedAt
    ) {
      throw new Error("Provider secret metadata is inconsistent");
    }
    const updatedAt = toIsoDateTime(record.updatedAt);
    return Object.freeze({
      configured: true,
      id: record.id,
      mask: PROVIDER_SECRET_MASK,
      revision: record.revision,
      updatedAt,
    });
  }
}

function validateProviderSecret(value: string) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > MAX_PROVIDER_SECRET_BYTES ||
    SECRET_CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error("Provider secret is invalid");
  }
}

function toIsoDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Provider secret metadata is inconsistent");
  }
  return date.toISOString();
}

import { Buffer } from "node:buffer";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  TOOL_CONNECTION_SECRET_MASK,
  type ToolConnectionSecretMetadata,
} from "@hermes-swarm/api-contracts/ai";
import {
  decryptSettingSecret,
  encryptSettingSecret,
  type SettingSecretKeyring,
} from "../settings/settings-secret-codec.js";

const MAX_TOOL_CONNECTION_SECRET_BYTES = 8_192;
const SECRET_HTTP_FIELD_VALUE = /^[\x20-\x7e]+$/;

declare const toolConnectionSecretEnvelopeBrand: unique symbol;
export type ToolConnectionSecretEnvelope = string & {
  readonly [toolConnectionSecretEnvelopeBrand]: true;
};

export type ToolConnectionSecretRecordMetadata = Readonly<{
  envelope?: string | null;
  id: string | null;
  revision: number;
  updatedAt: Date | string | null;
}>;

@Injectable()
export class ToolConnectionSecretService {
  private readonly keyring: SettingSecretKeyring;

  constructor(config: ConfigService) {
    const currentKey = config.get<string>("settings.encryptionKey", "");
    const currentKeyId = config.get<string>("settings.encryptionKeyId", "");
    if (!currentKey?.trim() || !currentKeyId?.trim()) {
      throw new Error("Tool connection secret encryption keyring is not configured");
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

  encrypt(value: string): ToolConnectionSecretEnvelope {
    validateToolConnectionSecret(value);
    return encryptSettingSecret(
      value,
      this.keyring,
    ) as ToolConnectionSecretEnvelope;
  }

  decrypt(envelope: ToolConnectionSecretEnvelope | string) {
    if (typeof envelope !== "string" || !envelope.startsWith("enc:v2:")) {
      throw new Error("Tool connection secret envelope must use enc:v2");
    }
    const plaintext = decryptSettingSecret(envelope, this.keyring);
    validateToolConnectionSecret(plaintext);
    return plaintext;
  }

  rotate(
    envelope: ToolConnectionSecretEnvelope | string,
  ): ToolConnectionSecretEnvelope {
    const plaintext = this.decrypt(envelope);
    return encryptSettingSecret(
      plaintext,
      this.keyring,
    ) as ToolConnectionSecretEnvelope;
  }

  metadata(
    record: ToolConnectionSecretRecordMetadata,
  ): ToolConnectionSecretMetadata {
    if (!record.id) {
      if (
        record.envelope ||
        record.revision !== 0 ||
        record.updatedAt !== null
      ) {
        throw new Error("Tool connection secret metadata is inconsistent");
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
      throw new Error("Tool connection secret metadata is inconsistent");
    }
    return Object.freeze({
      configured: true,
      id: record.id,
      mask: TOOL_CONNECTION_SECRET_MASK,
      revision: record.revision,
      updatedAt: toIsoDateTime(record.updatedAt),
    });
  }
}

function validateToolConnectionSecret(value: string) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Buffer.byteLength(value, "utf8") > MAX_TOOL_CONNECTION_SECRET_BYTES ||
    !SECRET_HTTP_FIELD_VALUE.test(value)
  ) {
    throw new Error("Tool connection secret is invalid");
  }
}

function toIsoDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Tool connection secret metadata is inconsistent");
  }
  return date.toISOString();
}

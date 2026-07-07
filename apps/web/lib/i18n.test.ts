import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTranslator } from "next-intl";
import {
  getMessagesForLanguage,
  mergeMessages,
  normalizeLanguagePreference,
} from "./i18n";
import enPhrases from "../phrases/en.json";
import zhHansPhrases from "../phrases/zh-Hans.json";
import zhHantPhrases from "../phrases/zh-Hant.json";

type TestTranslator = (key: string, values?: Record<string, string>) => string;

describe("i18n", () => {
  it("normalizes supported and legacy language codes", () => {
    assert.equal(normalizeLanguagePreference("zh-CN"), "zh-Hans");
    assert.equal(normalizeLanguagePreference("zh"), "zh-Hans");
    assert.equal(normalizeLanguagePreference("zh-TW"), "zh-Hant");
    assert.equal(normalizeLanguagePreference("en-US"), "en");
    assert.equal(normalizeLanguagePreference("unknown"), "zh-Hans");
  });

  it("falls back to simplified Chinese for missing dictionary keys", () => {
    const messages = mergeMessages(
      { test: { fallbackOnly: "回退文本" } },
      {},
    );
    const t = createTranslator({
      locale: "en",
      messages,
    }) as unknown as TestTranslator;

    assert.equal(t("test.fallbackOnly"), "回退文本");
  });

  it("interpolates named parameters through next-intl", () => {
    const t = createTranslator({
      locale: "en",
      messages: getMessagesForLanguage("en"),
    }) as unknown as TestTranslator;

    assert.equal(
      t("dialogs.deleteRoleConfirm", { name: "Owner" }),
      'Delete role "Owner"?',
    );
  });

  it("loads framework messages for static phrase compatibility", () => {
    const messages = getMessagesForLanguage("en");
    const common = messages.common as Record<string, string>;

    assert.equal(common.save, "Save");
    assert.equal(enPhrases["保存"], "Save");
  });

  it("keeps phrase dictionaries aligned across supported languages", () => {
    const dictionaries = {
      en: enPhrases,
      "zh-Hans": zhHansPhrases,
      "zh-Hant": zhHantPhrases,
    };
    const allKeys = new Set(
      Object.values(dictionaries).flatMap((dictionary) =>
        Object.keys(dictionary),
      ),
    );

    for (const [language, dictionary] of Object.entries(dictionaries)) {
      const missingKeys = [...allKeys].filter((key) => !(key in dictionary));
      assert.deepEqual(missingKeys, [], `${language} phrase keys are missing`);
    }
  });
});

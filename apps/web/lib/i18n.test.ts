import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createTranslator } from "next-intl";
import {
  getMessagesForLanguage,
  mergeMessages,
  normalizeLanguagePreference,
  type SupportedLanguage,
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

  it("keeps structured message keys aligned across supported languages", () => {
    const dictionaries: Record<SupportedLanguage, Record<string, unknown>> = {
      en: getMessagesForLanguage("en") as Record<string, unknown>,
      "zh-Hans": getMessagesForLanguage("zh-Hans") as Record<string, unknown>,
      "zh-Hant": getMessagesForLanguage("zh-Hant") as Record<string, unknown>,
    };
    const allKeys = new Set(
      Object.values(dictionaries).flatMap((dictionary) =>
        flattenMessageKeys(dictionary),
      ),
    );

    for (const [language, dictionary] of Object.entries(dictionaries)) {
      const keys = new Set(flattenMessageKeys(dictionary));
      const missingKeys = [...allKeys].filter((key) => !keys.has(key));
      assert.deepEqual(missingKeys, [], `${language} message keys are missing`);
    }
  });

  it("does not leak Chinese copy into English public auth messages", () => {
    const messages = getMessagesForLanguage("en") as Record<string, unknown>;
    const publicMessageKeys = [
      "auth.backToSignIn",
      "auth.confirmPassword",
      "auth.console",
      "auth.email",
      "auth.forgotPassword",
      "auth.forgotPasswordDescription",
      "auth.forgotPasswordSuccess",
      "auth.goToSignIn",
      "auth.newPassword",
      "auth.password",
      "auth.passwordPlaceholder",
      "auth.processing",
      "auth.resetFailed",
      "auth.resetPassword",
      "auth.resetPasswordDescription",
      "auth.resetPasswordSuccess",
      "auth.sendFailed",
      "auth.sendResetLink",
      "auth.sending",
      "auth.signIn",
      "auth.signUp",
      "auth.signUpUnavailableDescription",
      "auth.subtitle",
      "invite.decline",
      "invite.declined",
      "invite.declinedDescription",
      "invite.description",
      "invite.invalidOrExpired",
      "invite.invitedEmail",
      "invite.join",
      "invite.joined",
      "invite.joinedDescription",
      "invite.missingParams",
      "invite.title",
      "metadata.description",
      "metadata.title",
      "onboarding.adminEmail",
      "onboarding.adminName",
      "onboarding.adminPassword",
      "onboarding.createAndEnter",
      "onboarding.description",
      "onboarding.firstSetup",
      "onboarding.title",
    ];

    for (const key of publicMessageKeys) {
      const value = getNestedMessage(messages, key);
      assert.equal(
        containsChinese(value),
        false,
        `${key} contains Chinese text in English messages`,
      );
    }
  });

  it("has translations for all literal phrase keys used by useTextTranslation", () => {
    const phraseKeys = collectLiteralPhraseKeys();
    const missingKeys = phraseKeys.filter((key) => !(key in enPhrases));

    assert.deepEqual(missingKeys, []);
  });

  it("keeps UI Chinese string literals covered by phrase dictionaries", () => {
    const phraseKeys = collectUiChineseStringLiterals();
    const missingKeys = phraseKeys.filter((key) => !(key in enPhrases));

    assert.deepEqual(missingKeys, []);
  });

  it("does not keep known English UI literals outside translation helpers", () => {
    const violations = collectKnownEnglishUiLiteralViolations();

    assert.deepEqual(violations, []);
  });

  it("keeps public auth pages on structured i18n messages", () => {
    const violations = collectPublicAuthI18nViolations();

    assert.deepEqual(violations, []);
  });

  it("keeps language menus on structured i18n messages", () => {
    const violations = collectLanguageMenuI18nViolations();

    assert.deepEqual(violations, []);
  });
});

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function collectLiteralPhraseKeys() {
  const sourceRoots = ["app", "components", "hooks", "lib"].map((item) =>
    path.join(webRoot, item),
  );
  const keys = new Set<string>();
  const phraseCallPattern =
    /\btr\(\s*(["'`])([^"'`]*\p{Script=Han}[^"'`]*)\1/gmu;

  for (const filePath of sourceRoots.flatMap((root) => walkSourceFiles(root))) {
    const source = fs.readFileSync(filePath, "utf8");
    let match: RegExpExecArray | null;
    while ((match = phraseCallPattern.exec(source))) {
      keys.add(match[2]);
    }
  }

  return [...keys].sort((left, right) => left.localeCompare(right, "zh-Hans"));
}

function collectUiChineseStringLiterals() {
  const sourceRoots = ["app", "components", "hooks"].map((item) =>
    path.join(webRoot, item),
  );
  const keys = new Set<string>();
  const stringPattern =
    /(["'`])([^"'`\r\n]*\p{Script=Han}[^"'`\r\n]*)\1/gmu;

  for (const filePath of sourceRoots.flatMap((root) => walkSourceFiles(root))) {
    if (filePath.includes(`${path.sep}app${path.sep}api${path.sep}`)) {
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    let match: RegExpExecArray | null;
    while ((match = stringPattern.exec(source))) {
      const value = match[2];
      if (value.includes("${")) continue;
      keys.add(value.replace(/\\n/g, "\n"));
    }
  }

  return [...keys].sort((left, right) => left.localeCompare(right, "zh-Hans"));
}

function collectKnownEnglishUiLiteralViolations() {
  const sourceRoots = ["app", "components"].map((item) =>
    path.join(webRoot, item),
  );
  const forbiddenPatterns = [
    /aria-label="Upload files"/,
    /title="Upload files"/,
    /aria-label="Loading"/,
    />\s*Close\s*</,
    />\s*Sidebar\s*</,
    />\s*Displays the mobile sidebar\.\s*</,
    />\s*Toggle Sidebar\s*</,
    /aria-label="Toggle Sidebar"/,
    /title="Toggle Sidebar"/,
    /label="Profile Link"/,
    /label="Banner"/,
    /<CardTitle>\s*Logo\s*<\/CardTitle>/,
    /label="SMTP Host"/,
    /label="IP"/,
    /placeholder="MJML markup\.\.\."/,
    /placeholder="value"/,
  ];
  const violations: string[] = [];

  for (const filePath of sourceRoots.flatMap((root) => walkSourceFiles(root))) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        violations.push(
          `${path.relative(webRoot, filePath)} contains ${pattern.source}`,
        );
      }
    }
  }

  return violations.sort();
}

function collectPublicAuthI18nViolations() {
  const sourceFiles = [
    path.join(webRoot, "app", "(public)", "forgot-password", "page.tsx"),
    path.join(webRoot, "app", "(public)", "invite", "page.tsx"),
    path.join(webRoot, "app", "(public)", "reset-password", "page.tsx"),
    path.join(webRoot, "app", "(public)", "signup", "page.tsx"),
    path.join(webRoot, "components", "login-page.tsx"),
    path.join(webRoot, "components", "onboarding-page.tsx"),
  ].filter((filePath) => fs.existsSync(filePath));
  const staleCopyPatterns = [
    /Forgot password/,
    /忘记密码/,
    /忘記密碼/,
    /Back to sign in/,
    /返回登录/,
    /返回登入/,
    /Send reset link/,
    /发送重置链接/,
    /傳送重設連結/,
    /Reset password/,
    /重置密码/,
    /重設密碼/,
    /Sign in/,
    /登录/,
    /登入/,
    /Sign up/,
    /注册/,
    /註冊/,
    /Admin console/,
    /管理控制台/,
  ];
  const violations: string[] = [];

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(webRoot, filePath);
    if (source.includes("useTextTranslation")) {
      violations.push(`${relativePath} imports useTextTranslation`);
    }

    for (const pattern of staleCopyPatterns) {
      if (pattern.test(source)) {
        violations.push(`${relativePath} contains ${pattern.source}`);
      }
    }
  }

  return violations.sort();
}

function collectLanguageMenuI18nViolations() {
  const sourceFiles = [
    path.join(webRoot, "components", "public-language-switcher.tsx"),
    path.join(webRoot, "components", "user-menu.tsx"),
  ].filter((filePath) => fs.existsSync(filePath));
  const violations: string[] = [];

  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(webRoot, filePath);
    if (source.includes("getLanguageTranslationKey(")) {
      violations.push(`${relativePath} translates native language labels`);
    }
  }

  return violations.sort();
}

function walkSourceFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(entryPath);
    if (/\.(ts|tsx)$/.test(entry.name)) return [entryPath];
    return [];
  });
}

function flattenMessageKeys(
  messages: Record<string, unknown>,
  prefix = "",
): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenMessageKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

function getNestedMessage(messages: Record<string, unknown>, key: string) {
  return key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, messages);
}

function containsChinese(value: unknown) {
  return typeof value === "string" && /\p{Script=Han}/u.test(value);
}

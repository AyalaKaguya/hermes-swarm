import zhHansMessages from "./messages/zh-Hans.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: "en" | "zh-Hans" | "zh-Hant";
    Messages: typeof zhHansMessages;
  }
}

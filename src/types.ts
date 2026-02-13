/**
 * Type definitions for transl8-ai CLI tool
 */

export interface TranslationFile {
  [key: string]: string | TranslationFile;
}

export interface KeyPath {
  path: string;
  value: string | TranslationFile;
}

export interface DiscrepancyReport {
  missingInTarget: string[];
  extraInTarget: string[];
  typeMismatches: TypeMismatch[];
  summary: {
    totalKeysInSource: number;
    totalKeysInTarget: number;
    missingCount: number;
    extraCount: number;
    typeMismatchCount: number;
  };
}

export interface TypeMismatch {
  path: string;
  sourceType: "string" | "object";
  targetType: "string" | "object";
}

export interface ComparisonResult {
  sourceFile: string;
  targetFile: string;
  report: DiscrepancyReport;
}

export interface SimilarExample {
  englishValue: string;
  translatedValue: string;
  key: string;
}

export interface TranslationContext {
  key: string;
  englishValue: string;
  parentSection: string;
  existingTranslations: Record<string, string>;
  /** Up to 3 similar already-translated strings for consistency */
  similarExamples?: SimilarExample[];
}

export interface TranslationResult {
  key: string;
  originalValue: string;
  translatedValue: string;
  targetLanguage: string;
}

export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
}

/**
 * A term that should not be directly translated (brand names, product-specific
 * terminology, etc.). If `translations` is empty, the English term is kept
 * as-is in every language. Otherwise the per-language override is used.
 */
export interface GlossaryEntry {
  term: string;
  description: string;
  caseSensitive?: boolean;
  /** language-code → approved translation. Empty object = keep English term */
  translations: Record<string, string>;
}

export interface Glossary {
  _description?: string;
  protectedTerms: GlossaryEntry[];
}

/**
 * Pattern for matching linked content sections (description + links array).
 * Used to translate descriptions and their embedded link texts together.
 */
export interface LinkedContentPattern {
  /** Glob-like pattern for description keys, e.g. "*.description" */
  descriptionPattern: string;
  /** Key name for the links array, e.g. "links" */
  linksKey: string;
  /** Field name for link text, e.g. "text" */
  linkTextField: string;
  /** Field name for link href, e.g. "href" */
  linkHrefField: string;
}

/**
 * Configuration loaded from .transl8rc.json
 */
export interface Transl8Config {
  /** Path to the messages directory (default: "./messages") */
  messagesDir: string;
  /** Source language code (default: "en") */
  sourceLanguage: string;
  /** OpenAI model to use (default: "gpt-5.2") */
  model: string;
  /** Max concurrent API requests (default: 50) */
  concurrency: number;
  /** Path to glossary.json (default: "./glossary.json") */
  glossaryPath: string;
  /** Patterns for linked content (description + links) */
  linkedContentPatterns: LinkedContentPattern[];
  /** Key patterns that should never be translated (copied from source) */
  hrefPatterns: string[];
}

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "zh-TW", name: "Chinese (Traditional)", nativeName: "繁體中文" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
];

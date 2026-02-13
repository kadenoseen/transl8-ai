/**
 * Utility functions for transl8-ai CLI tool
 */

import * as fs from "fs";
import * as path from "path";
import type {
  TranslationFile,
  Glossary,
  SimilarExample,
  LinkedContentPattern,
} from "./types.js";

let messagesDir: string | null = null;
let glossaryPath: string | null = null;

/**
 * Set the messages directory path
 */
export function setMessagesDir(dir: string): void {
  messagesDir = path.resolve(dir);
}

/**
 * Get the messages directory path
 */
export function getMessagesDir(): string {
  if (messagesDir) {
    return messagesDir;
  }
  throw new Error(
    "Messages directory not set. Run `transl8 init` to create a config file, or pass --messages <path>.",
  );
}

/**
 * Set the glossary file path
 */
export function setGlossaryPath(p: string): void {
  glossaryPath = path.resolve(p);
}

/**
 * Get the path to the glossary file
 */
export function getGlossaryPath(): string {
  if (glossaryPath) {
    return glossaryPath;
  }
  throw new Error(
    "Glossary path not set. Run `transl8 init` to create a config file.",
  );
}

/**
 * List all translation files in the messages directory
 */
export function listTranslationFiles(): string[] {
  const dir = getMessagesDir();
  if (!fs.existsSync(dir)) {
    throw new Error(`Messages directory not found: ${dir}`);
  }

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(dir, file));
}

/**
 * Get language code from file path
 */
export function getLanguageCode(filePath: string): string {
  const fileName = path.basename(filePath, ".json");
  return fileName;
}

/**
 * Load a translation file
 */
export function loadTranslationFile(filePath: string): TranslationFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Translation file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(content) as TranslationFile;
  } catch (error) {
    throw new Error(`Failed to parse translation file ${filePath}: ${error}`);
  }
}

/**
 * Merge content into source structure, preserving source key order at every level.
 * Ensures translated files match source order for easy comparison.
 */
export function reorderToMatchSource(
  source: TranslationFile,
  content: TranslationFile,
): TranslationFile {
  const result: TranslationFile = {};

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const contentVal = content[key];

    if (
      typeof sourceVal === "object" &&
      sourceVal !== null &&
      !Array.isArray(sourceVal)
    ) {
      if (
        typeof contentVal === "object" &&
        contentVal !== null &&
        !Array.isArray(contentVal)
      ) {
        result[key] = reorderToMatchSource(
          sourceVal as TranslationFile,
          contentVal as TranslationFile,
        );
      } else {
        result[key] = sourceVal;
      }
    } else if (Array.isArray(sourceVal)) {
      if (Array.isArray(contentVal) && contentVal.length === sourceVal.length) {
        result[key] = sourceVal.map((sourceItem, i) => {
          const contentItem = contentVal[i];
          if (
            typeof sourceItem === "object" &&
            sourceItem !== null &&
            typeof contentItem === "object" &&
            contentItem !== null
          ) {
            return reorderToMatchSource(
              sourceItem as TranslationFile,
              contentItem as TranslationFile,
            );
          }
          return contentItem;
        }) as unknown as TranslationFile;
      } else {
        result[key] = sourceVal as unknown as TranslationFile;
      }
    } else {
      result[key] = contentVal !== undefined ? contentVal : sourceVal;
    }
  }

  return result;
}

/**
 * Save a translation file
 */
export function saveTranslationFile(
  filePath: string,
  content: TranslationFile,
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n", "utf-8");
}

/**
 * Flatten a nested translation object to an array of key paths
 */
export function flattenKeys(
  obj: TranslationFile,
  prefix: string = "",
): string[] {
  const keys: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (typeof value === "object" && value !== null) {
      keys.push(...flattenKeys(value as TranslationFile, fullPath));
    } else {
      keys.push(fullPath);
    }
  }

  return keys;
}

/**
 * Get value at a key path in a translation object
 */
export function getValueAtPath(
  obj: TranslationFile,
  keyPath: string,
): string | TranslationFile | undefined {
  const parts = keyPath.split(".");
  let current: string | TranslationFile = obj;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as TranslationFile)[part];
    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

/**
 * Set value at a key path in a translation object.
 * Optionally accepts a reference object (e.g. English source) to preserve
 * arrays vs objects when creating missing intermediate containers.
 */
export function setValueAtPath(
  obj: TranslationFile,
  keyPath: string,
  value: string | TranslationFile,
  referenceObj?: TranslationFile,
): void {
  const parts = keyPath.split(".");
  let current = obj;
  let refCurrent: TranslationFile | undefined = referenceObj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      // Check reference to determine if this should be an array or object
      const refValue = refCurrent?.[part];
      current[part] = Array.isArray(refValue)
        ? ([] as unknown as TranslationFile)
        : {};
    }
    current = current[part] as TranslationFile;
    if (refCurrent && typeof refCurrent[part] === "object") {
      refCurrent = refCurrent[part] as TranslationFile;
    } else {
      refCurrent = undefined;
    }
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Get the type of a value in the translation structure
 */
export function getValueType(
  value: unknown,
): "string" | "object" | "undefined" {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return "string";
  if (typeof value === "object" && value !== null) return "object";
  return "string"; // fallback for other primitive types
}

/**
 * Count total leaf keys in a translation object
 */
export function countLeafKeys(obj: TranslationFile): number {
  let count = 0;

  for (const value of Object.values(obj)) {
    if (typeof value === "object" && value !== null) {
      count += countLeafKeys(value as TranslationFile);
    } else {
      count++;
    }
  }

  return count;
}

/**
 * Get parent section from a key path
 */
export function getParentSection(keyPath: string): string {
  const parts = keyPath.split(".");
  return parts.length > 1 ? parts.slice(0, -1).join(".") : "";
}

/**
 * Check if a key path matches any of the configured href patterns.
 * Patterns use simple glob: "*.href" matches any key ending in ".href".
 */
export function isHrefKey(
  keyPath: string,
  hrefPatterns: string[] = ["*.href"],
): boolean {
  return hrefPatterns.some((pattern) => {
    // Convert simple glob to regex: "*.href" -> /\.href$/
    const suffix = pattern.replace(/^\*/, "");
    return keyPath.endsWith(suffix);
  });
}

/**
 * Check if a key path is a link text key, based on configured patterns.
 */
export function isLinkTextKey(
  keyPath: string,
  patterns: LinkedContentPattern[] = [],
): boolean {
  if (patterns.length === 0) {
    // Default: matches links.*.text
    return /\.links\.\d+\.text$/.test(keyPath);
  }
  return patterns.some((p) => {
    const regex = new RegExp(
      `\\.${escapeRegex(p.linksKey)}\\.\\d+\\.${escapeRegex(p.linkTextField)}$`,
    );
    return regex.test(keyPath);
  });
}

/**
 * Get the parent path that would contain both description and links.
 * Uses configured patterns to determine what constitutes a "description" key.
 */
export function getDescriptionParentPath(
  keyPath: string,
  patterns: LinkedContentPattern[] = [],
): string | null {
  if (patterns.length === 0) {
    // Default: key must end with ".description"
    if (!keyPath.endsWith(".description")) return null;
    return getParentSection(keyPath);
  }
  for (const p of patterns) {
    // Convert "*.description" -> suffix ".description"
    const suffix = p.descriptionPattern.replace(/^\*/, "");
    if (keyPath.endsWith(suffix)) {
      return getParentSection(keyPath);
    }
  }
  return null;
}

/**
 * Check if a parent object has both description and links array with items.
 * Uses configured patterns for field names.
 */
export function sectionHasLinks(
  obj: TranslationFile,
  parentPath: string,
  patterns: LinkedContentPattern[] = [],
): boolean {
  const parent = getValueAtPath(obj, parentPath);
  if (typeof parent !== "object" || parent === null) return false;
  const parentObj = parent as Record<string, unknown>;

  const linksKey = patterns.length > 0 ? patterns[0].linksKey : "links";
  const textField = patterns.length > 0 ? patterns[0].linkTextField : "text";

  const links = parentObj[linksKey];
  return (
    Array.isArray(links) &&
    links.length > 0 &&
    links.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        textField in item &&
        typeof (item as Record<string, unknown>)[textField] === "string",
    )
  );
}

/**
 * Get key paths for link texts in a section
 */
export function getLinkTextKeyPaths(
  parentPath: string,
  linksCount: number,
  patterns: LinkedContentPattern[] = [],
): string[] {
  const linksKey = patterns.length > 0 ? patterns[0].linksKey : "links";
  const textField = patterns.length > 0 ? patterns[0].linkTextField : "text";

  const paths: string[] = [];
  for (let i = 0; i < linksCount; i++) {
    paths.push(`${parentPath}.${linksKey}.${i}.${textField}`);
  }
  return paths;
}

/**
 * Get link texts from a section
 */
export function getLinkTextsFromSection(
  obj: TranslationFile,
  parentPath: string,
  patterns: LinkedContentPattern[] = [],
): string[] {
  const parent = getValueAtPath(obj, parentPath);
  if (typeof parent !== "object" || parent === null) return [];

  const linksKey = patterns.length > 0 ? patterns[0].linksKey : "links";
  const textField = patterns.length > 0 ? patterns[0].linkTextField : "text";

  const links = (parent as Record<string, unknown>)[linksKey];
  if (!Array.isArray(links)) return [];
  return links
    .map((item) =>
      typeof item === "object" && item !== null && textField in item
        ? ((item as Record<string, unknown>)[textField] as string)
        : null,
    )
    .filter((t): t is string => typeof t === "string");
}

/**
 * Get the key name from a key path
 */
export function getKeyName(keyPath: string): string {
  const parts = keyPath.split(".");
  return parts[parts.length - 1];
}

/**
 * Format a color-coded console message
 */
export const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

export function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Print the CLI banner with multi-color ASCII art.
 * Only shown when stdout is a TTY (not piped).
 */
export function printBanner(): void {
  if (!process.stdout.isTTY) return;

  const cyan = colors.cyan;
  const magenta = colors.magenta;
  const blue = colors.blue;
  const dim = colors.dim;
  const reset = colors.reset;

  // prettier-ignore
  const lines = [
    `${cyan}  _                        _  ${magenta}___${reset}`,
    `${cyan} | |_ _ __ __ _ _ __  ___| |${magenta}( _ )${blue}    __ _(_)${reset}`,
    `${cyan} | __| '__/ _\` | '_ \\/ __| |${magenta}/ _ \\${blue}   / _\` | |${reset}`,
    `${cyan} | |_| | | (_| | | | \\__ \\ |${magenta} (_) |${blue} | (_| | |${reset}`,
    `${cyan}  \\__|_|  \\__,_|_| |_|___/_|${magenta}\\___/${blue}   \\__,_|_|${reset}`,
  ];

  console.log("");
  for (const line of lines) {
    console.log(line);
  }
  console.log(`${dim}  AI-powered i18n translation CLI${reset}`);
  console.log("");
}

/**
 * Print a formatted header with box-drawing characters
 */
export function printHeader(text: string): void {
  const width = Math.max(text.length + 4, 40);
  const inner = width - 2;
  console.log("");
  console.log(colorize(`┌${"─".repeat(inner)}┐`, "cyan"));
  console.log(
    colorize("│", "cyan") +
      colorize(` ${text}`, "bold") +
      " ".repeat(inner - text.length - 1) +
      colorize("│", "cyan"),
  );
  console.log(colorize(`└${"─".repeat(inner)}┘`, "cyan"));
}

/**
 * Print a formatted section
 */
export function printSection(text: string): void {
  console.log(
    "\n" + colorize("●", "yellow") + " " + colorize(text, "bold"),
  );
  console.log(colorize("─".repeat(40), "dim"));
}

/**
 * Print a success message
 */
export function printSuccess(text: string): void {
  console.log(colorize(`  ✓ ${text}`, "green"));
}

/**
 * Print a warning message
 */
export function printWarning(text: string): void {
  console.log(colorize(`  ⚠ ${text}`, "yellow"));
}

/**
 * Print an error message
 */
export function printError(text: string): void {
  console.log(colorize(`  ✗ ${text}`, "red"));
}

/**
 * Create a braille spinner for async operations.
 * Returns an object with `update(text)` and `stop(text?)` methods.
 * Uses ANSI cursor control — only works on TTY.
 */
export function createSpinner(initialText: string): {
  update: (text: string) => void;
  stop: (finalText?: string) => void;
} {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let text = initialText;
  const isTTY = process.stdout.isTTY;

  if (!isTTY) {
    // Non-TTY: just print the text once
    process.stdout.write(`  ${text}\n`);
    return {
      update: () => {},
      stop: (finalText?: string) => {
        if (finalText) process.stdout.write(`  ${finalText}\n`);
      },
    };
  }

  const timer = setInterval(() => {
    const frame = colorize(frames[i % frames.length], "cyan");
    process.stdout.write(`\r  ${frame} ${text}`);
    i++;
  }, 80);

  return {
    update(newText: string) {
      text = newText;
    },
    stop(finalText?: string) {
      clearInterval(timer);
      process.stdout.write("\r" + " ".repeat(text.length + 10) + "\r");
      if (finalText) {
        console.log(`  ${colorize("✓", "green")} ${finalText}`);
      }
    },
  };
}

/**
 * Deep clone a translation object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if a string contains ICU message format placeholders
 */
export function hasPlaceholders(str: string): boolean {
  return /\{[^}]+\}/.test(str);
}

/**
 * Extract placeholders from a string
 */
export function extractPlaceholders(str: string): string[] {
  const matches = str.match(/\{([^}]+)\}/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

// ============================================================================
// Similar example helpers — find already-translated strings for consistency
// ============================================================================

/** Common words to ignore when computing similarity */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "be",
  "or",
  "and",
  "it",
  "by",
  "at",
  "as",
  "do",
  "if",
  "no",
  "not",
  "your",
  "you",
  "we",
  "our",
  "my",
  "this",
  "that",
  "with",
  "from",
  "has",
  "have",
  "will",
  "can",
  "all",
  "but",
  "up",
  "out",
  "so",
  "been",
  "its",
  "they",
  "their",
  "more",
  "about",
  "please",
  "yet",
]);

/**
 * Tokenize a string into significant lowercase words.
 */
function tokenize(str: string): Set<string> {
  const words = str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Compute a similarity score between two sets of tokens.
 * Returns a number between 0 and 1 (Jaccard-like, boosted by overlap count).
 */
function similarityScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const word of a) {
    if (b.has(word)) overlap++;
  }
  if (overlap === 0) return 0;
  // Jaccard index: intersection / union
  const union = a.size + b.size - overlap;
  return overlap / union;
}

/**
 * Build an index of English → target language pairs from the existing
 * target file, keyed by English value. Only includes string values.
 */
export function buildTranslationPairIndex(
  englishFile: TranslationFile,
  targetFile: TranslationFile,
): Map<string, { english: string; translated: string; key: string }> {
  const index = new Map<
    string,
    { english: string; translated: string; key: string }
  >();
  const keys = flattenKeys(englishFile);
  for (const key of keys) {
    const eng = getValueAtPath(englishFile, key);
    const tgt = getValueAtPath(targetFile, key);
    if (typeof eng === "string" && typeof tgt === "string" && eng !== tgt) {
      index.set(key, { english: eng, translated: tgt, key });
    }
  }
  return index;
}

/**
 * Find up to `limit` similar already-translated strings for a given English
 * value. Matches are scored by word overlap (Jaccard similarity).
 * Only returns matches above a minimum threshold.
 */
export function findSimilarExamples(
  englishValue: string,
  currentKey: string,
  pairIndex: Map<string, { english: string; translated: string; key: string }>,
  limit = 3,
  minScore = 0.15,
): SimilarExample[] {
  const sourceTokens = tokenize(englishValue);
  if (sourceTokens.size === 0) return [];

  const scored: { score: number; entry: SimilarExample }[] = [];

  for (const [key, pair] of pairIndex) {
    if (key === currentKey) continue;
    const candidateTokens = tokenize(pair.english);
    const score = similarityScore(sourceTokens, candidateTokens);
    if (score >= minScore) {
      scored.push({
        score,
        entry: {
          englishValue: pair.english,
          translatedValue: pair.translated,
          key: pair.key,
        },
      });
    }
  }

  // Sort by score descending, then take top `limit`
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

// ============================================================================
// Glossary helpers
// ============================================================================

/**
 * Load the glossary file. Returns an empty glossary if the file doesn't exist.
 */
export function loadGlossary(): Glossary {
  const gPath = getGlossaryPath();
  if (!fs.existsSync(gPath)) {
    return { protectedTerms: [] };
  }
  const raw = fs.readFileSync(gPath, "utf-8");
  return JSON.parse(raw) as Glossary;
}

/**
 * Save the glossary file.
 */
export function saveGlossary(glossary: Glossary): void {
  const gPath = getGlossaryPath();
  fs.writeFileSync(
    gPath,
    JSON.stringify(glossary, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Build a glossary prompt section for a given target language.
 * Returns an empty string when there are no applicable terms.
 */
export function buildGlossaryPromptSection(
  glossary: Glossary,
  targetLanguageCode: string,
): string {
  if (!glossary.protectedTerms.length) return "";

  const lines: string[] = [];
  for (const entry of glossary.protectedTerms) {
    const override = entry.translations[targetLanguageCode];
    if (override) {
      lines.push(`   - "${entry.term}" → "${override}" (${entry.description})`);
    } else {
      lines.push(
        `   - "${entry.term}" — keep as "${entry.term}" (${entry.description})`,
      );
    }
  }

  return `\n\n5. **GLOSSARY — PROTECTED TERMS (MUST follow exactly)**:
${lines.join("\n")}`;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

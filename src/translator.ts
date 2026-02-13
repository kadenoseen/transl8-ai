/**
 * OpenAI Translation Integration
 */

import OpenAI from "openai";
import type {
  TranslationFile,
  TranslationContext,
  TranslationResult,
  LanguageInfo,
  Glossary,
  SimilarExample,
  LinkedContentPattern,
  Transl8Config,
} from "./types.js";
import { SUPPORTED_LANGUAGES } from "./types.js";
import {
  loadTranslationFile,
  getValueAtPath,
  flattenKeys,
  getParentSection,
  hasPlaceholders,
  extractPlaceholders,
  colorize,
  getMessagesDir,
  isHrefKey,
  getDescriptionParentPath,
  sectionHasLinks,
  getLinkTextKeyPaths,
  getLinkTextsFromSection,
  loadGlossary,
  buildGlossaryPromptSection,
  buildTranslationPairIndex,
  findSimilarExamples,
} from "./utils.js";
import * as path from "path";
import * as fs from "fs";

let openaiClient: OpenAI | null = null;
let cachedGlossary: Glossary | null = null;
let activeConfig: Transl8Config | null = null;

/**
 * Set the active config for the translator module
 */
export function setTranslatorConfig(config: Transl8Config): void {
  activeConfig = config;
}

/**
 * Get the active config, falling back to defaults
 */
function getConfig(): Transl8Config {
  if (activeConfig) return activeConfig;
  return {
    messagesDir: "./messages",
    sourceLanguage: "en",
    model: "gpt-5.2",
    concurrency: 50,
    glossaryPath: "./glossary.json",
    linkedContentPatterns: [],
    hrefPatterns: ["*.href"],
  };
}

/**
 * Get the glossary (loaded once and cached for the process lifetime)
 */
function getGlossary(): Glossary {
  if (!cachedGlossary) {
    cachedGlossary = loadGlossary();
  }
  return cachedGlossary;
}

/**
 * Initialize OpenAI client
 */
export function initOpenAI(apiKey?: string): OpenAI {
  if (openaiClient) return openaiClient;

  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OpenAI API key not found. Please set OPENAI_API_KEY environment variable or pass it as an argument.",
    );
  }

  openaiClient = new OpenAI({ apiKey: key });
  return openaiClient;
}

/**
 * Get language info by code
 */
export function getLanguageInfo(code: string): LanguageInfo | undefined {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

/**
 * Build translation context for a key
 */
export function buildTranslationContext(
  englishFile: TranslationFile,
  existingTranslations: Map<string, TranslationFile>,
  keyPath: string,
  pairIndex?: Map<
    string,
    { english: string; translated: string; key: string }
  >,
): TranslationContext {
  const englishValue = getValueAtPath(englishFile, keyPath) as string;
  const parentSection = getParentSection(keyPath);

  // Get existing translations for this key from other languages
  const translations: Record<string, string> = {};
  for (const [lang, file] of existingTranslations.entries()) {
    const value = getValueAtPath(file, keyPath);
    if (typeof value === "string") {
      translations[lang] = value;
    }
  }

  // Find similar already-translated strings for consistency
  let similarExamples: SimilarExample[] | undefined;
  if (pairIndex && pairIndex.size > 0) {
    similarExamples = findSimilarExamples(englishValue, keyPath, pairIndex);
  }

  return {
    key: keyPath,
    englishValue,
    parentSection,
    existingTranslations: translations,
    similarExamples,
  };
}

/**
 * Create the system prompt for translation
 */
function createSystemPrompt(targetLanguage: LanguageInfo): string {
  const glossary = getGlossary();
  const glossarySection = buildGlossaryPromptSection(
    glossary,
    targetLanguage.code,
  );

  return `You are an expert translator specializing in mobile app and web UI localization.

Your task is to translate UI strings from English to ${targetLanguage.name} (${targetLanguage.nativeName}).

CRITICAL GUIDELINES:

1. **LENGTH**: Aim for a similar length to the English original.
   - This is a UI — text appears in buttons, menus, labels, banners, and cards
   - Prioritize natural, readable ${targetLanguage.name} over strict length matching
   - NEVER abbreviate words into fragments that are hard to read (e.g. "freisch." instead of "freischalten")
   - If the natural translation is slightly longer, that is acceptable — broken or awkward text is worse than slightly longer text

2. **PRESERVE PLACEHOLDERS EXACTLY**:
   - Keep {name}, {count}, {seconds}, etc. unchanged
   - Keep ICU plural syntax like {count, plural, one {# item} other {# items}}
   - Never translate placeholder names (don't change {name} to {nombre})

3. **TRANSLATION QUALITY**:
   - Use natural, idiomatic expressions in ${targetLanguage.name}
   - Maintain the same tone (casual/formal) as the original
   - Keep technical terms, brand names unchanged
   - Consider the UI context from the key path
   - Many languages (especially German) commonly use English loanwords in tech/app contexts — prefer them when they sound more natural than the native equivalent

4. **DO NOT**:
   - Add quotes around your translation
   - Add explanations or notes
   - Invent ugly abbreviations — if a word doesn't fit abbreviated, use a shorter synonym instead
   - Change the meaning to fit length (shorten, don't change meaning)${glossarySection}`;
}

/**
 * Create the user prompt for a single translation
 */
function createTranslationPrompt(
  context: TranslationContext,
  targetLanguage: LanguageInfo,
): string {
  const charCount = context.englishValue.length;
  const targetMax = Math.round(charCount * 1.2);

  let prompt = `Translate to ${targetLanguage.name}:

"${context.englishValue}"

Key: ${context.key}
English length: ${charCount} chars — aim for around ${charCount}–${targetMax} chars`;

  // Add similar already-translated examples for consistency
  if (context.similarExamples && context.similarExamples.length > 0) {
    prompt += "\n\nSimilar phrases already translated (use these for consistency):";
    for (const ex of context.similarExamples) {
      prompt += `\n- "${ex.englishValue}" → "${ex.translatedValue}"`;
    }
  }

  // Add existing translations from other languages as examples
  const existingLangs = Object.entries(context.existingTranslations);
  if (existingLangs.length > 0) {
    prompt += "\n\nReference translations from other languages:";
    for (const [lang, value] of existingLangs) {
      const langInfo = getLanguageInfo(lang);
      prompt += `\n- ${langInfo?.name || lang} (${value.length} chars): "${value}"`;
    }
  }

  // Note about placeholders
  if (hasPlaceholders(context.englishValue)) {
    const placeholders = extractPlaceholders(context.englishValue);
    prompt += `\n\n⚠️ IMPORTANT: This string contains placeholders that MUST be preserved exactly: ${placeholders.map((p) => `{${p}}`).join(", ")}`;
  }

  prompt += "\n\nRespond with ONLY the translated string, nothing else.";

  return prompt;
}

/**
 * Create prompt for translating description with inline links.
 * The link texts must appear in the description for parseTextWithLinks to work.
 */
function createDescriptionWithLinksPrompt(
  description: string,
  linkTexts: string[],
  targetLanguage: LanguageInfo,
): string {
  const linkList = linkTexts.map((t) => `"${t}"`).join(", ");
  return `Translate this description to ${targetLanguage.name}. It contains ${linkTexts.length} link(s) with anchor text: ${linkList}.

CRITICAL: Each link anchor must appear as an EXACT substring in your translated description. Translate each anchor phrase and use that EXACT phrase where the link appears in the description.

Return valid JSON only:
{"description": "your full translated description", "linkTexts": ["translated anchor 1", "translated anchor 2", ...]}

The linkTexts array must be in the same order as the anchors above. Each linkText must appear verbatim in the description.`;
}

/**
 * Translate a description and its link texts together so link text appears in description
 */
export async function translateDescriptionWithLinks(
  descriptionKey: string,
  description: string,
  linkTexts: string[],
  targetLanguage: LanguageInfo,
  options: { verbose?: boolean } = {},
): Promise<TranslationResult[]> {
  const client = initOpenAI();
  const config = getConfig();

  if (options.verbose) {
    console.log(
      colorize(`  Translating description+links: ${descriptionKey}`, "dim"),
    );
  }

  const response = await client.responses.create({
    model: config.model,
    instructions: createSystemPrompt(targetLanguage),
    input: `${createDescriptionWithLinksPrompt(
      description,
      linkTexts,
      targetLanguage,
    )}\n\nDescription to translate:\n"${description}"`,
  });

  const raw = response.output_text?.trim() || "";
  const results: TranslationResult[] = [];

  try {
    const parsed = JSON.parse(raw) as {
      description?: string;
      linkTexts?: string[];
    };

    if (typeof parsed.description === "string") {
      results.push({
        key: descriptionKey,
        originalValue: description,
        translatedValue: parsed.description,
        targetLanguage: targetLanguage.code,
      });
    }

    if (Array.isArray(parsed.linkTexts)) {
      const parentPath = getParentSection(descriptionKey);
      const patterns = config.linkedContentPatterns;
      const linksKey =
        patterns.length > 0 ? patterns[0].linksKey : "links";
      const textField =
        patterns.length > 0 ? patterns[0].linkTextField : "text";

      for (
        let i = 0;
        i < linkTexts.length && i < parsed.linkTexts.length;
        i++
      ) {
        const linkKey = `${parentPath}.${linksKey}.${i}.${textField}`;
        results.push({
          key: linkKey,
          originalValue: linkTexts[i],
          translatedValue: parsed.linkTexts[i],
          targetLanguage: targetLanguage.code,
        });
      }
    }
  } catch {
    if (options.verbose) {
      console.warn(
        colorize(
          `  ⚠ Failed to parse description+links JSON for ${descriptionKey}, falling back to description-only translation`,
          "yellow",
        ),
      );
    }
    const fallback = await translateString(
      {
        key: descriptionKey,
        englishValue: description,
        parentSection: getParentSection(descriptionKey),
        existingTranslations: {},
      },
      targetLanguage,
      options,
    );
    results.push(fallback);
  }

  return results;
}

/**
 * Translate a single string
 */
export async function translateString(
  context: TranslationContext,
  targetLanguage: LanguageInfo,
  options: { verbose?: boolean } = {},
): Promise<TranslationResult> {
  const client = initOpenAI();
  const config = getConfig();

  if (options.verbose) {
    console.log(colorize(`  Translating: ${context.key}`, "dim"));
  }

  const response = await client.responses.create({
    model: config.model,
    instructions: createSystemPrompt(targetLanguage),
    input: createTranslationPrompt(context, targetLanguage),
  });

  let translatedValue = response.output_text?.trim() || "";

  // Clean up the translation
  translatedValue = cleanupTranslation(translatedValue, context.englishValue);

  // Validate placeholders are preserved (skip logging in hot path unless verbose)
  if (options.verbose && hasPlaceholders(context.englishValue)) {
    const originalPlaceholders = extractPlaceholders(context.englishValue);
    const translatedPlaceholders = extractPlaceholders(translatedValue);

    const missing = originalPlaceholders.filter(
      (p) => !translatedPlaceholders.includes(p),
    );
    if (missing.length > 0) {
      console.warn(
        colorize(
          `  ⚠ Warning: Missing placeholders in translation for "${context.key}": ${missing.map((p) => `{${p}}`).join(", ")}`,
          "yellow",
        ),
      );
    }
  }

  return {
    key: context.key,
    originalValue: context.englishValue,
    translatedValue,
    targetLanguage: targetLanguage.code,
  };
}

/**
 * Clean up a translation by removing artifacts added by LLM
 */
function cleanupTranslation(translated: string, original: string): string {
  let result = translated;

  // Check if original starts/ends with quotes
  const originalStartsWithQuote = original.startsWith('"');
  const originalEndsWithQuote = original.endsWith('"');

  // If original doesn't have outer quotes but translation does, strip them
  if (!originalStartsWithQuote && !originalEndsWithQuote) {
    // Strip outer quotes if they were added
    if (result.startsWith('"') && result.endsWith('"')) {
      result = result.slice(1, -1);
    }
  }

  // Handle case where LLM added quotes around the whole thing when original only has inner quotes
  if (!originalStartsWithQuote && result.startsWith('"')) {
    const originalHasInnerQuotes = original.includes('"');
    if (originalHasInnerQuotes && result.endsWith('"')) {
      result = result.slice(1, -1);
    }
  }

  // Remove markdown-style backticks if LLM added them
  if (result.startsWith("`") && result.endsWith("`")) {
    result = result.slice(1, -1);
  }

  // Remove triple backticks if present
  if (result.startsWith("```") && result.endsWith("```")) {
    result = result.slice(3, -3).trim();
  }

  return result;
}

/**
 * Translate multiple strings in batch using semaphore for maximum throughput
 */
export async function translateBatch(
  contexts: TranslationContext[],
  targetLanguage: LanguageInfo,
  options: {
    verbose?: boolean;
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {},
): Promise<TranslationResult[]> {
  const config = getConfig();
  const {
    concurrency = config.concurrency,
    verbose = false,
    onProgress,
  } = options;

  let completed = 0;
  let running = 0;
  let index = 0;
  const results: TranslationResult[] = new Array(contexts.length);

  return new Promise((resolve) => {
    const runNext = () => {
      while (running < concurrency && index < contexts.length) {
        const currentIndex = index++;
        running++;

        translateString(contexts[currentIndex], targetLanguage, { verbose })
          .then((result) => {
            results[currentIndex] = result;
          })
          .catch((error) => {
            // On error, use original value as fallback
            console.error(
              `Failed to translate ${contexts[currentIndex].key}: ${error.message}`,
            );
            results[currentIndex] = {
              key: contexts[currentIndex].key,
              originalValue: contexts[currentIndex].englishValue,
              translatedValue: contexts[currentIndex].englishValue, // fallback
              targetLanguage: targetLanguage.code,
            };
          })
          .finally(() => {
            running--;
            completed++;

            if (onProgress) {
              onProgress(completed, contexts.length);
            }

            if (completed === contexts.length) {
              resolve(results);
            } else {
              runNext();
            }
          });
      }
    };

    // Kick off initial batch
    runNext();
  });
}

/**
 * Translate missing keys in a target language file
 */
export async function translateMissingKeys(
  missingKeys: string[],
  targetLanguage: string,
  options: {
    verbose?: boolean;
    dryRun?: boolean;
  } = {},
): Promise<TranslationResult[]> {
  const langInfo = getLanguageInfo(targetLanguage);
  if (!langInfo) {
    throw new Error(
      `Unsupported language: ${targetLanguage}. Use --list-languages to see supported languages.`,
    );
  }

  const config = getConfig();
  const messagesDir = getMessagesDir();

  // Load English source and existing translations
  const englishFile = loadTranslationFile(
    path.join(messagesDir, `${config.sourceLanguage}.json`),
  );
  const existingTranslations = new Map<string, TranslationFile>();

  // Load all existing translation files as context (except source and target language)
  try {
    const files = fs
      .readdirSync(messagesDir)
      .filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const langCode = file.replace(".json", "");
      if (langCode !== config.sourceLanguage && langCode !== targetLanguage) {
        try {
          existingTranslations.set(
            langCode,
            loadTranslationFile(path.join(messagesDir, file)),
          );
        } catch {
          // Skip files that fail to load
        }
      }
    }
  } catch {
    // Directory read failed, continue without context
  }

  // Load the target language file to build the similar-example index
  let pairIndex:
    | Map<string, { english: string; translated: string; key: string }>
    | undefined;
  const targetFilePath = path.join(messagesDir, `${targetLanguage}.json`);
  if (fs.existsSync(targetFilePath)) {
    try {
      const targetFile = loadTranslationFile(targetFilePath);
      pairIndex = buildTranslationPairIndex(englishFile, targetFile);
      if (pairIndex.size > 0) {
        console.log(
          colorize(
            `  Using ${pairIndex.size} existing translations as similarity examples`,
            "dim",
          ),
        );
      }
    } catch {
      // Failed to load target file, continue without examples
    }
  }

  const stringKeys = missingKeys.filter((key) => {
    const value = getValueAtPath(englishFile, key);
    return typeof value === "string";
  });

  if (stringKeys.length === 0) {
    console.log(colorize("No string keys to translate.", "yellow"));
    return [];
  }

  const results: TranslationResult[] = [];

  if (options.dryRun) {
    const contexts = stringKeys.map((key) =>
      buildTranslationContext(
        englishFile,
        existingTranslations,
        key,
        pairIndex,
      ),
    );
    return contexts.map((c) => ({
      key: c.key,
      originalValue: c.englishValue,
      translatedValue: `[${langInfo.code}] ${c.englishValue}`,
      targetLanguage: langInfo.code,
    }));
  }

  const hrefKeys = stringKeys.filter((key) =>
    isHrefKey(key, config.hrefPatterns),
  );
  for (const key of hrefKeys) {
    results.push({
      key,
      originalValue: getValueAtPath(englishFile, key) as string,
      translatedValue: getValueAtPath(englishFile, key) as string,
      targetLanguage: langInfo.code,
    });
  }

  const patterns = config.linkedContentPatterns;
  const descriptionKeysWithLinks = stringKeys.filter((key) => {
    const parentPath = getDescriptionParentPath(key, patterns);
    return parentPath && sectionHasLinks(englishFile, parentPath, patterns);
  });

  const linkTextKeysToSkip = new Set<string>();
  for (const descKey of descriptionKeysWithLinks) {
    const parentPath = getDescriptionParentPath(descKey, patterns)!;
    const parent = getValueAtPath(englishFile, parentPath);
    const linksKey = patterns.length > 0 ? patterns[0].linksKey : "links";
    const links = (parent as Record<string, unknown>)?.[linksKey];
    if (Array.isArray(links)) {
      for (const kp of getLinkTextKeyPaths(
        parentPath,
        links.length,
        patterns,
      )) {
        linkTextKeysToSkip.add(kp);
      }
    }
  }

  for (const descKey of descriptionKeysWithLinks) {
    const description = getValueAtPath(englishFile, descKey) as string;
    const parentPath = getDescriptionParentPath(descKey, patterns)!;
    const linkTexts = getLinkTextsFromSection(englishFile, parentPath, patterns);

    const combinedResults = await translateDescriptionWithLinks(
      descKey,
      description,
      linkTexts,
      langInfo,
      options,
    );
    results.push(...combinedResults);
  }

  const normalKeys = stringKeys.filter(
    (key) =>
      !isHrefKey(key, config.hrefPatterns) &&
      !descriptionKeysWithLinks.includes(key) &&
      !linkTextKeysToSkip.has(key),
  );

  const contexts = normalKeys.map((key) =>
    buildTranslationContext(
      englishFile,
      existingTranslations,
      key,
      pairIndex,
    ),
  );

  console.log(
    colorize(
      `\nTranslating ${results.length + contexts.length} keys to ${langInfo.name} (${hrefKeys.length} hrefs copied, ${descriptionKeysWithLinks.length} description+links, ${contexts.length} normal)...`,
      "cyan",
    ),
  );

  let lastReported = 0;
  const batchResults = await translateBatch(contexts, langInfo, {
    verbose: options.verbose,
    onProgress: (completed, total) => {
      // Only update progress every 2% or 50 items to reduce stdout overhead
      const pct = Math.round((completed / total) * 100);
      if (
        pct >= lastReported + 2 ||
        completed === total ||
        completed - lastReported >= 50
      ) {
        lastReported = pct;
        process.stdout.write(`\r  Progress: ${completed}/${total} (${pct}%)`);
      }
    },
  });

  console.log("\n");
  return [...results, ...batchResults];
}

/**
 * Create a full translation file for a new language
 */
export async function createFullTranslation(
  targetLanguage: string,
  options: {
    verbose?: boolean;
    dryRun?: boolean;
  } = {},
): Promise<TranslationFile> {
  const langInfo = getLanguageInfo(targetLanguage);
  if (!langInfo) {
    throw new Error(`Unsupported language: ${targetLanguage}`);
  }

  const config = getConfig();
  const messagesDir = getMessagesDir();

  // Load English source
  const englishFile = loadTranslationFile(
    path.join(messagesDir, `${config.sourceLanguage}.json`),
  );

  const allKeys = flattenKeys(englishFile);

  // Load all existing translations as context (except source and target language)
  const existingTranslations = new Map<string, TranslationFile>();
  try {
    const files = fs
      .readdirSync(messagesDir)
      .filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const langCode = file.replace(".json", "");
      if (langCode !== config.sourceLanguage && langCode !== targetLanguage) {
        try {
          existingTranslations.set(
            langCode,
            loadTranslationFile(path.join(messagesDir, file)),
          );
        } catch {
          // Skip files that fail to load
        }
      }
    }
    if (existingTranslations.size > 0) {
      console.log(
        colorize(
          `  Using ${existingTranslations.size} existing translation(s) as context: ${[...existingTranslations.keys()].join(", ")}`,
          "dim",
        ),
      );
    }
  } catch {
    // Directory read failed, continue without context
  }

  const stringKeys = allKeys.filter(
    (key) => typeof getValueAtPath(englishFile, key) === "string",
  );

  const patterns = config.linkedContentPatterns;
  const hrefKeys = stringKeys.filter((key) =>
    isHrefKey(key, config.hrefPatterns),
  );
  const descriptionKeysWithLinks = stringKeys.filter((key) => {
    const parentPath = getDescriptionParentPath(key, patterns);
    return parentPath && sectionHasLinks(englishFile, parentPath, patterns);
  });

  const linkTextKeysToSkip = new Set<string>();
  for (const descKey of descriptionKeysWithLinks) {
    const parentPath = getDescriptionParentPath(descKey, patterns)!;
    const parent = getValueAtPath(englishFile, parentPath);
    const linksKey = patterns.length > 0 ? patterns[0].linksKey : "links";
    const links = (parent as Record<string, unknown>)?.[linksKey];
    if (Array.isArray(links)) {
      for (const kp of getLinkTextKeyPaths(
        parentPath,
        links.length,
        patterns,
      )) {
        linkTextKeysToSkip.add(kp);
      }
    }
  }

  const normalKeys = stringKeys.filter(
    (key) =>
      !isHrefKey(key, config.hrefPatterns) &&
      !descriptionKeysWithLinks.includes(key) &&
      !linkTextKeysToSkip.has(key),
  );

  // Try to load existing target file for similar-example matching
  let pairIndex:
    | Map<string, { english: string; translated: string; key: string }>
    | undefined;
  const targetFilePath = path.join(messagesDir, `${targetLanguage}.json`);
  if (fs.existsSync(targetFilePath)) {
    try {
      const existingTargetFile = loadTranslationFile(targetFilePath);
      pairIndex = buildTranslationPairIndex(englishFile, existingTargetFile);
      if (pairIndex.size > 0) {
        console.log(
          colorize(
            `  Using ${pairIndex.size} existing translations as similarity examples`,
            "dim",
          ),
        );
      }
    } catch {
      // Failed to load, continue without examples
    }
  }

  const contexts: TranslationContext[] = normalKeys.map((key) =>
    buildTranslationContext(
      englishFile,
      existingTranslations,
      key,
      pairIndex,
    ),
  );

  console.log(
    colorize(
      `\nCreating full translation for ${langInfo.name} (${stringKeys.length} strings: ${hrefKeys.length} hrefs copy, ${descriptionKeysWithLinks.length} description+links, ${contexts.length} normal)...`,
      "cyan",
    ),
  );

  if (options.dryRun) {
    console.log(
      colorize("(Dry run - returning placeholder translations)", "yellow"),
    );
    const translatedFile: TranslationFile = JSON.parse(
      JSON.stringify(englishFile),
    );
    return translatedFile;
  }

  const allResults: TranslationResult[] = [];

  for (const key of hrefKeys) {
    allResults.push({
      key,
      originalValue: getValueAtPath(englishFile, key) as string,
      translatedValue: getValueAtPath(englishFile, key) as string,
      targetLanguage: langInfo.code,
    });
  }

  for (const descKey of descriptionKeysWithLinks) {
    const description = getValueAtPath(englishFile, descKey) as string;
    const parentPath = getDescriptionParentPath(descKey, patterns)!;
    const linkTexts = getLinkTextsFromSection(
      englishFile,
      parentPath,
      patterns,
    );

    const combinedResults = await translateDescriptionWithLinks(
      descKey,
      description,
      linkTexts,
      langInfo,
      options,
    );
    allResults.push(...combinedResults);
  }

  let lastReported = 0;
  const batchResults = await translateBatch(contexts, langInfo, {
    verbose: options.verbose,
    onProgress: (completed, total) => {
      const pct = Math.round((completed / total) * 100);
      if (
        pct >= lastReported + 2 ||
        completed === total ||
        completed - lastReported >= 50
      ) {
        lastReported = pct;
        process.stdout.write(`\r  Progress: ${completed}/${total} (${pct}%)`);
      }
    },
  });

  allResults.push(...batchResults);
  console.log("\n");

  // Build the translation file with same structure as English
  const translatedFile: TranslationFile = JSON.parse(
    JSON.stringify(englishFile),
  );

  for (const result of allResults) {
    setValueAtKeyPath(
      translatedFile,
      result.key,
      result.translatedValue,
      englishFile,
    );
  }

  return translatedFile;
}

/**
 * Helper to set value at key path.
 * Optionally accepts a reference object to preserve arrays vs objects
 * when creating missing intermediate containers.
 */
function setValueAtKeyPath(
  obj: TranslationFile,
  keyPath: string,
  value: string,
  referenceObj?: TranslationFile,
): void {
  const parts = keyPath.split(".");
  let current = obj;
  let refCurrent: TranslationFile | undefined = referenceObj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
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

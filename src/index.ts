#!/usr/bin/env node

/**
 * transl8-ai CLI Tool
 *
 * A standalone CLI for managing translation files with AI.
 */

import { config } from "dotenv";
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";

// Load .env from cwd
config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

import {
  analyzeAllFiles,
  printDiscrepancyReport,
  generateJsonReport,
  compareTranslations,
} from "./analyzer.js";

import {
  translateMissingKeys,
  createFullTranslation,
  initOpenAI,
  getLanguageInfo,
  setTranslatorConfig,
} from "./translator.js";

import {
  listTranslationFiles,
  loadTranslationFile,
  saveTranslationFile,
  getLanguageCode,
  flattenKeys,
  getValueAtPath,
  setValueAtPath,
  deepClone,
  colorize,
  printBanner,
  printHeader,
  printSection,
  setMessagesDir,
  setGlossaryPath,
  getMessagesDir,
  reorderToMatchSource,
  loadGlossary,
  saveGlossary,
  getGlossaryPath,
} from "./utils.js";

import {
  SUPPORTED_LANGUAGES,
  type TranslationFile,
  type GlossaryEntry,
} from "./types.js";

import {
  loadConfig,
  createDefaultConfig,
  createDefaultGlossary,
} from "./config.js";

/** Display a file path relative to cwd */
function relPath(filePath: string): string {
  return path.relative(process.cwd(), filePath);
}

const program = new Command();

program
  .name("transl8")
  .description("AI-powered CLI for managing i18n translation files")
  .version("1.0.0")
  .option(
    "-m, --messages <path>",
    "Path to messages directory (default: from config)",
  )
  .option("--model <model>", "OpenAI model to use (default: from config)")
  .option(
    "--concurrency <number>",
    "Max concurrent API requests (default: from config)",
    parseInt,
  );

// Load config before commands run (except for init and list-languages)
program.hook("preAction", (thisCommand: Command) => {
  const commandName = thisCommand.args[0];
  // Skip config loading for commands that don't need it
  if (commandName === "init" || commandName === "list-languages") {
    return;
  }

  const opts = thisCommand.opts();
  const cfg = loadConfig({
    model: opts.model,
    concurrency: opts.concurrency,
    messagesDir: opts.messages,
  });

  setMessagesDir(cfg.messagesDir);
  setGlossaryPath(cfg.glossaryPath);
  setTranslatorConfig(cfg);
});

// ============================================================================
// init command
// ============================================================================
program
  .command("init")
  .description("Initialize transl8 in the current directory")
  .action(() => {
    try {
      printHeader("Initializing transl8");

      // Check if config already exists
      const existingConfig = path.join(process.cwd(), ".transl8rc.json");
      if (fs.existsSync(existingConfig)) {
        console.log(
          colorize("\n  .transl8rc.json already exists in this directory.", "yellow"),
        );
        console.log("  Delete it first if you want to reinitialize.\n");
        return;
      }

      // Create config
      const configPath = createDefaultConfig();
      console.log(
        `\n  ${colorize("Created:", "green")} ${path.basename(configPath)}`,
      );

      // Create glossary if it doesn't exist
      const glossaryPath = path.join(process.cwd(), "glossary.json");
      if (!fs.existsSync(glossaryPath)) {
        createDefaultGlossary();
        console.log(
          `  ${colorize("Created:", "green")} glossary.json`,
        );
      } else {
        console.log(
          `  ${colorize("Exists:", "dim")} glossary.json`,
        );
      }

      // Check for OPENAI_API_KEY
      console.log("");
      if (process.env.OPENAI_API_KEY) {
        console.log(
          `  ${colorize("✓", "green")} OPENAI_API_KEY is set`,
        );
      } else {
        console.log(
          `  ${colorize("⚠", "yellow")} OPENAI_API_KEY not found`,
        );
        console.log(
          "  Set it before running translations:",
        );
        console.log(
          `  ${colorize("export OPENAI_API_KEY=sk-...", "cyan")}`,
        );
      }

      // Check for messages directory
      const messagesDir = path.join(process.cwd(), "messages");
      if (fs.existsSync(messagesDir)) {
        const jsonFiles = fs
          .readdirSync(messagesDir)
          .filter((f) => f.endsWith(".json"));
        console.log(
          `\n  ${colorize("✓", "green")} Found messages/ directory with ${jsonFiles.length} file(s)`,
        );
      } else {
        console.log(
          `\n  ${colorize("⚠", "yellow")} No messages/ directory found`,
        );
        console.log(
          "  Create it and add your source language file (e.g. messages/en.json)",
        );
      }

      console.log(
        `\n  ${colorize("Next steps:", "bold")}`,
      );
      console.log("  1. Edit .transl8rc.json to match your project");
      console.log("  2. Run `transl8 analyze` to check your translation files");
      console.log("  3. Run `transl8 translate <lang>` to translate missing keys\n");
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// analyze command
// ============================================================================
program
  .command("analyze")
  .description("Analyze all translation files for discrepancies")
  .option("--json", "Output as JSON")
  .action((options) => {
    try {
      printHeader("Translation File Analysis");

      const results = analyzeAllFiles("en.json");

      if (options.json) {
        console.log(generateJsonReport(results));
        return;
      }

      for (const result of results) {
        printDiscrepancyReport(result);
      }

      // Overall summary
      printSection("Overall Summary");
      const totalMissing = results.reduce(
        (sum, r) => sum + r.report.summary.missingCount,
        0,
      );
      const totalExtra = results.reduce(
        (sum, r) => sum + r.report.summary.extraCount,
        0,
      );
      const totalMismatches = results.reduce(
        (sum, r) => sum + r.report.summary.typeMismatchCount,
        0,
      );

      console.log(
        `  Total files analyzed: ${colorize(results.length.toString(), "cyan")}`,
      );
      console.log(
        `  Total missing keys: ${colorize(totalMissing.toString(), totalMissing > 0 ? "red" : "green")}`,
      );
      console.log(
        `  Total extra keys: ${colorize(totalExtra.toString(), "yellow")}`,
      );
      console.log(
        `  Total type mismatches: ${colorize(totalMismatches.toString(), totalMismatches > 0 ? "red" : "green")}`,
      );
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// compare command
// ============================================================================
program
  .command("compare <language>")
  .description("Compare a specific language against English")
  .option("--json", "Output as JSON")
  .action((language, options) => {
    try {
      const messagesDir = getMessagesDir();
      const targetFile = path.join(messagesDir, `${language}.json`);
      const sourceFile = path.join(messagesDir, "en.json");

      if (!fs.existsSync(targetFile)) {
        console.error(
          colorize(`Error: Translation file not found: ${relPath(targetFile)}`, "red"),
        );
        process.exit(1);
      }

      const source = loadTranslationFile(sourceFile);
      const target = loadTranslationFile(targetFile);
      const report = compareTranslations(source, target);

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              source: "en",
              target: language,
              ...report,
            },
            null,
            2,
          ),
        );
        return;
      }

      printDiscrepancyReport({
        sourceFile,
        targetFile,
        report,
      });
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// create command
// ============================================================================
program
  .command("create <language>")
  .description("Create a new translation file for a language")
  .option("-f, --force", "Overwrite existing file")
  .option("-d, --dry-run", "Preview without creating files")
  .option("-v, --verbose", "Show detailed output")
  .action(async (language, options) => {
    try {
      const langInfo = getLanguageInfo(language);
      if (!langInfo) {
        console.error(
          colorize(`Error: Unsupported language code: ${language}`, "red"),
        );
        console.error(
          'Run "transl8 list-languages" to see available languages.',
        );
        process.exit(1);
      }

      const messagesDir = getMessagesDir();
      const targetFile = path.join(messagesDir, `${language}.json`);

      if (fs.existsSync(targetFile) && !options.force) {
        console.error(
          colorize(
            `Error: Translation file already exists: ${relPath(targetFile)}`,
            "red",
          ),
        );
        console.error("Use --force to overwrite.");
        process.exit(1);
      }

      printHeader(
        `Creating ${langInfo.name} (${langInfo.nativeName}) Translation`,
      );

      if (options.dryRun) {
        console.log(
          colorize("\n(Dry run - no files will be created)\n", "yellow"),
        );

        const sourceFile = loadTranslationFile(
          path.join(messagesDir, "en.json"),
        );
        const keyCount = flattenKeys(sourceFile).length;
        console.log(`Would create: ${relPath(targetFile)}`);
        console.log(`Total keys to translate: ${keyCount}`);
        return;
      }

      try {
        initOpenAI();
      } catch (error) {
        console.error(
          colorize(
            `\nError: ${error instanceof Error ? error.message : error}`,
            "red",
          ),
        );
        console.error(
          "\nTo create translations, please set your OpenAI API key:",
        );
        console.error("  export OPENAI_API_KEY=your-api-key");
        process.exit(1);
      }

      const translatedFile = await createFullTranslation(language, {
        verbose: options.verbose,
        dryRun: options.dryRun,
      });

      const source = loadTranslationFile(path.join(messagesDir, "en.json"));
      saveTranslationFile(
        targetFile,
        reorderToMatchSource(source, translatedFile),
      );

      console.log(
        colorize(`\n✓ Created translation file: ${relPath(targetFile)}`, "green"),
      );
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// translate command
// ============================================================================
program
  .command("translate <language>")
  .description("Translate missing keys for a language")
  .option("-d, --dry-run", "Preview without making changes")
  .option("-v, --verbose", "Show detailed output")
  .action(async (language, options) => {
    try {
      const langInfo = getLanguageInfo(language);
      if (!langInfo) {
        console.error(
          colorize(`Error: Unsupported language code: ${language}`, "red"),
        );
        process.exit(1);
      }

      const messagesDir = getMessagesDir();
      const targetFile = path.join(messagesDir, `${language}.json`);
      const sourceFile = path.join(messagesDir, "en.json");

      if (!fs.existsSync(targetFile)) {
        console.error(
          colorize(`Error: Translation file not found: ${relPath(targetFile)}`, "red"),
        );
        console.error(
          `Use "transl8 create ${language}" to create a new translation file.`,
        );
        process.exit(1);
      }

      printHeader(`Translating Missing Keys for ${langInfo.name}`);

      const source = loadTranslationFile(sourceFile);
      const target = loadTranslationFile(targetFile);
      const report = compareTranslations(source, target);

      if (report.missingInTarget.length === 0) {
        console.log(
          colorize(
            "\n✓ No missing keys! File is in sync with English.",
            "green",
          ),
        );
        return;
      }

      console.log(
        `\nFound ${colorize(report.missingInTarget.length.toString(), "yellow")} missing keys.`,
      );

      if (options.dryRun) {
        console.log(
          colorize(
            "\n(Dry run - showing keys that would be translated)\n",
            "yellow",
          ),
        );
        for (const key of report.missingInTarget) {
          const englishValue = getValueAtPath(source, key);
          console.log(`  ${colorize(key, "cyan")}: "${englishValue}"`);
        }
        return;
      }

      try {
        initOpenAI();
      } catch (error) {
        console.error(
          colorize(
            `\nError: ${error instanceof Error ? error.message : error}`,
            "red",
          ),
        );
        process.exit(1);
      }

      const results = await translateMissingKeys(
        report.missingInTarget,
        language,
        {
          verbose: options.verbose,
          dryRun: options.dryRun,
        },
      );

      // Apply translations to target file
      const updatedTarget = deepClone(target);
      for (const result of results) {
        setValueAtPath(
          updatedTarget,
          result.key,
          result.translatedValue,
          source,
        );
      }

      saveTranslationFile(
        targetFile,
        reorderToMatchSource(source, updatedTarget),
      );

      console.log(
        colorize(
          `\n✓ Updated ${results.length} translations in ${relPath(targetFile)}`,
          "green",
        ),
      );
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// sync command
// ============================================================================
program
  .command("sync <language>")
  .description("Sync a language file with English (add missing keys)")
  .option("-t, --translate", "Use LLM to translate missing keys")
  .option("-d, --dry-run", "Preview without making changes")
  .option("-v, --verbose", "Show detailed output")
  .action(async (language, options) => {
    try {
      const langInfo = getLanguageInfo(language);
      if (!langInfo) {
        console.error(
          colorize(`Error: Unsupported language code: ${language}`, "red"),
        );
        process.exit(1);
      }

      const messagesDir = getMessagesDir();
      const targetFile = path.join(messagesDir, `${language}.json`);
      const sourceFile = path.join(messagesDir, "en.json");

      // Create file if it doesn't exist
      if (!fs.existsSync(targetFile)) {
        console.log(
          colorize(`Creating new translation file: ${relPath(targetFile)}`, "cyan"),
        );
        if (!options.dryRun) {
          saveTranslationFile(targetFile, {});
        }
      }

      printHeader(`Syncing ${langInfo.name} with English`);

      const source = loadTranslationFile(sourceFile);
      const target = fs.existsSync(targetFile)
        ? loadTranslationFile(targetFile)
        : {};
      const report = compareTranslations(source, target);

      console.log(
        `\nMissing keys: ${colorize(report.missingInTarget.length.toString(), report.missingInTarget.length > 0 ? "yellow" : "green")}`,
      );
      console.log(
        `Extra keys: ${colorize(report.extraInTarget.length.toString(), "dim")}`,
      );

      if (report.missingInTarget.length === 0) {
        console.log(colorize("\n✓ File is already in sync!", "green"));
        return;
      }

      // When --translate is not used, just show the report without modifying files
      if (!options.translate) {
        console.log(colorize("\nMissing keys (not modifying file):", "yellow"));
        if (options.verbose) {
          for (const key of report.missingInTarget) {
            const englishValue = getValueAtPath(source, key);
            console.log(`  ${colorize(key, "cyan")}: "${englishValue}"`);
          }
        } else {
          for (const key of report.missingInTarget.slice(0, 10)) {
            const englishValue = getValueAtPath(source, key);
            console.log(`  ${colorize(key, "cyan")}: "${englishValue}"`);
          }
          if (report.missingInTarget.length > 10) {
            console.log(`  ... and ${report.missingInTarget.length - 10} more`);
          }
        }
        console.log(
          colorize(
            "\nRun with --translate to translate and save missing keys",
            "dim",
          ),
        );
        return;
      }

      // Only proceed with file modifications when --translate is used
      const updatedTarget = deepClone(target) as TranslationFile;

      // Translate missing keys with LLM
      if (options.dryRun) {
        console.log(
          colorize(
            "\n(Dry run - would translate missing keys with LLM)",
            "yellow",
          ),
        );
        for (const key of report.missingInTarget.slice(0, 10)) {
          const englishValue = getValueAtPath(source, key);
          console.log(`  ${colorize(key, "cyan")}: "${englishValue}"`);
        }
        if (report.missingInTarget.length > 10) {
          console.log(`  ... and ${report.missingInTarget.length - 10} more`);
        }
        return;
      }

      try {
        initOpenAI();
      } catch (error) {
        console.error(
          colorize(
            `\nError: ${error instanceof Error ? error.message : error}`,
            "red",
          ),
        );
        process.exit(1);
      }

      const results = await translateMissingKeys(
        report.missingInTarget,
        language,
        {
          verbose: options.verbose,
          dryRun: options.dryRun,
        },
      );

      for (const result of results) {
        setValueAtPath(
          updatedTarget,
          result.key,
          result.translatedValue,
          source,
        );
      }

      console.log(colorize(`\n✓ Translated ${results.length} keys`, "green"));

      saveTranslationFile(
        targetFile,
        reorderToMatchSource(source, updatedTarget),
      );
      console.log(colorize(`\nSaved: ${relPath(targetFile)}`, "green"));
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// prune command
// ============================================================================
program
  .command("prune <language>")
  .description(
    "Remove extra keys from a language file that don't exist in English",
  )
  .option("-d, --dry-run", "Preview without making changes")
  .action((language, options) => {
    try {
      const langInfo = getLanguageInfo(language);
      if (!langInfo) {
        console.error(
          colorize(`Error: Unsupported language code: ${language}`, "red"),
        );
        process.exit(1);
      }

      const messagesDir = getMessagesDir();
      const targetFile = path.join(messagesDir, `${language}.json`);
      const sourceFile = path.join(messagesDir, "en.json");

      if (!fs.existsSync(targetFile)) {
        console.error(
          colorize(`Error: Translation file not found: ${relPath(targetFile)}`, "red"),
        );
        process.exit(1);
      }

      printHeader(`Pruning Extra Keys from ${langInfo.name}`);

      const source = loadTranslationFile(sourceFile);
      const target = loadTranslationFile(targetFile);
      const report = compareTranslations(source, target);

      if (report.extraInTarget.length === 0) {
        console.log(
          colorize("\n✓ No extra keys to remove! File is clean.", "green"),
        );
        return;
      }

      console.log(
        `\nFound ${colorize(report.extraInTarget.length.toString(), "yellow")} extra keys to remove:`,
      );

      // Group by section for display
      const grouped: Record<string, string[]> = {};
      for (const key of report.extraInTarget) {
        const section = key.split(".")[0];
        if (!grouped[section]) grouped[section] = [];
        grouped[section].push(key);
      }

      for (const [section, keys] of Object.entries(grouped)) {
        console.log(colorize(`\n  [${section}]`, "magenta"));
        for (const key of keys) {
          const value = getValueAtPath(target, key);
          const preview =
            typeof value === "string"
              ? value.length > 40
                ? value.slice(0, 40) + "..."
                : value
              : "(object)";
          console.log(`    ${colorize("✗", "red")} ${key}: "${preview}"`);
        }
      }

      if (options.dryRun) {
        console.log(colorize("\n(Dry run - no changes made)", "yellow"));
        return;
      }

      // Remove extra keys from target
      const prunedTarget = deepClone(target);
      for (const keyPath of report.extraInTarget) {
        removeKeyAtPath(prunedTarget, keyPath);
      }

      // Clean up empty objects
      cleanEmptyObjects(prunedTarget);

      saveTranslationFile(
        targetFile,
        reorderToMatchSource(source, prunedTarget),
      );
      console.log(
        colorize(
          `\n✓ Removed ${report.extraInTarget.length} extra keys from ${relPath(targetFile)}`,
          "green",
        ),
      );
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

/**
 * Remove a key at a given path from an object
 */
function removeKeyAtPath(obj: TranslationFile, keyPath: string): void {
  const parts = keyPath.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      return; // Path doesn't exist
    }
    current = current[part] as TranslationFile;
  }

  delete current[parts[parts.length - 1]];
}

/**
 * Recursively remove empty objects from a translation file
 */
function cleanEmptyObjects(obj: TranslationFile): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "object" && value !== null) {
      cleanEmptyObjects(value as TranslationFile);
      if (Object.keys(value).length === 0) {
        delete obj[key];
      }
    }
  }
}

// ============================================================================
// fix-quotes command
// ============================================================================
program
  .command("fix-quotes <language>")
  .description(
    "Fix extra quotes in a translation file by comparing with English",
  )
  .option("-d, --dry-run", "Preview without making changes")
  .action((language, options) => {
    try {
      const langInfo = getLanguageInfo(language);
      if (!langInfo) {
        console.error(
          colorize(`Error: Unsupported language code: ${language}`, "red"),
        );
        process.exit(1);
      }

      const messagesDir = getMessagesDir();
      const targetFile = path.join(messagesDir, `${language}.json`);
      const sourceFile = path.join(messagesDir, "en.json");

      if (!fs.existsSync(targetFile)) {
        console.error(
          colorize(`Error: Translation file not found: ${relPath(targetFile)}`, "red"),
        );
        process.exit(1);
      }

      printHeader(`Fixing Quotes in ${langInfo.name}`);

      const source = loadTranslationFile(sourceFile);
      const target = loadTranslationFile(targetFile);
      const sourceKeys = flattenKeys(source);

      let fixedCount = 0;
      const fixes: Array<{ key: string; before: string; after: string }> = [];

      for (const keyPath of sourceKeys) {
        const sourceValue = getValueAtPath(source, keyPath);
        const targetValue = getValueAtPath(target, keyPath);

        if (
          typeof sourceValue !== "string" ||
          typeof targetValue !== "string"
        ) {
          continue;
        }

        const fixed = fixExtraQuotes(targetValue, sourceValue);
        if (fixed !== targetValue) {
          fixes.push({ key: keyPath, before: targetValue, after: fixed });
          fixedCount++;
        }
      }

      if (fixes.length === 0) {
        console.log(colorize("\n✓ No quote issues found!", "green"));
        return;
      }

      console.log(
        `\nFound ${colorize(fixes.length.toString(), "yellow")} values with extra quotes:\n`,
      );

      for (const fix of fixes.slice(0, 20)) {
        console.log(colorize(`  ${fix.key}:`, "cyan"));
        console.log(`    Before: ${colorize(truncate(fix.before, 60), "red")}`);
        console.log(
          `    After:  ${colorize(truncate(fix.after, 60), "green")}`,
        );
      }

      if (fixes.length > 20) {
        console.log(`\n  ... and ${fixes.length - 20} more`);
      }

      if (options.dryRun) {
        console.log(colorize("\n(Dry run - no changes made)", "yellow"));
        return;
      }

      // Apply fixes
      const updatedTarget = deepClone(target);
      for (const fix of fixes) {
        setValueAtPath(updatedTarget, fix.key, fix.after, source);
      }

      saveTranslationFile(
        targetFile,
        reorderToMatchSource(source, updatedTarget),
      );
      console.log(
        colorize(`\n✓ Fixed ${fixedCount} values in ${relPath(targetFile)}`, "green"),
      );
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

/**
 * Fix extra quotes in a translation by comparing with the original
 */
function fixExtraQuotes(translated: string, original: string): string {
  let result = translated;

  const originalStartsWithQuote = original.startsWith('"');
  const originalEndsWithQuote = original.endsWith('"');

  // If original doesn't have outer quotes but translation does, strip them
  if (!originalStartsWithQuote && !originalEndsWithQuote) {
    if (result.startsWith('"') && result.endsWith('"')) {
      result = result.slice(1, -1);
    }
  }

  // Handle case where LLM wrapped a value that has inner quotes
  if (!originalStartsWithQuote && result.startsWith('"')) {
    const originalHasInnerQuotes = original.includes('"');
    if (originalHasInnerQuotes && result.endsWith('"')) {
      result = result.slice(1, -1);
    }
  }

  return result;
}

/**
 * Truncate a string for display
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

// ============================================================================
// list-languages command
// ============================================================================
program
  .command("list-languages")
  .description("List all supported languages")
  .option("--json", "Output as JSON")
  .action((options) => {
    if (options.json) {
      console.log(JSON.stringify(SUPPORTED_LANGUAGES, null, 2));
      return;
    }

    printHeader("Supported Languages");

    console.log(
      "\n" + colorize("Code   Name                    Native Name", "dim"),
    );
    console.log(colorize("─".repeat(50), "dim"));

    for (const lang of SUPPORTED_LANGUAGES) {
      const code = lang.code.padEnd(6);
      const name = lang.name.padEnd(23);
      console.log(`${colorize(code, "cyan")} ${name} ${lang.nativeName}`);
    }

    console.log(
      `\n${colorize("Total:", "bold")} ${SUPPORTED_LANGUAGES.length} languages`,
    );
  });

// ============================================================================
// list-files command
// ============================================================================
program
  .command("list-files")
  .description("List all translation files")
  .option("--json", "Output as JSON")
  .action((options) => {
    try {
      const files = listTranslationFiles();

      if (options.json) {
        const fileInfo = files.map((f) => ({
          path: f,
          language: getLanguageCode(f),
          keyCount: flattenKeys(loadTranslationFile(f)).length,
        }));
        console.log(JSON.stringify(fileInfo, null, 2));
        return;
      }

      printHeader("Translation Files");

      console.log("\n" + colorize("Language   Keys     File", "dim"));
      console.log(colorize("─".repeat(50), "dim"));

      for (const filePath of files) {
        const lang = getLanguageCode(filePath);
        const content = loadTranslationFile(filePath);
        const keyCount = flattenKeys(content).length;
        const langInfo = getLanguageInfo(lang);

        const langDisplay = (langInfo?.name || lang).padEnd(10);
        const keyDisplay = keyCount.toString().padStart(5);

        console.log(
          `${colorize(langDisplay, "cyan")} ${keyDisplay}     ${path.basename(filePath)}`,
        );
      }

      console.log(`\n${colorize("Total:", "bold")} ${files.length} files`);
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// export-report command
// ============================================================================
program
  .command("export-report [outputFile]")
  .description("Export discrepancy report as JSON")
  .action((outputFile) => {
    try {
      const results = analyzeAllFiles("en.json");
      const report = generateJsonReport(results);

      if (!outputFile) {
        console.log(report);
        return;
      }

      fs.writeFileSync(outputFile, report, "utf-8");
      console.log(colorize(`✓ Report exported to: ${outputFile}`, "green"));
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// ============================================================================
// glossary command — manage protected terms that must not be translated
// ============================================================================
const glossaryCmd = program
  .command("glossary")
  .description(
    "Manage the translation glossary (protected terms that should not be directly translated)",
  );

glossaryCmd
  .command("list")
  .description("List all protected glossary terms")
  .action(() => {
    try {
      const glossary = loadGlossary();
      printHeader("Translation Glossary");

      if (!glossary.protectedTerms.length) {
        console.log(colorize("  No glossary terms defined yet.", "dim"));
        console.log(
          `\n  Add one with: ${colorize("transl8 glossary add <term> [description]", "cyan")}`,
        );
        return;
      }

      console.log(`\n${colorize("  File:", "dim")} ${getGlossaryPath()}\n`);
      console.log(colorize("  Term                    Description", "dim"));
      console.log(colorize("  " + "─".repeat(60), "dim"));

      for (const entry of glossary.protectedTerms) {
        const term = entry.term.padEnd(22);
        const overrides = Object.keys(entry.translations);
        const overrideNote =
          overrides.length > 0 ? ` [overrides: ${overrides.join(", ")}]` : "";
        console.log(
          `  ${colorize(term, "cyan")} ${entry.description}${colorize(overrideNote, "dim")}`,
        );
      }

      console.log(
        `\n${colorize("Total:", "bold")} ${glossary.protectedTerms.length} protected terms`,
      );
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

glossaryCmd
  .command("add <term> [description]")
  .description("Add a new protected term to the glossary")
  .option(
    "--translation <lang:value>",
    "Override translation for a specific language (e.g. --translation de:Momente)",
    (val: string, acc: string[]) => {
      acc.push(val);
      return acc;
    },
    [] as string[],
  )
  .action(
    (
      term: string,
      description: string | undefined,
      opts: { translation: string[] },
    ) => {
      try {
        const glossary = loadGlossary();

        // Check if it already exists
        const existing = glossary.protectedTerms.find(
          (e) => e.term.toLowerCase() === term.toLowerCase(),
        );
        if (existing) {
          console.log(
            colorize(
              `Term "${term}" already exists in the glossary.`,
              "yellow",
            ),
          );
          return;
        }

        const translations: Record<string, string> = {};
        for (const t of opts.translation) {
          const [lang, ...valueParts] = t.split(":");
          translations[lang] = valueParts.join(":");
        }

        const entry: GlossaryEntry = {
          term,
          description:
            description ||
            `Protected term. Must remain "${term}" in all languages.`,
          caseSensitive: true,
          translations,
        };

        glossary.protectedTerms.push(entry);
        saveGlossary(glossary);
        console.log(colorize(`✓ Added "${term}" to the glossary.`, "green"));
      } catch (error) {
        console.error(
          colorize(
            `Error: ${error instanceof Error ? error.message : error}`,
            "red",
          ),
        );
        process.exit(1);
      }
    },
  );

glossaryCmd
  .command("remove <term>")
  .description("Remove a term from the glossary")
  .action((term: string) => {
    try {
      const glossary = loadGlossary();
      const idx = glossary.protectedTerms.findIndex(
        (e) => e.term.toLowerCase() === term.toLowerCase(),
      );
      if (idx === -1) {
        console.log(
          colorize(`Term "${term}" not found in the glossary.`, "yellow"),
        );
        return;
      }

      glossary.protectedTerms.splice(idx, 1);
      saveGlossary(glossary);
      console.log(colorize(`✓ Removed "${term}" from the glossary.`, "green"));
    } catch (error) {
      console.error(
        colorize(
          `Error: ${error instanceof Error ? error.message : error}`,
          "red",
        ),
      );
      process.exit(1);
    }
  });

// Show banner when running interactively with a command
if (process.stdout.isTTY && process.argv.length > 2) {
  printBanner();
}

// Parse and run
program.parse(process.argv);

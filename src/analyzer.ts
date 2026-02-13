/**
 * Translation file analyzer - detects discrepancies between translation files
 */

import type {
  TranslationFile,
  DiscrepancyReport,
  ComparisonResult,
  TypeMismatch,
} from "./types.js";
import {
  loadTranslationFile,
  listTranslationFiles,
  getLanguageCode,
  flattenKeys,
  getValueAtPath,
  getValueType,
  colorize,
  printHeader,
  printSection,
} from "./utils.js";

/**
 * Compare two translation files and generate a discrepancy report
 */
export function compareTranslations(
  source: TranslationFile,
  target: TranslationFile,
): DiscrepancyReport {
  const sourceKeys = flattenKeys(source);
  const targetKeys = flattenKeys(target);

  const sourceKeySet = new Set(sourceKeys);
  const targetKeySet = new Set(targetKeys);

  // Find missing keys in target
  const missingInTarget = sourceKeys.filter((key) => !targetKeySet.has(key));

  // Find extra keys in target
  const extraInTarget = targetKeys.filter((key) => !sourceKeySet.has(key));

  // Find type mismatches (string vs object)
  const typeMismatches: TypeMismatch[] = [];

  for (const key of sourceKeys) {
    if (targetKeySet.has(key)) {
      const sourceValue = getValueAtPath(source, key);
      const targetValue = getValueAtPath(target, key);
      const sourceType = getValueType(sourceValue);
      const targetType = getValueType(targetValue);

      if (
        sourceType !== targetType &&
        sourceType !== "undefined" &&
        targetType !== "undefined"
      ) {
        typeMismatches.push({
          path: key,
          sourceType: sourceType as "string" | "object",
          targetType: targetType as "string" | "object",
        });
      }
    }
  }

  return {
    missingInTarget,
    extraInTarget,
    typeMismatches,
    summary: {
      totalKeysInSource: sourceKeys.length,
      totalKeysInTarget: targetKeys.length,
      missingCount: missingInTarget.length,
      extraCount: extraInTarget.length,
      typeMismatchCount: typeMismatches.length,
    },
  };
}

/**
 * Analyze all translation files against a reference file
 */
export function analyzeAllFiles(
  referenceFile: string = "en.json",
): ComparisonResult[] {
  const files = listTranslationFiles();
  const results: ComparisonResult[] = [];

  // Find the reference file
  const refFilePath = files.find((f) => f.endsWith(referenceFile));
  if (!refFilePath) {
    throw new Error(`Reference file not found: ${referenceFile}`);
  }

  const referenceContent = loadTranslationFile(refFilePath);

  // Compare each non-reference file against the reference
  for (const filePath of files) {
    if (filePath === refFilePath) continue;

    const targetContent = loadTranslationFile(filePath);
    const report = compareTranslations(referenceContent, targetContent);

    results.push({
      sourceFile: refFilePath,
      targetFile: filePath,
      report,
    });
  }

  return results;
}

/**
 * Group keys by their top-level section
 */
function groupKeysBySection(keys: string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};

  for (const key of keys) {
    const section = key.split(".")[0];
    if (!grouped[section]) {
      grouped[section] = [];
    }
    grouped[section].push(key);
  }

  return grouped;
}

/**
 * Print a detailed discrepancy report to console
 */
export function printDiscrepancyReport(result: ComparisonResult): void {
  const { sourceFile, targetFile, report } = result;
  const sourceLang = getLanguageCode(sourceFile);
  const targetLang = getLanguageCode(targetFile);

  printHeader(`Comparison: ${sourceLang} → ${targetLang}`);

  // Summary
  console.log("\n" + colorize("Summary:", "bold"));
  console.log(
    `  Source keys: ${colorize(report.summary.totalKeysInSource.toString(), "cyan")}`,
  );
  console.log(
    `  Target keys: ${colorize(report.summary.totalKeysInTarget.toString(), "cyan")}`,
  );

  const missingColor = report.summary.missingCount > 0 ? "red" : "green";
  const extraColor = report.summary.extraCount > 0 ? "yellow" : "green";
  const mismatchColor = report.summary.typeMismatchCount > 0 ? "red" : "green";

  console.log(
    `  Missing: ${colorize(report.summary.missingCount.toString(), missingColor)}`,
  );
  console.log(
    `  Extra: ${colorize(report.summary.extraCount.toString(), extraColor)}`,
  );
  console.log(
    `  Type mismatches: ${colorize(report.summary.typeMismatchCount.toString(), mismatchColor)}`,
  );

  // Missing keys
  if (report.missingInTarget.length > 0) {
    printSection(
      `Missing keys in ${targetLang} (${report.missingInTarget.length})`,
    );

    // Group by section for better readability
    const grouped = groupKeysBySection(report.missingInTarget);
    for (const [section, keys] of Object.entries(grouped)) {
      console.log(colorize(`  [${section}]`, "magenta"));
      for (const key of keys) {
        console.log(`    ${colorize("✗", "red")} ${key}`);
      }
    }
  }

  // Extra keys
  if (report.extraInTarget.length > 0) {
    printSection(
      `Extra keys in ${targetLang} (${report.extraInTarget.length})`,
    );

    const grouped = groupKeysBySection(report.extraInTarget);
    for (const [section, keys] of Object.entries(grouped)) {
      console.log(colorize(`  [${section}]`, "magenta"));
      for (const key of keys) {
        console.log(`    ${colorize("?", "yellow")} ${key}`);
      }
    }
  }

  // Type mismatches
  if (report.typeMismatches.length > 0) {
    printSection(`Type mismatches (${report.typeMismatches.length})`);

    for (const mismatch of report.typeMismatches) {
      console.log(`  ${colorize("⚠", "red")} ${mismatch.path}`);
      console.log(
        `    Source: ${colorize(mismatch.sourceType, "cyan")} → Target: ${colorize(mismatch.targetType, "yellow")}`,
      );
    }
  }

  // Status
  const hasIssues =
    report.summary.missingCount > 0 || report.summary.typeMismatchCount > 0;

  if (hasIssues) {
    console.log(
      "\n" + colorize("⚠ Issues found that should be addressed", "red"),
    );
  } else if (report.summary.extraCount > 0) {
    console.log(
      "\n" +
        colorize(
          "✓ No critical issues (extra keys are informational)",
          "yellow",
        ),
    );
  } else {
    console.log("\n" + colorize("✓ Files are in sync!", "green"));
  }
}

/**
 * Generate a JSON report of all discrepancies
 */
export function generateJsonReport(results: ComparisonResult[]): string {
  const report = {
    generatedAt: new Date().toISOString(),
    results: results.map((r) => ({
      source: getLanguageCode(r.sourceFile),
      target: getLanguageCode(r.targetFile),
      ...r.report,
    })),
  };

  return JSON.stringify(report, null, 2);
}

/**
 * Check if a specific translation file is in sync with the reference
 */
export function checkFileSync(
  referenceFile: string,
  targetFile: string,
): { inSync: boolean; report: DiscrepancyReport } {
  const reference = loadTranslationFile(referenceFile);
  const target = loadTranslationFile(targetFile);

  const report = compareTranslations(reference, target);
  const inSync =
    report.summary.missingCount === 0 && report.summary.typeMismatchCount === 0;

  return { inSync, report };
}

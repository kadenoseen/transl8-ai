/**
 * Configuration loading for transl8-ai
 *
 * Searches upward from cwd for .transl8rc.json and merges:
 * defaults → file → env vars → CLI flags
 */

import * as fs from "fs";
import * as path from "path";
import type { Transl8Config, LinkedContentPattern } from "./types.js";

const CONFIG_FILE_NAME = ".transl8rc.json";

const DEFAULT_CONFIG: Transl8Config = {
  messagesDir: "./messages",
  sourceLanguage: "en",
  model: "gpt-5.2",
  concurrency: 50,
  glossaryPath: "./glossary.json",
  linkedContentPatterns: [],
  hrefPatterns: ["*.href"],
};

/**
 * Walk upward from startDir looking for .transl8rc.json.
 * Returns the full path if found, null otherwise.
 */
export function findConfigFile(startDir?: string): string | null {
  let dir = startDir ? path.resolve(startDir) : process.cwd();
  const root = path.parse(dir).root;

  while (true) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Parse a raw config file into a partial Transl8Config.
 */
function parseConfigFile(filePath: string): Partial<Transl8Config> {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const result: Partial<Transl8Config> = {};

  if (typeof parsed.messagesDir === "string") {
    result.messagesDir = parsed.messagesDir;
  }
  if (typeof parsed.sourceLanguage === "string") {
    result.sourceLanguage = parsed.sourceLanguage;
  }
  if (typeof parsed.model === "string") {
    result.model = parsed.model;
  }
  if (typeof parsed.concurrency === "number") {
    result.concurrency = parsed.concurrency;
  }
  if (typeof parsed.glossaryPath === "string") {
    result.glossaryPath = parsed.glossaryPath;
  }
  if (Array.isArray(parsed.linkedContentPatterns)) {
    result.linkedContentPatterns =
      parsed.linkedContentPatterns as LinkedContentPattern[];
  }
  if (Array.isArray(parsed.hrefPatterns)) {
    result.hrefPatterns = parsed.hrefPatterns as string[];
  }

  return result;
}

/**
 * Read env-var overrides (TRANSL8_MODEL, TRANSL8_CONCURRENCY).
 */
function getEnvOverrides(): Partial<Transl8Config> {
  const result: Partial<Transl8Config> = {};

  if (process.env.TRANSL8_MODEL) {
    result.model = process.env.TRANSL8_MODEL;
  }
  if (process.env.TRANSL8_CONCURRENCY) {
    const n = parseInt(process.env.TRANSL8_CONCURRENCY, 10);
    if (!isNaN(n) && n > 0) {
      result.concurrency = n;
    }
  }

  return result;
}

export interface LoadConfigOptions {
  /** CLI --model flag */
  model?: string;
  /** CLI --concurrency flag */
  concurrency?: number;
  /** CLI --messages flag */
  messagesDir?: string;
}

/**
 * Load config by merging: defaults → .transl8rc.json → env vars → CLI flags.
 * Relative paths in the config file are resolved relative to the config file's
 * directory. If no config file is found, paths resolve relative to cwd.
 */
export function loadConfig(overrides?: LoadConfigOptions): Transl8Config {
  const configFilePath = findConfigFile();
  const configDir = configFilePath
    ? path.dirname(configFilePath)
    : process.cwd();

  // Start with defaults
  let config: Transl8Config = { ...DEFAULT_CONFIG };

  // Merge config file values
  if (configFilePath) {
    const fileConfig = parseConfigFile(configFilePath);
    config = { ...config, ...fileConfig };
  }

  // Merge env vars
  const envConfig = getEnvOverrides();
  config = { ...config, ...envConfig };

  // Merge CLI flag overrides
  if (overrides) {
    if (overrides.model) config.model = overrides.model;
    if (overrides.concurrency) config.concurrency = overrides.concurrency;
    if (overrides.messagesDir) config.messagesDir = overrides.messagesDir;
  }

  // Resolve relative paths against config file directory
  config.messagesDir = path.resolve(configDir, config.messagesDir);
  config.glossaryPath = path.resolve(configDir, config.glossaryPath);

  return config;
}

/**
 * Create a default .transl8rc.json file in cwd.
 */
export function createDefaultConfig(dir?: string): string {
  const targetDir = dir || process.cwd();
  const configPath = path.join(targetDir, CONFIG_FILE_NAME);

  const defaultContent = {
    messagesDir: "./messages",
    sourceLanguage: "en",
    model: "gpt-5.2",
    concurrency: 50,
    glossaryPath: "./glossary.json",
    linkedContentPatterns: [],
    hrefPatterns: ["*.href"],
  };

  fs.writeFileSync(
    configPath,
    JSON.stringify(defaultContent, null, 2) + "\n",
    "utf-8",
  );

  return configPath;
}

/**
 * Create an empty glossary.json file.
 */
export function createDefaultGlossary(dir?: string): string {
  const targetDir = dir || process.cwd();
  const glossaryPath = path.join(targetDir, "glossary.json");

  const defaultGlossary = {
    _description:
      "Protected terms that should not be directly translated. Managed by transl8.",
    protectedTerms: [],
  };

  fs.writeFileSync(
    glossaryPath,
    JSON.stringify(defaultGlossary, null, 2) + "\n",
    "utf-8",
  );

  return glossaryPath;
}

# transl8-ai

AI-powered CLI for managing i18n JSON translation files using OpenAI.

Analyze, translate, sync, and maintain your app's translation files from the command line.

![Demo](demo/demo.gif)

## Quick Start

```bash
npx transl8-ai init
export OPENAI_API_KEY=sk-...
npx transl8-ai analyze
npx transl8-ai translate de
```

## Installation

```bash
# Global install
npm install -g transl8-ai

# Or use with npx (no install)
npx transl8-ai <command>

# Or as a dev dependency
npm install -D transl8-ai
```

## Commands

### `transl8 init`

Initialize transl8 in the current directory. Creates `.transl8rc.json` and an empty `glossary.json`.

### `transl8 analyze`

Analyze all translation files for discrepancies against the source language.

```bash
transl8 analyze          # Pretty-printed report
transl8 analyze --json   # JSON output
```

### `transl8 compare <language>`

Compare a specific language file against the source.

```bash
transl8 compare de
transl8 compare de --json
```

### `transl8 create <language>`

Create a complete translation file for a new language using AI.

```bash
transl8 create de              # Create German translation
transl8 create de --force      # Overwrite existing file
transl8 create de --dry-run    # Preview without creating
transl8 create de --verbose    # Show detailed output
```

### `transl8 translate <language>`

Translate only the missing keys in an existing language file.

```bash
transl8 translate de
transl8 translate de --dry-run
transl8 translate de --verbose
```

### `transl8 sync <language>`

Check sync status and optionally translate missing keys.

```bash
transl8 sync de                # Show missing keys (read-only)
transl8 sync de --translate    # Translate and save missing keys
transl8 sync de --verbose      # Show all missing keys
```

### `transl8 prune <language>`

Remove extra keys from a language file that don't exist in the source.

```bash
transl8 prune de
transl8 prune de --dry-run
```

### `transl8 fix-quotes <language>`

Fix extra quotes added by the LLM during translation.

```bash
transl8 fix-quotes de
transl8 fix-quotes de --dry-run
```

### `transl8 list-languages`

List all 24 supported languages.

```bash
transl8 list-languages
transl8 list-languages --json
```

### `transl8 list-files`

List all translation files in the messages directory.

```bash
transl8 list-files
transl8 list-files --json
```

### `transl8 export-report [outputFile]`

Export a full discrepancy report as JSON.

```bash
transl8 export-report                  # Print to stdout
transl8 export-report report.json      # Save to file
```

### `transl8 glossary list|add|remove`

Manage protected terms that should not be translated (brand names, etc.).

```bash
transl8 glossary list
transl8 glossary add "MyBrand" "Product name, keep in all languages"
transl8 glossary add "Tokens" "In-app currency" --translation de:Tokens
transl8 glossary remove "MyBrand"
```

## Configuration

### `.transl8rc.json`

Create with `transl8 init` or manually. The CLI searches upward from the current directory.

```json
{
  "messagesDir": "./messages",
  "sourceLanguage": "en",
  "model": "gpt-5.2",
  "concurrency": 50,
  "glossaryPath": "./glossary.json",
  "linkedContentPatterns": [],
  "hrefPatterns": ["*.href"]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `messagesDir` | `./messages` | Path to your i18n JSON files |
| `sourceLanguage` | `en` | Source language code |
| `model` | `gpt-5.2` | OpenAI model for translations |
| `concurrency` | `50` | Max concurrent API requests |
| `glossaryPath` | `./glossary.json` | Path to glossary file |
| `linkedContentPatterns` | `[]` | Patterns for linked content (see below) |
| `hrefPatterns` | `["*.href"]` | Key patterns to copy without translating |

### Linked Content Patterns

If your translations contain description text with embedded links, configure patterns so the CLI can translate descriptions and link text together:

```json
{
  "linkedContentPatterns": [
    {
      "descriptionPattern": "*.description",
      "linksKey": "links",
      "linkTextField": "text",
      "linkHrefField": "href"
    }
  ]
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | **Required** for translation commands |
| `TRANSL8_MODEL` | Override the model (higher priority than config file) |
| `TRANSL8_CONCURRENCY` | Override concurrency (higher priority than config file) |

### CLI Flags

Flags override all other config sources:

```bash
transl8 analyze --messages ./locales
transl8 translate de --model gpt-4o --concurrency 100
```

### Config Priority

Values are merged in this order (last wins):

1. Built-in defaults
2. `.transl8rc.json`
3. Environment variables (`TRANSL8_MODEL`, `TRANSL8_CONCURRENCY`)
4. CLI flags (`--model`, `--concurrency`, `--messages`)

## Glossary

The glossary protects specific terms from being translated or provides approved translations per language.

```json
{
  "protectedTerms": [
    {
      "term": "MyApp",
      "description": "Product name, keep unchanged",
      "caseSensitive": true,
      "translations": {}
    },
    {
      "term": "Credits",
      "description": "In-app currency",
      "caseSensitive": true,
      "translations": {
        "de": "Credits",
        "ja": "クレジット"
      }
    }
  ]
}
```

## Supported Languages

| Code | Language | Native Name |
|------|----------|-------------|
| en | English | English |
| de | German | Deutsch |
| es | Spanish | Español |
| fr | French | Français |
| it | Italian | Italiano |
| pt | Portuguese | Português |
| ja | Japanese | 日本語 |
| ko | Korean | 한국어 |
| zh | Chinese (Simplified) | 简体中文 |
| zh-TW | Chinese (Traditional) | 繁體中文 |
| ru | Russian | Русский |
| ar | Arabic | العربية |
| hi | Hindi | हिन्दी |
| nl | Dutch | Nederlands |
| pl | Polish | Polski |
| tr | Turkish | Türkçe |
| vi | Vietnamese | Tiếng Việt |
| th | Thai | ไทย |
| sv | Swedish | Svenska |
| da | Danish | Dansk |
| fi | Finnish | Suomi |
| no | Norwegian | Norsk |
| cs | Czech | Čeština |
| uk | Ukrainian | Українська |

## License

MIT

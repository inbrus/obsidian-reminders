import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      // Product/brand names the sentence-case rule would otherwise lowercase.
      "obsidianmd/ui/sentence-case": [
        "warn",
        { ignoreWords: ["Taskgregator", "Tasks"] },
      ],
    },
  },
]);

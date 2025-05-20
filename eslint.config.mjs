// eslint.config.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import globals from "globals";
import tseslint from "typescript-eslint"; // <--- 关键导入
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default tseslint.config(
  // <--- 使用 tseslint.config 辅助函数
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      "logs/",
      "prisma/migrations/**/*",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
      parser: tseslint.parser, // <--- tseslint.parser
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin, // <--- tseslint.plugin
    },
    rules: {
      ...tseslint.configs.eslintRecommended.rules, // <--- 从 tseslint 获取推荐规则
      ...tseslint.configs.recommendedTypeChecked.rules, // <--- 或 .recommended.rules

      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
      // Prettier 规则由 eslintPluginPrettierRecommended 处理
    },
  },
  eslintPluginPrettierRecommended,
);

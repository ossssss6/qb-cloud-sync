// .eslintrc.js
module.exports = {
  parser: "@typescript-eslint/parser", // 指定 ESLint 解析器
  parserOptions: {
    ecmaVersion: 2020, // 允许解析现代 ECMAScript 特性
    sourceType: "module", // 允许使用 imports
    project: "./tsconfig.json", // 重要：让 ESLint 可以获取 tsconfig 中的类型信息
  },
  extends: [
    "eslint:recommended", // ESLint 推荐的基本规则
    "plugin:@typescript-eslint/recommended", // TypeScript ESLint 插件的推荐规则
    "plugin:prettier/recommended", // 启用 eslint-plugin-prettier 并将 prettier错误显示为ESLint错误。确保这个在最后。
  ],
  plugins: [
    "@typescript-eslint", // TypeScript ESLint 插件
    "prettier", // Prettier 插件
  ],
  env: {
    node: true, // 启用 Node.js 全局变量和 Node.js 作用域
    es6: true, // 启用 ES6+ 全局变量 (除了模块)
  },
  rules: {
    // 在这里可以自定义或覆盖规则
    // 例如：
    "prettier/prettier": "warn", // Prettier 问题仅提示警告，不强制错误中断（可选）
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }], // 未使用的变量提示警告，忽略下划线开头的参数
    "@typescript-eslint/no-explicit-any": "warn", // 对 any 类型提示警告，而不是错误
    "no-console": process.env.NODE_ENV === "production" ? "warn" : "off", // 生产环境禁止 console，开发环境允许
    // 可以根据你的偏好添加更多规则
    // "no-empty-function": "off", // 如果你经常写空函数作为占位符
    // "@typescript-eslint/no-empty-function": "off",
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "coverage/",
    "logs/",
    ".eslintrc.js", // ESLint 配置文件本身通常不被 lint
    "prisma/migrations/**/*", // 通常不需要 lint 自动生成的 migration 文件
  ],
};

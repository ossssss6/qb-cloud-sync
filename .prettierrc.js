// .prettierrc.js
module.exports = {
  printWidth: 100, // 每行代码长度（默认80）
  tabWidth: 2, // 每个tab相当于多少个空格（默认2）
  useTabs: false, // 是否使用tab进行缩进（默认false）
  semi: true, // 声明语句末尾是否添加分号（默认true）
  singleQuote: true, // 是否使用单引号（默认false）
  quoteProps: "as-needed", // 对象属性的引号使用（默认as-needed）
  jsxSingleQuote: false, // JSX中是否使用单引号（默认false）
  trailingComma: "es5", // 多行使用拖尾逗号（默认es5）
  bracketSpacing: true, // 对象字面量的大括号间是否有空格（默认true）
  bracketSameLine: false, // 多行 JSX 中的 > 是否单独一行（默认false）
  arrowParens: "always", // 箭头函数参数是否总是用圆括号包裹（默认always）
  rangeStart: 0, // 每个文件格式化的范围是文件的全部内容
  rangeEnd: Infinity,
  requirePragma: false, // 是否在文件头部添加特殊注释才会格式化（默认false）
  insertPragma: false, // 是否在文件头部插入@format标识（默认false）
  proseWrap: "preserve", // 是否要换行（默认preserve）
  htmlWhitespaceSensitivity: "css", // HTML空白敏感度（默认css）
  vueIndentScriptAndStyle: false, // Vue文件脚本和样式标签内是否缩进（默认false）
  endOfLine: "lf", // 换行符使用 lf (Unix) 或 crlf (Windows)（默认lf）
  embeddedLanguageFormatting: "auto", // 是否格式化嵌入式代码（默认auto）
  singleAttributePerLine: false, // 在 HTML, Vue 和 JSX 中每个属性占一行（默认false）
};

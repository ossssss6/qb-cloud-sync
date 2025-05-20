// src/main.ts
function greet(name: string): void {
  console.log(`Hello, ${name}! Welcome to qb-cloud-sync.`); // <--- 缩进错误
}

greet('Developer');

async function main() {
  console.log('qb-cloud-sync is starting...');
}

main().catch((error) => {
  console.error('Unhandled error in main function:', error);
  process.exit(1);
});

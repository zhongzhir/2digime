"use strict";
/**
 * 在 Electron 进程内打印 runtime 版本。
 * 本文件是唯一合法的版本探测入口；禁止把 console.log 表达式当作应用路径传给 Electron。
 */
if (!process.versions.electron) {
  console.error("not_electron");
  process.exit(2);
}
process.stdout.write(`${process.versions.electron}\n`);
process.exit(0);

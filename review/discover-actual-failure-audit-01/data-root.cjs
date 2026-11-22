'use strict';
// 审计运行产物（Owner 数据副本、每次运行的 userData / trace / 截图）只放在仓库外：
// 放在仓库里会进入产品自身的源码结构扫描（2000 文件预算），也有把 Owner 数据误提交的风险。
const path = require('node:path');

module.exports =
  process.env.AUDIT_DATA_ROOT ||
  path.resolve(__dirname, '..', '..', '..', '_dm-audit-data', 'discover-actual-failure-audit-01');

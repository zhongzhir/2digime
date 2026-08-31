import { writeZip } from '../zip';
import { buildDocxFromMarkdown, buildPptxFromMarkdown } from '../export';
import { buildChineseTextPdf, buildMinimalPdf } from './helpers';

export const FIXTURE_NAME = '张元林';
export const FIXTURE_RESUME_MD = [
  '个人简历',
  '',
  '姓名：张元林',
  '职位：产品经理',
  '',
  '工作经历：2019-2024 任职于示例科技公司，负责本地优先产品。',
  '',
  '教育经历：示例大学 本科',
].join('\n');

/** 程序生成、无隐私的简历 DOCX：含段落和表格。 */
export function buildFixtureResumeDocx(): Buffer {
  const table =
    `<w:tbl><w:tr>` +
    `<w:tc><w:p><w:r><w:t>学校</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:p><w:r><w:t>示例大学</w:t></w:r></w:p></w:tc>` +
    `</w:tr><w:tr>` +
    `<w:tc><w:p><w:r><w:t>姓名</w:t></w:r></w:p></w:tc>` +
    `<w:tc><w:p><w:r><w:t>${FIXTURE_NAME}</w:t></w:r></w:p></w:tc>` +
    `</w:tr></w:tbl>`;
  const paras = FIXTURE_RESUME_MD.split('\n')
    .filter(Boolean)
    .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
    .join('');
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paras}${table}</w:body></w:document>`;
  return writeZip([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `</Types>`,
        'utf8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
          `</Relationships>`,
        'utf8',
      ),
    },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ]);
}

export function buildFixtureResumePdf(): Buffer {
  return buildMinimalPdf('Resume Name: ZhangYuanlin Education: Example University');
}

/** 无隐私中文 PDF fixture：正文含「张元林」。 */
export function buildFixtureResumePdfZh(): Buffer {
  return buildChineseTextPdf(
    `个人简历 姓名：${FIXTURE_NAME} 职位：产品经理 教育经历：示例大学`,
  );
}

export function buildAerospaceBioLearningPlanMarkdown(): string {
  return [
    '# 航天工程交叉生物学学习计划',
    '',
    '面向一年内建立航天生命科学基础，并完成可验证的小课题。',
    '',
    '## 学习路径',
    '',
    '- 先补齐轨道力学与生命系统基础',
    '- 再进入辐射生物学与密闭生态',
    '- 然后用实验日志把知识变成证据',
    '- 最后形成可对外讲解的综合报告',
    '',
    '## 十二周时间线',
    '',
    '- 第1-3周：轨道、推进与生命保障入门',
    '- 第4-6周：细胞应激、辐射剂量与防护',
    '- 第7-9周：微重力生理与密闭生态循环',
    '- 第10-12周：课题实验、答辩与修订',
    '',
    '## 航天与生物学对照',
    '',
    '- 航天侧：轨道、推进、热控、生命保障系统',
    '- 生物侧：细胞、生理、辐射、生态循环',
    '- 交叉点：乘员健康、闭环生态、在轨实验',
    '- 产出：实验记录、风险清单、讲解稿',
    '',
    '## 每周关键数字',
    '',
    '- 6 小时课堂与精读',
    '- 4 小时实验或仿真',
    '- 2 小时复盘纪要',
    '- 1 次可演示检查点',
    '',
    '## 阶段流程',
    '',
    '- 输入：教材、公开论文、任务手册',
    '- 转化：笔记、公式卡和实验步骤',
    '- 验证：小实验或仿真复现',
    '- 输出：纪要、图表、讲解',
    '',
    '## 结论与下一步',
    '',
    '- 按时间线完成三个检查点',
    '- 保留实验原始记录',
    '- 用对照页向他人讲清交叉点',
  ].join('\n');
}

export function buildFixturePptMarkdown(): string {
  return [
    '# 产品进展汇报',
    '',
    '面向例会的基础版式材料，不含真实隐私。',
    '',
    '## 进展',
    '',
    '- 完成资料读取闭环',
    '- 完成姓名跨会话',
    '- 完成修订排队',
    '- 完成导出隔离',
    '',
    '## 结论',
    '',
    '- 现场用 WPS 打开检查中文与换行',
    '- 超长内容已拆页',
  ].join('\n');
}

export function buildOwnerAcceptanceFiles(): { pptx: Buffer; docx: Buffer } {
  const md = buildFixturePptMarkdown();
  return {
    pptx: buildPptxFromMarkdown(md),
    docx: buildDocxFromMarkdown(md),
  };
}

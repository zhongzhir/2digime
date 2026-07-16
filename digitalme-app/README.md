# Digital Me App v0.1

本地桌面应用：加载个人 Digital Me Package，以 AI 为底座，完成"像我"的任务。

## 当前能力（v0.1）

- 加载工作区中的 `digital-me-package/`（人格、风格、判断框架、记忆、系统提示词）；
- 将 Package 组装为"像我"的系统提示词；
- **任务工作台**：与自己的 Digital Me 对话，产出"像我"的内容；
- **蒸馏 Builder**：导入新素材（.docx / .txt / .md）→ 自动提取正文 → 分块调用模型蒸馏 → 聚合去重 → 审阅后确认写入 Package（记忆、判断框架、风格与人格观察，均登记来源）；
- 模型网关：支持任意兼容 OpenAI Chat Completions 的服务（OpenAI / DeepSeek / 本地模型等）；
- 设置本地保存（API Key 只存本机 userData，不进云盘）。

## 尚未实现（后续里程碑）

- 素材向量化 + 原文示例检索（提升"像我"还原度）
- 蒸馏结果的逐条勾选写入 / 冲突合并
- 数据采集映射循环（数字孪生）
- 反馈规则引擎 + 审计账本
- MCP 能力安装

## Builder 使用说明

Builder 有两种采集方式：

### A. 导入素材（适合已有文章/文档者）

1. 左侧切到"蒸馏 Builder" → "导入素材"；
2. 选择素材文件（.docx / .txt / .md）；
3. 点"开始蒸馏"，逐段处理并显示进度；
4. 审阅蒸馏出的风格观察、人格观察、判断框架、记忆；
5. 点"确认写入 Package"，内容追加到对应文件并登记来源。

### B. 问卷采集（适合没有现成素材者）

1. 切到"问卷采集"；
2. 填写三层问卷（大五自评 / 情境判断 / 开放访谈，可只填部分，情境题请重点写理由）；
3. 点"根据问卷开始蒸馏"，之后与导入素材一样审阅并写入。

问卷题库见 `src/intake-questions.json`，完整方法论见工作区的 `digitalme_intake_questionnaire.md`。

> 提示：整本大部头会切成数十段、产生数十次模型调用；Builder 更适合单篇文章、访谈、笔记、问卷等中小素材。风格/人格观察以"增量蒸馏观察"区块追加到 persona.md / style-guide.md，便于后续人工整理提炼。

## 运行方式

> 重要：本项目位于 WPS 云盘同步目录下。`node_modules` 体积较大，建议安装/运行时**临时暂停 WPS 同步**，或把本 `digitalme-app` 目录加入云盘同步排除列表，避免同步冲突与文件锁。

```bash
cd digitalme-app
npm install
npm start
```

启动后点击左下角"设置"，填写模型服务地址、API Key、模型名称即可开始对话。

## 架构说明

- `src/main.js`：主进程。负责窗口、配置读写、Package 加载、模型调用（IPC）。
- `src/preload.js`：安全桥接，向渲染进程暴露有限 API。
- `src/renderer/`：界面（原生 HTML/CSS/JS，无打包器，依赖最小）。

Package 数据与应用代码分离：Package 是可迁移的个人数据核心，App 只是当前阶段的运行容器。

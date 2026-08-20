# Windows Preview — 使用说明

> 这是 **实验性 Preview**，不是 MVP、不是生产就绪。Windows x64 包未签名。

## 下载与运行

1. 从 [Releases](https://github.com/zhongzhir/2digime/releases) 下载 `DigitalMeV2-*-win-x64.zip`。
2. 解压到任意文件夹（不需要安装程序）。
3. 双击 `DigitalMeV2.exe` 打开。

> 由于未签名，Windows 或杀毒软件可能提示。请仅在你信任来源时选择继续。删除解压出的文件夹即可完成卸载，不影响其它软件。

## 第一次使用

1. 打开后到「设置」连接模型（使用你自己的 API Key）。
2. **连接之前，对话和做事不会假装已经完成**。
3. 你的密钥只保存在你这台电脑上。

## 四个板块

- **对话**：交流想法；需要时可以转为任务。
- **做事**：写下要做的事，添加文件或文件夹，开始处理后可以查看、修改和采用成果。改代码会先确认范围，结果经独立验收。
- **数字之我**：查看已确认的内容，并选择继续了解或补充资料。
- **协作（实验）**：连接另一台电脑上的数字之我，发现机会、提出意向。**目前还不能当作完整的远程交活**，也不能传送大文件、多人同时协作或对外自动承诺。

## 从源码构建（开发者）

```bash
npm install
npm run build            # tsc -> dist/
npm run smoke            # 领域层冒烟
npm run test             # 单元测试
npm run preflight:electron
npm run dev              # 编译 + 预检 + 启动 UI
npm run build:packaged   # 打 Windows x64 ZIP
```

## 已知事项

- 未签名；Windows x64；非 MVP。
- 存在少量已知失败单测（集成基线即存在，见仓库记录），不影响主路径试用。
- macOS 包尚未交付（需在 Apple 芯片 Mac 上构建）。

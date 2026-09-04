# Windows Preview — 使用说明

> 这是 **实验性 Preview**，不是 MVP、不是生产就绪。Windows x64 包未签名。

## 下载与运行

1. 从 [Releases](https://github.com/zhongzhir/2digime/releases) 下载 `兔机米-*-win-x64.zip`。
2. 解压到任意文件夹（不需要安装程序）。
3. 双击 `兔机米.exe` 打开。

> 由于未签名，Windows 或杀毒软件可能提示。请仅在你信任来源时选择继续。删除解压出的文件夹即可完成卸载，不影响其它软件。

## 第一次使用

1. 打开后到「设置」连接模型（使用你自己的 API Key）。
2. **连接之前，对话不会假装已经完成**。
3. 你的密钥只保存在你这台电脑上。

## 三个页面

- **与兔机米**：直接说话。聊天、把一件事做完、纠正对你的理解，都在这一页完成。做成的文件会出现在对话里。
- **数字之我**：查看已确认的内容，并选择继续了解或补充资料。
- **设置**：连接模型。高级连接、设备与数字之我连接、代码执行、专业能力默认折叠，日常使用不必打开。

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
- macOS 包需在 Intel Mac 上构建；本说明不把未签名、未公证、或「本机开发者绕过 Gatekeeper」当作公开试用安装通过。

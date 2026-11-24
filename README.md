简体中文 · [English](README.en.md)

# 派板（Paiban）

适用于 Codex 的 Windows 本地任务看板。把待办分配到对应的 Codex 聊天，在看板上跟进执行、查看回复并审阅结果。

[快速开始](#快速开始) · [更新](#更新) · [使用授权](LICENSE.md) · [支持开发](#支持开发)

## 能做什么

| 功能 | 用法 |
| --- | --- |
| 项目看板 | 按待执行、执行中、待审阅、已完成管理任务，可用分组、标签和优先级整理。 |
| 任务调度 | 将任务提交给匹配或指定的本机 Codex 聊天。可设置前置任务、顺序或并行范围。 |
| 结果审阅 | 在面板中查看执行状态和回复，验收后标记完成，也可以反馈并重新执行。 |
| 项目资料与总控 | 独立保存文字、链接和附件，在总控页查看本机各项目进度。 |

## 快速开始

### Windows 安装包

从 [GitHub Releases](https://github.com/lei0620/paiban/releases/latest) 下载最新的 Windows x64 安装包，并双击运行。安装完成页勾选「打开派板」。以后在 Windows 开始菜单搜索「派板」，点击应用图标即可打开，也可以右键将它固定到开始菜单。安装包包含运行组件，日常使用无需运行命令。

首次打开即可在「本地看板」记任务。即使没有 Git 或 Codex，也可以管理本机卡片。需要执行时打开已登录的 Codex。唯一的本机连接与聊天可自动核对，其他情况可用「连接 Codex」选择实例或填入聊天链接。项目目录与 GitHub 仓库在后台匹配。需要把白板显示在聊天内时，从开始菜单选择「接入 Codex 白板」。跨电脑同步可在设置中主动开启。

数据和备份默认存放在安装目录下的 `userdata` 和 `backups` 子目录。可在「设置 → 数据」更改位置。

### 源码开发

需要 Windows、Node.js 22.13 或更新版本和 PowerShell 7。源码版无需安装项目依赖。执行任务时需要已登录并运行的 Codex 桌面应用。

1. 将源码解压或克隆到本机。
2. 从源码目录启动面板。从 Codex 聊天中启动时，可沿用该聊天的 `CODEX_THREAD_ID`。

   ```powershell
   $env:PORT = '4319'
   npm.cmd start
   ```

3. 保持服务运行，打开 [本地面板](http://127.0.0.1:4319) 记录待办。连接 Codex 后可从项目列表选择已打开的本机项目。仅在需要跨电脑同步时配置自己的 GitHub 私有仓库。
4. 点击「执行」时确认目标聊天。Codex 完成本轮后，打开「待审阅」核对结果。

## 更新

打开「设置 → 更新」，点击「检测升级」查看派板官方版本。Windows 安装版发现新版后可点「一键升级」。源码开发时请先备份 `data/` 并核对本地改动，更新此仓库的源码后重启面板。

如果二次开发并维护自己的发行版，请在 [release-manifest.mjs](release-manifest.mjs) 中配置自己的发行仓库，在 [product-release.json](product-release.json) 中配置版本与发行公钥，并用同一公钥构建安装包。

## 数据与兼容性

面板服务仅监听本机回环地址。源码版的任务和附件保存在 `data/`，公开分享源码时请排除此目录。可选的跨电脑待办同步需要自行配置私有 GitHub 仓库。Codex 的聊天、登录态和审批仍由桌面应用管理。桌面接口更新后可能需要重新适配。

## 使用授权

非商业使用免费，欢迎二创和分享原版或修改版。发布时请注明「基于派板（Paiban）」，附上[原项目链接](https://github.com/lei0620/paiban)，并保留版权声明和许可。只有商业使用需要事先取得书面授权，可联系微信 `Mr_Lei0620`。详见[非商业使用许可](LICENSE.md)。

## 支持开发

如果这个工具帮到了你，欢迎给仓库点 Star、反馈问题或分享使用经验。也可以用支付宝扫码，自愿支持个人维护。赞助与商业授权分别办理。

<details>
<summary>支付宝收款码</summary>

<img src="public/support-alipay.jpg" width="240" alt="支付宝赞助收款码">

</details>

## 开发

从 [派板公开源码仓库](https://github.com/lei0620/paiban) 克隆项目，按「快速开始」运行。使用 `npm run verify` 检查源码和文档，并运行离线测试。

### 代码入口

- [server.mjs](server.mjs) 与 [panel-runner.mjs](panel-runner.mjs) 负责本地服务、启动和安全重启。
- [public/](public/) 存放原生 HTML、CSS 和 JavaScript 界面。
- [plugins/leix-panel-probe/](plugins/leix-panel-probe/) 提供 Codex 聊天白板的本机插件。

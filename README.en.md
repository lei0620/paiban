[简体中文](README.md) · English

# Paiban

A local task board for Codex on Windows. Assign tasks to the appropriate Codex chat, track execution, read replies, and review results from the panel.

[Quick start](#quick-start) · [Updates](#updates) · [License](LICENSE.md#english) · [Support development](#support-development)

## Features

| Feature | What you can do |
| --- | --- |
| Project boards | Organize tasks into To do, Running, In review, and Done. Use groups, labels, and priorities to keep work organized. |
| Task dispatch | Submit tasks to a selected or matched local Codex chat. Set dependencies, execution order, or parallel work scopes. |
| Result review | Read replies and check execution status. Approve the result or submit feedback for another run. |
| Project references and overview | Save notes, links, and attachments by project and view progress across local projects. |

## Quick start

### Windows installer

Download the Windows x64 installer from [GitHub Releases](https://github.com/lei0620/paiban/releases/latest) and double-click it. Select Open Paiban on the final setup screen. To open it later, search for 派板 in the Windows Start menu and click the app icon. You can also right-click it to pin it to Start. The installer includes the required runtimes. Everyday use requires no terminal commands.

On first launch, select Start setup and connect to the signed-in Codex desktop app using a chat link or ID. To open a board inside a Codex chat, select 接入 Codex 白板 (Connect Codex board) from the Windows Start menu and reopen Codex when prompted. Set up a private repository only if you need cross-device sync.

Data and backups are stored in the `userdata` and `backups` subdirectories of the installation folder. Change either location under Settings → Data.

### Source development

You need Windows, Node.js 22.13 or later, PowerShell 7, and a running Codex desktop app signed in to your account. The source version has no project dependencies to install.

1. Extract or clone the source locally. Open the directory and a chat in the Codex desktop app.
2. Start the panel from the source directory in that chat's execution environment. On first launch, the environment needs the actual `CODEX_THREAD_ID` of the current chat.

   ```powershell
   $env:PORT = '4319'
   npm.cmd start
   ```

3. Keep the service running and open the [local panel](http://127.0.0.1:4319). Select Start setup. Each step links to the relevant controls and includes a prompt you can paste into Codex for help. Connect Codex and set the device and controller project. Then choose a project and add a task. Set up your own private GitHub repository only if you need cross-device sync.
4. Confirm the target chat when starting a task. When Codex finishes the turn, review the result under In review.

## Updates

Open Settings → Updates and select Check for upgrades to check the official Paiban release. The installed Windows app can apply an available update in one click. For source development, back up `data/` and review local changes before updating this checkout and restarting Paiban.

If you maintain your own distribution, set your release repository in [release-manifest.mjs](release-manifest.mjs), configure the version and public signing key in [product-release.json](product-release.json), and use the same public key when building the installer.

## Data and compatibility

The service listens on the loopback interface only. The source version stores tasks and attachments in `data/`. Exclude it when sharing source code. Optional cross-device task sync requires a private GitHub repository you configure. The Codex desktop app manages its chats, sign-in, and approvals. Desktop interface changes may require an adapter update.

## License

Noncommercial use is free. You are welcome to modify the project and share original or modified versions for noncommercial purposes. When sharing, credit Paiban, link to the [original project](https://github.com/lei0620/paiban), and preserve the copyright notice and license. Only commercial use requires prior written permission. Contact the developer on WeChat at `Mr_Lei0620`. See the [Noncommercial Use License](LICENSE.md#english).

## Support development

If Paiban helps you, you can support its maintenance with an optional Alipay donation of any amount. Stars and issue reports are welcome too.

<a href="public/support-alipay.jpg"><img src="public/support-alipay.jpg" width="208" alt="Alipay donation QR code. Open the full-size image."></a>

You can reach the maintainer on WeChat at `Mr_Lei0620`. See the [license](#license) for commercial use.

## Development

Clone the [Paiban source repository](https://github.com/lei0620/paiban) and follow Quick start. Run `npm run verify` to check source and documentation and run the offline tests.

### Source layout

- [server.mjs](server.mjs) and [panel-runner.mjs](panel-runner.mjs) provide the local service, startup, and safe restart.
- [public/](public/) contains the HTML, CSS, and JavaScript interface.
- [plugins/leix-panel-probe/](plugins/leix-panel-probe/) contains the local Codex chat board plugin.

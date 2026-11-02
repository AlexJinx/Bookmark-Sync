# Bookmark Sync 隐私政策 / Privacy Policy

生效及更新日期 / Effective and updated: 2026-11-02  
适用版本 / Applies to: Bookmark Sync 0.2.1

## 中文

### 1. 扩展用途与运营方式

Bookmark Sync（书签同步）是 Microsoft Edge 的书签备份与同步扩展，由本仓库维护者提供。扩展将书签快照保存在用户自行指定的 GitHub 或 Gitee 仓库，并提供手动同步、定时推送、冲突合并、提交历史查看及本地 JSON 导入导出功能。扩展没有开发者运营的书签同步服务器。

### 2. 扩展访问和处理的信息

扩展仅为上述功能访问和处理以下信息：

- **书签内容**：标准书签目录中的书签标题、网址、文件夹名称、层级与顺序，以及为同步生成的快照版本和更新时间。书签网址或标题可能包含用户自行保存的个人或敏感内容。
- **连接和认证信息**：用户输入的 GitHub/Gitee 访问令牌、账户或组织名称、仓库名称、分支和文件路径，用于连接用户指定的仓库。
- **同步设置与状态**：推送目标、自动推送设置、最近同步时间和结果、同步基线，以及导入或合并保护所需的本地备份。
- **用户仓库的提交信息**：查看“时光胶囊”时，从配置的仓库读取提交者名称或用户名、提交时间、提交说明和历史书签快照，用于展示提交记录与书签差异。

扩展不读取浏览器浏览历史、打开的标签页、Cookie、网页正文或键盘活动；不主动访问书签所指向的网页。不提供广告、用户行为追踪或向开发者发送遥测数据的功能。

### 3. 信息保存在何处、发送给谁

连接配置（包括令牌）、同步状态及扩展内部备份保存在当前浏览器配置文件的 `chrome.storage.local` 中。该存储不是独立加密的密码保险库。

用户发起测试连接、推送、拉取、查看历史，或启用自动推送后，扩展通过 HTTPS 直接访问 `https://api.github.com/` 或 `https://gitee.com/api/`。令牌仅用于向对应平台认证；书签快照写入用户指定的仓库。令牌不会作为书签快照内容上传，但用户主动导出的配置 JSON 默认包含令牌。

开发者不接收或存储用户的书签、令牌或同步记录。开发者不出售用户数据，不将数据用于广告、授信、借贷或与书签同步无关的用途。GitHub/Gitee 按其各自政策处理发往其平台的请求；平台可能记录正常服务日志，例如请求 IP 和账户操作。仓库的可见性、协作者权限与平台设置决定谁能访问云端快照。公开仓库中的书签可能对所有人可见，建议使用私有仓库。

本地导出的书签 JSON、配置 JSON 和合并草稿保存在用户选择的下载位置，由用户决定如何保管或分享。

### 4. 用户控制、保留与删除

用户可以不开启自动推送，或随时关闭并保存自动推送设置，以停止定时上传；手动操作仅在用户发起时进行。用户可修改仓库连接配置、在平台撤销令牌，或卸载扩展以停止后续扩展同步。

浏览器中的书签和用户仓库中的快照可由用户直接查看、编辑、导出或删除。扩展的本地配置及内部备份通常保留到被新数据替换、浏览器清除相应扩展数据或扩展被卸载。扩展不设置统一的自动保留期限。卸载扩展不会自动删除用户仓库的快照、Git 提交历史或已经下载的文件；这些内容需由用户在相应位置单独管理。Git 历史中可能保留旧快照，应按仓库平台提供的方式处理历史数据。

配置导出文件默认包含访问令牌，请勿公开分享。若令牌泄露，请在对应平台撤销并重新生成。卸载或清理数据前，请先导出需要保留的书签与配置。

### 5. 权限与远程代码

- `bookmarks`：读取标准书签目录、生成快照，并在用户确认拉取或导入后写入书签。
- `storage`：保存连接配置、令牌、同步状态及本地保护备份。
- `alarms`：安排用户启用的自动推送，以及相关防抖和状态清理任务。
- `notifications`：显示同步失败、冲突或其他同步状态提醒。
- GitHub/Gitee 主机访问：连接用户配置的仓库，读写快照并读取提交历史。

可执行 JavaScript 随扩展包提供。仓库中读取的 JSON 作为数据处理，不作为远程代码执行。

### 6. 联系与政策更新

如对隐私有疑问，请通过 [项目 Issues](https://github.com/AlexJinx/Bookmark-Sync/issues) 联系维护者。请勿在公开问题中附上令牌、配置导出文件或私人书签。

如功能或数据处理方式发生变化，本文件会更新并修改顶部日期；用户可通过本仓库的文件历史查看变更。

## English

### 1. Purpose and operation

Bookmark Sync is a Microsoft Edge extension maintained through this repository. It backs up and synchronizes bookmark snapshots with a GitHub or Gitee repository chosen by the user. Features include manual synchronization, scheduled pushes, conflict merging, repository commit history, and local JSON import/export. There is no developer-operated bookmark synchronization server.

### 2. Information accessed and processed

The extension processes the following information only to provide those features:

- **Bookmark content:** bookmark titles, URLs, folder names, hierarchy and order in standard bookmark folders, plus snapshot version and update timestamps generated for synchronization. User-saved titles and URLs may themselves contain personal or sensitive content.
- **Connection and authentication information:** user-provided GitHub/Gitee access tokens, account or organization names, repository names, branches and file paths.
- **Settings and synchronization state:** push targets, automatic push settings, last synchronization results and timestamps, synchronization baselines, and local backups used to protect imports or merges.
- **Repository commit information:** when the user views history, committer names or usernames, commit timestamps and messages, and historical bookmark snapshots from the configured repository, used to display commits and bookmark changes.

The extension does not read browser browsing history, open tabs, cookies, webpage bodies or keyboard activity, and does not visit bookmarked webpages. It includes no advertising, behavior tracking or telemetry reporting to the developer.

### 3. Storage and recipients

Connection settings, including tokens, synchronization state and internal backups are stored in `chrome.storage.local` in the current browser profile. This storage is not a separately encrypted password vault.

When the user tests a connection, pushes, pulls or views history, or enables automatic pushes, the extension communicates directly over HTTPS with `https://api.github.com/` or `https://gitee.com/api/`. Tokens authenticate requests to the corresponding provider. Bookmark snapshots are written to the repository selected by the user. Tokens are not included in bookmark snapshots, but configuration JSON exported by the user includes tokens by default.

The developer does not receive or store users' bookmarks, tokens or synchronization records, sell user data, or use it for advertising, creditworthiness, lending or unrelated purposes. GitHub/Gitee process requests under their own policies and may keep normal service logs, including request IP addresses and account operations. Repository visibility, collaborators and provider settings determine who can access remote snapshots. Bookmarks in a public repository may be visible to anyone; a private repository is recommended.

Exported bookmark JSON, configuration JSON and merge drafts are saved to the user's chosen download location. The user controls their storage and sharing.

### 4. Control, retention and deletion

Users may leave automatic pushes disabled or disable and save that setting at any time to stop scheduled uploads. Manual operations occur when initiated by the user. Users can change connection settings, revoke tokens at the provider, or uninstall the extension to stop further extension synchronization.

Users can inspect, edit, export or delete their browser bookmarks and repository snapshots directly. Local extension settings and internal backups generally remain until replaced, cleared by the browser, or removed when the extension is uninstalled. The extension does not impose a universal automatic retention period. Uninstalling does not automatically delete repository snapshots, Git commit history or downloaded files; users manage those separately. Older snapshots may remain in Git history and require the repository provider's history-management procedures.

Configuration exports include access tokens by default and should not be shared publicly. Revoke and replace exposed tokens at the provider. Export any needed bookmarks and configuration before uninstalling or clearing data.

### 5. Permissions and remote code

- `bookmarks`: read standard bookmark folders, create snapshots, and write bookmarks after user-confirmed pulls or imports.
- `storage`: retain connection settings, tokens, synchronization state and local protection backups.
- `alarms`: schedule user-enabled pushes and related debounce or status cleanup tasks.
- `notifications`: display synchronization errors, conflicts or other synchronization status messages.
- GitHub/Gitee host access: read and write snapshots and retrieve commit history from the configured repositories.

Executable JavaScript is included in the extension package. JSON retrieved from a repository is treated as data, not executed as remote code.

### 6. Contact and updates

For privacy questions, contact the maintainer through [project Issues](https://github.com/AlexJinx/Bookmark-Sync/issues). Do not post tokens, configuration exports or private bookmarks in public issues.

This policy will be updated, with a revised date above, when functionality or data handling changes. Previous revisions are available in this repository's file history.

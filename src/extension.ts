import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChatPanelProvider } from './chatPanel';
import { HttpService, RequestData } from './httpService';
import { WorkspaceManager } from './workspaceManager';
import {
  COMMANDS,
  VIEWS,
  TEMP_FILE_MAX_AGE_MS,
  TEMP_FILE_CLEANUP_INTERVAL_MS,
  HTTP_SERVER_START_DELAY_MS,
  BASE_PORT_B
} from './constants';

class ExtensionStateManager {
  // 原有单 Panel 模式
  private httpService: HttpService;
  private panelProvider: ChatPanelProvider;

  // Arena 模式 - 双 Panel
  private httpServiceA?: HttpService;
  private httpServiceB?: HttpService;
  private panelProviderB?: ChatPanelProvider;

  private workspaceManager: WorkspaceManager;
  private cleanupTimer?: NodeJS.Timeout;
  private rulesStatusBarItem?: vscode.StatusBarItem;
  private panelStatusBarItem?: vscode.StatusBarItem;
  
  private arenaMode: boolean = false;

  constructor(private context: vscode.ExtensionContext) {
    const version = context.extension.packageJSON.version || '0.0.0';

    // 初始化原有单 Panel
    this.panelProvider = new ChatPanelProvider(context.extensionUri, version, 'A');
    this.httpService = new HttpService(
      context,
      (data) => this.handleRequest(data),
      () => this.panelProvider.getTimeoutMinutes(),
      'PanelA'  // instanceId 用于日志区分
    );

    // 初始化 Arena 模式双 Panel
    this.panelProviderB = new ChatPanelProvider(context.extensionUri, version, 'B');
    this.httpServiceB = new HttpService(
      context,
      (data) => this.handleRequestB(data),
      () => this.panelProviderB!.getTimeoutMinutes(),
      'PanelB'  // instanceId 用于日志区分
    );

    this.workspaceManager = new WorkspaceManager(context.extensionPath, context);
  }

  public async activate() {
    console.log('[WindsurfChatOpen] Activating extension...');

    // If disabled, ensure clean state to remove any stale files
    if (!this.workspaceManager.isEnabled()) {
      this.workspaceManager.cleanupAllWorkspaces();
    }

    this.cleanOldTempFiles();
    this.startPeriodicCleanup();

    // 注册原有单 Panel
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(VIEWS.PANEL, this.panelProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    this.panelProvider.onUserResponse((response) => {
      this.httpService.sendResponse(response, response.requestId);
    });

    // 将 WorkspaceManager 传递给 ChatPanelProvider
    this.panelProvider.setWorkspaceManager(this.workspaceManager);

    // 注册 Arena 模式双 Panel
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(VIEWS.PANEL_B, this.panelProviderB!, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );

    this.panelProviderB!.onUserResponse((response) => {
      this.httpServiceB!.sendResponse(response, response.requestId);
    });

    this.panelProviderB!.setWorkspaceManager(this.workspaceManager);

    // Register commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand(COMMANDS.FOCUS, () => {
        vscode.commands.executeCommand(COMMANDS.PANEL_FOCUS);
      }),
      vscode.commands.registerCommand(COMMANDS.FOCUS_B, () => {
        vscode.commands.executeCommand(COMMANDS.PANEL_B_FOCUS);
      }),
      vscode.commands.registerCommand(COMMANDS.SETUP, () => {
        this.workspaceManager.setup();
      }),
      vscode.commands.registerCommand(COMMANDS.TOGGLE_RULES, async () => {
        await this.toggleRulesFromStatusBar();
      })
    );

    // Listen for workspace folder changes
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        console.log('[WindsurfChatOpen] Workspace folders changed, re-running setup...');
        if (vscode.workspace.workspaceFolders?.length) {
          const portA = this.httpService.getPort();
          const portB = this.httpServiceB?.getPort();
          this.workspaceManager.setup(portA, portB);
          this.updateStatusBar();
        }
      })
    );

    // Status bar item
    this.createStatusBarItem();

    // Start HTTP servers
    setTimeout(async () => {
      // 获取工作区标识用于日志区分
      const wsName = vscode.workspace.workspaceFolders?.[0]?.name || 'unknown';

      try {
        // 启动原有单 Panel 服务
        console.log(`[WindsurfChatOpen][${wsName}] Starting PanelA HTTP service...`);
        const port = await this.httpService.start();
        console.log(`[WindsurfChatOpen][${wsName}] httpService.start() returned: ${port}`);

        if (port > 0) {
          console.log(`[WindsurfChatOpen][${wsName}] HTTP Server started on port ${port}`);
          this.panelProvider.setPort(port);
        }

        // 启动 Arena 模式双服务
        console.log(`[WindsurfChatOpen][${wsName}] Starting PanelB HTTP service...`);
        const portB = await this.httpServiceB!.startWithBasePort(BASE_PORT_B);
        console.log(`[WindsurfChatOpen][${wsName}] httpServiceB.startWithBasePort() returned: ${portB}`);

        if (portB > 0) {
          console.log(`[WindsurfChatOpen][${wsName}] Arena Mode - HTTP Server B on port ${portB}`);
          this.panelProviderB!.setPort(portB);
          this.arenaMode = true;
        }

        // 统一调用 setup，传入两个端口（如果 portB 无效则为 undefined）
        if (vscode.workspace.workspaceFolders?.length && this.workspaceManager.isEnabled()) {
          console.log(`[WindsurfChatOpen][${wsName}] Calling setup with portA=${port}, portB=${portB > 0 ? portB : 'undefined'}`);
          this.workspaceManager.setup(port, portB > 0 ? portB : undefined);
          this.updateStatusBar();
        }
      } catch (err) {
        vscode.window.showErrorMessage(`WindsurfChatOpen failed to start: ${err}`);
      }
    }, HTTP_SERVER_START_DELAY_MS);

    console.log('[WindsurfChatOpen] Extension activated');
  }

  private createStatusBarItem() {
    // 打开面板按钮（右侧更靠右，优先级更高）
    this.panelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.panelStatusBarItem.text = '$(comment-discussion) 打开Panel';
    this.panelStatusBarItem.tooltip = 'WindsurfChatOpen - 打开对话面板';
    this.panelStatusBarItem.command = COMMANDS.FOCUS;
    this.context.subscriptions.push(this.panelStatusBarItem);

    // 规则开关按钮（右侧更靠左，优先级更低）
    this.rulesStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.rulesStatusBarItem.command = COMMANDS.TOGGLE_RULES;
    this.context.subscriptions.push(this.rulesStatusBarItem);

    // 初始化状态栏
    this.updateStatusBar();
  }

  private updateStatusBar() {
    const status = this.workspaceManager.getRulesStatus();

    if (this.rulesStatusBarItem) {
      if (status.enabled) {
        this.rulesStatusBarItem.text = '$(check) ChatOpen: 开';
        this.rulesStatusBarItem.tooltip = '点击禁用ChatOpen';
        this.rulesStatusBarItem.backgroundColor = undefined;
      } else {
        this.rulesStatusBarItem.text = '$(x) ChatOpen: 关';
        this.rulesStatusBarItem.tooltip = '点击启用ChatOpen';
        this.rulesStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      }
      this.rulesStatusBarItem.show();
    }

    if (this.panelStatusBarItem) {
      if (status.enabled) {
        this.panelStatusBarItem.show();
      } else {
        this.panelStatusBarItem.hide();
      }
    }
  }

  private async toggleRulesFromStatusBar() {
    const currentStatus = this.workspaceManager.getRulesStatus();
    const enable = !currentStatus.enabled; // 切换状态
    const port = this.httpService.getPort();

    const result = await this.workspaceManager.toggleRules(enable, port);

    if (result.success) {
      vscode.window.showInformationMessage(result.message);
      this.updateStatusBar();
      // 同步状态到面板
      this.panelProvider.sendRulesStatus();
    } else {
      vscode.window.showErrorMessage(result.message);
    }
  }

  private async handleRequest(data: RequestData) {
    console.log(`[WindsurfChatOpen] Received request: ${data.requestId}`);
    if (data.timeoutMinutes === undefined) {
      data.timeoutMinutes = this.panelProvider.getTimeoutMinutes();
    }
    await this.panelProvider.showPrompt(data.prompt, data.requestId, data.toolCount, data.toolList, data.conversationId);
  }

  private async handleRequestB(data: RequestData) {
    console.log(`[WindsurfChatOpen] Arena B - Received request: ${data.requestId}`);
    if (data.timeoutMinutes === undefined) {
      data.timeoutMinutes = this.panelProviderB!.getTimeoutMinutes();
    }
    await this.panelProviderB!.showPrompt(data.prompt, data.requestId, data.toolCount, data.toolList, data.conversationId);
  }


  private startPeriodicCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanOldTempFiles();
    }, TEMP_FILE_CLEANUP_INTERVAL_MS);

    this.context.subscriptions.push({
      dispose: () => {
        if (this.cleanupTimer) {
          clearInterval(this.cleanupTimer);
        }
      }
    });
  }

  private cleanOldTempFiles() {
    const tempDir = os.tmpdir();
    const now = Date.now();
    const prefixes = ['wsc_img_', 'windsurf_chat_instruction_'];

    try {
      const files = fs.readdirSync(tempDir);
      let count = 0;
      for (const file of files) {
        if (prefixes.some(p => file.startsWith(p))) {
          const filePath = path.join(tempDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > TEMP_FILE_MAX_AGE_MS) {
              fs.unlinkSync(filePath);
              count++;
            }
          } catch (e) {
            // 忽略单个文件的错误，继续处理其他文件
          }
        }
      }
      if (count > 0) {
        console.log(`[WindsurfChatOpen] Cleaned ${count} old temp files`);
      }
    } catch (e) {
      console.error(`[WindsurfChatOpen] Failed to clean temp files: ${e}`);
    }
  }

  public deactivate() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.httpService.dispose();
    this.httpServiceA?.dispose();
    this.httpServiceB?.dispose();
    // Clean up all generated files on deactivation
    this.workspaceManager.cleanupAllWorkspaces();
    // Dispose workspace manager (watchers, polling intervals)
    this.workspaceManager.dispose();
    console.log('[WindsurfChatOpen] Extension deactivated');
  }
}

let stateManager: ExtensionStateManager | null = null;

export function activate(context: vscode.ExtensionContext) {
  stateManager = new ExtensionStateManager(context);
  stateManager.activate().catch(err => {
    console.error('[WindsurfChatOpen] Activation error:', err);
  });
}

export function deactivate() {
  stateManager?.deactivate();
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
  WEBVIEW_READY_TIMEOUT_MS,
  LONG_TEXT_THRESHOLD,
  COMMANDS,
  ERROR_MESSAGES,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_SIZE,
  PanelId,
  PANEL_LABELS
} from './constants';
import { getPanelHtml } from './panelTemplate';
import { WorkspaceManager } from './workspaceManager';
import { showDesktopNotification } from './notificationService';

export interface UserResponse {
  action: 'continue' | 'end' | 'instruction' | 'error';
  text: string;
  images: string[];
  files?: Array<{ name: string; path: string; size: number }>;
  requestId?: string;
  error?: string;
}

interface WebviewMessage {
  type: 'ready' | 'continue' | 'end' | 'submit' | 'setTimeout' | 'getWorkspaceRoot' | 'toggleRules';
  text?: string;
  images?: string[];
  files?: Array<{ name: string; path: string; size: number }>;
  requestId?: string;
  timeoutMinutes?: number;
  enable?: boolean;
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _onUserResponse = new vscode.EventEmitter<UserResponse>();
  public onUserResponse = this._onUserResponse.event;
  private _port: number = 0;
  private _viewReadyResolve?: () => void;
  private _viewReadyPromise?: Promise<void>;
  private _isWebviewReady: boolean = false;
  private _currentRequestId?: string;
  private _timeoutMinutes: number = 240; // 默认4小时
  private _workspaceManager?: WorkspaceManager;
  private _rulesStatusChangedDisposable?: vscode.Disposable;
  private _panelId?: PanelId; // Arena 模式 Panel 标识
  private _focusCommand: string; // 聚焦命令
  // 对话统计累加
  private _conversationStats = new Map<string, { totalToolCount: number; allTools: Set<string> }>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _version: string,
    panelId?: PanelId
  ) {
    this._panelId = panelId;
    this._focusCommand = panelId === 'A' ? COMMANDS.PANEL_FOCUS
      : panelId === 'B' ? COMMANDS.PANEL_B_FOCUS
        : COMMANDS.PANEL_FOCUS;
    this._resetViewReadyPromise();
  }

  public get panelId(): PanelId | undefined {
    return this._panelId;
  }

  public get panelLabel(): string {
    return this._panelId ? PANEL_LABELS[this._panelId] : 'EnhanceChatOpen';
  }

  private _resetViewReadyPromise() {
    this._isWebviewReady = false;
    this._viewReadyPromise = new Promise<void>((resolve) => {
      this._viewReadyResolve = resolve;
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    if (this._viewReadyResolve) {
      this._viewReadyResolve();
    }
    this._resetViewReadyPromise();
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = getPanelHtml(this._version, this._panelId);

    if (this._port > 0) {
      webviewView.webview.postMessage({ type: 'setPort', port: this._port });
    }

    webviewView.webview.onDidReceiveMessage((message) => this._handleWebviewMessage(message));
  }

  private _handleWebviewMessage(message: WebviewMessage) {
    const requestId = message.requestId || this._currentRequestId;
    switch (message.type) {
      case 'ready':
        this._isWebviewReady = true;
        this._viewReadyResolve?.();
        // 发送当前超时配置到前端
        this._view?.webview.postMessage({ type: 'setTimeoutMinutes', timeoutMinutes: this._timeoutMinutes });
        // 发送工作区根目录到前端
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          this._view?.webview.postMessage({ type: 'setWorkspaceRoot', workspaceRoot });
        }
        // 发送规则状态（启用/禁用）
        this.sendRulesStatus();
        break;
      case 'continue':
        this._onUserResponse.fire({ action: 'continue', text: '', images: [], requestId });
        break;
      case 'end':
        this._onUserResponse.fire({ action: 'end', text: '', images: [], requestId });
        break;
      case 'submit':
        this._handleSubmit(message.text || '', message.images || [], message.files, requestId);
        break;
      case 'setTimeout':
        if (typeof message.timeoutMinutes === 'number' && message.timeoutMinutes >= 0) {
          this._timeoutMinutes = message.timeoutMinutes;
          console.log(`[EnhanceChatOpen] Timeout set to ${this._timeoutMinutes} minutes`);
        }
        break;
      case 'getWorkspaceRoot':
        // 响应前端请求工作区路径
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          const root = folders[0].uri.fsPath;
          this._view?.webview.postMessage({ type: 'setWorkspaceRoot', workspaceRoot: root });
        }
        break;
      case 'toggleRules':
        this._handleToggleRules(message.enable ?? true);
        break;
    }
  }

  public getTimeoutMinutes(): number {
    return this._timeoutMinutes;
  }

  public setWorkspaceManager(manager: WorkspaceManager) {
    this._rulesStatusChangedDisposable?.dispose();
    this._workspaceManager = manager;

    this._rulesStatusChangedDisposable = this._workspaceManager.onRulesStatusChanged(() => {
      this.sendRulesStatus();
    });
  }

  /**
   * 发送规则状态到前端
   */
  public sendRulesStatus() {
    if (this._workspaceManager) {
      const status = this._workspaceManager.getRulesStatus();
      this._view?.webview.postMessage({ type: 'setRulesStatus', enabled: status.enabled });
    }
  }

  private async _handleToggleRules(enable: boolean) {
    if (!this._workspaceManager) {
      this._view?.webview.postMessage({
        type: 'rulesToggleResult',
        success: false,
        message: 'WorkspaceManager 未初始化'
      });
      return;
    }

    const result = await this._workspaceManager.toggleRules(enable);
    this._view?.webview.postMessage({
      type: 'rulesToggleResult',
      success: result.success,
      message: result.message
    });

    // 如果成功切换，更新前端 UI 并显示提示
    if (result.success) {
      this.sendRulesStatus();
      vscode.window.showInformationMessage(result.message);
    }
  }

  async showPrompt(prompt: string, requestId?: string, toolCount?: number, toolList?: string[], conversationId?: string) {
    this._currentRequestId = requestId;
    if (!this._view) {
      await vscode.commands.executeCommand(this._focusCommand);
      const deadline = Date.now() + WEBVIEW_READY_TIMEOUT_MS;
      while (!this._view && Date.now() < deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 50));
      }
    }

    if (!this._view) {
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.PANEL_NOT_AVAILABLE
      });
      return;
    }

    try {
      const readyPromise = this._viewReadyPromise;
      await Promise.race([
        readyPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Webview ready timeout')), WEBVIEW_READY_TIMEOUT_MS)
        )
      ]);
    } catch (e) {
      console.error(`[EnhanceChatOpen] ${e}`);
      // Webview not ready, fire error response
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.WEBVIEW_NOT_READY
      });
      return;
    }

    // 计算工具统计：取传入数字和 tool-list 长度的最大值
    const currentToolCount = Math.max(toolCount || 0, (toolList || []).length);
    const currentToolList = toolList || [];

    // 累加统计（如果有 conversationId）
    let totalToolCount = currentToolCount;
    let allToolsList = currentToolList;

    if (conversationId) {
      let stats = this._conversationStats.get(conversationId);
      if (!stats) {
        stats = { totalToolCount: 0, allTools: new Set<string>() };
        this._conversationStats.set(conversationId, stats);
      }
      stats.totalToolCount += currentToolCount;
      currentToolList.forEach(t => stats!.allTools.add(t));

      totalToolCount = stats.totalToolCount;
      allToolsList = Array.from(stats.allTools);

      console.log(`[EnhanceChatOpen] Conversation ${conversationId}: total tools = ${totalToolCount}, unique tools = ${allToolsList.length}`);
    }

    if (this._view) {
      this._view.show?.(false);
      this._view.webview.postMessage({
        type: 'showPrompt',
        prompt,
        requestId,
        startTimer: true,
        toolCount: currentToolCount,
        toolList: currentToolList,
        totalToolCount,
        allToolsList,
        conversationId: conversationId || ''
      });

      // Show desktop notification if window is not focused
      if (!vscode.window.state.focused) {
        const panelLabel = this._panelId ? PANEL_LABELS[this._panelId] : 'AI';

        // 发送 Windows 系统桌面通知
        showDesktopNotification(
          `🤖 ${panelLabel} 等待您的输入`,
          prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt
        );

        // 同时保留 VSCode 内部通知（用于窗口激活时显示）
        vscode.window.showInformationMessage(
          `🤖 ${panelLabel} 等待您的输入`,
          '查看'
        ).then(selection => {
          if (selection === '查看') {
            vscode.commands.executeCommand(this._focusCommand);
          }
        });
      }
    } else {
      console.error('[EnhanceChatOpen] Panel view not available after focus attempt');
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.PANEL_NOT_AVAILABLE
      });
    }
  }


  setPort(port: number) {
    this._port = port;
    this._view?.webview.postMessage({ type: 'setPort', port });
  }

  private _handleSubmit(text: string, images: string[], files?: Array<{ name: string; path: string; size: number }>, requestId?: string) {
    // 验证图片数量
    if (images.length > MAX_IMAGE_COUNT) {
      this._onUserResponse.fire({
        action: 'error',
        text: '',
        images: [],
        requestId,
        error: ERROR_MESSAGES.TOO_MANY_IMAGES
      });
      return;
    }

    const tempDir = os.tmpdir();
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const savedImages: string[] = [];
    const failedImages: number[] = [];
    const oversizedImages: number[] = [];

    // 处理文件路径
    let filesText = '';
    if (files && files.length > 0) {
      filesText = '\n\n用户拖拽了以下文件，请使用 read_file 工具读取：\n';
      files.forEach(file => {
        filesText += `- ${file.path} (${file.name})\n`;
      });
    }

    images.forEach((img, i) => {
      try {
        const base64Data = img.replace(/^data:image\/\w+;base64,/, '');

        // 验证图片大小
        const imageSize = Buffer.byteLength(base64Data, 'base64');
        if (imageSize > MAX_IMAGE_SIZE) {
          oversizedImages.push(i + 1);
          return;
        }

        const imgPath = path.join(tempDir, `wsc_img_${uniqueId}_${i}.png`);
        fs.writeFileSync(imgPath, base64Data, 'base64');
        savedImages.push(imgPath);
      } catch (e) {
        console.error(`[EnhanceChatOpen] ${ERROR_MESSAGES.IMAGE_SAVE_FAILED} ${i}: ${e}`);
        failedImages.push(i + 1);
      }
    });

    let warningPrefix = '';
    if (oversizedImages.length > 0) {
      warningPrefix += `[EnhanceChatOpen 警告] 第 ${oversizedImages.join(', ')} 张图片超过大小限制（5MB），已跳过\n\n`;
    }
    if (failedImages.length > 0) {
      warningPrefix += `[EnhanceChatOpen 警告] 第 ${failedImages.join(', ')} 张图片保存失败\n\n`;
    }

    if (text.length > LONG_TEXT_THRESHOLD) {
      try {
        const txtPath = path.join(tempDir, `enhance_chat_instruction_${uniqueId}.txt`);
        fs.writeFileSync(txtPath, text, 'utf-8');
        this._onUserResponse.fire({
          action: 'instruction',
          text: `${warningPrefix}[Content too long, saved to file]\n\nUser provided full instruction, please use read_file tool to read the following file:\n- ${txtPath}${filesText}`,
          images: savedImages,
          files: files,
          requestId: requestId
        });
      } catch (e) {
        console.error(`[EnhanceChatOpen] Failed to save text file: ${e}`);
        this._onUserResponse.fire({
          action: 'error',
          text: '',
          images: [],
          requestId,
          error: '保存文本文件失败，请重试'
        });
      }
    } else {
      this._onUserResponse.fire({
        action: 'instruction',
        text: warningPrefix + text + filesText,
        images: savedImages,
        files: files,
        requestId: requestId
      });
    }
  }

}


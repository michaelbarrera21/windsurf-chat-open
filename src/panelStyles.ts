/**
 * Webview 面板的 CSS 样式
 */
export function getPanelStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 12px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .disabled-overlay {
      display: none;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--vscode-editor-background);
      z-index: 100;
      justify-content: center;
      align-items: center;
    }
    .disabled-overlay.show {
      display: flex;
    }
    .disabled-content {
      text-align: center;
      padding: 24px;
    }
    .disabled-icon {
      font-size: 48px;
      font-weight: bold;
      opacity: 0.5;
      margin-bottom: 16px;
    }
    .disabled-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-foreground);
      margin-bottom: 8px;
    }
    .disabled-hint {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .main-content {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .main-content.hidden {
      display: none;
    }
    .header {
      margin-bottom: 16px;
    }
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--vscode-editor-background);
      border-radius: 4px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header h1 {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
    }
    .version {
      background: var(--vscode-badge-background);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    /* Arena 模式 Panel 标识 */
    .panel-badge {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 600;
    }
    .panel-badge-a {
      background: #4CAF50;
      color: white;
    }
    .panel-badge-b {
      background: #2196F3;
      color: white;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .prompt-area {
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 12px;
      padding: 6px 0;
      font-size: 13px;
      line-height: 1.6;
      color: var(--vscode-descriptionForeground);
    }
    #promptText {
      white-space: pre-wrap;
      word-break: break-word;
    }
    #promptText::before {
      content: '🤖 ';
    }
    .countdown {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
      margin-left: 8px;
    }
    /* 状态栏（常驻显示） */
    .status-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 10px;
      margin-bottom: 8px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      font-size: 12px;
    }
    .status-bar .tool-stats {
      color: var(--vscode-foreground);
    }
    .status-bar .tool-stats strong {
      color: var(--vscode-textLink-foreground);
    }
    .waiting-indicator {
      display: none;
      background: var(--vscode-inputValidation-infoBackground);
      border: 1px solid var(--vscode-inputValidation-infoBorder);
      border-radius: 4px;
      padding: 8px 12px;
      margin-bottom: 12px;
      animation: pulse 1.5s ease-in-out infinite;
    }
    .waiting-indicator.show {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .waiting-indicator-text {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-inputValidation-infoForeground);
    }
    /* 已发送指示器 */
    .sent-indicator {
      display: none;
      background: var(--vscode-inputValidation-warningBackground);
      border: 1px solid var(--vscode-inputValidation-warningBorder);
      border-radius: 4px;
      padding: 8px 12px;
      margin-bottom: 12px;
    }
    .sent-indicator.show {
      display: block;
    }
    .sent-header {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-inputValidation-warningForeground);
      margin-bottom: 6px;
    }
    .sent-content {
      font-size: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-input-background);
      padding: 6px 8px;
      border-radius: 4px;
      max-height: 60px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .input-area {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #inputText {
      width: 100%;
      min-height: 60px;
      padding: 8px;
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: 13px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #inputText:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    #inputText:empty:before {
      content: attr(data-placeholder);
      color: var(--vscode-input-placeholderForeground);
      opacity: 0.6;
    }
    .file-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      margin: 0 2px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      font-size: 12px;
      cursor: default;
      user-select: none;
      vertical-align: middle;
      white-space: nowrap;
    }
    .file-chip .chip-icon {
      font-size: 14px;
      line-height: 1;
    }
    .file-chip .chip-name {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-chip .chip-delete {
      margin-left: 2px;
      cursor: pointer;
      opacity: 0.7;
      font-weight: bold;
      font-size: 14px;
      line-height: 1;
      padding: 0 2px;
    }
    .file-chip .chip-delete:hover {
      opacity: 1;
      color: var(--vscode-errorForeground);
    }
    #inputText.drag-over {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-dropBackground);
    }
    .buttons {
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 12px;
      border: 1px solid var(--vscode-widget-border);
      background: transparent;
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      opacity: 0.7;
      transition: opacity 0.2s;
    }
    button:hover {
      opacity: 1;
      background: var(--vscode-list-hoverBackground);
    }
    .btn-primary {
      border-color: var(--vscode-focusBorder);
    }
    .btn-danger {
      color: var(--vscode-errorForeground);
    }
    .image-preview {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 8px;
      padding: 4px;
    }
    .image-preview .img-wrapper {
      position: relative;
      display: inline-block;
    }
    .image-preview img {
      max-width: 60px;
      max-height: 60px;
      border-radius: 4px;
      border: 1px solid var(--vscode-widget-border);
      display: block;
      cursor: pointer;
    }
    .image-preview .img-delete {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 20px;
      height: 20px;
      background: #d32f2f;
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      z-index: 10;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: bold;
      line-height: 1;
    }
    .image-preview .img-delete:hover {
      background: #b71c1c;
    }
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.9);
      z-index: 100;
      justify-content: center;
      align-items: center;
    }
    .modal.show {
      display: flex;
    }
    .modal img {
      max-width: 90%;
      max-height: 90%;
      border-radius: 8px;
    }
    .modal-close {
      position: absolute;
      top: 20px;
      right: 20px;
      color: white;
      font-size: 30px;
      cursor: pointer;
      background: none;
      border: none;
    }
    .hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .settings-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      color: var(--vscode-foreground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.1s;
      opacity: 0.7;
    }
    .settings-toggle:hover {
      background: var(--vscode-toolbar-hoverBackground);
      opacity: 1;
    }
    .settings-toggle-icon {
      transition: transform 0.2s;
      display: inline-block;
    }
    .settings-toggle.expanded .settings-toggle-icon {
      transform: rotate(45deg);
    }
    .port-display {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .connection-status {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-testing-iconPassed);
    }
    .connection-status.disconnected {
      background: var(--vscode-testing-iconFailed);
    }
    .config-bar {
      display: none;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 12px;
      padding: 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 4px;
      font-size: 12px;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
    }
    .config-bar.show {
      display: flex;
      max-height: 200px;
      opacity: 1;
    }
    .config-bar-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .config-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .config-item label {
      color: var(--vscode-descriptionForeground);
    }
    .config-item input {
      width: 80px;
      padding: 4px 8px;
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 3px;
      font-size: 12px;
    }
    .config-item input:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .config-item .hint-text {
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
    }
    .timeout-presets {
      display: flex;
      gap: 6px;
      margin-left: 8px;
    }
    .timeout-preset-btn {
      padding: 2px 8px;
      font-size: 11px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 3px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .timeout-preset-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .timeout-preset-btn:active {
      transform: translateY(1px);
    }
    .confirm-config-btn {
      padding: 4px 16px;
      margin-left: auto;
      font-size: 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 3px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .confirm-config-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .confirm-config-btn:active {
      transform: translateY(1px);
    }
    /* Toggle Switch 样式 */
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35));
      border-radius: 20px;
      transition: 0.2s;
    }
    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 2px;
      bottom: 2px;
      background-color: var(--vscode-descriptionForeground);
      border-radius: 50%;
      transition: 0.2s;
    }
    .toggle-switch input:checked + .toggle-slider {
      background-color: var(--vscode-button-background);
      border-color: var(--vscode-button-background);
    }
    .toggle-switch input:checked + .toggle-slider:before {
      transform: translateX(16px);
      background-color: var(--vscode-button-foreground);
    }
    .toggle-switch input:focus + .toggle-slider {
      box-shadow: 0 0 1px var(--vscode-focusBorder);
    }
    .rules-toggle-label {
      margin-left: 8px;
      color: var(--vscode-foreground);
      font-size: 12px;
    }
    .rules-status {
      margin-left: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.8;
    }

    /* 工具统计样式 */
    .waiting-main {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tool-stats {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .tool-count strong {
      color: var(--vscode-foreground);
    }
    .tool-list-toggle {
      cursor: pointer;
      font-size: 10px;
      opacity: 0.6;
      transition: opacity 0.2s, transform 0.2s;
    }
    .tool-list-toggle:hover {
      opacity: 1;
    }
    .tool-list-toggle.expanded {
      transform: rotate(180deg);
    }
    .tool-list-detail {
      display: none;
      margin-top: 6px;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      max-height: 100px;
      overflow-y: auto;
    }
    .tool-list-detail.show {
      display: block;
    }
    .tool-list-detail .tool-item {
      display: inline-block;
      margin: 2px 4px 2px 0;
      padding: 2px 6px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 3px;
      font-family: monospace;
    }
    /* 对话ID显示 */
    .conv-id-display {
      margin-left: 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.8;
    }
    .conv-id-display span {
      font-family: monospace;
      cursor: help;
    }
  `;
}


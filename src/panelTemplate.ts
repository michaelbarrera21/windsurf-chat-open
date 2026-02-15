import { getPanelStyles } from './panelStyles';
import { getPanelScript } from './panelScript';
import { PanelId, PANEL_LABELS } from './constants';

/**
 * 获取 webview 的 HTML 内容
 */
export function getPanelHtml(version: string = '0.0.0', panelId?: PanelId): string {
  const panelLabel = panelId ? PANEL_LABELS[panelId] : '';
  const titleText = panelId ? `ChatOpen ${panelLabel}` : 'EnhanceChat Open';
  const panelBadge = panelId ? `<span class="panel-badge panel-badge-${panelId.toLowerCase()}">${panelLabel}</span>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EnhanceChat</title>
  <style>
    ${getPanelStyles()}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-bar">
      <div class="header-left">
        <h1>${titleText}</h1>
        ${panelBadge}
        <span class="version">v${version}</span>
      </div>
      <div class="header-right">
        <button class="settings-toggle" id="settingsToggle" title="设置">
          <span class="settings-toggle-icon">⚙️</span>
        </button>
        <div class="port-display">
          <span id="portInfo">端口: --</span>
          <span class="connection-status" id="connectionStatus"></span>
        </div>
      </div>
    </div>
  </div>

  <div class="disabled-overlay" id="disabledOverlay">
    <div class="disabled-content">
      <div class="disabled-icon">II</div>
      <div class="disabled-title">ChatOpen 已禁用</div>
      <div class="disabled-hint">点击状态栏重新开启</div>
    </div>
  </div>

  <div class="main-content" id="mainContent">

  <div class="config-bar" id="configBar">
    <div class="config-bar-row">
      <div class="config-item">
        <label for="timeoutInput">超时时间:</label>
        <input type="number" id="timeoutInput" min="0" step="1" value="240" />
        <span>分钟</span>
        <span class="hint-text">(0=不限制)</span>
      </div>
      <div class="timeout-presets">
        <button class="timeout-preset-btn" data-minutes="0">不限制</button>
        <button class="timeout-preset-btn" data-minutes="30">30分钟</button>
        <button class="timeout-preset-btn" data-minutes="60">1小时</button>
        <button class="timeout-preset-btn" data-minutes="240">4小时</button>
        <button class="timeout-preset-btn" data-minutes="480">8小时</button>
      </div>
      <button id="confirmConfigBtn" class="confirm-config-btn">确定</button>
    </div>
  </div>
  <!-- 状态栏：显示工具调用统计（常驻） -->
  <div class="status-bar" id="statusBar">
    <span class="tool-stats">🔧 本轮 <strong id="toolCount">0</strong> | 累计 <strong id="totalToolCount">0</strong></span>
    <span class="conv-id-display" title="对话ID">💬 <span id="conversationId">-</span></span>
    <span class="tool-list-toggle" id="toolListToggle" title="点击查看详情">▼</span>
    <div class="tool-list-detail" id="toolListDetail"></div>
  </div>

  <!-- 等待指示器：AI 等待输入 -->
  <div class="waiting-indicator" id="waitingIndicator">
    <span class="waiting-indicator-text">✨ ${panelId ? panelLabel : 'AI'} 等待你的输入...</span>
    <span id="countdown" class="countdown"></span>
  </div>

  <!-- 已发送指示器：显示用户发送的内容 -->
  <div class="sent-indicator" id="sentIndicator">
    <div class="sent-header">📤 已发送给 ${panelId ? panelLabel : 'AI'}，正在处理中...</div>
    <div class="sent-content" id="sentContent"></div>
  </div>
  
  <div class="prompt-area">
    <div id="promptText">等待 AI 输出...</div>
  </div>
  
  <div class="input-area">
    <div id="inputText" contenteditable="true" data-placeholder="输入反馈或指令...支持拖拽图片、文本文件和文件夹"></div>
    <div class="image-preview" id="imagePreview"></div>
    <div class="buttons">
      <button class="btn-primary" id="btnSubmit">提交 (Ctrl+Enter)</button>
      <button class="btn-danger" id="btnEnd">结束对话</button>
    </div>
    <div class="hint">空提交=继续 | Ctrl+Enter 提交 | Esc 结束</div>
  </div>
  
  </div>

  <div class="modal" id="imageModal">
    <button class="modal-close" id="modalClose">×</button>
    <img id="modalImage" src="" alt="preview">
  </div>

  <script>
    ${getPanelScript()}
  </script>
</body>
</html>`;
}


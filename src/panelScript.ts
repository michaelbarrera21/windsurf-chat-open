/**
 * Webview 面板的 JavaScript 脚本
 */
export function getPanelScript(): string {
  return `
    const vscode = acquireVsCodeApi();
    const inputText = document.getElementById('inputText');
    const promptText = document.getElementById('promptText');
    const countdown = document.getElementById('countdown');
    const imagePreview = document.getElementById('imagePreview');
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const waitingIndicator = document.getElementById('waitingIndicator');
    const timeoutInput = document.getElementById('timeoutInput');
    const connectionStatus = document.getElementById('connectionStatus');
    let images = [];
    let currentRequestId = '';
    let currentPort = 0;
    let workspaceRoot = ''; // 工作区根目录

    const MAX_IMAGE_COUNT = 10;
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
    let timeoutMinutes = 240; // 默认4小时
    let fileChipIdCounter = 0; // 用于生成唯一的 file-chip ID

    // ============ 工具函数 ============

    /**
     * 将 file:// URI 转换为本地文件路径
     */
    function parseFileUri(uri) {
      let path = uri.trim();

      if (path.startsWith('file:///')) {
        path = path.substring('file:///'.length);
        // Unix 路径需要加回 /
        if (!/^[a-zA-Z]:/.test(path)) {
          path = '/' + path;
        }
      } else if (path.startsWith('file://')) {
        path = path.substring('file://'.length);
      }

      return decodeURIComponent(path);
    }

    /**
     * 从路径中提取文件名
     */
    function getFileName(path) {
      const parts = path.split(/[\\\\\/]/);
      return parts[parts.length - 1] || '';
    }

    /**
     * 转换为相对路径
     */
    function toRelativePath(absolutePath, workspaceRoot) {
      if (!workspaceRoot || !absolutePath.startsWith(workspaceRoot)) {
        return absolutePath;
      }

      let relativePath = absolutePath.substring(workspaceRoot.length);

      // 移除开头的路径分隔符
      relativePath = relativePath.replace(/^[\\\\\/]+/, '');

      // 统一使用正斜杠
      return relativePath.split('\\\\').join('/');
    }

    // 支持的文本文件扩展名
    const TEXT_FILE_EXTENSIONS = [
      '.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.toml',
      '.js', '.ts', '.jsx', '.tsx', '.vue', '.html', '.css', '.scss', '.less',
      '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php',
      '.rb', '.swift', '.kt', '.scala', '.sh', '.bash', '.zsh', '.fish',
      '.sql', '.graphql', '.proto', '.thrift',
      '.log', '.csv', '.ini', '.conf', '.config', '.env',
      '.gitignore', '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc'
    ];

    // 设置展开/收起
    const settingsToggle = document.getElementById('settingsToggle');
    const configBar = document.getElementById('configBar');
    settingsToggle.addEventListener('click', () => {
      settingsToggle.classList.toggle('expanded');
      configBar.classList.toggle('show');
    });

    // 快捷设置按钮（仅更新输入框，不立即保存）
    document.querySelectorAll('.timeout-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const minutes = parseInt(btn.getAttribute('data-minutes'));
        timeoutInput.value = minutes;
      });
    });

    // 确定按钮：保存配置并收起配置栏
    document.getElementById('confirmConfigBtn').addEventListener('click', () => {
      const value = parseInt(timeoutInput.value);
      if (!isNaN(value) && value >= 0) {
        timeoutMinutes = value;
        vscode.postMessage({ type: 'setTimeout', timeoutMinutes: value });
        updateCountdownForNewTimeout();
        // 收起配置栏
        settingsToggle.classList.remove('expanded');
        configBar.classList.remove('show');
      }
    });

    document.getElementById('btnSubmit').onclick = submit;
    document.getElementById('btnEnd').onclick = () => {
      waitingIndicator.classList.remove('show');
      vscode.postMessage({ type: 'end', requestId: currentRequestId });
    };
    document.getElementById('modalClose').onclick = closeModal;
    imageModal.onclick = (e) => { if (e.target === imageModal) closeModal(); };

    function showModal(src) {
      modalImage.src = src;
      imageModal.classList.add('show');
    }
    function closeModal() {
      imageModal.classList.remove('show');
    }

    function submit() {
      waitingIndicator.classList.remove('show');
      const sentIndicator = document.getElementById('sentIndicator');
      const sentContent = document.getElementById('sentContent');

      // 从 contenteditable 中提取文本和文件路径
      let text = getTextWithFilePaths();
      const validImages = images.filter(img => img !== null);

      if (text || validImages.length > 0) {
        // 显示发送内容
        if (sentIndicator && sentContent) {
          let displayText = text || '';
          const charCount = displayText.length;
          
          // 截断长文本
          const MAX_DISPLAY_CHARS = 100;
          if (displayText.length > MAX_DISPLAY_CHARS) {
            displayText = displayText.substring(0, MAX_DISPLAY_CHARS) + '...';
          }
          
          if (validImages.length > 0) {
            displayText += (displayText ? '\\n' : '') + '[+ ' + validImages.length + ' 张图片]';
          }
          
          // 如果原文较长，显示字符数
          if (charCount > MAX_DISPLAY_CHARS) {
            displayText += ' (' + charCount + ' 字符)';
          }
          
          sentContent.textContent = displayText || '[继续]';
          sentIndicator.classList.add('show');
        }
        
        vscode.postMessage({
          type: 'submit',
          text,
          images: validImages,
          requestId: currentRequestId
        });
        inputText.innerHTML = '';
        images = [];
        imagePreview.innerHTML = '';
      } else {
        // 空提交 = 继续
        if (sentIndicator && sentContent) {
          sentContent.textContent = '[继续]';
          sentIndicator.classList.add('show');
        }
        vscode.postMessage({ type: 'continue', requestId: currentRequestId });
      }
    }

    // 从 contenteditable 中提取文本，将 file-chip 替换为相对路径
    function getTextWithFilePaths() {
      const clonedNode = inputText.cloneNode(true);
      const fileChips = clonedNode.querySelectorAll('.file-chip');

      fileChips.forEach(chip => {
        let path = chip.getAttribute('data-path') || '';
        
        // 转换为相对路径
        if (workspaceRoot && path.startsWith(workspaceRoot)) {
          path = path.substring(workspaceRoot.length);
          // 移除开头的路径分隔符
          while (path.startsWith('\\\\') || path.startsWith('/')) {
            path = path.substring(1);
          }
        }
        
        // 统一使用正斜杠
        path = path.replace(/\\\\/g, '/');
        
        const textNode = document.createTextNode(path || chip.textContent);
        chip.parentNode.replaceChild(textNode, chip);
      });

      return clonedNode.textContent.trim();
    }

    // 获取纯文本内容（用于判断是否为空）
    function getPlainText() {
      return inputText.textContent.trim();
    }

    inputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        waitingIndicator.classList.remove('show');
        vscode.postMessage({ type: 'end', requestId: currentRequestId });
      }
    });

    inputText.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      
      // 先检查是否有图片
      let hasImage = false;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          hasImage = true;
          e.preventDefault();
          const file = item.getAsFile();
          if (file) addImage(file);
        }
      }
      
      // 如果没有图片，则拦截并以纯文本粘贴（过滤样式）
      if (!hasImage) {
        const text = e.clipboardData?.getData('text/plain');
        if (text) {
          e.preventDefault();
          // 使用 Selection API 插入纯文本，避免 execCommand 递归问题
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            // 将光标移到插入文本的末尾
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    });

    // 拖拽文件/文件夹处理
    inputText.addEventListener('drop', (e) => {
      console.log('[Drop Debug] Drop event triggered');
      e.preventDefault();
      inputText.classList.remove('drag-over');

      // 保存拖放位置的坐标
      const dropX = e.clientX;
      const dropY = e.clientY;
      console.log('[Drop Debug] Drop position:', { dropX, dropY });

      const items = e.dataTransfer?.items;
      console.log('[Drop Debug] DataTransfer items:', items ? items.length : 'null');
      
      if (!items || items.length === 0) {
        console.log('[Drop Debug] No items in dataTransfer, exiting');
        return;
      }

      // 先打印所有 items 的信息
      for (let i = 0; i < items.length; i++) {
        console.log('[Drop Debug] Item ' + i + ':', {
          kind: items[i].kind,
          type: items[i].type
        });
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // 处理图片文件
        if (item.kind === 'file') {
          const file = item.getAsFile();
          console.log('[Drop Debug] File item:', file ? { name: file.name, type: file.type } : 'null');
          if (file && file.type.startsWith('image/')) {
            addImage(file);
          }
        }

        // 处理文件/文件夹路径
        if (item.kind === 'string' && item.type === 'text/uri-list') {
          console.log('[Drop Debug] Found text/uri-list item');
          item.getAsString((uriString) => {
            console.log('[Drop Debug] URI string received:', uriString);
            if (uriString) {
              let filePath = uriString.trim();
              
              // 解析 file:// URI
              if (filePath.startsWith('file:///')) {
                // file:///d:/path/to/file (Windows) -> d:/path/to/file
                // file:///home/user/file (Unix) -> /home/user/file
                filePath = filePath.substring(8); // 移除 file:///
                
                // Unix 路径需要加回开头的 /
                if (!/^[a-zA-Z]:/.test(filePath)) {
                  filePath = '/' + filePath;
                }
              } else if (filePath.startsWith('file://')) {
                filePath = filePath.substring(7); // 移除 file://
              }
              
              // URL 解码
              filePath = decodeURIComponent(filePath);
              console.log('[Drop Debug] Parsed file path:', filePath);

              const pathParts = filePath.split(/[\\\\/]/);
              const name = pathParts.pop() || '';

              const isFolder = !name.includes('.') || name.startsWith('.');
              const isTextFile = isTextFileByName(name);
              console.log('[Drop Debug] File info:', { name, isFolder, isTextFile });

              if (isFolder || isTextFile) {
                // 使用拖放坐标插入芯片
                console.log('[Drop Debug] Calling insertFileChipAtPosition...');
                insertFileChipAtPosition(name, filePath, isFolder, dropX, dropY);
              } else {
                console.log('[Drop Debug] File type not supported, skipping');
              }
            } else {
              console.log('[Drop Debug] URI string is empty');
            }
          });
        }
      }
    });

    inputText.addEventListener('dragover', (e) => {
      e.preventDefault();
      inputText.classList.add('drag-over');
    });

    inputText.addEventListener('dragleave', (e) => {
      inputText.classList.remove('drag-over');
    });

    // 在指定位置插入文件芯片
    function insertFileChipAtPosition(name, path, isFolder, x, y) {
      console.log('[Drop Debug] insertFileChipAtPosition called:', { name, path, isFolder, x, y });
      
      // 获取 selection 对象（无论如何都需要）
      const selection = window.getSelection();
      console.log('[Drop Debug] Current selection:', { 
        rangeCount: selection ? selection.rangeCount : 'null',
        isCollapsed: selection ? selection.isCollapsed : 'null'
      });
      
      // 根据鼠标坐标确定插入位置
      let range;
      let rangeSource = 'unknown';
      
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(x, y);
        rangeSource = 'caretRangeFromPoint';
        console.log('[Drop Debug] caretRangeFromPoint result:', range ? {
          startContainer: range.startContainer.nodeName,
          startOffset: range.startOffset,
          endContainer: range.endContainer.nodeName,
          endOffset: range.endOffset
        } : 'null');
      } else if (document.caretPositionFromPoint) {
        const position = document.caretPositionFromPoint(x, y);
        console.log('[Drop Debug] caretPositionFromPoint result:', position);
        if (position) {
          range = document.createRange();
          range.setStart(position.offsetNode, position.offset);
          rangeSource = 'caretPositionFromPoint';
        }
      }
      
      // 检查 range 是否在 inputText 内部
      if (range) {
        const rangeContainer = range.startContainer;
        const isInInputText = inputText.contains(rangeContainer) || inputText === rangeContainer;
        console.log('[Drop Debug] Range is in inputText:', isInInputText, 'rangeSource:', rangeSource);
        
        if (!isInInputText) {
          console.log('[Drop Debug] Range is outside inputText, will use fallback');
          range = null;
        }
      }
      
      if (!range) {
        // 如果无法获取位置，使用当前光标位置或插入到末尾
        console.log('[Drop Debug] No valid range from point, checking selection...');
        if (selection && selection.rangeCount > 0) {
          const selRange = selection.getRangeAt(0);
          const isSelInInput = inputText.contains(selRange.startContainer) || inputText === selRange.startContainer;
          console.log('[Drop Debug] Selection range in inputText:', isSelInInput);
          if (isSelInInput) {
            range = selRange;
            rangeSource = 'selection';
          }
        }
        
        // 如果仍然没有有效的 range，创建一个在 inputText 末尾的 range
        if (!range) {
          console.log('[Drop Debug] Creating range at end of inputText');
          range = document.createRange();
          range.selectNodeContents(inputText);
          range.collapse(false); // 折叠到末尾
          rangeSource = 'endOfInput';
        }
      }
      
      console.log('[Drop Debug] Final range source:', rangeSource);

      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.contentEditable = 'false';
      chip.setAttribute('data-path', path);
      chip.setAttribute('data-id', 'chip-' + (fileChipIdCounter++));

      const icon = document.createElement('span');
      icon.className = 'chip-icon';
      icon.textContent = isFolder ? '📁' : '📄';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'chip-name';
      nameSpan.textContent = name;
      nameSpan.title = path;

      const deleteBtn = document.createElement('span');
      deleteBtn.className = 'chip-delete';
      deleteBtn.textContent = '×';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        chip.remove();
      };

      chip.appendChild(icon);
      chip.appendChild(nameSpan);
      chip.appendChild(deleteBtn);

      try {
        range.deleteContents();
        range.insertNode(chip);
        console.log('[Drop Debug] Chip inserted successfully');

        const space = document.createTextNode(' ');
        range.setStartAfter(chip);
        range.insertNode(space);

        range.setStartAfter(space);
        range.collapse(true);
        
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } catch (err) {
        console.error('[Drop Debug] Error inserting chip:', err);
        // 备用方案：直接追加到 inputText 末尾
        inputText.appendChild(chip);
        inputText.appendChild(document.createTextNode(' '));
        console.log('[Drop Debug] Used fallback: appended to end');
      }

      inputText.focus();
    }

    function addImage(file) {
      // 检查图片数量限制
      if (images.filter(img => img !== null).length >= MAX_IMAGE_COUNT) {
        alert('图片数量超过限制（最多 ' + MAX_IMAGE_COUNT + ' 张）');
        return;
      }

      // 检查图片大小限制
      if (file.size > MAX_IMAGE_SIZE) {
        alert('图片大小超过限制（单张最大 5MB）');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const index = images.length;
        images.push(dataUrl);

        const wrapper = document.createElement('div');
        wrapper.className = 'img-wrapper';

        const img = document.createElement('img');
        img.src = dataUrl;
        img.onclick = () => showModal(dataUrl);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'img-delete';
        deleteBtn.textContent = '×';
        deleteBtn.onclick = (e) => { e.stopPropagation(); removeImage(index, wrapper); };

        wrapper.appendChild(img);
        wrapper.appendChild(deleteBtn);
        imagePreview.appendChild(wrapper);
      };
      reader.readAsDataURL(file);
    }

    function removeImage(index, wrapper) {
      images[index] = null;
      wrapper.remove();
    }

    function isTextFile(file) {
      const fileName = file.name.toLowerCase();
      return TEXT_FILE_EXTENSIONS.some(ext => fileName.endsWith(ext));
    }

    function isTextFileByName(fileName) {
      const lowerName = fileName.toLowerCase();
      return TEXT_FILE_EXTENSIONS.some(ext => lowerName.endsWith(ext));
    }

    let countdownInterval;
    let displayInterval;
    let remainingSeconds = 0;
    let countdownStartTime = 0;
    let isCountdownRunning = false;

    function startCountdown() {
      if (countdownInterval) clearInterval(countdownInterval);
      if (displayInterval) clearInterval(displayInterval);

      if (timeoutMinutes === 0) {
        countdown.textContent = '⏱️ 不限制';
        isCountdownRunning = false;
        return;
      }

      remainingSeconds = timeoutMinutes * 60;
      countdownStartTime = Date.now();
      isCountdownRunning = true;
      
      countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
          clearInterval(countdownInterval);
          clearInterval(displayInterval);
          countdown.textContent = '';
          isCountdownRunning = false;
        }
      }, 1000);
    }

    function updateCountdownForNewTimeout() {
      if (!isCountdownRunning) return;
      
      const elapsed = Math.floor((Date.now() - countdownStartTime) / 1000);
      const newRemaining = timeoutMinutes * 60 - elapsed;
      
      if (newRemaining <= 0) {
        remainingSeconds = 0;
        clearInterval(countdownInterval);
        clearInterval(displayInterval);
        countdown.textContent = '';
        isCountdownRunning = false;
      } else {
        remainingSeconds = newRemaining;
        countdown.textContent = getCountdownText();
      }
    }

    function getCountdownText() {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      return '⏱️ ' + minutes + ':' + seconds.toString().padStart(2, '0');
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.type === 'showPrompt') {
        promptText.textContent = msg.prompt;
        currentRequestId = msg.requestId || '';
        
        // 隐藏已发送指示器，显示等待指示器
        const sentIndicator = document.getElementById('sentIndicator');
        if (sentIndicator) sentIndicator.classList.remove('show');
        waitingIndicator.classList.add('show');
        inputText.focus();
        
        // 更新工具统计
        const toolCountEl = document.getElementById('toolCount');
        const totalToolCountEl = document.getElementById('totalToolCount');
        const toolListDetail = document.getElementById('toolListDetail');
        const toolListToggle = document.getElementById('toolListToggle');
        const convIdEl = document.getElementById('conversationId');
        
        // 当前轮次：取传入数字和 tool-list 长度的最大值
        const currentCount = Math.max(msg.toolCount || 0, (msg.toolList && msg.toolList.length) || 0);
        // 累计统计（如果有 conversationId）
        const totalCount = msg.totalToolCount || currentCount;
        const allTools = msg.allToolsList || msg.toolList || [];
        
        if (toolCountEl) {
          toolCountEl.textContent = currentCount;
        }
        if (totalToolCountEl) {
          totalToolCountEl.textContent = totalCount;
        }
        if (convIdEl && msg.conversationId) {
          convIdEl.textContent = msg.conversationId.substring(0, 8) + '...';
          convIdEl.title = msg.conversationId;
        } else if (convIdEl) {
          convIdEl.textContent = '-';
          convIdEl.title = '无对话ID';
        }
        
        // 显示所有工具列表（累计或当前）
        if (toolListDetail && allTools.length > 0) {
          toolListDetail.innerHTML = allTools.map(t => 
            '<span class="tool-item">' + t + '</span>'
          ).join('');
        } else if (toolListDetail) {
          toolListDetail.innerHTML = '<span style="opacity:0.6">暂无工具调用</span>';
        }
        
        // 工具列表展开/收起
        if (toolListToggle && toolListDetail) {
          toolListToggle.onclick = function() {
            toolListToggle.classList.toggle('expanded');
            toolListDetail.classList.toggle('show');
          };
        }
        
        if (msg.startTimer) {
          startCountdown();
          if (timeoutMinutes > 0) {
            if (displayInterval) clearInterval(displayInterval);
            displayInterval = setInterval(() => {
              if (remainingSeconds > 0) {
                countdown.textContent = getCountdownText();
              } else {
                clearInterval(displayInterval);
                countdown.textContent = '';
              }
            }, 1000);
          }
        }
      } else if (msg.type === 'setPort') {
        currentPort = msg.port;
        document.getElementById('portInfo').textContent = '端口: ' + msg.port;
        // 服务启动后显示绿色状态
        connectionStatus.classList.remove('disconnected');
        connectionStatus.title = '服务运行中';
      } else if (msg.type === 'setTimeoutMinutes') {
        if (typeof msg.timeoutMinutes === 'number' && msg.timeoutMinutes >= 0) {
          timeoutMinutes = msg.timeoutMinutes;
          timeoutInput.value = msg.timeoutMinutes;
          updateCountdownForNewTimeout();
        }
      } else if (msg.type === 'setWorkspaceRoot') {
        // 接收工作区根目录
        if (msg.workspaceRoot) {
          workspaceRoot = msg.workspaceRoot;
          console.log('[WindsurfChatOpen] Workspace root set to:', workspaceRoot);
        }
      } else if (msg.type === 'setRulesStatus') {
        // 处理规则状态变化
        const disabledOverlay = document.getElementById('disabledOverlay');
        const mainContent = document.getElementById('mainContent');
        if (msg.enabled) {
          if (disabledOverlay) disabledOverlay.classList.remove('show');
          if (mainContent) mainContent.classList.remove('hidden');
        } else {
          if (disabledOverlay) disabledOverlay.classList.add('show');
          if (mainContent) mainContent.classList.add('hidden');
        }
      }
    });

    vscode.postMessage({ type: 'ready' });
  `;
}


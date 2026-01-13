import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LOCAL_DIR_NAME, RULE_MARKER, RULES_FILE_NAME, EXTENSION_ENABLED_KEY, BASE_PORT_B, PanelId } from './constants';

export class WorkspaceManager {
    constructor(
        private readonly extensionPath: string,
        private readonly context: vscode.ExtensionContext
    ) { }

    private readonly worktreeWatchers = new Map<string, fs.FSWatcher>();
    private readonly parentWatchers = new Map<string, fs.FSWatcher>();
    private readonly initializingWorktrees = new Set<string>();
    private readonly pendingWorktreeRootScans = new Map<string, NodeJS.Timeout>();
    private readonly pollingIntervals = new Map<string, NodeJS.Timeout>();
    private static readonly POLLING_INTERVAL_MS = 500; // 500ms polling as fallback for large repos
    private readonly _onRulesStatusChanged = new vscode.EventEmitter<{ enabled: boolean }>();
    public readonly onRulesStatusChanged = this._onRulesStatusChanged.event;
    private lastPortA?: number;
    private lastPortB?: number;
    private lastScriptSrc?: string;
    private worktreePorts = new Map<string, { port: number; panelId: PanelId }>();

    private syncFileIfExists(src: string, dest: string): boolean {
        try {
            if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
                return false;
            }

            fs.copyFileSync(src, dest);
            return true;
        } catch (error) {
            console.error(`[WindsurfChatOpen] Failed to sync file from ${src} to ${dest}:`, error);
            return false;
        }
    }

    private syncDirectoryIfExists(srcDir: string, destDir: string): boolean {
        try {
            if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
                return false;
            }

            if (fs.existsSync(destDir)) {
                fs.rmSync(destDir, { recursive: true, force: true });
            }
            fs.mkdirSync(destDir, { recursive: true });

            fs.cpSync(srcDir, destDir, { recursive: true, force: true });
            return true;
        } catch (error) {
            console.error(`[WindsurfChatOpen] Failed to sync directory from ${srcDir} to ${destDir}:`, error);
            return false;
        }
    }

    /**
     * 检查扩展是否启用（从 globalState 读取）
     */
    public isEnabled(): boolean {
        return this.context.globalState.get<boolean>(EXTENSION_ENABLED_KEY, true);
    }

    /**
     * 设置扩展启用状态（写入 globalState）
     */
    private async setEnabled(enabled: boolean): Promise<void> {
        await this.context.globalState.update(EXTENSION_ENABLED_KEY, enabled);
    }

    /**
     * 统一的 setup 方法，支持 Arena 模式
     * @param portA 主端口（Panel A）
     * @param portB 可选的第二端口（Panel B），如果提供则启用 Arena 模式
     */
    public setup(portA?: number, portB?: number) {
        // 如果扩展被禁用，不执行 setup
        if (!this.isEnabled()) {
            console.log('[WindsurfChatOpen] Extension is disabled, skipping setup');
            return;
        }

        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            vscode.window.showWarningMessage('Please open a workspace first');
            return;
        }

        const scriptSrc = path.join(this.extensionPath, 'lib', 'windsurf_chat.cjs');
        this.lastPortA = portA;
        this.lastPortB = portB;
        this.lastScriptSrc = scriptSrc;

        const isArenaMode = portA && portB && portA !== portB;

        for (const folder of folders) {
            const workspacePath = folder.uri.fsPath;
            // 主工作区使用端口 A
            this.setupForPath(workspacePath, scriptSrc, portA);

            // 处理 Worktrees - Arena 模式下使用轮询分配端口
            const worktrees = this.findWorktrees(folder);
            let countA = 1; // 主工作区使用 portA，所以从1开始计数
            let countB = 0;

            for (const worktreePath of worktrees) {
                // 尝试读取已有的端口分配
                const portFile = path.join(worktreePath, LOCAL_DIR_NAME, 'port');
                let assignedPort = portA;
                let panelId: PanelId = 'A';

                try {
                    if (fs.existsSync(portFile)) {
                        const existingPort = parseInt(fs.readFileSync(portFile, 'utf-8').trim(), 10);
                        if (!isNaN(existingPort)) {
                            if (existingPort === portB) {
                                assignedPort = portB;
                                panelId = 'B';
                                countB++;
                                continue; // 已分配且有效，跳过计数
                            } else if (existingPort === portA) {
                                countA++;
                                continue; // 已分配且有效，跳过计数
                            }
                        }
                    }
                } catch {
                    // 读取失败，继续分配新端口
                }

                // 新worktree：轮询分配端口
                if (isArenaMode && countB < countA) {
                    assignedPort = portB;
                    panelId = 'B';
                    countB++;
                    console.log(`[WindsurfChatOpen] Setting up worktree ${panelId}: ${worktreePath} with port ${assignedPort}`);
                } else {
                    assignedPort = portA;
                    panelId = 'A';
                    countA++;
                    console.log(`[WindsurfChatOpen] Setting up worktree ${panelId}: ${worktreePath} with port ${assignedPort}`);
                }

                this.setupForPath(worktreePath, scriptSrc, assignedPort, workspacePath, true);
                this.worktreePorts.set(worktreePath, { port: assignedPort!, panelId });
            }

            this.watchWorktrees(folder, workspacePath);
        }

        const msg = isArenaMode ? 'WindsurfChatOpen Arena 模式初始化完成' : 'WindsurfChatOpen 初始化完成';
        vscode.window.showInformationMessage(msg);
    }

    /**
     * 兼容旧的 setupArena 调用
     * @deprecated 使用 setup(portA, portB) 代替
     */
    public setupArena(portA: number, portB: number) {
        this.setup(portA, portB);
    }

    /**
     * 获取最近修改的 N 个 worktree
     */
    private getRecentWorktrees(worktrees: string[], count: number): string[] {
        const worktreeStats = worktrees.map(wt => {
            try {
                const stat = fs.statSync(wt);
                return { path: wt, mtime: stat.mtimeMs };
            } catch {
                return { path: wt, mtime: 0 };
            }
        });

        // 按修改时间降序排列，取最近的 N 个
        return worktreeStats
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, count)
            .map(wt => wt.path);
    }

    /**
     * 获取 worktree 的端口信息
     */
    public getWorktreePort(worktreePath: string): { port: number; panelId: PanelId } | undefined {
        return this.worktreePorts.get(worktreePath);
    }

    /**
     * 获取所有 worktree 端口信息
     */
    public getAllWorktreePorts(): Map<string, { port: number; panelId: PanelId }> {
        return this.worktreePorts;
    }

    private setupForPath(basePath: string, scriptSrc: string, port?: number, sourceWorkspacePath?: string, forceWritePort?: boolean) {
        const localDir = path.join(basePath, LOCAL_DIR_NAME);

        const isWorktree = basePath.includes('.windsurf' + path.sep + 'worktrees');
        const canSyncFromSource = Boolean(sourceWorkspacePath && sourceWorkspacePath.length > 0);

        let skipLocalDirWrite = false;
        let skipRulesWrite = false;

        // Create directory if not exists
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        // If this is a worktree, prefer syncing from the main workspace to ensure they are identical.
        if (isWorktree && canSyncFromSource) {
            const srcLocalDir = path.join(sourceWorkspacePath!, LOCAL_DIR_NAME);
            const srcRulesFile = path.join(sourceWorkspacePath!, RULES_FILE_NAME);
            const destRulesFile = path.join(basePath, RULES_FILE_NAME);

            const syncedLocalDir = this.syncDirectoryIfExists(srcLocalDir, localDir);
            const syncedRules = this.syncFileIfExists(srcRulesFile, destRulesFile);

            skipLocalDirWrite = syncedLocalDir;
            skipRulesWrite = syncedRules;

            // 同步目录后始终覆盖 port 文件，确保使用正确端口
            if (syncedLocalDir && port && port > 0) {
                const portFile = path.join(localDir, 'port');
                fs.writeFileSync(portFile, port.toString(), 'utf-8');
                console.log(`[WindsurfChatOpen] Wrote port ${port} for worktree: ${basePath}`);
            }

            if (syncedLocalDir && syncedRules) {
                console.log(`[WindsurfChatOpen] Synced ChatOpen assets from main workspace to worktree: ${basePath}`);
                console.log(`[WindsurfChatOpen] Setup complete for: ${basePath}`);
                return;
            }
        }

        if (!skipLocalDirWrite) {
            // Remove old .js script if exists
            const oldScriptPath = path.join(localDir, 'windsurf_chat.js');
            if (fs.existsSync(oldScriptPath)) {
                fs.unlinkSync(oldScriptPath);
            }

            // Copy script
            const scriptDest = path.join(localDir, 'windsurf_chat.cjs');
            if (fs.existsSync(scriptSrc)) {
                fs.copyFileSync(scriptSrc, scriptDest);
            } else {
                console.error(`[WindsurfChatOpen] Script source not found: ${scriptSrc}`);
            }

            // 始终写入端口文件（确保每次启动使用正确端口）
            if (port && port > 0) {
                const portFile = path.join(localDir, 'port');
                fs.writeFileSync(portFile, port.toString(), 'utf-8');
                console.log(`[WindsurfChatOpen] Wrote port ${port} to: ${portFile}`);
            }
        }

        // Generate or update .windsurfrules
        if (!skipRulesWrite) {
            this.updateWindsurfRules(basePath);
        }

        // Update .gitignore (only for main workspace, not needed for worktrees usually, but no harm checking)
        // We generally only want to modify gitignore in the actual workspace
        if (!basePath.includes('.windsurf' + path.sep + 'worktrees')) {
            this.updateGitignore(basePath);
        }

        console.log(`[WindsurfChatOpen] Setup complete for: ${basePath}`);
    }

    private findWorktrees(folder: vscode.WorkspaceFolder): string[] {
        const worktrees: string[] = [];
        try {
            const homeDir = os.homedir();
            // Worktrees are usually at ~/.windsurf/worktrees/<FolderName>/<FolderName>-<Hash>
            // We need to match the folder name.
            // Note: folder.name might not be unique or might check folder.uri

            const folderName = folder.name;
            // Try to find matching worktree directory
            const worktreeRoot = path.join(homeDir, '.windsurf', 'worktrees', folderName);

            if (fs.existsSync(worktreeRoot) && fs.statSync(worktreeRoot).isDirectory()) {
                const entries = fs.readdirSync(worktreeRoot);
                for (const entry of entries) {
                    const fullPath = path.join(worktreeRoot, entry);
                    // Check if it looks like a worktree directory (usually has the name prefix)
                    if (entry.startsWith(folderName) && fs.statSync(fullPath).isDirectory()) {
                        worktrees.push(fullPath);
                    }
                }
            }
        } catch (e) {
            console.error('[WindsurfChatOpen] Error finding worktrees:', e);
        }
        return worktrees;
    }

    private watchWorktrees(folder: vscode.WorkspaceFolder, sourceWorkspacePath: string) {
        try {
            const homeDir = os.homedir();
            const folderName = folder.name;
            const worktreesDir = path.join(homeDir, '.windsurf', 'worktrees');
            const worktreeRoot = path.join(worktreesDir, folderName);

            // If worktreeRoot exists, watch it directly
            if (fs.existsSync(worktreeRoot) && fs.statSync(worktreeRoot).isDirectory()) {
                this.watchWorktreeRoot(worktreeRoot, folderName, sourceWorkspacePath);
                return;
            }

            // worktreeRoot doesn't exist, need to watch parent directories
            this.watchForWorktreeRootCreation(worktreesDir, worktreeRoot, folderName, sourceWorkspacePath);
        } catch (error) {
            console.error('[WindsurfChatOpen] Failed to watch worktrees:', error);
        }
    }

    private watchForWorktreeRootCreation(
        worktreesDir: string,
        worktreeRoot: string,
        folderName: string,
        sourceWorkspacePath: string
    ) {
        // Check if ~/.windsurf/worktrees exists
        if (fs.existsSync(worktreesDir) && fs.statSync(worktreesDir).isDirectory()) {
            // Watch worktreesDir for folderName directory creation
            this.watchParentForChild(worktreesDir, folderName, () => {
                console.log(`[WindsurfChatOpen] Detected worktreeRoot created: ${worktreeRoot}`);
                this.watchWorktreeRoot(worktreeRoot, folderName, sourceWorkspacePath);
            });
            return;
        }

        // ~/.windsurf/worktrees doesn't exist, watch ~/.windsurf for 'worktrees' creation
        const windsurfDir = path.dirname(worktreesDir);
        if (fs.existsSync(windsurfDir) && fs.statSync(windsurfDir).isDirectory()) {
            this.watchParentForChild(windsurfDir, 'worktrees', () => {
                console.log(`[WindsurfChatOpen] Detected worktrees directory created: ${worktreesDir}`);
                // Now watch worktreesDir for folderName
                this.watchParentForChild(worktreesDir, folderName, () => {
                    console.log(`[WindsurfChatOpen] Detected worktreeRoot created: ${worktreeRoot}`);
                    this.watchWorktreeRoot(worktreeRoot, folderName, sourceWorkspacePath);
                });
            });
            return;
        }

        // ~/.windsurf doesn't exist, watch home for '.windsurf' creation
        const homeDir = path.dirname(windsurfDir);
        this.watchParentForChild(homeDir, '.windsurf', () => {
            console.log(`[WindsurfChatOpen] Detected .windsurf directory created: ${windsurfDir}`);
            this.watchParentForChild(windsurfDir, 'worktrees', () => {
                console.log(`[WindsurfChatOpen] Detected worktrees directory created: ${worktreesDir}`);
                this.watchParentForChild(worktreesDir, folderName, () => {
                    console.log(`[WindsurfChatOpen] Detected worktreeRoot created: ${worktreeRoot}`);
                    this.watchWorktreeRoot(worktreeRoot, folderName, sourceWorkspacePath);
                });
            });
        });
    }

    private watchParentForChild(parentDir: string, childName: string, onChildCreated: () => void) {
        const watchKey = `${parentDir}:${childName}`;
        if (this.parentWatchers.has(watchKey)) {
            return;
        }

        try {
            const watcher = fs.watch(parentDir, { persistent: false }, (eventType: string, filename: string | null) => {
                try {
                    if (eventType !== 'rename' || filename !== childName) {
                        return;
                    }

                    const childPath = path.join(parentDir, childName);
                    if (!fs.existsSync(childPath) || !fs.statSync(childPath).isDirectory()) {
                        return;
                    }

                    // Child directory created, stop watching and invoke callback
                    const existingWatcher = this.parentWatchers.get(watchKey);
                    if (existingWatcher) {
                        existingWatcher.close();
                        this.parentWatchers.delete(watchKey);
                    }

                    onChildCreated();
                } catch (error) {
                    console.error(`[WindsurfChatOpen] Parent watcher handler error for ${watchKey}:`, error);
                }
            });

            this.parentWatchers.set(watchKey, watcher);
            console.log(`[WindsurfChatOpen] Watching ${parentDir} for ${childName} creation`);
        } catch (error) {
            console.error(`[WindsurfChatOpen] Failed to watch ${parentDir} for ${childName}:`, error);
        }
    }

    private watchWorktreeRoot(worktreeRoot: string, folderName: string, sourceWorkspacePath: string) {
        if (this.worktreeWatchers.has(worktreeRoot)) {
            return;
        }

        const scanAndSetup = () => {
            try {
                if (!fs.existsSync(worktreeRoot) || !fs.statSync(worktreeRoot).isDirectory()) {
                    return;
                }

                const entries = fs.readdirSync(worktreeRoot);
                for (const entry of entries) {
                    if (!entry.startsWith(folderName)) {
                        continue;
                    }

                    const fullPath = path.join(worktreeRoot, entry);
                    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
                        continue;
                    }

                    const localDir = path.join(fullPath, LOCAL_DIR_NAME);
                    const rulesFile = path.join(fullPath, RULES_FILE_NAME);
                    const alreadyInitialized = fs.existsSync(localDir) && fs.existsSync(rulesFile);
                    if (alreadyInitialized) {
                        continue;
                    }

                    if (this.initializingWorktrees.has(fullPath)) {
                        continue;
                    }

                    const scriptSrc = this.lastScriptSrc || path.join(this.extensionPath, 'lib', 'windsurf_chat.cjs');

                    // Determine port and whether this is Arena mode
                    let port = this.lastPortA;
                    let isArenaMode = false;
                    let forceWritePort = false;

                    // Check if we're in Arena mode (both ports are set)
                    if (this.lastPortA && this.lastPortB && this.lastPortA !== this.lastPortB) {
                        isArenaMode = true;
                        forceWritePort = true;

                        // First, try to read existing port from the worktree (if already assigned)
                        const localDir = path.join(fullPath, LOCAL_DIR_NAME);
                        const portFile = path.join(localDir, 'port');
                        let existingPort: number | undefined;
                        try {
                            if (fs.existsSync(portFile)) {
                                const portContent = fs.readFileSync(portFile, 'utf-8').trim();
                                existingPort = parseInt(portContent, 10);
                                if (!isNaN(existingPort) && (existingPort === this.lastPortA || existingPort === this.lastPortB)) {
                                    port = existingPort;
                                    const panelId: PanelId = port === this.lastPortA ? 'A' : 'B';
                                    this.worktreePorts.set(fullPath, { port, panelId });
                                    console.log(`[WindsurfChatOpen] Arena Mode: Using existing port ${port} (Panel ${panelId}) for: ${fullPath}`);
                                }
                            }
                        } catch {
                            // Ignore read errors, will assign new port below
                        }

                        // If no valid existing port, assign using round-robin based on current worktree count
                        if (!existingPort || (existingPort !== this.lastPortA && existingPort !== this.lastPortB)) {
                            // Count existing worktrees with assigned ports
                            const allWorktrees: string[] = [];
                            const entries = fs.readdirSync(worktreeRoot);
                            for (const entry of entries) {
                                if (entry.startsWith(folderName)) {
                                    const wt = path.join(worktreeRoot, entry);
                                    if (fs.existsSync(wt) && fs.statSync(wt).isDirectory()) {
                                        allWorktrees.push(wt);
                                    }
                                }
                            }

                            // Count how many worktrees are currently using each port
                            let countA = 0;
                            let countB = 0;
                            for (const wt of allWorktrees) {
                                const wtPortFile = path.join(wt, LOCAL_DIR_NAME, 'port');
                                try {
                                    if (fs.existsSync(wtPortFile)) {
                                        const wtPort = parseInt(fs.readFileSync(wtPortFile, 'utf-8').trim(), 10);
                                        if (wtPort === this.lastPortA) countA++;
                                        else if (wtPort === this.lastPortB) countB++;
                                    }
                                } catch {
                                    // Ignore
                                }
                            }

                            // Assign to the port with fewer worktrees (round-robin)
                            if (countB < countA) {
                                port = this.lastPortB!;
                                this.worktreePorts.set(fullPath, { port, panelId: 'B' });
                                console.log(`[WindsurfChatOpen] Arena Mode: Assigning port ${port} (Panel B) to: ${fullPath}`);
                            } else {
                                port = this.lastPortA!;
                                this.worktreePorts.set(fullPath, { port, panelId: 'A' });
                                console.log(`[WindsurfChatOpen] Arena Mode: Assigning port ${port} (Panel A) to: ${fullPath}`);
                            }
                        }
                    }

                    this.initializingWorktrees.add(fullPath);
                    console.log(`[WindsurfChatOpen] Scanned new worktree, setting up: ${fullPath}`);
                    try {
                        this.setupForPath(fullPath, scriptSrc, port, sourceWorkspacePath, forceWritePort);
                    } finally {
                        this.initializingWorktrees.delete(fullPath);
                    }
                }
            } catch (error) {
                console.error('[WindsurfChatOpen] Failed scanning worktreeRoot:', error);
            }
        };

        const scheduleScan = () => {
            const existing = this.pendingWorktreeRootScans.get(worktreeRoot);
            if (existing) {
                clearTimeout(existing);
            }

            const timer = setTimeout(() => {
                this.pendingWorktreeRootScans.delete(worktreeRoot);
                scanAndSetup();
            }, 100);

            this.pendingWorktreeRootScans.set(worktreeRoot, timer);
        };

        const watcher = fs.watch(worktreeRoot, { persistent: false }, (eventType: string, filename: string | null) => {
            try {
                if (eventType !== 'rename') {
                    return;
                }

                // We intentionally scan the directory after a short delay instead of relying on filename.
                // On Windows fs.watch may coalesce events or report filename as null when multiple dirs are created quickly.
                scheduleScan();
            } catch (error) {
                console.error('[WindsurfChatOpen] Worktree watcher handler error:', error);
            }
        });

        this.worktreeWatchers.set(worktreeRoot, watcher);
        console.log(`[WindsurfChatOpen] Watching worktreeRoot: ${worktreeRoot}`);

        // Start polling as fallback for large repos where fs.watch may miss events
        if (!this.pollingIntervals.has(worktreeRoot)) {
            const pollingInterval = setInterval(() => {
                scanAndSetup();
            }, WorkspaceManager.POLLING_INTERVAL_MS);
            this.pollingIntervals.set(worktreeRoot, pollingInterval);
            console.log(`[WindsurfChatOpen] Started polling fallback for: ${worktreeRoot} (every ${WorkspaceManager.POLLING_INTERVAL_MS}ms)`);
        }
    }

    private updateWindsurfRules(workspacePath: string) {
        const rulesDest = path.join(workspacePath, RULES_FILE_NAME);
        const rulesContent = this.generateRulesContent();

        // Always delete and recreate to ensure latest rules
        if (fs.existsSync(rulesDest)) {
            fs.unlinkSync(rulesDest);
        }
        fs.writeFileSync(rulesDest, rulesContent);
        console.log(`[WindsurfChatOpen] Created/Updated .windsurfrules`);
    }

    private updateGitignore(workspacePath: string) {
        const gitignorePath = path.join(workspacePath, '.gitignore');
        const ignoreEntries = [LOCAL_DIR_NAME + '/', '.windsurfrules'];

        if (fs.existsSync(gitignorePath)) {
            const content = fs.readFileSync(gitignorePath, 'utf-8');
            const entriesToAdd = ignoreEntries.filter(entry => !content.includes(entry));
            if (entriesToAdd.length > 0) {
                fs.appendFileSync(gitignorePath, '\n# WindsurfChatOpen\n' + entriesToAdd.join('\n') + '\n');
            }
        } else {
            fs.writeFileSync(gitignorePath, '# WindsurfChatOpen\n' + ignoreEntries.join('\n') + '\n');
        }
    }

    private generateRulesContent(): string {
        const scriptPath = `./${LOCAL_DIR_NAME}/windsurf_chat.cjs`;

        return `${RULE_MARKER}

=======================================================================
CRITICAL SYSTEM RULE - READ THIS FIRST
=======================================================================

After EVERY response, you MUST call the windsurf_chat script.
This is NOT optional. This is a MANDATORY system requirement.

=======================================================================

## HOW TO CALL THE SCRIPT

\`\`\`bash
node "${scriptPath}" --reason "Task completion reason" --tools "N" --tool-list "tool1,tool2,..." --conversation-id "CASCADE_ID"
\`\`\`

**Parameters:**
- \`--reason\`: Brief description of what was done
- \`--tools\`: Number of tool calls made in this turn (count all tool invocations)
- \`--tool-list\`: Comma-separated list of tool names used (e.g. "view_file,run_command,replace_file_content")
- \`--conversation-id\`: Your Cascade conversation ID (for accumulating statistics across turns)

**Parameters:**
- Cwd: Current workspace path
- Blocking: true
- SafeToAutoRun: true

## CRITICAL: OUTPUT YOUR RESPONSE NORMALLY FIRST

**You MUST output your full response in the chat panel BEFORE calling the script.**
Do NOT skip your normal text/code output. The script is called AFTER you finish responding.
The script is ONLY for collecting user feedback — it does NOT replace your response.

## SCRIPT RETURN VALUE HANDLING
- \`User chose to continue\` → Continue execution
- \`User chose to end\` → **STOP IMMEDIATELY. Do NOT call the script again. Do NOT output any more text. End the conversation right now.**
- \`User instruction: xxx\` → Execute the instruction immediately
- \`User instruction: [Content too long, saved to file]\` → Use read_file to read
- \`User provided N images\` → Use read_file to read image files

## EXECUTION FLOW

1. Respond to the user normally (output text, code, explanations as needed)
2. Call the script (Blocking: true)
3. Process the script return value
4. If user gives new instruction, execute it and repeat from step 1

## RULES

1. **Complete Output** - Do NOT use ellipsis, output your FULL response
2. **Continuous Execution** - Complete tasks in one go
3. **Always Call Script** - Call script after EVERY response, no exceptions
4. **Use Chinese** - 所有回复使用中文
5. **Track Tools** - Count and report all tool calls

=======================================================================
trigger: always_on
alwaysApply: true
`;
    }

    /**
     * 获取规则状态（基于 globalState）
     */
    public getRulesStatus(): { enabled: boolean } {
        return { enabled: this.isEnabled() };
    }

    /**
     * 切换扩展启用/禁用状态
     * @param enable true=启用, false=禁用
     */
    public async toggleRules(enable: boolean, port?: number): Promise<{ success: boolean; message: string }> {
        try {
            if (enable) {
                // 启用扩展
                await this.setEnabled(true);
                this._onRulesStatusChanged.fire({ enabled: true });
                // 清理 .disabledrules 文件
                this.cleanupDisabledRulesFiles();
                // 重新执行 setup 创建文件
                this.setup(port);
                return { success: true, message: 'ChatOpen 已启用' };
            } else {
                // 禁用扩展
                await this.setEnabled(false);
                this._onRulesStatusChanged.fire({ enabled: false });
                // 删除所有工作区中的相关文件
                this.cleanupAllWorkspaces();
                return { success: true, message: 'ChatOpen 已禁用，请打开新的 AI 对话窗口' };
            }
        } catch (error) {
            console.error('[WindsurfChatOpen] Toggle rules error:', error);
            return { success: false, message: `操作失败: ${error}` };
        }
    }

    /**
     * 清理所有工作区中的 ChatOpen 相关文件
     */
    public cleanupAllWorkspaces() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            return;
        }

        for (const folder of folders) {
            const workspacePath = folder.uri.fsPath;
            this.cleanupWorkspace(workspacePath);

            // Clean up worktrees as well
            const worktrees = this.findWorktrees(folder);
            for (const worktree of worktrees) {
                this.cleanupWorkspace(worktree);
            }
        }
    }

    /**
     * 清理单个工作区中的 ChatOpen 相关文件
     */
    private cleanupWorkspace(workspacePath: string) {
        const rulesPath = path.join(workspacePath, RULES_FILE_NAME);
        const localDir = path.join(workspacePath, LOCAL_DIR_NAME);
        const disabledRulesPath = path.join(workspacePath, '.disabledrules');

        try {
            // 删除 .windsurfrules
            if (fs.existsSync(rulesPath)) {
                fs.unlinkSync(rulesPath);
                console.log(`[WindsurfChatOpen] Deleted: ${rulesPath}`);
            }

            // 删除 .windsurfchatopen 目录
            if (fs.existsSync(localDir)) {
                fs.rmSync(localDir, { recursive: true, force: true });
                console.log(`[WindsurfChatOpen] Deleted directory: ${localDir}`);
            }

            // 删除 .disabledrules 文件
            if (fs.existsSync(disabledRulesPath)) {
                fs.unlinkSync(disabledRulesPath);
                console.log(`[WindsurfChatOpen] Deleted: ${disabledRulesPath}`);
            }
        } catch (error) {
            console.error(`[WindsurfChatOpen] Cleanup error for ${workspacePath}:`, error);
        }
    }

    /**
     * 清理所有工作区中的 .disabledrules 文件
     */
    private cleanupDisabledRulesFiles() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            return;
        }

        for (const folder of folders) {
            const workspacePath = folder.uri.fsPath;
            const disabledRulesPath = path.join(workspacePath, '.disabledrules');
            try {
                if (fs.existsSync(disabledRulesPath)) {
                    fs.unlinkSync(disabledRulesPath);
                    console.log(`[WindsurfChatOpen] Deleted: ${disabledRulesPath}`);
                }
            } catch (error) {
                console.error(`[WindsurfChatOpen] Failed to delete ${disabledRulesPath}:`, error);
            }
        }
    }

    /**
     * 清理所有 watchers 和 polling intervals
     */
    public dispose() {
        // Stop all polling intervals
        for (const [key, interval] of this.pollingIntervals) {
            clearInterval(interval);
            console.log(`[WindsurfChatOpen] Stopped polling for: ${key}`);
        }
        this.pollingIntervals.clear();

        // Close all worktree watchers
        for (const [key, watcher] of this.worktreeWatchers) {
            watcher.close();
            console.log(`[WindsurfChatOpen] Closed worktree watcher: ${key}`);
        }
        this.worktreeWatchers.clear();

        // Close all parent watchers
        for (const [key, watcher] of this.parentWatchers) {
            watcher.close();
            console.log(`[WindsurfChatOpen] Closed parent watcher: ${key}`);
        }
        this.parentWatchers.clear();

        // Clear pending scans
        for (const [key, timer] of this.pendingWorktreeRootScans) {
            clearTimeout(timer);
        }
        this.pendingWorktreeRootScans.clear();

        this._onRulesStatusChanged.dispose();
    }
}

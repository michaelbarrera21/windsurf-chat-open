import * as http from 'http';
import * as vscode from 'vscode';
import {
    BASE_PORT,
    MAX_PORT_ATTEMPTS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_BODY_SIZE,
    ERROR_MESSAGES
} from './constants';

export interface RequestData {
    prompt: string;
    requestId: string;
    timeoutMinutes?: number;
    toolCount?: number;
    toolList?: string[];
    conversationId?: string;
}

interface ErrorResponse {
    action: 'error';
    error: string;
    text: string;
    images: string[];
}

interface TimeoutResponse {
    action: 'timeout_continue';
    message: string;
    text: string;
    images: string[];
}

const MS_PER_MINUTE = 60 * 1000;

export class HttpService {
    private server: http.Server | null = null;
    private port: number = 0;
    private basePort: number = 0; // 记录起始端口，用于端口循环
    private pendingRequests: Map<string, {
        res: http.ServerResponse,
        timer: NodeJS.Timeout | undefined,
        createdAt: number,
        initialTimeoutMinutes: number
    }> = new Map();
    private activeRequestId: string | null = null;
    private triedPorts: Set<number> = new Set();
    private connectionCheckInterval?: NodeJS.Timeout;
    private getTimeoutMinutes: () => number;
    private instanceId: string; // 用于日志区分不同实例

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly onRequest: (data: RequestData) => Promise<void>,
        getTimeoutMinutes: () => number,
        instanceId: string = 'default'
    ) {
        this.getTimeoutMinutes = getTimeoutMinutes;
        this.instanceId = instanceId;
    }

    public getPort(): number {
        return this.port;
    }

    public async start(): Promise<number> {
        return this.startWithBasePort(BASE_PORT);
    }

    public async startWithBasePort(basePort: number): Promise<number> {
        // 记录起始端口，用于端口循环
        this.basePort = basePort;
        console.log(`[WindsurfChatOpen][${this.instanceId}] 开始查找可用端口，起始端口: ${basePort}`);

        this.server = http.createServer((req, res) => this.handleIncomingRequest(req, res));

        // 设置服务器超时时间为0（不限制）
        this.server.timeout = 0;
        this.server.keepAliveTimeout = 0;
        this.server.headersTimeout = 0;

        // 设置 TCP Keep-Alive，防止连接被操作系统/防火墙断开
        this.server.on('connection', (socket) => {
            socket.setKeepAlive(true, 30000); // 30秒发送一次 TCP keep-alive
            socket.setTimeout(0); // 不超时
        });

        // 启动连接状态检测
        this.startConnectionCheck();

        return new Promise((resolve, reject) => {
            this.tryListen(basePort, 0, (port) => {
                console.log(`[WindsurfChatOpen][${this.instanceId}] Promise resolving with port: ${port}`);
                resolve(port);
            }, reject);
        });
    }

    private startConnectionCheck() {
        // 每30秒检查一次连接状态
        this.connectionCheckInterval = setInterval(() => {
            const now = Date.now();
            for (const [requestId, pending] of this.pendingRequests.entries()) {
                // 检查响应对象是否还可写
                if (pending.res.writableEnded || pending.res.destroyed) {
                    console.log(`[WindsurfChatOpen] Connection closed for request ${requestId}, cleaning up`);
                    this.clearPendingRequest(requestId, false);
                }
            }
        }, 30000);
    }

    private tryListen(port: number, attempt: number, resolve: (port: number) => void, reject: (err: any) => void) {
        if (attempt >= MAX_PORT_ATTEMPTS) {
            console.error(`[WindsurfChatOpen][${this.instanceId}] 无法找到可用端口，已尝试 ${MAX_PORT_ATTEMPTS} 次`);
            reject(new Error(`Could not find an available port after ${MAX_PORT_ATTEMPTS} attempts`));
            return;
        }

        // 避免重复尝试相同端口
        if (this.triedPorts.has(port)) {
            console.log(`[WindsurfChatOpen][${this.instanceId}] 端口 ${port} 已尝试过，跳过`);
            const nextPort = this.getNextPort(port);
            this.tryListen(nextPort, attempt + 1, resolve, reject);
            return;
        }

        this.triedPorts.add(port);
        console.log(`[WindsurfChatOpen][${this.instanceId}] 尝试监听端口 ${port} (第 ${attempt + 1} 次尝试)`);

        // 使用标志位防止多次 resolve（Node.js 中同一 server 多次 listen 可能导致回调多次触发）
        let resolved = false;

        const onListenError = (err: any) => {
            if (resolved) {
                console.log(`[WindsurfChatOpen][${this.instanceId}] 端口 ${port} error 事件触发但已 resolved，忽略`);
                return;
            }
            if (err.code === 'EADDRINUSE') {
                console.log(`[WindsurfChatOpen][${this.instanceId}] 端口 ${port} 已被占用 (EADDRINUSE)，尝试下一个端口`);
                const nextPort = this.getNextPort(port);
                this.tryListen(nextPort, attempt + 1, resolve, reject);
            } else {
                console.error(`[WindsurfChatOpen][${this.instanceId}] 端口 ${port} 监听失败: ${err.message}`);
                resolved = true;
                reject(err);
            }
        };

        const onListening = () => {
            this.server!.removeListener('error', onListenError);

            // 防止多次 resolve
            if (resolved) {
                console.log(`[WindsurfChatOpen][${this.instanceId}] 端口 ${port} listening 事件触发但已 resolved，忽略`);
                return;
            }

            // 检查是否是当前期望的端口（防止之前失败的 listen 意外触发回调）
            const actualPort = (this.server!.address() as any)?.port;
            if (actualPort !== port) {
                console.log(`[WindsurfChatOpen][${this.instanceId}] 期望端口 ${port} 但实际端口为 ${actualPort}，忽略此回调`);
                return;
            }

            resolved = true;
            this.port = port;
            console.log(`[WindsurfChatOpen][${this.instanceId}] ✓ 成功监听端口 ${port}`);
            resolve(port);
        };

        this.server!.once('error', onListenError);
        this.server!.listen(port, '127.0.0.1', onListening);
    }

    private getNextPort(currentPort: number): number {
        let nextPort = currentPort + 1;
        // 使用动态起始端口进行循环，而不是固定的 BASE_PORT
        if (nextPort > this.basePort + MAX_PORT_ATTEMPTS) {
            nextPort = this.basePort;
            console.log(`[WindsurfChatOpen][${this.instanceId}] 端口超出范围 ${this.basePort + MAX_PORT_ATTEMPTS}，从 ${this.basePort} 重新开始`);
        }
        return nextPort;
    }

    private handleIncomingRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        // 设置连接保活
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Keep-Alive', 'timeout=0');

        if (req.method === 'POST' && req.url === '/request') {
            let body = '';
            let bodySize = 0;

            req.on('data', chunk => {
                bodySize += chunk.length;
                if (bodySize > MAX_REQUEST_BODY_SIZE) {
                    req.destroy();
                    res.writeHead(413, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request body too large' }));
                    return;
                }
                body += chunk;
            });

            req.on('end', async () => {
                try {
                    const data = JSON.parse(body) as RequestData;

                    // 验证必需字段
                    if (!data.prompt || typeof data.prompt !== 'string') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid prompt field' }));
                        return;
                    }

                    const requestId = this.validateRequestId(data.requestId);

                    if (this.activeRequestId && this.activeRequestId !== requestId) {
                        this.clearPendingRequest(
                            this.activeRequestId,
                            true,
                            this.createErrorResponse(ERROR_MESSAGES.REQUEST_SUPERSEDED)
                        );
                    }

                    this.clearPendingRequest(requestId, true, this.createErrorResponse(ERROR_MESSAGES.REQUEST_SUPERSEDED));

                    const initialTimeoutMinutes = data.timeoutMinutes ?? this.getTimeoutMinutes();

                    this.pendingRequests.set(requestId, {
                        res,
                        timer: undefined,
                        createdAt: Date.now(),
                        initialTimeoutMinutes
                    });
                    this.activeRequestId = requestId;

                    this.startTimeoutCheck(requestId);

                    try {
                        await this.onRequest({ ...data, requestId, timeoutMinutes: initialTimeoutMinutes });
                    } catch (e: any) {
                        console.error('[WindsurfChatOpen] Failed to handle request:', e);
                        this.sendResponse(this.createErrorResponse(String(e?.message || e || 'Request handling failed')), requestId);
                    }

                } catch (e) {
                    if (!res.writableEnded) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: ERROR_MESSAGES.INVALID_JSON }));
                    }
                }
            });

            req.on('error', (err) => {
                console.error('[WindsurfChatOpen] Request error:', err);
                if (!res.writableEnded) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Request error' }));
                }
            });
        } else if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                port: this.port,
                pendingRequests: this.pendingRequests.size,
                activeRequestId: this.activeRequestId
            }));
        } else if (req.method === 'GET' && req.url === '/status') {
            // 返回详细状态信息，用于调试
            const requests = Array.from(this.pendingRequests.entries()).map(([id, pending]) => ({
                requestId: id,
                createdAt: pending.createdAt,
                age: Date.now() - pending.createdAt,
                hasTimer: !!pending.timer,
                writable: !pending.res.writableEnded && !pending.res.destroyed
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                port: this.port,
                activeRequestId: this.activeRequestId,
                pendingRequests: requests
            }));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    }

    private validateRequestId(requestId?: string): string {
        if (!requestId || typeof requestId !== 'string' || requestId.trim() === '') {
            return Date.now().toString();
        }
        return requestId.trim();
    }

    private createErrorResponse(error: string): ErrorResponse {
        return {
            action: 'error',
            error,
            text: '',
            images: []
        };
    }

    private createTimeoutResponse(elapsed: number, currentTimeoutMinutes: number): TimeoutResponse {
        return {
            action: 'timeout_continue',
            message: `已等待 ${Math.floor(elapsed / MS_PER_MINUTE)} 分钟，当前超时设置为 ${currentTimeoutMinutes} 分钟`,
            text: '',
            images: []
        };
    }

    private startTimeoutCheck(requestId: string) {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) return;

        // 获取最新的超时配置
        const currentTimeoutMinutes = this.getTimeoutMinutes();
        const timeoutMs = currentTimeoutMinutes === 0 ? 0 : currentTimeoutMinutes * MS_PER_MINUTE;

        // 如果设置为不限制，清除定时器
        if (timeoutMs === 0) {
            if (pending.timer) {
                clearTimeout(pending.timer);
                pending.timer = undefined;
            }
            return;
        }

        // 计算已等待时间
        const elapsed = Date.now() - pending.createdAt;
        const remaining = timeoutMs - elapsed;

        // 如果已超时，发送继续等待提示
        if (remaining <= 0) {
            if (!pending.res.writableEnded) {
                pending.res.writeHead(200, { 'Content-Type': 'application/json' });
                pending.res.end(JSON.stringify(this.createTimeoutResponse(elapsed, currentTimeoutMinutes)));
                this.pendingRequests.delete(requestId);
                if (this.activeRequestId === requestId) {
                    this.activeRequestId = null;
                }
            }
            return;
        }

        // 设置新的定时器
        if (pending.timer) {
            clearTimeout(pending.timer);
        }
        pending.timer = setTimeout(() => {
            this.startTimeoutCheck(requestId);
        }, remaining);
    }

    private clearPendingRequest(requestId: string, sendResponse: boolean = false, responseData?: ErrorResponse) {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
            if (pending.timer) {
                clearTimeout(pending.timer);
            }
            if (sendResponse && !pending.res.writableEnded) {
                try {
                    pending.res.writeHead(200, { 'Content-Type': 'application/json' });
                    pending.res.end(JSON.stringify(responseData || this.createErrorResponse(ERROR_MESSAGES.REQUEST_CANCELLED)));
                } catch (e) {
                    console.error('[WindsurfChatOpen] Failed to send response:', e);
                }
            }
            this.pendingRequests.delete(requestId);
            if (this.activeRequestId === requestId) {
                this.activeRequestId = null;
            }
        }
    }

    public sendResponse(response: any, requestId?: string) {
        const id = requestId || this.activeRequestId;
        if (!id || !this.pendingRequests.has(id)) {
            console.warn(`[WindsurfChatOpen] No pending request found for ID: ${id}`);
            return;
        }

        const pending = this.pendingRequests.get(id)!;

        // 检查响应对象是否还可写
        if (pending.res.writableEnded || pending.res.destroyed) {
            console.warn(`[WindsurfChatOpen] Response object already closed for request ${id}, connection may have been lost`);
            this.clearPendingRequest(id);
            if (this.activeRequestId === id) {
                this.activeRequestId = null;
            }
            return;
        }

        try {
            pending.res.writeHead(200, {
                'Content-Type': 'application/json',
                'Connection': 'keep-alive'
            });
            pending.res.end(JSON.stringify(response));
            console.log(`[WindsurfChatOpen] Response sent successfully for request ${id}`);
        } catch (e) {
            console.error(`[WindsurfChatOpen] Failed to send response for request ${id}:`, e);
        }

        this.clearPendingRequest(id);
        if (this.activeRequestId === id) {
            this.activeRequestId = null;
        }
    }

    public dispose() {
        // 停止连接检测
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = undefined;
        }

        for (const requestId of Array.from(this.pendingRequests.keys())) {
            this.clearPendingRequest(requestId, true, this.createErrorResponse(ERROR_MESSAGES.EXTENSION_DEACTIVATED));
        }
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}

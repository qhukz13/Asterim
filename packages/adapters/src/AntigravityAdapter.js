"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AntigravityAdapter = void 0;
var pty = require("node-pty");
var crypto_1 = require("crypto");
var path_1 = require("path");
var AntigravityAdapter = /** @class */ (function () {
    function AntigravityAdapter() {
        this.ptyProcess = null;
        this.dataBuffer = '';
        this.chatBuffer = '';
        this.lastScreenText = '';
        this.pendingApproval = false;
        this.isStartingUp = true;
        this.startupTimeout = null;
        this.commandQueue = [];
    }
    AntigravityAdapter.prototype.getRealAgyBinaryPath = function () {
        try {
            var execSync = require('child_process').execSync;
            var cmd = process.platform === 'win32' ? 'where agy' : 'which agy';
            var output = execSync(cmd, { stdio: 'pipe' }).toString().trim();
            if (output) {
                return output.split('\n')[0].trim();
            }
        }
        catch (e) { }
        if (process.platform === 'win32') {
            var localAppData = process.env.LOCALAPPDATA || path_1.default.join(require('os').homedir(), 'AppData', 'Local');
            var winPath = path_1.default.join(localAppData, 'agy', 'bin', 'agy.exe');
            if (require('fs').existsSync(winPath)) {
                return winPath;
            }
        }
        else {
            var unixPath = path_1.default.join(require('os').homedir(), '.agy', 'bin', 'agy');
            if (require('fs').existsSync(unixPath)) {
                return unixPath;
            }
        }
        return null;
    };
    AntigravityAdapter.prototype.start = function (config) {
        return __awaiter(this, void 0, void 0, function () {
            var binPath, args, spawnCmd, spawnArgs, realAgyPath, possiblePaths, mockScriptPath, _i, possiblePaths_1, p;
            return __generator(this, function (_a) {
                if (this.ptyProcess) {
                    throw new Error('Antigravity is already running');
                }
                this.isStartingUp = true;
                this.requestApprovalCallback = config.requestApproval;
                binPath = config.binaryPath || 'antigravity';
                args = [];
                if (binPath === 'antigravity') {
                    realAgyPath = this.getRealAgyBinaryPath();
                    if (realAgyPath) {
                        spawnCmd = realAgyPath;
                        spawnArgs = ['-c'];
                    }
                    else {
                        possiblePaths = [
                            path_1.default.resolve(__dirname, '../mock-antigravity.js'),
                            path_1.default.resolve(__dirname, '../../packages/adapters/mock-antigravity.js'),
                            path_1.default.resolve(process.cwd(), 'packages/adapters/mock-antigravity.js'),
                        ];
                        mockScriptPath = '';
                        for (_i = 0, possiblePaths_1 = possiblePaths; _i < possiblePaths_1.length; _i++) {
                            p = possiblePaths_1[_i];
                            if (require('fs').existsSync(p)) {
                                mockScriptPath = p;
                                break;
                            }
                        }
                        if (!mockScriptPath) {
                            throw new Error("Could not find mock-antigravity.js in any of the resolved locations: ".concat(possiblePaths.join(', ')));
                        }
                        spawnCmd = 'node';
                        spawnArgs = __spreadArray([mockScriptPath], args, true);
                    }
                }
                else {
                    spawnCmd = binPath;
                    spawnArgs = args;
                }
                console.log('[AntigravityAdapter] Calling spawnAndWatch with:', { spawnCmd: spawnCmd, spawnArgs: spawnArgs, workspace: config.workspace });
                this.spawnAndWatch(spawnCmd, spawnArgs, config);
                return [2 /*return*/];
            });
        });
    };
    AntigravityAdapter.prototype.spawnAndWatch = function (spawnCmd, spawnArgs, config, isFallback) {
        var _this = this;
        if (isFallback === void 0) { isFallback = false; }
        var startTime = Date.now();
        this.ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: config.workspace,
            env: __assign(__assign({}, process.env), { FORCE_COLOR: '1' })
        });
        this.ptyProcess.onData(function (data) {
            _this.emitLog('info', data);
            _this.parseOutputForApprovals(data);
            _this.parseOutputForChat(data);
        });
        var onExitCallback = config.onExit;
        this.ptyProcess.onExit(function (_a) {
            var exitCode = _a.exitCode;
            console.log("[AntigravityAdapter] Process exited with code ".concat(exitCode, ". isFallback: ").concat(isFallback, ", args: ").concat(spawnArgs));
            _this.ptyProcess = null;
            // Fallback: If 'agy -c' failed (likely due to no previous conversation),
            // retry once without the '-c' argument to start a brand new session.
            var duration = Date.now() - startTime;
            if ((exitCode !== 0 || duration < 5000) && !isFallback && spawnArgs.includes('-c')) {
                _this.emitLog('warn', 'Antigravity continue exited quickly. Retrying without "-c" to start a new session...');
                _this.spawnAndWatch(spawnCmd, [], config, true);
                return;
            }
            _this.emitStatus('idle', "Antigravity exited with code ".concat(exitCode));
            if (onExitCallback) {
                onExitCallback(exitCode);
            }
        });
        this.emitStatus('working', isFallback ? 'Antigravity started (new session)' : 'Antigravity started');
    };
    AntigravityAdapter.prototype.stop = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (this.ptyProcess) {
                    this.ptyProcess.kill();
                    this.ptyProcess = null;
                    this.emitStatus('idle', 'Antigravity stopped');
                }
                return [2 /*return*/];
            });
        });
    };
    AntigravityAdapter.prototype.sendCommand = function (command) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (this.isStartingUp) {
                    this.commandQueue.push(command);
                    console.log("[AntigravityAdapter] Queued command during startup: ".concat(command));
                    return [2 /*return*/];
                }
                if (this.ptyProcess) {
                    this.emitStatus('working', 'Running command...');
                    this.ptyProcess.write("".concat(command, "\r\n"));
                }
                else {
                    throw new Error('Antigravity process is not running');
                }
                return [2 /*return*/];
            });
        });
    };
    AntigravityAdapter.prototype.writeStdin = function (data) {
        if (this.ptyProcess) {
            this.ptyProcess.write(data);
        }
    };
    AntigravityAdapter.prototype.getPid = function () {
        var _a;
        return (_a = this.ptyProcess) === null || _a === void 0 ? void 0 : _a.pid;
    };
    AntigravityAdapter.prototype.onEvent = function (callback) {
        this.eventCallback = callback;
    };
    AntigravityAdapter.prototype.parseOutputForApprovals = function (data) {
        return __awaiter(this, void 0, void 0, function () {
            var approvalRegex, match, desc, cmd, approved, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.dataBuffer += data;
                        if (this.dataBuffer.length > 1000) {
                            this.dataBuffer = this.dataBuffer.slice(-1000);
                        }
                        approvalRegex = /([^\n\r]*?)\s*[\(\[][yY]\/[nN][\)\]]/i;
                        match = this.dataBuffer.match(approvalRegex);
                        if (!(match && !this.pendingApproval && this.requestApprovalCallback)) return [3 /*break*/, 5];
                        this.pendingApproval = true;
                        this.emitStatus('waiting_approval', 'Antigravity needs approval');
                        desc = match[1].trim() || 'Action requires approval';
                        cmd = match[0].trim();
                        this.dataBuffer = '';
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, this.requestApprovalCallback(desc, cmd)];
                    case 2:
                        approved = _a.sent();
                        if (!this.ptyProcess)
                            return [2 /*return*/];
                        if (approved) {
                            this.ptyProcess.write('y\r');
                            this.emitStatus('working', 'Action approved, continuing...');
                        }
                        else {
                            this.ptyProcess.write('n\r');
                            this.emitStatus('working', 'Action denied.');
                        }
                        return [3 /*break*/, 5];
                    case 3:
                        err_1 = _a.sent();
                        console.error('[AntigravityAdapter] Approval failed:', err_1);
                        if (this.ptyProcess)
                            this.ptyProcess.write('n\r');
                        this.emitStatus('working', 'Approval error, defaulted to denied.');
                        return [3 /*break*/, 5];
                    case 4:
                        this.pendingApproval = false;
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    AntigravityAdapter.prototype.emitLog = function (level, message) {
        if (!this.eventCallback)
            return;
        this.eventCallback({
            id: crypto_1.default.randomUUID(),
            timestamp: Date.now(),
            source: 'adapter:antigravity',
            type: 'agent.log',
            payload: { level: level, message: message }
        });
    };
    AntigravityAdapter.prototype.parseOutputForChat = function (data) {
        // Add raw data to buffer FIRST to handle ANSI codes split across chunks
        this.chatBuffer += data;
        // Work on a local copy so we don't destroy the buffer if it's incomplete
        var cleanedBuffer = this.chatBuffer;
        // Translate cursor movement into simple control characters
        cleanedBuffer = cleanedBuffer.replace(/\x1b\[\d*D/g, '\x08');
        // Robust ANSI stripping (strips SGR and OSC sequences)
        cleanedBuffer = cleanedBuffer.replace(/\x1B\[\??[0-9;]*[A-Za-z]/g, '');
        cleanedBuffer = cleanedBuffer.replace(/\x1B\][^\x07]+\x07/g, '');
        // Strip Braille spinner characters and other terminal UI artifacts
        var spinnerRegex = /[⣷⣯⣟⡿⢿⣻⣽⣾⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g;
        cleanedBuffer = cleanedBuffer.replace(spinnerRegex, '');
        // Remove any backspace characters and the character preceding it
        while (cleanedBuffer.includes('\x08')) {
            cleanedBuffer = cleanedBuffer.replace(/[^\x08]\x08/, '');
            cleanedBuffer = cleanedBuffer.replace(/^\x08+/, '');
        }
        // Resolve carriage returns (\r) which mean "overwrite this line"
        cleanedBuffer = cleanedBuffer.replace(/\r\n/g, '\n');
        var lines = cleanedBuffer.split('\n');
        lines = lines.map(function (line) {
            var parts = line.split('\r');
            return parts[parts.length - 1];
        });
        cleanedBuffer = lines.join('\n');
        // Antigravity prompt usually looks like:
        // >
        // ──────────
        // ? for shortcuts
        // We STRICTLY require "? for shortcuts" because during generation, 
        // it draws a fake prompt with "esc to cancel" which we must ignore.
        var promptRegex = /(?:^|\n)>\s*\n─{10,}\n\? for shortcuts/i;
        var match = cleanedBuffer.match(promptRegex);
        if (match) {
            if (this.isStartingUp) {
                this.isStartingUp = false;
                var message_1 = cleanedBuffer.substring(0, match.index);
                message_1 = message_1
                    .replace(/Generating(\s*\.*)+/gi, '')
                    .replace(/Gemini 3\.5 Flash \(Medium\)/gi, '')
                    .replace(/esc to cancel/gi, '')
                    .replace(/─{10,}/g, '')
                    .replace(/(\r\n|\n|\r)[XW](\r\n|\n|\r)/g, '\n')
                    .replace(/[XW]$/g, '')
                    .trim();
                this.lastScreenText = message_1;
                this.chatBuffer = '';
                console.log('[AntigravityAdapter] Startup complete, history ignored. Ready for commands.');
                while (this.commandQueue.length > 0) {
                    var cmd = this.commandQueue.shift();
                    if (cmd && this.ptyProcess) {
                        console.log("[AntigravityAdapter] Flushing queued command: ".concat(cmd));
                        this.ptyProcess.write(cmd + '\r\n');
                    }
                }
                this.emitStatus('idle', 'Ready');
                return;
            }
            // Extract the message before the prompt
            var message = cleanedBuffer.substring(0, match.index);
            // Clean up the message before emitting
            message = message
                .replace(/Generating(\s*\.*)+/gi, '')
                .replace(/Gemini 3\.5 Flash \(Medium\)/gi, '')
                .replace(/esc to cancel/gi, '')
                .replace(/─{10,}/g, '')
                .replace(/(\r\n|\n|\r)[XW](\r\n|\n|\r)/g, '\n')
                .replace(/[XW]$/g, '')
                .trim();
            // Filter out previously seen history to handle full-screen redraws
            var newText = message;
            if (this.lastScreenText) {
                var oldLines = this.lastScreenText.split('\n');
                var newLines = message.split('\n');
                var bestOverlap = 0;
                for (var overlap = Math.min(oldLines.length, newLines.length); overlap > 0; overlap--) {
                    var match_1 = true;
                    for (var i = 0; i < overlap; i++) {
                        if (oldLines[oldLines.length - overlap + i] !== newLines[i]) {
                            match_1 = false;
                            break;
                        }
                    }
                    if (match_1) {
                        bestOverlap = overlap;
                        break;
                    }
                }
                if (bestOverlap > 0) {
                    newText = newLines.slice(bestOverlap).join('\n').trim();
                }
            }
            this.lastScreenText = message;
            var msgLines = newText.split('\n');
            if (msgLines.length >= 3 && msgLines[1].trim() === '') {
                newText = msgLines.slice(2).join('\n').trim();
            }
            else if (msgLines.length > 0 && msgLines[0].startsWith('> ')) {
                newText = msgLines.slice(1).join('\n').trim();
            }
            var isSystemMessage = newText.includes('Welcome to the Antigravity CLI') ||
                newText.includes('Signing in...') ||
                newText.includes('You are currently not signed in');
            if (newText && !isSystemMessage) {
                this.emitChatMessage('agent', newText);
            }
            this.chatBuffer = '';
            this.emitStatus('idle', 'Ready');
        }
    };
    AntigravityAdapter.prototype.emitChatMessage = function (role, content) {
        if (!this.eventCallback)
            return;
        this.eventCallback({
            id: crypto_1.default.randomUUID(),
            timestamp: Date.now(),
            source: 'adapter:antigravity',
            type: 'chat.message',
            payload: { role: role, content: content }
        });
    };
    AntigravityAdapter.prototype.emitStatus = function (status, message) {
        if (!this.eventCallback)
            return;
        this.eventCallback({
            id: crypto_1.default.randomUUID(),
            timestamp: Date.now(),
            source: 'adapter:antigravity',
            type: 'agent.status',
            payload: { status: status, message: message }
        });
    };
    return AntigravityAdapter;
}());
exports.AntigravityAdapter = AntigravityAdapter;

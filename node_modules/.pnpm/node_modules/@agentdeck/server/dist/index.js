#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/services/EventBus.ts
var import_events, EventBus, eventBus;
var init_EventBus = __esm({
  "src/services/EventBus.ts"() {
    "use strict";
    import_events = require("events");
    EventBus = class _EventBus {
      static instance;
      emitter;
      constructor() {
        this.emitter = new import_events.EventEmitter();
        this.emitter.setMaxListeners(100);
      }
      static getInstance() {
        if (!_EventBus.instance) {
          _EventBus.instance = new _EventBus();
        }
        return _EventBus.instance;
      }
      /**
       * Publishes an event to the bus.
       */
      publish(event) {
        this.emitter.emit(event.type, event);
        this.emitter.emit("*", event);
      }
      /**
       * Subscribes to a specific event type.
       */
      subscribe(eventType, callback) {
        this.emitter.on(eventType, callback);
      }
      /**
       * Unsubscribes from a specific event type.
       */
      unsubscribe(eventType, callback) {
        this.emitter.off(eventType, callback);
      }
    };
    eventBus = EventBus.getInstance();
  }
});

// src/services/DatabaseService.ts
function resolveDataDir() {
  const envDir = process.env.AGENTDECK_DATA_DIR;
  if (envDir) {
    return import_path.default.resolve(envDir);
  }
  return import_path.default.join(import_os.default.homedir(), ".agentdeck");
}
var import_path, import_os, import_fs, req, DBSync, DatabaseService, dbService;
var init_DatabaseService = __esm({
  "src/services/DatabaseService.ts"() {
    "use strict";
    import_path = __toESM(require("path"));
    import_os = __toESM(require("os"));
    import_fs = __toESM(require("fs"));
    req = typeof require !== "undefined" ? require : module.require;
    ({ DatabaseSync: DBSync } = req("node:sqlite"));
    DatabaseService = class {
      db;
      dbPath;
      constructor() {
        const dataDir = resolveDataDir();
        if (!import_fs.default.existsSync(dataDir)) {
          import_fs.default.mkdirSync(dataDir, { recursive: true });
        }
        this.dbPath = import_path.default.join(dataDir, "agentdeck.db");
        console.log(`[Database] Using database at: ${this.dbPath}`);
        this.db = new DBSync(this.dbPath);
        this.init();
      }
      init() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        keys_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL,
        pid INTEGER,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        action_id TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
        this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_project_timestamp 
      ON events(project_id, timestamp DESC);
    `);
      }
      getDb() {
        return this.db;
      }
    };
    dbService = new DatabaseService();
  }
});

// src/services/PairingService.ts
var PairingService_exports = {};
__export(PairingService_exports, {
  PairingService: () => PairingService,
  pairingService: () => pairingService
});
var import_crypto, PairingService, pairingService;
var init_PairingService = __esm({
  "src/services/PairingService.ts"() {
    "use strict";
    import_crypto = __toESM(require("crypto"));
    init_DatabaseService();
    PairingService = class {
      currentPin = "";
      hmacSecret = "";
      constructor() {
        this.init();
      }
      init() {
        this.currentPin = this.generatePin();
        const db = dbService.getDb();
        const query = db.prepare("SELECT value FROM settings WHERE key = 'hmac_secret'");
        const row = query.get();
        if (row) {
          this.hmacSecret = row.value;
        } else {
          this.hmacSecret = import_crypto.default.randomBytes(32).toString("hex");
          const insert = db.prepare("INSERT INTO settings (key, value) VALUES ('hmac_secret', ?)");
          insert.run(this.hmacSecret);
        }
        console.log("\n=======================================");
        console.log("[AUTH] AGENTDECK DEVICE PAIRING PIN");
        console.log(`[PIN] PIN: ${this.currentPin}`);
        console.log("=======================================\n");
      }
      generatePin() {
        return Math.floor(1e5 + Math.random() * 9e5).toString();
      }
      getPin() {
        return this.currentPin;
      }
      validatePin(pin) {
        return this.currentPin === pin;
      }
      generateToken() {
        const payload = {
          issuedAt: Date.now(),
          nonce: import_crypto.default.randomBytes(16).toString("hex")
        };
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
        const signature = import_crypto.default.createHmac("sha256", this.hmacSecret).update(payloadB64).digest("base64url");
        return `${payloadB64}.${signature}`;
      }
      validateToken(token) {
        try {
          const parts = token.split(".");
          if (parts.length !== 2) return false;
          const [payloadB64, signature] = parts;
          const expectedSignature = import_crypto.default.createHmac("sha256", this.hmacSecret).update(payloadB64).digest("base64url");
          if (import_crypto.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
            const thirtyDaysMs = 30 * 24 * 60 * 60 * 1e3;
            if (Date.now() - payload.issuedAt > thirtyDaysMs) {
              return false;
            }
            return true;
          }
          return false;
        } catch (err) {
          return false;
        }
      }
    };
    pairingService = new PairingService();
  }
});

// src/services/ProjectManager.ts
var ProjectManager_exports = {};
__export(ProjectManager_exports, {
  ProjectManager: () => ProjectManager,
  projectManager: () => projectManager
});
var import_crypto3, ProjectManager, projectManager;
var init_ProjectManager = __esm({
  "src/services/ProjectManager.ts"() {
    "use strict";
    import_crypto3 = __toESM(require("crypto"));
    init_DatabaseService();
    ProjectManager = class {
      getProjects() {
        const db = dbService.getDb();
        const query = db.prepare("SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC");
        return query.all();
      }
      getProject(id) {
        const db = dbService.getDb();
        const query = db.prepare("SELECT id, name, path, created_at FROM projects WHERE id = ?");
        return query.get(id);
      }
      addProject(name, projectPath) {
        const db = dbService.getDb();
        const newProject = {
          id: import_crypto3.default.randomUUID(),
          name,
          path: projectPath
        };
        const insert = db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)");
        insert.run(newProject.id, newProject.name, newProject.path);
        return newProject;
      }
      removeProject(id) {
        const db = dbService.getDb();
        const remove = db.prepare("DELETE FROM projects WHERE id = ?");
        remove.run(id);
      }
    };
    projectManager = new ProjectManager();
  }
});

// ../../packages/adapters/src/AiderAdapter.ts
var pty, import_crypto4, AiderAdapter;
var init_AiderAdapter = __esm({
  "../../packages/adapters/src/AiderAdapter.ts"() {
    "use strict";
    pty = __toESM(require("node-pty"));
    import_crypto4 = __toESM(require("crypto"));
    AiderAdapter = class {
      ptyProcess = null;
      eventCallback;
      currentActionId = null;
      dataBuffer = "";
      pendingApproval = false;
      requestApprovalCallback;
      async start(config) {
        if (this.ptyProcess) {
          throw new Error("Aider is already running");
        }
        this.requestApprovalCallback = config.requestApproval;
        const binPath = config.binaryPath || "aider";
        const args = ["--no-auto-commits"];
        const shell = process.platform === "win32" ? "cmd.exe" : "bash";
        const ptyArgs = process.platform === "win32" ? ["/c", binPath, ...args] : ["-c", `${binPath} ${args.join(" ")}`];
        this.ptyProcess = pty.spawn(shell, ptyArgs, {
          name: "xterm-color",
          cols: 80,
          rows: 30,
          cwd: config.workspace,
          env: { ...process.env, FORCE_COLOR: "1" }
        });
        this.ptyProcess.onData((data) => {
          this.emitLog("info", data);
          this.parseOutputForApprovals(data);
        });
        const onExitCallback = config.onExit;
        this.ptyProcess.onExit(({ exitCode }) => {
          this.emitStatus("idle", `Aider exited with code ${exitCode}`);
          this.ptyProcess = null;
          if (onExitCallback) {
            onExitCallback(exitCode);
          }
        });
        this.emitStatus("working", "Aider started");
      }
      async stop() {
        if (this.ptyProcess) {
          this.ptyProcess.kill();
          this.ptyProcess = null;
          this.emitStatus("idle", "Aider stopped");
        }
      }
      async sendCommand(command) {
        if (this.ptyProcess) {
          this.ptyProcess.write(`${command}\r`);
        } else {
          throw new Error("Aider process is not running");
        }
      }
      writeStdin(data) {
        if (this.ptyProcess) {
          this.ptyProcess.write(data);
        }
      }
      getPid() {
        return this.ptyProcess?.pid;
      }
      onEvent(callback) {
        this.eventCallback = callback;
      }
      async parseOutputForApprovals(data) {
        this.dataBuffer += data;
        if (this.dataBuffer.length > 1e3) {
          this.dataBuffer = this.dataBuffer.slice(-1e3);
        }
        const approvalRegex = /(Allow.*|Run command.*)\s*\([yY]\/[nN]\)/i;
        const match = this.dataBuffer.match(approvalRegex);
        if (match && !this.pendingApproval && this.requestApprovalCallback) {
          this.pendingApproval = true;
          this.emitStatus("waiting_approval", "Aider needs approval");
          const desc = match[1].trim();
          const cmd = match[0].trim();
          this.dataBuffer = "";
          try {
            const approved = await this.requestApprovalCallback(desc, cmd);
            if (!this.ptyProcess) return;
            if (approved) {
              this.ptyProcess.write("y\r");
              this.emitStatus("working", "Action approved, continuing...");
            } else {
              this.ptyProcess.write("n\r");
              this.emitStatus("working", "Action denied.");
            }
          } catch (err) {
            console.error("[AiderAdapter] Approval failed:", err);
            if (this.ptyProcess) this.ptyProcess.write("n\r");
            this.emitStatus("working", "Approval error, defaulted to denied.");
          } finally {
            this.pendingApproval = false;
          }
        }
      }
      emitLog(level, message) {
        if (!this.eventCallback) return;
        this.eventCallback({
          id: import_crypto4.default.randomUUID(),
          timestamp: Date.now(),
          source: "adapter:aider",
          type: "agent.log",
          payload: { level, message }
        });
      }
      emitStatus(status, message) {
        if (!this.eventCallback) return;
        this.eventCallback({
          id: import_crypto4.default.randomUUID(),
          timestamp: Date.now(),
          source: "adapter:aider",
          type: "agent.status",
          payload: { status, message }
        });
      }
    };
  }
});

// ../../packages/adapters/src/ClaudeAdapter.ts
var pty2, import_crypto5, ClaudeAdapter;
var init_ClaudeAdapter = __esm({
  "../../packages/adapters/src/ClaudeAdapter.ts"() {
    "use strict";
    pty2 = __toESM(require("node-pty"));
    import_crypto5 = __toESM(require("crypto"));
    ClaudeAdapter = class {
      ptyProcess = null;
      eventCallback;
      currentActionId = null;
      dataBuffer = "";
      pendingApproval = false;
      requestApprovalCallback;
      async start(config) {
        if (this.ptyProcess) {
          throw new Error("Claude Code is already running");
        }
        this.requestApprovalCallback = config.requestApproval;
        const binPath = config.binaryPath || "claude";
        const args = [];
        const shell = process.platform === "win32" ? "cmd.exe" : "bash";
        const ptyArgs = process.platform === "win32" ? ["/c", binPath, ...args] : ["-c", `${binPath} ${args.join(" ")}`];
        this.ptyProcess = pty2.spawn(shell, ptyArgs, {
          name: "xterm-color",
          cols: 80,
          rows: 30,
          cwd: config.workspace,
          env: { ...process.env, FORCE_COLOR: "1" }
        });
        this.ptyProcess.onData((data) => {
          this.emitLog("info", data);
          this.parseOutputForApprovals(data);
        });
        const onExitCallback = config.onExit;
        this.ptyProcess.onExit(({ exitCode }) => {
          this.emitStatus("idle", `Claude Code exited with code ${exitCode}`);
          this.ptyProcess = null;
          if (onExitCallback) {
            onExitCallback(exitCode);
          }
        });
        this.emitStatus("working", "Claude Code started");
      }
      async stop() {
        if (this.ptyProcess) {
          this.ptyProcess.kill();
          this.ptyProcess = null;
          this.emitStatus("idle", "Claude Code stopped");
        }
      }
      async sendCommand(command) {
        if (this.ptyProcess) {
          this.ptyProcess.write(`${command}\r`);
        } else {
          throw new Error("Claude Code process is not running");
        }
      }
      writeStdin(data) {
        if (this.ptyProcess) {
          this.ptyProcess.write(data);
        }
      }
      getPid() {
        return this.ptyProcess?.pid;
      }
      onEvent(callback) {
        this.eventCallback = callback;
      }
      async parseOutputForApprovals(data) {
        this.dataBuffer += data;
        if (this.dataBuffer.length > 1e3) {
          this.dataBuffer = this.dataBuffer.slice(-1e3);
        }
        const approvalRegex = /\?\s*(.*?)\s*\([yY]\/[nN]\)/i;
        const match = this.dataBuffer.match(approvalRegex);
        if (match && !this.pendingApproval && this.requestApprovalCallback) {
          this.pendingApproval = true;
          this.emitStatus("waiting_approval", "Claude Code needs approval");
          const desc = match[1].trim() || "Action requires approval";
          const cmd = match[0].trim();
          this.dataBuffer = "";
          try {
            const approved = await this.requestApprovalCallback(desc, cmd);
            if (!this.ptyProcess) return;
            if (approved) {
              this.ptyProcess.write("y\r");
              this.emitStatus("working", "Action approved, continuing...");
            } else {
              this.ptyProcess.write("n\r");
              this.emitStatus("working", "Action denied.");
            }
          } catch (err) {
            console.error("[ClaudeAdapter] Approval failed:", err);
            if (this.ptyProcess) this.ptyProcess.write("n\r");
            this.emitStatus("working", "Approval error, defaulted to denied.");
          } finally {
            this.pendingApproval = false;
          }
        }
      }
      emitLog(level, message) {
        if (!this.eventCallback) return;
        this.eventCallback({
          id: import_crypto5.default.randomUUID(),
          timestamp: Date.now(),
          source: "adapter:claude",
          type: "agent.log",
          payload: { level, message }
        });
      }
      emitStatus(status, message) {
        if (!this.eventCallback) return;
        this.eventCallback({
          id: import_crypto5.default.randomUUID(),
          timestamp: Date.now(),
          source: "adapter:claude",
          type: "agent.status",
          payload: { status, message }
        });
      }
    };
  }
});

// ../../packages/adapters/src/index.ts
var init_src = __esm({
  "../../packages/adapters/src/index.ts"() {
    "use strict";
    init_AiderAdapter();
    init_ClaudeAdapter();
  }
});

// src/services/workspaceMonitor.ts
var import_chokidar, import_simple_git, import_crypto6, WorkspaceMonitor;
var init_workspaceMonitor = __esm({
  "src/services/workspaceMonitor.ts"() {
    "use strict";
    import_chokidar = __toESM(require("chokidar"));
    import_simple_git = __toESM(require("simple-git"));
    import_crypto6 = __toESM(require("crypto"));
    WorkspaceMonitor = class {
      constructor(workspacePath) {
        this.workspacePath = workspacePath;
        this.git = (0, import_simple_git.default)(workspacePath);
      }
      workspacePath;
      watcher = null;
      git;
      eventCallback;
      async start() {
        if (this.watcher) return;
        const isRepo = await this.git.checkIsRepo();
        if (!isRepo) {
          console.warn(`[WorkspaceMonitor] Workspace ${this.workspacePath} is not a git repository. Diff tracking will be disabled.`);
        }
        this.watcher = import_chokidar.default.watch(this.workspacePath, {
          ignored: [
            /(^|[\/\\])\../,
            // ignore dotfiles
            /node_modules/,
            /dist/,
            /build/
          ],
          persistent: true,
          ignoreInitial: true,
          awaitWriteFinish: {
            stabilityThreshold: 500,
            pollInterval: 100
          }
        });
        this.watcher.on("add", (path3) => this.handleFileEvent(path3, "added")).on("change", (path3) => this.handleFileEvent(path3, "modified")).on("unlink", (path3) => this.handleFileEvent(path3, "deleted"));
        console.log(`[WorkspaceMonitor] Started watching ${this.workspacePath}`);
      }
      async stop() {
        if (this.watcher) {
          await this.watcher.close();
          this.watcher = null;
          console.log(`[WorkspaceMonitor] Stopped watching ${this.workspacePath}`);
        }
      }
      onEvent(callback) {
        this.eventCallback = callback;
      }
      async handleFileEvent(filePath, changeType) {
        if (!this.eventCallback) return;
        let diff = void 0;
        try {
          const isRepo = await this.git.checkIsRepo();
          if (isRepo) {
            diff = await this.git.diff([filePath]);
            if (!diff && changeType === "added") {
              diff = "New untracked file";
            }
          }
        } catch (err) {
          console.error(`[WorkspaceMonitor] Failed to get diff for ${filePath}:`, err);
        }
        const payload = {
          filePath,
          changeType,
          diff
        };
        this.eventCallback({
          id: import_crypto6.default.randomUUID(),
          timestamp: Date.now(),
          source: "server:workspace_monitor",
          type: "file.changed",
          payload
        });
      }
    };
  }
});

// src/services/ApprovalManager.ts
var ApprovalManager_exports = {};
__export(ApprovalManager_exports, {
  ApprovalManager: () => ApprovalManager,
  approvalManager: () => approvalManager
});
var import_crypto7, ApprovalManager, approvalManager;
var init_ApprovalManager = __esm({
  "src/services/ApprovalManager.ts"() {
    "use strict";
    init_EventBus();
    import_crypto7 = __toESM(require("crypto"));
    init_DatabaseService();
    ApprovalManager = class {
      pendingApprovals = /* @__PURE__ */ new Map();
      constructor() {
        this.listenForResponses();
      }
      listenForResponses() {
        eventBus.subscribe("client.approval_response", (event) => {
          const { actionId, approved } = event.payload;
          try {
            const db = dbService.getDb();
            const update = db.prepare("UPDATE approvals SET status = ? WHERE action_id = ? AND status = ?");
            update.run(approved ? "approved" : "denied", actionId, "pending");
          } catch (dbErr) {
            console.error("[ApprovalManager] Failed to update approval response in database:", dbErr);
          }
          const pending = this.pendingApprovals.get(actionId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pending.resolve(approved);
            this.pendingApprovals.delete(actionId);
            console.log(`[ApprovalManager] Action ${actionId} resolved as ${approved ? "APPROVED" : "DENIED"}`);
          } else {
            console.log(`[ApprovalManager] Action ${actionId} resolved via EventBus as ${approved ? "APPROVED" : "DENIED"} (no active process resolver)`);
          }
        });
      }
      /**
       * Suspends execution and requests user approval via the EventBus.
       * @returns A promise that resolves to true if approved, false if denied or timed out.
       */
      requestApproval(projectId, description, command, timeoutMs = 3e5) {
        const actionId = import_crypto7.default.randomUUID();
        try {
          const db = dbService.getDb();
          const insert = db.prepare("INSERT INTO approvals (id, project_id, action_id, description, command, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
          insert.run(import_crypto7.default.randomUUID(), projectId, actionId, description, command, "pending", Date.now());
        } catch (dbErr) {
          console.error("[ApprovalManager] Failed to write pending approval to database:", dbErr);
        }
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            if (this.pendingApprovals.has(actionId)) {
              this.pendingApprovals.delete(actionId);
              console.log(`[ApprovalManager] Action ${actionId} timed out.`);
              try {
                const db = dbService.getDb();
                const update = db.prepare("UPDATE approvals SET status = 'expired' WHERE action_id = ? AND status = 'pending'");
                update.run(actionId);
              } catch (dbErr) {
                console.error("[ApprovalManager] Failed to update approval timeout in database:", dbErr);
              }
              resolve(false);
            }
          }, timeoutMs);
          this.pendingApprovals.set(actionId, { resolve, reject, timeoutId });
          console.log(`[ApprovalManager] Requesting approval for action ${actionId} (${description})`);
          eventBus.publish({
            id: import_crypto7.default.randomUUID(),
            timestamp: Date.now(),
            source: "system:approval_manager",
            type: "agent.approval_request",
            payload: {
              projectId,
              actionId,
              description,
              command
            }
          });
        });
      }
      recoverPendingApprovals() {
        try {
          const db = dbService.getDb();
          const query = db.prepare("SELECT * FROM approvals WHERE status = 'pending'");
          const rows = query.all();
          if (rows.length === 0) return;
          for (const row of rows) {
            console.log(`[ApprovalManager] Recovering pending approval ${row.action_id} for project ${row.project_id}`);
            eventBus.publish({
              id: import_crypto7.default.randomUUID(),
              timestamp: Date.now(),
              source: "system:approval_manager",
              type: "agent.approval_request",
              payload: {
                projectId: row.project_id,
                actionId: row.action_id,
                description: row.description,
                command: row.command
              }
            });
          }
        } catch (err) {
          console.error("[ApprovalManager] Failed to recover pending approvals:", err);
        }
      }
    };
    approvalManager = new ApprovalManager();
  }
});

// src/services/AgentService.ts
var AgentService_exports = {};
__export(AgentService_exports, {
  AgentService: () => AgentService,
  agentService: () => agentService
});
var import_crypto8, AgentService, agentService;
var init_AgentService = __esm({
  "src/services/AgentService.ts"() {
    "use strict";
    init_EventBus();
    init_src();
    init_workspaceMonitor();
    import_crypto8 = __toESM(require("crypto"));
    init_DatabaseService();
    AgentService = class {
      activeAdapters = /* @__PURE__ */ new Map();
      workspaceMonitors = /* @__PURE__ */ new Map();
      activeSessions = /* @__PURE__ */ new Map();
      // projectId -> sessionId
      constructor() {
        this.setupListeners();
      }
      setupListeners() {
        eventBus.subscribe("client.command", async (event) => {
          try {
            const { command } = event.payload;
            const projectId = event.payload.projectId;
            const agentType = event.payload.agentType || "aider";
            if (!projectId) {
              console.error("[AgentService] client.command requires projectId");
              return;
            }
            if (command === "start") {
              const { projectManager: projectManager2 } = await Promise.resolve().then(() => (init_ProjectManager(), ProjectManager_exports));
              const project = projectManager2.getProject(projectId);
              if (!project) {
                console.error(`[AgentService] Project ${projectId} not found`);
                return;
              }
              await this.startAgent(projectId, project.path, agentType);
            } else if (command === "stop") {
              await this.stopAgent(projectId);
            } else {
              await this.sendCommand(projectId, command);
            }
          } catch (err) {
            console.error("[AgentService] FATAL ERROR processing command:", err);
          }
        });
        eventBus.subscribe("client.stdin", async (event) => {
          try {
            const { data, projectId } = event.payload;
            if (!projectId) return;
            const adapter = this.activeAdapters.get(projectId);
            if (adapter && adapter.writeStdin) {
              adapter.writeStdin(data);
            }
          } catch (err) {
            console.error("[AgentService] Error processing stdin:", err);
          }
        });
      }
      async startAgent(projectId, workspace, agentType) {
        if (this.activeAdapters.has(projectId)) {
          console.log(`[AgentService] Agent already running for project ${projectId}`);
          return;
        }
        const adapter = agentType === "claude" ? new ClaudeAdapter() : new AiderAdapter();
        adapter.onEvent((event) => {
          event.payload = { ...event.payload, projectId };
          eventBus.publish(event);
        });
        try {
          const { approvalManager: approvalManager2 } = await Promise.resolve().then(() => (init_ApprovalManager(), ApprovalManager_exports));
          await adapter.start({
            workspace,
            requestApproval: (desc, cmd) => approvalManager2.requestApproval(projectId, desc, cmd),
            onExit: (exitCode) => {
              const sessionId2 = this.activeSessions.get(projectId);
              if (sessionId2) {
                try {
                  const db = dbService.getDb();
                  const status = exitCode === 0 ? "exited" : "crashed";
                  const update = db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?");
                  update.run(status, Date.now(), sessionId2);
                  console.log(`[AgentService] Agent session ${sessionId2} for project ${projectId} exited naturally: ${status}`);
                } catch (dbErr) {
                  console.error("[AgentService] Failed to update session exit status in database:", dbErr);
                }
                this.activeSessions.delete(projectId);
              }
              this.stopAgent(projectId);
            }
          });
          const sessionId = import_crypto8.default.randomUUID();
          try {
            const db = dbService.getDb();
            const insert = db.prepare("INSERT INTO sessions (id, project_id, agent_type, status, pid, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
            const pid = typeof adapter.getPid === "function" ? adapter.getPid() : null;
            insert.run(sessionId, projectId, agentType, "running", pid, Date.now(), Date.now());
            this.activeSessions.set(projectId, sessionId);
          } catch (dbErr) {
            console.error("[AgentService] Failed to write new session to database:", dbErr);
          }
          this.activeAdapters.set(projectId, adapter);
          const monitor = new WorkspaceMonitor(workspace);
          monitor.onEvent((event) => {
            event.payload = { ...event.payload, projectId };
            eventBus.publish(event);
          });
          await monitor.start();
          this.workspaceMonitors.set(projectId, monitor);
          console.log(`[AgentService] Started ${agentType} for project ${projectId}`);
        } catch (err) {
          console.error(`[AgentService] Failed to start agent for project ${projectId}:`, err);
          eventBus.publish({
            id: import_crypto8.default.randomUUID(),
            timestamp: Date.now(),
            source: "server",
            type: "agent.status",
            payload: {
              status: "idle",
              message: `Error starting agent: ${err.message || String(err)}. Is Aider installed?`,
              projectId
            }
          });
        }
      }
      async stopAgent(projectId) {
        const sessionId = this.activeSessions.get(projectId);
        if (sessionId) {
          try {
            const db = dbService.getDb();
            const update = db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?");
            update.run("stopped", Date.now(), sessionId);
          } catch (dbErr) {
            console.error("[AgentService] Failed to update session stop status in database:", dbErr);
          }
          this.activeSessions.delete(projectId);
        }
        const adapter = this.activeAdapters.get(projectId);
        if (adapter) {
          await adapter.stop();
          this.activeAdapters.delete(projectId);
        }
        const monitor = this.workspaceMonitors.get(projectId);
        if (monitor) {
          await monitor.stop();
          this.workspaceMonitors.delete(projectId);
        }
        console.log(`[AgentService] Stopped agent and monitor for project ${projectId}`);
      }
      async sendCommand(projectId, command) {
        const adapter = this.activeAdapters.get(projectId);
        if (adapter) {
          await adapter.sendCommand(command);
        } else {
          console.log(`[AgentService] No active agent for project ${projectId} to receive command`);
        }
      }
      recoverSessions() {
        try {
          const db = dbService.getDb();
          const query = db.prepare("SELECT * FROM sessions WHERE status = 'running'");
          const rows = query.all();
          if (rows.length === 0) return;
          const update = db.prepare("UPDATE sessions SET status = 'crashed', updated_at = ? WHERE id = ?");
          for (const row of rows) {
            update.run(Date.now(), row.id);
            console.log(`[AgentService] Recovered active session ${row.id} for project ${row.project_id} (marked as crashed)`);
            eventBus.publish({
              id: import_crypto8.default.randomUUID(),
              timestamp: Date.now(),
              source: "server",
              type: "agent.status",
              payload: {
                status: "error",
                message: "Agent crashed or server restarted unexpectedly.",
                projectId: row.project_id
              }
            });
          }
        } catch (err) {
          console.error("[AgentService] Failed to recover running sessions:", err);
        }
      }
    };
    agentService = new AgentService();
  }
});

// ../../packages/shared/src/events.ts
var init_events = __esm({
  "../../packages/shared/src/events.ts"() {
    "use strict";
  }
});

// ../../packages/shared/src/adapters.ts
var init_adapters = __esm({
  "../../packages/shared/src/adapters.ts"() {
    "use strict";
  }
});

// ../../packages/shared/src/state.ts
var init_state = __esm({
  "../../packages/shared/src/state.ts"() {
    "use strict";
  }
});

// ../../packages/shared/src/crypto.ts
async function generateECDHKeyPair() {
  return await cryptoProvider.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    ["deriveKey", "deriveBits"]
  );
}
async function exportPublicKey(key) {
  return await cryptoProvider.subtle.exportKey("jwk", key);
}
async function importPublicKey(jwk) {
  return await cryptoProvider.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    []
  );
}
async function deriveSharedSecret(privateKey, publicKey) {
  return await cryptoProvider.subtle.deriveKey(
    {
      name: "ECDH",
      public: publicKey
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToArrayBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}
async function encryptPayload(key, payload) {
  const enc = new TextEncoder();
  const encodedPayload = enc.encode(JSON.stringify(payload));
  const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoProvider.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    encodedPayload
  );
  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertext)
  };
}
async function decryptPayload(key, encrypted) {
  const ivBuffer = base64ToArrayBuffer(encrypted.iv);
  const ciphertextBuffer = base64ToArrayBuffer(encrypted.ciphertext);
  const decrypted = await cryptoProvider.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(ivBuffer)
    },
    key,
    ciphertextBuffer
  );
  const dec = new TextDecoder();
  const jsonStr = dec.decode(decrypted);
  return JSON.parse(jsonStr);
}
var cryptoProvider;
var init_crypto = __esm({
  "../../packages/shared/src/crypto.ts"() {
    "use strict";
    cryptoProvider = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : require("crypto").webcrypto;
  }
});

// ../../packages/shared/src/index.ts
var init_src2 = __esm({
  "../../packages/shared/src/index.ts"() {
    "use strict";
    init_events();
    init_adapters();
    init_state();
    init_crypto();
  }
});

// src/services/RelayClient.ts
var RelayClient_exports = {};
__export(RelayClient_exports, {
  RelayClient: () => RelayClient,
  relayClient: () => relayClient
});
var import_socket2, import_crypto9, RelayClient, relayClient;
var init_RelayClient = __esm({
  "src/services/RelayClient.ts"() {
    "use strict";
    import_socket2 = require("socket.io-client");
    init_EventBus();
    init_src2();
    import_crypto9 = __toESM(require("crypto"));
    init_PairingService();
    RelayClient = class {
      socket = null;
      tunnelId;
      /** The relay server URL this client is connected to. Served to web clients via /api/v1/system. */
      relayUrl;
      keyPair = null;
      // Mapping of mobile client socket IDs to their shared AES keys
      clientKeys = /* @__PURE__ */ new Map();
      authenticatedClients = /* @__PURE__ */ new Set();
      constructor() {
        this.tunnelId = import_crypto9.default.randomBytes(3).toString("hex").toUpperCase();
        this.relayUrl = process.env.AGENTDECK_RELAY_URL || "http://localhost:4000";
        this.init();
      }
      async init() {
        this.keyPair = await generateECDHKeyPair();
        console.log(`[RelayClient] Connecting to relay: ${this.relayUrl}`);
        this.socket = (0, import_socket2.io)(this.relayUrl);
        this.socket.on("connect", () => {
          console.log(`[RelayClient] Connected to Cloud Relay. Tunnel ID: ${this.tunnelId}`);
          this.socket?.emit("register_tunnel", this.tunnelId);
        });
        this.socket.on("client_joined", async ({ clientId }) => {
          console.log(`[RelayClient] Mobile client ${clientId} joined tunnel`);
          if (this.keyPair) {
            const jwk = await exportPublicKey(this.keyPair.publicKey);
            this.socket?.emit("tunnel_message", {
              tunnelId: this.tunnelId,
              payload: {
                type: "e2e_handshake_server",
                targetClient: clientId,
                publicKey: jwk
              }
            });
          }
        });
        this.socket.on("tunnel_message", async (message) => {
          if (message.type === "e2e_handshake_client") {
            console.log(`[RelayClient] Received public key from mobile client`);
            if (this.keyPair) {
              const clientPubKey = await importPublicKey(message.publicKey);
              const sharedSecret = await deriveSharedSecret(this.keyPair.privateKey, clientPubKey);
              this.clientKeys.set(message.sourceClient, sharedSecret);
              console.log(`[RelayClient] E2E Encryption established with ${message.sourceClient}`);
            }
          } else if (message.type === "encrypted_payload") {
            const sourceClient = message.sourceClient;
            const sharedKey = this.clientKeys.get(sourceClient);
            if (sharedKey) {
              try {
                const decryptedEvent = await decryptPayload(sharedKey, message.encrypted);
                const isAuthenticated = this.authenticatedClients.has(sourceClient);
                if (!isAuthenticated) {
                  if (decryptedEvent.type === "client.pair") {
                    const { pin } = decryptedEvent.payload;
                    if (pairingService.validatePin(pin) || pairingService.validateToken(pin)) {
                      this.authenticatedClients.add(sourceClient);
                      const token = pairingService.generateToken();
                      const authResultEvent = {
                        id: import_crypto9.default.randomUUID(),
                        timestamp: Date.now(),
                        source: "server",
                        type: "server.auth_result",
                        payload: { success: true, token }
                      };
                      const encrypted = await encryptPayload(sharedKey, authResultEvent);
                      this.socket?.emit("tunnel_message", {
                        tunnelId: this.tunnelId,
                        payload: { type: "encrypted_payload", targetClient: sourceClient, encrypted }
                      });
                      console.log(`[RelayClient] Client ${sourceClient} authenticated successfully.`);
                    } else {
                      const authResultEvent = {
                        id: import_crypto9.default.randomUUID(),
                        timestamp: Date.now(),
                        source: "server",
                        type: "server.auth_result",
                        payload: { success: false, error: "Invalid PIN or Token" }
                      };
                      const encrypted = await encryptPayload(sharedKey, authResultEvent);
                      this.socket?.emit("tunnel_message", {
                        tunnelId: this.tunnelId,
                        payload: { type: "encrypted_payload", targetClient: sourceClient, encrypted }
                      });
                      console.warn(`[RelayClient] Client ${sourceClient} failed authentication.`);
                    }
                  } else {
                    console.warn(`[RelayClient] Dropping unauthenticated message type ${decryptedEvent.type} from ${sourceClient}`);
                  }
                  return;
                }
                eventBus.publish(decryptedEvent);
              } catch (err) {
                console.error("[RelayClient] Failed to decrypt message from mobile client", err);
              }
            }
          }
        });
        eventBus.subscribe("*", async (event) => {
          if (event.source?.startsWith("remote:")) return;
          for (const [clientId, sharedKey] of this.clientKeys.entries()) {
            if (!this.authenticatedClients.has(clientId)) continue;
            try {
              const encrypted = await encryptPayload(sharedKey, event);
              this.socket?.emit("tunnel_message", {
                tunnelId: this.tunnelId,
                payload: {
                  type: "encrypted_payload",
                  targetClient: clientId,
                  encrypted
                }
              });
            } catch (err) {
              console.error(`[RelayClient] Failed to encrypt event for ${clientId}`, err);
            }
          }
        });
      }
    };
    relayClient = new RelayClient();
  }
});

// src/services/mDNSService.ts
var mDNSService_exports = {};
__export(mDNSService_exports, {
  MDNSService: () => MDNSService,
  mdnsService: () => mdnsService
});
var import_bonjour_service, MDNSService, mdnsService;
var init_mDNSService = __esm({
  "src/services/mDNSService.ts"() {
    "use strict";
    import_bonjour_service = __toESM(require("bonjour-service"));
    MDNSService = class {
      bonjour = null;
      service = null;
      start(port) {
        try {
          this.bonjour = new import_bonjour_service.default();
          this.service = this.bonjour.publish({
            name: "AgentDeck Server",
            type: "http",
            port,
            txt: { service: "agentdeck" }
          });
          console.log(`[mDNS] Publishing AgentDeck service on port ${port}`);
        } catch (err) {
          console.error("[mDNS] Failed to start mDNS service:", err);
        }
      }
      stop() {
        if (this.service) {
          this.service.stop();
          this.service = null;
        }
        if (this.bonjour) {
          this.bonjour.destroy();
          this.bonjour = null;
        }
        console.log("[mDNS] Stopped mDNS service");
      }
    };
    mdnsService = new MDNSService();
  }
});

// src/services/StartupService.ts
var StartupService_exports = {};
__export(StartupService_exports, {
  StartupService: () => StartupService,
  startupService: () => startupService
});
var import_child_process, import_os2, import_qrcode_terminal, StartupService, startupService;
var init_StartupService = __esm({
  "src/services/StartupService.ts"() {
    "use strict";
    import_child_process = require("child_process");
    import_os2 = __toESM(require("os"));
    import_qrcode_terminal = __toESM(require("qrcode-terminal"));
    init_DatabaseService();
    StartupService = class {
      checkFirstRun(port, pairingPin, tunnelId) {
        try {
          const db = dbService.getDb();
          const query = db.prepare("SELECT value FROM settings WHERE key = 'first_run_completed'");
          const row = query.get();
          const isFirstRun = !row || row.value !== "true";
          if (!isFirstRun) {
            return;
          }
          const localIp = this.getLocalIpAddress();
          const host = localIp || "localhost";
          const pairingUrl = `http://${host}:${port}/?pin=${pairingPin}`;
          const hasClaude = this.isBinaryOnPath("claude");
          const hasAider = this.isBinaryOnPath("aider");
          console.log("\n==================================================");
          console.log("           WELCOME TO AGENTDECK v0.1");
          console.log("      AI Agent Control Plane is Initialized");
          console.log("==================================================");
          console.log(`  Local URL    : http://localhost:${port}`);
          if (localIp) {
            console.log(`  LAN URL      : http://${localIp}:${port}`);
          }
          console.log(`  Pairing PIN  : ${pairingPin}`);
          if (tunnelId) {
            console.log(`  Tunnel ID    : ${tunnelId}`);
          } else {
            console.log("  Tunnel ID    : Not connected to relay server");
          }
          console.log("==================================================\n");
          if (!hasClaude) {
            console.warn(`\x1B[33m\u26A0\uFE0F  Warning: 'claude' CLI binary was not found on your PATH.
   Claude Code is required for the Claude Agent.
   Install via: npm install -g @anthropic-ai/claude-code\x1B[0m
`);
          }
          if (!hasAider) {
            console.warn(`\x1B[33m\u26A0\uFE0F  Warning: 'aider' CLI binary was not found on your PATH.
   Aider is required for the Aider Agent.
   Install via: pip install aider-chat\x1B[0m
`);
          }
          console.log("Scan this QR code with your mobile device to pair automatically:");
          import_qrcode_terminal.default.generate(pairingUrl, { small: true });
          console.log(`Pairing URL: ${pairingUrl}
`);
        } catch (err) {
          console.error("[StartupService] Error executing first-run onboarding checks:", err);
        }
      }
      getLocalIpAddress() {
        const interfaces = import_os2.default.networkInterfaces();
        for (const devName in interfaces) {
          const iface = interfaces[devName];
          if (!iface) continue;
          for (const alias of iface) {
            if (alias.family === "IPv4" && !alias.internal) {
              return alias.address;
            }
          }
        }
        return null;
      }
      isBinaryOnPath(binary) {
        try {
          const cmd = process.platform === "win32" ? `where ${binary}` : `which ${binary}`;
          (0, import_child_process.execSync)(cmd, { stdio: "ignore" });
          return true;
        } catch (e) {
          return false;
        }
      }
    };
    startupService = new StartupService();
  }
});

// src/index.ts
var import_fastify = __toESM(require("fastify"));
var import_cors = __toESM(require("@fastify/cors"));
var import_static = __toESM(require("@fastify/static"));
var import_path2 = __toESM(require("path"));
var import_fs2 = __toESM(require("fs"));
var import_os3 = __toESM(require("os"));

// src/sockets/socketManager.ts
var import_socket = require("socket.io");
init_EventBus();
init_DatabaseService();
init_PairingService();
var import_crypto2 = __toESM(require("crypto"));
var SocketManager = class {
  io;
  constructor(fastify2) {
    this.io = new import_socket.Server(fastify2.server, {
      cors: {
        origin: "*",
        // For local MVP, allow all local network origins
        methods: ["GET", "POST"]
      }
    });
    this.setupMiddleware();
    this.setupListeners();
    this.setupEventBusBridge();
  }
  setupMiddleware() {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("unauthorized"));
      }
      if (!pairingService.validateToken(token)) {
        return next(new Error("unauthorized"));
      }
      next();
    });
  }
  setupListeners() {
    this.io.on("connection", (socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);
      socket.on("join_project", (projectId) => {
        socket.join(projectId);
        console.log(`[Socket.IO] Client ${socket.id} joined project: ${projectId}`);
        this.syncHistory(socket, projectId);
      });
      socket.on("client_event", (event) => {
        event.source = event.source || `client:${socket.id}`;
        eventBus.publish(event);
      });
      socket.on("disconnect", () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      });
    });
  }
  syncHistory(socket, projectId) {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT payload_json FROM events WHERE project_id = ? ORDER BY timestamp DESC LIMIT 1000");
      const rows = query.all(projectId);
      const historyEvents = rows.reverse().map((row) => JSON.parse(row.payload_json));
      socket.emit("session.history", historyEvents);
    } catch (err) {
      console.error("[Socket.IO] Failed to sync history:", err);
    }
  }
  /**
   * Bridges internal EventBus events out to connected WebSocket clients and persists them.
   */
  setupEventBusBridge() {
    eventBus.subscribe("*", (event) => {
      const projectId = event.payload?.projectId;
      if (projectId) {
        this.io.to(projectId).emit(event.type, event);
        try {
          const db = dbService.getDb();
          const insert = db.prepare("INSERT INTO events (id, project_id, timestamp, source, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)");
          insert.run(
            import_crypto2.default.randomUUID(),
            projectId,
            event.timestamp || Date.now(),
            event.source,
            event.type,
            JSON.stringify(event)
          );
        } catch (err) {
          console.error("[Database] Failed to persist event:", err);
        }
      } else {
        this.io.emit(event.type, event);
      }
    });
  }
};

// src/routes/projects.ts
init_ProjectManager();
async function projectRoutes(fastify2) {
  fastify2.get("/api/v1/projects", async (request, reply) => {
    return { projects: projectManager.getProjects() };
  });
  fastify2.post("/api/v1/projects", async (request, reply) => {
    const { name, path: path3 } = request.body;
    if (!name || !path3) {
      reply.code(400);
      return { error: "Name and path are required" };
    }
    const project = projectManager.addProject(name, path3);
    return { project };
  });
  fastify2.delete("/api/v1/projects/:id", async (request, reply) => {
    const { id } = request.params;
    projectManager.removeProject(id);
    return { success: true };
  });
}

// src/index.ts
init_AgentService();
init_DatabaseService();

// src/services/PruningService.ts
init_DatabaseService();
var RETENTION_MS = 7 * 24 * 60 * 60 * 1e3;
var MAX_EVENTS_PER_PROJECT = 5e4;
var TRIM_TO_PER_PROJECT = 25e3;
var PRUNE_INTERVAL_MS = 60 * 60 * 1e3;
var PruningService = class {
  intervalHandle = null;
  /**
   * Runs an immediate startup prune, then schedules hourly pruning.
   */
  start() {
    this.prune();
    this.intervalHandle = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    this.intervalHandle.unref();
    console.log("[PruningService] Scheduled \u2014 runs every 1 hour");
  }
  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
  /**
   * Main pruning routine:
   * 1. Delete events older than RETENTION_MS globally.
   * 2. For each project exceeding MAX_EVENTS_PER_PROJECT, trim the oldest
   *    down to TRIM_TO_PER_PROJECT.
   */
  prune() {
    const db = dbService.getDb();
    const cutoff = Date.now() - RETENTION_MS;
    try {
      const timeResult = db.prepare(
        "DELETE FROM events WHERE timestamp < ?"
      ).run(cutoff);
      if (timeResult.changes > 0) {
        console.log(`[PruningService] Time prune: removed ${timeResult.changes} events older than 7 days`);
      }
      const projects = db.prepare("SELECT id FROM projects").all();
      for (const { id: projectId } of projects) {
        const countRow = db.prepare(
          "SELECT COUNT(*) as count FROM events WHERE project_id = ?"
        ).get(projectId);
        if (countRow.count > MAX_EVENTS_PER_PROJECT) {
          const excess = countRow.count - TRIM_TO_PER_PROJECT;
          const capResult = db.prepare(`
            DELETE FROM events
            WHERE id IN (
              SELECT id FROM events
              WHERE project_id = ?
              ORDER BY timestamp ASC
              LIMIT ?
            )
          `).run(projectId, excess);
          console.log(
            `[PruningService] Cap prune project ${projectId}: removed ${capResult.changes} events (was ${countRow.count}, now ~${TRIM_TO_PER_PROJECT})`
          );
        }
      }
    } catch (err) {
      console.error("[PruningService] Prune failed:", err);
    }
  }
};
var pruningService = new PruningService();

// src/middleware/authMiddleware.ts
var import_fastify_plugin = __toESM(require("fastify-plugin"));
init_PairingService();
var authMiddleware = (0, import_fastify_plugin.default)(async (fastify2) => {
  fastify2.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/")) return;
    if (request.url.startsWith("/api/v1/auth/pair")) return;
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      reply.status(401).send({ error: "Unauthorized: Missing or invalid token" });
      return reply;
    }
    const token = authHeader.substring(7);
    if (!pairingService.validateToken(token)) {
      reply.status(401).send({ error: "Unauthorized: Invalid token or expired" });
      return reply;
    }
  });
});

// src/index.ts
init_RelayClient();

// src/services/PushService.ts
var import_web_push = __toESM(require("web-push"));
init_DatabaseService();
init_EventBus();
var PushService = class {
  vapidPublicKey = "";
  vapidPrivateKey = "";
  constructor() {
    this.init();
    this.setupListeners();
  }
  init() {
    const db = dbService.getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("vapid_keys");
    if (row) {
      const keys = JSON.parse(row.value);
      this.vapidPublicKey = keys.publicKey;
      this.vapidPrivateKey = keys.privateKey;
    } else {
      const vapidKeys = import_web_push.default.generateVAPIDKeys();
      this.vapidPublicKey = vapidKeys.publicKey;
      this.vapidPrivateKey = vapidKeys.privateKey;
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("vapid_keys", JSON.stringify(vapidKeys));
    }
    import_web_push.default.setVapidDetails(
      "mailto:agentdeck@example.com",
      this.vapidPublicKey,
      this.vapidPrivateKey
    );
    console.log("[PushService] Web Push initialized");
  }
  getPublicKey() {
    return this.vapidPublicKey;
  }
  addSubscription(subscription) {
    const db = dbService.getDb();
    const existing = db.prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?").get(subscription.endpoint);
    if (!existing) {
      db.prepare("INSERT INTO push_subscriptions (endpoint, keys_json) VALUES (?, ?)").run(
        subscription.endpoint,
        JSON.stringify(subscription.keys)
      );
      console.log(`[PushService] Added new push subscription: ${subscription.endpoint.substring(0, 30)}...`);
    }
  }
  async sendPushNotification(title, body, data) {
    const db = dbService.getDb();
    const rows = db.prepare("SELECT endpoint, keys_json FROM push_subscriptions").all();
    const payload = JSON.stringify({
      title,
      body,
      data
    });
    for (const row of rows) {
      const pushSubscription = {
        endpoint: row.endpoint,
        keys: JSON.parse(row.keys_json)
      };
      try {
        await import_web_push.default.sendNotification(pushSubscription, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log(`[PushService] Removing expired subscription: ${row.endpoint.substring(0, 30)}...`);
          db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(row.endpoint);
        } else {
          console.error("[PushService] Failed to send push notification", err);
        }
      }
    }
  }
  setupListeners() {
    eventBus.subscribe("agent.approval_request", async (event) => {
      await this.sendPushNotification(
        "Agent Action Required",
        event.payload.description,
        {
          actionId: event.payload.actionId,
          projectId: event.payload.projectId
        }
      );
    });
  }
};
var pushService = new PushService();

// src/routes/system.ts
init_RelayClient();
init_DatabaseService();
async function systemRoutes(fastify2) {
  fastify2.get("/api/v1/system", async (request, reply) => {
    let isFirstRun = true;
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT value FROM settings WHERE key = 'first_run_completed'");
      const row = query.get();
      if (row && row.value === "true") {
        isFirstRun = false;
      }
    } catch (dbErr) {
      console.error("[SystemRoute] Failed to query settings for first run:", dbErr);
    }
    return {
      tunnelId: relayClient.tunnelId,
      relayUrl: relayClient.relayUrl,
      isFirstRun
    };
  });
  fastify2.post("/api/v1/system/first-run-complete", async (request, reply) => {
    try {
      const db = dbService.getDb();
      const insert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('first_run_completed', 'true')");
      insert.run();
      return { success: true };
    } catch (dbErr) {
      console.error("[SystemRoute] Failed to save first run complete status:", dbErr);
      reply.status(500).send({ error: "Failed to write setting" });
    }
  });
  fastify2.get("/api/v1/system/vapid", async (request, reply) => {
    return { publicKey: pushService.getPublicKey() };
  });
  fastify2.post("/api/v1/system/subscribe", async (request, reply) => {
    const subscription = request.body;
    pushService.addSubscription(subscription);
    return { success: true };
  });
}

// src/routes/auth.ts
init_PairingService();
async function authRoutes(fastify2) {
  const attempts = /* @__PURE__ */ new Map();
  fastify2.post("/api/v1/auth/pair", async (request, reply) => {
    const ip = request.ip;
    const now = Date.now();
    const record = attempts.get(ip) || { count: 0, timestamp: now };
    if (now - record.timestamp > 15 * 60 * 1e3) {
      record.count = 0;
      record.timestamp = now;
    }
    if (record.count >= 10) {
      console.warn(`[Auth] Pair attempt blocked due to rate limit from IP: ${ip}`);
      reply.status(429).send({ error: "Too many attempts. Please try again later." });
      return;
    }
    const body = request.body;
    if (!body || !body.pin) {
      reply.status(400).send({ error: "PIN is required" });
      return;
    }
    console.log(`[Auth] Received pairing request from IP: ${ip}`);
    if (pairingService.validatePin(body.pin)) {
      console.log(`[Auth] Pairing successful for IP: ${ip}`);
      attempts.delete(ip);
      const token = pairingService.generateToken();
      reply.send({ token });
    } else {
      console.warn(`[Auth] Pairing failed (Invalid PIN) for IP: ${ip}`);
      record.count += 1;
      attempts.set(ip, record);
      reply.status(401).send({ error: "Invalid PIN" });
    }
  });
  fastify2.get("/api/v1/auth/verify", async (request, reply) => {
    reply.send({ ok: true });
  });
}

// src/index.ts
var logCrash = (error, type) => {
  try {
    const crashDir = import_path2.default.join(import_os3.default.homedir(), ".agentdeck");
    if (!import_fs2.default.existsSync(crashDir)) import_fs2.default.mkdirSync(crashDir, { recursive: true });
    const logPath = import_path2.default.join(crashDir, "crash.log");
    const msg = `
[${(/* @__PURE__ */ new Date()).toISOString()}] ${type}: ${error.stack || error.message}
`;
    import_fs2.default.appendFileSync(logPath, msg);
    console.error(`[AgentDeck] ${type}:`, error);
  } catch (e) {
    console.error("Failed to write crash log", e);
  }
};
process.on("uncaughtException", (err) => {
  logCrash(err, "uncaughtException");
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  logCrash(err, "unhandledRejection");
});
var fastify = (0, import_fastify.default)({ logger: true });
var isLocalOrigin = (origin) => {
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".local") || /^192\.168\./.test(hostname) || /^10\./.test(hostname) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) || /^169\.254\./.test(hostname);
  } catch (e) {
    return false;
  }
};
var relayUrl = process.env.AGENTDECK_RELAY_URL || "http://localhost:4000";
fastify.register(import_cors.default, {
  origin: (origin, cb) => {
    if (!origin || origin === "null" || isLocalOrigin(origin) || origin.startsWith(relayUrl)) {
      cb(null, true);
      return;
    }
    cb(new Error("Not allowed"), false);
  }
});
fastify.register(authMiddleware);
var webDistPath = import_path2.default.join(__dirname, "web");
if (import_fs2.default.existsSync(webDistPath)) {
  fastify.register(import_static.default, {
    root: webDistPath,
    prefix: "/"
  });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api")) {
      reply.status(404).send({ error: "Not Found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}
dbService.getDb();
var socketManager = new SocketManager(fastify);
fastify.get("/health", async () => ({ status: "ok", service: "agentdeck-server" }));
var start = async () => {
  try {
    await fastify.register(authRoutes);
    await fastify.register(projectRoutes);
    await fastify.register(systemRoutes);
    const port = parseInt(process.env.PORT || "3000", 10);
    await fastify.listen({ port, host: "::" });
    console.log(`[Server] AgentDeck server listening on port ${port}`);
    const { agentService: agentService2 } = await Promise.resolve().then(() => (init_AgentService(), AgentService_exports));
    const { approvalManager: approvalManager2 } = await Promise.resolve().then(() => (init_ApprovalManager(), ApprovalManager_exports));
    agentService2.recoverSessions();
    approvalManager2.recoverPendingApprovals();
    pruningService.start();
    console.log("[Telemetry] Anonymous ping: AgentDeck Started");
    const { mdnsService: mdnsService2 } = await Promise.resolve().then(() => (init_mDNSService(), mDNSService_exports));
    mdnsService2.start(port);
    const { pairingService: pairingService2 } = await Promise.resolve().then(() => (init_PairingService(), PairingService_exports));
    const { relayClient: relayClient2 } = await Promise.resolve().then(() => (init_RelayClient(), RelayClient_exports));
    const { startupService: startupService2 } = await Promise.resolve().then(() => (init_StartupService(), StartupService_exports));
    startupService2.checkFirstRun(port, pairingService2.getPin(), relayClient2.tunnelId);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();

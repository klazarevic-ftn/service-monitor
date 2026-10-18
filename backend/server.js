const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const app = express();
const PORT = 3000;
const HOST = "127.0.0.1";
const HEALTH_INTERVAL = 3000;

app.use(express.json());
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

const { services } = JSON.parse(
    fs.readFileSync(path.join(__dirname, "services.json"), "utf8")
);

const statuses = new Map();
const busy = new Set();
let shuttingDown = false;

for (const service of services) {
    statuses.set(service.name, "unknown");
}

function pidFile(service) {
    return path.join(
        service.workingDirectory,
        "scripts", "run", `${service.name}.pid.json`
    );
}

function managedPid(service) {
    try {
        const entry = JSON.parse(
            fs.readFileSync(pidFile(service), "utf8").replace(/^\uFEFF/, "")
        );
        const pid = Number(entry.Pid);
        if (!Number.isSafeInteger(pid) || pid <= 0) return null;
        process.kill(pid, 0); // Test existence; does not kill the process.
        return pid;
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error(`[${service.name}] PID check failed:`, error);
        }

        return null;
    }
}

console.log(
    "USER PID CHECK:",
    managedPid(services.find(s => s.name === "user"))
);

async function checkHealth(service) {
    try {
        const response = await fetch(
            `http://127.0.0.1:${service.port}/actuator/health`,
            { signal: AbortSignal.timeout(2000) }
        );
        if (!response.ok) return "unhealthy";
        const health = await response.json();
        return health.status === "UP" ? "healthy" : "unhealthy";
    } catch {
        return "offline";
    }
}

async function updateStatuses() {
    await Promise.all(services.map(async service => {
        const status = await checkHealth(service);
        statuses.set(service.name, status);
    }));
}

const healthTimer = setInterval(updateStatuses, HEALTH_INTERVAL);
updateStatuses();

function runScript(service, scriptName) {
    const scriptPath = path.join(service.workingDirectory, "scripts", scriptName);
    if (!fs.existsSync(scriptPath)) {
        return Promise.reject(new Error(`Script not found: ${scriptPath}`));
    }

    return new Promise((resolve, reject) => {
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
            {
                cwd: service.workingDirectory,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"]
            }
        );
        let errorOutput = "";
        child.stdout.on("data", chunk => {
            process.stdout.write(`[${service.name}] ${chunk}`);
        });
        child.stderr.on("data", chunk => {
            errorOutput += chunk;
            process.stderr.write(`[${service.name}] ${chunk}`);
        });
        child.once("error", reject);
        child.once("exit", code => {
            if (code === 0) resolve();
            else reject(new Error(
                `${scriptName} failed (exit ${code}). ${errorOutput.trim()}`.trim()
            ));
        });
    });
}

async function startService(service) {
    // start.ps1 resets DB, starts Maven, waits for health, then seeds data.
    await runScript(service, "start.ps1");
    return managedPid(service);
}

async function stopService(service) {
    await runScript(service, "stop.ps1");
}

async function waitUntilOffline(service, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if ((await checkHealth(service)) === "offline") return;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Service ${service.name} is still responding on port ${service.port}`);
}

app.get("/api/services", (req, res) => {
    res.json(services.map(service => {
        const pid = managedPid(service);
        const operation = busy.has(service.name);
        return {
            name: service.name,
            displayName: service.displayName,
            port: service.port,
            status: operation ? "initializing" : statuses.get(service.name),
            pid,
            managed: pid !== null
        };
    }));
});

app.post("/api/services/control", async (req, res) => {
    if (shuttingDown) {
        return res.status(503).json({ error: "Monitor is shutting down" });
    }
    const { name, command } = req.body ?? {};
    const service = services.find(s => s.name === name);
    if (!service) return res.status(404).json({ error: "Unknown service" });
    if (!["start", "stop", "restart"].includes(command)) {
        return res.status(400).json({ error: "Invalid command" });
    }
    if (busy.has(name)) {
        return res.status(409).json({ error: "Operation already in progress" });
    }

    busy.add(name);
    try {
        let pid = null;
        if (command === "start") {
            if ((await checkHealth(service)) !== "offline" || managedPid(service)) {
                return res.status(409).json({ error: "Service is already running" });
            }
            pid = await startService(service);
        } else if (command === "stop") {
            await stopService(service);
        } else {
            await stopService(service);
            await waitUntilOffline(service);
            pid = await startService(service);
        }
        await updateStatuses();
        res.json({ name, command, result: "accepted", pid });
    } catch (error) {
        console.error(`[${name}] ${error.message}`);
        res.status(500).json({ error: error.message });
    } finally {
        busy.delete(name);
    }
});

async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Stopping Service Monitor and script-managed services...");
    clearInterval(healthTimer);

    // A start/restart may be executing; wait for it to complete before stopping.
    const deadline = Date.now() + 150000;
    while (busy.size && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    const results = await Promise.allSettled(
        services.filter(s => managedPid(s) !== null).map(s => stopService(s))
    );
    const failed = results.some(r => r.status === "rejected");
    for (const r of results) {
        if (r.status === "rejected") console.error("Shutdown failure:", r.reason);
    }
    console.log("Service Monitor shutdown complete.");
    process.exit(failed ? 1 : 0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app.listen(PORT, HOST, () => {
    console.log(`Service Monitor backend running at http://${HOST}:${PORT}`);
    console.log(`Configured services: ${services.length}`);
});

// Local-only shutdown API; separate from the frontend's /api proxy.
require("node:http").createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/shutdown") {
        res.writeHead(404);
        return res.end();
    }
    res.writeHead(200);
    res.end("Shutting down");
    setImmediate(shutdown);
}).listen(3001, "127.0.0.1");

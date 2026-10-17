
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

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

const processes = new Map();
const statuses = new Map();
const busy = new Set();

for (const service of services) {
    statuses.set(service.name, "unknown");
}

// Health monitoring

async function checkHealth(service) {
    try {
        const response = await fetch(
            `http://127.0.0.1:${service.port}/actuator/health`,
            {
                signal: AbortSignal.timeout(2000)
            }
        );

        if (!response.ok) {
            return "unhealthy";
        }

        const health = await response.json();

        return health.status === "UP"
            ? "healthy"
            : "unhealthy";

    } catch {
        return "offline";
    }
}

async function updateStatuses() {
    await Promise.all(
        services.map(async service => {
            const status = await checkHealth(service);
            statuses.set(service.name, status);
        })
    );
}

setInterval(updateStatuses, HEALTH_INTERVAL);
updateStatuses();

// Process management

function startService(service) {
    if (processes.has(service.name)) {
        throw new Error("Service is already managed");
    }

    const wrapper = path.join(
        service.workingDirectory,
        "mvnw.cmd"
    );

    if (!fs.existsSync(wrapper)) {
        throw new Error(`Maven wrapper not found: ${wrapper}`);
    }

    const child = spawn(
        "cmd.exe",
        ["/d", "/s", "/c", "mvnw.cmd spring-boot:run"],
        {
            cwd: service.workingDirectory,
            env: {
                ...process.env,
                SERVER_PORT: String(service.port)
            },
            stdio: "inherit",
            windowsHide: true
        }
    );

    if (!child.pid) {
        throw new Error("Failed to launch service");
    }

    const pid = child.pid;

    processes.set(service.name, pid);
    statuses.set(service.name, "starting");

    child.on("error", error => {
        console.error(
            `[${service.name}] Process error:`,
            error.message
        );

        if (processes.get(service.name) === pid) {
            processes.delete(service.name);
        }
    });

    child.on("exit", (code, signal) => {
        console.log(
            `[${service.name}] Process exited:`,
            code ?? signal
        );

        if (processes.get(service.name) === pid) {
            processes.delete(service.name);
        }
    });

    console.log(
        `[${service.name}] Started PID ${pid}, port ${service.port}`
    );

    return pid;
}

function stopService(service) {
    return new Promise((resolve, reject) => {
        const pid = processes.get(service.name);

        if (!pid) {
            return reject(
                new Error("No managed process found")
            );
        }

        execFile(
            "taskkill",
            ["/PID", String(pid), "/T", "/F"],
            (error, stdout, stderr) => {
                if (error) {
                    return reject(
                        new Error(stderr.trim() || error.message)
                    );
                }

                if (processes.get(service.name) === pid) {
                    processes.delete(service.name);
                }

                statuses.set(service.name, "stopping");

                console.log(
                    `[${service.name}] Stopped PID ${pid}`
                );

                resolve();
            }
        );
    });
}

async function waitUntilOffline(service, timeout = 10000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        const status = await checkHealth(service);

        if (status === "offline") {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(
        `Service ${service.name} is still responding on port ${service.port}`
    );
}

// API: List services

app.get("/api/services", (req, res) => {
    res.json(
        services.map(service => ({
            name: service.name,
            displayName: service.displayName,
            port: service.port,
            status: statuses.get(service.name),
            pid: processes.get(service.name) ?? null,
            managed: processes.has(service.name)
        }))
    );
});

// API: Control services

app.post("/api/services/control", async (req, res) => {
    const { name, command } = req.body ?? {};

    const service = services.find(
        service => service.name === name
    );

    if (!service) {
        return res.status(404).json({
            error: "Unknown service"
        });
    }

    if (!["start", "stop", "restart"].includes(command)) {
        return res.status(400).json({
            error: "Invalid command"
        });
    }

    if (busy.has(name)) {
        return res.status(409).json({
            error: "Operation already in progress"
        });
    }

    busy.add(name);

    try {
        let pid = null;

        if (command === "start") {
            const status = await checkHealth(service);

            if (status !== "offline") {
                return res.status(409).json({
                    error: "Service is already responding"
                });
            }

            if (processes.has(name)) {
                return res.status(409).json({
                    error: "Service process already exists"
                });
            }

            pid = startService(service);
        }

        if (command === "stop") {
            await stopService(service);
        }

        if (command === "restart") {
            await stopService(service);
            await waitUntilOffline(service);
            pid = startService(service);
        }

        res.json({
            name,
            command,
            result: "accepted",
            pid
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });

    } finally {
        busy.delete(name);
    }
});

// Start server

app.listen(PORT, HOST, () => {
    console.log(
        `Service Monitor backend running at http://${HOST}:${PORT}`
    );

    console.log(`Configured services: ${services.length}`);
});

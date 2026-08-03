const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = process.env.POS_PORT || '8000';
const URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.resolve(__dirname, '..');

let serverProcess = null;
let mainWindow = null;

function pingServer() {
    return new Promise((resolve) => {
        const req = http.get(URL, (res) => {
            res.resume();
            resolve(true);
        });

        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function waitForServer(maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        if (await pingServer()) {
            return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return false;
}

// If a server is already running on this port (e.g. `composer run dev` in
// a terminal, or Laragon), reuse it instead of spawning a second one that
// would just fail to bind the port.
async function ensureServerRunning() {
    if (await pingServer()) {
        return;
    }

    serverProcess = spawn(
        'php',
        ['artisan', 'serve', '--port', PORT],
        { cwd: PROJECT_ROOT, stdio: 'ignore', windowsHide: true },
    );

    if (!(await waitForServer())) {
        throw new Error(`Laravel server did not come up on ${URL}`);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadURL(URL);
}

app.whenReady().then(async () => {
    try {
        await ensureServerRunning();
    } catch (error) {
        console.error(error);
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Only kill the server if we're the one who spawned it - leave an
    // externally-started dev server (composer run dev, Laragon) alone.
    serverProcess?.kill();
});

"use strict";
const { app, BrowserWindow, protocol, ipcMain } = require("electron");
const path = require("path");
const isDev = require("electron-is-dev");
const { PythonShell } = require("python-shell");
const fs = require("fs");
let mainWindow;
let pythonProcess;
function createWindow() {
  protocol.registerFileProtocol("local-file", (request, callback) => {
    const filePath = request.url.replace("local-file://", "");
    try {
      return callback(decodeURIComponent(filePath));
    } catch (error) {
      console.error("Protocol error:", error);
      return callback({ error: -2 });
    }
  });
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: "./preload.js",
      devTools: !app.isPackaged,
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  const pythonPath = isDev ? path.join(__dirname, "../backend/main.py") : path.join(process.resourcesPath, "backend/main.py");
  pythonProcess = new PythonShell(pythonPath, {
    mode: "json",
    pythonOptions: ["-u"]
  });
  pythonProcess.on("message", function(message) {
    console.log("Python:", message);
  });
  pythonProcess.on("error", function(err) {
    console.error("Python Error:", err);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
ipcMain.handle("delete-profile-image", async (event, Imagepath) => {
  try {
    await fs.promises.unlink(path.join(process.resourcesPath, "backend", Imagepath));
  } catch (error) {
    console.error("Error deleting profile image:", error);
  }
});
ipcMain.handle("get-resource-path", async (event, relativePath) => {
  try {
    let basePath;
    if (isDev) {
      basePath = path.join(__dirname, "..");
    } else {
      basePath = process.resourcesPath;
    }
    const cleanPath = relativePath.replace(/^\/+/, "");
    const pathWithBackend = cleanPath.startsWith("backend/") ? cleanPath : `backend/${cleanPath}`;
    const fullPath = path.join(basePath, pathWithBackend);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return fullPath;
    } catch {
      console.error("File not found:", fullPath);
      return null;
    }
  } catch (error) {
    console.error("Error resolving path:", error);
    return null;
  }
});
app.whenReady().then(() => {
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (pythonProcess) {
      pythonProcess.end();
    }
    app.quit();
  }
});
app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

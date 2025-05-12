"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
contextBridge.exposeInMainWorld("electronAPI", {
  // IPC communication
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // File system operations
  readFile: (filePath) => fs.promises.readFile(filePath, "utf8"),
  writeFile: (filePath, data) => fs.promises.writeFile(filePath, data, "utf8"),
  readdir: (dirPath) => fs.promises.readdir(dirPath),
  stat: (path) => fs.promises.stat(path),
  exists: (path) => fs.promises.access(path).then(() => true).catch(() => false)
});
contextBridge.exposeInMainWorld("ipcRenderer", {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
});

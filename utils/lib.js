// utils/lib.js

const fs   = require('fs');
const path = require('path');

/**
 * Ensure a directory exists, creating it (and parents) if needed.
 * @param {string} dirPath - Path to the directory.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Ensure a JSON file exists. If missing, write defaultValue.
 * @param {string} filePath - Path to the JSON file.
 * @param {*} defaultValue - Default value to initialize the file with.
 */
function ensureFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    saveJSON(filePath, defaultValue);
  }
}

/**
 * Load and parse a JSON file, or initialize & return defaultValue.
 * @param {string} filePath - Path to the JSON file.
 * @param {*} defaultValue - Value to return (and write) if file is missing/invalid.
 * @returns {*} Parsed JSON data or defaultValue.
 */
function loadJSON(filePath, defaultValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    if (!raw) {
      saveJSON(filePath, defaultValue);
      return defaultValue;
    }
    return JSON.parse(raw);
  } catch (err) {
    // Corrupt/missing file → reset
    saveJSON(filePath, defaultValue);
    return defaultValue;
  }
}

/**
 * Write an object/array to a JSON file with pretty formatting.
 * @param {string} filePath - Path to the JSON file.
 * @param {*} data - Data to stringify and save.
 */
function saveJSON(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, json, 'utf-8');
}

/**
 * Broadcast a payload over all WebSocket clients on a given channel.
 * @param {WebSocket.Server} wss - The WebSocket.Server instance.
 * @param {string} channel - Channel name for clients to filter on.
 * @param {*} payload - Data to send.
 */
function broadcast(wss, channel, payload) {
  const msg = JSON.stringify({ channel, payload });
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

module.exports = {
  ensureDir,
  ensureFile,
  loadJSON,
  saveJSON,
  broadcast,
};

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDB = initDB;
exports.getDB = getDB;
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
let db;
async function initDB() {
    db = await (0, sqlite_1.open)({
        filename: './database.sqlite',
        driver: sqlite3_1.default.Database
    });
    await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      hostname TEXT,
      platform TEXT,
      group_id INTEGER,
      last_seen DATETIME,
      FOREIGN KEY(group_id) REFERENCES groups(id)
    );
  `);
    // Seed default admin
    const admin = await db.get('SELECT * FROM users WHERE username = ?', 'admin');
    if (!admin) {
        await db.run('INSERT INTO users (username, password) VALUES (?, ?)', 'admin', 'admin');
    }
    // Seed default group
    const defaultGroup = await db.get('SELECT * FROM groups WHERE name = ?', 'Default');
    if (!defaultGroup) {
        await db.run('INSERT INTO groups (name) VALUES (?)', 'Default');
    }
}
function getDB() {
    return db;
}

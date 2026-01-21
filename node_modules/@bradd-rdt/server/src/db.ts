import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

let db: Database;

export async function initDB() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
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

export function getDB() {
  return db;
}

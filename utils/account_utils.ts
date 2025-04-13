import * as fs from "fs";
import * as path from "path";

import { fileURLToPath } from "url";
import { dirname } from "path";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

const accountsFilePath = path.join(__dirname, "./accounts.json");
/**
 * Save an account to accounts.json.
 * @param key - The key to store the account under.
 * @param value - The value to store.
 */
export function saveAccount(key: string, value: any): void {
  let accounts: Record<string, any> = {};
  if (fs.existsSync(accountsFilePath)) {
    accounts = JSON.parse(fs.readFileSync(accountsFilePath, "utf-8"));
  }
  accounts[key] = value;
  fs.writeFileSync(accountsFilePath, JSON.stringify(accounts, null, 2));
}

/**
 * Get an account from accounts.json.
 * @param key - The key of the account to retrieve.
 * @returns The stored account value, or null if not found.
 */
export function getAccount<T>(key: string): T | null {
  if (!fs.existsSync(accountsFilePath)) {
    return null;
  }
  const accounts = JSON.parse(fs.readFileSync(accountsFilePath, "utf-8"));
  return accounts[key] || null;
}

import { useEffect, useState } from "react";
import type { Account, Party } from "../../shared/types";
import { api } from "./api";

// Small shared caches so every screen doesn't refetch the Chart of Accounts and employees.
const cache = new Map<string, Promise<unknown>>();

function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = api<T>(path).catch((e) => {
      cache.delete(path);
      throw e;
    });
    cache.set(path, p);
  }
  return cache.get(path) as Promise<T>;
}

export function useLoad<T>(path: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setError(null);
    api<T>(path)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [path, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

export function useAccounts(): Account[] {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    load<Account[]>("/accounts").then(setAccounts).catch(() => {});
  }, []);
  return accounts;
}

/** All active parties (suppliers, employees, owners, lenders). */
export function useParties(): Party[] {
  const [parties, setParties] = useState<Party[]>([]);
  useEffect(() => {
    load<Party[]>("/parties").then(setParties).catch(() => {});
  }, []);
  return parties;
}

export function useEmployees(profitCenter?: string): Party[] {
  const [parties, setParties] = useState<Party[]>([]);
  useEffect(() => {
    load<Party[]>("/parties?type=Employee").then(setParties).catch(() => {});
  }, []);
  return profitCenter ? parties.filter((p) => !p.profitCenter || p.profitCenter === profitCenter) : parties;
}

export function todayManila(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

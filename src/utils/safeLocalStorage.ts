/**
 * Global protection for Storage.prototype and browser sandboxed iframe restrictions
 */

function trimJsonArrayString(jsonStr: string, maxItems = 250): string {
  if (!jsonStr || jsonStr.length < 10000) return jsonStr;
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.length > maxItems) {
      return JSON.stringify(parsed.slice(-maxItems));
    }
  } catch (_) {}
  return jsonStr;
}

function isCriticalUserDataKey(key: string): boolean {
  if (!key) return false;
  return (
    key.includes('af_estoque_') ||
    key.includes('af_posicao_pallet_') ||
    key.includes('af_capacity_') ||
    key.includes('af_warehouse_') ||
    key.includes('af_pop_doc_') ||
    key.includes('0205') ||
    key.includes('021101') ||
    key.includes('venda_media') ||
    key.includes('colaboradores') ||
    key.includes('acoes_rows') ||
    key.includes('dpo_audits') ||
    key.includes('repack_rows')
  );
}

// In-memory storage implementation for sandboxed/restricted environments
class MemoryStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

export function initSafeLocalStorage() {
  if (typeof window === 'undefined') return;

  // 1. Patch window.alert to avoid iframe sandbox DOMException
  try {
    const originalAlert = window.alert ? window.alert.bind(window) : null;
    window.alert = (message?: any) => {
      console.log('[App Alert]:', message);
      try {
        const toast = document.getElementById('toast');
        if (toast) {
          toast.textContent = String(message ?? '');
          toast.classList.add('show');
          setTimeout(() => {
            toast.classList.remove('show');
          }, 3500);
        }
      } catch (_) {}
      try {
        if (originalAlert) {
          originalAlert(message);
        }
      } catch (_) {
        // Ignored in sandboxed iframe without allow-modals
      }
    };
  } catch (err) {
    console.warn('Failed to patch window.alert:', err);
  }

  // 2. Patch window.confirm to bypass browser iframe sandbox blocking on modal dialogs
  try {
    const originalConfirm = window.confirm ? window.confirm.bind(window) : null;
    window.confirm = (message?: string): boolean => {
      if (originalConfirm) {
        try {
          return originalConfirm(message);
        } catch (_) {
          return true;
        }
      }
      return true;
    };
  } catch (err) {
    console.warn('Failed to patch window.confirm:', err);
  }

  // 3. Patch window.prompt
  try {
    window.prompt = () => null;
  } catch (_) {}

  // 4. Ensure window.localStorage and window.sessionStorage are accessible and functional
  let isLocalStorageAvailable = false;
  try {
    const testKey = '__test_ls__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    isLocalStorageAvailable = true;
  } catch (_) {
    isLocalStorageAvailable = false;
  }

  if (!isLocalStorageAvailable) {
    try {
      const memoryStorage = new MemoryStorage();
      Object.defineProperty(window, 'localStorage', {
        value: memoryStorage,
        configurable: true,
        writable: true,
      });
    } catch (_) {}
  }

  let isSessionStorageAvailable = false;
  try {
    const testKey = '__test_ss__';
    window.sessionStorage.setItem(testKey, '1');
    window.sessionStorage.removeItem(testKey);
    isSessionStorageAvailable = true;
  } catch (_) {
    isSessionStorageAvailable = false;
  }

  if (!isSessionStorageAvailable) {
    try {
      const memorySessionStorage = new MemoryStorage();
      Object.defineProperty(window, 'sessionStorage', {
        value: memorySessionStorage,
        configurable: true,
        writable: true,
      });
    } catch (_) {}
  }

  // 5. Wrap Storage.prototype methods to gracefully handle quota and access errors
  if (typeof window.Storage !== 'undefined') {
    const originalSetItem = Storage.prototype.setItem;
    const originalGetItem = Storage.prototype.getItem;
    const originalRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.getItem = function (key: string): string | null {
      try {
        return originalGetItem.call(this, key);
      } catch (e) {
        return null;
      }
    };

    Storage.prototype.removeItem = function (key: string): void {
      try {
        originalRemoveItem.call(this, key);
      } catch (e) {
        // Ignore
      }
    };

    Storage.prototype.setItem = function (key: string, value: string) {
      let valueToStore = value;

      try {
        originalSetItem.call(this, key, valueToStore);
      } catch (e: any) {
        if (
          e?.name === 'QuotaExceededError' ||
          e?.code === 22 ||
          e?.code === 1014 ||
          String(e).toLowerCase().includes('quota') ||
          String(e).toLowerCase().includes('exceeded')
        ) {
          // Phase 1: Fast purge of disposable temporary cache keys without heavy JSON loops
          try {
            const keysToRemove: string[] = [];
            for (let i = this.length - 1; i >= 0; i--) {
              const k = this.key(i);
              if (!k || isCriticalUserDataKey(k)) continue;

              if (
                k.startsWith('backups_') ||
                k.startsWith('landing_page_') ||
                k.startsWith('firestore_') ||
                k.startsWith('firebase_') ||
                k.startsWith('local_acessos_') ||
                k.startsWith('cache_coll_') ||
                k.includes('_temp_') ||
                k.includes('_cache_')
              ) {
                keysToRemove.push(k);
              }
            }
            keysToRemove.forEach(k => {
              try { originalRemoveItem.call(this, k); } catch (_) {}
            });
          } catch (_) {}

          // Try again immediately after fast purge
          try {
            originalSetItem.call(this, key, valueToStore);
            return;
          } catch (_) {}

          // Phase 2: If item itself is not critical and very large, trim it directly
          if (!isCriticalUserDataKey(key)) {
            valueToStore = trimJsonArrayString(valueToStore, 100);
          }

          try {
            originalSetItem.call(this, key, valueToStore);
            return;
          } catch (_) {
            // Silently handle quota exhaustion without crashing or stalling UI
          }
        } else {
          console.warn(`[localStorage] Handled error setting key "${key}":`, e);
        }
      }
    };
  }
}

// Auto-run on module import
if (typeof window !== 'undefined') {
  initSafeLocalStorage();
}

export function safeSetLocalStorage<T = any>(key: string, value: T): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    window.localStorage.setItem(key, str);
    return true;
  } catch (e) {
    return false;
  }
}

export function safeGetLocalStorage<T = any>(key: string, fallback: T | null = null): T | null {
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    if (typeof fallback === 'string') return raw as unknown as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  } catch (e) {
    return fallback;
  }
}

export function safeSetSessionStorage<T = any>(key: string, value: T): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    window.sessionStorage.setItem(key, str);
    return true;
  } catch (e) {
    return false;
  }
}

export function safeGetSessionStorage<T = any>(key: string, fallback: T | null = null): T | null {
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = window.sessionStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    if (typeof fallback === 'string') return raw as unknown as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  } catch (e) {
    return fallback;
  }
}

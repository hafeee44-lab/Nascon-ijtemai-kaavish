import { NativeModules } from 'react-native';

// Native bridge (android/app/src/main/java/com/nasconapp/NasconStoreModule.kt):
// SQLite key-value store for the offline cache/queue, Keystore-encrypted secrets, PDF saving.
const Native = NativeModules.NasconStore as {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<boolean>;
  removeItem(key: string): Promise<boolean>;
  secureSet(key: string, value: string): Promise<boolean>;
  secureGet(key: string): Promise<string | null>;
  secureRemove(key: string): Promise<boolean>;
  savePdf(fileName: string, base64: string): Promise<string>;
};

const memory = new Map<string, string>();

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = Native ? await Native.getItem(key) : memory.get(key) ?? null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setJson(key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  if (Native) await Native.setItem(key, raw);
  else memory.set(key, raw);
}

export async function removeKey(key: string): Promise<void> {
  if (Native) await Native.removeItem(key);
  else memory.delete(key);
}

export const secure = {
  set: (k: string, v: string) => (Native ? Native.secureSet(k, v) : Promise.resolve(memory.set('s:' + k, v) && true)),
  get: (k: string) => (Native ? Native.secureGet(k) : Promise.resolve(memory.get('s:' + k) ?? null)),
  remove: (k: string) => (Native ? Native.secureRemove(k) : Promise.resolve(memory.delete('s:' + k))),
};

export const savePdf = (name: string, b64: string) => (Native ? Native.savePdf(name, b64) : Promise.reject(new Error('Not available')));

import {
  collection,
  query,
  where,
  getDocsFromCache,
  onSnapshot,
  QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';

export interface SyncIncrementalOptions {
  collectionName: string;
  empresaId: string;
  onData: (data: any[]) => void;
  onError?: (err: any) => void;
}

/**
 * Utilitário de Sincronização em Tempo Real com Resiliência Total de Dados:
 * 1. Inicialização Instantânea (0ms): Carrega imediatamente do backup localStorage.
 * 2. Cache Local IndexedDB + Nuvem (Firestore onSnapshot):
 *    - Lê do cache offline sem travar a interface.
 *    - Atualiza automaticamente via stream em tempo real para qualquer alteração na empresa.
 *    - Garante que nenhum dado seja omitido por incompatibilidade de filtros de data.
 * 3. Dupla Camada de Persistência:
 *    - IndexedDB (multi-tab Firestore cache) + LocalStorage (fallback de segurança imediata).
 */
export function syncIncremental({
  collectionName,
  empresaId,
  onData,
  onError
}: SyncIncrementalOptions): () => void {
  if (!empresaId) {
    onData([]);
    return () => {};
  }

  let isUnsubscribed = false;
  let activeUnsub: (() => void) | null = null;
  let saveTimer: any = null;
  const docsMap = new Map<string, any>();

  const localBackupKey = `cache_coll_${empresaId}_${collectionName}`;

  const notify = () => {
    if (!isUnsubscribed) {
      onData(Array.from(docsMap.values()));
    }
  };

  const scheduleSaveBackup = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (isUnsubscribed) return;
      try {
        const allItems = Array.from(docsMap.values());
        // Cap backup to 150 items to avoid localStorage saturation
        const toStore = allItems.length > 150 ? allItems.slice(0, 150) : allItems;
        localStorage.setItem(localBackupKey, JSON.stringify(toStore));
      } catch (_) {
        // Silent fallback: IndexedDB handles persistence
      }
    }, 1500);
  };

  // 1. Camada 0: Leitura instantânea do backup de segurança em localStorage (0ms)
  try {
    const rawBackup = localStorage.getItem(localBackupKey);
    if (rawBackup) {
      const parsed = JSON.parse(rawBackup);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed.forEach((item: any) => {
          const docKey = item._docId || item.id || String(item.codigo || Math.random());
          docsMap.set(docKey, item);
        });
        notify();
      }
    }
  } catch (e) {
    // Ignora erro de parsing do backup local
  }

  if (!db) {
    return () => {};
  }

  // 2. Camada 1 & 2: Conexão com Firestore (Cache Offline IndexedDB + Listener em Tempo Real)
  const colRef = collection(db, collectionName);
  const baseQuery = query(colRef, where('empresaId', '==', empresaId));

  // Tenta carregar do cache IndexedDB primeiro se o mapa ainda estiver vazio
  if (docsMap.size === 0) {
    getDocsFromCache(baseQuery)
      .then((cacheSnap) => {
        if (!isUnsubscribed && !cacheSnap.empty) {
          cacheSnap.docs.forEach((doc: QueryDocumentSnapshot) => {
            docsMap.set(doc.id, { _docId: doc.id, id: doc.id, ...doc.data() });
          });
          notify();
        }
      })
      .catch(() => {
        // Cache IndexedDB inicial ainda não preenchido, o onSnapshot buscará da nuvem
      });
  }

  // 3. Listener em Tempo Real: Autoridade máxima dos dados
  try {
    activeUnsub = onSnapshot(
      baseQuery,
      { includeMetadataChanges: false },
      (snap) => {
        if (isUnsubscribed) return;

        const newMap = new Map<string, any>();
        snap.docs.forEach((doc) => {
          newMap.set(doc.id, { _docId: doc.id, id: doc.id, ...doc.data() });
        });

        docsMap.clear();
        newMap.forEach((val, key) => docsMap.set(key, val));

        // Agenda backup em segundo plano sem travar a thread de interface
        scheduleSaveBackup();

        notify();
      },
      (err) => {
        console.warn(`[syncIncremental] Listener da coleção '${collectionName}' em modo offline:`, err);
        if (onError) onError(err);
      }
    );
  } catch (err) {
    console.warn(`[syncIncremental] Erro ao iniciar listener em tempo real para '${collectionName}':`, err);
  }

  return () => {
    isUnsubscribed = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    if (activeUnsub) {
      activeUnsub();
    }
  };
}

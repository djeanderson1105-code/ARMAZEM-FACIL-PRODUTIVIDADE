import { serverTimestamp } from 'firebase/firestore';
import { auth } from '../firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo: auth?.currentUser?.providerData?.map((provider: any) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Utilitário de auditoria e carimbo de data/hora (Fase 3):
 * Garante que todos os registros gravados ou atualizados no Firestore
 * possuam 'atualizadoEm' e 'criadoEm' padronizados.
 */
export function withTimestamps<T extends Record<string, any>>(data: T, isUpdate = false): T {
  const now = serverTimestamp();
  if (isUpdate) {
    return {
      ...data,
      atualizadoEm: now,
    };
  }
  return {
    ...data,
    criadoEm: data.criadoEm || now,
    atualizadoEm: now,
  };
}

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { syncIncremental } from '../utils/syncIncremental';
import {
  RepackRow,
  DespejoRow,
  QuebraRow,
  ValidadeRow,
  ArmazemRow,
  BlitzRefugoRow,
  Tarefa,
  ProdutoMaster,
  ColaboradorMaster,
  AcessoColaborador
} from '../types';

export interface EmpresaDataState {
  repack: RepackRow[];
  despejo: DespejoRow[];
  quebras: QuebraRow[];
  validades: ValidadeRow[];
  armazem: ArmazemRow[];
  blitz: BlitzRefugoRow[];
  tarefas: Tarefa[];
  usuarios: any[];
  acoes: any[];
  colaboradores: ColaboradorMaster[];
  produtos: ProdutoMaster[];
  dpoAudits: any[];
  repackValidades: any[];
  acessos: AcessoColaborador[];
  repackActionPlans: any[];
  repackA3Boards: any[];
  validadesRetiradas: any[];
  loaded: boolean;
  viewUnitMode: 'R$' | 'HL';
}

const EMPTY_STATE: EmpresaDataState = {
  repack: [],
  despejo: [],
  quebras: [],
  validades: [],
  armazem: [],
  blitz: [],
  tarefas: [],
  usuarios: [],
  acoes: [],
  colaboradores: [],
  produtos: [],
  dpoAudits: [],
  repackValidades: [],
  acessos: [],
  repackActionPlans: [],
  repackA3Boards: [],
  validadesRetiradas: [],
  loaded: false,
  viewUnitMode: 'R$'
};

interface ContextValue extends EmpresaDataState {
  empresaId: string | null | undefined;
  setViewUnitMode: (mode: 'R$' | 'HL') => void;
  subscribeCollection: (nome: string, chave: keyof Omit<EmpresaDataState, 'loaded' | 'empresaId' | 'subscribeCollection' | 'viewUnitMode' | 'setViewUnitMode'>) => () => void;
}

const EmpresaDataContext = createContext<ContextValue>({
  ...EMPTY_STATE,
  empresaId: null,
  setViewUnitMode: () => {},
  subscribeCollection: () => () => {},
});

// Mapeamento Nome da Coleção Firestore -> Chave no State
const COLLECTION_MAPPING: Record<string, keyof Omit<EmpresaDataState, 'loaded' | 'empresaId' | 'subscribeCollection' | 'viewUnitMode' | 'setViewUnitMode'>> = {
  repack: 'repack',
  despejo: 'despejo',
  quebras: 'quebras',
  validades: 'validades',
  armazem: 'armazem',
  blitz_refugo: 'blitz',
  tarefas: 'tarefas',
  usuarios: 'usuarios',
  acoes: 'acoes',
  colaboradores: 'colaboradores',
  produtos: 'produtos',
  dpo_audits: 'dpoAudits',
  repack_validades: 'repackValidades',
  acessos: 'acessos',
  repack_action_plans: 'repackActionPlans',
  repack_a3_boards: 'repackA3Boards',
  validades_retiradas: 'validadesRetiradas',
};

export function EmpresaDataProvider({
  empresaId,
  children,
}: {
  empresaId: string | null | undefined;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<EmpresaDataState>(EMPTY_STATE);
  const [viewUnitMode, setViewUnitModeState] = useState<'R$' | 'HL'>(() => {
    try {
      const saved = localStorage.getItem('af_global_view_unit');
      if (saved === 'HL' || saved === 'R$') return saved;
    } catch (e) {
      // ignore
    }
    return 'R$';
  });

  const setViewUnitMode = useCallback((mode: 'R$' | 'HL') => {
    setViewUnitModeState(mode);
    try {
      localStorage.setItem('af_global_view_unit', mode);
    } catch (e) {
      // ignore
    }
  }, []);

  const refCounts = useRef<Record<string, number>>({});
  const unsubs = useRef<Record<string, () => void>>({});
  const cleanupTimers = useRef<Record<string, any>>({});
  const pendingUpdates = useRef<Record<string, any>>({});
  const batchRaf = useRef<number | null>(null);

  const flushUpdates = useCallback(() => {
    batchRaf.current = null;
    const updates = { ...pendingUpdates.current };
    pendingUpdates.current = {};
    setState((prev) => ({
      ...prev,
      ...updates,
      loaded: true,
    }));
  }, []);

  useEffect(() => {
    // Reset state when empresaId changes or logs out
    setState(EMPTY_STATE);
    refCounts.current = {};
    Object.values(cleanupTimers.current).forEach(timer => clearTimeout(timer));
    cleanupTimers.current = {};
    Object.values(unsubs.current).forEach(unsub => {
      if (typeof unsub === 'function') unsub();
    });
    unsubs.current = {};
    if (batchRaf.current) {
      cancelAnimationFrame(batchRaf.current);
      batchRaf.current = null;
    }
    pendingUpdates.current = {};
  }, [empresaId]);

  const subscribeCollection = useCallback(
    (nome: string, chave: keyof Omit<EmpresaDataState, 'loaded' | 'empresaId' | 'subscribeCollection'>) => {
      if (!empresaId) return () => {};

      // Cancela timer de encerramento caso a coleção esteja em período de tolerância
      if (cleanupTimers.current[nome]) {
        clearTimeout(cleanupTimers.current[nome]);
        delete cleanupTimers.current[nome];
      }

      refCounts.current[nome] = (refCounts.current[nome] || 0) + 1;

      // Inicia a sincronização incremental se for a primeira subscrição ativa dessa coleção
      if (!unsubs.current[nome]) {
        const cleanup = syncIncremental({
          collectionName: nome,
          empresaId,
          onData: (data) => {
            pendingUpdates.current[chave] = data;
            if (!batchRaf.current) {
              batchRaf.current = requestAnimationFrame(flushUpdates);
            }
          },
        });
        unsubs.current[nome] = cleanup;
      }

      return () => {
        refCounts.current[nome] = Math.max(0, (refCounts.current[nome] || 1) - 1);
        if (refCounts.current[nome] === 0 && unsubs.current[nome]) {
          // Período de tolerância de 45 segundos para navegação ágil entre guias sem destruição de listeners
          if (cleanupTimers.current[nome]) {
            clearTimeout(cleanupTimers.current[nome]);
          }
          cleanupTimers.current[nome] = setTimeout(() => {
            if (refCounts.current[nome] === 0 && unsubs.current[nome]) {
              unsubs.current[nome]();
              delete unsubs.current[nome];
            }
            delete cleanupTimers.current[nome];
          }, 45000);
        }
      };
    },
    [empresaId, flushUpdates]
  );

  return (
    <EmpresaDataContext.Provider
      value={{
        ...state,
        empresaId,
        viewUnitMode,
        setViewUnitMode,
        subscribeCollection: subscribeCollection as any,
      }}
    >
      {children}
    </EmpresaDataContext.Provider>
  );
}

/**
 * Hook leve para obter a unidade de visualização global (R$ ou HL)
 * sem subscrever coleções de dados pesadas.
 */
export function useViewUnit() {
  const ctx = useContext(EmpresaDataContext);
  return {
    viewUnitMode: ctx.viewUnitMode,
    setViewUnitMode: ctx.setViewUnitMode,
  };
}

/**
 * Hook retrocompatível com a fonte de dados global da empresa logada.
 * Subscreve sob demanda às coleções ativas via sincronização incremental (Cache + Delta).
 */
export function useEmpresaData() {
  const ctx = useContext(EmpresaDataContext);
  const { subscribeCollection, empresaId } = ctx;

  useEffect(() => {
    if (!empresaId) return;

    // Subscreve incrementalmente a todas as coleções do state para os componentes retrocompatíveis
    const cleanups = Object.entries(COLLECTION_MAPPING).map(([nome, chave]) =>
      subscribeCollection(nome, chave)
    );

    return () => {
      cleanups.forEach((c) => c());
    };
  }, [subscribeCollection, empresaId]);

  return ctx;
}

/** Hooks Modulares por Domínio (Fase 3): Carregados somente quando o painel correspondente é montado */

export function useRepackData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('repack', 'repack');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.repack;
}

export function useDespejoData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('despejo', 'despejo');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.despejo;
}

export function useQuebrasData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('quebras', 'quebras');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.quebras;
}

export function useValidadesData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('validades', 'validades');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.validades;
}

export function useArmazemData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('armazem', 'armazem');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.armazem;
}

export function useBlitzData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('blitz_refugo', 'blitz');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.blitz;
}

export function useTarefasData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('tarefas', 'tarefas');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.tarefas;
}

export function useAcoesData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('acoes', 'acoes');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.acoes;
}

export function useColaboradoresData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('colaboradores', 'colaboradores');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.colaboradores;
}

export function useDpoAuditsData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('dpo_audits', 'dpoAudits');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.dpoAudits;
}

export function useProdutosData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('produtos', 'produtos');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.produtos;
}

export function useAcessosData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('acessos', 'acessos');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.acessos;
}

export function useValidadesRetiradasData() {
  const ctx = useContext(EmpresaDataContext);
  useEffect(() => {
    if (!ctx.empresaId) return;
    return ctx.subscribeCollection('validades_retiradas', 'validadesRetiradas');
  }, [ctx.empresaId, ctx.subscribeCollection]);
  return ctx.validadesRetiradas;
}


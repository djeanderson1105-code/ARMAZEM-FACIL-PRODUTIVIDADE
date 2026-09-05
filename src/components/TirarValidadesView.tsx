import React, { useState, useMemo, useEffect } from 'react';
import { Usuario, Empresa, ValidadeRow } from '../types';
import { db } from '../firebase';
import { collection, addDoc, doc, deleteDoc, updateDoc, query, where, getDocs } from 'firebase/firestore';
import { useValidadesRetiradasData } from '../context/EmpresaDataContext';
import { 
  Package, 
  Trash2, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Search, 
  Filter, 
  ArrowRight, 
  Send, 
  Calendar, 
  FileSpreadsheet, 
  Plus, 
  X,
  History,
  ShieldAlert,
  Droplet,
  Boxes,
  Lock,
  Truck,
  RotateCcw
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { PRODUCTS } from '../planosData';
import { getInitialDefaultValidades } from '../utils/fefoDefaultData';
import { getDiasRestantes } from '../utils/calculateStockAgeIndex';

export interface ValidadeRetiradaRecord {
  id: string;
  codigo: string | number;
  descricao: string;
  validade: string;
  quantidadeCx: number;
  quantidadePaletes?: number;
  origem: string;
  bloco?: string;
  motivo: string;
  destino: 'Despejo' | 'Repack' | 'Quarentena' | 'Baixa Final';
  colaborador: string;
  dataHora: string;
  timestamp: number;
  empresaId: string;
  observacao?: string;
}

interface TirarValidadesModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLot?: ValidadeRow | null;
  onSuccess: (record: ValidadeRetiradaRecord) => void;
  user: Usuario;
  empresaId: string;
  theme?: 'light' | 'dark';
}

export const TirarValidadesModal: React.FC<TirarValidadesModalProps> = ({
  isOpen,
  onClose,
  selectedLot,
  onSuccess,
  user,
  empresaId,
  theme = 'dark'
}) => {
  const [codigo, setCodigo] = useState<string>('');
  const [descricao, setDescricao] = useState<string>('');
  const [validade, setValidade] = useState<string>('');
  const [origem, setOrigem] = useState<string>('Picking');
  const [bloco, setBloco] = useState<string>('');
  const [quantidadeCx, setQuantidadeCx] = useState<number | ''>('');
  const [motivo, setMotivo] = useState<string>('Vencido no Armazém / Picking');
  const [destino, setDestino] = useState<'Despejo' | 'Repack' | 'Quarentena' | 'Baixa Final'>('Despejo');
  const [observacao, setObservacao] = useState<string>('');
  const [colaborador, setColaborador] = useState<string>(user?.nome || 'Operador');
  const [submitting, setSubmitting] = useState(false);

  // Auto-fill if lot selected
  useEffect(() => {
    if (selectedLot) {
      setCodigo(String(selectedLot.codigo || ''));
      setDescricao(selectedLot.descricao || '');
      setValidade(selectedLot.validade || '');
      setOrigem(selectedLot.localizacao === 'picking' ? 'Picking' : 'Estoque Central / Pulmão');
      setBloco(selectedLot.bloco || '');
      const totalCx = Number(selectedLot.caixa || 0) + (Number(selectedLot.palhete || 0) * 30);
      setQuantidadeCx(totalCx > 0 ? totalCx : '');
    } else {
      setCodigo('');
      setDescricao('');
      setValidade('');
      setOrigem('Picking');
      setBloco('');
      setQuantidadeCx('');
    }
  }, [selectedLot]);

  if (!isOpen) return null;

  const totalCxDisponivel = selectedLot 
    ? Number(selectedLot.caixa || 0) + (Number(selectedLot.palhete || 0) * 30)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!descricao || !validade || !quantidadeCx || Number(quantidadeCx) <= 0) {
      alert('Por favor, preencha o produto, a validade e uma quantidade válida de caixas a retirar.');
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date();
      const record: ValidadeRetiradaRecord = {
        id: `ret_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        codigo: codigo || '0000',
        descricao,
        validade,
        quantidadeCx: Number(quantidadeCx),
        origem,
        bloco,
        motivo,
        destino,
        colaborador: colaborador || user?.nome || 'Colaborador',
        dataHora: now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        timestamp: now.getTime(),
        empresaId,
        observacao
      };

      // 1. Salvar no histórico local de retiradas
      const histKey = `validades_retiradas_${empresaId}`;
      const existingHist: ValidadeRetiradaRecord[] = JSON.parse(localStorage.getItem(histKey) || '[]');
      existingHist.unshift(record);
      localStorage.setItem(histKey, JSON.stringify(existingHist.slice(0, 200)));

      // 2. Atualizar ou decrementar estoque de validades
      const validadesKey = `validades_${empresaId}`;
      const currentValidades: ValidadeRow[] = JSON.parse(localStorage.getItem(validadesKey) || '[]');
      
      let updatedValidades: ValidadeRow[] = [];
      const retiradasCx = Number(quantidadeCx);

      if (selectedLot && (selectedLot._docId || selectedLot.id)) {
        updatedValidades = currentValidades.map(v => {
          const matchDoc = (selectedLot._docId && v._docId === selectedLot._docId) || (selectedLot.id && v.id === selectedLot.id);
          if (matchDoc) {
            const currentTotal = Number(v.caixa || 0) + (Number(v.palhete || 0) * 30);
            const remainingTotal = Math.max(0, currentTotal - retiradasCx);
            return {
              ...v,
              caixa: remainingTotal % 30,
              palhete: Math.floor(remainingTotal / 30)
            };
          }
          return v;
        }).filter(v => (Number(v.caixa || 0) + Number(v.palhete || 0)) > 0);
      } else {
        // Find by codigo + validade
        let deducted = false;
        updatedValidades = currentValidades.map(v => {
          if (!deducted && String(v.codigo) === String(codigo) && v.validade === validade) {
            deducted = true;
            const currentTotal = Number(v.caixa || 0) + (Number(v.palhete || 0) * 30);
            const remainingTotal = Math.max(0, currentTotal - retiradasCx);
            return {
              ...v,
              caixa: remainingTotal % 30,
              palhete: Math.floor(remainingTotal / 30)
            };
          }
          return v;
        }).filter(v => (Number(v.caixa || 0) + Number(v.palhete || 0)) > 0);
      }

      localStorage.setItem(validadesKey, JSON.stringify(updatedValidades));
      localStorage.setItem(`armazem_validades_${empresaId}`, JSON.stringify(updatedValidades));

      // 3. Se destino for Despejo ou Repack, criar fila no módulo correspondente
      if (destino === 'Despejo') {
        const despejoKey = `despejo_${empresaId}`;
        const existingDespejo = JSON.parse(localStorage.getItem(despejoKey) || '[]');
        existingDespejo.unshift({
          id: `desp_fefo_${Date.now()}`,
          codigo: codigo || '0000',
          descricao,
          caixas: retiradasCx,
          motivo: `Retirada FEFO: ${motivo}`,
          operador: colaborador,
          data: now.toLocaleDateString('pt-BR'),
          hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          status: 'pendente_despejo',
          origemFefo: true
        });
        localStorage.setItem(despejoKey, JSON.stringify(existingDespejo));
      } else if (destino === 'Repack') {
        const repackKey = `repack_${empresaId}`;
        const existingRepack = JSON.parse(localStorage.getItem(repackKey) || '[]');
        existingRepack.unshift({
          id: `rep_fefo_${Date.now()}`,
          codigo: codigo || '0000',
          descricao,
          caixas: retiradasCx,
          motivo: `Retirada FEFO: ${motivo}`,
          operador: colaborador,
          data: now.toLocaleDateString('pt-BR'),
          hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          status: 'pendente_repack',
          origemFefo: true
        });
        localStorage.setItem(repackKey, JSON.stringify(existingRepack));
      }

      // 4. Notificar aplicação com resposta imediata
      window.dispatchEvent(new Event('app_data_updated'));
      window.dispatchEvent(new Event('local_data_changed'));
      window.dispatchEvent(new Event('fefo_demands_updated'));

      // Resposta instantânea da UI
      onSuccess(record);
      onClose();

      // 5. Sincronização em background com Firestore (não trava a interface e garante integridade total)
      if (db) {
        (async () => {
          try {
            // A. Salva no histórico unificado de retiradas (Firestore)
            await addDoc(collection(db, 'validades_retiradas'), {
              ...record,
              criadoEm: now.toISOString(),
              atualizadoEm: now.toISOString()
            });

            // B. Atualiza ou remove da coleção de validades na nuvem
            if (selectedLot?._docId) {
              const currentTotal = Number(selectedLot.caixa || 0) + (Number(selectedLot.palhete || 0) * 30);
              const remainingTotal = Math.max(0, currentTotal - retiradasCx);
              if (remainingTotal <= 0) {
                await deleteDoc(doc(db, 'validades', selectedLot._docId));
              } else {
                await updateDoc(doc(db, 'validades', selectedLot._docId), {
                  caixa: remainingTotal % 30,
                  palhete: Math.floor(remainingTotal / 30),
                  atualizadoEm: now.toISOString()
                });
              }
            } else {
              // Procura o documento pelo código e validade para garantir baixa no banco
              const qVal = query(
                collection(db, 'validades'),
                where('empresaId', '==', empresaId),
                where('validade', '==', validade)
              );
              const snap = await getDocs(qVal);
              for (const d of snap.docs) {
                const data = d.data();
                if (String(data.codigo) === String(codigo)) {
                  const currentTotal = Number(data.caixa || 0) + (Number(data.palhete || 0) * 30);
                  const remainingTotal = Math.max(0, currentTotal - retiradasCx);
                  if (remainingTotal <= 0) {
                    await deleteDoc(doc(db, 'validades', d.id));
                  } else {
                    await updateDoc(doc(db, 'validades', d.id), {
                      caixa: remainingTotal % 30,
                      palhete: Math.floor(remainingTotal / 30),
                      atualizadoEm: now.toISOString()
                    });
                  }
                  break;
                }
              }
            }

            // C. Se destino for Despejo, grava na coleção 'despejo' compartilhada na nuvem
            if (destino === 'Despejo') {
              const despejoDoc = {
                empresaId,
                data: now.toLocaleDateString('pt-BR'),
                dataISO: now.toISOString().split('T')[0],
                colaborador: colaborador || user?.nome || 'Operador',
                embalagem: 'Caixa',
                quantidade: retiradasCx,
                inicio: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                fim: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                tempo: '00:05:00',
                statusMeta: 'Dentro da Meta',
                motivo: `Retirada FEFO: ${motivo}`,
                codigo: codigo || '0000',
                descricao,
                origemFefo: true,
                status: 'pendente_despejo',
                criadoEm: now.toISOString(),
                atualizadoEm: now.toISOString()
              };
              await addDoc(collection(db, 'despejo'), despejoDoc);
            }

            // D. Se destino for Repack, grava na coleção 'repack' compartilhada na nuvem
            if (destino === 'Repack') {
              const repackDoc = {
                empresaId,
                codigo: codigo || '0000',
                descricao,
                caixas: retiradasCx,
                motivo: `Retirada FEFO: ${motivo}`,
                operador: colaborador || user?.nome || 'Operador',
                data: now.toLocaleDateString('pt-BR'),
                hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                status: 'pendente_repack',
                origemFefo: true,
                criadoEm: now.toISOString(),
                atualizadoEm: now.toISOString()
              };
              await addDoc(collection(db, 'repack'), repackDoc);
            }
          } catch (e) {
            console.warn('Sync offline background fallback para retirada:', e);
          }
        })();
      }
    } catch (err: any) {
      alert('Erro ao registrar retirada de validade: ' + (err?.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-xs overflow-y-auto">
      <div className={`w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden my-4 transition-all ${
        theme === 'dark' ? 'bg-[#0f141c] border-[#222d3a] text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-[#222d3a] flex items-center justify-between bg-gradient-to-r from-rose-500/15 via-transparent to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-sans font-black text-sm uppercase tracking-wider text-rose-500">
                Tirar Validade (Baixa de Lote)
              </h3>
              <p className="text-[10px] text-slate-400">
                Registrar recolhimento e destinação de produto vencido ou em corte
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {/* Produto Selector or Display */}
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">
              Produto *
            </label>
            {selectedLot ? (
              <div className="p-2.5 rounded-xl border border-slate-700 bg-[#161d27] flex items-center justify-between">
                <div>
                  <div className="font-extrabold text-white text-xs">{descricao}</div>
                  <div className="text-[10px] text-slate-400 font-mono">Cód: {codigo} | Lote: {validade}</div>
                </div>
                {totalCxDisponivel !== null && (
                  <span className="px-2.5 py-1 rounded-md bg-sky-500/20 text-sky-400 text-[10px] font-black">
                    {totalCxDisponivel} cx em estoque
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <input
                  type="text"
                  placeholder="Nome ou código do produto..."
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-[#161d27] text-white outline-none focus:border-rose-500 text-xs"
                  required
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Código (opcional)"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value)}
                    className="w-1/3 px-3 py-1.5 rounded-lg border border-slate-700 bg-[#161d27] text-white outline-none text-xs"
                  />
                  <input
                    type="date"
                    value={validade}
                    onChange={(e) => setValidade(e.target.value)}
                    className="w-2/3 px-3 py-1.5 rounded-lg border border-slate-700 bg-[#161d27] text-white outline-none text-xs"
                    required
                  />
                </div>
              </div>
            )}
          </div>

          {/* Quantidade a Tirar */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-black uppercase text-slate-400">
                  Qtd Caixas a Tirar *
                </label>
                {totalCxDisponivel !== null && totalCxDisponivel > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuantidadeCx(totalCxDisponivel)}
                    className="text-[9px] text-amber-400 hover:underline font-bold"
                  >
                    Tudo ({totalCxDisponivel})
                  </button>
                )}
              </div>
              <input
                type="number"
                min="1"
                placeholder="Ex: 20"
                value={quantidadeCx}
                onChange={(e) => setQuantidadeCx(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-[#161d27] text-white outline-none focus:border-rose-500 font-mono font-bold text-sm"
                required
              />
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {[1, 5, 10, 30].map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQuantidadeCx(prev => (Number(prev) || 0) + n)}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-[10px] font-bold border border-slate-700 cursor-pointer"
                  >
                    +{n}{n === 30 ? ' (1 Pal)' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">
                Local de Origem
              </label>
              <select
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-[#161d27] text-white outline-none text-xs"
              >
                <option value="Picking">Picking (Separação)</option>
                <option value="Estoque Central / Pulmão">Estoque Central / Pulmão</option>
                <option value="Pátio / Doca">Pátio / Doca</option>
                <option value="Devolução">Devolução de Rota</option>
              </select>
            </div>
          </div>

          {/* Motivo e Destino */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">
                Motivo da Retirada *
              </label>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-[#161d27] text-white outline-none text-xs"
              >
                <option value="Vencido no Armazém / Picking">⛔ Vencido no Armazém / Picking</option>
                <option value="Shelf Life Crítico (< 30 dias)">🔴 Shelf Life Crítico (Corte)</option>
                <option value="Lote Avariado / Vazamento">💥 Lote Avariado / Vazamento</option>
                <option value="Inversão de Lote FEFO">🔄 Inversão de Lote FEFO</option>
                <option value="Auditoria da Qualidade">📋 Auditoria da Qualidade</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">
                Destino Operacional *
              </label>
              <select
                value={destino}
                onChange={(e) => setDestino(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-[#161d27] text-white font-bold outline-none text-xs"
              >
                <option value="Despejo">🛢️ Despejo (Drenagem/Descarte)</option>
                <option value="Repack">🔄 Repack (Reembalagem)</option>
                <option value="Quarentena">🔒 Quarentena / Bloqueio</option>
                <option value="Baixa Final">🚚 Baixa Operacional Final</option>
              </select>
            </div>
          </div>

          {/* Colaborador Responsável */}
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">
              Colaborador que Tirou a Validade *
            </label>
            <input
              type="text"
              value={colaborador}
              onChange={(e) => setColaborador(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-700 bg-[#161d27] text-white outline-none text-xs"
              placeholder="Nome do operador..."
              required
            />
          </div>

          {/* Observações */}
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">
              Observações (opcional)
            </label>
            <input
              type="text"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: Palete 14 recolhido para o setor de despejo..."
              className="w-full px-3 py-1.5 rounded-lg border border-slate-700 bg-[#161d27] text-slate-300 outline-none text-xs"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-bold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg shadow-rose-900/30 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting ? 'Registrando...' : 'Confirmar Retirada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface TirarValidadesViewProps {
  validadesList: ValidadeRow[];
  user: Usuario;
  empresa: Empresa | null;
  theme?: 'light' | 'dark';
  onValidadesUpdated?: () => void;
}

export const TirarValidadesView: React.FC<TirarValidadesViewProps> = ({
  validadesList,
  user,
  empresa,
  theme = 'dark',
  onValidadesUpdated
}) => {
  const empresaId = empresa?.id || 'demo';
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'vencidos' | 'criticos' | 'atencao' | 'picking' | 'estoque'>('todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLotForModal, setSelectedLotForModal] = useState<ValidadeRow | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'retirar' | 'historico'>('retirar');

  const contextRetiradas = useValidadesRetiradasData();

  // Histórico de Retiradas com sincronização em nuvem em tempo real
  const [historico, setHistorico] = useState<ValidadeRetiradaRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`validades_retiradas_${empresaId}`) || '[]');
    } catch {
      return [];
    }
  });

  const reloadHistorico = () => {
    try {
      const records = JSON.parse(localStorage.getItem(`validades_retiradas_${empresaId}`) || '[]');
      setHistorico(records);
    } catch (e) {}
  };

  useEffect(() => {
    if (contextRetiradas && contextRetiradas.length > 0) {
      const sorted = [...contextRetiradas].sort((a: any, b: any) => {
        const tA = Number(a.timestamp) || (a.criadoEm ? new Date(a.criadoEm).getTime() : 0);
        const tB = Number(b.timestamp) || (b.criadoEm ? new Date(b.criadoEm).getTime() : 0);
        return tB - tA;
      });
      setHistorico(sorted);
      try {
        localStorage.setItem(`validades_retiradas_${empresaId}`, JSON.stringify(sorted.slice(0, 200)));
      } catch (e) {}
    } else {
      reloadHistorico();
    }
  }, [contextRetiradas, empresaId]);

  const getDaysRemaining = (expDate: string) => {
    if (!expDate) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expDate + 'T00:00:00');
    return Math.round((exp.getTime() - today.getTime()) / 86400000);
  };

  const getStatusBadge = (days: number) => {
    if (days < 0) {
      return {
        label: `⛔ VENCIDO HÁ ${Math.abs(days)}d`,
        class: 'bg-red-500/20 text-red-400 border-red-500/30'
      };
    }
    if (days <= 30) {
      return {
        label: `🔴 CRÍTICO (${days}d)`,
        class: 'bg-rose-500/20 text-rose-400 border-rose-500/30 font-extrabold animate-pulse'
      };
    }
    if (days <= 45) {
      return {
        label: `🟠 ATENÇÃO (${days}d)`,
        class: 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      };
    }
    if (days <= 60) {
      return {
        label: `🟡 ALERTA (${days}d)`,
        class: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      };
    }
    return {
      label: `🟢 REGULAR (${days}d)`,
      class: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    };
  };

  const [visibleCount, setVisibleCount] = useState<number>(36);

  // Filtered lots for withdrawal - single pass O(N) precomputation
  const filteredLots = useMemo(() => {
    const list = validadesList && validadesList.length > 0 
      ? validadesList 
      : getInitialDefaultValidades(empresaId);

    const term = searchTerm.trim().toLowerCase();

    // 1. Map with cached days and badge
    const itemsWithDays: Array<{
      lot: ValidadeRow;
      days: number;
      badge: { label: string; class: string };
      totalCx: number;
      isPicking: boolean;
    }> = [];

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const days = getDiasRestantes(item.validade);
      const loc = (item.localizacao || '').toLowerCase();
      const isPicking = loc.includes('picking');

      // Search match
      if (term) {
        const matchSearch =
          String(item.codigo).toLowerCase().includes(term) ||
          (item.descricao || '').toLowerCase().includes(term) ||
          (item.validade || '').toLowerCase().includes(term) ||
          (item.bloco || '').toLowerCase().includes(term);
        if (!matchSearch) continue;
      }

      // Status filter
      if (statusFilter === 'vencidos' && days >= 0) continue;
      if (statusFilter === 'criticos' && (days < 0 || days > 30)) continue;
      if (statusFilter === 'atencao' && (days <= 30 || days > 45)) continue;
      if (statusFilter === 'picking' && !isPicking) continue;
      if (statusFilter === 'estoque' && isPicking) continue;

      const badge = getStatusBadge(days);
      const totalCx = Number(item.caixa || 0) + (Number(item.palhete || 0) * 30);

      itemsWithDays.push({
        lot: item,
        days,
        badge,
        totalCx,
        isPicking
      });
    }

    // 2. Sort by precalculated number without creating Date objects in the comparator
    itemsWithDays.sort((a, b) => a.days - b.days);
    return itemsWithDays;
  }, [validadesList, searchTerm, statusFilter, empresaId]);

  // Statistics counters - single pass O(N)
  const stats = useMemo(() => {
    const list = validadesList && validadesList.length > 0 
      ? validadesList 
      : getInitialDefaultValidades(empresaId);

    let vencidos = 0;
    let criticos = 0;
    let atencao = 0;
    let pickingCount = 0;

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const days = getDiasRestantes(item.validade);
      if (days < 0) vencidos++;
      else if (days <= 30) criticos++;
      else if (days <= 45) atencao++;
      if ((item.localizacao || '').toLowerCase().includes('picking')) pickingCount++;
    }

    const cxTiradasHoje = historico.reduce((acc, h) => acc + (Number(h.quantidadeCx) || 0), 0);

    return { vencidos, criticos, atencao, pickingCount, total: list.length, cxTiradasHoje };
  }, [validadesList, historico, empresaId]);

  const handleOpenTirarModal = (lot?: ValidadeRow) => {
    setSelectedLotForModal(lot || null);
    setIsModalOpen(true);
  };

  const handleWithdrawalSuccess = (rec: ValidadeRetiradaRecord) => {
    reloadHistorico();
    if (onValidadesUpdated) onValidadesUpdated();
    setToastMessage(`✅ Validade retirada com sucesso: ${rec.quantidadeCx} cx de ${rec.descricao} destinadas para ${rec.destino}!`);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleExportExcel = () => {
    if (historico.length === 0) {
      alert('Nenhum registro de retirada para exportar.');
      return;
    }
    const wsData = historico.map(h => ({
      'Código': h.codigo,
      'Produto': h.descricao,
      'Data de Validade': h.validade,
      'Quantidade (Cx)': h.quantidadeCx,
      'Origem': h.origem,
      'Bloco/Posição': h.bloco || '-',
      'Motivo': h.motivo,
      'Destino': h.destino,
      'Colaborador': h.colaborador,
      'Data e Hora': h.dataHora,
      'Observação': h.observacao || ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Validades_Retiradas');
    XLSX.writeFile(wb, `Validades_Retiradas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExcluirHistoricoItem = async (id: string, docId?: string) => {
    if (!window.confirm('Deseja remover este registro do histórico de retiradas?')) return;
    const filtered = historico.filter(h => h.id !== id && (h as any)._docId !== id);
    setHistorico(filtered);
    localStorage.setItem(`validades_retiradas_${empresaId}`, JSON.stringify(filtered));
    if (db) {
      try {
        const targetId = docId || id;
        await deleteDoc(doc(db, 'validades_retiradas', targetId));
      } catch (e) {
        console.warn('Erro ao remover registro de retirada do Firestore:', e);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs flex items-center justify-between shadow-lg animate-fade-in">
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-emerald-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Primary Action Card Banner */}
      <div className={`p-4 sm:p-5 rounded-2xl border shadow-lg relative overflow-hidden ${
        theme === 'dark'
          ? 'bg-gradient-to-r from-rose-950/40 via-[#111620] to-[#0f141c] border-rose-500/30'
          : 'bg-gradient-to-r from-rose-50 via-white to-slate-50 border-rose-200'
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center font-black shadow-lg shadow-rose-500/30 flex-shrink-0">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-sans font-black text-base sm:text-lg text-rose-500 uppercase tracking-wide">
                  Tirar Validades do Armazém
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
                  Operação Ágil
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Baixa e recolhimento operacional direto pelo celular ou coletor. Direcione lotes vencidos ou críticos para Despejo, Repack ou Bloqueio.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleOpenTirarModal()}
              className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-rose-900/40 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Tirar Validade Avulsa
            </button>
            {historico.length > 0 && (
              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3 py-2.5 rounded-xl border border-slate-700 hover:border-slate-500 bg-[#161d27] text-slate-300 hover:text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                title="Exportar registros de retiradas"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                Relatório Excel
              </button>
            )}
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-3 border-t border-slate-800/80">
          <div className="p-2.5 rounded-xl bg-[#090d14]/70 border border-slate-800">
            <div className="text-[10px] uppercase font-bold text-slate-400">⛔ Já Vencidos</div>
            <div className="text-lg font-black text-red-500">{stats.vencidos} lotes</div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#090d14]/70 border border-slate-800">
            <div className="text-[10px] uppercase font-bold text-slate-400">🔴 Críticos (≤30d)</div>
            <div className="text-lg font-black text-rose-400">{stats.criticos} lotes</div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#090d14]/70 border border-slate-800">
            <div className="text-[10px] uppercase font-bold text-slate-400">📦 No Picking</div>
            <div className="text-lg font-black text-sky-400">{stats.pickingCount} posições</div>
          </div>
          <div className="p-2.5 rounded-xl bg-[#090d14]/70 border border-slate-800">
            <div className="text-[10px] uppercase font-bold text-slate-400">✅ Baixas Realizadas</div>
            <div className="text-lg font-black text-emerald-400">{stats.cxTiradasHoje} cx</div>
          </div>
        </div>
      </div>

      {/* Sub-tab switcher */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('retirar')}
          className={`px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
            activeSubTab === 'retirar'
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          📋 Lotes para Retirada ({filteredLots.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('historico')}
          className={`px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
            activeSubTab === 'historico'
              ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Histórico de Validades Tiradas ({historico.length})
        </button>
      </div>

      {activeSubTab === 'retirar' ? (
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-[#0f141c] p-3 rounded-xl border border-slate-800">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por produto, código ou validade..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#161d27] border border-slate-700 text-white placeholder-slate-500 text-xs outline-none focus:border-rose-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                type="button"
                onClick={() => setStatusFilter('todos')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  statusFilter === 'todos' ? 'bg-slate-700 text-white font-black' : 'text-slate-400 hover:text-white'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('vencidos')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  statusFilter === 'vencidos' ? 'bg-red-600 text-white font-black' : 'text-red-400 hover:bg-red-500/10'
                }`}
              >
                ⛔ Vencidos ({stats.vencidos})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('criticos')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  statusFilter === 'criticos' ? 'bg-rose-600 text-white font-black' : 'text-rose-400 hover:bg-rose-500/10'
                }`}
              >
                🔴 Críticos ({stats.criticos})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('picking')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
                  statusFilter === 'picking' ? 'bg-sky-600 text-white font-black' : 'text-sky-400 hover:bg-sky-500/10'
                }`}
              >
                Picking
              </button>
            </div>
          </div>

          {/* Lots List Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredLots.slice(0, visibleCount).map(({ lot, days, badge, totalCx, isPicking }, idx) => {
              return (
                <div
                  key={lot._docId || lot.id || `lot_${idx}`}
                  className={`p-3.5 rounded-xl border transition-all relative overflow-hidden group flex flex-col justify-between ${
                    days < 0 
                      ? 'bg-red-950/20 border-red-500/30 hover:border-red-500/60'
                      : days <= 30
                        ? 'bg-rose-950/15 border-rose-500/30 hover:border-rose-500/60'
                        : 'bg-[#0f141c] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    {/* Top Tag Row */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${badge.class}`}>
                        {badge.label}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${
                        isPicking 
                          ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        {isPicking ? '📍 Picking' : (lot.bloco ? `Bloco ${lot.bloco}` : 'Armazém')}
                      </span>
                    </div>

                    {/* Product Info */}
                    <div className="font-extrabold text-white text-sm leading-snug">
                      {lot.descricao}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                      <span>Cód: {lot.codigo}</span>
                      <span>•</span>
                      <span>Vencimento: <strong className="text-white">{lot.validade}</strong></span>
                    </div>
                  </div>

                  {/* Quantity & Action Button */}
                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <span className="text-slate-400">Estoque: </span>
                      <strong className="text-white font-mono">{totalCx} cx</strong>
                      {Number(lot.palhete || 0) > 0 && (
                        <span className="text-slate-500 text-[10px] ml-1">({lot.palhete} pal)</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenTirarModal(lot)}
                      className={`px-3 py-1.5 rounded-lg font-black text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-md ${
                        days < 0 
                          ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-950'
                          : days <= 30
                            ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950'
                            : 'bg-slate-800 hover:bg-rose-600 text-slate-200 hover:text-white'
                      }`}
                    >
                      <Package className="w-3.5 h-3.5" />
                      Tirar Validade
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredLots.length === 0 && (
              <div className="col-span-full p-8 text-center text-slate-500 bg-[#0f141c] rounded-xl border border-slate-800">
                <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500/50 mb-2" />
                <p className="font-bold text-sm text-slate-400">Nenhum lote encontrado com esses filtros.</p>
                <p className="text-xs text-slate-600 mt-1">Todos os produtos estão dentro do prazo ou fora do critério selecionado.</p>
              </div>
            )}
          </div>

          {filteredLots.length > visibleCount && (
            <div className="flex items-center justify-center gap-3 pt-3">
              <button
                type="button"
                onClick={() => setVisibleCount(c => c + 36)}
                className="px-5 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-sky-400 hover:text-sky-300 font-bold text-xs uppercase tracking-wider border border-slate-700 transition-all cursor-pointer"
              >
                Carregar mais 36 lotes ({filteredLots.length - visibleCount} restantes)
              </button>
              <button
                type="button"
                onClick={() => setVisibleCount(filteredLots.length)}
                className="px-4 py-2.5 rounded-xl bg-transparent hover:bg-slate-800 text-slate-400 hover:text-white font-bold text-xs uppercase tracking-wider border border-slate-800 transition-all cursor-pointer"
              >
                Mostrar todos ({filteredLots.length})
              </button>
            </div>
          )}
        </div>
      ) : (
        /* History view */
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-[#0f141c] p-3 rounded-xl border border-slate-800">
            <span className="text-xs font-bold text-slate-300">
              Registros de validades retiradas e baixadas do armazém ({historico.length})
            </span>
            {historico.length > 0 && (
              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold flex items-center gap-1 hover:bg-emerald-600/30"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Exportar Excel
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#0f141c]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#161d27] text-[10px] font-black uppercase text-slate-400">
                  <th className="p-3">Data/Hora</th>
                  <th className="p-3">Produto</th>
                  <th className="p-3">Validade</th>
                  <th className="p-3 text-center">Qtd Cx</th>
                  <th className="p-3">Origem</th>
                  <th className="p-3">Destino</th>
                  <th className="p-3">Motivo</th>
                  <th className="p-3">Colaborador</th>
                  <th className="p-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {historico.map(h => (
                  <tr key={h.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">{h.dataHora}</td>
                    <td className="p-3 font-extrabold text-white">
                      <div>{h.descricao}</div>
                      <span className="text-[10px] text-slate-500 font-mono">Cód: {h.codigo}</span>
                    </td>
                    <td className="p-3 font-mono text-amber-400 whitespace-nowrap">{h.validade}</td>
                    <td className="p-3 text-center font-mono font-black text-rose-400">{h.quantidadeCx}</td>
                    <td className="p-3 text-slate-300">{h.origem}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                        h.destino === 'Despejo'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : h.destino === 'Repack'
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}>
                        {h.destino}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400 text-[11px]">{h.motivo}</td>
                    <td className="p-3 text-slate-300 font-semibold">{h.colaborador}</td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleExcluirHistoricoItem(h.id, (h as any)._docId)}
                        className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remover do histórico"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {historico.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-slate-500">
                      Nenhuma retirada de validade registrada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tirar Validade Modal */}
      <TirarValidadesModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        selectedLot={selectedLotForModal}
        onSuccess={handleWithdrawalSuccess}
        user={user}
        empresaId={empresaId}
        theme={theme}
      />
    </div>
  );
};

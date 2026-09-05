import React, { useState, useEffect } from 'react';
import { db, isCustomFirebaseConnected } from '../firebase';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { Usuario, Empresa, Tarefa, ArmazemTemperaturaLog, TmrDemand } from '../types';
import { useTarefasData, useColaboradoresData } from '../context/EmpresaDataContext';
import { PRODUCTS } from '../planosData';
import { filterHistoryForUser, HistoryRestrictionNotice } from '../utils/historyFilter';
import { addTmrDemand, getStoredTmrDemands, deleteTmrDemand, updateTmrDemandOperators } from '../utils/tmrManager';
import { Upload, FileSpreadsheet, CheckCircle2, Clock, AlertTriangle, Truck, Play, Check, Filter, Trash2, Edit3, Plus, X, Calendar, Thermometer, Droplets, AlertCircle, ShieldAlert, ShieldCheck, Users, Search, ArrowRight, ExternalLink } from 'lucide-react';
import ValidadesPanel from './ValidadesPanel';
import RefugoPanel from './RefugoPanel';
import TemperaturaImportExportBar from './TemperaturaImportExportBar';
import { Checklist5SForm, Collaborator5SPerformanceCard } from './Checklist5SModal';
import { GuiaAcoesOperacionais } from './GuiaAcoesOperacionais';
import { getStoredTempLogs } from '../utils/tempStorage';
import { saveJornadaRecord, saveMultipleJornadas, saveDailyFaturadoRecord, getStoredJornadas, getStoredMontagens, saveMontagemRecord, finalizarMontagemRecord, WlpMontagemRecord, JornadaRecord } from '../utils/jornadaUtils';

interface ConferentePanelProps {
  user: Usuario;
  empresa: Empresa | null;
  theme?: 'light' | 'dark';
  initialTab?: 'validade' | 'rr' | 'tmr' | 'retorno_rota' | 'temperatura' | 'wlp' | '5s' | 'acoes' | 'refugo';
}

export default function ConferentePanel({ user, empresa, initialTab, theme = 'dark' }: ConferentePanelProps) {
  const empresaId = empresa?.id || 'demo';
  const draftKey = `conferente_draft_${empresaId}_${user.nome || 'guest'}`;
  const tarefasFromContext = useTarefasData();
  const colaboradoresFromContext = useColaboradoresData();

  // Helper to load safe initial state
  const getDraftValue = (key: string, defaultValue: any) => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed[key] !== undefined) return parsed[key];
      }
    } catch (e) {
      console.error(e);
    }
    return defaultValue;
  };

  const [conferente, setConferente] = useState<string>(() => getDraftValue('conferente', ''));
  const [conferentes, setConferentes] = useState<string[]>(['GILSON ROSA DA SILVA', 'MATHEUS']);
  const [newConfName, setNewConfName] = useState('');

  const [searchQuery, setSearchQuery] = useState<string>(() => getDraftValue('searchQuery', ''));
  const [selectedProd, setSelectedProd] = useState<{ codigo: number, descricao: string } | null>(() => getDraftValue('selectedProd', null));
  const [quantidade, setQuantidade] = useState<number | ''>(() => {
    const val = getDraftValue('quantidade', '');
    return val === 1 ? '' : (val || '');
  });
  const [operator, setOperator] = useState<string>(() => getDraftValue('operator', ''));
  const [operators, setOperators] = useState<string[]>(['MARIVALDO', 'RONILDO', 'PAULO PEREIRA']);

  // Tasks lists
  const [tasks, setTasks] = useState<Tarefa[]>([]);
  const [activeTab, setActiveTab] = useState<'open' | 'done'>('open');
  const [creating, setCreating] = useState(false);
  const [draftRestored, setDraftRestored] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        return !!(parsed.searchQuery || parsed.selectedProd || (parsed.quantidade && parsed.quantidade !== 1) || parsed.operator);
      }
    } catch (e) {}
    return false;
  });

  // Dispatch Category State: 'picking' | 'tmr'
  const [dispatchType, setDispatchType] = useState<'picking' | 'tmr'>('picking');
  const [tmrTipoPlaca, setTmrTipoPlaca] = useState<'casa' | 'terceiros'>('casa');
  const [tmrPlacaCasa, setTmrPlacaCasa] = useState<string>('RLT5J54');
  const [tmrCarreta, setTmrCarreta] = useState('');
  const [tmrRevenda, setTmrRevenda] = useState('');
  const [tmrTipoCarga, setTmrTipoCarga] = useState<'TMR Revenda' | 'Carreta Transbordo' | 'Recarga' | 'Terceiros'>('TMR Revenda');
  const [tmrInstrucoes, setTmrInstrucoes] = useState('');
  const [tmrLitrinho, setTmrLitrinho] = useState<number | ''>('');
  const [tmrLitrao, setTmrLitrao] = useState<number | ''>('');
  const [tmr600Verde, setTmr600Verde] = useState<number | ''>('');
  const [tmr600Ambar, setTmr600Ambar] = useState<number | ''>('');
  const [tmrBarrilChopp, setTmrBarrilChopp] = useState<number | ''>('');
  const [tmrPbr1, setTmrPbr1] = useState<number | ''>('');
  const [tmrPbr2, setTmrPbr2] = useState<number | ''>('');

  // TMR Management & History states
  const [selectedTmrOperators, setSelectedTmrOperators] = useState<string[]>([]);
  const [tmrSubTab, setTmrSubTab] = useState<'ativas' | 'historico'>('ativas');
  const [tmrSearchFilter, setTmrSearchFilter] = useState('');
  const [tmrStatusFilter, setTmrStatusFilter] = useState<'todas' | 'pending' | 'in_progress' | 'done'>('todas');
  const [redelegateDemand, setRedelegateDemand] = useState<TmrDemand | null>(null);
  const [redelegateOps, setRedelegateOps] = useState<string[]>([]);

  // Temperature State
  const [tempDataISO, setTempDataISO] = useState<string>(new Date().toISOString().split('T')[0]);
  const [tempHora, setTempHora] = useState<string>('09:00');
  const [tempValor, setTempValor] = useState<string>('');
  const [tempUmidade, setTempUmidade] = useState<string>('58');
  const [tempSetor, setTempSetor] = useState<string>('Armazém Central');
  const [tempObs, setTempObs] = useState<string>('');

  // Conferente Shift / Journey Management
  const shiftKey = `conferente_shift_${empresaId}_${user?.uid || user?.nome || 'conferente'}`;
  const [shiftStarted, setShiftStarted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(shiftKey + '_active') === 'true';
    } catch {
      return false;
    }
  });
  const [shiftStartTime, setShiftStartTime] = useState<string>(() => {
    try {
      return localStorage.getItem(shiftKey + '_start_time') || '';
    } catch {
      return '';
    }
  });

  const handleStartShift = () => {
    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setShiftStarted(true);
    setShiftStartTime(nowStr);
    localStorage.setItem(shiftKey + '_active', 'true');
    localStorage.setItem(shiftKey + '_start_time', nowStr);
    alert(`🚀 Jornada do Conferente iniciada às ${nowStr}! Ponto de início registrado no WLP.`);
  };

  const handleEndShift = () => {
    if (!window.confirm('Confirma o encerramento da jornada do Conferente?')) return;

    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const todayISO = new Date().toISOString().split('T')[0];
    const parts = todayISO.split('-');
    const mesAno = `${parts[1]}/${parts[0]}`;

    let durHrs = 7.33;
    if (shiftStartTime) {
      try {
        const [h1, m1] = shiftStartTime.split(':').map(Number);
        const [h2, m2] = nowStr.split(':').map(Number);
        const diffMins = Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1));
        durHrs = parseFloat((diffMins / 60).toFixed(2)) || 7.33;
      } catch (e) {}
    }

    const record: JornadaRecord = {
      id: `jrn-conf-${Date.now()}`,
      colaboradorNome: user?.nome || conferente || 'Conferente',
      cargo: 'Conferente',
      dataStr: todayStr,
      dataISO: todayISO,
      mesAno,
      horaInicio: shiftStartTime || '07:00',
      horaFim: nowStr,
      duracaoHoras: durHrs,
      empresaId,
      observacoes: 'Jornada encerrada via Painel do Conferente',
      criadoEm: new Date().toISOString()
    };

    saveJornadaRecord(record);

    setShiftStarted(false);
    setShiftStartTime('');
    localStorage.removeItem(shiftKey + '_active');
    localStorage.removeItem(shiftKey + '_start_time');

    alert(`🏁 Jornada do Conferente encerrada às ${nowStr}! Duração total: ${durHrs}h. Ponto computado no Dashboard WLP.`);
  };

  const handleCreateTmrDemand = () => {
    if (!conferente) {
      alert('Selecione seu nome de Conferente antes de despachar.');
      return;
    }
    
    const finalPlaca = tmrTipoPlaca === 'casa' ? tmrPlacaCasa : tmrCarreta.trim().toUpperCase();
    if (!finalPlaca) {
      alert('Informe a placa da carreta de terceiros ou selecione uma Carreta da Casa.');
      return;
    }

    const nLitrinho = Number(tmrLitrinho || 0);
    const nLitrao = Number(tmrLitrao || 0);
    const n600Verde = Number(tmr600Verde || 0);
    const n600Ambar = Number(tmr600Ambar || 0);
    const nBarrilChopp = Number(tmrBarrilChopp || 0);
    const nPbr1 = Number(tmrPbr1 || 0);
    const nPbr2 = Number(tmrPbr2 || 0);

    const totalP = nLitrinho + nLitrao + n600Verde + n600Ambar + nBarrilChopp + nPbr1 + nPbr2;
    
    // For House Trailers: active asset assignment is mandatory
    if (tmrTipoPlaca === 'casa' && totalP <= 0) {
      alert(`Para Carretas da Casa (${finalPlaca}), é obrigatório atribuir a quantidade de ativos de giro (Litrinho, Litrão, 600 Verde, 600 Âmbar, Chopp, PBR1 ou PBR2).`);
      return;
    }

    const opDesignadoStr = selectedTmrOperators.length > 0 
      ? selectedTmrOperators.join(', ') 
      : (operator || 'TODOS');

    addTmrDemand(empresaId, {
      carreta: finalPlaca,
      tipoPlaca: tmrTipoPlaca,
      isTerceiros: tmrTipoPlaca === 'terceiros',
      revendaNome: tmrRevenda.trim() || (tmrTipoPlaca === 'terceiros' ? 'Carreta Terceiros' : 'Revenda / Unidade'),
      tipoCarga: tmrTipoCarga,
      instrucoes: tmrInstrucoes.trim(),
      palletsLitrinho: nLitrinho,
      palletsLitrao: nLitrao,
      pallets600Verde: n600Verde,
      pallets600Ambar: n600Ambar,
      palletsBarrilChopp: nBarrilChopp,
      palletsPbr1: nPbr1,
      palletsPbr2: nPbr2,
      palletsPbr: nPbr1 + nPbr2,
      totalPallets: totalP,
      conferente,
      operadorDesignado: opDesignadoStr,
      operadoresAtribuidos: selectedTmrOperators.length > 0 ? selectedTmrOperators : undefined
    });

    setTmrCarreta('');
    setTmrRevenda('');
    setTmrInstrucoes('');
    setTmrLitrinho('');
    setTmrLitrao('');
    setTmr600Verde('');
    setTmr600Ambar('');
    setTmrBarrilChopp('');
    setTmrPbr1('');
    setTmrPbr2('');
    setSelectedTmrOperators([]);
    setTmrDemands(getStoredTmrDemands(empresaId));
  };

  const handleOpenRedelegateModal = (demand: TmrDemand) => {
    setRedelegateDemand(demand);
    if (demand.operadoresAtribuidos && demand.operadoresAtribuidos.length > 0) {
      setRedelegateOps([...demand.operadoresAtribuidos]);
    } else if (demand.operadorDesignado && demand.operadorDesignado !== 'TODOS') {
      setRedelegateOps(demand.operadorDesignado.split(', ').map(s => s.trim()));
    } else {
      setRedelegateOps([]);
    }
  };

  const handleSaveRedelegation = () => {
    if (!redelegateDemand) return;
    const opStr = redelegateOps.length > 0 ? redelegateOps.join(', ') : 'TODOS';
    updateTmrDemandOperators(empresaId, redelegateDemand.id, opStr, redelegateOps);
    setTmrDemands(getStoredTmrDemands(empresaId));
    setRedelegateDemand(null);
  };

  const handleDeleteTmrDemand = (id: string) => {
    if (confirm('Tem certeza de que deseja cancelar/excluir esta demanda TMR?')) {
      deleteTmrDemand(empresaId, id);
      setTmrDemands(getStoredTmrDemands(empresaId));
    }
  };

  // Subtab navigation: 'validade' | 'rr' | 'tmr' | 'retorno_rota' | 'temperatura' | 'wlp' | '5s' | 'acoes'
  const [panelTab, setPanelTab] = useState<'validade' | 'rr' | 'tmr' | 'retorno_rota' | 'temperatura' | 'wlp' | '5s' | 'acoes'>(
    initialTab === 'refugo' ? 'retorno_rota' : ((initialTab as any) || 'validade')
  );

  useEffect(() => {
    if (initialTab) {
      setPanelTab(initialTab === 'refugo' ? 'retorno_rota' : ((initialTab as any) || 'validade'));
    }
  }, [initialTab]);

  // WLP Shift & Assembly States for Conferente
  const [wlpDataISO, setWlpDataISO] = useState<string>(new Date().toISOString().split('T')[0]);
  const [wlpTurno, setWlpTurno] = useState<'Noite' | 'Dia'>('Noite');
  const [wlpHoraInicioMontagem, setWlpHoraInicioMontagem] = useState<string>('18:00');
  const [wlpHoraFimMontagem, setWlpHoraFimMontagem] = useState<string>('01:30');
  const [wlpVolumeHL, setWlpVolumeHL] = useState<number | ''>(680.5);

  // Official team definitions matching master collaborator records
  const EQUIPE_NOTURNA_PADRAO = [
    { nome: 'CICERO MATHEU DE OLIVEIRA SILVA', cargo: 'Conferente', apelido: 'Cicero Mateu' },
    { nome: 'ELDENKLEBER MAURICIO DA SILVA', cargo: 'Ajudante', apelido: 'Eldenkleber' },
    { nome: 'NATANAEL LUIZ DA SILVA', cargo: 'Ajudante', apelido: 'Natanael' },
    { nome: 'EDILSON VIEIRA DA SILVA', cargo: 'Ajudante', apelido: 'Edilson' },
    { nome: 'LUIS ANTONIO FREIRE MOREIRA', cargo: 'Ajudante', apelido: 'Luis' },
    { nome: 'ADMILTON HERMINIO DOS SANTOS MARCELINO', cargo: 'Ajudante', apelido: 'Admilton' },
    { nome: 'DIMAS EMANUEL MISSIAS DA SILVA', cargo: 'Ajudante', apelido: 'Dimas' },
    { nome: 'PAULO PEREIRA DA SILVA', cargo: 'Empilhador', apelido: 'Paulo Pereira' },
    { nome: 'DIOGENES PEREIRA DA SILVA', cargo: 'Ajudante', apelido: 'Diogenes' }
  ];

  const EQUIPE_DIURNA_PADRAO = [
    { nome: 'GILSON ROSA DA SILVA', cargo: 'Conferente', apelido: 'Gilson' },
    { nome: 'GLADSON LISBOA DOS SANTOS', cargo: 'Conferente', apelido: 'Gladson' },
    { nome: 'OZENILDO SOUSA SILVA', cargo: 'Ajudante', apelido: 'Ozenildo' },
    { nome: 'DEJEAN SILVA DE OLIVEIRA', cargo: 'Ajudante', apelido: 'Dejean' },
    { nome: 'MARIVALDO ARTUR ALVES', cargo: 'Empilhador', apelido: 'Marivaldo' },
    { nome: 'JOSE RONILDO DA SILVA', cargo: 'Empilhador', apelido: 'Ronildo' }
  ];

  // Selected present collaborators
  const [selectedNightColabs, setSelectedNightColabs] = useState<string[]>(EQUIPE_NOTURNA_PADRAO.map(c => c.nome));
  const [selectedDayColabs, setSelectedDayColabs] = useState<string[]>(EQUIPE_DIURNA_PADRAO.map(c => c.nome));

  const [wlpExtraColabs, setWlpExtraColabs] = useState<Array<{ id: string; nome: string; cargo: string; horaInicio: string; horaFim: string; duracaoHoras: number }>>([]);
  
  const [extraNome, setExtraNome] = useState('');
  const [extraCargo, setExtraCargo] = useState<'Ajudante' | 'Empilhador' | 'Conferente'>('Ajudante');
  const [extraHoraInicio, setExtraHoraInicio] = useState('07:00');
  const [extraHoraFim, setExtraHoraFim] = useState('16:20');

  // Lock shift time state
  const shiftLockKey = `wlp_shift_locked_${wlpDataISO}_${wlpTurno}`;
  const [isShiftTimeLocked, setIsShiftTimeLocked] = useState<boolean>(() => !!localStorage.getItem(`wlp_shift_locked_${wlpDataISO}_${wlpTurno}`));

  useEffect(() => {
    setIsShiftTimeLocked(!!localStorage.getItem(`wlp_shift_locked_${wlpDataISO}_${wlpTurno}`));
  }, [wlpDataISO, wlpTurno]);

  const calcShiftHours = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const [h1, m1] = start.split(':').map(Number);
    const [h2, m2] = end.split(':').map(Number);
    let mins1 = h1 * 60 + m1;
    let mins2 = h2 * 60 + m2;
    if (mins2 < mins1) mins2 += 24 * 60; // Overnight shift past midnight
    const diffMins = mins2 - mins1;
    return parseFloat((diffMins / 60).toFixed(2));
  };

  const handleToggleNightColab = (nome: string) => {
    setSelectedNightColabs(prev => 
      prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome]
    );
  };

  const handleSelectAllNight = () => {
    if (selectedNightColabs.length === EQUIPE_NOTURNA_PADRAO.length) {
      setSelectedNightColabs([]);
    } else {
      setSelectedNightColabs(EQUIPE_NOTURNA_PADRAO.map(c => c.nome));
    }
  };

  const handleToggleDayColab = (nome: string) => {
    setSelectedDayColabs(prev => 
      prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome]
    );
  };

  const handleSelectAllDay = () => {
    if (selectedDayColabs.length === EQUIPE_DIURNA_PADRAO.length) {
      setSelectedDayColabs([]);
    } else {
      setSelectedDayColabs(EQUIPE_DIURNA_PADRAO.map(c => c.nome));
    }
  };

  const handleAddExtraColab = () => {
    if (!extraNome.trim()) {
      alert('Informe o nome do colaborador extra.');
      return;
    }
    const dur = calcShiftHours(extraHoraInicio, extraHoraFim);
    const newItem = {
      id: `extra-${Date.now()}`,
      nome: extraNome.trim().toUpperCase(),
      cargo: extraCargo,
      horaInicio: extraHoraInicio,
      horaFim: extraHoraFim,
      duracaoHoras: dur
    };
    setWlpExtraColabs(prev => [...prev, newItem]);
    setExtraNome('');
    toast(`Colaborador extra ${newItem.nome} adicionado (${dur}h).`);
  };

  const handleRemoveExtraColab = (id: string) => {
    setWlpExtraColabs(prev => prev.filter(c => c.id !== id));
  };

  const handleSaveWlpShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wlpDataISO) {
      alert('Selecione a data do turno.');
      return;
    }

    const volumeNum = Number(wlpVolumeHL) || 0;
    const parts = wlpDataISO.split('-');
    const dataStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
    const mesAno = `${parts[1]}/${parts[0]}`;

    // 1. Save Daily Faturado HL record for WLP (Night shift only required)
    if (wlpTurno === 'Noite' && volumeNum > 0) {
      saveDailyFaturadoRecord({
        id: `fat-${wlpDataISO}`,
        dataISO: wlpDataISO,
        dataStr,
        mesAno,
        volumeHL: volumeNum,
        empresaId,
        registradoPor: `${user?.nome || conferente || 'Conferente'} (Noite)`,
        registradoEm: new Date().toISOString(),
        origem: 'MANUAL'
      });
    }

    // 2. Generate Jornada Records for Present Collaborators
    const newJornadas: JornadaRecord[] = [];
    const dur = calcShiftHours(wlpHoraInicioMontagem, wlpHoraFimMontagem);

    if (wlpTurno === 'Noite') {
      if (selectedNightColabs.length === 0) {
        alert('Selecione ao menos um colaborador presente no turno noturno.');
        return;
      }

      // Record WLP Montagem
      saveMontagemRecord({
        id: `montagem-${wlpDataISO}`,
        dataISO: wlpDataISO,
        dataStr,
        mesAno,
        conferenteInicio: user?.nome || conferente || 'Conferente Noturno',
        horaInicio: wlpHoraInicioMontagem,
        horaFim: wlpHoraFimMontagem,
        duracaoHoras: dur,
        status: 'FINALIZADA',
        volumeHL: volumeNum,
        qtdColaboradores: selectedNightColabs.length,
        empresaId,
        observacoes: `Montagem Noturna (${selectedNightColabs.length} colabs presentes)`,
        criadoEm: new Date().toISOString()
      });

      selectedNightColabs.forEach((nomeColab, i) => {
        const foundObj = EQUIPE_NOTURNA_PADRAO.find(c => c.nome === nomeColab);
        newJornadas.push({
          id: `jrn-noturna-${wlpDataISO}-${i}-${Date.now()}`,
          colaboradorNome: nomeColab,
          cargo: foundObj?.cargo || 'Ajudante',
          dataStr,
          dataISO: wlpDataISO,
          mesAno,
          horaInicio: wlpHoraInicioMontagem,
          horaFim: wlpHoraFimMontagem,
          duracaoHoras: dur,
          empresaId,
          observacoes: `Montagem Noite (${wlpHoraInicioMontagem} às ${wlpHoraFimMontagem}) - Apontado via Conferente`,
          criadoEm: new Date().toISOString()
        });
      });
    } else {
      if (selectedDayColabs.length === 0) {
        alert('Selecione ao menos um colaborador presente no turno diurno.');
        return;
      }

      selectedDayColabs.forEach((nomeColab, i) => {
        const foundObj = EQUIPE_DIURNA_PADRAO.find(c => c.nome === nomeColab);
        newJornadas.push({
          id: `jrn-diurna-${wlpDataISO}-${i}-${Date.now()}`,
          colaboradorNome: nomeColab,
          cargo: foundObj?.cargo || 'Ajudante',
          dataStr,
          dataISO: wlpDataISO,
          mesAno,
          horaInicio: wlpHoraInicioMontagem,
          horaFim: wlpHoraFimMontagem,
          duracaoHoras: dur,
          empresaId,
          observacoes: `Turno Diurno (${wlpHoraInicioMontagem} às ${wlpHoraFimMontagem}) - Apontado via Conferente`,
          criadoEm: new Date().toISOString()
        });
      });
    }

    // 3. Add Extra Collaborators Journeys
    wlpExtraColabs.forEach((ext, i) => {
      newJornadas.push({
        id: `jrn-extra-${wlpDataISO}-${i}-${Date.now()}`,
        colaboradorNome: ext.nome,
        cargo: ext.cargo,
        dataStr,
        dataISO: wlpDataISO,
        mesAno,
        horaInicio: ext.horaInicio,
        horaFim: ext.horaFim,
        duracaoHoras: ext.duracaoHoras,
        empresaId,
        observacoes: `Colaborador Extra adicionado no Apontamento WLP`,
        criadoEm: new Date().toISOString()
      });
    });

    if (newJornadas.length > 0) {
      saveMultipleJornadas(newJornadas, empresaId);
    }

    // Lock shift start time so it cannot be re-opened/re-started
    localStorage.setItem(`wlp_shift_locked_${wlpDataISO}_${wlpTurno}`, 'true');
    setIsShiftTimeLocked(true);

    if (newJornadas.length > 0) {
      saveMultipleJornadas(newJornadas, empresaId);
    }

    window.dispatchEvent(new CustomEvent('app_data_updated'));
    window.dispatchEvent(new CustomEvent('local_data_changed'));

    toast(`Turno de ${dataStr} salvo! ${newJornadas.length} jornada(s) computada(s) no WLP.`);
    setWlpExtraColabs([]);
  };

  // TMR Demands State
  const [tmrDemands, setTmrDemands] = useState(() => getStoredTmrDemands(empresaId));

  // Temperature Logs State & Handlers
  const [tempLogs, setTempLogs] = useState<ArmazemTemperaturaLog[]>(() => {
    return getStoredTempLogs();
  });

  const reloadTempLogs = () => {
    setTempLogs(getStoredTempLogs());
  };

  useEffect(() => {
    window.addEventListener('armazem_temp_updated', reloadTempLogs);
    window.addEventListener('armazem_temp_logs_updated', reloadTempLogs);
    window.addEventListener('storage', reloadTempLogs);
    return () => {
      window.removeEventListener('armazem_temp_updated', reloadTempLogs);
      window.removeEventListener('armazem_temp_logs_updated', reloadTempLogs);
      window.removeEventListener('storage', reloadTempLogs);
    };
  }, []);

  const handleSaveTempLog = (e: React.FormEvent) => {
    e.preventDefault();
    const tempNum = parseFloat(tempValor);
    if (isNaN(tempNum)) {
      alert('Informe uma temperatura válida em °C (ex: 22.5).');
      return;
    }
    const umidNum = parseInt(tempUmidade, 10) || 55;
    const parts = tempDataISO.split('-');
    const dataFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
    const mesAno = `${parts[1]}/${parts[0]}`;
    const isAlerta = tempNum > 28.0 || tempNum < 18.0;
    const loggedUserLabel = `${user?.nome || conferente || 'Conferente Responsável'} (${user?.cargo || 'Conferente / ADM'})`;

    const newLog: ArmazemTemperaturaLog = {
      id: `temp-${tempDataISO}-${tempHora.replace(':', '')}`,
      dataISO: tempDataISO,
      dataFormatted,
      mesAno,
      hora: tempHora,
      temperatura: tempNum,
      umidade: umidNum,
      setor: tempSetor || 'Armazém Central',
      conferenteNome: user?.nome || conferente || 'Conferente Responsável',
      registradoPor: loggedUserLabel,
      cargoUsuario: user?.cargo || 'Conferente / ADM',
      observacao: tempObs.trim() || (isAlerta ? `⚠️ ALERTA DE TEMPERATURA FORA DO PADRÃO (${tempNum}°C)` : 'Aferição registrada com sucesso'),
      alertaCritico: isAlerta
    };

    const filtered = tempLogs.filter(l => !(l.dataISO === tempDataISO && l.hora === tempHora));
    const updated = [newLog, ...filtered];
    updated.sort((a, b) => b.dataISO.localeCompare(a.dataISO) || b.hora.localeCompare(a.hora));

    setTempLogs(updated);
    localStorage.setItem('armazem_temperatura_logs', JSON.stringify(updated));
    window.dispatchEvent(new Event('armazem_temp_updated'));
    toast(`Temperatura de ${tempNum}°C (${tempHora}) registrada por ${loggedUserLabel}!`);

    setTempValor('');
    setTempObs('');
  };

  const handleDeleteTempLog = (id: string) => {
    const updated = tempLogs.filter(l => l.id !== id);
    setTempLogs(updated);
    localStorage.setItem('armazem_temperatura_logs', JSON.stringify(updated));
    window.dispatchEvent(new Event('armazem_temp_updated'));
    toast('Registro de temperatura removido.');
  };

  useEffect(() => {
    const handleTmrUpdate = () => {
      setTmrDemands(getStoredTmrDemands(empresaId));
    };

    window.addEventListener('tmr_demands_updated', handleTmrUpdate);
    window.addEventListener('storage', handleTmrUpdate);
    window.addEventListener('local_data_changed', handleTmrUpdate);

    return () => {
      window.removeEventListener('tmr_demands_updated', handleTmrUpdate);
      window.removeEventListener('storage', handleTmrUpdate);
      window.removeEventListener('local_data_changed', handleTmrUpdate);
    };
  }, [empresaId]);

  // Transfer Night Assembly to Day Shift
  const handleTransferMontagemToDay = () => {
    if (!window.confirm('Confirma a transferência da montagem noturna para o turno do dia? As horas dos ajudantes noturnos (Eldenkleber, Natanael, Edilson, Luis, Admilton, Dimas) serão encerradas e o desvio será registrado no WLP.')) {
      return;
    }

    const nowStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const todayISO = new Date().toISOString().split('T')[0];
    const montagens = getStoredMontagens(empresaId);
    const active = montagens.find(m => m.dataISO === todayISO || m.status === 'EM_ANDAMENTO');

    if (active) {
      finalizarMontagemRecord(active.id, user?.nome || conferente || 'Conferente Diurno', nowStr, true, empresaId);
    } else {
      const parts = todayISO.split('-');
      const dataStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
      const mesAno = `${parts[1]}/${parts[0]}`;
      saveMontagemRecord({
        id: `montagem-transf-${Date.now()}`,
        dataISO: todayISO,
        dataStr,
        mesAno,
        conferenteInicio: 'Conferente Noturno',
        conferenteFim: user?.nome || conferente || 'Conferente Diurno',
        horaInicio: '18:00',
        horaFim: nowStr,
        status: 'FINALIZADA',
        finalizadoPelaManha: true,
        duracaoHoras: 13.5,
        qtdColaboradores: 7,
        empresaId,
        observacoes: 'Montagem noturna transferida e finalizada pelo turno diurno',
        criadoEm: new Date().toISOString()
      });
    }

    window.dispatchEvent(new CustomEvent('app_data_updated'));
    window.dispatchEvent(new Event('wlp_montagem_updated'));
    window.dispatchEvent(new Event('storage'));

    toast(`🔄 Montagem transferida para o turno diurno às ${nowStr}! Desvio de WLP computado.`);
  };

  const toast = (msg: string) => {
    const el = document.createElement('div');
    el.className = 'fixed bottom-5 right-5 bg-[#032b5e] text-white text-xs font-bold px-4 py-3 rounded-xl shadow-2xl z-50 border border-amber-400';
    el.innerText = `⚡ ${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  };

  // Sync state with local draft saving (debounced 300ms to eliminate UI freezing)
  useEffect(() => {
    const timer = setTimeout(() => {
      const draftData = {
        conferente,
        searchQuery,
        selectedProd,
        quantidade,
        operator
      };
      localStorage.setItem(draftKey, JSON.stringify(draftData));
    }, 300);
    return () => clearTimeout(timer);
  }, [conferente, searchQuery, selectedProd, quantidade, operator, draftKey]);

  // Sync with prop updates / user changing
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setConferente(parsed.conferente || '');
        setSearchQuery(parsed.searchQuery || '');
        setSelectedProd(parsed.selectedProd || null);
        setQuantidade(parsed.quantidade === 1 ? '' : (parsed.quantidade || ''));
        setOperator(parsed.operator || '');
        setDraftRestored(!!(parsed.searchQuery || parsed.selectedProd || (parsed.quantidade && parsed.quantidade !== 1) || parsed.operator));
      } else {
        setConferente('');
        setSearchQuery('');
        setSelectedProd(null);
        setQuantidade('');
        setOperator('');
        setDraftRestored(false);
      }
    } catch (e) {
      console.error(e);
    }
  }, [draftKey]);

  // Read config list and user states from local storage (recovery)
  useEffect(() => {
    const cached = localStorage.getItem(`conferente_state_${empresaId}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.conferentes) setConferentes(parsed.conferentes);
        if (parsed.conferente) setConferente(parsed.conferente);
        setOperators(['MARIVALDO', 'RONILDO', 'PAULO PEREIRA']);
      } catch (e) {}
    }
  }, [empresaId]);

  // Sync with Firestore Tasks (scoped to company)
  useEffect(() => {
    if (!db) {
      const savedTasks = localStorage.getItem(`tasks_${empresaId}`);
      if (savedTasks) setTasks(JSON.parse(savedTasks));
      return;
    }

    const rows = [...(tarefasFromContext || [])];
    rows.sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''));
    setTasks(rows);
    localStorage.setItem(`tasks_${empresaId}`, JSON.stringify(rows));
  }, [tarefasFromContext, empresaId]);

  // Sync colaboradores from Firestore/localStorage to use as operators and conferentes
  useEffect(() => {
    const allowedOps = ['MARIVALDO', 'RONILDO', 'PAULO PEREIRA'];
    setOperators(allowedOps);

    if (!db) {
      const savedColab = localStorage.getItem(`colaboradores_${empresaId}`);
      if (savedColab) {
        const list = JSON.parse(savedColab);
        const confs = list
          .filter((c: any) => (c.funcao || '').toLowerCase() === 'conferente')
          .map((c: any) => c.nome.toUpperCase());
        if (confs.length > 0) setConferentes(confs);
      }
      return;
    }

    const list = colaboradoresFromContext || [];
    const confs = list
      .filter((c: any) => (c.funcao || '').toLowerCase() === 'conferente')
      .map((c: any) => c.nome.toUpperCase());
    if (confs.length > 0) setConferentes(confs);
  }, [colaboradoresFromContext, empresaId]);

  const persistState = (extra: Record<string, any> = {}) => {
    localStorage.setItem(`conferente_state_${empresaId}`, JSON.stringify({
      conferentes,
      conferente,
      operators,
      ...extra
    }));
  };

  const handleAddConferente = () => {
    const clean = newConfName.trim().toUpperCase();
    if (!clean || conferentes.includes(clean)) return;
    const upd = [...conferentes, clean];
    setConferentes(upd);
    setNewConfName('');
    localStorage.setItem(`conferente_state_${empresaId}`, JSON.stringify({ conferes: upd, conferente, operators }));
    toast('Conferente adicionado: ' + clean);
  };

  const handleCreateTask = async () => {
    if (!conferente || !operator || !quantidade || !selectedProd) {
      alert('Certifique-se de selecionar seu nome de Conferente, o produto e o Operador designado.');
      return;
    }

    setCreating(true);

    const newRow: Omit<Tarefa, '_docId'> & { empresaId: string } = {
      empresaId,
      id: Date.now() % 100000,
      codigo: selectedProd.codigo,
      descricao: selectedProd.descricao,
      quantidade: Number(quantidade),
      conferente,
      operador: operator,
      status: 'pending',
      criadoEm: new Date().toISOString(),
      iniciadoEm: null,
      finalizadoEm: null,
      duracaoMin: null
    };

    try {
      if (db) {
        await addDoc(collection(db, 'tarefas'), newRow);
      } else {
        const current = [...tasks, { _docId: String(Date.now()), ...newRow }];
        setTasks(current);
        localStorage.setItem(`tasks_${empresaId}`, JSON.stringify(current));
        localStorage.setItem(`tarefas_rows_${empresaId}`, JSON.stringify(current));
      }

      window.dispatchEvent(new CustomEvent('app_data_updated'));
      window.dispatchEvent(new CustomEvent('local_data_changed'));

      setSelectedProd(null);
      setSearchQuery('');
      setQuantidade('');
      setOperator('');
      setDraftRestored(false);
      localStorage.removeItem(draftKey);
      toast('Tarefa #' + newRow.id + ' despachada para ' + operator);
    } catch(e) {
      alert('Erro ao despachar tarefa: ' + e);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTask = async (t: Tarefa) => {
    try {
      if (db && t._docId) {
        await deleteDoc(doc(db, 'tarefas', t._docId));
      } else {
        const remaining = tasks.filter(x => x.id !== t.id);
        setTasks(remaining);
        localStorage.setItem(`tasks_${empresaId}`, JSON.stringify(remaining));
      }
      toast('Tarefa #' + t.id + ' removida com sucesso.');
    } catch (e) {
      console.error(e);
      toast('Erro ao excluir tarefa #' + t.id);
    }
  };

  // Filter products for autocomplete dropdown
  const filteredProducts = PRODUCTS.filter(p => {
    const q = searchQuery.toLowerCase().trim();
    return !q || String(p.codigo).includes(q) || p.descricao.toLowerCase().includes(q);
  }).slice(0, 10);

  // Sync data lists
  const openTasksList = tasks.filter(t => t.status !== 'done');
  const doneTasksList = filterHistoryForUser<Tarefa>(tasks.filter(t => t.status === 'done'), user, (item: Tarefa) => item.finalizadoEm ? item.finalizadoEm.split('T')[0] : (item.criadoEm ? item.criadoEm.split('T')[0] : ''));

  return (
    <div className="flex flex-col gap-6">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-[#11151c] border border-[#222d3a] rounded-xl w-full gap-3">
        <div>
          <span className="font-sans font-black text-sm tracking-widest text-[#f5a623] uppercase flex items-center gap-2">
            <Truck className="w-4 h-4 text-amber-400" /> CONFERÊNCIA & CONTROLE OPERACIONAL
          </span>
          <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
            Recolhimento de Validades & FEFO, Ressuprimento (R&R), TMR e Retorno de Rota
          </p>
        </div>
        <div className="text-[10px] text-[#22c55e] font-sans font-bold uppercase tracking-wider bg-[#22c55e]/10 px-3 py-1 rounded-full border border-[#22c55e]/20">
          Ambev DPO Operacional
        </div>
      </div>

      {/* CONTROLE DE JORNADA DO CONFERENTE */}
      <div className="bg-[#151b23] border border-amber-500/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-extrabold text-lg">
            ⏱️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Jornada do Conferente</h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest ${
                shiftStarted 
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                {shiftStarted ? `JORNADA ATIVA (Início: ${shiftStartTime})` : 'JORNADA FECHADA'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {shiftStarted 
                ? `Conferente ${user?.nome || conferente || 'Operacional'} trabalhando. Registre seus lançamentos de Validades, R&R e TMR.`
                : 'Inicie sua jornada para registrar os pontos de início e término e alimentar os indicadores operacionais.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!shiftStarted ? (
            <button
              type="button"
              onClick={handleStartShift}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-md flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" /> Iniciar Jornada
            </button>
          ) : (
            <button
              type="button"
              onClick={handleEndShift}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-md flex items-center gap-2"
            >
              <X className="w-4 h-4" /> Encerrar Jornada
            </button>
          )}
        </div>
      </div>

      {/* QUADRO DE DEMANDAS PENDENTES (RESUMO OPERACIONAL DO CONFERENTE) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div 
          onClick={() => setPanelTab('validade')}
          className="p-3.5 bg-[#151b23] border border-emerald-500/30 rounded-xl flex items-center justify-between cursor-pointer hover:border-emerald-400/60 transition-colors"
        >
          <div>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">Validades & FEFO</span>
            <span className="text-sm font-black text-white mt-0.5 block">
              Recolhimento Ativo
            </span>
          </div>
          <Calendar className="w-5 h-5 text-emerald-400" />
        </div>

        <div 
          onClick={() => setPanelTab('rr')}
          className="p-3.5 bg-[#151b23] border border-amber-500/30 rounded-xl flex items-center justify-between cursor-pointer hover:border-amber-400/60 transition-colors"
        >
          <div>
            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">R&R Pendentes</span>
            <span className="text-xl font-black text-white font-mono mt-0.5 block">
              {openTasksList.length}
            </span>
          </div>
          <CheckCircle2 className="w-5 h-5 text-amber-400" />
        </div>

        <div 
          onClick={() => setPanelTab('tmr')}
          className="p-3.5 bg-[#151b23] border border-purple-500/30 rounded-xl flex items-center justify-between cursor-pointer hover:border-purple-400/60 transition-colors"
        >
          <div>
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">TMR Pendentes</span>
            <span className="text-xl font-black text-white font-mono mt-0.5 block">
              {tmrDemands.filter(t => t.status !== 'done').length}
            </span>
          </div>
          <FileSpreadsheet className="w-5 h-5 text-purple-400" />
        </div>

        <div 
          onClick={() => setPanelTab('retorno_rota')}
          className="p-3.5 bg-[#151b23] border border-indigo-500/30 rounded-xl flex items-center justify-between cursor-pointer hover:border-indigo-400/60 transition-colors"
        >
          <div>
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block">Retorno de Rota</span>
            <span className="text-sm font-black text-white mt-0.5 block">
              Descarregamento
            </span>
          </div>
          <Truck className="w-5 h-5 text-indigo-400" />
        </div>
      </div>

      {/* NAV TABS: Validade & FEFO | R&R | TMR | Retorno de Rota */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#151b23] border border-[#222d3a] p-2 rounded-xl w-full">
        <button
          onClick={() => setPanelTab('validade')}
          className={`px-3 py-2.5 rounded-lg font-sans font-bold text-xs uppercase tracking-wider transition-all border-none cursor-pointer flex items-center justify-center gap-1.5 ${
            panelTab === 'validade'
              ? 'bg-emerald-600 text-white font-black shadow-md'
              : 'text-[#6a7d92] hover:text-white bg-transparent'
          }`}
        >
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="truncate">1. Validades & FEFO</span>
        </button>

        <button
          onClick={() => setPanelTab('rr')}
          className={`px-3 py-2.5 rounded-lg font-sans font-bold text-xs uppercase tracking-wider transition-all border-none cursor-pointer flex items-center justify-center gap-1.5 ${
            panelTab === 'rr'
              ? 'bg-sky-600 text-white font-black shadow-md'
              : 'text-[#6a7d92] hover:text-white bg-transparent'
          }`}
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span className="truncate">2. R&R</span>
          <span className="bg-sky-950 text-sky-200 text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0">
            {openTasksList.length}
          </span>
        </button>

        <button
          onClick={() => setPanelTab('tmr')}
          className={`px-3 py-2.5 rounded-lg font-sans font-bold text-xs uppercase tracking-wider transition-all border-none cursor-pointer flex items-center justify-center gap-1.5 ${
            panelTab === 'tmr'
              ? 'bg-purple-600 text-white font-black shadow-md'
              : 'text-[#6a7d92] hover:text-white bg-transparent'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 shrink-0" />
          <span className="truncate">3. TMR</span>
          <span className="bg-purple-950 text-purple-200 text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold shrink-0">
            {tmrDemands.filter(t => t.status !== 'done').length}
          </span>
        </button>

        <button
          onClick={() => setPanelTab('retorno_rota')}
          className={`px-3 py-2.5 rounded-lg font-sans font-bold text-xs uppercase tracking-wider transition-all border-none cursor-pointer flex items-center justify-center gap-1.5 ${
            panelTab === 'retorno_rota'
              ? 'bg-indigo-600 text-white font-black shadow-md'
              : 'text-[#6a7d92] hover:text-white bg-transparent'
          }`}
        >
          <Truck className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="truncate">4. Retorno Rota</span>
        </button>
      </div>

      {/* ── ABA 1: R&R (RESSUPRIMENTO & REABASTECIMENTO) ── */}
      {panelTab === 'rr' && (
        <div className="flex flex-col gap-6">
          {/* Identificação de conferente */}
          <div className="g-card p-6 flex flex-col gap-5">
            <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-[#f5a623]">Identificação do Conferente</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold tracking-[1.5px] uppercase text-[#6a7d92]">Seu Nome de Conferente *</label>
                <select 
                  value={conferente}
                  onChange={e => { setConferente(e.target.value); persistState(); }}
                  className="g-input bg-[#151b23] border-[#1c2530]"
                >
                  <option value="">— Selecione seu nome —</option>
                  {conferentes.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              <div className="flex gap-2">
                <input 
                  type="text"
                  placeholder="Novo conferente nome..."
                  value={newConfName}
                  onChange={e => setNewConfName(e.target.value)}
                  className="g-input flex-1"
                />
                <button 
                  onClick={handleAddConferente}
                  className="bg-[#151b23] border border-[#222d3a] hover:border-[#6a7d92] text-[#f5a623] text-xs font-sans font-bold px-4 py-2.5 rounded-lg tracking-wider uppercase cursor-pointer"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>

          {/* Nova Tarefa R&R (Picking SKU) */}
          <div className="g-card p-6 flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#222d3a] pb-3">
              <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-[#f5a623]">Despachar Nova Tarefa R&R (Ressuprimento de Picking)</h4>
              <div className="flex items-center gap-1.5 text-[9px] text-[#22c55e] font-black uppercase tracking-wider bg-[#22c55e]/5 px-2.5 py-1 rounded-lg border border-[#22c55e]/15">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                Salvo automaticamente
              </div>
            </div>

            {draftRestored && (
              <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/25 px-4 py-3 rounded-xl text-xs text-amber-300">
                <div className="flex items-center gap-2 font-medium">
                  <span>⚡ Dados anteriores restaurados do rascunho salvo!</span>
                </div>
                <button 
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedProd(null);
                    setQuantidade('');
                    setOperator('');
                    setDraftRestored(false);
                    localStorage.removeItem(draftKey);
                  }}
                  className="text-[9px] uppercase font-black tracking-wider text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                >
                  Limpar formulário
                </button>
              </div>
            )}

            {/* Busca SKU */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold tracking-[1.5px] uppercase text-[#6a7d92]">Pesquisar SKU (Código ou Nome)</label>
              <input 
                type="text"
                placeholder="Digite código SKU ou palavras..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="g-input"
              />
            </div>

            {/* Produto List grid */}
            <div className="p-3 bg-[#07090d] border border-[#222d3a] rounded-xl flex flex-col gap-1 max-h-36 overflow-y-auto">
              {filteredProducts.map(p => {
                const isSel = selectedProd?.codigo === p.codigo;
                return (
                  <div 
                    key={p.codigo}
                    onClick={() => setSelectedProd(p)}
                    className={`p-2.5 rounded-lg border cursor-pointer text-xs flex justify-between tracking-wide transition-all ${isSel ? 'bg-[#f5a623]/10 border-[#f5a623]/40' : 'bg-[#151b23]/50 border-[#1c2530] hover:bg-[#1a2030]'}`}
                  >
                    <span className="font-bold text-[#f5a623]">{p.codigo}</span>
                    <span className="flex-1 ml-4 truncate text-left text-[#e8eef5]">{p.descricao}</span>
                  </div>
                );
              })}
            </div>

            {/* Quantity and Operator designation */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold tracking-[1.5px] uppercase text-[#6a7d92]">Quantidade de Paletes</label>
                <input 
                  type="number"
                  min={1}
                  placeholder="Digite a quantidade..."
                  value={quantidade}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '') {
                      setQuantidade('');
                    } else {
                      const num = parseInt(val, 10);
                      setQuantidade(isNaN(num) ? '' : Math.max(1, num));
                    }
                  }}
                  className="g-input text-center text-snow font-bold text-sm bg-[#151b23]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold tracking-[1.5px] uppercase text-[#6a7d92]">Operador Designado *</label>
                <select 
                  value={operator}
                  onChange={e => { setOperator(e.target.value); }}
                  className="g-input bg-[#151b23] border-[#1c2530]"
                >
                  <option value="">— Selecionar operador —</option>
                  {operators.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button 
                type="button"
                disabled={creating || !selectedProd}
                onClick={handleCreateTask}
                className="py-3 px-4 text-xs font-bold font-sans tracking-widest text-[#07090d] bg-gradient-to-r from-[#f5a623] to-[#d4780a] hover:shadow-[0_4px_16px_rgba(245,166,35,0.25)] rounded-xl disabled:opacity-40 cursor-pointer text-center uppercase"
              >
                {creating ? 'Despachando...' : '➕ ATRIBUIR TAREFA OPERACIONAL'}
              </button>
            </div>
          </div>

          {/* Relatório de Atividades Diárias (R&R) */}
          <div className="g-card p-6">
            <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-[#6a7d92] mb-4">Relatório de Atividades Diárias (R&R)</h4>
            
            <div className="flex gap-2 border-b border-[#222d3a] mb-4">
              <button 
                onClick={() => setActiveTab('open')}
                className={`py-2 px-4 text-xs uppercase font-sans font-bold cursor-pointer transition-all ${activeTab === 'open' ? 'text-[#f5a623] border-b-2 border-b-[#f5a623]' : 'text-[#6a7d92]'}`}
              >
                Tarefas Abertas ({openTasksList.length})
              </button>
              <button 
                onClick={() => setActiveTab('done')}
                className={`py-2 px-4 text-xs uppercase font-sans font-bold cursor-pointer transition-all ${activeTab === 'done' ? 'text-[#f5a623] border-b-2 border-b-[#f5a623]' : 'text-[#6a7d92]'}`}
              >
                Concluídas Hoje ({doneTasksList.length})
              </button>
            </div>

            {activeTab === 'open' ? (
              <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
                {openTasksList.length === 0 ? (
                  <p className="text-xs text-[#6a7d92] text-center p-6">Nenhuma tarefa operativa em andamento ou pendente.</p>
                ) : (
                  openTasksList.map((t, i) => (
                    <div key={t._docId || i} className={`p-4 bg-[#151b23]/50 border border-[#222d3a] rounded-xl border-l-[3px] ${t.status === 'in_progress' ? 'border-l-[#3b82f6]' : 'border-l-[#f5a623]'}`}>
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <span className="text-[10px] font-sans font-bold text-[#f5a623] font-mono leading-none">TAREFA #{t.id} · SKU {t.codigo}</span>
                          <h5 className="text-xs font-bold text-snow leading-tight mt-1">{t.descricao}</h5>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-2xl font-black text-snow leading-none block">{t.quantidade}</span>
                          <span className="text-[8px] font-sans tracking-wider text-[#6a7d92] uppercase font-bold">Paletes</span>
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center text-[10px] text-[#6a7d92] border-t border-[#222d3a]/50 pt-2 mt-3 flex-wrap gap-2">
                        <div>
                          <span>Atribuída para: <strong className="text-[#3b82f6] font-extrabold">{t.operador}</strong> </span>
                          {t.iniciadoEm && <span>· Iniciada às {new Date(t.iniciadoEm).toLocaleTimeString()}</span>}
                        </div>
                        <div className="flex gap-2">
                          <span className={`px-2 py-0.5 rounded font-black uppercase text-[8px] tracking-[0.5px] ${t.status === 'in_progress' ? 'bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20' : 'bg-[#f5a623]/10 text-[#f5a623] border border-[#f5a623]/20'}`}>
                            {t.status === 'in_progress' ? 'Em andamento' : 'Aguardando Operador'}
                          </span>
                          <button 
                            onClick={() => handleDeleteTask(t)}
                            className="text-[9px] font-black text-[#6a7d92] hover:text-[#ef4444] bg-transparent border-none cursor-pointer"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
                <HistoryRestrictionNotice user={user} />
                {doneTasksList.length === 0 ? (
                  <p className="text-xs text-[#6a7d92] text-center p-6">Nenhuma tarefa foi concluída de forma oficial hoje.</p>
                ) : (
                  doneTasksList.map((t, i) => (
                    <div key={t._docId || i} className="p-4 bg-[#151b23]/30 border border-[#222d3a] rounded-xl border-l-[3px] border-l-[#22c55e]">
                      <div className="flex justify-between items-start gap-4">
                        <div>
                          <span className="text-[10px] font-sans font-bold text-[#f5a623] font-mono leading-none">TAREFA #{t.id} · SKU {t.codigo}</span>
                          <h5 className="text-xs font-bold text-snow leading-tight mt-1">{t.descricao}</h5>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-2xl font-black text-[#22c55e] leading-none block">{t.quantidade}</span>
                          <span className="text-[8px] font-sans tracking-wider text-[#6a7d92] uppercase font-bold">Paletes</span>
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-[10px] text-[#6a7d92] border-t border-[#222d3a]/50 pt-2 mt-3 flex-wrap gap-2">
                        <div>
                          <span>Finalizado por: <strong className="text-snow">{t.operador}</strong> </span>
                          <span>· Tipo: <strong>{t.tipoOperacao || 'Abastecimento'}</strong></span>
                        </div>
                        <div>
                          Duração operacional: <strong className="text-[#22c55e] text-xs font-black">{t.duracaoMin} min </strong>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ABA 2: TMR (REVENDAS & TRANSBORDO) ── */}
      {panelTab === 'tmr' && (
        <div className="flex flex-col gap-6">
          {/* Identificação de conferente */}
          <div className="g-card p-6 flex flex-col gap-5">
            <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-amber-400">Identificação do Conferente</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold tracking-[1.5px] uppercase text-slate-400">Seu Nome de Conferente *</label>
                <select 
                  value={conferente}
                  onChange={e => { setConferente(e.target.value); persistState(); }}
                  className="g-input bg-[#151b23] border-[#222d3a] text-amber-300 font-bold"
                >
                  <option value="">— Selecione seu nome —</option>
                  {conferentes.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              <div className="flex gap-2">
                <input 
                  type="text"
                  placeholder="Novo conferente nome..."
                  value={newConfName}
                  onChange={e => setNewConfName(e.target.value)}
                  className="g-input flex-1"
                />
                <button 
                  onClick={handleAddConferente}
                  className="bg-[#151b23] border border-[#222d3a] hover:border-[#6a7d92] text-amber-400 text-xs font-sans font-bold px-4 py-2.5 rounded-lg tracking-wider uppercase cursor-pointer"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>

          {/* Despachar Nova Demanda TMR */}
          <div className="g-card p-6 flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#222d3a] pb-3">
              <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                Despachar Nova Demanda TMR (Revendas / Vasilhames / Transbordo)
              </h4>
              <div className="flex items-center gap-1.5 text-[9px] text-amber-400 font-black uppercase tracking-wider bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                </span>
                Meta TMR: Carreta ≤ 2h30 · Recarga ≤ 50min
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {/* Seleção de Tipo de Placa: Casa vs Terceiros */}
              <div className="p-3 bg-[#11161d] border border-[#222d3a] rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                  <Truck className="w-4 h-4 text-amber-400" />
                  Classificação da Carreta TMR:
                </span>
                <div className="flex items-center gap-2 bg-[#1b222c] p-1 rounded-lg border border-[#2c3848]">
                  <button
                    type="button"
                    onClick={() => setTmrTipoPlaca('casa')}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      tmrTipoPlaca === 'casa'
                        ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                        : 'text-slate-400 hover:text-white bg-transparent'
                    }`}
                  >
                    🚚 Carreta da Casa (Frota Própria)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTmrTipoPlaca('terceiros')}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      tmrTipoPlaca === 'terceiros'
                        ? 'bg-purple-600 text-white font-black shadow-sm'
                        : 'text-slate-400 hover:text-white bg-transparent'
                    }`}
                  >
                    🚛 Carreta de Terceiros (Avulsa)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {tmrTipoPlaca === 'casa' ? (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Placa da Carreta da Casa *</label>
                    <select
                      value={tmrPlacaCasa}
                      onChange={e => setTmrPlacaCasa(e.target.value)}
                      className="g-input font-mono font-bold text-amber-400 bg-[#151b23] border-[#222d3a]"
                    >
                      <option value="RLT5J54">RLT5J54 (Carreta Própria)</option>
                      <option value="RLT5J44">RLT 5J44 (Carreta Própria)</option>
                      <option value="RLU3F59">RLU3F59 (Carreta Própria)</option>
                    </select>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Placa Terceiros / Avulsa *</label>
                    <input 
                      type="text"
                      placeholder="Ex: ABC1D23 / Placa Terceiro"
                      value={tmrCarreta}
                      onChange={e => setTmrCarreta(e.target.value)}
                      className="g-input uppercase font-bold text-purple-300"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prazo de Carregamento *</label>
                  <input 
                    type="text"
                    placeholder="Ex: Até 14:30 / 15:00 / Imediato"
                    value={tmrRevenda}
                    onChange={e => setTmrRevenda(e.target.value)}
                    className="g-input"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tipo de Operação (Meta)</label>
                  <select
                    value={tmrTipoCarga}
                    onChange={e => setTmrTipoCarga(e.target.value as any)}
                    className="g-input bg-[#151b23] border-[#1c2530] text-amber-300 font-bold"
                  >
                    <option value="TMR Revenda">TMR Revenda (Carreta — Meta ≤ 2h30)</option>
                    <option value="Carreta Transbordo">Carreta Transbordo (Meta ≤ 2h30)</option>
                    <option value="Recarga">Recarga (Meta ≤ 50min)</option>
                    <option value="Terceiros">Terceiros (Meta ≤ 50min)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5 col-span-1 md:col-span-4 mt-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                      👥 Delegar Operadores de Empilhadeira (Selecione 1 ou mais)
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {selectedTmrOperators.length === 0 ? 'Delegado para TODOS OS EMPILHADORES' : `${selectedTmrOperators.length} operador(es) selecionado(s)`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[#151b23] border border-[#222d3a] rounded-xl">
                    <button
                      type="button"
                      onClick={() => setSelectedTmrOperators([])}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        selectedTmrOperators.length === 0
                          ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                          : 'bg-[#0d1218] text-slate-400 hover:text-white border border-[#1c2530]'
                      }`}
                    >
                      TODOS OS EMPILHADORES
                    </button>
                    {operators.map(op => {
                      const isSelected = selectedTmrOperators.includes(op);
                      return (
                        <button
                          key={op}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedTmrOperators(prev => prev.filter(x => x !== op));
                            } else {
                              setSelectedTmrOperators(prev => [...prev, op]);
                            }
                          }}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-purple-600 text-white font-black shadow-xs'
                              : 'bg-[#0d1218] text-slate-300 hover:text-white border border-[#1c2530]'
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}
                          {op}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#0d1218] border border-[#222d3a] rounded-xl flex flex-col gap-3">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                    📦 Atribuição de Ativos de Giro (Vasilhames & PBR)
                  </span>
                  <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                    tmrTipoPlaca === 'terceiros' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  }`}>
                    {tmrTipoPlaca === 'terceiros' ? 'Opcional para Terceiros' : 'Atribuição Padrão da Casa'}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400">Litrinho</label>
                    <input 
                      type="number"
                      min={0}
                      placeholder="0"
                      value={tmrLitrinho}
                      onChange={e => setTmrLitrinho(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="g-input text-center font-mono font-bold text-amber-300"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400">Litrão</label>
                    <input 
                      type="number"
                      min={0}
                      placeholder="0"
                      value={tmrLitrao}
                      onChange={e => setTmrLitrao(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="g-input text-center font-mono font-bold text-amber-300"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400">600 Verde</label>
                    <input 
                      type="number"
                      min={0}
                      placeholder="0"
                      value={tmr600Verde}
                      onChange={e => setTmr600Verde(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="g-input text-center font-mono font-bold text-emerald-400"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400">600 Âmbar</label>
                    <input 
                      type="number"
                      min={0}
                      placeholder="0"
                      value={tmr600Ambar}
                      onChange={e => setTmr600Ambar(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="g-input text-center font-mono font-bold text-amber-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400">Barril Chopp</label>
                    <input 
                      type="number"
                      min={0}
                      placeholder="0"
                      value={tmrBarrilChopp}
                      onChange={e => setTmrBarrilChopp(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="g-input text-center font-mono font-bold text-yellow-400"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400">PBR1</label>
                    <input 
                      type="number"
                      min={0}
                      placeholder="0"
                      value={tmrPbr1}
                      onChange={e => setTmrPbr1(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="g-input text-center font-mono font-bold text-blue-400"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold uppercase text-slate-400">PBR2</label>
                    <input 
                      type="number"
                      min={0}
                      placeholder="0"
                      value={tmrPbr2}
                      onChange={e => setTmrPbr2(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="g-input text-center font-mono font-bold text-indigo-400"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1 mt-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Instruções Adicionais de Carregamento/Descarregamento</label>
                  <input 
                    type="text"
                    placeholder="Ex: Descarregar carreta na baia 3 e carregar vasilhames com amarra de proteção..."
                    value={tmrInstrucoes}
                    onChange={e => setTmrInstrucoes(e.target.value)}
                    className="g-input text-xs"
                  />
                </div>
              </div>

              <button 
                type="button"
                onClick={handleCreateTmrDemand}
                className="py-3 px-4 text-xs font-bold font-sans tracking-widest text-slate-950 bg-gradient-to-r from-amber-400 to-amber-600 hover:shadow-lg rounded-xl cursor-pointer text-center uppercase"
              >
                🚀 DESPACHAR DEMANDA TMR / REVENDAS
              </button>
            </div>
          </div>

          {/* Acompanhamento Operacional & Guia de Histórico TMR */}
          <div className="g-card p-6 flex flex-col gap-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#222d3a] pb-4">
              <div>
                <h4 className="font-sans font-black text-sm uppercase tracking-wider text-amber-400 flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-amber-400" />
                  Acompanhamento Operacional & Guia de Histórico TMR
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Acompanhe o tempo de execução, delegue empilhadores adicionais e consulte o histórico auditável de carretas e recargas TMR.
                </p>
              </div>

            <div className="flex items-center gap-2 bg-[#151b23] p-1 rounded-xl border border-[#222d3a]">
              <button
                type="button"
                onClick={() => setTmrSubTab('ativas')}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                  tmrSubTab === 'ativas'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white bg-transparent'
                }`}
              >
                <span>⚡ Demandas Ativas</span>
                <span className="bg-purple-950 text-purple-200 text-[10px] px-2 py-0.5 rounded-full font-mono font-bold">
                  {tmrDemands.filter(t => t.status !== 'done').length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTmrSubTab('historico')}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                  tmrSubTab === 'historico'
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'text-slate-400 hover:text-white bg-transparent'
                }`}
              >
                <span>📜 Guia de Histórico ({tmrDemands.length})</span>
              </button>
            </div>
          </div>

          {tmrSubTab === 'ativas' ? (
            <div className="flex flex-col gap-4">
              {tmrDemands.filter(t => t.status !== 'done').length === 0 ? (
                <div className="p-8 text-center bg-[#151b23]/30 border border-[#222d3a] rounded-xl text-slate-400 text-xs">
                  Nenhuma demanda TMR ativa no momento. Utilize o formulário acima para despachar uma nova demanda.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {tmrDemands.filter(t => t.status !== 'done').map(t => (
                    <div key={t.id} className={`p-4 bg-[#151b23]/60 border rounded-xl flex flex-col gap-3 relative ${
                      t.status === 'in_progress' ? 'border-blue-500/40 border-l-4 border-l-blue-500' : 'border-amber-500/40 border-l-4 border-l-amber-500'
                    }`}>
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-lg text-amber-300">{t.carreta}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              t.isTerceiros || t.tipoPlaca === 'terceiros' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}>
                              {t.isTerceiros || t.tipoPlaca === 'terceiros' ? 'Terceiros' : 'Casa'}
                            </span>
                            <span className="text-xs font-bold text-slate-300">· {t.revendaNome}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            Operação: <strong className="text-slate-200">{t.tipoCarga || 'TMR Revenda'}</strong> · Conf: <strong className="text-slate-200">{t.conferente || 'ADM'}</strong>
                          </span>
                        </div>

                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                          t.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}>
                          {t.status === 'in_progress' ? '⚡ Em Execução' : '⏳ Aguardando Início'}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 p-2 bg-[#0d1218] rounded-lg text-center text-[10px]">
                        <div><span className="text-[8px] text-slate-500 block uppercase">Litrinho</span><span className="font-mono font-bold text-amber-300">{t.palletsLitrinho || 0}</span></div>
                        <div><span className="text-[8px] text-slate-500 block uppercase">Litrão</span><span className="font-mono font-bold text-amber-300">{t.palletsLitrao || 0}</span></div>
                        <div><span className="text-[8px] text-slate-500 block uppercase">600 Verde</span><span className="font-mono font-bold text-emerald-400">{t.pallets600Verde || 0}</span></div>
                        <div><span className="text-[8px] text-slate-500 block uppercase">600 Âmbar</span><span className="font-mono font-bold text-amber-500">{t.pallets600Ambar || 0}</span></div>
                        <div><span className="text-[8px] text-slate-500 block uppercase">Chopp</span><span className="font-mono font-bold text-yellow-400">{t.palletsBarrilChopp || 0}</span></div>
                        <div><span className="text-[8px] text-slate-500 block uppercase">PBR1</span><span className="font-mono font-bold text-blue-400">{t.palletsPbr1 || t.palletsPbr || 0}</span></div>
                        <div><span className="text-[8px] text-slate-500 block uppercase">PBR2</span><span className="font-mono font-bold text-indigo-400">{t.palletsPbr2 || 0}</span></div>
                      </div>

                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pt-2 border-t border-[#222d3a]/60 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-300 flex-wrap">
                          <Users className="w-3.5 h-3.5 text-purple-400" />
                          <span className="text-[10px] text-slate-400">Empilhadores:</span>
                          <span className="font-bold text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/40">
                            {t.operadoresAtribuidos && t.operadoresAtribuidos.length > 0 ? t.operadoresAtribuidos.join(', ') : (t.operadorDesignado || 'TODOS')}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                          <button
                            type="button"
                            onClick={() => handleOpenRedelegateModal(t)}
                            className="px-2.5 py-1 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border border-purple-700/50 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
                          >
                            <Users className="w-3 h-3" /> Re-delegar
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteTmrDemand(t.id)}
                            className="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 rounded-lg text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Excluir
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#151b23] p-3 rounded-xl border border-[#222d3a]">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Buscar por placa, revenda, operador ou conferente..."
                    value={tmrSearchFilter}
                    onChange={e => setTmrSearchFilter(e.target.value)}
                    className="g-input pl-9 text-xs w-full bg-[#0d1218]"
                  />
                </div>

                <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
                  {(['todas', 'pending', 'in_progress', 'done'] as const).map(st => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setTmrStatusFilter(st)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                        tmrStatusFilter === st
                          ? 'bg-amber-500 text-slate-950 font-black'
                          : 'bg-[#0d1218] text-slate-400 hover:text-white border border-[#1c2530]'
                      }`}
                    >
                      {st === 'todas' && 'Todas'}
                      {st === 'pending' && '⏳ Aguardando'}
                      {st === 'in_progress' && '⚡ Em Andamento'}
                      {st === 'done' && '✅ Concluídas'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto border border-[#222d3a] rounded-xl bg-[#0d1218]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#151b23] border-b border-[#222d3a] text-[10px] uppercase font-mono font-bold text-slate-400">
                      <th className="p-3">Carreta / Prazo</th>
                      <th className="p-3">Operação / Status</th>
                      <th className="p-3 text-center">Ativos (Paletes)</th>
                      <th className="p-3">Início / Término / Duração</th>
                      <th className="p-3">Operadores / Conferente</th>
                      <th className="p-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1c2530]">
                    {tmrDemands
                      .filter(t => {
                        if (tmrStatusFilter !== 'todas' && t.status !== tmrStatusFilter) return false;
                        if (!tmrSearchFilter.trim()) return true;
                        const q = tmrSearchFilter.toLowerCase();
                        return (
                          t.carreta.toLowerCase().includes(q) ||
                          t.revendaNome.toLowerCase().includes(q) ||
                          (t.operadorDesignado && t.operadorDesignado.toLowerCase().includes(q)) ||
                          (t.operadorExecutor && t.operadorExecutor.toLowerCase().includes(q)) ||
                          (t.conferente && t.conferente.toLowerCase().includes(q))
                        );
                      })
                      .map(t => {
                        const durMin = t.dataHoraInicio && t.dataHoraFim
                          ? Math.max(1, Math.round((new Date(t.dataHoraFim).getTime() - new Date(t.dataHoraInicio).getTime()) / 60000))
                          : t.tempoTotalMinutos || null;

                        const isCarreta = t.tipoCarga === 'TMR Revenda' || t.tipoCarga === 'Carreta Transbordo' || !t.tipoCarga;
                        const targetMin = isCarreta ? 150 : 50;
                        const noPrazo = durMin ? durMin <= targetMin : null;

                        return (
                          <tr key={t.id} className="hover:bg-[#151b23]/50 transition-colors">
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-black text-amber-300 text-sm">{t.carreta}</span>
                                <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase ${
                                  t.isTerceiros || t.tipoPlaca === 'terceiros' ? 'bg-purple-500/20 text-purple-300' : 'bg-amber-500/20 text-amber-300'
                                }`}>
                                  {t.isTerceiros || t.tipoPlaca === 'terceiros' ? 'T' : 'Casa'}
                                </span>
                              </div>
                              <span className="text-[10px] text-amber-300 font-bold block mt-0.5">Prazo: {t.revendaNome || 'N/I'}</span>
                            </td>

                            <td className="p-3">
                              <span className="text-[10px] font-bold text-slate-300 block">{t.tipoCarga || 'TMR Revenda'}</span>
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase mt-1 ${
                                t.status === 'done' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                t.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              }`}>
                                {t.status === 'done' ? '✅ Concluída' : t.status === 'in_progress' ? '⚡ Em Andamento' : '⏳ Pendente'}
                              </span>
                            </td>

                            <td className="p-3 text-center">
                              <div className="inline-grid grid-cols-4 gap-1 text-[9px] font-mono bg-[#07090d] p-1.5 rounded-lg border border-[#1c2530]">
                                <div><span className="text-[7px] text-slate-500 uppercase block">Lit</span><span className="text-amber-300 font-bold">{t.palletsLitrinho || 0}</span></div>
                                <div><span className="text-[7px] text-slate-500 uppercase block">Litr</span><span className="text-amber-300 font-bold">{t.palletsLitrao || 0}</span></div>
                                <div><span className="text-[7px] text-slate-500 uppercase block">600V</span><span className="text-emerald-400 font-bold">{t.pallets600Verde || 0}</span></div>
                                <div><span className="text-[7px] text-slate-500 uppercase block">600A</span><span className="text-amber-500 font-bold">{t.pallets600Ambar || 0}</span></div>
                                <div><span className="text-[7px] text-slate-500 uppercase block">Chp</span><span className="text-yellow-400 font-bold">{t.palletsBarrilChopp || 0}</span></div>
                                <div><span className="text-[7px] text-slate-500 uppercase block">PBR1</span><span className="text-blue-400 font-bold">{t.palletsPbr1 || t.palletsPbr || 0}</span></div>
                                <div><span className="text-[7px] text-slate-500 uppercase block">PBR2</span><span className="text-indigo-400 font-bold">{t.palletsPbr2 || 0}</span></div>
                                <div className="bg-amber-500/10 rounded"><span className="text-[7px] text-amber-400 uppercase block">Tot</span><span className="text-amber-300 font-bold">{t.totalPallets || 0}</span></div>
                              </div>
                            </td>

                            <td className="p-3 text-[10px] text-slate-300 font-mono">
                              <div><span className="text-slate-500">Lançado:</span> {new Date(t.dataHoraCriacao || t.criadoEm).toLocaleTimeString()}</div>
                              {t.dataHoraInicio && <div><span className="text-slate-500">Início:</span> {new Date(t.dataHoraInicio).toLocaleTimeString()}</div>}
                              {t.dataHoraFim && <div><span className="text-slate-500">Fim:</span> {new Date(t.dataHoraFim).toLocaleTimeString()}</div>}
                              {durMin && (
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span className="font-bold text-amber-300">{durMin} min</span>
                                  {noPrazo !== null && (
                                    <span className={`px-1.5 py-0.2 rounded text-[8px] font-black uppercase ${
                                      noPrazo ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                                    }`}>
                                      {noPrazo ? 'No Prazo' : 'Fora do Prazo'}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="p-3 text-[10px]">
                              <div className="text-purple-300 font-bold">
                                Delegado: {t.operadoresAtribuidos && t.operadoresAtribuidos.length > 0 ? t.operadoresAtribuidos.join(', ') : (t.operadorDesignado || 'TODOS')}
                              </div>
                              {t.operadorExecutor && (
                                <div className="text-emerald-300 font-bold mt-0.5">
                                  Executor: {t.operadorExecutor}
                                </div>
                              )}
                              <div className="text-slate-400 text-[9px] mt-0.5">
                                Conf: {t.conferente || 'ADM'}
                              </div>
                            </td>

                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleOpenRedelegateModal(t)}
                                className="px-2 py-1 bg-purple-900/30 hover:bg-purple-800/50 text-purple-300 border border-purple-700/40 rounded text-[9px] font-bold uppercase cursor-pointer"
                              >
                                Re-delegar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Modal: Re-delegar Operadores TMR */}
      {redelegateDemand && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#151b23] border border-[#222d3a] rounded-2xl p-6 max-w-lg w-full flex flex-col gap-5 shadow-2xl">
            <div className="flex justify-between items-center border-b border-[#222d3a] pb-3">
              <div>
                <h3 className="text-sm font-black text-amber-400 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  Re-delegar Operadores — {redelegateDemand.carreta}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Selecione um ou mais operadores para realizar a operação TMR na carreta.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRedelegateDemand(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg bg-[#0d1218] border border-[#1c2530]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Operadores de Empilhadeira Disponíveis:
              </label>

              <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto p-2 bg-[#0d1218] border border-[#1c2530] rounded-xl">
                <button
                  type="button"
                  onClick={() => setRedelegateOps([])}
                  className={`p-2.5 rounded-lg text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
                    redelegateOps.length === 0
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-[#151b23] text-slate-400 hover:text-white border border-[#1c2530]'
                  }`}
                >
                  <span>TODOS OS EMPILHADORES (Qualquer operador pode assumir)</span>
                  {redelegateOps.length === 0 && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                </button>

                {operators.map(op => {
                  const isChecked = redelegateOps.includes(op);
                  return (
                    <button
                      key={op}
                      type="button"
                      onClick={() => {
                        if (isChecked) {
                          setRedelegateOps(prev => prev.filter(x => x !== op));
                        } else {
                          setRedelegateOps(prev => [...prev, op]);
                        }
                      }}
                      className={`p-2.5 rounded-lg text-xs font-bold text-left transition-all cursor-pointer flex items-center justify-between ${
                        isChecked
                          ? 'bg-purple-600/30 text-purple-200 border border-purple-500/50'
                          : 'bg-[#151b23] text-slate-300 hover:text-white border border-[#1c2530]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 text-purple-400" />
                        {op}
                      </span>
                      {isChecked && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#222d3a]">
              <button
                type="button"
                onClick={() => setRedelegateDemand(null)}
                className="px-4 py-2 bg-[#0d1218] hover:bg-[#1c2530] text-slate-300 font-bold text-xs uppercase rounded-xl border border-[#222d3a] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveRedelegation}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase rounded-xl shadow cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                Salvar Re-delegação
              </button>
            </div>
          </div>
        </div>
      )}
      {panelTab === 'validade' && (
        <ValidadesPanel user={user} empresa={empresa} hideSugerirMelhoria={true} />
      )}

      {panelTab === 'temperatura' && (
        <div className="flex flex-col gap-6">
          {/* Header Card */}
          <div className="g-card p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-l-4 border-l-rose-500 bg-gradient-to-r from-rose-950/20 via-[#151b23] to-[#151b23]">
            <div>
              <div className="flex items-center gap-2">
                <Thermometer className="w-5 h-5 text-rose-400" />
                <h3 className="text-base font-bold text-white uppercase tracking-wider">
                  Controle & Monitoramento de Temperatura do Armazém
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Aferição obrigatória de temperatura nos horários programados da plataforma (<strong>09:00, 16:00 e 22:00</strong>). Os registros são associados ao usuário logado.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-rose-300 bg-rose-500/10 border border-rose-500/30 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                Faixa Segura: 18.0°C a 28.0°C
              </span>
            </div>
          </div>

          {/* Import / Export / Clear Bar */}
          <TemperaturaImportExportBar onDataChanged={reloadTempLogs} />

          {/* Schedule Alerts Header Cards */}
          {(() => {
            const todayISO = new Date().toISOString().split('T')[0];
            const todayLogs = tempLogs.filter(l => l.dataISO === todayISO);
            const log09 = todayLogs.find(l => l.hora === '09:00');
            const log16 = todayLogs.find(l => l.hora === '16:00');
            const log22 = todayLogs.find(l => l.hora === '22:00');

            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* 09:00 Alert Card */}
                <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                  log09 
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
                    : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider font-mono">
                      ⏰ Horário 09:00
                    </span>
                    {log09 ? (
                      <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/40">
                        ✅ OK ({log09.temperatura}°C)
                      </span>
                    ) : (
                      <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/40 animate-pulse">
                        ⚠️ Pendente
                      </span>
                    )}
                  </div>
                  {log09 ? (
                    <div className="text-[11px] text-slate-300 font-medium">
                      Registrado por <strong>{log09.registradoPor || log09.conferenteNome}</strong> ({log09.temperatura}°C)
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-amber-200">Aferição matutina pendente</span>
                      <button
                        type="button"
                        onClick={() => { setTempHora('09:00'); setTempDataISO(todayISO); }}
                        className="text-[10px] font-bold bg-amber-500 text-slate-950 px-2 py-1 rounded cursor-pointer uppercase tracking-wider"
                      >
                        Registrar 09:00
                      </button>
                    </div>
                  )}
                </div>

                {/* 16:00 Alert Card */}
                <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                  log16 
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
                    : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider font-mono">
                      ⏰ Horário 16:00
                    </span>
                    {log16 ? (
                      <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/40">
                        ✅ OK ({log16.temperatura}°C)
                      </span>
                    ) : (
                      <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/40 animate-pulse">
                        ⚠️ Pendente
                      </span>
                    )}
                  </div>
                  {log16 ? (
                    <div className="text-[11px] text-slate-300 font-medium">
                      Registrado por <strong>{log16.registradoPor || log16.conferenteNome}</strong> ({log16.temperatura}°C)
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-amber-200">Aferição vespertina pendente</span>
                      <button
                        type="button"
                        onClick={() => { setTempHora('16:00'); setTempDataISO(todayISO); }}
                        className="text-[10px] font-bold bg-amber-500 text-slate-950 px-2 py-1 rounded cursor-pointer uppercase tracking-wider"
                      >
                        Registrar 16:00
                      </button>
                    </div>
                  )}
                </div>

                {/* 22:00 Alert Card */}
                <div className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                  log22 
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
                    : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider font-mono">
                      ⏰ Horário 22:00
                    </span>
                    {log22 ? (
                      <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/40">
                        ✅ OK ({log22.temperatura}°C)
                      </span>
                    ) : (
                      <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-500/40 animate-pulse">
                        ⚠️ Pendente
                      </span>
                    )}
                  </div>
                  {log22 ? (
                    <div className="text-[11px] text-slate-300 font-medium">
                      Registrado por <strong>{log22.registradoPor || log22.conferenteNome}</strong> ({log22.temperatura}°C)
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-amber-200">Aferição noturna pendente</span>
                      <button
                        type="button"
                        onClick={() => { setTempHora('22:00'); setTempDataISO(todayISO); }}
                        className="text-[10px] font-bold bg-amber-500 text-slate-950 px-2 py-1 rounded cursor-pointer uppercase tracking-wider"
                      >
                        Registrar 22:00
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Form to Register Temperature */}
          <form onSubmit={handleSaveTempLog} className="g-card p-6 flex flex-col gap-4">
            <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <Plus className="w-4 h-4 text-rose-400" />
              Lançar / Atualizar Registro de Temperatura do Armazém
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Data da Medição *</label>
                <input 
                  type="date"
                  value={tempDataISO}
                  onChange={e => setTempDataISO(e.target.value)}
                  className="g-input font-mono text-xs"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Horário Programado *</label>
                <select 
                  value={tempHora}
                  onChange={e => setTempHora(e.target.value)}
                  className="g-input bg-[#151b23] font-mono text-xs font-bold text-rose-300"
                  required
                >
                  <option value="07:00">07:00 (Início de Turno)</option>
                  <option value="09:00">09:00 (Mandatório Padrão)</option>
                  <option value="11:00">11:00 (Horário Intermediário)</option>
                  <option value="14:00">14:00 (Pico de Calor)</option>
                  <option value="16:00">16:00 (Mandatório Padrão)</option>
                  <option value="19:00">19:00 (Troca de Turno)</option>
                  <option value="22:00">22:00 (Mandatório Padrão)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Temperatura (°C) *</label>
                <input 
                  type="number"
                  step="0.1"
                  placeholder="Ex: 23.5"
                  value={tempValor}
                  onChange={e => setTempValor(e.target.value)}
                  className="g-input font-mono font-bold text-rose-400 text-center text-sm"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Usuário Responsável (Conferente / ADM)</label>
                <input 
                  type="text"
                  disabled
                  value={`${user?.nome || conferente || 'Conferente Responsável'} (${user?.cargo || 'Conferente / ADM'})`}
                  className="g-input bg-[#11151c] text-slate-400 font-bold text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Observação / Justificativa em caso de desvio</label>
                <input 
                  type="text"
                  placeholder="Ex: Climatização operando normalmente / Portas mantidas fechadas"
                  value={tempObs}
                  onChange={e => setTempObs(e.target.value)}
                  className="g-input text-xs"
                />
              </div>
            </div>

            <button
              type="submit"
              className="py-3 px-4 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow cursor-pointer transition-all flex items-center justify-center gap-2 mt-2"
            >
              <Thermometer className="w-4 h-4" />
              💾 SALVAR AFERIÇÃO DE TEMPERATURA COM CARIMBO DE USUÁRIO
            </button>
          </form>

          {/* Table of Historic Logs */}
          <div className="g-card p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-[#222d3a] pb-3">
              <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400" />
                Histórico de Aferições Registradas ({tempLogs.length})
              </h4>
            </div>

            {tempLogs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">
                Nenhuma aferição de temperatura registrada até o momento. Use o formulário acima para realizar o primeiro lançamento.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#222d3a] text-[10px] font-black uppercase text-slate-400 tracking-wider">
                      <th className="p-3">Data / Hora</th>
                      <th className="p-3">Temperatura</th>
                      <th className="p-3">Registrado Por</th>
                      <th className="p-3">Observação</th>
                      <th className="p-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2733] text-xs">
                    {tempLogs.map(log => {
                      const isDanger = log.alertaCritico || log.temperatura > 28.0 || log.temperatura < 18.0;

                      return (
                        <tr key={log.id} className="hover:bg-[#151b23]/60 transition-colors">
                          <td className="p-3 font-mono font-bold text-white">
                            {log.dataFormatted} <span className="text-amber-400 ml-1">({log.hora})</span>
                          </td>
                          <td className="p-3">
                            <span className={`inline-flex items-center gap-1 font-mono font-black text-xs px-2.5 py-1 rounded-lg border ${
                              isDanger 
                                ? 'bg-rose-500/15 border-rose-500/30 text-rose-400' 
                                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                            }`}>
                              {log.temperatura}°C {isDanger ? '⚠️ DESVIO' : '✅ OK'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-200 font-bold">
                            {log.registradoPor || log.conferenteNome}
                          </td>
                          <td className="p-3 text-slate-400 text-[11px] truncate max-w-xs">
                            {log.observacao || '—'}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteTempLog(log.id)}
                              className="text-[10px] font-bold text-slate-500 hover:text-rose-400 p-1 rounded transition-colors cursor-pointer"
                              title="Excluir Registro"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ABA: WLP & APONTAMENTO DE TURNO (MONTAGEM / NOITE & DIA) ── */}
      {panelTab === 'wlp' && (
        <div className="flex flex-col gap-6">
          {/* Header Banner */}
          <div className="g-card p-6 border-l-4 border-amber-500 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-500/20 rounded-xl text-amber-400">
                <Clock className="w-7 h-7" />
              </div>
              <div>
                <h3 className="font-sans font-black text-lg text-white uppercase tracking-wide">
                  Apontamento WLP & Horário de Montagem por Turno
                </h3>
                <p className="text-xs text-slate-300">
                  Cadastre o horário de início e término da montagem (turno da noite), volume faturado em hectolitros (HL) e colaboradores adicionais para calcular o WLP e média de horas trabalhadas.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-[#151b23] p-2 rounded-lg border border-[#222d3a]">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Status do Apontamento:</span>
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/15 px-2.5 py-0.5 rounded border border-amber-500/30">
                ATIVO ({wlpTurno})
              </span>
            </div>
          </div>

          {/* Form Principal de Apontamento de Turno */}
          <form onSubmit={handleSaveWlpShift} className="g-card p-6 flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-[#222d3a] pb-3">
              <h4 className="font-sans font-bold text-xs uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-amber-400" />
                1. Configuração do Turno & Faturamento Diário
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Data do Apontamento *</label>
                <input 
                  type="date"
                  value={wlpDataISO}
                  onChange={e => setWlpDataISO(e.target.value)}
                  className="g-input text-xs font-bold font-mono"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Turno de Operação *</label>
                <select 
                  value={wlpTurno}
                  onChange={e => setWlpTurno(e.target.value as 'Noite' | 'Dia')}
                  className="g-input text-xs font-bold bg-[#11151c] text-white"
                >
                  <option value="Noite">🌙 Turno Noite (Armazém Noturno / Montagem)</option>
                  <option value="Dia">☀️ Turno Dia (Armazém Diurno / Presença)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-[10px] font-bold text-amber-400 uppercase flex items-center justify-between">
                  <span>Volume Faturado do Turno (HL) {wlpTurno === 'Noite' ? '*' : '(Opcional/Noturno)'}</span>
                  {wlpTurno === 'Dia' && <span className="text-[9px] text-slate-400 font-normal">Preenchido pelo Conferente Noturno</span>}
                </label>
                <div className="relative">
                  <input 
                    type="number"
                    step="0.01"
                    placeholder={wlpTurno === 'Noite' ? "Ex: 680.5" : "Opcional no Turno Diurno"}
                    value={wlpVolumeHL}
                    onChange={e => setWlpVolumeHL(e.target.value === '' ? '' : Number(e.target.value))}
                    disabled={wlpTurno === 'Dia'}
                    className={`g-input text-sm font-bold font-mono text-amber-300 pr-12 ${wlpTurno === 'Dia' ? 'opacity-50 cursor-not-allowed bg-slate-900' : ''}`}
                    required={wlpTurno === 'Noite'}
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-mono font-bold text-slate-500">HL</span>
                </div>
              </div>
            </div>

            {/* SE O TURNO FOR NOITE (MONTAGEM / ARMAZÉM NOTURNO) */}
            {wlpTurno === 'Noite' ? (
              <div className="p-5 bg-indigo-950/20 border border-indigo-500/30 rounded-xl flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-indigo-400" />
                    <div>
                      <h5 className="font-sans font-bold text-xs uppercase tracking-wider text-indigo-300">
                        Equipe do Armazém Noturno & Apontamento de Presença
                      </h5>
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        Clique sobre o colaborador para indicar quem veio <strong>(Presente)</strong> ou não veio <strong>(Falta)</strong> no turno.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSelectAllNight}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {selectedNightColabs.length === EQUIPE_NOTURNA_PADRAO.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                  </button>
                </div>

                {/* Team Grid Clicável */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {EQUIPE_NOTURNA_PADRAO.map(colab => {
                    const isPresent = selectedNightColabs.includes(colab.nome);
                    return (
                      <button
                        type="button"
                        key={colab.nome}
                        onClick={() => handleToggleNightColab(colab.nome)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                          isPresent
                            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200 shadow-md ring-1 ring-emerald-500/30'
                            : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                            isPresent ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                          }`}>
                            {colab.cargo}
                          </span>
                          {isPresent ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <X className="w-4 h-4 text-slate-600" />
                          )}
                        </div>
                        <div>
                          <div className={`text-xs font-bold leading-tight ${isPresent ? 'text-white' : 'text-slate-500'}`}>
                            {colab.apelido}
                          </div>
                          <div className="text-[9px] text-slate-400 truncate max-w-full" title={colab.nome}>
                            {colab.nome.split(' ')[0]} {colab.nome.split(' ').slice(-1)[0]}
                          </div>
                        </div>
                        <div className={`text-[10px] font-black uppercase tracking-wider text-right ${
                          isPresent ? 'text-emerald-400' : 'text-rose-400/80'
                        }`}>
                          {isPresent ? '✓ Presente' : '✕ Ausente'}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-300 uppercase flex items-center gap-1">
                      <span>Início da Montagem (HH:MM) *</span>
                      {isShiftTimeLocked && <span className="text-[9px] font-mono text-amber-400 bg-amber-500/20 px-1 rounded">🔒 Iniciado</span>}
                    </label>
                    <input 
                      type="time"
                      value={wlpHoraInicioMontagem}
                      onChange={e => setWlpHoraInicioMontagem(e.target.value)}
                      disabled={isShiftTimeLocked}
                      className={`g-input text-xs font-mono font-bold text-indigo-200 ${isShiftTimeLocked ? 'opacity-60 bg-slate-900 cursor-not-allowed' : ''}`}
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-300 uppercase">Término da Montagem (HH:MM) *</label>
                    <input 
                      type="time"
                      value={wlpHoraFimMontagem}
                      onChange={e => setWlpHoraFimMontagem(e.target.value)}
                      className="g-input text-xs font-mono font-bold text-indigo-200"
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-300 uppercase">Total Presentes (Auto-calculado)</label>
                    <div className="g-input text-xs font-mono font-black text-emerald-400 flex items-center justify-between bg-slate-900">
                      <span>{selectedNightColabs.length} Colaboradores</span>
                      <span className="text-[9px] text-slate-400 font-normal">({EQUIPE_NOTURNA_PADRAO.length} Total)</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-[#11151c] p-3 rounded-lg border border-[#222d3a] text-xs">
                  <span className="text-slate-400">Duração Calculada por Colaborador:</span>
                  <span className="font-mono font-bold text-indigo-400">
                    {calcShiftHours(wlpHoraInicioMontagem, wlpHoraFimMontagem)}h
                  </span>
                  <span className="text-slate-400 ml-4">Subtotal HH Noturno ({selectedNightColabs.length} colabs):</span>
                  <span className="font-mono font-bold text-indigo-300">
                    {(calcShiftHours(wlpHoraInicioMontagem, wlpHoraFimMontagem) * selectedNightColabs.length).toFixed(1)} HH
                  </span>
                </div>

                {/* BOTÃO DE TRANSITION DE MONTAGEM PARA O DIURNO */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-3.5 bg-amber-950/25 border border-amber-500/40 rounded-xl mt-1">
                  <div>
                    <span className="text-xs font-black text-amber-400 uppercase flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-amber-400" /> Transição de Montagem para o Turno Diurno
                    </span>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Caso a equipe da noite não conclua a montagem, clique para encerrar a jornada dos colaboradores noturnos na hora atual e repassar a finalização da montagem para a equipe da manhã.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTransferMontagemToDay}
                    className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shrink-0 flex items-center gap-2 cursor-pointer"
                  >
                    <ArrowRight className="w-4 h-4 text-slate-950" />
                    <span>Transferir Montagem para o Diurno</span>
                  </button>
                </div>
              </div>
            ) : (
              /* TURNO DIURNO - LISTA DE PRESENÇA */
              <div className="p-5 bg-sky-950/20 border border-sky-500/30 rounded-xl flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-sky-400" />
                    <div>
                      <h5 className="font-sans font-bold text-xs uppercase tracking-wider text-sky-300">
                        Equipe do Armazém Diurno & Lista de Presença
                      </h5>
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        Selecione os colaboradores que compareceram no turno diurno para cálculo de homem-hora (HH) no WLP.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSelectAllDay}
                    className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {selectedDayColabs.length === EQUIPE_DIURNA_PADRAO.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
                  </button>
                </div>

                {/* Team Grid Clicável Diurno */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  {EQUIPE_DIURNA_PADRAO.map(colab => {
                    const isPresent = selectedDayColabs.includes(colab.nome);
                    return (
                      <button
                        type="button"
                        key={colab.nome}
                        onClick={() => handleToggleDayColab(colab.nome)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                          isPresent
                            ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200 shadow-md ring-1 ring-emerald-500/30'
                            : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                            isPresent ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                          }`}>
                            {colab.cargo}
                          </span>
                          {isPresent ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <X className="w-4 h-4 text-slate-600" />
                          )}
                        </div>
                        <div>
                          <div className={`text-xs font-bold leading-tight ${isPresent ? 'text-white' : 'text-slate-500'}`}>
                            {colab.apelido}
                          </div>
                          <div className="text-[9px] text-slate-400 truncate max-w-full" title={colab.nome}>
                            {colab.nome.split(' ')[0]} {colab.nome.split(' ').slice(-1)[0]}
                          </div>
                        </div>
                        <div className={`text-[10px] font-black uppercase tracking-wider text-right ${
                          isPresent ? 'text-emerald-400' : 'text-rose-400/80'
                        }`}>
                          {isPresent ? '✓ Presente' : '✕ Ausente'}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-300 uppercase flex items-center gap-1">
                      <span>Início da Jornada Diurna (HH:MM) *</span>
                      {isShiftTimeLocked && <span className="text-[9px] font-mono text-amber-400 bg-amber-500/20 px-1 rounded">🔒 Iniciado</span>}
                    </label>
                    <input 
                      type="time"
                      value={wlpHoraInicioMontagem}
                      onChange={e => setWlpHoraInicioMontagem(e.target.value)}
                      disabled={isShiftTimeLocked}
                      className={`g-input text-xs font-mono font-bold text-sky-200 ${isShiftTimeLocked ? 'opacity-60 bg-slate-900 cursor-not-allowed' : ''}`}
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-300 uppercase">Término da Jornada Diurna (HH:MM) *</label>
                    <input 
                      type="time"
                      value={wlpHoraFimMontagem}
                      onChange={e => setWlpHoraFimMontagem(e.target.value)}
                      className="g-input text-xs font-mono font-bold text-sky-200"
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-300 uppercase">Total Presentes (Diurno)</label>
                    <div className="g-input text-xs font-mono font-black text-sky-400 flex items-center justify-between bg-slate-900">
                      <span>{selectedDayColabs.length} Colaboradores</span>
                      <span className="text-[9px] text-slate-400 font-normal">({EQUIPE_DIURNA_PADRAO.length} Total)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SEÇÃO: ADICIONAR COLABORADOR EXTRA NO CÁLCULO DA JORNADA */}
            <div className="border border-[#222d3a] rounded-xl p-5 bg-[#151b23]/80 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-[#222d3a] pb-2">
                <h5 className="font-sans font-bold text-xs uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-400" />
                  2. Adicionar Colaborador Extra no Cálculo do WLP
                </h5>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Campo Expansível de Jornada
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Nome do Colaborador Extra *</label>
                  <input 
                    type="text"
                    placeholder="Ex: CARLOS ALBERTO MEDEIROS"
                    value={extraNome}
                    onChange={e => setExtraNome(e.target.value)}
                    className="g-input text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Cargo / Função</label>
                  <select 
                    value={extraCargo}
                    onChange={e => setExtraCargo(e.target.value as any)}
                    className="g-input text-xs bg-[#11151c]"
                  >
                    <option value="Ajudante">Ajudante</option>
                    <option value="Empilhador">Empilhador</option>
                    <option value="Conferente">Conferente</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-1 w-1/2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Início</label>
                    <input 
                      type="time"
                      value={extraHoraInicio}
                      onChange={e => setExtraHoraInicio(e.target.value)}
                      className="g-input text-xs font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1 w-1/2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Fim</label>
                    <input 
                      type="time"
                      value={extraHoraFim}
                      onChange={e => setExtraHoraFim(e.target.value)}
                      className="g-input text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddExtraColab}
                  className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Incluir Colaborador no Cálculo ({calcShiftHours(extraHoraInicio, extraHoraFim)}h)
                </button>
              </div>

              {/* LISTA DE COLABORADORES EXTRAS ADICIONADOS */}
              {wlpExtraColabs.length > 0 && (
                <div className="mt-2 overflow-x-auto border border-[#222d3a] rounded-lg bg-[#11151c]">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#222d3a] text-[10px] font-black uppercase text-slate-400">
                        <th className="p-2.5">Colaborador Extra</th>
                        <th className="p-2.5">Cargo</th>
                        <th className="p-2.5">Horário Início / Fim</th>
                        <th className="p-2.5">Duração (HH)</th>
                        <th className="p-2.5 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2733]">
                      {wlpExtraColabs.map(ext => (
                        <tr key={ext.id}>
                          <td className="p-2.5 font-bold text-white">{ext.nome}</td>
                          <td className="p-2.5 text-slate-300">{ext.cargo}</td>
                          <td className="p-2.5 font-mono text-amber-300">{ext.horaInicio} às {ext.horaFim}</td>
                          <td className="p-2.5 font-mono font-bold text-emerald-400">{ext.duracaoHoras}h</td>
                          <td className="p-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveExtraColab(ext.id)}
                              className="text-slate-500 hover:text-rose-400 p-1 transition-colors cursor-pointer"
                              title="Remover"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* PREVISÃO DE MÉDIA DE HORAS E WLP RESULTANTE */}
            {(() => {
              const baseColabsCount = wlpTurno === 'Noite' ? selectedNightColabs.length : selectedDayColabs.length;
              const baseHH = calcShiftHours(wlpHoraInicioMontagem, wlpHoraFimMontagem) * baseColabsCount;
              const extraHH = wlpExtraColabs.reduce((acc, c) => acc + c.duracaoHoras, 0);
              const totalHH = baseHH + extraHH;
              const totalColabs = baseColabsCount + wlpExtraColabs.length;
              const avgHours = totalColabs > 0 ? totalHH / totalColabs : 0;
              const volHL = Number(wlpVolumeHL) || 0;
              const wlpRatio = totalHH > 0 ? volHL / totalHH : 0;

              return (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 bg-slate-900/80 border border-[#222d3a] rounded-xl text-center">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Volume Informado</span>
                    <span className="font-mono font-black text-base text-amber-400">{volHL.toFixed(1)} HL</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Total Homem-Hora (HH)</span>
                    <span className="font-mono font-black text-base text-sky-400">{totalHH.toFixed(1)} HH</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Média de Horas / Colab</span>
                    <span className="font-mono font-black text-base text-indigo-400">{avgHours.toFixed(2)}h</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Indicador WLP (HL/HH)</span>
                    <span className="font-mono font-black text-base text-emerald-400">{wlpRatio.toFixed(2)} HL/HH</span>
                  </div>
                </div>
              );
            })()}

            <button
              type="submit"
              className="py-3 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5 text-slate-950" />
              💾 SALVAR APONTAMENTO DO TURNO & ATUALIZAR INDICADOR WLP OFICIAL
            </button>
          </form>
        </div>
      )}

      {/* ── ABA 7: REALIZAÇÃO DO 5S ── */}
      {panelTab === '5s' && (
        <div className="flex flex-col gap-6">
          <Collaborator5SPerformanceCard user={user} userNombre={user.nome} />

          <div className="bg-[#11151c] border border-[#222d3a] rounded-2xl p-4 sm:p-6 shadow-xl flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-[#222d3a] pb-4">
              <div>
                <h3 className="text-lg font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <CheckCircle2 className="w-6 h-6 text-amber-400" />
                  Realização do Checklist 5S — Operação Conferente
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Execute a auditoria de 5S no setor de conferência, recebimento e expedição para garantir a segurança e organização.
                </p>
              </div>
            </div>

            <Checklist5SForm 
              defaultSetor="ARMAZEM" 
              userNombre={user.nome} 
              user={user} 
              empresaId={empresaId} 
              liderAuditor="Conferente Líder"
              onSaveSuccess={() => {
                alert('✓ Audit 5S do Conferente registrado com sucesso!');
              }} 
            />
          </div>
        </div>
      )}

      {/* ── ABA 8: RETORNO DE ROTA ── */}
      {panelTab === 'retorno_rota' && (
        <div className="bg-[#11151c] border border-[#222d3a] rounded-2xl p-6 shadow-xl flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#222d3a] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Truck className="w-6 h-6 text-emerald-400" />
                <h3 className="text-lg font-black uppercase tracking-wider text-white">
                  Retorno de Rota — Operação Conferente / ADM
                </h3>
                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full">
                  Link Oficial Anexado
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                O Conferente/ADM inicia a jornada, clica no link e é redirecionado diretamente para a plataforma de Retorno de Rota.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-bold px-3 py-1.5 rounded-lg border ${
                shiftStarted 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
                {shiftStarted ? `✓ Jornada Iniciada às ${shiftStartTime}` : '⚠️ Jornada Não Iniciada'}
              </span>
            </div>
          </div>

          {/* LINK ACCESSIBLE CARD */}
          <div className="bg-[#151b23] border border-emerald-500/30 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
              <Truck className="w-64 h-64 text-emerald-400" />
            </div>

            <div className="flex items-start gap-4 z-10">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 shrink-0">
                <ExternalLink className="w-8 h-8" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-widest">
                  SISTEMA OFICIAL DE RETORNO DE ROTA
                </span>
                <h4 className="text-xl font-black text-white">
                  PLATAFORMA RETORNO DE ROTA DOS VEÍCULOS
                </h4>
                <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
                  Acesse o sistema externo definitivo para registro de chegada, conferência de vasilhames e checklists de prestação de contas de rotas.
                </p>
                <div className="mt-3 inline-flex items-center gap-2 text-[11px] font-mono text-slate-300 bg-[#0d1117] px-3.5 py-2 rounded-xl border border-[#222d3a] w-fit">
                  <span className="text-emerald-400 font-bold">URL:</span>
                  <span className="text-emerald-300 underline">https://nixonhenriquegit.github.io/RETORNO-DE-ROTA/</span>
                </div>
              </div>
            </div>

            <a
              href="https://nixonhenriquegit.github.io/RETORNO-DE-ROTA/"
              target="_blank"
              rel="noopener noreferrer"
              className="z-10 py-4 px-6 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-sm uppercase tracking-wider rounded-xl cursor-pointer transition-all shadow-xl shadow-emerald-950/50 flex items-center gap-3 shrink-0 border border-emerald-300 hover:scale-105"
            >
              <span>ACESSAR PLATAFORMA DE RETORNO DE ROTA</span>
              <ExternalLink className="w-5 h-5" />
            </a>
          </div>

          {!shiftStarted && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-xs text-amber-300">
              <span>
                💡 <strong>Dica Operacional:</strong> Lembre-se de clicar em <strong>INICIAR JORNADA</strong> no topo da página ao começar seu turno para sincronizar seus apontamentos.
              </span>
              <button
                onClick={handleStartShift}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg cursor-pointer shrink-0 ml-2"
              >
                Iniciar Jornada
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ABA 9: GUIA DE AÇÕES DO CONFERENTE ── */}
      {panelTab === 'acoes' && (
        <GuiaAcoesOperacionais user={user} roleName="Conferente" />
      )}
    </div>
  );
}
export {};

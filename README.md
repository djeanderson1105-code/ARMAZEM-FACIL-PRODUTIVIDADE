# Armazém Fácil Pro — Gestão Logística e DPO Ambev

Sistema integrado de gestão logística e armazém de alta performance para distribuidores Ambev (CCO Guarabira - PB), com suporte a controle de FEFO, Repack, Validades, Quebras, Despejo, Blitz de Refugo, Matriz 5S, WLP e automação em tempo real.

---

## 🚀 Principais Módulos Operacionais

- **Workstation CCO e Farol de Desvios**: Acompanhamento de indicadores de armazém em caixas (`cx`), hectolitros (`hl`) e faturamento (`R$`), com radar de itens críticos com validade $\le 45$ dias.
- **Controle Rigoroso de FEFO (Estoque x Picking & Estoque x Estoque)**: Detecção automática de quebras de lote e geração imediata de ordens de remanejamento.
- **Gestão de Repack, Quebras e Despejo**: Fluxo de conferência de garrafas, latas, barris KEG 50L e registro fotográfico de avarias.
- **Matriz 5S e Auditoria DPO**: Checklists operacionais para as 14 áreas da unidade (Picking, Carregamento, Central, Despejo, etc.), cálculo automático de aderência e plano de ação 5W2H.
- **Diário de Bordo & Reuniões de Turno**: Registro de ocorrências, passagem de turno e alinhamentos operacionais com assinaturas digitais.
- **Ranking & Produtividade Individual**: Quadro de colaboradores por função e produtividade em tempo real.

---

## 🛠️ Arquitetura e Tecnologias

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Framer Motion + Lucide Icons.
- **Backend**: Express + Node.js (com fallback SPA e middlewares de API REST para rotas operacionais).
- **Banco de Dados & Autenticação**: Firebase Firestore (segurança com regras baseadas em RBAC e auditoria de perfis) + Firebase Authentication.
- **Inteligência Artificial**: Google Gemini API (`@google/genai`) para análise de dados operacionais e suporte inteligente a auditorias DPO.

---

## ⚙️ Configuração e Execução Local

### Pré-requisitos
- Node.js 20+
- npm ou bun

### Passos:
1. **Instalar as dependências**:
   ```bash
   npm install
   ```

2. **Configurar as variáveis de ambiente**:
   Crie um arquivo `.env` baseado no `.env.example`:
   ```env
   GEMINI_API_KEY=sua_chave_gemini
   VITE_FIREBASE_API_KEY=AIzaSyB1ZyrUc3yDbiM1MuFqeyOCUoK5cT8xGP8
   VITE_FIREBASE_PROJECT_ID=bionic-petal-fwx5p
   ```

3. **Iniciar o servidor de desenvolvimento**:
   ```bash
   npm run dev
   ```
   Acesse a aplicação em `http://localhost:3000`.

4. **Gerar build de produção**:
   ```bash
   npm run build
   ```

---

## 🔒 Segurança e Regras do Firestore

As regras do Firestore estão consolidadas no arquivo `firestore.rules` e seguem a arquitetura dos 8 Pilares de Segurança:
- Negação padrão de acesso desautorizado.
- Controle de acesso baseado em funções (RBAC: Administrativo, Conferente, Operador Empilhadeira, Ajudante).
- Validação estrita de tipos e esquemas de dados.
- Bloqueio de injeções e campos arbitrários em coleções críticas.

---

## 📦 Deploy para o GitHub e CI/CD

O repositório já inclui workflow automatizado de CI/CD para o GitHub Pages em `.github/workflows/deploy.yml`. Ao enviar commits para as branches `main` ou `master`, o build de produção é gerado e disponibilizado automaticamente.

Desenvolvido para **Ambev CCO Guarabira — Pau Brasil Distribuidora**.

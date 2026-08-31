/**
 * Savant Arena Application
 * 1. Solo Duel (Single Fighter testing with live TPS & thinking process)
 * 2. Grand Tournament (Multi-step flow: Select Gladiators -> Select Trials -> Live Real-Time Battle Arena -> Leaderboard & Graphs)
 */

(function () {
  'use strict'

  // Application State
  const state = {
    currentView: 'chat', // 'chat' | 'arena'
    tournamentStep: 1,   // 1: Gladiators, 2: Trials, 3: Battle, 4: Results
    providers: [],
    providerDetails: [],
    selectedProvider: '',
    selectedModel: '',
    executionMode: 'single',
    currentSessionId: null,
    currentSession: null,
    activeRunId: null,
    activeEventSource: null,
    isGenerating: false,
    attachedFiles: [],
    systemPrompt: '',
    cwd: '',
    theme: localStorage.getItem('savant_theme') || 'dark',

    // Tournament State
    benchmarkSuites: [],
    selectedGladiators: [],
    selectedQuestions: [],
    currentTournamentId: null,
    currentTournament: null,
    tournamentPollTimer: null,
    isTournamentRunning: false,
    activeBattleEventSource: null,
    currentActiveBattleRunId: null,
    activeJudgeEventSource: null,
  }

  // DOM Elements
  const el = {
    // Navigation
    tabChat: document.getElementById('tab-chat'),
    tabArena: document.getElementById('tab-arena'),
    viewChat: document.getElementById('view-chat'),
    viewArena: document.getElementById('view-arena'),
    chatSidebarSection: document.getElementById('chat-sidebar-section'),
    arenaSidebarSection: document.getElementById('arena-sidebar-section'),
    btnNewChat: document.getElementById('btn-new-chat'),
    btnNewTournament: document.getElementById('btn-new-tournament'),
    sessionsList: document.getElementById('sessions-list'),
    tournamentsList: document.getElementById('tournaments-list'),

    // Chat Controls
    providerSelect: document.getElementById('provider-select'),
    modelSelect: document.getElementById('model-select'),
    modeSelect: document.getElementById('mode-select'),
    refreshModelsBtn: document.getElementById('btn-refresh-models'),
    messagesContainer: document.getElementById('messages-container'),
    messagesWrapper: document.getElementById('messages-wrapper'),
    welcomeScreen: document.getElementById('welcome-screen'),
    chatTextarea: document.getElementById('chat-textarea'),
    sendBtn: document.getElementById('btn-send'),
    fileInput: document.getElementById('file-input'),
    btnUpload: document.getElementById('btn-upload'),
    filesTray: document.getElementById('files-tray'),
    inputBox: document.getElementById('input-box'),
    statusBadge: document.getElementById('status-badge'),
    btnSidebarToggle: document.getElementById('btn-sidebar-toggle'),
    sidebar: document.getElementById('sidebar'),
    themeToggleBtn: document.getElementById('btn-theme-toggle'),

    // Settings Modal
    settingsBtn: document.getElementById('btn-settings'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('btn-close-settings'),
    saveSettingsBtn: document.getElementById('btn-save-settings'),
    inputSystemPrompt: document.getElementById('input-system-prompt'),
    inputCwd: document.getElementById('input-cwd'),

    // Stepper Navigation
    stepNav1: document.getElementById('step-nav-1'),
    stepNav2: document.getElementById('step-nav-2'),
    stepNav3: document.getElementById('step-nav-3'),
    stepNav4: document.getElementById('step-nav-4'),

    // Tournament Stepper Screens
    screenGladiators: document.getElementById('screen-gladiators'),
    screenTrials: document.getElementById('screen-trials'),
    screenBattle: document.getElementById('screen-battle'),
    screenResults: document.getElementById('screen-results'),

    // Step 1: Gladiators
    gladiatorsSelectionGrid: document.getElementById('gladiators-selection-grid'),
    gladiatorsSummaryCount: document.getElementById('gladiators-summary-count'),
    btnGotoTrials: document.getElementById('btn-goto-trials'),
    btnPresetAllOllama: document.getElementById('btn-preset-all-ollama'),
    btnPresetLocalCloud: document.getElementById('btn-preset-local-cloud'),
    btnPresetFastest: document.getElementById('btn-preset-fastest'),

    // Step 2: Trials & Custom Coding Challenge
    suiteTabs: document.getElementById('suite-tabs'),
    questionsSelectionList: document.getElementById('questions-selection-list'),
    trialsSummaryCount: document.getElementById('trials-summary-count'),
    btnBacktoGladiators: document.getElementById('btn-backto-gladiators'),
    btnLaunchColosseum: document.getElementById('btn-launch-colosseum'),
    btnOpenCustomTrial: document.getElementById('btn-open-custom-trial'),
    customTrialModal: document.getElementById('custom-trial-modal'),
    btnCloseCustomTrial: document.getElementById('btn-close-custom-trial'),
    btnCancelCustomTrial: document.getElementById('btn-cancel-custom-trial'),
    btnSaveCustomTrial: document.getElementById('btn-save-custom-trial'),
    customTrialTitle: document.getElementById('custom-trial-title'),
    customTrialCategory: document.getElementById('custom-trial-category'),
    customTrialLanguage: document.getElementById('custom-trial-language'),
    customTrialFnName: document.getElementById('custom-trial-fn-name'),
    customTrialSignature: document.getElementById('custom-trial-signature'),
    customTrialPrompt: document.getElementById('custom-trial-prompt'),
    btnAddTestCaseRow: document.getElementById('btn-add-test-case-row'),
    testCasesBuilderList: document.getElementById('test-cases-builder-list'),

    // Step 3: Live Battle Arena Screen & Real-time Chat Stream & Validation
    liveTrialCategory: document.getElementById('live-trial-category'),
    liveTrialTitle: document.getElementById('live-trial-title'),
    liveGladiatorName: document.getElementById('live-gladiator-name'),
    liveGladiatorModel: document.getElementById('live-gladiator-model'),
    liveGladiatorTier: document.getElementById('live-gladiator-tier'),
    battleStepText: document.getElementById('battle-step-text'),
    battleProgressBarFill: document.getElementById('battle-progress-bar-fill'),

    liveChatPrompt: document.getElementById('live-chat-prompt'),
    liveChatCategory: document.getElementById('live-chat-category'),
    liveChatGladiatorTag: document.getElementById('live-chat-gladiator-tag'),
    liveChatStatsPill: document.getElementById('live-chat-stats-pill'),
    liveChatStatsText: document.getElementById('live-chat-stats-text'),
    liveChatThinkingContainer: document.getElementById('live-chat-thinking-container'),
    liveChatThinkingHeader: document.getElementById('live-chat-thinking-header'),
    liveChatThinkingStatus: document.getElementById('live-chat-thinking-status'),
    liveChatThinkingBody: document.getElementById('live-chat-thinking-body'),
    liveChatResponseContent: document.getElementById('live-chat-response-content'),
    liveChatValidationBox: document.getElementById('live-chat-validation-box'),
    liveChatValBadge: document.getElementById('live-chat-val-badge'),
    liveChatValStats: document.getElementById('live-chat-val-stats'),
    liveChatValTestsList: document.getElementById('live-chat-val-tests-list'),

    battleTimelineCard: document.getElementById('battle-timeline-card'),
    battleTimelineList: document.getElementById('battle-timeline-list'),

    // Step 4: Results & Leaderboard & Peer Reviews
    championBanner: document.getElementById('champion-banner'),
    championName: document.getElementById('champion-name'),
    championStats: document.getElementById('champion-stats'),
    chartSpeedContainer: document.getElementById('chart-speed-container'),
    chartLatencyContainer: document.getElementById('chart-latency-container'),
    cardChartValidation: document.getElementById('card-chart-validation'),
    chartValidationContainer: document.getElementById('chart-validation-container'),
    cardChartPeerscore: document.getElementById('card-chart-peerscore'),
    chartPeerscoreContainer: document.getElementById('chart-peerscore-container'),
    tournamentSummaryTbody: document.getElementById('tournament-summary-tbody'),
    btnRequestJudge: document.getElementById('btn-request-judge'),
    colosseumJudgeCard: document.getElementById('colosseum-judge-card'),
    colosseumJudgeMeta: document.getElementById('colosseum-judge-meta'),
    colosseumJudgeBody: document.getElementById('colosseum-judge-body'),
    peerReviewsCard: document.getElementById('peer-reviews-card'),
    btnTriggerPeerReviews: document.getElementById('btn-trigger-peer-reviews'),
    peerScoresLeaderboard: document.getElementById('peer-scores-leaderboard'),
    peerFiltersBar: document.getElementById('peer-filters-bar'),
    filterPeerReviewer: document.getElementById('filter-peer-reviewer'),
    filterPeerTarget: document.getElementById('filter-peer-target'),
    peerReviewsGrid: document.getElementById('peer-reviews-grid'),
    peerReviewsEmpty: document.getElementById('peer-reviews-empty'),
    trialsAccordion: document.getElementById('trials-accordion'),
    btnRestartTournament: document.getElementById('btn-restart-tournament'),
  }

  // ── Theme Management ──
  function applyTheme(theme) {
    state.theme = theme
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('savant_theme', theme)
    if (el.themeToggleBtn) {
      el.themeToggleBtn.innerHTML = theme === 'dark'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
    }
  }

  // ── View Switching (Solo Duel vs Grand Tournament) ──
  function switchView(viewName) {
    state.currentView = viewName

    el.tabChat?.classList.toggle('active', viewName === 'chat')
    el.tabArena?.classList.toggle('active', viewName === 'arena')

    if (el.viewChat) el.viewChat.style.display = viewName === 'chat' ? 'flex' : 'none'
    if (el.viewArena) el.viewArena.style.display = viewName === 'arena' ? 'flex' : 'none'

    if (el.chatSidebarSection) el.chatSidebarSection.style.display = viewName === 'chat' ? 'block' : 'none'
    if (el.arenaSidebarSection) el.arenaSidebarSection.style.display = viewName === 'arena' ? 'block' : 'none'

    if (viewName === 'arena') {
      loadModels(true)
      loadTournamentQuestions()
      loadTournaments()
      renderGladiatorCheckboxes()
      if (!state.isTournamentRunning && !state.currentTournament) {
        goToTournamentStep(1)
      }
    }
  }

  // ── Stepped Tournament Router ──
  function goToTournamentStep(stepNum) {
    state.tournamentStep = stepNum

    // Update Nav Step Buttons
    const navs = [el.stepNav1, el.stepNav2, el.stepNav3, el.stepNav4]
    navs.forEach((nav, idx) => {
      if (!nav) return
      const stepIdx = idx + 1
      nav.classList.toggle('active', stepIdx === stepNum)
      nav.classList.toggle('completed', stepIdx < stepNum)
    })

    // Show / Hide Dedicated Screens
    if (el.screenGladiators) el.screenGladiators.style.display = stepNum === 1 ? 'flex' : 'none'
    if (el.screenTrials) el.screenTrials.style.display = stepNum === 2 ? 'flex' : 'none'
    if (el.screenBattle) el.screenBattle.style.display = stepNum === 3 ? 'flex' : 'none'
    if (el.screenResults) el.screenResults.style.display = stepNum === 4 ? 'flex' : 'none'
  }

  // ── Fetch Models & Providers ──
  async function loadModels(force = false) {
    try {
      const url = force ? '/models?refresh=true' : '/models'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load models')
      const data = await res.json()
      state.providerDetails = data.providers || []
      state.providers = state.providerDetails.filter((p) => p.enabled)

      renderProviderDropdown()
      renderGladiatorCheckboxes()
      updateStatusBadge()
    } catch (err) {
      console.error('[gateway] loadModels error:', err)
    }
  }

  function updateStatusBadge() {
    if (el.statusBadge) {
      const count = state.providers.length
      el.statusBadge.innerHTML = `<span class="status-dot"></span><span>${count} Active</span>`
    }
  }

  function renderProviderDropdown() {
    if (!el.providerSelect) return
    const prevSelected = state.selectedProvider || el.providerSelect.value

    el.providerSelect.innerHTML = ''
    for (const p of state.providerDetails) {
      const opt = document.createElement('option')
      opt.value = p.id
      opt.textContent = p.enabled ? `${p.label || p.name}` : `${p.label || p.name} (disabled)`
      opt.disabled = !p.enabled
      el.providerSelect.appendChild(opt)
    }

    if (prevSelected && state.providers.some((p) => p.id === prevSelected)) {
      el.providerSelect.value = prevSelected
      state.selectedProvider = prevSelected
    } else if (state.providers.length > 0) {
      const preferred = state.providers.find((p) => p.id === 'ollama') || state.providers[0]
      el.providerSelect.value = preferred.id
      state.selectedProvider = preferred.id
    }

    renderModelDropdown()
  }

  function renderModelDropdown() {
    if (!el.modelSelect) return
    const provider = state.providerDetails.find((p) => p.id === state.selectedProvider)
    el.modelSelect.innerHTML = ''

    if (!provider || !provider.models || provider.models.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = 'Default'
      el.modelSelect.appendChild(opt)
      state.selectedModel = ''
      return
    }

    const validModels = []
    for (const m of provider.models) {
      const opt = document.createElement('option')
      const parts = String(m).split('\t')
      const modelVal = parts[0]
      const modelLabel = parts[1] || parts[0]
      validModels.push(modelVal)
      opt.value = modelVal
      opt.textContent = modelLabel
      if (modelVal === provider.defaultModel) {
        opt.textContent += ' (default)'
      }
      el.modelSelect.appendChild(opt)
    }

    const prevModel = state.selectedModel
    if (prevModel && validModels.includes(prevModel)) {
      el.modelSelect.value = prevModel
    } else if (provider.defaultModel && validModels.includes(provider.defaultModel)) {
      el.modelSelect.value = provider.defaultModel
      state.selectedModel = provider.defaultModel
    } else if (validModels.length > 0) {
      el.modelSelect.value = validModels[0]
      state.selectedModel = validModels[0]
    } else {
      state.selectedModel = ''
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 🏛️ GRAND TOURNAMENT ENGINE (SELECT -> TRIALS -> LIVE ARENA -> LEADERBOARD)
  // ════════════════════════════════════════════════════════════════════════

  async function loadTournamentQuestions() {
    if (state.benchmarkSuites.length > 0) return
    try {
      const res = await fetch('/tournaments/questions')
      if (!res.ok) throw new Error('Failed to load trial suites')
      const data = await res.json()
      state.benchmarkSuites = data.suites || []
      renderSuiteTabs()
    } catch (err) {
      console.error('[gateway] loadTournamentQuestions error:', err)
    }
  }

  function renderGladiatorCheckboxes() {
    if (!el.gladiatorsSelectionGrid) return
    el.gladiatorsSelectionGrid.innerHTML = ''

    const allGladiators = []

    for (const p of state.providers) {
      if (p.models && p.models.length > 0) {
        for (const m of p.models) {
          const modelId = String(m).split('\t')[0]
          allGladiators.push({
            provider: p.id,
            model: modelId,
            label: p.label || p.name,
            isLocal: p.id === 'ollama',
          })
        }
      } else {
        allGladiators.push({
          provider: p.id,
          model: p.defaultModel || '',
          label: p.label || p.name,
          isLocal: p.id === 'ollama',
        })
      }
    }

    // Retain only gladiators that still exist in the current discovery list
    state.selectedGladiators = state.selectedGladiators.filter((sg) =>
      allGladiators.some((ag) => ag.provider === sg.provider && ag.model === sg.model)
    )

    if (state.selectedGladiators.length === 0 && allGladiators.length >= 2) {
      state.selectedGladiators = allGladiators.slice(0, 2)
    }

    allGladiators.forEach((g) => {
      const card = document.createElement('div')
      const isSelected = state.selectedGladiators.some((sg) => sg.provider === g.provider && sg.model === g.model)
      card.className = `gladiator-card ${isSelected ? 'selected' : ''}`

      const icon = g.isLocal ? '🦙' : (g.provider === 'gemini' ? '♊' : (g.provider === 'claude' ? '🧠' : '⚡'))
      const tierBadge = g.isLocal ? '<span class="tier-badge local">Free (Local)</span>' : '<span class="tier-badge">Cloud API</span>'

      card.innerHTML = `
        <input type="checkbox" ${isSelected ? 'checked' : ''} style="cursor: pointer;">
        <div class="gladiator-card-info">
          <div class="gladiator-card-name">${icon} ${window.SavantMarkdown.escapeHtml(g.label)}</div>
          <div class="gladiator-card-meta">${window.SavantMarkdown.escapeHtml(g.model || 'default')} · ${tierBadge}</div>
        </div>
      `

      card.onclick = (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = card.querySelector('input')
          cb.checked = !cb.checked
        }
        const checked = card.querySelector('input').checked
        card.classList.toggle('selected', checked)

        if (checked) {
          if (!state.selectedGladiators.some((sg) => sg.provider === g.provider && sg.model === g.model)) {
            state.selectedGladiators.push(g)
          }
        } else {
          state.selectedGladiators = state.selectedGladiators.filter((sg) => !(sg.provider === g.provider && sg.model === g.model))
        }

        updateGladiatorsSummary()
      }

      el.gladiatorsSelectionGrid.appendChild(card)
    })

    updateGladiatorsSummary()
  }

  function updateGladiatorsSummary() {
    if (el.gladiatorsSummaryCount) {
      el.gladiatorsSummaryCount.textContent = `${state.selectedGladiators.length} Gladiators selected`
    }
  }

  function renderSuiteTabs() {
    if (!el.suiteTabs || state.benchmarkSuites.length === 0) return
    el.suiteTabs.innerHTML = ''

    state.benchmarkSuites.forEach((suite, idx) => {
      const tab = document.createElement('button')
      tab.className = `suite-tab ${idx === 0 ? 'active' : ''}`
      tab.textContent = suite.name
      tab.onclick = () => {
        document.querySelectorAll('.suite-tab').forEach((t) => t.classList.remove('active'))
        tab.classList.add('active')
        renderQuestionsList(suite.questions)
      }
      el.suiteTabs.appendChild(tab)
    })

    renderQuestionsList(state.benchmarkSuites[0].questions)
  }

  function renderQuestionsList(questions) {
    if (!el.questionsSelectionList) return
    el.questionsSelectionList.innerHTML = ''
    state.selectedQuestions = [...questions]

    questions.forEach((q) => {
      const item = document.createElement('div')
      item.className = 'question-item'
      const hasTests = Array.isArray(q.testCases) && q.testCases.length > 0
      const testBadge = hasTests
        ? `<span class="val-badge passed" style="font-size: 10px; margin-left: 6px;">🧪 ${q.testCases.length} Tests (${q.language || 'JS'})</span>`
        : ''

      item.innerHTML = `
        <input type="checkbox" checked style="cursor: pointer; margin-top: 3px;">
        <div class="question-item-info">
          <div class="question-item-title">
            ${window.SavantMarkdown.escapeHtml(q.title)} 
            <span style="font-size: 11px; color: var(--text-muted);">(${window.SavantMarkdown.escapeHtml(q.category)})</span>
            ${testBadge}
          </div>
          <div class="question-item-prompt">${window.SavantMarkdown.escapeHtml(q.prompt)}</div>
        </div>
      `

      item.onclick = (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = item.querySelector('input')
          cb.checked = !cb.checked
        }
        const checked = item.querySelector('input').checked
        if (checked) {
          if (!state.selectedQuestions.some((sq) => sq.id === q.id)) {
            state.selectedQuestions.push(q)
          }
        } else {
          state.selectedQuestions = state.selectedQuestions.filter((sq) => sq.id !== q.id)
        }
        updateTrialsSummary()
      }

      el.questionsSelectionList.appendChild(item)
    })

    updateTrialsSummary()
  }

  function updateTrialsSummary() {
    if (el.trialsSummaryCount) {
      el.trialsSummaryCount.textContent = `${state.selectedQuestions.length} Trials selected`
    }
  }

  // ── Custom Coding Trial Builder ──
  function openCustomTrialModal() {
    if (!el.customTrialModal) return
    if (el.customTrialTitle) el.customTrialTitle.value = ''
    if (el.customTrialFnName) el.customTrialFnName.value = ''
    if (el.customTrialSignature) el.customTrialSignature.value = ''
    if (el.customTrialPrompt) el.customTrialPrompt.value = ''

    if (el.testCasesBuilderList) {
      el.testCasesBuilderList.innerHTML = ''
      addTestCaseRow('Example 1', '[[2, 7, 11, 15], 9]', '[0, 1]')
      addTestCaseRow('Edge Case', '[[3, 3], 6]', '[0, 1]')
    }

    el.customTrialModal.style.display = 'flex'
  }

  function closeCustomTrialModal() {
    if (el.customTrialModal) el.customTrialModal.style.display = 'none'
  }

  function addTestCaseRow(name = '', inputStr = '', expectedStr = '') {
    if (!el.testCasesBuilderList) return
    const row = document.createElement('div')
    row.className = 'test-case-builder-item'
    row.innerHTML = `
      <input type="text" class="form-input tc-name" placeholder="Test Name" value="${window.SavantMarkdown.escapeHtml(name)}">
      <input type="text" class="form-input tc-input" placeholder="Input Args (JSON)" value="${window.SavantMarkdown.escapeHtml(inputStr)}">
      <input type="text" class="form-input tc-expected" placeholder="Expected (JSON)" value="${window.SavantMarkdown.escapeHtml(expectedStr)}">
      <button type="button" class="btn-delete-tc" title="Remove Test Case">&times;</button>
    `

    row.querySelector('.btn-delete-tc').onclick = () => row.remove()
    el.testCasesBuilderList.appendChild(row)
  }

  function saveCustomTrial() {
    const title = el.customTrialTitle?.value.trim()
    const category = el.customTrialCategory?.value.trim() || 'Coding & Algorithms'
    const language = el.customTrialLanguage?.value || 'javascript'
    const functionName = el.customTrialFnName?.value.trim() || ''
    const functionSignature = el.customTrialSignature?.value.trim() || ''
    const prompt = el.customTrialPrompt?.value.trim()

    if (!title || !prompt) {
      alert('Please provide at least a title and problem prompt for the challenge.')
      return
    }

    const testCases = []
    const rows = el.testCasesBuilderList?.querySelectorAll('.test-case-builder-item') || []
    for (const row of rows) {
      const tcName = row.querySelector('.tc-name')?.value.trim() || `Test Case ${testCases.length + 1}`
      const tcInputRaw = row.querySelector('.tc-input')?.value.trim() || '[]'
      const tcExpectedRaw = row.querySelector('.tc-expected')?.value.trim() || 'null'

      let parsedInput, parsedExpected
      try {
        parsedInput = JSON.parse(tcInputRaw)
      } catch {
        parsedInput = tcInputRaw
      }
      try {
        parsedExpected = JSON.parse(tcExpectedRaw)
      } catch {
        parsedExpected = tcExpectedRaw
      }

      testCases.push({
        name: tcName,
        input: parsedInput,
        expected: parsedExpected,
      })
    }

    const customQuestion = {
      id: `custom-trial-${Date.now()}`,
      category,
      title,
      language,
      functionName,
      functionSignature,
      prompt,
      testCases,
    }

    // Add or update custom suite in state.benchmarkSuites
    let customSuite = state.benchmarkSuites.find((s) => s.id === 'custom-suite')
    if (!customSuite) {
      customSuite = {
        id: 'custom-suite',
        name: '✨ Custom Challenges',
        description: 'User-created trials with automated test case validation.',
        questions: [],
      }
      state.benchmarkSuites.push(customSuite)
    }

    customSuite.questions.push(customQuestion)
    if (!state.selectedQuestions.some((sq) => sq.id === customQuestion.id)) {
      state.selectedQuestions.push(customQuestion)
    }

    closeCustomTrialModal()
    renderSuiteTabs()
    // Activate the custom suite tab
    const customIdx = state.benchmarkSuites.findIndex((s) => s.id === 'custom-suite')
    if (customIdx >= 0) {
      const tabs = el.suiteTabs?.querySelectorAll('.suite-tab') || []
      if (tabs[customIdx]) {
        tabs.forEach((t) => t.classList.remove('active'))
        tabs[customIdx].classList.add('active')
        renderQuestionsList(customSuite.questions)
      }
    }
    updateTrialsSummary()
  }

  // ── Arena Presets ──
  function applyTournamentPreset(preset) {
    const ollama = state.providers.find((p) => p.id === 'ollama')
    const gemini = state.providers.find((p) => p.id === 'gemini')
    const claude = state.providers.find((p) => p.id === 'claude')

    if (preset === 'all-ollama') {
      if (!ollama || !ollama.models || ollama.models.length < 2) {
        alert('Need at least 2 local Ollama models for Local Clash.')
        return
      }
      state.selectedGladiators = ollama.models.map((m) => ({
        provider: 'ollama',
        model: String(m).split('\t')[0],
        label: 'Ollama',
        isLocal: true,
      }))
    } else if (preset === 'local-cloud') {
      const list = []
      if (ollama && ollama.models?.[0]) {
        list.push({ provider: 'ollama', model: String(ollama.models[0]).split('\t')[0], label: 'Ollama', isLocal: true })
      }
      if (gemini) list.push({ provider: 'gemini', model: gemini.defaultModel || 'gemini-2.5-flash', label: 'Gemini', isLocal: false })
      if (claude) list.push({ provider: 'claude', model: claude.defaultModel || 'haiku', label: 'Claude', isLocal: false })
      state.selectedGladiators = list
    } else if (preset === 'fastest') {
      const list = []
      if (gemini) list.push({ provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini', isLocal: false })
      if (claude) list.push({ provider: 'claude', model: 'haiku', label: 'Claude', isLocal: false })
      if (ollama && ollama.models?.[0]) list.push({ provider: 'ollama', model: String(ollama.models[0]).split('\t')[0], label: 'Ollama', isLocal: true })
      state.selectedGladiators = list
    }

    renderGladiatorCheckboxes()
  }

  // ── Launch Tournament ──
  async function startColosseumTournament() {
    if (state.selectedGladiators.length < 2) {
      alert('Please select at least 2 gladiators to enter the Colosseum.')
      return
    }

    if (state.selectedQuestions.length < 1) {
      alert('Please select at least 1 battle trial question.')
      return
    }

    if (state.isTournamentRunning) return
    state.isTournamentRunning = true
    state.currentActiveBattleRunId = null

    // Switch to Dedicated Page 3: Live Battle Arena Screen!
    goToTournamentStep(3)

    if (el.liveChatResponseContent) {
      el.liveChatResponseContent.innerHTML = '<span class="thinking-spinner"></span> Initializing Colosseum battle sequence...'
    }

    try {
      const res = await fetch('/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Colosseum Battle: ${state.selectedGladiators.map((g) => g.model).join(' vs ')}`,
          participants: state.selectedGladiators,
          questions: state.selectedQuestions,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const tournament = await res.json()
      state.currentTournamentId = tournament.id
      state.currentTournament = tournament

      pollTournamentProgress(tournament.id)
      loadTournaments()
    } catch (err) {
      console.error('[gateway] startTournament error:', err)
      alert(`Tournament start failed: ${err.message}`)
      state.isTournamentRunning = false
      goToTournamentStep(1)
    }
  }

  function pollTournamentProgress(tournamentId) {
    if (state.tournamentPollTimer) clearInterval(state.tournamentPollTimer)

    state.tournamentPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/tournaments/${tournamentId}`)
        if (!res.ok) return
        const tournament = await res.json()
        state.currentTournament = tournament

        const pct = Math.round((tournament.completedSteps / Math.max(1, tournament.totalSteps)) * 100)
        if (el.battleProgressBarFill) el.battleProgressBarFill.style.width = `${pct}%`

        const curQ = tournament.questions[tournament.currentQuestionIndex]
        const curP = tournament.participants[tournament.currentParticipantIndex]

        if (curQ && curP) {
          if (el.liveTrialCategory) el.liveTrialCategory.textContent = curQ.category
          if (el.liveTrialTitle) el.liveTrialTitle.textContent = `Trial ${tournament.currentQuestionIndex + 1}: ${curQ.title}`
          if (el.liveChatPrompt) el.liveChatPrompt.innerHTML = window.SavantMarkdown.render(curQ.prompt)
          if (el.liveChatCategory) el.liveChatCategory.textContent = `${curQ.category} (Trial ${tournament.currentQuestionIndex + 1})`

          if (el.liveGladiatorName) el.liveGladiatorName.textContent = curP.gladiatorName
          if (el.liveGladiatorModel) el.liveGladiatorModel.textContent = `${curP.provider}: ${curP.model}`
          if (el.liveGladiatorTier) el.liveGladiatorTier.textContent = curP.isLocal ? 'Free (Local Host)' : 'Cloud API'
          if (el.liveChatGladiatorTag) el.liveChatGladiatorTag.textContent = `🤺 ${curP.gladiatorName} (${curP.model})`

          if (el.battleStepText) {
            el.battleStepText.textContent = `Step ${tournament.completedSteps + 1} of ${tournament.totalSteps}: Fighting ${curP.gladiatorName} (${curP.model})... [${pct}%]`
          }

          // Render live validation results if available for current run
          const currentGladiatorRun = curQ.runs?.[curP.gladiatorKey]
          if (currentGladiatorRun?.validation) {
            renderLiveValidationBox(currentGladiatorRun.validation)
          } else if (!state.isGenerating) {
            if (el.liveChatValidationBox) el.liveChatValidationBox.style.display = 'none'
          }

          // If there is an active runId, attach SSE live stream!
          if (tournament.currentRunId && tournament.currentRunId !== state.currentActiveBattleRunId) {
            state.currentActiveBattleRunId = tournament.currentRunId
            attachBattleLiveStream(tournament.currentRunId, curQ, curP)
          }

          // Render completed timeline
          renderBattleTimeline(tournament)
        }

        // Check if tournament finished
        if (tournament.status === 'completed' || tournament.completedSteps >= tournament.totalSteps) {
          clearInterval(state.tournamentPollTimer)
          state.tournamentPollTimer = null
          state.isTournamentRunning = false
          if (state.activeBattleEventSource) {
            state.activeBattleEventSource.close()
            state.activeBattleEventSource = null
          }

          // Switch to Dedicated Page 4: Grand Leaderboard & Results!
          goToTournamentStep(4)
          renderTournamentResults(tournament)
          loadTournaments()
          if (!tournament.aiJudgeVerdict && !state.activeJudgeEventSource) {
            requestTournamentJudge()
          }
        }
      } catch (err) {
        console.error('[gateway] poll tournament error:', err)
      }
    }, 800)
  }

  function renderLiveValidationBox(validation) {
    if (!el.liveChatValidationBox) return
    if (!validation) {
      el.liveChatValidationBox.style.display = 'none'
      return
    }

    el.liveChatValidationBox.style.display = 'block'
    const isPassed = validation.status === 'passed'
    const badgeClass = isPassed ? 'passed' : (validation.status === 'failed' ? 'failed' : 'error')
    const badgeIcon = isPassed ? '✅' : (validation.status === 'failed' ? '❌' : '⚠️')

    if (el.liveChatValBadge) {
      el.liveChatValBadge.className = `val-badge ${badgeClass}`
      el.liveChatValBadge.innerHTML = `${badgeIcon} ${validation.status.toUpperCase()}`
    }

    if (el.liveChatValStats) {
      el.liveChatValStats.textContent = `${validation.passedCount}/${validation.totalCount} tests passed (${validation.passRate || 0}%) · ${validation.durationMs}ms`
    }

    if (el.liveChatValTestsList && Array.isArray(validation.tests)) {
      if (validation.tests.length === 0) {
        el.liveChatValTestsList.innerHTML = `<div style="padding: 10px; font-size: 12px; color: var(--text-muted);">${validation.error || 'No test cases executed.'}</div>`
      } else {
        let tableHtml = `
          <table class="test-cases-table">
            <thead>
              <tr>
                <th>Test Case</th>
                <th>Input</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
        `
        validation.tests.forEach((t) => {
          const pass = t.passed
          tableHtml += `
            <tr>
              <td><strong>${window.SavantMarkdown.escapeHtml(t.name)}</strong></td>
              <td><code>${window.SavantMarkdown.escapeHtml(t.input || '')}</code></td>
              <td><code>${window.SavantMarkdown.escapeHtml(t.expected || '')}</code></td>
              <td><code>${window.SavantMarkdown.escapeHtml(t.actual || t.error || '')}</code></td>
              <td><span class="${pass ? 'tc-status-pass' : 'tc-status-fail'}">${pass ? '✓ PASS' : '✗ FAIL'}</span></td>
            </tr>
          `
        })
        tableHtml += '</tbody></table>'
        el.liveChatValTestsList.innerHTML = tableHtml
      }
    }
  }

  function attachBattleLiveStream(runId, curQ, curP) {
    if (state.activeBattleEventSource) {
      state.activeBattleEventSource.close()
      state.activeBattleEventSource = null
    }

    if (el.liveChatResponseContent) {
      el.liveChatResponseContent.innerHTML = '<span class="thinking-spinner"></span> <span class="streaming-cursor"></span>'
    }
    if (el.liveChatThinkingContainer) el.liveChatThinkingContainer.style.display = 'none'
    if (el.liveChatThinkingBody) el.liveChatThinkingBody.textContent = ''
    if (el.liveChatValidationBox) el.liveChatValidationBox.style.display = 'none'
    if (el.liveChatStatsPill) {
      el.liveChatStatsPill.style.display = 'inline-flex'
      if (el.liveChatStatsText) el.liveChatStatsText.textContent = 'Streaming live tokens...'
    }

    const es = new EventSource(`/runs/${runId}/stream`)
    state.activeBattleEventSource = es

    let streamStartTime = performance.now()
    let accumulated = ''
    let accumulatedThinking = ''

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'thinking') {
          if (el.liveChatThinkingContainer) {
            el.liveChatThinkingContainer.style.display = 'block'
            if (data.tag && el.liveChatThinkingStatus) {
              el.liveChatThinkingStatus.textContent = `${data.tag} (${data.status})`
            }
          }
        } else if (data.type === 'chunk') {
          accumulated += data.content
          const tokens = Math.max(1, Math.round(accumulated.length / 3.8))
          const elapsedSec = Math.max((performance.now() - streamStartTime) / 1000, 0.05)
          const liveTPS = (tokens / elapsedSec).toFixed(1)

          if (el.liveChatStatsText) {
            el.liveChatStatsText.textContent = `${liveTPS} tok/s · ${tokens} tok · ${elapsedSec.toFixed(1)}s`
          }

          const parsed = parseClientThinking(accumulated)
          if (parsed.thinking) {
            accumulatedThinking = parsed.thinking
            if (el.liveChatThinkingContainer && el.liveChatThinkingBody) {
              el.liveChatThinkingContainer.style.display = 'block'
              el.liveChatThinkingBody.textContent = accumulatedThinking
            }
          }

          const answerText = parsed.answer || accumulated
          if (el.liveChatResponseContent) {
            el.liveChatResponseContent.innerHTML = window.SavantMarkdown.render(answerText) + '<span class="streaming-cursor"></span>'
          }
        } else if (data.type === 'complete') {
          es.close()
          state.activeBattleEventSource = null

          const parsed = parseClientThinking(data.content || accumulated)
          if (parsed.thinking && el.liveChatThinkingContainer && el.liveChatThinkingBody) {
            el.liveChatThinkingContainer.style.display = 'block'
            el.liveChatThinkingBody.textContent = parsed.thinking
            if (el.liveChatThinkingStatus) el.liveChatThinkingStatus.textContent = 'Thought Process'
          }

          const finalAnswer = parsed.answer || data.content || accumulated
          if (el.liveChatResponseContent) {
            el.liveChatResponseContent.innerHTML = window.SavantMarkdown.render(finalAnswer)
          }

          if (el.liveChatStatsText && data.stats) {
            el.liveChatStatsText.textContent = `${data.stats.tokensPerSecond} tok/s · ${data.stats.tokenCount} tok · ${(data.stats.totalTimeMs / 1000).toFixed(1)}s`
          }

          // Live validation check if test cases configured
          if (curQ && (curQ.testCases?.length > 0 || curQ.customTestHarness)) {
            fetch('/validate-code', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: finalAnswer,
                language: curQ.language,
                functionName: curQ.functionName,
                testCases: curQ.testCases,
                customTestHarness: curQ.customTestHarness,
              }),
            })
              .then((r) => r.json())
              .then((vData) => {
                if (vData.result) renderLiveValidationBox(vData.result)
              })
              .catch((e) => console.warn('[gateway] live validate error:', e))
          }
        } else if (data.type === 'error') {
          es.close()
          state.activeBattleEventSource = null
          if (el.liveChatResponseContent) {
            el.liveChatResponseContent.innerHTML = `<div style="color: var(--accent-red);">Error: ${window.SavantMarkdown.escapeHtml(data.message || 'Trial failed')}</div>`
          }
        }
      } catch (err) {
        console.error('[gateway] battle stream parse error:', err)
      }
    }

    es.onerror = () => {
      es.close()
      state.activeBattleEventSource = null
    }
  }

  function renderBattleTimeline(t) {
    if (!el.battleTimelineCard || !el.battleTimelineList) return
    const completedRuns = []

    t.questions.forEach((q, qIdx) => {
      t.participants.forEach((p) => {
        const run = q.runs[p.gladiatorKey]
        if (run && run.status === 'complete' && run.response) {
          const valBadge = run.validation
            ? ` · 🧪 ${run.validation.passedCount}/${run.validation.totalCount} Tests (${run.validation.passRate}%)`
            : ''
          completedRuns.push({
            trialNum: qIdx + 1,
            trialTitle: q.title,
            gladiator: p.gladiatorName,
            model: p.model,
            tps: run.benchmark ? `${run.benchmark.tokensPerSecond} tok/s` : '--',
            ttft: run.benchmark ? `${(run.benchmark.firstTokenMs / 1000).toFixed(2)}s` : '--',
            valBadge,
          })
        }
      })
    })

    if (completedRuns.length === 0) {
      el.battleTimelineCard.style.display = 'none'
      return
    }

    el.battleTimelineCard.style.display = 'flex'
    el.battleTimelineList.innerHTML = ''

    completedRuns.slice(-4).reverse().forEach((cr) => {
      const item = document.createElement('div')
      item.className = 'battle-timeline-item'
      item.innerHTML = `
        <div class="battle-timeline-left">
          <span class="battle-timeline-step-badge">✓</span>
          <span><strong>Trial ${cr.trialNum} (${window.SavantMarkdown.escapeHtml(cr.trialTitle)}):</strong> ${window.SavantMarkdown.escapeHtml(cr.gladiator)} (<code>${window.SavantMarkdown.escapeHtml(cr.model)}</code>)</span>
        </div>
        <div class="battle-timeline-metrics">⚡ ${cr.tps} · TTFT ${cr.ttft}${cr.valBadge}</div>
      `
      el.battleTimelineList.appendChild(item)
    })
  }

  // ── Render Leaderboard & Visual Performance Graphs (Page 4) ──
  function renderTournamentResults(t) {
    // Champion Banner
    if (t.champion) {
      if (el.championBanner) el.championBanner.style.display = 'flex'
      if (el.championName) el.championName.textContent = `${t.champion.gladiatorName} (${t.champion.provider}:${t.champion.model})`
      
      const codeScoreExtra = t.champion.codePassRate !== null ? ` · 🧪 Code Tests: ${t.champion.codePassRate}%` : ''
      const peerScoreExtra = t.champion.avgPeerScore !== null ? ` · ⭐ Peer Rating: ${t.champion.avgPeerScore}/10` : ''
      if (el.championStats) el.championStats.textContent = `⚡ Output Speed: ${t.champion.avgTps} tok/s${codeScoreExtra}${peerScoreExtra} · 💰 Cost Tier: ${t.champion.isLocal ? 'Free (Local Host)' : 'Cloud API'}`
    }

    // Visual Charts
    if (t.charts) {
      renderSpeedChart(t.charts.speedChart || [])
      renderLatencyChart(t.charts.latencyChart || [])
      renderValidationChart(t.charts.validationChart || [])
      renderPeerScoreChart(t.charts.peerScoreChart || [])
      renderSummaryTable(t.charts.summaryTable || [])
    }

    // Frontier AI Judge Verdict Card
    if (t.aiJudgeVerdict && t.aiJudgeVerdict.raw) {
      if (el.colosseumJudgeCard) el.colosseumJudgeCard.style.display = 'block'
      if (el.colosseumJudgeMeta) {
        el.colosseumJudgeMeta.textContent = `🏛️ Grand Arbiter: ${t.aiJudgeVerdict.judgeProvider}:${t.aiJudgeVerdict.judgeModel}`
      }
      if (el.colosseumJudgeBody) {
        el.colosseumJudgeBody.innerHTML = window.SavantMarkdown.render(t.aiJudgeVerdict.raw)
      }
    } else if (el.colosseumJudgeCard && !state.activeJudgeEventSource) {
      el.colosseumJudgeCard.style.display = 'none'
    }

    // Peer Reviews Section
    renderPeerReviewsSection(t)

    // Trial-by-Trial Accordion
    renderTrialsAccordion(t.questions || [], t.participants || [])
  }

  function renderSpeedChart(series) {
    if (!el.chartSpeedContainer) return
    el.chartSpeedContainer.innerHTML = ''

    if (series.length === 0) return
    const maxVal = Math.max(...series.map((s) => s.value), 1)

    series.forEach((item, idx) => {
      const row = document.createElement('div')
      row.className = 'bar-chart-row'
      const widthPct = Math.max(8, Math.round((item.value / maxVal) * 100))
      const isTop = idx === 0 && item.value > 0

      row.innerHTML = `
        <div class="bar-chart-label-row">
          <span class="bar-label">${isTop ? '👑 ' : ''}${window.SavantMarkdown.escapeHtml(item.name)} <span style="font-size: 11px; color: var(--text-muted);">(${window.SavantMarkdown.escapeHtml(item.label)})</span></span>
          <span class="bar-value">${item.value} tok/s</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${isTop ? 'gold' : ''}" style="width: ${widthPct}%;"></div>
        </div>
      `
      el.chartSpeedContainer.appendChild(row)
    })
  }

  function renderLatencyChart(series) {
    if (!el.chartLatencyContainer) return
    el.chartLatencyContainer.innerHTML = ''

    if (series.length === 0) return
    const maxVal = Math.max(...series.map((s) => s.value), 0.1)

    series.forEach((item) => {
      const row = document.createElement('div')
      row.className = 'bar-chart-row'
      const widthPct = Math.max(8, Math.round((item.value / maxVal) * 100))

      row.innerHTML = `
        <div class="bar-chart-label-row">
          <span class="bar-label">${window.SavantMarkdown.escapeHtml(item.name)} <span style="font-size: 11px; color: var(--text-muted);">(${window.SavantMarkdown.escapeHtml(item.label)})</span></span>
          <span class="bar-value">${item.value}s</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${widthPct}%; background: linear-gradient(90deg, #3fb950, #2f81f7);"></div>
        </div>
      `
      el.chartLatencyContainer.appendChild(row)
    })
  }

  function renderValidationChart(series) {
    if (!el.chartValidationContainer || !el.cardChartValidation) return
    if (!series || series.length === 0) {
      el.cardChartValidation.style.display = 'none'
      return
    }

    el.cardChartValidation.style.display = 'flex'
    el.chartValidationContainer.innerHTML = ''

    series.forEach((item, idx) => {
      const row = document.createElement('div')
      row.className = 'bar-chart-row'
      const widthPct = Math.max(8, item.value)
      const isTop = idx === 0 && item.value === 100

      row.innerHTML = `
        <div class="bar-chart-label-row">
          <span class="bar-label">${isTop ? '👑 ' : ''}${window.SavantMarkdown.escapeHtml(item.name)} <span style="font-size: 11px; color: var(--text-muted);">(${window.SavantMarkdown.escapeHtml(item.label)})</span></span>
          <span class="bar-value" style="color: var(--accent-green);">${item.value}% (${item.passed}/${item.total} passed)</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${widthPct}%; background: linear-gradient(90deg, #3fb950, #2ea043);"></div>
        </div>
      `
      el.chartValidationContainer.appendChild(row)
    })
  }

  function renderPeerScoreChart(series) {
    if (!el.chartPeerscoreContainer || !el.cardChartPeerscore) return
    if (!series || series.length === 0) {
      el.cardChartPeerscore.style.display = 'none'
      return
    }

    el.cardChartPeerscore.style.display = 'flex'
    el.chartPeerscoreContainer.innerHTML = ''

    series.forEach((item, idx) => {
      const row = document.createElement('div')
      row.className = 'bar-chart-row'
      const widthPct = Math.max(8, Math.round((item.value / 10) * 100))
      const isTop = idx === 0 && item.value > 0

      row.innerHTML = `
        <div class="bar-chart-label-row">
          <span class="bar-label">${isTop ? '👑 ' : ''}${window.SavantMarkdown.escapeHtml(item.name)} <span style="font-size: 11px; color: var(--text-muted);">(${window.SavantMarkdown.escapeHtml(item.label)})</span></span>
          <span class="bar-value" style="color: #d29922;">⭐ ${item.value} / 10</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill gold" style="width: ${widthPct}%;"></div>
        </div>
      `
      el.chartPeerscoreContainer.appendChild(row)
    })
  }

  function renderSummaryTable(rows) {
    if (!el.tournamentSummaryTbody) return
    el.tournamentSummaryTbody.innerHTML = ''

    rows.forEach((r, idx) => {
      const tr = document.createElement('tr')
      const costBadge = r.isLocal ? '<span class="tier-badge local">Free (Local)</span>' : '<span class="tier-badge">Cloud API</span>'

      const testScoreText = r.codePassRate !== null
        ? `<strong style="color: var(--accent-green);">${r.codePassRate}%</strong> <span style="font-size: 11px; color: var(--text-muted);">(${r.testsPassed}/${r.testsTotal})</span>`
        : '<span style="color: var(--text-muted);">N/A</span>'

      const peerScoreText = r.avgPeerScore !== null
        ? `<strong style="color: #d29922;">⭐ ${r.avgPeerScore}</strong><span style="font-size: 11px; color: var(--text-muted);">/10 (${r.peerReviewsReceived})</span>`
        : '<span style="color: var(--text-muted);">Pending</span>'

      tr.innerHTML = `
        <td><strong>#${idx + 1}</strong></td>
        <td><strong>${idx === 0 ? '👑 ' : ''}${window.SavantMarkdown.escapeHtml(r.gladiator)}</strong></td>
        <td><code>${window.SavantMarkdown.escapeHtml(r.model)}</code></td>
        <td>${testScoreText}</td>
        <td>${peerScoreText}</td>
        <td><strong style="color: #d29922;">${r.avgTps} tok/s</strong></td>
        <td>${r.avgTtftSec}s</td>
        <td>${r.avgDurationSec}s</td>
        <td>${r.totalTokens}</td>
        <td>${costBadge}</td>
      `
      el.tournamentSummaryTbody.appendChild(tr)
    })
  }

  function renderPeerReviewsSection(t) {
    if (!el.peerReviewsCard) return

    const allReviews = []
    t.questions.forEach((q, qIdx) => {
      (q.peerReviews || []).forEach((pr) => {
        allReviews.push({
          trialIndex: qIdx,
          trialTitle: q.title,
          trialCategory: q.category,
          ...pr,
        })
      })
    })

    // Peer Scores Summary Cards
    if (el.peerScoresLeaderboard) {
      el.peerScoresLeaderboard.innerHTML = ''
      t.participants.forEach((p) => {
        const card = document.createElement('div')
        card.className = 'peer-score-hero-card'
        const scoreDisplay = p.avgPeerScore !== null
          ? `${p.avgPeerScore} <span>/ 10</span>`
          : '-- <span>/ 10</span>'

        card.innerHTML = `
          <div class="peer-score-hero-left">
            <div class="peer-score-hero-name">${window.SavantMarkdown.escapeHtml(p.gladiatorName)}</div>
            <div class="peer-score-hero-model">${window.SavantMarkdown.escapeHtml(p.provider)}:${window.SavantMarkdown.escapeHtml(p.model)}</div>
          </div>
          <div class="peer-score-hero-value">
            ⭐ ${scoreDisplay}
          </div>
        `
        el.peerScoresLeaderboard.appendChild(card)
      })
    }

    // Populate Filters
    if (el.peerFiltersBar && el.filterPeerReviewer && el.filterPeerTarget) {
      if (allReviews.length > 0) {
        el.peerFiltersBar.style.display = 'flex'
        const curReviewer = el.filterPeerReviewer.value
        const curTarget = el.filterPeerTarget.value

        el.filterPeerReviewer.innerHTML = '<option value="">All Reviewers</option>'
        el.filterPeerTarget.innerHTML = '<option value="">All Opponents</option>'

        t.participants.forEach((p) => {
          const optR = document.createElement('option')
          optR.value = p.gladiatorKey
          optR.textContent = `${p.gladiatorName} (${p.model})`
          if (p.gladiatorKey === curReviewer) optR.selected = true
          el.filterPeerReviewer.appendChild(optR)

          const optT = document.createElement('option')
          optT.value = p.gladiatorKey
          optT.textContent = `${p.gladiatorName} (${p.model})`
          if (p.gladiatorKey === curTarget) optT.selected = true
          el.filterPeerTarget.appendChild(optT)
        })
      } else {
        el.peerFiltersBar.style.display = 'none'
      }
    }

    renderFilteredPeerReviews(allReviews)
  }

  function renderFilteredPeerReviews(allReviews) {
    if (!el.peerReviewsGrid) return
    el.peerReviewsGrid.innerHTML = ''

    const reviewerFilter = el.filterPeerReviewer?.value || ''
    const targetFilter = el.filterPeerTarget?.value || ''

    const filtered = allReviews.filter((r) => {
      if (reviewerFilter && r.reviewerKey !== reviewerFilter) return false
      if (targetFilter && r.targetKey !== targetFilter) return false
      return true
    })

    if (filtered.length === 0) {
      if (allReviews.length === 0) {
        el.peerReviewsGrid.innerHTML = `
          <div class="peer-reviews-empty">
            <span>⚔️ Click "Run Gladiator Peer Reviews" to have each AI gladiator review and score the opponent responses!</span>
          </div>
        `
      } else {
        el.peerReviewsGrid.innerHTML = `
          <div class="peer-reviews-empty">
            <span>No peer reviews match the selected filter.</span>
          </div>
        `
      }
      return
    }

    filtered.forEach((r) => {
      const card = document.createElement('div')
      card.className = 'peer-review-card'
      card.innerHTML = `
        <div class="peer-review-card-header">
          <div class="peer-review-duel-tag">
            <span class="peer-reviewer-tag">🤺 ${window.SavantMarkdown.escapeHtml(r.reviewerName)} (${window.SavantMarkdown.escapeHtml(r.reviewerModel)})</span>
            <span>➔</span>
            <span class="peer-target-tag">🎯 ${window.SavantMarkdown.escapeHtml(r.targetName)} (${window.SavantMarkdown.escapeHtml(r.targetModel)})</span>
          </div>
          <span class="peer-score-pill">⭐ ${r.score} / 10</span>
        </div>
        <div class="peer-review-trial-badge">
          📜 <strong>Trial ${r.trialIndex + 1}: ${window.SavantMarkdown.escapeHtml(r.trialTitle)}</strong> (${window.SavantMarkdown.escapeHtml(r.trialCategory || '')})
        </div>
        <div class="peer-review-content message-content">
          ${window.SavantMarkdown.render(r.review)}
        </div>
      `
      el.peerReviewsGrid.appendChild(card)
    })
  }

  async function triggerGladiatorPeerReviews() {
    if (!state.currentTournamentId) return
    if (el.btnTriggerPeerReviews) {
      el.btnTriggerPeerReviews.disabled = true
      el.btnTriggerPeerReviews.innerHTML = '<span class="thinking-spinner"></span> <span>Reviewing Opponent Solutions...</span>'
    }

    try {
      const res = await fetch(`/tournaments/${state.currentTournamentId}/peer-reviews`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Poll until reviews populate
      let attempts = 0
      const pollTimer = setInterval(async () => {
        attempts++
        try {
          const tRes = await fetch(`/tournaments/${state.currentTournamentId}`)
          if (tRes.ok) {
            const tourney = await tRes.json()
            state.currentTournament = tourney
            if (tourney.peerReviewsCount > 0 || attempts > 20) {
              clearInterval(pollTimer)
              if (el.btnTriggerPeerReviews) {
                el.btnTriggerPeerReviews.disabled = false
                el.btnTriggerPeerReviews.innerHTML = '<span>⚡ Run Gladiator Peer Reviews</span>'
              }
              renderTournamentResults(tourney)
            }
          }
        } catch (e) {
          console.warn('[gateway] poll peer reviews error:', e)
        }
      }, 1000)
    } catch (err) {
      console.error('[gateway] triggerPeerReviews error:', err)
      if (el.btnTriggerPeerReviews) {
        el.btnTriggerPeerReviews.disabled = false
        el.btnTriggerPeerReviews.innerHTML = '<span>⚡ Run Gladiator Peer Reviews</span>'
      }
      alert(`Peer reviews request failed: ${err.message}`)
    }
  }

  function renderTrialsAccordion(questions, participants) {
    if (!el.trialsAccordion) return
    el.trialsAccordion.innerHTML = ''

    questions.forEach((q, qIdx) => {
      const item = document.createElement('div')
      item.className = 'trial-accordion-item'

      const hasTests = Array.isArray(q.testCases) && q.testCases.length > 0
      const testBadge = hasTests
        ? `<span class="val-badge passed" style="font-size: 10px; margin-left: 6px;">🧪 ${q.testCases.length} Tests</span>`
        : ''

      const header = document.createElement('div')
      header.className = 'trial-accordion-header'
      header.innerHTML = `
        <span>Trial ${qIdx + 1}: <strong>${window.SavantMarkdown.escapeHtml(q.title)}</strong> (${window.SavantMarkdown.escapeHtml(q.category)})${testBadge}</span>
        <span>▼</span>
      `

      const body = document.createElement('div')
      body.className = 'trial-accordion-body'

      participants.forEach((p) => {
        const run = q.runs[p.gladiatorKey] || {}
        const card = document.createElement('div')
        card.className = 'trial-response-card'

        const speedText = run.benchmark ? `⚡ ${run.benchmark.tokensPerSecond} tok/s · ${(run.benchmark.totalSec)}s` : '--'
        let validationHtml = ''

        if (run.validation) {
          const isPassed = run.validation.status === 'passed'
          const badgeClass = isPassed ? 'passed' : (run.validation.status === 'failed' ? 'failed' : 'error')
          const badgeIcon = isPassed ? '✓' : (run.validation.status === 'failed' ? '✗' : '⚠')

          validationHtml = `
            <div style="margin-top: 10px; padding: 8px 10px; background: rgba(0,0,0,0.15); border-radius: 4px; border: 1px solid var(--border-color);">
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 6px;">
                <span class="val-badge ${badgeClass}">${badgeIcon} ${run.validation.status.toUpperCase()}</span>
                <strong style="color: ${isPassed ? 'var(--accent-green)' : 'var(--accent-red)'};">${run.validation.passedCount}/${run.validation.totalCount} Tests (${run.validation.passRate}%)</strong>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">Duration: ${run.validation.durationMs}ms</div>
            </div>
          `
        }

        card.innerHTML = `
          <div class="trial-response-card-header">
            <span>${window.SavantMarkdown.escapeHtml(p.gladiatorName)}: <strong>${window.SavantMarkdown.escapeHtml(p.model)}</strong></span>
            <span style="font-size: 11px; color: var(--accent-green);">${speedText}</span>
          </div>
          <div class="trial-response-card-body message-content">
            ${window.SavantMarkdown.render(run.response || '(No response recorded)')}
          </div>
          ${validationHtml}
        `
        body.appendChild(card)
      })

      // Peer reviews for this specific trial
      if (Array.isArray(q.peerReviews) && q.peerReviews.length > 0) {
        const reviewsBox = document.createElement('div')
        reviewsBox.style.gridColumn = '1 / -1'
        reviewsBox.style.marginTop = '10px'
        reviewsBox.style.padding = '12px'
        reviewsBox.style.background = 'var(--bg-surface)'
        reviewsBox.style.borderRadius = 'var(--radius-sm)'
        reviewsBox.style.border = '1px solid var(--border-color)'

        let reviewsHtml = `<h4 style="font-size: 12px; margin: 0 0 10px 0; color: #d29922;">🤺 Gladiator Peer Reviews for Trial ${qIdx + 1}</h4>`
        reviewsHtml += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">`

        q.peerReviews.forEach((pr) => {
          reviewsHtml += `
            <div style="padding: 10px; background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span class="peer-reviewer-tag" style="font-size: 11px;">${window.SavantMarkdown.escapeHtml(pr.reviewerName)}</span>
                <span class="peer-score-pill" style="font-size: 11px;">⭐ ${pr.score}/10</span>
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">Reviewing: <strong>${window.SavantMarkdown.escapeHtml(pr.targetName)}</strong></div>
              <div class="message-content" style="font-size: 11.5px; line-height: 1.4; max-height: 150px; overflow-y: auto;">
                ${window.SavantMarkdown.render(pr.review)}
              </div>
            </div>
          `
        })
        reviewsHtml += `</div>`
        reviewsBox.innerHTML = reviewsHtml
        body.appendChild(reviewsBox)
      }

      header.onclick = () => {
        body.style.display = body.style.display === 'none' ? 'grid' : 'none'
        header.querySelector('span:last-child').textContent = body.style.display === 'none' ? '▶' : '▼'
      }

      item.appendChild(header)
      item.appendChild(body)
      el.trialsAccordion.appendChild(item)
    })
  }

  // ── Tournament AI Judge ──
  async function requestTournamentJudge() {
    if (!state.currentTournamentId) return

    if (el.colosseumJudgeCard) {
      el.colosseumJudgeCard.style.display = 'block'
      el.colosseumJudgeMeta.textContent = 'Frontier AI Grand Arbiter evaluating Code, Speed, Logic, and Conversation domains...'
      el.colosseumJudgeBody.innerHTML = '<span class="thinking-spinner"></span> Frontier AI Arbiter is evaluating all gladiator trials and synthesizing domain verdicts...'
      el.colosseumJudgeCard.scrollIntoView({ behavior: 'smooth' })
    }

    try {
      const res = await fetch(`/tournaments/${state.currentTournamentId}/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      if (el.colosseumJudgeMeta) {
        el.colosseumJudgeMeta.textContent = `🏛️ Grand Arbiter: ${data.judgeProvider}:${data.judgeModel}`
      }
      startTournamentJudgeStream(data.judgeRunId, data.judgeProvider, data.judgeModel)
    } catch (err) {
      console.error('[gateway] requestTournamentJudge error:', err)
      if (el.colosseumJudgeBody) {
        el.colosseumJudgeBody.innerHTML = `<div style="color: var(--accent-red);">Verdict request error: ${window.SavantMarkdown.escapeHtml(err.message)}</div>`
      }
    }
  }

  function startTournamentJudgeStream(runId, provider, model) {
    if (state.activeJudgeEventSource) state.activeJudgeEventSource.close()

    const es = new EventSource(`/runs/${runId}/stream`)
    state.activeJudgeEventSource = es
    let accumulated = ''

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'chunk') {
          accumulated += data.content
          if (el.colosseumJudgeBody) {
            el.colosseumJudgeBody.innerHTML = window.SavantMarkdown.render(accumulated)
          }
        } else if (data.type === 'complete') {
          es.close()
          state.activeJudgeEventSource = null
          if (el.colosseumJudgeMeta) {
            el.colosseumJudgeMeta.textContent = `Judged by ${provider}:${model}`
          }
          if (el.colosseumJudgeBody) {
            el.colosseumJudgeBody.innerHTML = window.SavantMarkdown.render(data.content || accumulated)
          }
        }
      } catch (err) {
        console.error('[gateway] judge stream parse error:', err)
      }
    }

    es.onerror = () => {
      es.close()
      state.activeJudgeEventSource = null
    }
  }

  async function loadTournaments() {
    try {
      const res = await fetch('/tournaments')
      if (!res.ok) return
      const data = await res.json()
      renderTournamentsList(data.tournaments || [])
    } catch (err) {
      console.error('[gateway] loadTournaments error:', err)
    }
  }

  function renderTournamentsList(list) {
    if (!el.tournamentsList) return
    el.tournamentsList.innerHTML = ''

    if (list.length === 0) {
      el.tournamentsList.innerHTML = '<div style="padding: 12px 10px; font-size: 12px; color: var(--text-muted);">No tournaments yet</div>'
      return
    }

    const label = document.createElement('div')
    label.className = 'sessions-section-label'
    label.textContent = 'Past Battles'
    el.tournamentsList.appendChild(label)

    list.forEach((t) => {
      const item = document.createElement('div')
      item.className = `session-item ${t.id === state.currentTournamentId ? 'active' : ''}`

      item.innerHTML = `
        <div class="session-item-content">
          <div class="session-item-title">${window.SavantMarkdown.escapeHtml(t.title)}</div>
          <div class="session-item-meta">${t.gladiatorsCount} Models · ${t.trialsCount} Trials · ${t.status}</div>
        </div>
      `

      item.onclick = async () => {
        state.currentTournamentId = t.id
        const res = await fetch(`/tournaments/${t.id}`)
        if (res.ok) {
          const fullT = await res.json()
          state.currentTournament = fullT
          goToTournamentStep(4)
          renderTournamentResults(fullT)
        }
      }

      el.tournamentsList.appendChild(item)
    })
  }

  // ════════════════════════════════════════════════════════════════════════
  // 🗡️ SECTION 1: SOLO DUEL CHAT APPLICATION LOGIC
  // ════════════════════════════════════════════════════════════════════════

  async function loadSessions() {
    try {
      const res = await fetch('/sessions')
      if (!res.ok) return
      const data = await res.json()
      renderSessionsList(data.sessions || [])
    } catch (err) {
      console.error('[gateway] loadSessions error:', err)
    }
  }

  function renderSessionsList(sessions) {
    if (!el.sessionsList) return
    el.sessionsList.innerHTML = ''

    if (sessions.length === 0) {
      el.sessionsList.innerHTML = '<div style="padding: 12px 10px; font-size: 12px; color: var(--text-muted);">No duels yet</div>'
      return
    }

    const label = document.createElement('div')
    label.className = 'sessions-section-label'
    label.textContent = 'Recent Duels'
    el.sessionsList.appendChild(label)

    for (const s of sessions) {
      const item = document.createElement('div')
      item.className = `session-item ${s.id === state.currentSessionId ? 'active' : ''}`
      item.dataset.id = s.id

      const content = document.createElement('div')
      content.className = 'session-item-content'

      const title = document.createElement('div')
      title.className = 'session-item-title'
      title.textContent = s.title || 'Solo Duel'
      content.appendChild(title)

      const meta = document.createElement('div')
      meta.className = 'session-item-meta'
      const providerLabel = s.provider || 'Gateway'
      const modelLabel = s.model ? ` (${s.model})` : ''
      meta.textContent = `${providerLabel}${modelLabel}`
      content.appendChild(meta)

      const delBtn = document.createElement('button')
      delBtn.className = 'session-delete-btn'
      delBtn.title = 'Delete duel'
      delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
      delBtn.onclick = (e) => {
        e.stopPropagation()
        deleteSession(s.id)
      }

      item.appendChild(content)
      item.appendChild(delBtn)

      item.onclick = () => {
        switchView('chat')
        selectSession(s.id)
      }
      el.sessionsList.appendChild(item)
    }
  }

  async function selectSession(sessionId) {
    if (state.isGenerating) {
      if (!confirm('A response is currently generating. Switch duels anyway?')) return
      stopGeneration()
    }

    state.currentSessionId = sessionId
    try {
      const res = await fetch(`/sessions/${sessionId}`)
      if (!res.ok) throw new Error('Session not found')
      const session = await res.json()
      state.currentSession = session

      if (session.provider && state.providers.some((p) => p.id === session.provider)) {
        state.selectedProvider = session.provider
        if (el.providerSelect) el.providerSelect.value = session.provider
        renderModelDropdown()
        if (session.model && el.modelSelect) {
          el.modelSelect.value = session.model
          state.selectedModel = session.model
        }
      }

      if (session.systemPrompt) {
        state.systemPrompt = session.systemPrompt
        if (el.inputSystemPrompt) el.inputSystemPrompt.value = session.systemPrompt
      }

      renderMessages(session.messages || [])
      loadSessions()
    } catch (err) {
      console.error('[gateway] selectSession error:', err)
    }
  }

  async function createNewChat() {
    if (state.isGenerating) stopGeneration()

    try {
      const res = await fetch('/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: state.selectedProvider || undefined,
          model: state.selectedModel || undefined,
          systemPrompt: state.systemPrompt || undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed to create duel')
      const session = await res.json()
      state.currentSessionId = session.id
      state.currentSession = session
      renderMessages([])
      loadSessions()
      if (el.chatTextarea) el.chatTextarea.focus()
    } catch (err) {
      console.error('[gateway] createNewChat error:', err)
    }
  }

  async function deleteSession(sessionId) {
    if (!confirm('Delete this conversation?')) return
    try {
      await fetch(`/sessions/${sessionId}`, { method: 'DELETE' })
      if (state.currentSessionId === sessionId) {
        state.currentSessionId = null
        state.currentSession = null
        renderMessages([])
      }
      loadSessions()
    } catch (err) {
      console.error('[gateway] deleteSession error:', err)
    }
  }

  function renderMessages(messages) {
    if (!el.messagesWrapper) return
    el.messagesWrapper.innerHTML = ''

    if (!messages || messages.length === 0) {
      if (el.welcomeScreen) el.welcomeScreen.style.display = 'flex'
      return
    }

    if (el.welcomeScreen) el.welcomeScreen.style.display = 'none'
    for (const msg of messages) {
      appendMessageToUI(msg)
    }
    scrollToBottom()
  }

  function appendMessageToUI(msg) {
    if (!el.messagesWrapper) return
    if (el.welcomeScreen) el.welcomeScreen.style.display = 'none'

    const msgEl = document.createElement('div')
    msgEl.className = `message ${msg.role}`
    msgEl.dataset.id = msg.id || ''

    const header = document.createElement('div')
    header.className = 'message-header'
    if (msg.role === 'user') {
      header.innerHTML = '<span>You</span>'
    } else {
      const p = msg.provider || state.selectedProvider || 'Gateway'
      const m = msg.model || state.selectedModel || ''
      header.innerHTML = `<span><strong>${window.SavantMarkdown.escapeHtml(p)}</strong> ${m ? `(${window.SavantMarkdown.escapeHtml(m)})` : ''}</span>`
      if (msg.stats && msg.stats.tokensPerSecond) {
        const statsPill = document.createElement('span')
        statsPill.className = 'stats-pill'
        statsPill.title = `Total: ${(msg.stats.totalTimeMs / 1000).toFixed(2)}s | TTFT: ${(msg.stats.firstTokenMs / 1000).toFixed(2)}s | Stream: ${(msg.stats.streamTimeMs / 1000).toFixed(2)}s`
        statsPill.innerHTML = `<span class="stats-icon">⚡</span><span>${msg.stats.tokensPerSecond} tok/s</span> · <span style="opacity: 0.8;">${msg.stats.tokenCount} tok</span> · <span style="opacity: 0.8;">${(msg.stats.totalTimeMs / 1000).toFixed(1)}s</span>`
        header.appendChild(statsPill)
      }
    }
    msgEl.appendChild(header)

    const bubble = document.createElement('div')
    bubble.className = 'message-bubble'

    if (msg.role === 'user' && Array.isArray(msg.files) && msg.files.length > 0) {
      const filesDiv = document.createElement('div')
      filesDiv.className = 'message-files'
      for (const f of msg.files) {
        const filePill = document.createElement('span')
        filePill.className = 'file-pill'
        filePill.innerHTML = `📎 ${window.SavantMarkdown.escapeHtml(f.originalname || f.filename || 'file')}`
        filesDiv.appendChild(filePill)
      }
      bubble.appendChild(filesDiv)
    }

    if (msg.role === 'assistant' && msg.thinking) {
      const thinkingContainer = document.createElement('div')
      thinkingContainer.className = 'thinking-container'

      const thinkingHeader = document.createElement('div')
      thinkingHeader.className = 'thinking-header'
      thinkingHeader.innerHTML = `
        <span class="thinking-status">💭 Thought Process</span>
        <span style="font-size: 10px;">▼</span>
      `

      const thinkingBody = document.createElement('div')
      thinkingBody.className = 'thinking-body'
      thinkingBody.textContent = msg.thinking

      thinkingHeader.onclick = () => {
        thinkingBody.classList.toggle('collapsed')
        thinkingHeader.querySelector('span:last-child').textContent = thinkingBody.classList.contains('collapsed') ? '▶' : '▼'
      }

      thinkingContainer.appendChild(thinkingHeader)
      thinkingContainer.appendChild(thinkingBody)
      bubble.appendChild(thinkingContainer)
    }

    const content = document.createElement('div')
    content.className = 'message-content'
    content.innerHTML = window.SavantMarkdown.render(msg.content || '')
    bubble.appendChild(content)

    msgEl.appendChild(bubble)

    const actions = document.createElement('div')
    actions.className = 'message-actions'
    const copyBtn = document.createElement('button')
    copyBtn.className = 'btn-msg-action'
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>'
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(msg.content || '')
      copyBtn.innerHTML = '✓ Copied'
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>'
      }, 1500)
    }
    actions.appendChild(copyBtn)
    msgEl.appendChild(actions)

    el.messagesWrapper.appendChild(msgEl)
    return msgEl
  }

  function scrollToBottom() {
    if (el.messagesContainer) {
      el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight
    }
  }

  async function sendMessage() {
    const text = (el.chatTextarea?.value || '').trim()
    if (!text && state.attachedFiles.length === 0) return
    if (state.isGenerating) return

    if (!state.currentSessionId) {
      await createNewChat()
    }

    const sessionId = state.currentSessionId
    const filesToSend = [...state.attachedFiles]

    el.chatTextarea.value = ''
    state.attachedFiles = []
    renderFilesTray()
    autoResizeTextarea()

    appendMessageToUI({
      role: 'user',
      content: text,
      files: filesToSend.map((f) => ({ originalname: f.name, size: f.size })),
    })
    scrollToBottom()

    const assistantMsgEl = createAssistantPlaceholder()
    scrollToBottom()

    setGeneratingState(true)

    try {
      const formData = new FormData()
      formData.append('prompt', text)
      if (state.selectedProvider) formData.append('provider', state.selectedProvider)
      if (state.selectedModel) formData.append('model', state.selectedModel)
      if (state.systemPrompt) formData.append('systemPrompt', state.systemPrompt)
      if (state.cwd) formData.append('cwd', state.cwd)
      if (state.executionMode !== 'single') formData.append('execution', state.executionMode)

      for (const f of filesToSend) {
        formData.append('files', f)
      }

      const res = await fetch(`/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      state.activeRunId = data.id
      startRunStream(data.id, assistantMsgEl)
    } catch (err) {
      console.error('[gateway] sendMessage error:', err)
      setGeneratingState(false)
      renderErrorInMessage(assistantMsgEl, err.message)
    }
  }

  function createAssistantPlaceholder() {
    const msgEl = document.createElement('div')
    msgEl.className = 'message assistant'

    const header = document.createElement('div')
    header.className = 'message-header'
    const p = state.selectedProvider || 'Gateway'
    const m = state.selectedModel || ''
    header.innerHTML = `<span><strong>${window.SavantMarkdown.escapeHtml(p)}</strong> ${m ? `(${window.SavantMarkdown.escapeHtml(m)})` : ''}</span>`

    const statsPill = document.createElement('span')
    statsPill.className = 'stats-pill live'
    statsPill.style.display = 'none'
    header.appendChild(statsPill)

    msgEl.appendChild(header)

    const bubble = document.createElement('div')
    bubble.className = 'message-bubble'

    const thinkingContainer = document.createElement('div')
    thinkingContainer.className = 'thinking-container'
    thinkingContainer.style.display = 'none'

    const thinkingHeader = document.createElement('div')
    thinkingHeader.className = 'thinking-header'
    thinkingHeader.innerHTML = `
      <span class="thinking-status">
        <span class="thinking-spinner"></span>
        <span class="thinking-status-text">Thinking...</span>
      </span>
      <span style="font-size: 10px;">▼</span>
    `

    const thinkingBody = document.createElement('div')
    thinkingBody.className = 'thinking-body'

    thinkingHeader.onclick = () => {
      thinkingBody.classList.toggle('collapsed')
      thinkingHeader.querySelector('span:last-child').textContent = thinkingBody.classList.contains('collapsed') ? '▶' : '▼'
    }

    thinkingContainer.appendChild(thinkingHeader)
    thinkingContainer.appendChild(thinkingBody)
    bubble.appendChild(thinkingContainer)

    const content = document.createElement('div')
    content.className = 'message-content'
    content.innerHTML = '<span class="streaming-cursor"></span>'
    bubble.appendChild(content)

    msgEl.appendChild(bubble)
    el.messagesWrapper.appendChild(msgEl)
    return msgEl
  }

  function startRunStream(runId, msgEl) {
    if (state.activeEventSource) {
      state.activeEventSource.close()
    }

    const eventSource = new EventSource(`/runs/${runId}/stream`)
    state.activeEventSource = eventSource

    let accumulatedContent = ''
    let accumulatedThinking = ''
    let activeProvider = state.selectedProvider
    let activeModel = state.selectedModel
    let streamStartTime = null

    const thinkingContainer = msgEl.querySelector('.thinking-container')
    const thinkingBody = msgEl.querySelector('.thinking-body')
    const thinkingStatusText = msgEl.querySelector('.thinking-status-text')
    const thinkingSpinner = msgEl.querySelector('.thinking-spinner')
    const contentEl = msgEl.querySelector('.message-content')
    const headerEl = msgEl.querySelector('.message-header')
    const statsPill = msgEl.querySelector('.stats-pill')

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'thinking') {
          if (data.provider) activeProvider = data.provider
          if (data.model) activeModel = data.model

          if (headerEl) {
            const strongEl = headerEl.querySelector('strong')
            if (strongEl) strongEl.textContent = activeProvider
          }

          if (thinkingContainer && thinkingBody) {
            thinkingContainer.style.display = 'block'
            if (data.tag) {
              thinkingStatusText.textContent = `${data.tag} (${data.status})`
            }
          }
        } else if (data.type === 'chunk') {
          if (!streamStartTime) {
            streamStartTime = performance.now()
          }

          accumulatedContent += data.content

          const tokens = Math.max(1, Math.round(accumulatedContent.length / 3.8))
          const elapsedSec = Math.max((performance.now() - streamStartTime) / 1000, 0.05)
          const liveTPS = (tokens / elapsedSec).toFixed(1)

          if (statsPill) {
            statsPill.style.display = 'inline-flex'
            statsPill.innerHTML = `<span class="stats-icon">⚡</span><span>${liveTPS} tok/s</span> · <span style="opacity: 0.8;">${tokens} tok</span> · <span style="opacity: 0.8;">${elapsedSec.toFixed(1)}s</span>`
          }

          const parsed = parseClientThinking(accumulatedContent)
          if (parsed.thinking) {
            accumulatedThinking = parsed.thinking
            if (thinkingContainer && thinkingBody) {
              thinkingContainer.style.display = 'block'
              thinkingBody.textContent = accumulatedThinking
            }
          }

          const answerText = parsed.answer || accumulatedContent
          contentEl.innerHTML = window.SavantMarkdown.render(answerText) + '<span class="streaming-cursor"></span>'
          scrollToBottom()
        } else if (data.type === 'complete') {
          eventSource.close()
          state.activeEventSource = null
          setGeneratingState(false)

          const parsed = parseClientThinking(data.content || accumulatedContent)
          if (parsed.thinking && thinkingContainer && thinkingBody) {
            thinkingContainer.style.display = 'block'
            thinkingBody.textContent = parsed.thinking
            thinkingSpinner?.remove()
            thinkingStatusText.textContent = 'Thought Process'
          } else if (thinkingContainer && !accumulatedThinking) {
            thinkingContainer.style.display = 'none'
          }

          const finalAnswer = parsed.answer || data.content || accumulatedContent
          contentEl.innerHTML = window.SavantMarkdown.render(finalAnswer)

          if (statsPill && data.stats) {
            statsPill.className = 'stats-pill'
            statsPill.title = `Total: ${(data.stats.totalTimeMs / 1000).toFixed(2)}s | TTFT: ${(data.stats.firstTokenMs / 1000).toFixed(2)}s | Stream: ${(data.stats.streamTimeMs / 1000).toFixed(2)}s`
            statsPill.innerHTML = `<span class="stats-icon">⚡</span><span>${data.stats.tokensPerSecond} tok/s</span> · <span style="opacity: 0.8;">${data.stats.tokenCount} tok</span> · <span style="opacity: 0.8;">${(data.stats.totalTimeMs / 1000).toFixed(1)}s</span>`
          }

          addMessageActions(msgEl, finalAnswer)
          scrollToBottom()
          loadSessions()
        } else if (data.type === 'error') {
          eventSource.close()
          state.activeEventSource = null
          setGeneratingState(false)
          renderErrorInMessage(msgEl, data.message || 'Generation failed')
        }
      } catch (e) {
        console.error('[gateway] stream parse error:', e)
      }
    }

    eventSource.onerror = () => {
      eventSource.close()
      state.activeEventSource = null
      setGeneratingState(false)
      const cursor = msgEl.querySelector('.streaming-cursor')
      if (cursor) cursor.remove()
      loadSessions()
    }
  }

  function parseClientThinking(text) {
    if (!text) return { thinking: '', answer: '' }
    const cleaned = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')

    const cliMatch = cleaned.match(/^Thinking\.\.\.\r?\n([\s\S]*?)\.\.\.done thinking\.\r?\n*([\s\S]*)$/)
    if (cliMatch) {
      return { thinking: cliMatch[1].trim(), answer: cliMatch[2].trim() }
    }

    const xmlMatch = cleaned.match(/<think>([\s\S]*?)<\/think>([\s\S]*)/i)
    if (xmlMatch) {
      return { thinking: xmlMatch[1].trim(), answer: xmlMatch[2].trim() }
    }

    return { thinking: '', answer: cleaned }
  }

  function addMessageActions(msgEl, text) {
    const actions = document.createElement('div')
    actions.className = 'message-actions'
    const copyBtn = document.createElement('button')
    copyBtn.className = 'btn-msg-action'
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>'
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text || '')
      copyBtn.innerHTML = '✓ Copied'
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>'
      }, 1500)
    }
    actions.appendChild(copyBtn)
    msgEl.appendChild(actions)
  }

  function renderErrorInMessage(msgEl, errorMsg) {
    const contentEl = msgEl.querySelector('.message-content')
    if (contentEl) {
      contentEl.innerHTML = `<div style="color: var(--accent-red); padding: 8px; border: 1px solid var(--accent-red); border-radius: 6px; background: rgba(248, 81, 73, 0.1);"><strong>Error:</strong> ${window.SavantMarkdown.escapeHtml(errorMsg)}</div>`
    }
  }

  async function stopGeneration() {
    if (!state.activeRunId) return
    try {
      await fetch(`/runs/${state.activeRunId}`, { method: 'DELETE' })
    } catch (e) {
      console.error('[gateway] stop error:', e)
    } finally {
      if (state.activeEventSource) {
        state.activeEventSource.close()
        state.activeEventSource = null
      }
      setGeneratingState(false)
    }
  }

  function setGeneratingState(isGenerating) {
    state.isGenerating = isGenerating
    if (!el.sendBtn) return

    if (isGenerating) {
      el.sendBtn.classList.add('stop-mode')
      el.sendBtn.title = 'Stop generation'
      el.sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>'
    } else {
      el.sendBtn.classList.remove('stop-mode')
      el.sendBtn.title = 'Send message'
      el.sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>'
      state.activeRunId = null
    }
  }

  function handleFilesSelected(files) {
    if (!files || files.length === 0) return
    for (const f of files) {
      if (state.attachedFiles.length < 10) {
        state.attachedFiles.push(f)
      }
    }
    renderFilesTray()
  }

  function renderFilesTray() {
    if (!el.filesTray) return
    el.filesTray.innerHTML = ''

    if (state.attachedFiles.length === 0) {
      el.filesTray.style.display = 'none'
      return
    }

    el.filesTray.style.display = 'flex'
    state.attachedFiles.forEach((file, idx) => {
      const chip = document.createElement('span')
      chip.className = 'file-chip'
      chip.innerHTML = `
        <span>📄 ${window.SavantMarkdown.escapeHtml(file.name)}</span>
        <button class="file-chip-remove" type="button">&times;</button>
      `
      chip.querySelector('.file-chip-remove').onclick = () => {
        state.attachedFiles.splice(idx, 1)
        renderFilesTray()
      }
      el.filesTray.appendChild(chip)
    })
  }

  function autoResizeTextarea() {
    if (!el.chatTextarea) return
    el.chatTextarea.style.height = 'auto'
    el.chatTextarea.style.height = Math.min(el.chatTextarea.scrollHeight, 180) + 'px'
  }

  // ── Event Listeners ──
  function initEventListeners() {
    // Nav view switching
    el.tabChat?.addEventListener('click', () => switchView('chat'))
    el.tabArena?.addEventListener('click', () => switchView('arena'))

    // Stepper navigation clicks
    el.stepNav1?.addEventListener('click', () => goToTournamentStep(1))
    el.stepNav2?.addEventListener('click', () => {
      if (state.selectedGladiators.length < 2) {
        alert('Please select at least 2 gladiators first.')
        return
      }
      goToTournamentStep(2)
    })
    el.stepNav3?.addEventListener('click', () => {
      if (!state.currentTournament && !state.isTournamentRunning) {
        alert('Please launch a tournament first.')
        return
      }
      goToTournamentStep(3)
    })
    el.stepNav4?.addEventListener('click', () => {
      if (!state.currentTournament) {
        alert('No tournament results yet.')
        return
      }
      goToTournamentStep(4)
    })

    // Stepper buttons
    el.btnGotoTrials?.addEventListener('click', () => {
      if (state.selectedGladiators.length < 2) {
        alert('Please select at least 2 gladiators first.')
        return
      }
      goToTournamentStep(2)
    })

    el.btnBacktoGladiators?.addEventListener('click', () => goToTournamentStep(1))
    el.btnLaunchColosseum?.addEventListener('click', startColosseumTournament)
    el.btnRestartTournament?.addEventListener('click', () => goToTournamentStep(1))

    // Tournament Presets
    el.btnPresetAllOllama?.addEventListener('click', () => applyTournamentPreset('all-ollama'))
    el.btnPresetLocalCloud?.addEventListener('click', () => applyTournamentPreset('local-cloud'))
    el.btnPresetFastest?.addEventListener('click', () => applyTournamentPreset('fastest'))

    // Custom Coding Challenge Modal listeners
    el.btnOpenCustomTrial?.addEventListener('click', openCustomTrialModal)
    el.btnCloseCustomTrial?.addEventListener('click', closeCustomTrialModal)
    el.btnCancelCustomTrial?.addEventListener('click', closeCustomTrialModal)
    el.btnAddTestCaseRow?.addEventListener('click', () => addTestCaseRow())
    el.btnSaveCustomTrial?.addEventListener('click', saveCustomTrial)

    // Peer reviews trigger and filter change listeners
    el.btnTriggerPeerReviews?.addEventListener('click', triggerGladiatorPeerReviews)
    el.filterPeerReviewer?.addEventListener('change', () => {
      const allReviews = []
      state.currentTournament?.questions?.forEach((q, qIdx) => {
        (q.peerReviews || []).forEach((pr) => {
          allReviews.push({ trialIndex: qIdx, trialTitle: q.title, trialCategory: q.category, ...pr })
        })
      })
      renderFilteredPeerReviews(allReviews)
    })
    el.filterPeerTarget?.addEventListener('change', () => {
      const allReviews = []
      state.currentTournament?.questions?.forEach((q, qIdx) => {
        (q.peerReviews || []).forEach((pr) => {
          allReviews.push({ trialIndex: qIdx, trialTitle: q.title, trialCategory: q.category, ...pr })
        })
      })
      renderFilteredPeerReviews(allReviews)
    })

    // AI Judge
    el.btnRequestJudge?.addEventListener('click', requestTournamentJudge)

    // Sidebar buttons
    el.btnNewChat?.addEventListener('click', () => {
      switchView('chat')
      createNewChat()
    })
    el.btnNewTournament?.addEventListener('click', () => {
      switchView('arena')
      goToTournamentStep(1)
    })

    // Theme toggle
    if (el.themeToggleBtn) {
      el.themeToggleBtn.onclick = () => {
        applyTheme(state.theme === 'dark' ? 'light' : 'dark')
      }
    }

    // Provider select change
    if (el.providerSelect) {
      el.providerSelect.onchange = (e) => {
        state.selectedProvider = e.target.value
        renderModelDropdown()
      }
    }

    // Model select change
    if (el.modelSelect) {
      el.modelSelect.onchange = (e) => {
        state.selectedModel = e.target.value
      }
    }

    // Mode select change
    if (el.modeSelect) {
      el.modeSelect.onchange = (e) => {
        state.executionMode = e.target.value
      }
    }

    // Refresh models button
    if (el.refreshModelsBtn) {
      el.refreshModelsBtn.onclick = async () => {
        el.refreshModelsBtn.style.transform = 'rotate(180deg)'
        await loadModels(true)
        setTimeout(() => { el.refreshModelsBtn.style.transform = 'none' }, 400)
      }
    }

    // Textarea input & keydown
    if (el.chatTextarea) {
      el.chatTextarea.oninput = autoResizeTextarea
      el.chatTextarea.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          if (state.isGenerating) return
          sendMessage()
        }
      }
    }

    // Send / Stop button
    if (el.sendBtn) {
      el.sendBtn.onclick = () => {
        if (state.isGenerating) {
          stopGeneration()
        } else {
          sendMessage()
        }
      }
    }

    // File upload button & input
    if (el.btnUpload && el.fileInput) {
      el.btnUpload.onclick = () => el.fileInput.click()
      el.fileInput.onchange = (e) => {
        handleFilesSelected(e.target.files)
        el.fileInput.value = ''
      }
    }

    // Drag & Drop
    if (el.inputBox) {
      el.inputBox.ondragover = (e) => {
        e.preventDefault()
        el.inputBox.classList.add('drag-over')
      }
      el.inputBox.ondragleave = () => el.inputBox.classList.remove('drag-over')
      el.inputBox.ondrop = (e) => {
        e.preventDefault()
        el.inputBox.classList.remove('drag-over')
        handleFilesSelected(e.dataTransfer.files)
      }
    }

    // Sidebar toggle (mobile)
    if (el.btnSidebarToggle && el.sidebar) {
      el.btnSidebarToggle.onclick = () => el.sidebar.classList.toggle('open')
    }

    // Settings Modal
    if (el.settingsBtn && el.settingsModal) {
      el.settingsBtn.onclick = () => {
        el.inputSystemPrompt.value = state.systemPrompt
        el.inputCwd.value = state.cwd
        el.settingsModal.style.display = 'flex'
      }
    }
    if (el.closeSettingsBtn && el.settingsModal) {
      el.closeSettingsBtn.onclick = () => {
        el.settingsModal.style.display = 'none'
      }
    }
    if (el.saveSettingsBtn && el.settingsModal) {
      el.saveSettingsBtn.onclick = () => {
        state.systemPrompt = el.inputSystemPrompt.value.trim()
        state.cwd = el.inputCwd.value.trim()
        el.settingsModal.style.display = 'none'
      }
    }

    // Suggestion card clicks
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.suggestion-card')
      if (card && card.dataset.prompt) {
        if (el.chatTextarea) {
          el.chatTextarea.value = card.dataset.prompt
          autoResizeTextarea()
          sendMessage()
        }
      }
    })

    // Code copy button clicks
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.copy-code-btn')
      if (btn) {
        const code = btn.dataset.code || btn.closest('.code-container')?.querySelector('code')?.textContent || ''
        if (code) {
          try {
            await navigator.clipboard.writeText(code)
            const origHtml = btn.innerHTML
            btn.innerHTML = '<span>✓ Copied!</span>'
            btn.classList.add('copied')
            setTimeout(() => {
              btn.innerHTML = origHtml
              btn.classList.remove('copied')
            }, 2000)
          } catch (err) {
            console.warn('Clipboard write failed:', err)
          }
        }
      }
    })

    // Keyboard shortcuts: Cmd+K / Ctrl+K for New Chat
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        switchView('chat')
        createNewChat()
      }
    })

    // Auto-discover models when returning to window/tab
    window.addEventListener('focus', () => {
      loadModels(true)
    })

    // Periodic auto-discovery poll every 15 seconds
    setInterval(() => {
      if (!state.isGenerating && !state.isTournamentRunning) {
        loadModels(true)
      }
    }, 15_000)
  }

  // ── App Init ──
  async function init() {
    applyTheme(state.theme)
    initEventListeners()
    await loadModels()
    await loadSessions()

    const firstSessionItem = el.sessionsList?.querySelector('.session-item')
    if (firstSessionItem && firstSessionItem.dataset.id) {
      selectSession(firstSessionItem.dataset.id)
    }
  }

  window.addEventListener('DOMContentLoaded', init)
})()

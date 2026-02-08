/**
 * Органайзер Mini App
 * С обработкой текста через OnlySQ AI API + Supabase
 */

// ===================== CONFIG =====================
const AI_CONFIG = {
    baseUrl: 'https://api.onlysq.ru/ai/openai',
    keys: [
        'sq-Ky6Q5xFOYenbWKG2yZoTCqp8ZuXHhX3q',
        'sq-YQ50CiYt2M229MQBAO3WPfrlUiFhTETH',
        'sq-ta2DwOxK4oeLrQRYLomBGkC4vxxTYJkd'
    ],
    model: 'gpt-4o-mini'
};

// ===================== SUPABASE CONFIG =====================
const SUPABASE_CONFIG = {
    url: 'https://jfeeazsninjzgieeqmnl.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmZWVhenNuaW5qemdpZWVxbW5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1Mzk0OTYsImV4cCI6MjA4NjExNTQ5Nn0.3GW6bUYT7U6LFSv3TKksdcszdGILC752aqZgbmg12Aw'
};

// ===================== TELEGRAM =====================
const tg = window.Telegram?.WebApp;

// ===================== STATE =====================
const state = {
    reminders: [],
    transactions: [],
    settings: {
        notifications: true,
        morningTime: '08:00'
    },
    currentTab: 'reminders',
    reminderFilter: 'active',
    transactionType: 'income',
    dbUserId: null, // ID пользователя в Supabase
    telegramId: null, // Telegram ID
    isRecording: false,
    isProcessingVoice: false,
    recognition: null,
    keyIndex: 0,
    voiceTimeout: null,
    silenceTimeout: null,
    lastSpeechTime: 0
};

// ===================== ELEMENTS =====================
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', async () => {
    initTelegram();
    await initSupabaseUser();
    loadData();
    await syncRemindersFromDB();
    bindEvents();
    render();
    initSpeechRecognition();
});

function initTelegram() {
    if (tg) {
        tg.ready();
        tg.expand();

        // Получаем Telegram ID
        if (tg.initDataUnsafe?.user?.id) {
            state.telegramId = tg.initDataUnsafe.user.id;
        }

        if (tg.themeParams) {
            document.documentElement.style.setProperty(
                '--bg-app',
                tg.themeParams.bg_color || '#0D0D12'
            );
        }
    }
}

// ===================== SUPABASE =====================
async function supabaseRequest(endpoint, options = {}) {
    const url = `${SUPABASE_CONFIG.url}/rest/v1/${endpoint}`;
    const headers = {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': options.prefer || 'return=representation'
    };
    
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        
        if (!response.ok) {
            const error = await response.text();
            console.error('Supabase error:', error);
            return null;
        }
        
        const data = await response.json();
        return data;
    } catch (e) {
        console.error('Supabase request error:', e);
        return null;
    }
}

async function initSupabaseUser() {
    if (!state.telegramId) {
        console.log('No Telegram ID, using local storage only');
        return;
    }
    
    try {
        // Ищем пользователя по telegram_id
        const users = await supabaseRequest(`users?telegram_id=eq.${state.telegramId}&select=id`);
        
        if (users && users.length > 0) {
            state.dbUserId = users[0].id;
            console.log('User found in DB:', state.dbUserId);
        } else {
            console.log('User not found in DB, will use local storage');
        }
    } catch (e) {
        console.error('Error getting user:', e);
    }
}

async function syncRemindersFromDB() {
    if (!state.dbUserId) return;
    
    try {
        const reminders = await supabaseRequest(
            `reminders?user_id=eq.${state.dbUserId}&is_completed=eq.false&select=*&order=remind_at.asc`
        );
        
        if (reminders && reminders.length > 0) {
            state.reminders = reminders.map(r => ({
                id: r.id,
                dbId: r.id,
                topic: r.topic,
                remindAt: r.remind_at,
                repeatType: r.repeat_type,
                isCompleted: r.is_completed,
                createdAt: r.created_at
            }));
            saveData();
            console.log('Synced reminders from DB:', reminders.length);
        }
    } catch (e) {
        console.error('Error syncing reminders:', e);
    }
}

async function saveReminderToDB(reminder) {
    if (!state.dbUserId) {
        console.log('No DB user ID, saving to local only');
        return null;
    }
    
    try {
        const result = await supabaseRequest('reminders', {
            method: 'POST',
            body: {
                user_id: state.dbUserId,
                topic: reminder.topic,
                remind_at: reminder.remindAt,
                repeat_type: reminder.repeatType || 'once',
                is_active: true,
                is_completed: false,
                created_at: new Date().toISOString()
            }
        });
        
        if (result && result.length > 0) {
            console.log('Reminder saved to DB:', result[0].id);
            return result[0];
        }
        return null;
    } catch (e) {
        console.error('Error saving reminder to DB:', e);
        return null;
    }
}

async function deleteReminderFromDB(dbId) {
    if (!dbId) return;
    
    try {
        await supabaseRequest(`reminders?id=eq.${dbId}`, {
            method: 'DELETE',
            prefer: 'return=minimal'
        });
        console.log('Reminder deleted from DB:', dbId);
    } catch (e) {
        console.error('Error deleting reminder from DB:', e);
    }
}

async function completeReminderInDB(dbId, isCompleted) {
    if (!dbId) return;
    
    try {
        await supabaseRequest(`reminders?id=eq.${dbId}`, {
            method: 'PATCH',
            body: { is_completed: isCompleted }
        });
        console.log('Reminder updated in DB:', dbId, 'completed:', isCompleted);
    } catch (e) {
        console.error('Error completing reminder in DB:', e);
    }
}

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        console.log('Speech Recognition не поддерживается');
        const hint = $('voiceHint');
        if (hint) hint.textContent = 'Недоступно';
        return;
    }

    state.recognition = new SpeechRecognition();
    state.recognition.lang = 'ru-RU';
    state.recognition.continuous = true;
    state.recognition.interimResults = true;

    state.recognition.onresult = (event) => {
        // Если уже обрабатываем - игнорируем
        if (state.isProcessingVoice) return;
        
        let transcript = '';
        let isFinal = false;

        for (let i = 0; i < event.results.length; i++) {
            if (event.results[i] && event.results[i][0]) {
                transcript += event.results[i][0].transcript;
                if (event.results[i].isFinal) isFinal = true;
            }
        }

        const el = $('voiceTranscript');
        if (el) el.textContent = transcript;
        
        // Обновляем время последней речи
        state.lastSpeechTime = Date.now();
        
        // Обновляем статус
        const status = $('voiceStatus');
        if (status) status.textContent = 'Слушаю...';
        
        // Сбрасываем таймер тишины
        if (state.silenceTimeout) {
            clearTimeout(state.silenceTimeout);
        }
        
        // Если получили финальный результат и текст достаточно длинный
        if (isFinal && transcript.trim().length > 5) {
            // Ждем паузу в речи (1.5 сек) перед обработкой
            state.silenceTimeout = setTimeout(() => {
                if (!state.isProcessingVoice && state.isRecording) {
                    state.isProcessingVoice = true;
                    stopRecording();
                    processVoiceInput(transcript.trim());
                }
            }, 1500);
        }
    };

    state.recognition.onend = () => {
        if (state.isRecording && !state.isProcessingVoice) {
            const el = $('voiceTranscript');
            const transcript = el ? el.textContent.trim() : '';
            
            if (transcript.length > 5) {
                state.isProcessingVoice = true;
                stopRecording();
                processVoiceInput(transcript);
            } else {
                stopRecording();
            }
        }
    };

    state.recognition.onerror = (event) => {
        console.error('Speech error:', event.error);
        stopRecording();

        if (event.error === 'network') {
            showToast('Нет сети. Используйте текстовый ввод.', 'warning');
        } else if (event.error === 'not-allowed') {
            showToast('Разрешите микрофон', 'error');
        }
    };
}

// Отдельная функция для обработки голосового ввода
async function processVoiceInput(text) {
    if (!text || text.length < 3) {
        state.isProcessingVoice = false;
        return;
    }
    
    await processInput(text);
    state.isProcessingVoice = false;
}

// ===================== DATA =====================
function getStorageKey() {
    // Уникальный ключ для каждого пользователя
    return state.telegramId ? `organizer_data_${state.telegramId}` : 'organizer_data_guest';
}

function loadData() {
    try {
        // Удаляем старые общие данные (от предыдущей версии)
        if (localStorage.getItem('organizer_data')) {
            localStorage.removeItem('organizer_data');
            console.log('Removed old shared data');
        }
        
        // Проверяем, не сменился ли пользователь
        const lastUserId = localStorage.getItem('organizer_last_user');
        const currentUserId = state.telegramId ? String(state.telegramId) : 'guest';
        
        if (lastUserId && lastUserId !== currentUserId) {
            // Пользователь сменился - очищаем старые данные из state
            console.log('User changed from', lastUserId, 'to', currentUserId);
            state.reminders = [];
            state.transactions = [];
            state.settings = {
                notifications: true,
                morningTime: '08:00'
            };
        }
        
        // Сохраняем текущего пользователя
        localStorage.setItem('organizer_last_user', currentUserId);
        
        // Загружаем данные для текущего пользователя
        const storageKey = getStorageKey();
        const saved = localStorage.getItem(storageKey);
        
        if (saved) {
            const data = JSON.parse(saved);
            state.reminders = data.reminders || [];
            state.transactions = data.transactions || [];
            state.settings = { ...state.settings, ...data.settings };
        }

        const notif = $('settingsNotifications');
        const morning = $('settingsMorning');
        if (notif) notif.checked = state.settings.notifications;
        if (morning) morning.value = state.settings.morningTime;
    } catch (e) {
        console.error('Load error:', e);
    }
}

function saveData() {
    try {
        const storageKey = getStorageKey();
        localStorage.setItem(storageKey, JSON.stringify({
            reminders: state.reminders,
            transactions: state.transactions,
            settings: state.settings
        }));
    } catch (e) {
        console.error('Save error:', e);
    }
}

// ===================== EVENTS =====================
function bindEvents() {
    // Voice
    const voiceBtn = $('voiceBtn');
    const voiceCancel = $('voiceCancel');
    if (voiceBtn) voiceBtn.addEventListener('click', toggleVoiceRecording);
    if (voiceCancel) voiceCancel.addEventListener('click', cancelVoiceRecording);

    // Text
    const textBtn = $('textBtn');
    const closeText = $('closeTextSheet');
    const textOverlay = $('textSheetOverlay');
    const sendText = $('sendTextBtn');

    if (textBtn) textBtn.addEventListener('click', () => openSheet('text'));
    if (closeText) closeText.addEventListener('click', () => closeSheet('text'));
    if (textOverlay) textOverlay.addEventListener('click', () => closeSheet('text'));
    if (sendText) sendText.addEventListener('click', sendTextInput);

    // Examples
    $$('.example-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const input = $('textInput');
            if (input) {
                input.value = chip.dataset.text || chip.textContent;
                input.focus();
            }
        });
    });

    // Hide model section (now in admin)
    const modelSection = document.querySelector('.model-section');
    if (modelSection) modelSection.style.display = 'none';

    // Tabs
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Filters
    $$('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.reminderFilter = btn.dataset.filter;
            $$('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderReminders();
        });
    });

    // Finance
    const quickIncome = $('quickIncome');
    const quickExpense = $('quickExpense');
    if (quickIncome) quickIncome.addEventListener('click', () => {
        state.transactionType = 'income';
        const title = $('transactionSheetTitle');
        if (title) title.textContent = 'Добавить доход';
        openSheet('transaction');
    });
    if (quickExpense) quickExpense.addEventListener('click', () => {
        state.transactionType = 'expense';
        const title = $('transactionSheetTitle');
        if (title) title.textContent = 'Добавить расход';
        openSheet('transaction');
    });

    // Transaction sheet
    const closeTrans = $('closeTransactionSheet');
    const transOverlay = $('transactionSheetOverlay');
    const addTrans = $('addTransactionBtn');
    if (closeTrans) closeTrans.addEventListener('click', () => closeSheet('transaction'));
    if (transOverlay) transOverlay.addEventListener('click', () => closeSheet('transaction'));
    if (addTrans) addTrans.addEventListener('click', addTransaction);

    // Settings
    const settingsBtn = $('settingsBtn');
    const closeSettings = $('closeSettingsSheet');
    const settingsOverlay = $('settingsSheetOverlay');
    const notifToggle = $('settingsNotifications');
    const morningInput = $('settingsMorning');
    const clearBtn = $('clearAllData');

    if (settingsBtn) settingsBtn.addEventListener('click', () => openSheet('settings'));
    if (closeSettings) closeSettings.addEventListener('click', () => closeSheet('settings'));
    if (settingsOverlay) settingsOverlay.addEventListener('click', () => closeSheet('settings'));
    if (notifToggle) notifToggle.addEventListener('change', updateSettings);
    if (morningInput) morningInput.addEventListener('change', updateSettings);
    if (clearBtn) clearBtn.addEventListener('click', clearAllData);

    // Reminder sheet
    const closeReminder = $('closeReminderSheet');
    const reminderOverlay = $('reminderSheetOverlay');
    if (closeReminder) closeReminder.addEventListener('click', () => closeSheet('reminder'));
    if (reminderOverlay) reminderOverlay.addEventListener('click', () => closeSheet('reminder'));

    // Enter key
    const textInput = $('textInput');
    if (textInput) {
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTextInput();
            }
        });
    }
}

// ===================== VOICE =====================
function toggleVoiceRecording() {
    if (!state.recognition) {
        showToast('Голосовой ввод недоступен', 'warning');
        return;
    }
    
    // Если уже обрабатываем - игнорируем
    if (state.isProcessingVoice) return;

    if (state.isRecording) {
        const el = $('voiceTranscript');
        const transcript = el ? el.textContent.trim() : '';
        
        // Очищаем таймеры
        if (state.silenceTimeout) clearTimeout(state.silenceTimeout);
        if (state.voiceTimeout) clearTimeout(state.voiceTimeout);
        
        stopRecording();
        
        if (transcript.length > 5) {
            state.isProcessingVoice = true;
            processVoiceInput(transcript);
        }
    } else {
        startRecording();
    }
}

function startRecording() {
    if (!state.recognition) return;
    if (state.isProcessingVoice) return;

    state.isRecording = true;
    state.isProcessingVoice = false;
    state.lastSpeechTime = Date.now();

    const btn = $('voiceBtn');
    const modal = $('voiceModal');
    const status = $('voiceStatus');
    const transcript = $('voiceTranscript');
    const voiceCard = document.querySelector('.voice-card');

    if (btn) btn.classList.add('recording');
    if (voiceCard) voiceCard.classList.add('recording');
    if (modal) modal.classList.add('active');
    if (status) status.textContent = 'Говорите...';
    if (transcript) transcript.textContent = '';

    try {
        state.recognition.start();
    } catch (e) {
        console.error('Recognition start error:', e);
        stopRecording();
        showToast('Не удалось начать запись', 'error');
        return;
    }

    haptic('medium');

    // Максимальное время записи - 15 секунд
    state.voiceTimeout = setTimeout(() => {
        if (state.isRecording && !state.isProcessingVoice) {
            const el = $('voiceTranscript');
            const text = el ? el.textContent.trim() : '';
            
            if (state.silenceTimeout) clearTimeout(state.silenceTimeout);
            stopRecording();
            
            if (text.length > 5) {
                state.isProcessingVoice = true;
                processVoiceInput(text);
            }
        }
    }, 15000);
}

function stopRecording() {
    state.isRecording = false;

    const btn = $('voiceBtn');
    const modal = $('voiceModal');
    const voiceCard = document.querySelector('.voice-card');

    if (btn) btn.classList.remove('recording');
    if (voiceCard) voiceCard.classList.remove('recording');
    if (modal) modal.classList.remove('active');
    
    // Очищаем таймеры
    if (state.voiceTimeout) {
        clearTimeout(state.voiceTimeout);
        state.voiceTimeout = null;
    }
    if (state.silenceTimeout) {
        clearTimeout(state.silenceTimeout);
        state.silenceTimeout = null;
    }

    if (state.recognition) {
        try { state.recognition.stop(); } catch (e) { }
    }
}

function cancelVoiceRecording() {
    state.isProcessingVoice = false;
    if (state.silenceTimeout) clearTimeout(state.silenceTimeout);
    if (state.voiceTimeout) clearTimeout(state.voiceTimeout);
    stopRecording();
    const el = $('voiceTranscript');
    if (el) el.textContent = '';
}

// ===================== AI API =====================
async function callAI(prompt, systemPrompt = '') {
    // Rotate keys
    const key = AI_CONFIG.keys[state.keyIndex];
    state.keyIndex = (state.keyIndex + 1) % AI_CONFIG.keys.length;

    try {
        const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model: AI_CONFIG.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (e) {
        console.error('AI API error:', e);
        return null;
    }
}

async function parseWithAI(text) {
    const now = new Date();
    const systemPrompt = `Ты парсер для органайзера. Анализируй текст и определи:
1. Это напоминание или финансовая операция?
2. Извлеки данные.

Текущее время: ${now.toISOString()}
Дата: ${now.toLocaleDateString('ru-RU')} (${now.toLocaleDateString('ru-RU', { weekday: 'long' })})
Время: ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}

ОТВЕТЬ ТОЛЬКО JSON без markdown:

Для напоминания:
{"type":"reminder","topic":"краткая тема напоминания","datetime":"YYYY-MM-DDTHH:MM:SS+03:00"}

Для финансов:
{"type":"income","amount":число,"description":"описание"}
или
{"type":"expense","amount":число,"description":"описание"}

Если не понял:
{"type":"unknown"}

ВАЖНО: Тема напоминания должна быть краткой и понятной. Например:
- "напомни позвонить маме в 5" → topic: "Позвонить маме"
- "напомни завтра в 9 про встречу" → topic: "Встреча"
- "через час проверить почту" → topic: "Проверить почту"

Правила времени (24-часовой формат):
- "сегодня" = текущая дата
- "завтра" = следующий день
- "утром" = 08:00
- "днём" = 14:00
- "вечером" = 19:00
- "в 5 часов", "в пять" = 17:00 (вечер, если без уточнения)
- "в 5 утра" = 05:00
- "в 9 часов" = 09:00 (утро)
- "в 10" = 10:00
- "в 15" или "в 3 дня" = 15:00
- "через час" = +1 час от сейчас
- "через 30 минут" = +30 минут от сейчас
- Если время не указано явно, ставь 10:00
- Если время с 1 до 6 без уточнения - это PM (13:00-18:00)
- Если время с 7 до 12 без уточнения - это AM

Правила финансов:
- "50к" = 50000
- "зп", "зарплата" = доход
- "потратил", "купил" = расход`;

    const result = await callAI(text, systemPrompt);

    if (!result) return null;

    try {
        // Remove markdown if present
        let clean = result.trim();
        if (clean.startsWith('```')) {
            clean = clean.replace(/```json?\n?/g, '').replace(/```/g, '');
        }
        return JSON.parse(clean);
    } catch (e) {
        console.error('Parse error:', e, result);
        return null;
    }
}

// ===================== PROCESS INPUT =====================
async function processInput(text) {
    if (!text.trim()) return;

    showLoading('AI обрабатывает...');

    // Try AI first
    let result = await parseWithAI(text);

    // Fallback to local parser
    if (!result || result.type === 'unknown') {
        result = parseLocally(text);
    }

    hideLoading();

    if (result.type === 'reminder') {
        await addReminder({
            topic: result.topic || 'Напоминание',
            remindAt: result.datetime || new Date(Date.now() + 3600000).toISOString()
        });
    } else if (result.type === 'income' || result.type === 'expense') {
        addTransactionFromParse({
            type: result.type,
            amount: result.amount || 0,
            description: result.description || (result.type === 'income' ? 'Доход' : 'Расход')
        });
    } else {
        showToast('Не понял. Примеры: "напомни завтра в 9" или "доход 50000"', 'warning');
    }
}

async function sendTextInput() {
    const input = $('textInput');
    const text = input ? input.value.trim() : '';

    if (!text) {
        showToast('Введите текст', 'warning');
        return;
    }

    closeSheet('text');
    await processInput(text);
    if (input) input.value = '';
}

// Локальный fallback парсер
function parseLocally(text) {
    const lower = text.toLowerCase();
    const now = new Date();

    // ФИНАНСЫ
    const isIncome = /доход|зп|зарплата|получил|заработал/i.test(lower);
    const isExpense = /расход|потратил|купил|заплатил/i.test(lower);

    if (isIncome || isExpense) {
        let amount = 0;
        // 50к или 50 к
        const kMatch = text.match(/(\d+)\s*к(?:\s|$|,)/i);
        if (kMatch) {
            amount = parseInt(kMatch[1]) * 1000;
        } else {
            const numMatch = text.match(/(\d+)/);
            if (numMatch) amount = parseInt(numMatch[1]);
        }

        if (amount > 0) {
            return {
                type: isIncome ? 'income' : 'expense',
                amount: amount,
                description: isIncome ? 'Доход' : 'Расход'
            };
        }
    }

    // НАПОМИНАНИЯ
    const hasReminder = /напомни|напоминание|завтра|через|утром|вечером/i.test(lower);
    if (hasReminder) {
        let remindAt = new Date();
        let topic = text;

        // Завтра
        if (lower.includes('завтра')) {
            remindAt.setDate(now.getDate() + 1);
            remindAt.setHours(10, 0, 0, 0);
            topic = topic.replace(/завтра/gi, '');
        }

        // Время: "в 15" или "в 15:30"
        const timeMatch = text.match(/в\s*(\d{1,2})(?::(\d{2}))?/i);
        if (timeMatch) {
            remindAt.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2] || 0), 0, 0);
            topic = topic.replace(timeMatch[0], '');
        }

        // Утром/вечером
        if (lower.includes('утром')) {
            remindAt.setHours(8, 0, 0, 0);
            topic = topic.replace(/утром/gi, '');
        } else if (lower.includes('вечером')) {
            remindAt.setHours(20, 0, 0, 0);
            topic = topic.replace(/вечером/gi, '');
        }

        // Через час
        if (lower.includes('через час')) {
            remindAt = new Date(now.getTime() + 3600000);
            topic = topic.replace(/через\s*час/gi, '');
        }

        // Чистим topic
        topic = topic.replace(/напомни|напоминание|о|про|что/gi, '').trim();
        if (!topic) topic = 'Напоминание';

        // Если в прошлом
        if (remindAt < now) {
            remindAt.setDate(remindAt.getDate() + 1);
        }

        return {
            type: 'reminder',
            topic: topic.charAt(0).toUpperCase() + topic.slice(1),
            datetime: remindAt.toISOString()
        };
    }

    return { type: 'unknown' };
}

// ===================== REMINDERS =====================
async function addReminder(data) {
    const reminder = {
        id: Date.now(),
        topic: data.topic,
        remindAt: data.remindAt,
        repeatType: 'once',
        isCompleted: false,
        createdAt: new Date().toISOString()
    };

    // Сохраняем в Supabase
    const dbResult = await saveReminderToDB(reminder);
    if (dbResult) {
        reminder.dbId = dbResult.id;
        reminder.id = dbResult.id; // Используем ID из базы
    }

    state.reminders.push(reminder);
    saveData();
    render();

    const date = new Date(data.remindAt);
    showToast(`Напомню: ${formatDateTime(date)}`, 'success');
    haptic('success');
}

async function toggleReminder(id) {
    const reminder = state.reminders.find(r => r.id === id || r.dbId === id);
    if (reminder) {
        reminder.isCompleted = !reminder.isCompleted;
        
        // Синхронизируем с БД
        if (reminder.dbId) {
            await completeReminderInDB(reminder.dbId, reminder.isCompleted);
        }
        
        saveData();
        render();
        haptic('light');
    }
}

async function deleteReminder(id) {
    const reminder = state.reminders.find(r => r.id === id || r.dbId === id);
    
    // Удаляем из БД
    if (reminder?.dbId) {
        await deleteReminderFromDB(reminder.dbId);
    }
    
    state.reminders = state.reminders.filter(r => r.id !== id && r.dbId !== id);
    saveData();
    render();
    closeSheet('reminder');
    showToast('Удалено', 'success');
}

function openReminderSheet(id) {
    const reminder = state.reminders.find(r => r.id === id);
    if (!reminder) return;

    const date = new Date(reminder.remindAt);
    const title = $('reminderSheetTitle');
    const content = $('reminderSheetContent');
    const footer = $('reminderSheetFooter');

    if (title) title.textContent = reminder.isCompleted ? 'Выполнено' : 'Напоминание';
    if (content) content.innerHTML = `
        <div class="reminder-detail">
            <div class="detail-row">
                <span class="detail-label">Тема</span>
                <span class="detail-value">${escapeHtml(reminder.topic)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Когда</span>
                <span class="detail-value">${formatDateTime(date)}</span>
            </div>
        </div>
    `;

    if (footer) {
        const reminderId = reminder.id || reminder.dbId;
        footer.innerHTML = reminder.isCompleted ? `
            <button class="btn-primary" onclick="handleToggleReminder(${reminderId})">Восстановить</button>
        ` : `
            <div style="display: flex; gap: 12px;">
                <button class="btn-primary" style="flex:1" onclick="handleToggleReminder(${reminderId})">✓ Готово</button>
                <button class="settings-danger" style="flex:1" onclick="handleDeleteReminder(${reminderId})">Удалить</button>
            </div>
        `;
    }

    openSheet('reminder');
}

// Обертки для async функций
async function handleToggleReminder(id) {
    await toggleReminder(id);
    closeSheet('reminder');
}

async function handleDeleteReminder(id) {
    await deleteReminder(id);
}

window.toggleReminder = toggleReminder;
window.deleteReminder = deleteReminder;
window.handleToggleReminder = handleToggleReminder;
window.handleDeleteReminder = handleDeleteReminder;
window.openReminderSheet = openReminderSheet;
window.closeSheet = closeSheet;

// ===================== TRANSACTIONS =====================
function addTransaction() {
    const amountEl = $('transAmount');
    const descEl = $('transDesc');
    const amount = amountEl ? parseFloat(amountEl.value) : 0;
    const desc = descEl ? descEl.value.trim() : '';

    if (!amount || amount <= 0) {
        showToast('Введите сумму', 'warning');
        return;
    }

    const transaction = {
        id: Date.now(),
        type: state.transactionType,
        amount,
        description: desc || (state.transactionType === 'income' ? 'Доход' : 'Расход'),
        createdAt: new Date().toISOString()
    };

    state.transactions.unshift(transaction);
    saveData();
    render();
    closeSheet('transaction');

    if (amountEl) amountEl.value = '';
    if (descEl) descEl.value = '';

    showToast(state.transactionType === 'income' ? 'Доход +' : 'Расход -', 'success');
    haptic('success');
}

function addTransactionFromParse(data) {
    if (!data.amount || data.amount <= 0) {
        showToast('Не удалось определить сумму', 'warning');
        return;
    }

    const transaction = {
        id: Date.now(),
        type: data.type,
        amount: data.amount,
        description: data.description,
        createdAt: new Date().toISOString()
    };

    state.transactions.unshift(transaction);
    saveData();
    render();

    showToast(`${data.type === 'income' ? '+' : '-'}${formatCurrency(data.amount)}`, 'success');
    haptic('success');
}

// ===================== SETTINGS =====================
function updateSettings() {
    const notif = $('settingsNotifications');
    const morning = $('settingsMorning');
    if (notif) state.settings.notifications = notif.checked;
    if (morning) state.settings.morningTime = morning.value;
    saveData();
}

function clearAllData() {
    if (confirm('Удалить все данные?')) {
        state.reminders = [];
        state.transactions = [];
        localStorage.removeItem('organizer_data');
        render();
        closeSheet('settings');
        showToast('Данные удалены', 'success');
    }
}

// ===================== UI =====================
function switchTab(tab) {
    state.currentTab = tab;
    $$('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    $$('.tab-pane').forEach(pane => pane.classList.toggle('active', pane.id === tab + 'Pane'));
}

function openSheet(type) {
    const overlay = $(`${type}SheetOverlay`);
    const sheet = $(`${type}Sheet`);
    if (overlay) overlay.classList.add('active');
    if (sheet) sheet.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeSheet(type) {
    const overlay = $(`${type}SheetOverlay`);
    const sheet = $(`${type}Sheet`);
    if (overlay) overlay.classList.remove('active');
    if (sheet) sheet.classList.remove('active');
    document.body.style.overflow = '';
}

function showLoading(text = 'Загрузка...') {
    const overlay = $('loadingOverlay');
    const textEl = $('loadingText');
    if (textEl) textEl.textContent = text;
    if (overlay) overlay.classList.add('active');
}

function hideLoading() {
    const overlay = $('loadingOverlay');
    if (overlay) overlay.classList.remove('active');
}

function showToast(message, type = 'info') {
    const container = $('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>',
        error: '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
        info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
    };

    toast.innerHTML = `
        <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icons[type] || icons.info}</svg>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 200);
    }, 3500);
}

function haptic(type) {
    if (tg?.HapticFeedback) {
        try {
            if (['light', 'medium', 'heavy'].includes(type)) {
                tg.HapticFeedback.impactOccurred(type);
            } else {
                tg.HapticFeedback.notificationOccurred(type);
            }
        } catch (e) { }
    }
}

// ===================== RENDER =====================
function render() {
    renderStats();
    renderReminders();
    renderFinance();
}

function renderStats() {
    const now = new Date();
    const today = now.toDateString();

    const active = state.reminders.filter(r => !r.isCompleted);
    const todayReminders = active.filter(r => new Date(r.remindAt).toDateString() === today);
    const done = state.reminders.filter(r => r.isCompleted);

    const statActive = $('statActive');
    const statToday = $('statToday');
    const statDone = $('statDone');

    if (statActive) statActive.textContent = active.length;
    if (statToday) statToday.textContent = todayReminders.length;
    if (statDone) statDone.textContent = done.length;
}

function renderReminders() {
    const filtered = state.reminders
        .filter(r => state.reminderFilter === 'active' ? !r.isCompleted : r.isCompleted)
        .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));

    const list = $('remindersList');
    if (!list) return;

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2"/>
                    </svg>
                </div>
                <p>Нет напоминаний</p>
                <span>Скажи голосом или напиши</span>
            </div>
        `;
        return;
    }

    list.innerHTML = filtered.map(r => {
        const date = new Date(r.remindAt);
        return `
            <div class="reminder-item ${r.isCompleted ? 'completed' : ''}" onclick="openReminderSheet(${r.id})">
                <div class="reminder-check" onclick="event.stopPropagation(); toggleReminder(${r.id})">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                <div class="reminder-content">
                    <div class="reminder-topic">${escapeHtml(r.topic)}</div>
                    <div class="reminder-meta">
                        <svg viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                            <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                        ${formatDateTime(date)}
                    </div>
                </div>
                <svg class="reminder-arrow" viewBox="0 0 24 24" fill="none">
                    <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </div>
        `;
    }).join('');
}

function renderFinance() {
    const income = state.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = state.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = income - expense;

    const balEl = $('balanceValue');
    const incEl = $('totalIncome');
    const expEl = $('totalExpense');

    if (balEl) balEl.textContent = formatCurrency(balance);
    if (incEl) incEl.textContent = formatCurrency(income);
    if (expEl) expEl.textContent = formatCurrency(expense);

    const list = $('transactionsList');
    if (!list) return;

    if (state.transactions.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" stroke-width="2"/>
                    </svg>
                </div>
                <p>Нет операций</p>
                <span>Добавь доход или расход</span>
            </div>
        `;
        return;
    }

    list.innerHTML = state.transactions.slice(0, 20).map(t => {
        const date = new Date(t.createdAt);
        return `
            <div class="transaction-item ${t.type}">
                <div class="transaction-icon">
                    <svg viewBox="0 0 24 24" fill="none">
                        ${t.type === 'income'
                ? '<path d="M23 6l-9.5 9.5-5-5L1 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
                : '<path d="M23 18l-9.5-9.5-5 5L1 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
            }
                    </svg>
                </div>
                <div class="transaction-content">
                    <div class="transaction-desc">${escapeHtml(t.description)}</div>
                    <div class="transaction-date">${formatDate(date)}</div>
                </div>
                <div class="transaction-amount">${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}</div>
            </div>
        `;
    }).join('');
}

// ===================== UTILS =====================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(date) {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Сегодня';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatDateTime(date) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr;
    if (date.toDateString() === now.toDateString()) dayStr = 'Сегодня';
    else if (date.toDateString() === tomorrow.toDateString()) dayStr = 'Завтра';
    else dayStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

    return `${dayStr} в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Add detail styles
const detailStyle = document.createElement('style');
detailStyle.textContent = `
.reminder-detail { padding: 8px 0; }
.detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--glass-border); }
.detail-row:last-child { border-bottom: none; }
.detail-label { color: var(--text-tertiary); font-size: 14px; }
.detail-value { color: var(--text-primary); font-weight: 500; }
`;
document.head.appendChild(detailStyle);

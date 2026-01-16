// --- CONFIG ---
const SKINS = {
    'default': { name: 'Тишка', cost: 0, svg: '' },
    'glasses': { name: 'Крутой', cost: 20000, svg: '<g><circle cx="65" cy="90" r="24" fill="rgba(0,0,0,0.5)" stroke="white" stroke-width="2"/><circle cx="135" cy="90" r="24" fill="rgba(0,0,0,0.5)" stroke="white" stroke-width="2"/><line x1="89" y1="90" x2="111" y2="90" stroke="white" stroke-width="2"/></g>' },
    'crown': { name: 'Король', cost: 50000, svg: '<path d="M70 50 L60 20 L85 40 L100 10 L115 40 L140 20 L130 50 Z" fill="#FFD700" stroke="#DAA520" stroke-width="2" transform="translate(0, -15)"/>' },
    'bow': { name: 'Джентльмен', cost: 15000, svg: '<path d="M80 155 L120 155 L100 165 Z M80 155 L70 170 M120 155 L130 170" fill="#FF0055" stroke="white" stroke-width="1"/>' }
};
const PROMO_CODES = { 'START': 5000, 'MEOW': 2000, 'TISHKA': 10000, 'RICH': 50000, 'DEV_GOD': 999999999 };
const LEAGUES = [{ name: 'Bronze', min: 0 }, { name: 'Silver', min: 5000 }, { name: 'Gold', min: 50000 }, { name: 'Diamond', min: 200000 }, { name: 'Legend', min: 1000000 }];

// --- DEFAULT STATE ---
const defaultState = {
    playerId: null,
    coins: 0, clickPower: 1, autoPower: 0, energy: 1000, maxEnergy: 1000,
    costs: { click: 10, auto: 50, max: 200 }, prestige: 0, multiplier: 1,
    skinsOwned: ['default'], currentSkin: 'default', pets: [],
    stats: { totalClicks: 0, bossesKilled: 0 },
    quests: { lastDay: 0, clicks: 0, opened: 0, claimed: [] },
    lastDate: '', lastSpinDate: '', lastSaveTime: Date.now(), usedPromos: [],
    settings: { master: 100, music: 50, sfx: 100, particles: true },
    daily: { streak: 0, lastClaimTime: 0 },
    boss: { damage: 200, level: 1 },
    factory: { cows: 0, milk: 0, truckLevel: 1, truckMax: 50, lastSaveTime: Date.now() }
};

let state = JSON.parse(JSON.stringify(defaultState));

// MIGRATION checks
if (!state.playerId) state.playerId = crypto.randomUUID();
if (!state.settings) state.settings = { master: 100, music: 50, sfx: 100, particles: true };
if (!state.daily) state.daily = { streak: 0, lastClaimTime: 0 };
if (!state.boss) state.boss = { damage: 200, level: 1 };
if (!state.factory) state.factory = { cows: 0, milk: 0, truckLevel: 1, truckMax: 50, lastSaveTime: Date.now() };

// --- AUDIO ---
let musicPlayer = new Audio('https://cdn.pixabay.com/download/audio/2022/11/22/audio_febc508520.mp3');
musicPlayer.loop = true;

let bossActive = false, bossHP = 0, bossMaxHP = 0, bossTimerInt;
let activeBuffs = { click: 1, auto: 1 };
const audioClick = new Audio('data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAANAAABRAAad3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3b/2Q==');
const audioMeow = new Audio('https://cdn.pixabay.com/download/audio/2022/10/16/audio_13a01f560f.mp3');
const audioWin = new Audio('https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3');

// --- HELPER FUNCTIONS ---
// Добавлена функция форматирования чисел (1.2k, 1M и т.д.)
function format(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return Math.floor(num).toLocaleString();
}

// --- SUPABASE FUNCTIONS ---
async function initGame() {
    let savedId = localStorage.getItem('Tishka_PlayerID');
    if (!savedId) {
        savedId = crypto.randomUUID();
        localStorage.setItem('Tishka_PlayerID', savedId);
        state.playerId = savedId;
        console.log("Новый игрок:", savedId);
        save();
    } else {
        state.playerId = savedId;
        console.log("Вход игрока:", savedId);
        await loadFromSupabase(savedId);
    }
}

async function loadFromSupabase(id) {
    try {
        const { data, error } = await window.supabase
            .from('players')
            .select('*')
            .eq('id', id)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error("Ошибка загрузки:", error);
            return;
        }

        if (data && data.save_data) {
            state = { ...defaultState, ...data.save_data };
            state.playerId = id;
            if (state.settings && window.setVolume) {
                 // Настройки звука применятся в initSettings
            }
            console.log("Прогресс загружен из Supabase!");
        }
    } catch (e) {
        console.error("Сбой сети при загрузке:", e);
    }
    updateUI();
    renderSkins();
    renderPets();
}

async function save() {
    state.lastSaveTime = Date.now();
    localStorage.setItem('TishkaV7_Ult', JSON.stringify(state));

    if (!state.playerId) return;

    const payload = {
        id: state.playerId,
        name: "Игрок " + state.playerId.slice(0, 4),
        score: state.coins,
        save_data: state,
        updated_at: new Date()
    };

    const { error } = await window.supabase
        .from('players')
        .upsert(payload);

    if (error) console.error("Ошибка сохранения в облако:", error);
}

// --- AUDIO SYSTEM ---
const CLICK_POOL_SIZE = 10;
const clickPool = [];
for (let i = 0; i < CLICK_POOL_SIZE; i++) {
    let a = new Audio(audioClick.src);
    clickPool.push(a);
}
let clickPoolIdx = 0;

function playSound(type) {
    if (state.settings.master === 0) return;
    if (navigator.vibrate && state.settings.sfx > 0) {
        if (type === 'click') navigator.vibrate(10);
        if (type === 'crit') navigator.vibrate(50);
        if (type === 'success') navigator.vibrate([30, 50, 30]);
    }

    if (state.settings.sfx > 0) {
        try {
            let vol = getVolume('sfx'); // Используем хелпер или напрямую state
            // Если getVolume нет, берем из state напрямую:
            vol = state.settings.sfx / 100;
            
            if (type === 'click') {
                let s = clickPool[clickPoolIdx];
                s.volume = 0.2 * vol;
                s.currentTime = 0;
                s.play().catch(() => { });
                clickPoolIdx = (clickPoolIdx + 1) % CLICK_POOL_SIZE;
            }
            if (type === 'crit' || type === 'meow') { audioMeow.currentTime = 0; audioMeow.volume = 1 * vol; audioMeow.play().catch(() => { }); }
            if (type === 'success') { audioWin.volume = 0.5 * vol; audioWin.currentTime = 0; audioWin.play().catch(() => { }); }
        } catch (e) { console.error(e); }
    }
}

// Хелпер для громкости
function getVolume(type) {
    return (state.settings[type] || 0) / 100;
}

function updateMusicVolume() {
    musicPlayer.volume = getVolume('music') * 0.5;
    if (musicPlayer.paused && getVolume('music') > 0) musicPlayer.play().catch(e => console.log("Audio autoplay blocked"));
}

window.setVolume = function (type, val) {
    state.settings[type] = parseInt(val);
    if (type === 'music' || type === 'master') updateMusicVolume();
    save();
};

window.toggleParticles = function () {
    state.settings.particles = !state.settings.particles;
    document.getElementById('particles-state').innerText = state.settings.particles ? "ВКЛ" : "ВЫКЛ";
    save();
}

// --- UI UPDATES ---
function updateUI() {
    document.getElementById('h-coins').innerText = format(state.coins);
    document.getElementById('energy-val').innerText = Math.floor(state.energy);
    document.getElementById('max-energy-val').innerText = format(state.maxEnergy);
    document.getElementById('energy-bar').style.width = (state.energy / state.maxEnergy * 100) + '%';
    document.getElementById('btn-click').innerText = `${format(state.costs.click)}💰 (Ур.${state.clickPower})`;
    document.getElementById('btn-auto').innerText = `${format(state.costs.auto)}💰 (+${state.autoPower}/с)`;
    document.getElementById('btn-max').innerText = `${format(state.costs.max)}💰 (Лимит)`;
    document.getElementById('btn-click').disabled = state.coins < state.costs.click;
    document.getElementById('btn-auto').disabled = state.coins < state.costs.auto;
    document.getElementById('btn-max').disabled = state.coins < state.costs.max;
    
    let currentLeague = "Bronze"; 
    for (let l of LEAGUES) if (state.coins >= l.min) currentLeague = l.name;
    document.getElementById('league-disp').innerText = currentLeague + " League";
    
    // Boss Stat Update
    if (document.getElementById('boss-dmg-val')) {
        document.getElementById('boss-dmg-val').innerText = format(state.boss.damage);
        let currentUpgradeCost = 1000 + (state.boss.damage - 200) * 20;
        document.getElementById('btn-upgrade-sword').innerText = `${format(currentUpgradeCost)} 💰`;
        document.getElementById('btn-upgrade-sword').disabled = state.coins < currentUpgradeCost;
    }

    // Factory UI
    if (document.getElementById('factory')) {
        document.getElementById('cow-count').innerText = state.factory.cows;
        document.getElementById('milk-rate').innerText = state.factory.cows > 0 ? `${state.factory.cows}/c` : "0/c";

        let truckPct = (state.factory.milk / state.factory.truckMax) * 100;
        document.getElementById('truck-fill').style.width = truckPct + '%';
        document.getElementById('milk-storage').innerText = Math.floor(state.factory.milk);
        document.getElementById('milk-max').innerText = format(state.factory.truckMax);

        let cowCost = Math.floor(5000 * Math.pow(1.1, state.factory.cows));
        document.getElementById('btn-buy-cow').innerText = `${format(cowCost)} 💰`;
        document.getElementById('btn-buy-cow').disabled = state.coins < cowCost;

        let truckCost = Math.floor(2000 * Math.pow(1.5, state.factory.truckLevel));
        document.getElementById('btn-upgrade-truck').innerText = `${format(truckCost)} 💰`;
        document.getElementById('btn-upgrade-truck').disabled = state.coins < truckCost;

        let milkVal = Math.floor(state.factory.milk * 10);
        document.getElementById('btn-sell-milk').innerText = `ПРОДАТЬ МОЛОКО (+${format(milkVal)} 💰)`;
        document.getElementById('btn-sell-milk').disabled = state.factory.milk < 1;

        let field = document.getElementById('cows-visual');
        if (field.children.length !== state.factory.cows && state.factory.cows < 20) {
            field.innerHTML = '';
            for (let i = 0; i < state.factory.cows; i++) {
                if (i > 15) break;
                field.innerHTML += '<div class="cow-anim">🐄</div>';
            }
            if (state.factory.cows > 15) field.innerHTML += '<div style="font-size:10px; color:#fff;">+еще...</div>';
        }
    }
}

function checkOffline() {
    let now = Date.now();
    let diffSeconds = Math.floor((now - state.lastSaveTime) / 1000);
    let totalEarned = 0;

    if (state.autoPower > 0 && diffSeconds > 60) {
        let earned = Math.min(diffSeconds * state.autoPower, state.autoPower * 43200);
        if (earned > 0) totalEarned += earned;
    }

    let factorySeconds = Math.floor((now - state.lastSaveTime) / 1000);
    if (state.factory.cows > 0 && factorySeconds > 60) {
        let potentialMilk = state.factory.cows * factorySeconds;
        let spaceLeft = state.factory.truckMax - state.factory.milk;
        let actualProduced = Math.min(potentialMilk, spaceLeft);
        if (actualProduced > 0) {
            state.factory.milk += actualProduced;
        }
    }

    if (totalEarned > 0) {
        state.coins += totalEarned;
        document.getElementById('offline-amount').innerText = format(totalEarned);
        openModal('modal-offline');
        save();
    }
}

// --- GAMEPLAY LOOP ---
setInterval(() => {
    let auto = state.autoPower * state.multiplier * activeBuffs.auto;
    if (auto > 0) state.coins += auto;

    if (state.factory.cows > 0 && state.factory.milk < state.factory.truckMax) {
        state.factory.milk += state.factory.cows;
        if (state.factory.milk > state.factory.truckMax) state.factory.milk = state.factory.truckMax;
    }

    if (state.energy < state.maxEnergy) { 
        state.energy += 5; 
        if (state.energy > state.maxEnergy) state.energy = state.maxEnergy; 
    }
    updateUI();
}, 1000);

// --- FACTORY FUNCTIONS ---
window.buyCow = function () {
    let cost = Math.floor(5000 * Math.pow(1.1, state.factory.cows));
    if (state.coins >= cost) {
        state.coins -= cost;
        state.factory.cows++;
        playSound('success');
        updateUI();
        save();
    }
};

window.upgradeTruck = function () {
    let cost = Math.floor(2000 * Math.pow(1.5, state.factory.truckLevel));
    if (state.coins >= cost) {
        state.coins -= cost;
        state.factory.truckLevel++;
        state.factory.truckMax += 50;
        playSound('success');
        updateUI();
        save();
    }
};

window.sellMilk = function () {
    if (state.factory.milk >= 1) {
        let val = Math.floor(state.factory.milk * 10);
        state.coins += val;
        state.factory.milk = 0;
        playSound('success');
        showRewardPopup(val, "Продажа молока");
        updateUI();
        save();
    }
};

// --- SHOP ---
window.switchShopTab = function(id, btn) {
    document.querySelectorAll('.shop-section').forEach(el => el.classList.remove('active'));
    document.getElementById('shop-' + id).classList.add('active');
    document.querySelectorAll('.shop-tab-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
}

window.buy = function(type) {
    let cost = state.costs[type];
    if (state.coins >= cost) {
        state.coins -= cost; state.costs[type] = Math.floor(cost * 1.5);
        if (type === 'click') state.clickPower++;
        if (type === 'auto') state.autoPower++;
        if (type === 'max') state.maxEnergy += 250;
        playSound('success'); updateUI(); save();

        let names = { click: 'Когти', auto: 'Кото-Бот', max: 'Батарейка' };
        document.getElementById('purchase-text').innerText = names[type] + ' улучшено!';
        openModal('modal-purchase');
    }
}

function renderSkins() {
    const container = document.getElementById('skins-grid'); container.innerHTML = '';
    for (let key in SKINS) {
        let skin = SKINS[key]; let isOwned = state.skinsOwned.includes(key);
        let btnText = isOwned ? (state.currentSkin === key ? 'Надето' : 'Надеть') : `${format(skin.cost)}💰`;
        let btnClass = isOwned && state.currentSkin === key ? 'buy-btn equipped' : 'buy-btn';
        container.innerHTML += `<div class="card"><div style="display:flex; align-items:center;"><div class="card-icon">👕</div><div class="card-info"><h4>${skin.name}</h4></div></div><button class="${btnClass}" onclick="buySkin('${key}')">${btnText}</button></div>`;
    }
    if (SKINS[state.currentSkin]) {
        document.getElementById('skin-layer').innerHTML = SKINS[state.currentSkin].svg;
    }
}

window.buySkin = function (key) {
    if (state.skinsOwned.includes(key)) { state.currentSkin = key; }
    else if (state.coins >= SKINS[key].cost) { state.coins -= SKINS[key].cost; state.skinsOwned.push(key); state.currentSkin = key; playSound('success'); }
    renderSkins(); updateUI(); save();
};

function renderPets() {
    const container = document.getElementById('pets-container'); container.innerHTML = '';
    state.pets.forEach((petType, index) => {
        let orbit = document.createElement('div'); orbit.className = 'pet-orbit';
        orbit.style.width = (170 + index * 40) + 'px'; orbit.style.height = orbit.style.width;
        orbit.style.animationDuration = (6 + index * 2) + 's';
        orbit.innerHTML = '<div class="pet-item">🪰</div>';
        container.appendChild(orbit);
    });
}

window.buyPet = function (type, cost) {
    if (state.coins >= cost) {
        state.coins -= cost;
        state.pets.push(type);
        state.autoPower += 5;
        renderPets();
        updateUI();
        save();
        playSound('success');
        document.getElementById('purchase-text').innerText = 'Питомец куплен! +5 авто-кликов';
        openModal('modal-purchase');
    }
};

// --- EVENTS ---
function spawnMouse() {
    let mouse = document.createElement('div'); mouse.innerText = '🐭'; mouse.style.position = 'absolute'; mouse.style.fontSize = '40px'; mouse.style.zIndex = '100'; mouse.style.cursor = 'pointer'; mouse.style.top = (20 + Math.random() * 60) + '%'; mouse.style.animation = 'mouseRun 4s linear forwards';
    mouse.onclick = function () {
        let reward = 500 * (state.autoPower + 10); state.coins += reward;
        spawnText(window.innerWidth / 2, window.innerHeight / 2, `+${format(reward)}`, 'gold'); playSound('success'); mouse.remove();
    };
    document.body.appendChild(mouse); setTimeout(() => { if (mouse.parentNode) mouse.remove(); }, 4000);
}
setInterval(spawnMouse, 45000);

// --- BOSS LOGIC ---
window.startBossCapture = function () {
    let overlay = document.getElementById('transition-overlay');
    overlay.style.opacity = 1;
    playSound('meow'); 
    setTimeout(() => {
        startBoss();
        overlay.style.opacity = 0;
    }, 500);
}

function startBoss() {
    bossMaxHP = state.boss.damage * 50;
    bossHP = bossMaxHP;
    bossActive = true;
    openModal('modal-boss');
    updateBossUI();
}

// !!! ИСПРАВЛЕННАЯ ФУНКЦИЯ КЛИКА !!!
window.clickCoin = function(e) {
    if (state.energy < 1) return;

    let buff = (window.activeBuffs && window.activeBuffs.click) ? window.activeBuffs.click : 1;
    let power = state.clickPower * state.multiplier * buff;

    let isCrit = Math.random() < 0.05;
    if (isCrit) power *= 5;

    state.coins += power; 
    state.energy--; 
    state.stats.totalClicks++; 
    if (state.quests) state.quests.clicks++;

    let x = e ? e.clientX : window.innerWidth / 2;
    let y = e ? e.clientY : window.innerHeight / 2;
    spawnText(x, y, format(power), isCrit ? 'var(--danger)' : 'white', isCrit);
    
    playSound(isCrit ? 'crit' : 'click');
    const circle = document.getElementById('click-circle');
    if (isCrit && circle) { 
        circle.classList.add('shake'); 
        setTimeout(() => circle.classList.remove('shake'), 300); 
    }

    updateUI(); 
    if (window.updateQuests) updateQuests();
};
// !!! ЗДЕСЬ БОЛЬШЕ НЕТ ЛИШНЕГО КОДА !!!

window.hitBoss = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!bossActive) return;

    let dmg = state.boss.damage;
    let isCrit = false;
    if (Math.random() < 0.1) { dmg *= 2; playSound('crit'); isCrit = true; } 
    else playSound('click');

    bossHP -= dmg;
    let x = window.innerWidth / 2 + (Math.random() * 60 - 30);
    let y = window.innerHeight / 2 + (Math.random() * 60 - 30);
    spawnText(x, y, `-${format(dmg)}`, isCrit ? 'red' : '#fff', isCrit);

    updateBossUI();

    if (navigator.vibrate && state.settings.sfx > 0) navigator.vibrate(15);
    if (bossHP <= 0) endBoss(true);
};

window.upgradeBossDamage = function () {
    let cost = 1000 + (state.boss.damage - 200) * 20;
    if (state.coins >= cost) {
        state.coins -= cost;
        state.boss.damage += 50;
        state.boss.level++; 
        playSound('success');
        updateUI();
        save();
    }
}

function updateBossUI() {
    let pct = (bossHP / bossMaxHP) * 100;
    if (pct < 0) pct = 0;
    document.getElementById('boss-hp').style.width = pct + '%';
    if (document.getElementById('boss-hp-text')) {
        document.getElementById('boss-hp-text').innerText = `${Math.ceil(bossHP)} / ${bossMaxHP}`;
    }
}

function endBoss(isWin) {
    clearInterval(bossTimerInt);
    bossActive = false;
    closeModal('modal-boss');

    if (isWin) {
        let reward = 50000 * (state.prestige + 1); 
        state.coins += reward;
        state.stats.bossesKilled++;
        showRewardPopup(reward, "Победа над Боссом!");
    } else {
        alert('Время вышло! Босс слишком силен. Прокачай меч!');
    }
    updateUI();
    save();
}

// --- MINIGAMES & EXTRAS ---
window.openLootbox = function () {
    if (state.coins < 5000) return alert('Нужно 5000 монет');
    state.coins -= 5000; closeModal('modal-lootbox');
    let rand = Math.random(); 
    if (rand < 0.5) { let win = 2500; state.coins += win; showRewardPopup(win, "Лутбокс (Обычный)"); }
    else if (rand < 0.8) { state.maxEnergy += 500; alert("Выпало: +500 Макс. Энергии"); playSound('success'); }
    else { let win = 25000; state.coins += win; showRewardPopup(win, "Лутбокс (ДЖЕКПОТ!)"); }
    updateUI(); save();
};

window.spinWheel = function () {
    let now = new Date().toDateString(); let isFree = state.lastSpinDate !== now; let cost = isFree ? 0 : 1000;
    if (state.coins < cost) return alert('Не хватает монет (1000)');
    state.coins -= cost; state.lastSpinDate = now; updateUI();
    let wheel = document.getElementById('wheel'); let btn = document.getElementById('spin-btn'); btn.disabled = true;
    let randomDeg = Math.floor(1080 + Math.random() * 720);
    wheel.style.transform = `rotate(${randomDeg}deg)`;
    setTimeout(() => {
        let reward = Math.floor(Math.random() * 3000) + 500;
        state.coins += reward;
        showRewardPopup(reward, "Колесо Фортуны");

        wheel.style.transition = 'none'; wheel.style.transform = 'rotate(0deg)';
        setTimeout(() => { wheel.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)'; }, 50);
        btn.disabled = false; document.getElementById('spin-cost-text').innerText = "Стоимость: 1000 монет"; document.getElementById('spin-btn').innerText = "КРУТИТЬ (1000)";
        updateUI(); save();
    }, 4000);
};

window.activatePromo = function () {
    let code = document.getElementById('promo-input').value.trim().toUpperCase();
    if (state.usedPromos.includes(code)) return alert('Код уже использован!');
    if (PROMO_CODES[code]) {
        let reward = PROMO_CODES[code]; state.coins += reward; state.usedPromos.push(code);
        alert(`Успех! +${reward} монет.`); closeModal('modal-promo'); updateUI(); save();
    } else { alert('Неверный код'); }
};

window.doPrestige = function () {
    if (state.coins < 1000000) return alert('Нужно 1.00M монет!');
    if (confirm('Сбросить прогресс ради x2 дохода?')) {
        state.coins = 0; state.clickPower = 1; state.autoPower = 0; state.costs = { click: 10, auto: 50, max: 200 };
        state.prestige++; state.multiplier *= 2; state.pets = []; save(); location.reload();
    }
};

window.useSkill = function (type) {
    if (type === 'catnip') {
        activeBuffs.click = 2; document.body.classList.add('disco-mode'); document.getElementById('skill-1').classList.add('active');
        setTimeout(() => { activeBuffs.click = 1; document.body.classList.remove('disco-mode'); document.getElementById('skill-1').classList.remove('active'); }, 10000);
    }
    if (type === 'zoomies') {
        activeBuffs.auto = 10; document.getElementById('skill-2').classList.add('active');
        setTimeout(() => { activeBuffs.auto = 1; document.getElementById('skill-2').classList.remove('active'); }, 10000);
    }
};

window.claimDaily = function () {
    let now = new Date().toDateString();
    if (state.lastDate !== now) { state.coins += 500; state.lastDate = now; document.getElementById('daily-btn').disabled = true; document.getElementById('daily-btn').innerText = 'ЗАВТРА'; updateUI(); save(); }
};

// --- LEADERBOARD & QUESTS ---
async function renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '<div style="color:white; text-align:center;">Загрузка топа...</div>';

    const { data, error } = await window.supabase
        .from('players')
        .select('name, score')
        .order('score', { ascending: false })
        .limit(10);

    if (error) {
        list.innerHTML = '<div style="color:red;">Ошибка загрузки</div>';
        return;
    }

    list.innerHTML = '';
    data.forEach((player, index) => {
        let isMe = player.name.includes(state.playerId.slice(0, 4));
        list.innerHTML += `
        <div class="leader-row ${isMe ? 'me' : ''}">
            <div class="leader-rank">#${index + 1}</div>
            <div class="leader-name">${player.name || 'Аноним'}</div>
            <div class="leader-score">${format(player.score)}</div>
        </div>`;
    });
}

window.updateQuests = function() {
    let today = new Date().getDay(); 
    if (state.quests.lastDay !== today) state.quests = { lastDay: today, clicks: 0, opened: 0, claimed: [] };
    
    let tasks = [{ id: 1, text: 'Сделать 100 кликов', max: 100, current: state.quests.clicks, reward: 500 }, { id: 2, text: 'Накопить 5,000 монет', max: 5000, current: state.coins, reward: 1000 }];
    let html = '';
    tasks.forEach(task => {
        let isDone = task.current >= task.max; let isClaimed = state.quests.claimed.includes(task.id);
        let btn = isClaimed ? '✅' : (isDone ? `<button class="claim-btn" onclick="claimQuest(${task.id}, ${task.reward})">Забрать</button>` : '🔒');
        html += `<div class="quest-item ${isDone ? 'done' : ''}"><div class="quest-info"><span class="quest-title">${task.text}</span><span class="quest-progress">${Math.min(task.current, task.max)} / ${task.max}</span></div><div>${btn}</div></div>`;
    });
    document.getElementById('quests-list').innerHTML = html;
}
window.claimQuest = function (id, reward) { state.coins += reward; state.quests.claimed.push(id); updateUI(); updateQuests(); };

window.switchTab = function(id, btn) {
    document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');

    let energyBar = document.querySelector('.energy-float-bar');
    let dailyBtn = document.querySelector('.daily-bonus-float');
    if (id === 'game') {
        if (energyBar) energyBar.style.display = 'flex';
        if (dailyBtn) dailyBtn.style.display = 'flex';
    } else {
        if (energyBar) energyBar.style.display = 'none';
        if (dailyBtn) dailyBtn.style.display = 'none';
    }

    if (id === 'top') renderLeaderboard();
    if (id === 'tasks') updateQuests();
}

window.openModal = function(id) { 
    document.getElementById(id).classList.add('open'); 
    if (id === 'modal-settings') document.getElementById('stats-disp').innerText = `Кликов: ${state.stats.totalClicks} | Боссов: ${state.stats.bossesKilled}`; 
    // Хук для клешни
    if (id === 'modal-claw') initClawGame();
}
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); }

const DAILY_REWARDS = [500, 1000, 2500, 5000, 10000, 25000, 100000];

function checkDailyReward() {
    let now = Date.now();
    let diff = now - state.daily.lastClaimTime;
    let hours = diff / (1000 * 60 * 60);

    if (hours > 48) { state.daily.streak = 0; }
    if (hours > 20) {
        openModal('modal-daily');
        renderDailyGrid();
    }
}

function renderDailyGrid() {
    const grid = document.getElementById('daily-grid');
    grid.innerHTML = '';
    let currentStreak = state.daily.streak;
    if (currentStreak > 6) currentStreak = 0;

    for (let i = 0; i < 7; i++) {
        let status = '';
        if (i < currentStreak) status = 'claimed';
        if (i === currentStreak) status = 'active';
        let icon = i === 6 ? '🎁' : '💰';

        grid.innerHTML += `
            <div class="daily-card ${status}">
                <div class="daily-day">День ${i + 1}</div>
                <div class="daily-icon">${icon}</div>
                <span class="daily-reward">${format(DAILY_REWARDS[i])}</span>
            </div>
        `;
    }

    let btn = document.getElementById('claim-daily-btn');
    let diff = Date.now() - state.daily.lastClaimTime;
    let hours = diff / (1000 * 60 * 60);

    if (hours > 20) {
        btn.disabled = false;
        btn.innerText = "ЗАБРАТЬ";
    } else {
        btn.disabled = true;
        let hLeft = Math.floor(24 - hours);
        let mLeft = Math.floor((24 - hours - hLeft) * 60);
        btn.innerText = `Жди ${hLeft}ч ${mLeft}м`;
    }
}

window.claimDailyReward = function () {
    let reward = DAILY_REWARDS[state.daily.streak];
    if (!reward) { state.daily.streak = 0; reward = DAILY_REWARDS[0]; }

    state.coins += reward;
    state.daily.streak++;
    if (state.daily.streak >= 7) state.daily.streak = 0;

    state.daily.lastClaimTime = Date.now();
    closeModal('modal-daily');
    showRewardPopup(reward, `Ежедневный бонус для дня ${state.daily.streak}`);
    updateUI();
    save();
};

function initSettings() {
    document.querySelector('input[oninput*="setVolume(\'master\'"]').value = state.settings.master;
    document.querySelector('input[oninput*="setVolume(\'music\'"]').value = state.settings.music;
    document.querySelector('input[oninput*="setVolume(\'sfx\'"]').value = state.settings.sfx;
    document.getElementById('particles-state').innerText = state.settings.particles ? "ВКЛ" : "ВЫКЛ";

    document.body.addEventListener('click', () => {
        if (musicPlayer.paused && getVolume('music') > 0) updateMusicVolume();
    }, { once: true });
}

function spawnText(x, y, text, color, isCrit) {
    let el = document.createElement('div'); el.className = isCrit ? 'floating-num crit' : 'floating-num'; el.innerText = isCrit ? "CRIT! " + text : text;
    el.style.left = (x - 20) + 'px'; el.style.top = (y - 50) + 'px'; if (color) el.style.color = color; document.body.appendChild(el); setTimeout(() => el.remove(), 800);
    if (state.settings.particles) {
        for (let i = 0; i < 6; i++) {
            let p = document.createElement('div'); p.className = 'particle'; document.body.appendChild(p);
            let angle = Math.random() * 6.28; let speed = 50 + Math.random() * 50;
            p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.setProperty('--tx', `${Math.cos(angle) * speed}px`); p.style.setProperty('--ty', `${Math.sin(angle) * speed}px`);
            setTimeout(() => p.remove(), 600);
        }
    }
}

window.showRewardPopup = function (amount, source) {
    document.getElementById('reward-amount').innerText = format(amount);
    document.getElementById('reward-source').innerText = source || "Награда получена!";
    openModal('modal-reward');
    playSound('success');
    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
}

// --- MINIGAMES INIT ---
// Laser Dot
function spawnLaserDot() {
    if (document.querySelector('.laser-dot')) return; 
    let dot = document.createElement('div'); dot.className = 'laser-dot';
    let maxX = window.innerWidth - 30;
    let maxY = window.innerHeight - 30;
    let x = Math.max(10, Math.floor(Math.random() * maxX));
    let y = Math.max(10, Math.floor(Math.random() * maxY));

    dot.style.left = x + 'px'; dot.style.top = y + 'px';

    dot.onpointerdown = function (e) {
        e.preventDefault(); e.stopPropagation();
        let reward = Math.floor(state.clickPower * 50 + state.autoPower * 10 + 500);
        state.coins += reward;
        spawnText(x, y, `+${format(reward)}`, 'var(--danger)', true);
        playSound('meow');
        if (navigator.vibrate) navigator.vibrate(50);
        dot.remove();
        updateUI();
    };
    document.body.appendChild(dot);
    setTimeout(() => { if (dot.parentNode) dot.remove(); }, 1500 + Math.random() * 1500);
}
setInterval(spawnLaserDot, 30000); // Лазер появляется раз в 30 сек

// Claw Machine
let clawItems = [];
const CLAW_COST = 5000;

function initClawGame() {
    const prizeArea = document.getElementById('claw-prizes');
    prizeArea.innerHTML = ''; clawItems = [];
    const prizes = [
        { type: 'coin', val: 2000, icon: '💰', class: '' },
        { type: 'coin', val: 5000, icon: '💰', class: '' },
        { type: 'trash', val: 0, icon: '🦴', class: 'trash' },
        { type: 'coin', val: 10000, icon: '💎', class: '' },
        { type: 'box', val: 0, icon: '🎁', class: 'rare' }
    ];

    prizes.forEach((p, i) => {
        let el = document.createElement('div');
        el.className = 'claw-prize ' + p.class;
        el.innerText = p.icon;
        let left = (i * 18) + Math.random() * 5 + '%';
        el.style.left = left;
        el.style.position = 'absolute';
        prizeArea.appendChild(el);
        clawItems.push({
            el: el, type: p.type, val: p.val, center: (i * 18) + 10 
        });
    });

    document.getElementById('claw-arm').classList.add('claw-moving');
    document.getElementById('claw-btn').disabled = false;
}

window.dropClaw = function () {
    if (state.coins < CLAW_COST) return alert(`Нужно ${CLAW_COST} монет!`);
    state.coins -= CLAW_COST; updateUI();

    const arm = document.getElementById('claw-arm');
    const btn = document.getElementById('claw-btn');

    btn.disabled = true;
    const computedStyle = window.getComputedStyle(arm);
    const currentLeft = computedStyle.left;
    arm.classList.remove('claw-moving');
    arm.style.left = currentLeft;
    arm.style.height = '200px';

    setTimeout(() => {
        let containerWidth = document.querySelector('.claw-machine-container').offsetWidth;
        let armLeftPx = parseFloat(currentLeft);
        let armCenterPct = (armLeftPx / containerWidth) * 100;

        let caughtItem = null;
        for (let item of clawItems) {
            if (Math.abs(armCenterPct - item.center) < 8) {
                caughtItem = item;
                break;
            }
        }
        arm.style.height = '30px';

        setTimeout(() => {
            if (caughtItem) {
                if (caughtItem.type === 'coin') {
                    state.coins += caughtItem.val;
                    showRewardPopup(caughtItem.val, "Кран-машина");
                } else if (caughtItem.type === 'trash') {
                    alert('Вы вытащили мусор! (Рыбья кость)');
                } else if (caughtItem.type === 'box') {
                    let skinKeys = Object.keys(SKINS);
                    let unowned = skinKeys.filter(k => !state.skinsOwned.includes(k));
                    if (unowned.length > 0 && Math.random() < 0.3) {
                        let newSkin = unowned[Math.floor(Math.random() * unowned.length)];
                        state.skinsOwned.push(newSkin);
                        alert(`Джекпот! Скин: ${SKINS[newSkin].name}`);
                        playSound('success');
                    } else {
                        state.coins += 25000;
                        showRewardPopup(25000, "Кран (Секретный ящик)");
                    }
                }
            } else {
                alert('Ничего не поймал!');
            }

            updateUI(); save();
            arm.style.left = '';
            arm.classList.add('claw-moving');
            btn.disabled = false;
        }, 600);
    }, 600);
};

// --- INITIALIZATION ---
initGame();
initSettings();
checkOffline();
checkDailyReward();
renderSkins();
renderPets();
updateUI();
if (state.lastDate === new Date().toDateString()) { 
    if(document.getElementById('daily-btn')) {
        document.getElementById('daily-btn').disabled = true; 
        document.getElementById('daily-btn').innerText = 'ЗАВТРА'; 
    }
}
setInterval(save, 10000);
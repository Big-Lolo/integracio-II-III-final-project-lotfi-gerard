let device;
let server;
let rxChar;
let txChar;

const SERVICE_UUID = "61177eae-e391-11ed-b5ea-0242ac120000";
const RX_UUID = "61177eae-e391-11ed-b5ea-0242ac120003";
const TX_UUID = "61177eae-e391-11ed-b5ea-0242ac120003";

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addBtn = document.getElementById("addBtn");
const itemInput = document.getElementById("itemInput");
const ledIndicator = document.getElementById("led-indicator");
const statusText = document.getElementById("connection-status-text");
const listContainer = document.getElementById("list");
const emptyState = document.getElementById("empty-state");
const installAppBtn = document.getElementById("installAppBtn");

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
addBtn.addEventListener("click", addItem);
itemInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") addItem();
});

// Load cached list on startup
window.addEventListener('DOMContentLoaded', () => {
    const cachedData = localStorage.getItem('listData');
    if (cachedData) {
        renderList(cachedData);
    }
});

// PWA Install Prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installAppBtn.classList.remove('hidden');
});

installAppBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installAppBtn.classList.add('hidden');
        }
        deferredPrompt = null;
    }
});

function showToast(msg, type = 'info') {
    const container = document.getElementById("notifications-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    let icon = "ℹ️";
    if (type === 'success') icon = "✅";
    if (type === 'error') icon = "❌";

    toast.innerHTML = `<span>${icon} &nbsp; ${msg}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = "slideUp 0.3s ease-in reverse forwards";
        setTimeout(() => toast.remove(), 300);
    }, 4000); // Increased time slightly to read errors
}

let intentionalDisconnect = false;

function updateConnectionState(connected, errorMsg = null) {
    if (connected) {
        connectBtn.classList.add("hidden");
        disconnectBtn.classList.remove("hidden");
        ledIndicator.className = "w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]";
        statusText.innerText = "Conectado";
        showToast("Conectado a STM32", "success");
        intentionalDisconnect = false;
    } else {
        connectBtn.classList.remove("hidden");
        disconnectBtn.classList.add("hidden");
        ledIndicator.className = "w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]";
        statusText.innerText = "Desconectado";

        if (errorMsg) {
            showToast(`Error: ${errorMsg}`, "error");
        } else if (!intentionalDisconnect) {
            showToast("Desconexión inesperada (¿Fuera de rango o sin batería?)", "error");
        } else {
            showToast("Desconectado manualmente", "info");
        }

        // DO NOT DELETE THE LIST UPON DISCONNECTION
        // So that it can be used offline in the supermarket

        intentionalDisconnect = false;
    }
}

async function connect() {
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: "Shopping" }],
            optionalServices: [SERVICE_UUID]
        });

        device.addEventListener('gattserverdisconnected', onDisconnected);

        server = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);

        rxChar = await service.getCharacteristic(RX_UUID);
        txChar = await service.getCharacteristic(TX_UUID);

        await txChar.startNotifications();

        txChar.addEventListener("characteristicvaluechanged", (e) => {
            const value = new TextDecoder().decode(e.target.value);
            console.log("STM32:", value);
            renderList(value);
        });

        updateConnectionState(true);

        // Send current time
        await sendCurrentTime();

        // Synchronize checked items (send them as 0)
        await syncCheckedItems();
    } catch (err) {
        console.error(err);
        if (err.name !== 'NotFoundError') {
            showToast(`Fallo al conectar: ${err.message || err.name}`, "error");
        }
    }
}

function onDisconnected(event) {
    updateConnectionState(false);
}

async function sendCurrentTime() {
    const now = new Date();
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const mo = (now.getMonth() + 1).toString().padStart(2, '0');
    const yy = now.getFullYear().toString().slice(-2);
    
    const cmd = `TIME|${hh}:${mm}|${dd}/${mo}/${yy}`;
    await sendCommand(cmd);
    
    // Short pause to avoid saturating the BLE buffer
    await new Promise(r => setTimeout(r, 150));
}

async function syncCheckedItems() {
    let checkedItems = JSON.parse(localStorage.getItem('checkedItems') || '[]');
    let listData = localStorage.getItem('listData');

    if (checkedItems.length === 0 || !listData) return;

    showToast("Sincronizando compras...", "info");

    const items = listData.split(";");
    let itemsToClear = [];

    items.forEach(line => {
        if (!line) return;
        const [name, qty] = line.split(",");
        if (checkedItems.includes(name)) {
            itemsToClear.push({ name, qty: parseInt(qty, 10) });
        }
    });

    for (let item of itemsToClear) {
        await sendCommand(`RMV|${item.name}`);
        // Short pause to avoid saturating the BLE buffer
        await new Promise(r => setTimeout(r, 150));
    }

    // Once synchronized, we clear the local checked items list
    localStorage.removeItem('checkedItems');
    showToast("Sincronización completada", "success");
}

function disconnect() {
    if (device && device.gatt.connected) {
        intentionalDisconnect = true;
        device.gatt.disconnect();
    }
}

async function addItem() {
    const name = itemInput.value.trim();
    if (!name) return;

    sendCommand(`ADD|${name}`);
    itemInput.value = "";
    showToast(`Enviando: ${name}...`, "info");
}

window.modifyItem = function (name, currentQty, action) {
    if (action === 'ADD') {
        sendCommand(`ADD|${name}`); // The STM32 firmware increments by default if no quantity is provided
    } else if (action === 'SUB') {
        let newQty = Math.max(0, currentQty - 1);
        sendCommand(`ADD|${name}|${newQty}`);
    }
}

window.toggleItem = function (name, btn) {
    const span = btn.nextElementSibling;
    const icon = btn.querySelector('svg');

    let checkedItems = JSON.parse(localStorage.getItem('checkedItems') || '[]');

    if (checkedItems.includes(name)) {
        // Uncheck
        checkedItems = checkedItems.filter(i => i !== name);
        span.classList.remove('line-through', 'text-slate-500');
        icon.classList.add('hidden');
        btn.classList.remove('bg-emerald-500/20', 'border-emerald-500/50');
    } else {
        // Check
        checkedItems.push(name);
        span.classList.add('line-through', 'text-slate-500');
        icon.classList.remove('hidden');
        btn.classList.add('bg-emerald-500/20', 'border-emerald-500/50');
    }

    localStorage.setItem('checkedItems', JSON.stringify(checkedItems));
}

async function sendCommand(cmd) {
    if (!rxChar) {
        showToast("No conectado", "error");
        return;
    }

    try {
        await rxChar.writeValue(new TextEncoder().encode(cmd));
    } catch (err) {
        console.error("Error al enviar", err);
        showToast(`Fallo al enviar: ${err.message || err.name}`, "error");
    }
}

function renderList(data) {
    listContainer.innerHTML = "";

    if (!data || data.trim() === "") {
        emptyState.classList.remove("hidden");
        return;
    }

    localStorage.setItem('listData', data);
    let checkedItems = JSON.parse(localStorage.getItem('checkedItems') || '[]');

    emptyState.classList.add("hidden");
    const items = data.split(";");

    items.forEach(line => {
        if (!line) return;
        const [name, qty] = line.split(",");

        const isChecked = checkedItems.includes(name);

        const el = document.createElement("div");
        el.className = "bg-white/5 border border-white/10 p-3 rounded-xl shadow-sm flex items-center justify-between group transition-all hover:bg-white/10";

        el.innerHTML = `
            <div class="flex items-center gap-3 cursor-pointer" onclick="toggleItem('${name}', this.querySelector('button'))">
                <button class="w-6 h-6 rounded-md border-2 border-white/30 flex items-center justify-center transition-colors ${isChecked ? 'bg-emerald-500/20 border-emerald-500/50' : ''}">
                    <svg class="w-4 h-4 text-emerald-400 ${isChecked ? '' : 'hidden'}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
                <span class="text-white font-medium select-none transition-all ${isChecked ? 'line-through text-slate-500' : ''}">${name}</span>
            </div>
            <div class="flex items-center gap-3">
                <button onclick="modifyItem('${name}', parseInt(${qty}), 'SUB'); event.stopPropagation();" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <span class="text-lg font-bold text-blue-400 w-6 text-center">${qty}</span>
                <button onclick="modifyItem('${name}', parseInt(${qty}), 'ADD'); event.stopPropagation();" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
            </div>
        `;

        listContainer.appendChild(el);
    });
}
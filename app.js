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
    }, 3000);
}

function updateConnectionState(connected) {
    if (connected) {
        connectBtn.classList.add("hidden");
        disconnectBtn.classList.remove("hidden");
        ledIndicator.className = "w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]";
        statusText.innerText = "Conectado";
        showToast("Conectado a STM32", "success");
    } else {
        connectBtn.classList.remove("hidden");
        disconnectBtn.classList.add("hidden");
        ledIndicator.className = "w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]";
        statusText.innerText = "Desconectado";
        showToast("STM32 Desconectado", "error");
        
        // Clear list on disconnect
        listContainer.innerHTML = "";
        emptyState.classList.remove("hidden");
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
    } catch (err) {
        console.error(err);
        if (err.name !== 'NotFoundError') {
            showToast("Error de conexión", "error");
        }
    }
}

function onDisconnected() {
    updateConnectionState(false);
}

function disconnect() {
    if (device && device.gatt.connected) {
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

window.modifyItem = function(name, action) {
    sendCommand(`${action}|${name}`);
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
        showToast("Error al enviar comando", "error");
    }
}

function renderList(data) {
    listContainer.innerHTML = "";

    if (!data || data.trim() === "") {
        emptyState.classList.remove("hidden");
        return;
    }
    
    emptyState.classList.add("hidden");
    const items = data.split(";");

    items.forEach(line => {
        if (!line) return;
        const [name, qty] = line.split(",");

        const el = document.createElement("div");
        el.className = "bg-white/5 border border-white/10 p-3 rounded-xl shadow-sm flex items-center justify-between group transition-all hover:bg-white/10";

        el.innerHTML = `
            <span class="text-white font-medium pl-2">${name}</span>
            <div class="flex items-center gap-3">
                <button onclick="modifyItem('${name}', 'SUB')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                <span class="text-lg font-bold text-blue-400 w-6 text-center">${qty}</span>
                <button onclick="modifyItem('${name}', 'ADD')" class="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
            </div>
        `;

        listContainer.appendChild(el);
    });
}
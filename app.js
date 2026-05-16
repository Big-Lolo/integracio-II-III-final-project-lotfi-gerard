let device;
let server;
let rxChar;
let txChar;

const SERVICE_UUID = "12345678-1234-1234-1234-123456789abc";
const RX_UUID = "87654321-4321-4321-4321-cba987654321";
const TX_UUID = "abcdef12-3456-7890-abcd-ef1234567890";

document.getElementById("connectBtn").addEventListener("click", connect);
document.getElementById("addBtn").addEventListener("click", addItem);

async function connect() {
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: "Shopping" }],
            optionalServices: [SERVICE_UUID]
        });

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

        console.log("Conectado");
    } catch (err) {
        console.error(err);
    }
}

async function addItem() {
    const input = document.getElementById("itemInput");
    const name = input.value.trim();
    if (!name) return;

    sendCommand(`ADD|${name}`);
    input.value = "";
}

async function sendCommand(cmd) {
    if (!rxChar) return;

    await rxChar.writeValue(
        new TextEncoder().encode(cmd)
    );
}

function renderList(data) {
    const list = document.getElementById("list");

    // STM32 puede mandar "Leche,2;Pan,1"
    list.innerHTML = "";

    if (!data) return;

    const items = data.split(";");

    items.forEach(line => {
        const [name, qty] = line.split(",");

        const el = document.createElement("div");
        el.className = "bg-white p-3 rounded-lg shadow flex justify-between";

        el.innerHTML = `
      <span>${name}</span>
      <span class="font-bold">${qty}</span>
    `;

        list.appendChild(el);
    });
}
let genuid = () => {
    return [...Array(16)].reduce(a => a + Math.random().toString(36)[2], '')
};

const EPOCH = genuid();

let resolveReady;
let ready = new Promise(r => { resolveReady = r; });
let connected = false;

self.onmessage = e => {
    const msg = e.data;
    if (msg.type === "beat") {
		e.source.postMessage({ type: "beat", epoch: EPOCH });
    } else if (msg.type === "port") {
		console.log("OFFSCREEN CONNECTED");
		connected = true;
		resolveReady(msg.port);
    }
};

async function createOffscreen() {
    const offscreenUrl = chrome.runtime.getURL("/offscreen.html");
    const existing = await chrome.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
		documentUrls: [offscreenUrl],
    });
    if (!existing.length) {
		chrome.offscreen.createDocument({ url: offscreenUrl, reasons: ["WORKERS"], justification: "polyfilling workers" });
		console.log("OFFSCREEN CREATED");
    } else {
		console.log("OFFSCREEN ALIVE");
    }
}

const PING_INTERVAL = 100;
const PING_TIMEOUT = 5000;

async function pingOffscreen() {
    const offscreenUrl = chrome.runtime.getURL("/offscreen.html");
    for (let elapsed = 0; !connected && elapsed < PING_TIMEOUT; elapsed += PING_INTERVAL) {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
            if (client.url !== offscreenUrl) { continue; }
            try { client.postMessage({ type: "beat", epoch: EPOCH }); } catch {}
        }
        await new Promise(r => setTimeout(r, PING_INTERVAL));
    }
}

async function start() {
    await createOffscreen();
    await pingOffscreen();
}
start();

class Worker extends EventTarget {
    build(port, args) {
        let { port1, port2 } = new MessageChannel();
		port.postMessage({ type: "worker", args, port: port2, id: this.id, }, [port2]);

		this.port = port1;
		port1.onmessage = e => {
		    if (this.onmessage)
				this.onmessage(e);
			this.dispatchEvent(new MessageEvent("message", { data: e.data }));
		};

		for (let x of this.backlog.splice(0, this.backlog.length)) {
			this.port.postMessage(...x);
		}
		port1.start();
    }

    backlog = [];
    id = genuid();

    constructor(...args) {
        super();

		console.log("WORKER CONSTRUCTOR");

		if (ready instanceof Promise) {
			ready.then(port => {
			    ready = port;
				console.log("WORKER CONSTRUCTOR READY");
				this.build(port, args);
			});
		} else {
			this.build(ready, args);
		}
    }

    postMessage(...args) {
        if (this.port) {
			this.port.postMessage(...args);
        } else {
			this.backlog.push(args);
        }
    }

    terminate() {
        if (!this.port) throw new Error("guh");

		ready.postMessage({
			type: "workerKill",
			id: this.id
		})
    }
}
globalThis.Worker = Worker;

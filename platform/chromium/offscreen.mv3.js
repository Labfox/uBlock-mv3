let activeWorkers = null;

function handlePort() {
    let { port1: port, port2 } = new MessageChannel();

    if (activeWorkers) {
        for (let w of activeWorkers.values()) { try { w.terminate(); } catch {} }
    }
    let workerMap = new Map();
    activeWorkers = workerMap;

    port.onmessage = e => {
        if (e.data.type === "worker") {
            let wport = e.data.port;
            let worker = new Worker(...e.data.args);
            worker.onmessage = e => { wport.postMessage(e.data) };
            wport.onmessage = e => { worker.postMessage(e.data) };
			console.log("OWORKER CREATED", e.data.id);
			wport.start();

			workerMap.set(e.data.id, worker);
        } else if (e.data.type === "workerKill") {
			workerMap.get(e.data.id)?.terminate();
			workerMap.delete(e.data.id);
			console.log("OWORKER DEAD", e.data.id);
        }
    };
	port.start();

	return port2;
}

const BEAT_INTERVAL = 20000;

async function setup() {
	console.log("OWORKER SETUP");
	let sw = (await navigator.serviceWorker.ready).active;
	let epoch = null;
	let lastReply = performance.now();

	function handshake() {
	    let port2 = handlePort();
		sw.postMessage({ type: "port", port: port2 }, [port2]);
		console.log("OWORKER CONTACTED", epoch);
	}

	navigator.serviceWorker.onmessage = e => {
	    if (e.data.type !== "beat") { return; }
	    lastReply = performance.now();
	    if (epoch === null || e.data.epoch !== epoch) {
	        if (epoch !== null) { console.log("OWORKER SW RESTARTED"); }
	        epoch = e.data.epoch;
	        handshake();
	    }
	};

	while (true) {
	    if (performance.now() - lastReply > BEAT_INTERVAL * 2.5) {
			console.log("OWORKER NO REPLY");
			try { sw = (await navigator.serviceWorker.ready).active; } catch {}
			epoch = null;
			lastReply = performance.now();
	    }
	    try { sw.postMessage({ type: "beat" }); } catch {}
	    await new Promise(r => setTimeout(r, BEAT_INTERVAL));
	}
}
await setup();

class HTMLDocument {
    currentScript = {
        src: chrome.runtime.getURL("/js/background.sw.js"),
    }
    title = "uBlock Origin Background Page";

    createElement() {
        throw new TypeError("HTMLDocument.createElement is not implemented");
    }
}

globalThis.HTMLDocument = HTMLDocument;
globalThis.Element = class { };
globalThis.document = new HTMLDocument();
globalThis.window = globalThis;

chrome.browserAction = chrome.action;
let oldSetIcon = chrome.browserAction.setIcon;
chrome.browserAction.setIcon = (...args) => {
    if (args[0].path) {
        args[0].path = Object.fromEntries(Object.entries(args[0].path).map(([a, b]) => [a, "/" + b]));
    }
    oldSetIcon(...args);
}

globalThis.requestIdleCallback =
	function(cb) {
	    var start = Date.now();
	    return setTimeout(function() {
	        cb({
				didTimeout: false,
				timeRemaining: function() {
				    return Math.max(0, 50 - (Date.now() - start));
				},
	        });
	    }, 1);
	};
globalThis.cancelIdleCallback =
	function(id) {
	    clearTimeout(id);
	};

chrome.tabs.executeScript = (id, details, cb) => {
    let target = { tabId: id };
    if (typeof details.frameId === "number") target.frameIds = [details.frameId];

    if (details.file && typeof details.file === "string") {
        chrome.scripting.executeScript({ target, files: [details.file], injectImmediately: true }).then(cb);
    } else if (details.code && typeof details.code === "string") {
        // vAPI.scriptletsInjector marks the end of the main-world payload
        // with a NUL; anything after it belongs to the isolated world. When
        // there is no NUL at all, the whole payload is isolated-world code.
        let isolatedWorld = details.code;
        const nulPos = details.code.indexOf("\0");
        if (nulPos !== -1) {
            const mainWorld = details.code.slice(0, nulPos);
            isolatedWorld = details.code.slice(nulPos + 1);
            chrome.userScripts.execute({ target, js: [{ code: mainWorld }], injectImmediately: true, world: "MAIN" });
        }
        if (isolatedWorld === "") {
            Promise.resolve().then(cb);
            return;
        }
        chrome.userScripts.execute({ target, js: [{ code: isolatedWorld }], injectImmediately: true }).then(cb);
    } else {
        console.error(id, details);
        throw new Error("tabs.executeScript: neither file nor code");
    }
}
chrome.tabs.insertCSS = (id, details, cb) => {
    let target = { tabId: id };
    if (typeof details.frameId === "number") target.frameIds = [details.frameId];

    // vAPI.tabs.insertCSS only sets cssOrigin when the browser flavor was
    // detected as supporting user stylesheets; fall back to the CSS origin
    // chrome.scripting itself defaults to rather than throwing.
    const origin = typeof details.cssOrigin === "string"
        ? details.cssOrigin.toUpperCase()
        : "AUTHOR";
    chrome.scripting.insertCSS({ target, css: details.code, origin }).then(cb);
}

self.browser = self.chrome;

function checkUserScripts() {
    try {
		chrome.userScripts.getScripts();
		return true;
    } catch {
        return false;
    }
}

globalThis.__ubo_preinit = async () => {
    while (!checkUserScripts()) {
        chrome.browserAction.setBadgeText({ text: "!" });
        chrome.browserAction.setBadgeBackgroundColor({
            color: "#FC0",
        });
        await new Promise(r=>setTimeout(r, 1000 * 60 * 5));
    }
    globalThis.__ubo_hasUserScripts = true;
}

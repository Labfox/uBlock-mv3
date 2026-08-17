// gemini'd. sorry
globalThis.XMLHttpRequest = class {
    constructor() {
        this._listeners = {
			load: [],
			error: [],
			abort: [],
			progress: []
        };
        this.readyState = 0; // UNSENT
        this.status = 0;
        this.statusText = '';
        this.response = null;
        this.responseType = 'text';
        this._method = '';
        this._url = '';
        this._async = true;
        this._aborted = false;
        this._controller = null; // For AbortController
    }

    _dispatchEvent(type, event) {
		this._listeners[type].forEach(listener => listener.call(this, event));
    }

    addEventListener(type, listener) {
        if (this._listeners[type]) {
			this._listeners[type].push(listener);
        }
    }

    removeEventListener(type, listener) {
        if (this._listeners[type]) {
            this._listeners[type] = this._listeners[type].filter(l => l !== listener);
        }
    }

    open(method, url, async = true) {
        this._method = method.toUpperCase();
        this._url = url;
        this._async = async;
        this.readyState = 1; // OPENED
    }

    send(body = null) {
        this._aborted = false;
        this._controller = new AbortController();
        const signal = this._controller.signal;

        // readyState is 1 (OPENED) after open(), no initial progress event here.
        // Progress events will be dispatched as data arrives from the stream.

        const fetchOptions = {
			method: this._method,
			signal: signal
        };

        if (body) {
            fetchOptions.body = body;
        }

		fetch(this._url, fetchOptions)
			.then(response => {
			    if (this._aborted) return;

			    this.status = response.status;
			    this.statusText = response.statusText;

			    if (!response.ok) {
			        // For non-OK responses, still try to get text for statusText
			        return response.text().then(errorText => {
			            this.response = errorText;
			            throw new Error(`HTTP error! status: ${response.status}`);
			        });
			    }

			    // Handle progress for successful responses using ReadableStream
			    const contentLength = response.headers.get('Content-Length');
			    const total = contentLength ? parseInt(contentLength, 10) : 0;
			    let loaded = 0;
			    const chunks = [];

			    if (response.body) {
			        const reader = response.body.getReader();
			        return new Promise((resolveStream, rejectStream) => {
			            const read = () => {
							reader.read().then(({ done, value }) => {
							    if (this._aborted) {
									reader.cancel(); // Cancel the stream if aborted
									rejectStream(new DOMException('Aborted', 'AbortError'));
									return;
							    }

							    if (done) {
							        // All data received
							        resolveStream(new Blob(chunks)); // Resolve with a Blob containing all chunks
							        return;
							    }

								chunks.push(value);
								loaded += value.length;
								// Dispatch progress event
								this._dispatchEvent('progress', {
									loaded: loaded,
									total: total,
									lengthComputable: total > 0
								});
								read(); // Read next chunk
							}).catch(error => {
							    rejectStream(error);
							});
			            };
			            read(); // Start reading the stream
			        });
			    } else {
			        // No body (e.g., HEAD request or empty response)
			        return Promise.resolve(new Blob([]));
			    }
			})
			.then(blob => {
			    if (this._aborted) return;

			    // Convert blob content to desired responseType
			    if (this.responseType === 'json') {
			        return blob.text().then(text => {
			            try {
			                this.response = JSON.parse(text);
			            } catch (e) {
			                // If JSON parsing fails, store text and throw error
			                this.response = text;
			                throw new Error('JSON parsing error: ' + e.message);
			            }
			        });
			    } else { // 'text' or default
			        return blob.text().then(text => {
			            this.response = text;
			        });
			    }
			})
			.then(() => {
			    if (this._aborted) return;

			    this.readyState = 4; // DONE
				this._dispatchEvent('load');
			})
			.catch(error => {
			    if (this._aborted) return;

			    this.readyState = 4; // DONE
			    if (error.name === 'AbortError') {
					this._dispatchEvent('abort');
			    } else {
					this._dispatchEvent('error');
			    }
			});
    }

    abort() {
        if (this._controller) {
            this._aborted = true;
			this._controller.abort();
        }
    }
} 


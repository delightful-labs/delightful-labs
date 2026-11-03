// Test preloader: successful inspection must not depend on HTTP, TCP or fetch.
import { Socket } from 'node:net'
import http from 'node:http'
import https from 'node:https'
/** @returns {never} */
function forbidden() {
	throw new Error('Network access forbidden in independent reader verification')
}
Socket.prototype.connect = forbidden
http.request = forbidden
https.request = forbidden
http.get = forbidden
https.get = forbidden
globalThis.fetch = forbidden
// IPC exists only for the signal test. Announce that the password reader is actually waiting.
if (process.send)
	process.stdin.on('newListener', (event) => {
		if (event === 'data') setImmediate(() => process.send?.('passwordReady'))
	})

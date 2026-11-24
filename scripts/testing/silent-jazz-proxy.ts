import { createHash } from 'node:crypto'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'

/** Real transport adapter: accepts WebSocket upgrades, then withholds every Jazz frame. */
export function createSilentJazzProxy(upstreamUrl: string) {
	const upstream = new URL(upstreamUrl)
	const upstreamRequest = (path: string) => {
		const relative = new URL(path, 'http://test.invalid')
		const target = new URL(upstream)
		target.pathname = upstream.pathname.replace(/\/$/, '') + relative.pathname
		target.search = relative.search
		return target
	}
	const sockets = new Set<Duplex>()
	const upstreamSockets = new Set<Duplex>()
	let mode: 'forward' | 'silent' = 'forward'
	let holdReplies = false
	const observed = { opened: 0, clientBytes: 0, heldHttp: 0 }
	const server = createServer((incoming, outgoing) => {
		if (mode === 'silent') {
			observed.heldHttp += 1
			incoming.resume()
			return
		}
		const forwarded = request(
			upstreamRequest(incoming.url ?? '/'),
			{ method: incoming.method, headers: { ...incoming.headers, host: upstream.host } },
			(response) => {
				outgoing.writeHead(response.statusCode ?? 502, response.headers)
				response.pipe(outgoing)
			}
		)
		forwarded.on('error', () => {
			outgoing.writeHead(502)
			outgoing.end()
		})
		incoming.pipe(forwarded)
	})
	server.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('close', () => sockets.delete(socket))
		socket.on('error', () => socket.destroy())
	})
	server.on('upgrade', (incoming, socket, head) => {
		if (mode === 'silent') {
			const key = incoming.headers['sec-websocket-key']
			if (typeof key !== 'string') {
				socket.destroy()
				return
			}
			const accept = createHash('sha1')
				.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
				.digest('base64')
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
			)
			observed.opened += 1
			observed.clientBytes += head.length
			socket.on('data', (data: Buffer) => (observed.clientBytes += data.length))
			return
		}
		const remote = connect(Number(upstream.port), upstream.hostname, () => {
			const headers = incoming.rawHeaders.reduce(
				(text, value, index) => `${text}${value}${index % 2 === 0 ? ': ' : '\r\n'}`,
				''
			)
			remote.write(
				`${incoming.method} ${upstreamRequest(incoming.url ?? '/').pathname}${upstreamRequest(incoming.url ?? '/').search} HTTP/${incoming.httpVersion}\r\n${headers}\r\n`
			)
			if (head.length) remote.write(head)
			socket.pipe(remote)
			remote.pipe(socket)
			if (holdReplies) remote.pause()
		})
		upstreamSockets.add(remote)
		remote.on('close', () => upstreamSockets.delete(remote))
		remote.on('error', () => socket.destroy())
		socket.on('close', () => remote.destroy())
	})
	return {
		observed,
		get url() {
			const address = server.address()
			if (!address || typeof address === 'string') throw new Error('Proxy is not listening')
			return `http://127.0.0.1:${address.port}`
		},
		pauseServerReplies: () => {
			holdReplies = true
			for (const socket of upstreamSockets) socket.pause()
		},
		pauseEstablished: () => {
			mode = 'silent'
			for (const socket of sockets) socket.pause()
			for (const socket of upstreamSockets) socket.pause()
		},
		listen: (port = 6193) =>
			new Promise<void>((resolve, reject) => {
				server.once('error', reject)
				server.listen(port, '127.0.0.1', () => {
					server.off('error', reject)
					resolve()
				})
			}),
		silence: () => {
			mode = 'silent'
			for (const socket of sockets) socket.destroy()
		},
		resume: () => {
			mode = 'forward'
			holdReplies = false
			for (const socket of sockets) socket.destroy()
		},
		close: () =>
			new Promise<void>((resolve, reject) => {
				for (const socket of sockets) socket.destroy()
				server.close((error) => (error ? reject(error) : resolve()))
			})
	}
}

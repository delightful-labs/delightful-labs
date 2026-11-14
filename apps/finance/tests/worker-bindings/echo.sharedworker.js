addEventListener('connect', (event) => {
	const port = event.ports[0]
	if (!port) return
	port.onmessage = ({ data }) => port.postMessage(data)
	port.start()
})

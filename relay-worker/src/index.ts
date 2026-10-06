export { PartyRoom } from './room';

interface Env {
  ROOM: DurableObjectNamespace;
}

// Every client is allowed: version gating was removed for the 403Changer relay.

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: '403party-relay' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade at /room?key=<room_id>
    const upgrade = request.headers.get('Upgrade');
    if (upgrade?.toLowerCase() === 'websocket') {
      const roomKey = url.searchParams.get('key');
      if (!roomKey || roomKey.length < 8 || roomKey.length > 64) {
        return new Response('Invalid room key', { status: 400 });
      }

      const id = env.ROOM.idFromName(roomKey);
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response('403Changer Party Relay - WebSocket upgrade required', { status: 426 });
  },
};

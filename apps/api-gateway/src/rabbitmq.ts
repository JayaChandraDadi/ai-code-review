import amqp from 'amqplib';
import type { Channel } from 'amqplib';

let ch: Channel | null = null;

export async function getChannel(url: string, queue: string): Promise<Channel> {
  if (ch) return ch;

  const conn = await amqp.connect(url);            // ← inferred type
  const channel = await conn.createChannel();      // ← inferred type
  await channel.assertQueue(queue, { durable: true });

  // if the connection drops, forget the cached channel
  conn.on('close', () => { ch = null; });
  conn.on('error', () => { ch = null; });

  ch = channel;
  return channel;
}

export async function publish(queue: string, payload: unknown) {
  if (!ch) throw new Error('RabbitMQ channel not initialized');
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), { persistent: true });
}

export async function close() {
  try { await ch?.close(); } finally { ch = null; }
}

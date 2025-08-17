import amqp from 'amqplib';
import type { Channel, Connection, ConsumeMessage } from 'amqplib';
export async function consume(
  url: string,
  queue: string,
  handler: (msg: ConsumeMessage, ch: Channel) => Promise<void>
) {
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.assertQueue(queue, { durable: true });
  ch.prefetch(10);
  ch.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      await handler(msg, ch);
      ch.ack(msg);
    } catch (err) {
      console.error('handler error', err);
      ch.nack(msg, false, false); // DLQ in future
    }
  });
}
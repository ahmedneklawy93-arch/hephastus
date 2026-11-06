const HELP = `I'm Hephastus, your assistant. Just message me normally.

Commands:
/memory: see what I remember about you
/reset: start a fresh conversation (I keep my memory)
/help: show this message`;

// Decides what to do with one incoming WhatsApp message.
export function createHandler({ ownerNumber, assistant, store, whatsapp, log = console }) {
  // Messages are handled one at a time so the chat history never gets mixed up.
  let queue = Promise.resolve();

  async function handle(message) {
    if (message.from !== ownerNumber) {
      log.warn(`Ignoring message from ${message.from}: not the owner.`);
      return;
    }
    if (!(await store.markSeen(message.id))) return;

    whatsapp.markReadAndTyping(message.id).catch((error) => log.warn(error.message));

    if (message.type !== "text") {
      await whatsapp.sendText(message.from, "For now I can only read text messages.");
      return;
    }

    const text = message.text.trim();
    const command = text.toLowerCase();
    if (command === "/help" || command === "/start") {
      await whatsapp.sendText(message.from, HELP);
      return;
    }
    if (command === "/reset") {
      await store.setHistory([]);
      await whatsapp.sendText(message.from, "Fresh start. I still remember the facts you told me.");
      return;
    }
    if (command === "/memory") {
      const facts = await store.getFacts();
      const list = facts.length ? facts.map((fact, i) => `${i + 1}. ${fact}`).join("\n") : "Nothing yet.";
      await whatsapp.sendText(message.from, `*What I remember:*\n${list}`);
      return;
    }

    try {
      const answer = await assistant.reply(text);
      await whatsapp.sendText(message.from, answer);
    } catch (error) {
      log.error(error);
      await whatsapp.sendText(message.from, "Something went wrong on my side. Please try again in a minute.");
    }
  }

  return {
    enqueue(message) {
      queue = queue.then(() => handle(message)).catch((error) => log.error(error));
      return queue;
    },
  };
}

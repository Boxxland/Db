// bot.js — Mail Bot
// คำสั่ง: !register username    — สมัครบัญชี Mail Bot (ผูกกับ Discord ID)
// คำสั่ง: !mail @user ข้อความ   — ส่งข้อความหา user (ทั้งคู่ต้องลงทะเบียนแล้ว)
// คำสั่ง: !mailbox              — ดูข้อความที่เคยได้รับ (10 รายการล่าสุด)
// คำสั่ง: !reply ข้อความ        — ตอบกลับข้อความล่าสุดที่ได้รับ โดยไม่ต้อง mention ซ้ำ
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const pool = require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ Mail Bot online: ${client.user.tag}`);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();

  if (content.startsWith('!register')) return handleRegister(msg);
  if (content.startsWith('!mail')) return handleMail(msg);
  if (content === '!mailbox') return handleMailbox(msg);
  if (content.startsWith('!reply')) return handleReply(msg);
});

// ---------- !register username ----------
async function handleRegister(msg) {
  const args = msg.content.trim().split(/\s+/);
  const username = args[1];

  if (!username) {
    return msg.reply('⚠️ ใช้แบบนี้นะ: `!register username`\nเช่น `!register moodeng`');
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return msg.reply('⚠️ username ต้องเป็น a-z, 0-9, _ เท่านั้น (3-20 ตัวอักษร)');
  }

  try {
    const existingByDiscord = await pool.query(
      'SELECT * FROM mailnot_users WHERE discord_id = $1',
      [msg.author.id]
    );
    if (existingByDiscord.rows.length > 0) {
      return msg.reply(`⚠️ คุณลงทะเบียน Mail Bot ไว้แล้วในชื่อ \`${existingByDiscord.rows[0].username}\``);
    }

    const existingByUsername = await pool.query(
      'SELECT discord_id FROM mailnot_users WHERE username = $1',
      [username]
    );
    if (existingByUsername.rows.length > 0) {
      return msg.reply(`⚠️ username \`${username}\` มีคนใช้แล้ว ลองชื่ออื่นนะ`);
    }

    await pool.query(
      'INSERT INTO mailnot_users (discord_id, username) VALUES ($1, $2)',
      [msg.author.id, username]
    );

    return msg.reply(
      `✅ ลงทะเบียน Mail Bot สำเร็จ! ตอนนี้คนอื่นจะเห็นคุณในชื่อ \`${username}\` เวลาส่ง/รับเมล 📬`
    );
  } catch (err) {
    console.error('Register error:', err);
    return msg.reply('❌ เกิดข้อผิดพลาด ลองอีกครั้งนะ');
  }
}

// ---------- !mail @user ข้อความ ----------
async function handleMail(msg) {
  try {
    const senderResult = await pool.query(
      'SELECT * FROM mailnot_users WHERE discord_id = $1',
      [msg.author.id]
    );
    const sender = senderResult.rows[0];
    if (!sender) {
      return msg.reply('⚠️ คุณยังไม่ได้ลงทะเบียน Mail Bot — พิมพ์ `!register username` ก่อนนะ');
    }

    const target = msg.mentions.users.first();
    if (!target) {
      return msg.reply('⚠️ ใช้แบบนี้นะ: `!mail @ชื่อคน ข้อความ`\nเช่น `!mail @moodeng สวัสดีครับ`');
    }
    if (target.bot) return msg.reply('⚠️ ส่งหาบอทตัวอื่นไม่ได้นะ');
    if (target.id === msg.author.id) return msg.reply('⚠️ ส่งหาตัวเองทำไมล่ะ 😄');

    const recipientResult = await pool.query(
      'SELECT * FROM mailnot_users WHERE discord_id = $1',
      [target.id]
    );
    const recipient = recipientResult.rows[0];
    if (!recipient) {
      return msg.reply(`⚠️ ${target.tag} ยังไม่ได้ลงทะเบียน Mail Bot เลย ส่งหาไม่ได้นะ`);
    }

    const messageText = msg.content
      .replace('!mail', '')
      .replace(/<@!?\d+>/, '')
      .trim();

    if (!messageText) {
      return msg.reply('⚠️ ลืมใส่ข้อความ — ใช้แบบนี้นะ: `!mail @ชื่อคน ข้อความ`');
    }

    return deliverMail(msg, sender, target, recipient, messageText);
  } catch (err) {
    console.error('Mail error:', err);
    return msg.reply('❌ เกิดข้อผิดพลาด ลองอีกครั้งนะ');
  }
}

// ---------- !reply ข้อความ (ตอบข้อความล่าสุดที่ได้รับ) ----------
async function handleReply(msg) {
  try {
    const senderResult = await pool.query(
      'SELECT * FROM mailnot_users WHERE discord_id = $1',
      [msg.author.id]
    );
    const sender = senderResult.rows[0];
    if (!sender) {
      return msg.reply('⚠️ คุณยังไม่ได้ลงทะเบียน Mail Bot — พิมพ์ `!register username` ก่อนนะ');
    }

    const messageText = msg.content.replace('!reply', '').trim();
    if (!messageText) {
      return msg.reply('⚠️ ใช้แบบนี้นะ: `!reply ข้อความ` (ตอบข้อความล่าสุดที่คุณได้รับ)');
    }

    const lastMsgResult = await pool.query(
      'SELECT * FROM mailnot_messages WHERE to_discord_id = $1 ORDER BY created_at DESC LIMIT 1',
      [msg.author.id]
    );
    const lastMsg = lastMsgResult.rows[0];
    if (!lastMsg) {
      return msg.reply('⚠️ คุณยังไม่เคยได้รับข้อความเลย ไม่มีอะไรให้ตอบ');
    }

    const target = await client.users.fetch(lastMsg.from_discord_id).catch(() => null);
    if (!target) {
      return msg.reply('⚠️ หาผู้ใช้ที่จะตอบไม่เจอ (อาจออกจากเซิร์ฟไปแล้ว)');
    }

    const recipientResult = await pool.query(
      'SELECT * FROM mailnot_users WHERE discord_id = $1',
      [target.id]
    );
    const recipient = recipientResult.rows[0];
    if (!recipient) {
      return msg.reply('⚠️ คนที่คุณจะตอบยกเลิกการลงทะเบียน Mail Bot ไปแล้ว');
    }

    return deliverMail(msg, sender, target, recipient, messageText);
  } catch (err) {
    console.error('Reply error:', err);
    return msg.reply('❌ เกิดข้อผิดพลาด ลองอีกครั้งนะ');
  }
}

// ---------- ฟังก์ชันกลาง ใช้ส่งจริงทั้งจาก !mail และ !reply ----------
async function deliverMail(msg, sender, targetUser, recipientRecord, messageText) {
  try {
    await targetUser.send(
      `📩 **ข้อความใหม่จาก \`${sender.username}\`** (Mail Bot)\n\n` +
      `${messageText}\n\n` +
      `— ตอบกลับด้วย \`!reply ข้อความ\` ได้เลย`
    );
    await pool.query(
      'INSERT INTO mailnot_messages (from_discord_id, to_discord_id, body) VALUES ($1, $2, $3)',
      [msg.author.id, targetUser.id, messageText]
    );
    return msg.reply(`✅ ส่งถึง \`${recipientRecord.username}\` แล้ว 📨`);
  } catch (err) {
    return msg.reply(`⚠️ ส่งหา \`${recipientRecord.username}\` ไม่ได้ — เขาอาจปิดรับ DM จากสมาชิกเซิร์ฟไว้`);
  }
}

// ---------- !mailbox ----------
async function handleMailbox(msg) {
  try {
    const userResult = await pool.query(
      'SELECT * FROM mailnot_users WHERE discord_id = $1',
      [msg.author.id]
    );
    const user = userResult.rows[0];
    if (!user) {
      return msg.reply('⚠️ คุณยังไม่ได้ลงทะเบียน Mail Bot — พิมพ์ `!register username` ก่อนนะ');
    }

    const inboxResult = await pool.query(
      'SELECT * FROM mailnot_messages WHERE to_discord_id = $1 ORDER BY created_at DESC LIMIT 10',
      [msg.author.id]
    );
    const inbox = inboxResult.rows;

    if (inbox.length === 0) {
      return msg.reply('📭 กล่องข้อความว่างเปล่า ยังไม่มีใครส่งหาคุณเลย');
    }

    // หา username ของผู้ส่งแต่ละข้อความมาแสดง (ผู้ส่งอาจยกเลิกบัญชีไปแล้วได้เหมือนกัน)
    const lines = [];
    for (const m of inbox) {
      const fromResult = await pool.query(
        'SELECT username FROM mailnot_users WHERE discord_id = $1',
        [m.from_discord_id]
      );
      const fromName = fromResult.rows[0] ? fromResult.rows[0].username : 'ผู้ใช้ที่ยกเลิกบัญชีแล้ว';
      const preview = m.body.length > 60 ? m.body.slice(0, 60) + '…' : m.body;
      lines.push(`**จาก \`${fromName}\`** — ${preview}`);
    }

    return msg.reply(
      `📬 **กล่องข้อความของ \`${user.username}\`** (10 รายการล่าสุด)\n\n` + lines.join('\n')
    );
  } catch (err) {
    console.error('Mailbox error:', err);
    return msg.reply('❌ เกิดข้อผิดพลาด ลองอีกครั้งนะ');
  }
}

client.login(process.env.DISCORD_TOKEN);

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { createClient } = require("@supabase/supabase-js");
const express = require("express");

// ============= ОТЛАДКА ПЕРЕМЕННЫХ =============

console.log("🔍 Проверка переменных окружения:");
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Есть" : "❌ НЕТ");
console.log("PAYMENT_TOKEN:", process.env.PAYMENT_TOKEN ? "✅ Есть" : "❌ НЕТ");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "✅ Есть" : "❌ НЕТ");
console.log(
  "SUPABASE_ANON_KEY:",
  process.env.SUPABASE_ANON_KEY ? "✅ Есть" : "❌ НЕТ",
);

if (!process.env.SUPABASE_URL) {
  console.error("❌ КРИТИЧЕСКАЯ ОШИБКА: SUPABASE_URL не найден!");
  process.exit(1);
}

// ============= МИНИ-СЕРВЕР =============

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Бот ALYAZHE работает 24/7!");
});

app.listen(port, () => {
  console.log(`🌐 Веб-сервер запущен на порту ${port}`);
});

// ============= КОНФИГУРАЦИЯ БОТА =============

const BOT_TOKEN = process.env.BOT_TOKEN;
const PAYMENT_TOKEN = process.env.PAYMENT_TOKEN;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ============= /start =============

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const { data: examples } = await supabase
      .from("projects")
      .select("title")
      .limit(3);

    let exampleText = "";
    if (examples && examples.length > 0) {
      exampleText = "\n\n📌 Примеры проектов:\n";
      examples.forEach((proj) => {
        exampleText += `• ${proj.title}\n`;
      });
    }

    bot.sendMessage(
      chatId,
      `👋 Здравствуйте!\n\n` +
        `Я бот для покупки проектов домов ALYAZHE.\n\n` +
        `📝 Как купить проект:\n` +
        `1. Напишите название проекта (или его часть)\n` +
        `2. Я найду проект и создам счёт на оплату\n` +
        `3. После оплаты вы получите PDF чертежи\n\n` +
        `📋 Полный каталог: https://alyazhe.ru/#projects` +
        exampleText +
        `\n💬 Напишите название проекта для начала.`,
    );
  } catch (error) {
    console.error("❌ Ошибка в /start:", error);
    bot.sendMessage(chatId, "❌ Произошла ошибка. Попробуйте позже.");
  }
});

// ============= ОБРАБОТКА СООБЩЕНИЙ =============

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const username = msg.from.username || msg.from.first_name;

  if (!text || text.startsWith("/")) return;

  console.log(`📩 Получено сообщение от @${username}: "${text}"`);

  try {
    const { data: projects, error } = await supabase
      .from("projects")
      .select("*")
      .ilike("title", `%${text}%`)
      .limit(5);

    if (error) {
      console.error("❌ Ошибка Supabase:", error);
      bot.sendMessage(chatId, "❌ Ошибка загрузки проектов. Попробуйте позже.");
      return;
    }

    if (!projects || projects.length === 0) {
      bot.sendMessage(
        chatId,
        `❌ Проект не найден.\n\n` +
          `Попробуйте:\n` +
          `• Написать часть названия (например, "озеро")\n` +
          `• Посмотреть список: https://alyazhe.ru/#projects`,
      );
      return;
    }

    if (projects.length > 1) {
      let message = `🔍 Найдено проектов: ${projects.length}\n\n`;

      projects.forEach((proj, index) => {
        message += `${index + 1}. ${proj.title}\n`;
        message += `   📐 Площадь: ${proj.area} м²\n`;
        message += `   💰 Цена: ${proj.Price?.toLocaleString("ru-RU") || "не указана"} ₽\n\n`;
      });

      message += `Напишите полное название проекта для покупки.`;

      bot.sendMessage(chatId, message);
      return;
    }

    const project = projects[0];

    if (!project.Price) {
      bot.sendMessage(
        chatId,
        "❌ Для этого проекта не установлена цена. Обратитесь к администратору.",
      );
      return;
    }

    console.log(`✅ Найден проект: ${project.title}, цена: ${project.Price} ₽`);

    // ✅ ПРОВЕРКА ТОКЕНА ПЕРЕД ОТПРАВКОЙ
    if (!PAYMENT_TOKEN) {
      console.error("❌ PAYMENT_TOKEN не найден!");
      bot.sendMessage(
        chatId,
        "❌ Ошибка конфигурации платежей. Обратитесь к администратору.",
      );
      return;
    }

    console.log("💳 Создаю счёт на оплату...");
    console.log("PAYMENT_TOKEN:", PAYMENT_TOKEN.substring(0, 20) + "...");

    const invoicePayload = JSON.stringify({
      projectId: project.id,
      chatId: chatId,
      username: username,
    });

    try {
      await bot.sendInvoice(
        chatId,
        `Проект: ${project.title}`,
        project.description || `Чертежи проекта ${project.title}`,
        invoicePayload,
        PAYMENT_TOKEN,
        "RUB",
        [
          {
            label: project.title,
            amount: Math.round(project.Price * 100),
          },
        ],
        {
          photo_url: project.cover_image,
          photo_width: 800,
          photo_height: 600,
          need_name: false,
          need_phone_number: false,
          need_email: false,
          need_shipping_address: false,
          is_flexible: false,
        },
      );

      console.log("✅ Счёт успешно отправлен!");

      bot.sendMessage(
        chatId,
        `💳 Счёт на оплату сформирован!\n\n` +
          `📦 Проект: ${project.title}\n` +
          `📐 Площадь: ${project.area} м²\n` +
          `💰 Стоимость: ${project.Price.toLocaleString("ru-RU")} ₽\n\n` +
          `Нажмите кнопку "Оплатить" выше 👆`,
      );
    } catch (invoiceError) {
      console.error("❌ ОШИБКА СОЗДАНИЯ СЧЁТА:", invoiceError);
      console.error("Детали:", JSON.stringify(invoiceError, null, 2));

      bot.sendMessage(
        chatId,
        `❌ Ошибка создания счёта.\n\n` +
          `Причина: ${invoiceError.message}\n\n` +
          `Обратитесь к администратору.`,
      );
    }
  } catch (error) {
    console.error("❌ Ошибка:", error);
    bot.sendMessage(chatId, "❌ Произошла ошибка. Попробуйте позже.");
  }
});

// ============= ПОДТВЕРЖДЕНИЕ ОПЛАТЫ =============

bot.on("pre_checkout_query", (query) => {
  console.log("✅ Pre-checkout query получен");
  bot.answerPreCheckoutQuery(query.id, true);
});

// ============= УСПЕШНАЯ ОПЛАТА =============

bot.on("successful_payment", async (msg) => {
  const chatId = msg.chat.id;
  const payment = msg.successful_payment;
  const username = msg.from.username || msg.from.first_name;

  console.log("🎉 Успешная оплата!", payment);

  try {
    const payload = JSON.parse(payment.invoice_payload);
    const projectId = payload.projectId;

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();

    if (error || !project) {
      console.error("❌ Ошибка загрузки проекта:", error);
      bot.sendMessage(
        chatId,
        "❌ Ошибка получения проекта. Обратитесь в поддержку.",
      );
      return;
    }

    await supabase.from("project_purchases").insert([
      {
        project_id: projectId,
        telegram_chat_id: chatId,
        telegram_username: username,
        amount: project.Price,
        payment_id: payment.telegram_payment_charge_id,
      },
    ]);

    if (project.pdf_file_url) {
      bot.sendDocument(chatId, project.pdf_file_url, {
        caption: `✅ Спасибо за покупку!\n\nПроект: ${project.title}\n\nЧертежи во вложении.`,
      });
    } else {
      bot.sendMessage(
        chatId,
        `✅ Оплата прошла успешно. Спасибо!\n\n` +
          `Проект: ${project.title}\n\n` +
          `⚠️ Чертежи будут отправлены вручную в ближайшее время.`,
      );
    }

    console.log(
      `✅ Покупка проекта "${project.title}" пользователем @${username}`,
    );
  } catch (error) {
    console.error("❌ Ошибка обработки платежа:", error);
    bot.sendMessage(
      chatId,
      "❌ Ошибка обработки платежа. Обратитесь в поддержку.",
    );
  }
});

// ============= ОШИБКИ =============

bot.on("polling_error", (error) => {
  console.error("❌ Polling error:", error);
});

console.log("✅ Бот запущен и ожидает сообщений...");
console.log("🌐 Сайт: https://alyazhe.ru");

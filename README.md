# SyToDo — Telegram Mini App

Менеджер личных задач: React + Vite + TypeScript, официальный Telegram Serverless,
SQLite через `sdk/db`. Без VPS и отдельного backend-хостинга.

Реализованы Telegram-профиль, создание задач с описанием и приоритетом,
выполнение и возврат в активные, удаление с подтверждением, фильтры,
пагинация по 30 задач, счётчики и прогресс. Интерфейс адаптируется к смартфонам,
темам Telegram, safe area и настройке уменьшения анимации. Есть состояния загрузки,
ошибок, пустого списка и запуска вне Telegram.

Опубликованы дедлайны с датой и временем, изменение и удаление срока,
отметка просрочки и backend напоминаний в личном чате.
Миграция добавила 7 полей и индекс без удаления существующих данных.
Автоматические напоминания включены (cloud revision 4): планировщик GitHub
Actions в [marsen5689/SyToDoBot-](https://github.com/marsen5689/SyToDoBot-)
запускает официальный Telegram CLI примерно каждые 5 минут.

## Структура

```text
SyToDoBot/
├── AGENTS.md                  # официальные инструкции scaffold CLI
├── docs/
│   ├── tgcloud-sdk.md          # официальный справочник SDK
│   └── verification.md         # проверка требований и её ограничения
├── src/
│   ├── App.tsx                # профиль, статистика, список задач
│   ├── CreateTask.tsx         # создание и безопасный повтор запроса
│   ├── EditSchedule.tsx       # изменение дедлайна и напоминания
│   ├── ScheduleFields.tsx     # дата/время и интервалы напоминаний
│   ├── schedule.ts            # локальное время ↔ UTC
│   ├── reminderPermission.ts # официальный requestWriteAccess
│   ├── useReminderCapabilities.ts # доступность автоматической отправки
│   ├── Sheet.tsx              # доступный dialog и Telegram BackButton
│   ├── api.ts                 # только Telegram.WebApp.Serverless.call
│   ├── useTasks.ts            # загрузка, пагинация, защита от гонок
│   ├── useTelegram.ts         # темы, отступы, haptic feedback
│   ├── types.ts
│   ├── icons.tsx
│   ├── main.tsx
│   └── styles.css
├── tgcloud/
│   ├── schema.js              # SQLite tasks, индексы и ограничения
│   ├── lib/tasks.js           # текущий пользователь и валидация
│   ├── lib/task-service.js    # общая логика для чата и Mini App
│   ├── lib/bot.js             # команды, меню и inline-кнопки
│   ├── lib/reminders.js       # отправка, lease и отмена устаревших задач
│   ├── lib/reminder-config.js # напоминания включены; точность scheduler 5 минут
│   ├── handlers/message.js    # обработка команд и сообщений
│   ├── handlers/callback_query.js # обработка inline-кнопок
│   └── endpoints/
│       ├── getProfile.js
│       ├── listTasks.js
│       ├── createTask.js
│       ├── setTaskCompleted.js
│       ├── setTaskSchedule.js
│       ├── getReminderCapabilities.js
│       ├── processReminders.js # защищённый служебный вызов через CLI
│       └── deleteTask.js
├── tests/
│   ├── backend.test.mjs       # 6 проверок логики на настоящей SQLite
│   ├── bot.test.mjs           # 6 проверок команд, кнопок и прав доступа
│   ├── reminders.test.mjs     # 8 проверок сроков, отправки и миграции
│   ├── sqlite-runtime.mjs     # только тестовый адаптер контрактов SDK
│   └── browser/app.spec.ts    # интерфейс с официальным WebApp SDK
├── scripts/check-backend.mjs  # синтаксис и ограничения runtime
├── scripts/run-reminders.mjs  # внешний runner официального CLI
├── .github/workflows/task-reminders.yml # подключённый GitHub Actions scheduler
├── public/favicon.svg
├── index.html
├── vite.config.ts
├── tsconfig.json
├── playwright.config.ts
├── tgcloud.jsonc              # static.source = dist
├── package.json
├── package-lock.json
└── dist/                      # результат npm run build, gitignored
```

`.tgcloud/` управляется только CLI и исключена из Git. Секрет не находится в
исходниках или frontend. Не редактируйте и не копируйте состояние CLI вручную.

## Авторизация и изоляция

Frontend обращается через официальный `telegram-web-app.js`:

```js
Telegram.WebApp.Serverless.call('listTasks', { status: 'active' }, (error, result) => {
  // SDK автоматически отправляет initData и возвращает результат endpoint.
});
```

Telegram Serverless проверяет `initData` до вызова endpoint. Без валидных данных
платформа возвращает `401`. Backend получает владельца только из
`ctx.initData.user.id`, проверяет наличие корректного ID и игнорирует любые
`userId` клиента. Каждый пользовательский SELECT, UPDATE, DELETE и подсчёт имеет ограничение по
владельцу; INSERT явно устанавливает владельца из контекста. Для чужих и
несуществующих задач ответ одинаковый: `NOT_FOUND`.

Никакого собственного логина, неподтверждённого `initDataUnsafe`, frontend-токена
или локального хранилища задач нет. SQLite сохраняет данные между открытиями.
Индексы охватывают владельца, статус и ID. SQL-параметры формирует `sdk/db`.
Foreign keys не используются: в этом runtime они не поддерживаются.

Создание принимает `requestId`. Backend добавляет к нему проверенный ID владельца,
а уникальное поле `request_key` исключает дубликаты при повторе после сетевой ошибки.
Изменение статуса устанавливает заданное boolean-значение, а не переключает его
на сервере. Клиент не повторяет мутации автоматически и не показывает успешное
сохранение до ответа сервера.

## Endpoints

| Endpoint | Вход | Результат |
| --- | --- | --- |
| `getProfile` | `{}` | Профиль из проверенного initData: `id`, `first_name`, `last_name`, `username`, `photo_url` |
| `listTasks` | `{ status?: 'active' \| 'completed' \| 'all', cursor?: number }` | `{ tasks, counts: { active, completed }, nextCursor }` |
| `createTask` | `{ title, note?, priority?, requestId }` | `{ task }` |
| `setTaskCompleted` | `{ id, completed: boolean }` | `{ task }` |
| `deleteTask` | `{ id }` | `{ id }` |

Названия задач: 1–200 символов после trim, без управляющих символов. Описание:
до 1000 символов. Приоритет: `low`, `normal` или `high`. ID: положительное безопасное
целое число. `requestId`: 16–80 букв, цифр, `_` или `-`.
В ответе задачи нет `userId` или `requestKey`.

Ожидаемые ошибки передаются через официальный `EndpointError(message, { code, field? })`.
Коды: `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`. Неожиданные исключения
платформа скрывает за общей серверной ошибкой.

## Локальная работа

Требуется Node.js 22.12+ (рекомендуется 24). CLI проекта: `@tgcloud/cli` 0.2.0+.

```bash
cd SyToDoBot
npm ci
npm run dev
```

Обычный браузер покажет экран открытия через Telegram. Для настоящих запросов
нужны Telegram initData, опубликованные endpoints и созданная таблица. Локальный
frontend не заменяет endpoints ни моками, ни `localStorage`.

Проверки без публикации и без изменения облачной базы:

```bash
npm run check
```

Браузерные проверки:

```bash
npx playwright install chromium
npm run test:ui
```

Они загружают официальный `telegram-web-app.js`; перехват транспорта и контекст
пользователя существуют только внутри тестов. Endpoint-функции выполняются на
локальной SQLite через тестовый адаптер. Это не проверка криптографии платформы.
Для уже установленного Chromium и скачанного официального SDK можно использовать:

```bash
CHROMIUM_PATH=/usr/bin/chromium TELEGRAM_SDK_PATH=/path/to/telegram-web-app.js npm run test:ui
```

Для безопасной проверки платформенного runtime без SQL-запросов:

```bash
npx tgcloud run endpoints/getProfile '{}' --ctx '{ initData: { user: { id: 123, first_name: "SDK check" } } }'
```

**Важно:** `run --ctx` — авторизованный инструмент разработчика. Переданный там
контекст специально не проверяется платформой. Production-запросы Mini App
проверяются Telegram автоматически.

## Публикация и последующие обновления

По разрешению пользователя проект опубликован 10 октября 2026; обновлённый
монохромный интерфейс — cloud revision 2. Дедлайны и backend напоминаний
опубликованы 11 октября 2026 — cloud revision 3.
В тот же день подключён GitHub Actions и включены напоминания — revision 4.
Таблица tasks создана безопасной миграцией. Webhook установлен для message и
callback_query, накопленные обновления обработаны. Mini App доступен по адресу
https://app8347651382.tgcloud.ai/.

Ниже команды для следующих обновлений или переноса проекта в новое окружение:

```bash
cd SyToDoBot
npm ci
npm run check

# В новом окружении: ввести CLI Access token скрытым вводом.
# В текущем workspace проект уже связан с app8347651382.
npx tgcloud login

# Проверить облачную версию и локальные изменения.
npx tgcloud fetch
npx tgcloud status
npx tgcloud diff

# Собрать frontend и опубликовать код + dist. Это публичный деплой.
npm run deploy

# Отдельно просмотреть и подтвердить создание таблицы и индексов.
npx tgcloud migrate
```

`push` регистрирует схему, но не изменяет базу. До выполнения `migrate` endpoints,
обращающиеся к tasks, будут возвращать серверную ошибку; первую публикацию и
миграцию следует выполнить последовательно.

В @BotFather у `SyToDoBot` настройте Main Mini App / кнопку меню с URL:

```text
https://app8347651382.tgcloud.ai/
```

После публикации отправьте боту `/start`: он настроит список команд для вашего
личного чата и кнопку меню «Мои задачи», ведущую в Mini App.
Webhook обновляется CLI при push; проверить его можно `npx tgcloud webhook`.
После настройки проверьте приложение с двумя реальными Telegram-аккаунтами:
создание, выполнение, возврат, удаление и повторное открытие. Чужие задачи не
должны появляться ни в списках, ни в счётчиках. Неподписанный или подменённый
initData должен быть отклонён платформой с 401.

Если переносите проект на другого бота, измените публичные ссылки в
`tgcloud/lib/bot.js` и `src/App.tsx` на его URL и username.

## Команды и кнопки бота

| Команда | Действие |
| --- | --- |
| `/start` | Приветствие, настройка меню и список действий |
| `/menu` | Повторная настройка и открытие главного меню |
| `/app` | Кнопка открытия Mini App |
| `/tasks` | Активные задачи, по 5 на страницу |
| `/completed` | Выполненные задачи |
| `/all` | Все задачи |
| `/add Купить продукты` | Создание задачи в общей SQLite |
| `/done 42` | Выполнение задачи №42 |
| `/undo 42` | Возврат задачи №42 в активные |
| `/delete 42` | Подтверждение удаления с кнопками «Да, удалить» и «Оставить» |
| `/profile` | Профиль отправителя из Telegram update |
| `/stats` | Общие счётчики и процент выполнения |
| `/help` | Справка по командам и кнопкам |
| `/cancel` | Возврат в главное меню; команды не открывают незавершённых сеансов ввода |

Алиасы `/active` и `/new` также поддерживаются. Команды с суффиксом
`@SyToDoBot` принимаются; команды, адресованные другому боту, игнорируются.
Для `/add` без названия показывается пример и кнопка формы Mini App.
Текст без команды не сохраняется автоматически — бот объясняет, как создать задачу.

В списках есть выполнение/возврат, подтверждение удаления, следующая страница,
возврат к началу и открытие соответствующего списка в приложении. Кнопка
«Новая задача» открывает Mini App сразу с формой создания (`?action=new`).
Фильтр из чата передаётся через `?filter=active|completed|all`.

Telegram updates не имеют `ctx.initData`: для чат-команд владельцем служит
`message.from.id`, для inline-кнопок — `callback_query.from.id`, предоставленные
Telegram Serverless. Дополнительно проверяются личный чат, совпадение chat ID
с ID отправителя и отсутствие bot-отправителя. `callback_data` содержит только
действие и ID задачи; все запросы по-прежнему ограничены владельцем. Endpoint
Mini App продолжает использовать только проверенный `ctx.initData.user.id`.

Повторная доставка одного `/add` не создаёт дубликат: request key включает chat ID
и message ID. Нажатия callback подтверждаются через `answerCallbackQuery`, сообщения
обновляются через `editMessageText`. Пользовательские имена и названия экранируются
для HTML. Ошибка настройки меню не блокирует `/start`; повторить можно `/menu`.

Схема базы для этого расширения не менялась. При публикации нового
`callback_query` handler CLI обновляет allowed_updates webhook на push.

## Дедлайны и автоматические напоминания

Дедлайн необязателен. В форме используются местные дата и время устройства,
в SQLite сохраняется UTC timestamp и смещение для сообщения бота. Срок можно
изменить или убрать кнопкой календаря в строке задачи; просрочка обновляется
при возвращении в приложение и раз в минуту. Этот таймер только обновляет
отображение, он не отправляет напоминания.

Доступны интервалы: в момент дедлайна, за 15 минут, за час, за день и без
напоминания. Для отправки пользователь даёт разрешение через официальный
`Telegram.WebApp.requestWriteAccess`. Backend проверяет дату и интервал,
выполнение или удаление отменяет ожидающую отправку. Повторное сохранение
одинаковых настроек не сбрасывает уже отправленное напоминание.

В [Telegram Serverless 0.2.0](https://core.telegram.org/bots/serverless) не
документированы cron, persistent timers или scheduled jobs. Работающий при
закрытом Mini App вариант: внешний GitHub Actions scheduler запускает
официальный CLI; база, обработчик и Bot API остаются на Telegram Serverless.
Workflow подключён в созданном пользователем публичном репозитории
[marsen5689/SyToDoBot-](https://github.com/marsen5689/SyToDoBot-), ветка main.
CLI Access хранится в Repository Actions secret `TGCLOUD_TOKEN`; runner проверяет,
что токен относится к app8347651382, и не выводит его значение.
`tgcloud/lib/reminder-config.js` содержит `remindersEnabled=true`.

Доступ из GitHub проверен запуском `verify_only=true`, который вызывает только
getReminderCapabilities. После включения и создания пользователем задачи
проверена реальная отправка из GitHub: enabled:true, sent:1, failed:0, skipped:0.
Пользователь подтвердил получение сообщения в Telegram. Повторный запуск
вернул sent:0, failed:0, skipped:0 — задача не отправилась повторно.
Workflow имеет состояние active и cron `2-59/5 * * * *`, ветка main.
Контрольная отправка проверена ручным запуском workflow; расписание настраивается
тем же файлом, время запуска определяет GitHub.

Общая последовательность подключения в новом окружении:

1. Применить проверенную миграцию: 7 дополнительных столбцов tasks и индекс.
   `npx tgcloud migrate --local --dry-run` ничего не изменяет; применение —
   `npx tgcloud migrate --local --safe`. Существующие задачи получают NULL
   дедлайн и напоминание; данные не удаляются.
2. Опубликовать новую сборку и модули: `npm run deploy`.
3. Разместить исходники в приватном GitHub-репозитории, включить Actions и
   добавить Repository Actions secret `TGCLOUD_TOKEN` с CLI Access token.
   Не коммитить токен или .tgcloud. У токена есть права разработчика проекта.
4. Проверить выполнение workflow вручную с `verify_only=true`, установить
   `remindersEnabled=true`, повторить проверки и опубликовать модуль настройки.
   Затем запустить workflow с `verify_only=false`. Если отправка отключена,
   обычный runner намеренно сообщает ошибку, чтобы не показывать ложный успех.
5. В реальном Telegram разрешить сообщения бота, создать задачу с будущим
   напоминанием и проверить доставку после закрытия Mini App.

Для ручного запуска подключённого scheduler: `npm run reminders`. Он использует
официальный `tgcloud run endpoints/processReminders` с контекстом разработчика.
Из GitHub: Actions → Telegram task reminders → Run workflow, verify_only=false.
CLI: `gh workflow run task-reminders.yml --repo marsen5689/SyToDoBot- --ref main -f verify_only=false`.
Служебный endpoint требует корневой maintenanceJob, который нельзя задать
через input или initData. В обычном Mini App такой вызов запрещён. Получатель
сообщения берётся из владельца записи SQLite, не из аргументов runner.

GitHub Actions запускается примерно каждые 5 минут: точное время не гарантируется,
возможны задержки или пропуски запусков; в неактивных публичных репозиториях
scheduled workflows могут отключаться. Один запуск обрабатывает до 20 задач.
Worker использует атомарную 10-минутную lease, версию настроек, проверку отмены
перед отправкой и retry_after. Блокировка бота отключает дальнейшие попытки.
Telegram sendMessage не предоставляет ключ идемпотентности: если ответ потерян
после успешной отправки, повторная попытка может дать второе сообщение. Между
последней проверкой и уже выполняющейся отправкой также возможна отмена задачи;
начатую отправку Telegram нельзя отозвать.

## Источники

- [Официальная документация Telegram Serverless](https://core.telegram.org/bots/serverless)
- [Telegram Mini Apps: Serverless](https://core.telegram.org/bots/webapps#serverless)
- [Официальный WebApp SDK](https://telegram.org/js/telegram-web-app.js)
- [Инструкции проекта](AGENTS.md)
- [SDK проекта](docs/tgcloud-sdk.md)

Документация scaffold содержит старую формулировку о миграции при deploy в
разделе определения схемы. При работе используйте явно описанный и подтверждённый
официальной страницей двухэтапный процесс: `push`, затем отдельный `migrate`.
